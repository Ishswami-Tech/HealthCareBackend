import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';
import { Role } from '@core/types/enums.types';
import { CONSENT_PURPOSES } from '@core/types/compliance.types';
import type {
  ConsentCaptureChannel,
  ConsentPurpose,
  ConsentStatus,
  PatientConsentRecord,
} from '@core/types/compliance.types';
import type {
  PrismaDelegateArgs,
  PrismaTransactionClientWithDelegates,
} from '@core/types/prisma.types';
import type {
  PatientConsentStateResponse,
  RecordConsentDto,
} from '@services/compliance/dto/consent.dto';
import { CompliancePatientAccess } from '@services/compliance/services/compliance-patient-access.service';
import { PhiAuditService } from '@services/compliance/services/phi-audit.service';
import { resolveCurrentConsents } from '@services/compliance/utils/consent.util';
import {
  evidenceIsRequired,
  validateConsentEvidence,
} from '@services/compliance/utils/consent-evidence.util';
import type { ConsentEvidence } from '@services/compliance/utils/consent-evidence.util';
import { isUniqueViolation } from '@services/compliance/utils/db-errors.util';
import { complianceErrors } from '@services/compliance/utils/compliance-errors.util';

export interface ConsentActor {
  readonly userId: string;
  readonly role: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

interface ConsentRow {
  id: string;
  patientId: string;
  clinicId: string;
  purpose: string;
  version: number;
  noticeVersion: string;
  language: string | null;
  status: string;
  recordedBy: string;
  capturedVia: string;
  evidence: Record<string, string | number | boolean | null> | null;
  recordedAt: Date;
}

type ConsentClient = PrismaTransactionClientWithDelegates & {
  patientConsent: {
    create: (args: PrismaDelegateArgs) => Promise<ConsentRow>;
    findFirst: (args: PrismaDelegateArgs) => Promise<ConsentRow | null>;
    findMany: (args: PrismaDelegateArgs) => Promise<ConsentRow[]>;
  };
};

const PATIENT_ROLE: string = Role.PATIENT;
const AUDIT_PURPOSE = 'consent management';

function isConsentPurpose(value: string): value is ConsentPurpose {
  return (CONSENT_PURPOSES as readonly string[]).includes(value);
}

function toRecord(row: ConsentRow): PatientConsentRecord {
  if (!isConsentPurpose(row.purpose)) {
    throw complianceErrors.invalid(`Unknown consent purpose stored on row ${row.id}`);
  }
  return {
    id: row.id,
    patientId: row.patientId,
    clinicId: row.clinicId,
    purpose: row.purpose,
    noticeVersion: row.noticeVersion,
    language: row.language,
    status: row.status as ConsentStatus,
    recordedBy: row.recordedBy,
    capturedVia: row.capturedVia as ConsentCaptureChannel,
    evidence: row.evidence && typeof row.evidence === 'object' ? row.evidence : null,
    recordedAt: row.recordedAt,
  };
}

/**
 * Append-only patient consent ledger (DPDP Act 2023). Rows are only ever inserted; the newest
 * row per purpose is the current state.
 */
@Injectable()
export class ConsentService {
  private readonly serviceName = 'ConsentService';

  constructor(
    private readonly database: DatabaseService,
    private readonly logger: LoggingService,
    private readonly phiAudit: PhiAuditService,
    private readonly access: CompliancePatientAccess
  ) {}

  async record(
    dto: RecordConsentDto,
    clinicId: string,
    actor: ConsentActor
  ): Promise<PatientConsentRecord> {
    const patient = await this.access.require(dto.patientId, clinicId, actor);
    const isPatientCaller = actor.role === PATIENT_ROLE;
    const capturedVia: ConsentCaptureChannel = isPatientCaller ? 'SELF' : 'STAFF';
    const evidence = validateConsentEvidence(dto.evidence);
    if (!evidence.valid) {
      throw complianceErrors.invalid(evidence.reason);
    }
    if (evidenceIsRequired(dto.purpose, dto.status, capturedVia) && !evidence.value) {
      throw complianceErrors.invalid(
        "Recording this consent on the patient's behalf needs evidence, for example a signed form reference"
      );
    }

    const row = await this.writeNextVersion(
      dto,
      evidence.value,
      patient.id,
      clinicId,
      actor,
      capturedVia
    );

    await this.phiAudit.record({
      userId: actor.userId,
      userRole: actor.role,
      patientId: patient.id,
      clinicId,
      action: 'CREATE',
      resourceType: 'PATIENT_CONSENT',
      resourceId: row.id,
      purpose: AUDIT_PURPOSE,
      fields: ['purpose', 'status', 'noticeVersion'],
      ...(actor.ipAddress ? { ipAddress: actor.ipAddress } : {}),
      ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
    });
    void this.logger.log(
      LogType.AUDIT,
      LogLevel.INFO,
      'Patient consent recorded',
      this.serviceName,
      {
        consentId: row.id,
        clinicId,
        purpose: dto.purpose,
        status: dto.status,
        capturedVia,
      }
    );
    return toRecord(row);
  }

  async getForPatient(
    patientId: string,
    clinicId: string,
    actor: ConsentActor
  ): Promise<PatientConsentStateResponse> {
    const patient = await this.access.require(patientId, clinicId, actor);

    const rows = await this.database.executeHealthcareRead<ConsentRow[]>(async client => {
      const tc = client as unknown as ConsentClient;
      return tc.patientConsent.findMany({
        where: { patientId: patient.id, clinicId } as PrismaDelegateArgs,
        orderBy: [{ recordedAt: 'desc' }, { version: 'desc' }] as unknown as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
    const history = rows.map(toRecord);
    // History is newest first; resolve over oldest-first so equal timestamps favour the later row.
    const current = [...resolveCurrentConsents([...history].reverse()).values()];

    await this.phiAudit.record({
      userId: actor.userId,
      userRole: actor.role,
      patientId: patient.id,
      clinicId,
      action: 'VIEW',
      resourceType: 'PATIENT_CONSENT',
      resourceId: patient.id,
      purpose: AUDIT_PURPOSE,
      ...(actor.ipAddress ? { ipAddress: actor.ipAddress } : {}),
      ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
    });
    return { patientId: patient.id, current, history };
  }

  /**
   * Appends the next ledger row for (patient, clinic, purpose). The row's `version` is one above
   * the newest; the unique index on (patient, clinic, purpose, version) turns two concurrent
   * writers into one success and one 409, so a grant can never be withdrawn twice.
   *
   * Business rules are checked BEFORE the write: DatabaseService rewraps anything thrown inside a
   * write callback as a generic 500, which would turn a 400 into a server error. The write runs
   * once (`retries: 1`) so a dropped acknowledgement cannot append a duplicate row.
   */
  private async writeNextVersion(
    dto: RecordConsentDto,
    evidence: ConsentEvidence | undefined,
    patientId: string,
    clinicId: string,
    actor: ConsentActor,
    capturedVia: ConsentCaptureChannel
  ): Promise<ConsentRow> {
    const latest = await this.database.executeHealthcareRead<ConsentRow | null>(async client => {
      const tc = client as unknown as ConsentClient;
      return tc.patientConsent.findFirst({
        where: { patientId, clinicId, purpose: dto.purpose } as PrismaDelegateArgs,
        orderBy: { version: 'desc' } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
    if (dto.status === 'WITHDRAWN' && latest?.status !== 'GRANTED') {
      throw complianceErrors.invalid(
        `Cannot withdraw consent for ${dto.purpose}: no active grant exists`
      );
    }

    try {
      return await this.database.executeHealthcareWrite<ConsentRow>(
        async client => {
          const tc = client as unknown as ConsentClient;
          return tc.patientConsent.create({
            data: {
              patientId,
              clinicId,
              purpose: dto.purpose,
              version: (latest?.version ?? 0) + 1,
              noticeVersion: dto.noticeVersion,
              language: dto.language ?? null,
              status: dto.status,
              recordedBy: actor.userId,
              capturedVia,
              ...(evidence ? { evidence } : {}),
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        {
          userId: actor.userId,
          userRole: actor.role,
          clinicId,
          operation: 'CREATE',
          resourceType: 'PATIENT_CONSENT',
          resourceId: patientId,
          skipCacheInvalidation: true,
        },
        { retries: 1 }
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw complianceErrors.consentConflict(
          'Consent was changed by another request. Reload and try again.'
        );
      }
      throw error;
    }
  }
}
