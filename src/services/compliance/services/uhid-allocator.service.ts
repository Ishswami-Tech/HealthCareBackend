import { ConflictException, Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';
import type { PatientIdentifierRecord } from '@core/types/compliance.types';
import type {
  PrismaDelegateArgs,
  PrismaTransactionClientWithDelegates,
} from '@core/types/prisma.types';
import { CompliancePatientAccess } from '@services/compliance/services/compliance-patient-access.service';
import type { ComplianceActor } from '@services/compliance/services/compliance-patient-access.service';
import { PatientIdentifierService } from '@services/compliance/services/patient-identifier.service';
import { PhiAuditService } from '@services/compliance/services/phi-audit.service';
import {
  UHID_MAX_SEQUENCE,
  formatUhid,
  normaliseClinicCode,
} from '@services/compliance/utils/uhid.util';

const MAX_ALLOCATION_ATTEMPTS = 5;

type RawClient = PrismaTransactionClientWithDelegates & {
  $queryRaw: <T>(query: TemplateStringsArray, ...values: unknown[]) => Promise<T>;
};

/**
 * Issues UHIDs: one per patient per clinic, never reused, never typed in by hand.
 *
 * The counter lives in `uhid_sequences` and is advanced with a single atomic upsert-increment
 * (executeHealthcareWrite does not wrap its callback in one transaction, so read-then-write would
 * hand two patients the same number). The first allocation seeds the counter from the highest UHID
 * already issued for the clinic, so an import that wrote UHIDs first cannot be overtaken.
 */
@Injectable()
export class UhidAllocatorService {
  private readonly serviceName = 'UhidAllocatorService';

  constructor(
    private readonly database: DatabaseService,
    private readonly identifiers: PatientIdentifierService,
    private readonly access: CompliancePatientAccess,
    private readonly phiAudit: PhiAuditService,
    private readonly logger: LoggingService
  ) {}

  /** Controller entry: the patient's UHID, issued now if they have none; staff only, audited. */
  async issueForActor(
    patientId: string,
    clinicId: string,
    actor: ComplianceActor & { ipAddress?: string; userAgent?: string }
  ): Promise<PatientIdentifierRecord> {
    const patient = await this.access.require(patientId, clinicId, actor);
    const record = await this.ensureUhid(patient.id, clinicId, 'MANUAL');
    await this.phiAudit.record({
      userId: actor.userId,
      userRole: actor.role,
      patientId: patient.id,
      clinicId,
      action: 'CREATE',
      resourceType: 'PATIENT_IDENTIFIER',
      resourceId: record.id,
      purpose: 'patient registration',
      fields: ['UHID'],
      ...(actor.ipAddress ? { ipAddress: actor.ipAddress } : {}),
      ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
    });
    return record;
  }

  /** The next UHID for the clinic. Consumes a sequence number even if the caller then fails. */
  async allocate(clinicId: string): Promise<string> {
    const clinicCode = await this.resolveClinicCode(clinicId);
    const sequence = await this.nextSequence(clinicId);
    if (sequence > UHID_MAX_SEQUENCE) {
      throw new ConflictException('UHID range for this clinic is exhausted');
    }
    return formatUhid(clinicCode, sequence);
  }

  /**
   * The patient's UHID in this clinic, issuing one if they have none. Safe to call on every
   * registration and from concurrent requests: the one-UHID-per-patient unique index decides the
   * winner and the loser returns the winner's UHID.
   */
  async ensureUhid(
    patientId: string,
    clinicId: string,
    source = 'SYSTEM'
  ): Promise<PatientIdentifierRecord> {
    for (let attempt = 1; attempt <= MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
      const existing = await this.findUhid(patientId, clinicId);
      if (existing) return existing;
      const value = await this.allocate(clinicId);
      try {
        const created = await this.identifiers.createUhid({
          patientId,
          clinicId,
          value,
          source,
        });
        void this.logger.log(LogType.AUDIT, LogLevel.INFO, 'UHID issued', this.serviceName, {
          clinicId,
          patientId,
        });
        return created;
      } catch (error) {
        // Lost a race (same patient or same number): look again, then retry with a new number.
        if (!(error instanceof ConflictException)) throw error;
      }
    }
    const raced = await this.findUhid(patientId, clinicId);
    if (raced) return raced;
    throw new ConflictException('Could not issue a UHID, please retry');
  }

  private async findUhid(
    patientId: string,
    clinicId: string
  ): Promise<PatientIdentifierRecord | undefined> {
    const all = await this.identifiers.listForPatient(patientId, clinicId);
    return all.find(record => record.system === 'UHID');
  }

  private async nextSequence(clinicId: string): Promise<number> {
    const rows = await this.database.executeHealthcareWrite<Array<{ lastValue: number | string }>>(
      async client => {
        const tc = client as unknown as RawClient;
        return tc.$queryRaw<Array<{ lastValue: number | string }>>`
          INSERT INTO "uhid_sequences" ("clinicId", "lastValue", "updatedAt")
          VALUES (
            ${clinicId},
            (
              SELECT COALESCE(MAX(CAST(SUBSTRING("value" FROM '([0-9]{8})[0-9]$') AS INTEGER)), 0) + 1
              FROM "patient_identifiers"
              WHERE "clinicId" = ${clinicId}
                AND "system" = 'UHID'
                AND "value" ~ '^[A-Z0-9]{2,8}-[0-9]{9}$'
            ),
            NOW()
          )
          ON CONFLICT ("clinicId")
          DO UPDATE SET "lastValue" = "uhid_sequences"."lastValue" + 1, "updatedAt" = NOW()
          RETURNING "lastValue"
        `;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId,
        operation: 'CREATE',
        resourceType: 'UHID_SEQUENCE',
        resourceId: clinicId,
        skipCacheInvalidation: true,
      },
      { retries: 1 }
    );
    const next = Number(rows?.[0]?.lastValue ?? 0);
    if (!Number.isInteger(next) || next < 1) {
      throw new ConflictException('Could not allocate a UHID');
    }
    return next;
  }

  /** Readable clinic prefix from the clinic's own code, falling back to its id. */
  private async resolveClinicCode(clinicId: string): Promise<string> {
    const clinic = await this.database.executeHealthcareRead<{ clinicId?: string | null } | null>(
      async client => {
        const tc = client as unknown as PrismaTransactionClientWithDelegates;
        return (await tc.clinic.findUnique({
          where: { id: clinicId } as PrismaDelegateArgs,
          select: { clinicId: true } as PrismaDelegateArgs,
        } as PrismaDelegateArgs)) as unknown as { clinicId?: string | null } | null;
      }
    );
    return normaliseClinicCode(clinic?.clinicId?.trim() || clinicId);
  }
}
