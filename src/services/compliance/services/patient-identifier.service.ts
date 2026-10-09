import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';
import { PATIENT_IDENTIFIER_SYSTEMS } from '@core/types/compliance.types';
import type {
  PatientIdentifierRecord,
  PatientIdentifierSystem,
} from '@core/types/compliance.types';
import type {
  PrismaDelegateArgs,
  PrismaTransactionClientWithDelegates,
} from '@core/types/prisma.types';
import { CompliancePatientAccess } from '@services/compliance/services/compliance-patient-access.service';
import { PhiAuditService } from '@services/compliance/services/phi-audit.service';
import { isUniqueViolation } from '@services/compliance/utils/db-errors.util';
import { validateAndNormaliseIdentifier } from '@services/compliance/utils/patient-identifier.validator';

export interface IdentifierActor {
  readonly userId: string;
  readonly role: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

export interface SetIdentifierInput {
  patientId: string;
  clinicId: string;
  system: PatientIdentifierSystem;
  value: string;
  source?: string;
  createdBy?: string;
}

interface IdentifierRow {
  id: string;
  patientId: string;
  clinicId: string;
  system: string;
  value: string;
  source: string;
  createdAt: Date;
}

type IdentifierClient = PrismaTransactionClientWithDelegates & {
  patientIdentifier: {
    findMany: (args: PrismaDelegateArgs) => Promise<IdentifierRow[]>;
    findFirst: (args: PrismaDelegateArgs) => Promise<IdentifierRow | null>;
    upsert: (args: PrismaDelegateArgs) => Promise<IdentifierRow>;
    create: (args: PrismaDelegateArgs) => Promise<IdentifierRow>;
  };
};

const DEFAULT_SOURCE = 'MANUAL';
const AUDIT_PURPOSE = 'patient identification';

function isSystem(value: string): value is PatientIdentifierSystem {
  return (PATIENT_IDENTIFIER_SYSTEMS as readonly string[]).includes(value);
}

function toRecord(row: IdentifierRow): PatientIdentifierRecord {
  if (!isSystem(row.system)) {
    throw new BadRequestException(`Unknown identifier system stored on row ${row.id}`);
  }
  return {
    id: row.id,
    patientId: row.patientId,
    clinicId: row.clinicId,
    system: row.system,
    value: row.value,
    source: row.source,
    createdAt: row.createdAt,
  };
}

/**
 * Business identifiers of a patient inside one clinic (UHID, ABHA number/address, legacy
 * registration numbers).
 *
 * Uniqueness: a value can identify only one patient per clinic and system (409 otherwise), and a
 * patient has at most one value per system per clinic. Setting a second value for the same system
 * REPLACES the first (upsert on [patientId, clinicId, system]) rather than failing, so a corrected
 * UHID or a re-linked ABHA number needs no separate "update" endpoint.
 */
@Injectable()
export class PatientIdentifierService {
  private readonly serviceName = 'PatientIdentifierService';

  constructor(
    private readonly database: DatabaseService,
    private readonly logger: LoggingService,
    private readonly phiAudit: PhiAuditService,
    private readonly access: CompliancePatientAccess
  ) {}

  async listForPatient(patientId: string, clinicId: string): Promise<PatientIdentifierRecord[]> {
    const rows = await this.database.executeHealthcareRead<IdentifierRow[]>(async client => {
      const tc = client as unknown as IdentifierClient;
      return tc.patientIdentifier.findMany({
        where: { patientId, clinicId } as PrismaDelegateArgs,
        orderBy: { createdAt: 'asc' } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
    return rows.map(toRecord);
  }

  async findPatientIdByIdentifier(
    clinicId: string,
    system: PatientIdentifierSystem,
    value: string
  ): Promise<string | null> {
    const normalised = validateAndNormaliseIdentifier(system, value);
    if (!normalised.valid) {
      return null;
    }
    const row = await this.database.executeHealthcareRead<IdentifierRow | null>(async client => {
      const tc = client as unknown as IdentifierClient;
      return tc.patientIdentifier.findFirst({
        where: { clinicId, system, value: normalised.value } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
    return row?.patientId ?? null;
  }

  async setIdentifier(input: SetIdentifierInput): Promise<PatientIdentifierRecord> {
    if (input.system === 'UHID') {
      throw new BadRequestException('A UHID is never replaced: it is issued once (createUhid)');
    }
    const normalised = validateAndNormaliseIdentifier(input.system, input.value);
    if (!normalised.valid) {
      throw new BadRequestException(normalised.reason);
    }
    const { patientId, clinicId, system } = input;
    const value = normalised.value;

    const holderId = await this.findPatientIdByIdentifier(clinicId, system, value);
    if (holderId && holderId !== patientId) {
      throw new ConflictException(
        `${system} is already assigned to another patient in this clinic`
      );
    }

    const source = input.source ?? DEFAULT_SOURCE;
    try {
      const row = await this.database.executeHealthcareWrite<IdentifierRow>(
        async client => {
          const tc = client as unknown as IdentifierClient;
          return tc.patientIdentifier.upsert({
            where: {
              patientId_clinicId_system: { patientId, clinicId, system },
            } as PrismaDelegateArgs,
            create: {
              patientId,
              clinicId,
              system,
              value,
              source,
              createdBy: input.createdBy ?? null,
            } as PrismaDelegateArgs,
            update: { value, source } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        {
          userId: input.createdBy ?? 'system',
          clinicId,
          operation: 'UPDATE',
          resourceType: 'PATIENT_IDENTIFIER',
          resourceId: patientId,
          userRole: 'system',
          skipCacheInvalidation: true,
        }
      );
      void this.logger.log(
        LogType.AUDIT,
        LogLevel.INFO,
        'Patient identifier set',
        this.serviceName,
        { clinicId, patientId, system, source }
      );
      return toRecord(row);
    } catch (error) {
      // Lost a race against another writer of the same [clinicId, system, value].
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          `${system} is already assigned to another patient in this clinic`
        );
      }
      throw error;
    }
  }

  /**
   * Records a UHID for a patient. Create-only: an upsert would let a concurrent registration
   * silently replace a UHID that was already issued (and possibly printed). If the patient already
   * has a UHID, theirs stands and is returned; if the NUMBER is taken by someone else the caller
   * gets a 409 and allocates another.
   */
  async createUhid(input: {
    patientId: string;
    clinicId: string;
    value: string;
    source?: string;
    createdBy?: string;
  }): Promise<PatientIdentifierRecord> {
    const normalised = validateAndNormaliseIdentifier('UHID', input.value);
    if (!normalised.valid) {
      throw new BadRequestException(normalised.reason);
    }
    const { patientId, clinicId } = input;
    try {
      const row = await this.database.executeHealthcareWrite<IdentifierRow>(
        async client => {
          const tc = client as unknown as IdentifierClient;
          return tc.patientIdentifier.create({
            data: {
              patientId,
              clinicId,
              system: 'UHID',
              value: normalised.value,
              source: input.source ?? DEFAULT_SOURCE,
              createdBy: input.createdBy ?? null,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        {
          userId: input.createdBy ?? 'system',
          clinicId,
          operation: 'CREATE',
          resourceType: 'PATIENT_IDENTIFIER',
          resourceId: patientId,
          userRole: 'system',
          skipCacheInvalidation: true,
        },
        { retries: 1 }
      );
      return toRecord(row);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = (await this.listForPatient(patientId, clinicId)).find(
        record => record.system === 'UHID'
      );
      if (existing) return existing;
      throw new ConflictException('This UHID is already assigned in this clinic');
    }
  }

  /** Controller entry: validates the patient and audits the write. */
  async setIdentifierForActor(
    patientId: string,
    system: PatientIdentifierSystem,
    value: string,
    clinicId: string,
    actor: IdentifierActor
  ): Promise<PatientIdentifierRecord> {
    if (system === 'UHID') {
      throw new BadRequestException(
        'UHIDs are issued by the system and cannot be entered by hand. Use POST /compliance/patient-identifiers/uhid.'
      );
    }
    const patient = await this.access.require(patientId, clinicId, actor);
    const previous = (await this.listForPatient(patient.id, clinicId)).find(
      existing => existing.system === system
    );
    const record = await this.setIdentifier({
      patientId: patient.id,
      clinicId,
      system,
      value,
      source: 'MANUAL',
      createdBy: actor.userId,
    });
    const replaced =
      previous && previous.value !== record.value
        ? `Replaced ${system} ending ${previous.value.slice(-4)}`
        : undefined;
    await this.audit(actor, patient.id, clinicId, 'CREATE', record.id, system, replaced);
    return record;
  }

  async listForActor(
    patientId: string,
    clinicId: string,
    actor: IdentifierActor
  ): Promise<PatientIdentifierRecord[]> {
    const patient = await this.access.require(patientId, clinicId, actor);
    const records = await this.listForPatient(patient.id, clinicId);
    await this.audit(actor, patient.id, clinicId, 'VIEW', patient.id);
    return records;
  }

  async lookupForActor(
    system: PatientIdentifierSystem,
    value: string,
    clinicId: string,
    actor: IdentifierActor
  ): Promise<string | null> {
    const patientId = await this.findPatientIdByIdentifier(clinicId, system, value);
    if (patientId) {
      await this.audit(actor, patientId, clinicId, 'VIEW', patientId, system);
    }
    return patientId;
  }

  private async audit(
    actor: IdentifierActor,
    patientId: string,
    clinicId: string,
    action: 'VIEW' | 'CREATE',
    resourceId: string,
    system?: PatientIdentifierSystem,
    reason?: string
  ): Promise<void> {
    await this.phiAudit.record({
      userId: actor.userId,
      userRole: actor.role,
      patientId,
      clinicId,
      action,
      resourceType: 'PATIENT_IDENTIFIER',
      resourceId,
      purpose: AUDIT_PURPOSE,
      ...(system ? { fields: [system] } : {}),
      ...(reason ? { reason } : {}),
      ...(actor.ipAddress ? { ipAddress: actor.ipAddress } : {}),
      ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
    });
  }
}
