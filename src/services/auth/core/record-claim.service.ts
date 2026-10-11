import { HttpStatus, Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { HealthcareError } from '@core/errors/healthcare-error.class';
import { normalizeAuthPhoneNumber } from './phone-normalizer.util';
import { candidatesMatchingName } from './record-claim.util';
import type { ClaimCandidate } from './record-claim.util';

const CONTEXT = 'RecordClaim';

/** Anything the old record is looked up by besides the proven phone number and the typed name. */
export interface RecordClaimInput {
  readonly fullName: string;
  readonly uhid?: string | undefined;
  readonly legacyRegistration?: string | undefined;
}

export interface RecordClaimActor {
  readonly userId: string;
  readonly ipAddress?: string | undefined;
  readonly userAgent?: string | undefined;
}

export interface RecordClaimResult {
  readonly claimed: true;
  /** The sessions of the account that was merged away are ended: the patient signs in again. */
  readonly requiresSignIn: true;
}

interface RawTx {
  $queryRawUnsafe: <T>(sql: string, ...values: unknown[]) => Promise<T>;
  $executeRawUnsafe: (sql: string, ...values: unknown[]) => Promise<number>;
}

interface CallerRow {
  id: string;
  role: string;
  phone: string | null;
  phoneVerified: boolean;
  email: string | null;
  googleId: string | null;
  primaryClinicId: string | null;
}

const fail = (code: ErrorCode, message: string, status: HttpStatus): HealthcareError =>
  new HealthcareError(code, message, status, undefined, CONTEXT);

interface ClaimPlan {
  readonly caller: CallerRow;
  readonly phone: string;
  readonly clinicId: string;
  readonly candidate: ClaimCandidate;
  readonly callerPatientId: string | null;
}

/** $1 caller user, $2 caller patient (nullable), $3 record user, $4 record patient, $5 phone,
 *  $6 caller e-mail, $7 caller Google id, $8 clinic, $9 ip, $10 user agent. */
const MERGE_SQL = `
WITH guard AS (
  SELECT id FROM "users"
   WHERE id = $3::text AND phone IS NULL AND email IS NULL AND password IS NULL
     AND "lastLogin" IS NULL AND "deletedAt" IS NULL
     FOR UPDATE
),
del_contacts AS (
  DELETE FROM "patient_contact_points"
   WHERE "patientId" = $2::text AND EXISTS (SELECT 1 FROM guard) RETURNING 1
),
del_patient AS (
  DELETE FROM "Patient"
   WHERE id = $2::text AND EXISTS (SELECT 1 FROM guard) RETURNING 1
),
free_caller AS (
  UPDATE "users"
     SET phone = NULL, email = NULL, "googleId" = NULL, "isActive" = false,
         "deletedAt" = NOW(), "updatedAt" = NOW()
   WHERE id = $1::text AND EXISTS (SELECT 1 FROM guard) RETURNING id
),
claim_user AS (
  UPDATE "users"
     SET phone = $5::text, "phoneVerified" = true, "phoneVerifiedAt" = NOW(), "isVerified" = true,
         email = COALESCE(email, $6::text), "googleId" = COALESCE("googleId", $7::text),
         "updatedAt" = NOW()
   WHERE id = $3::text AND EXISTS (SELECT 1 FROM free_caller) RETURNING id
),
verify_contact AS (
  UPDATE "patient_contact_points" SET "verifiedAt" = NOW(), "updatedAt" = NOW()
   WHERE "patientId" = $4::text AND "clinicId" = $8::text AND system = 'phone' AND value = $5::text
     AND EXISTS (SELECT 1 FROM claim_user) RETURNING 1
),
audit AS (
  INSERT INTO "AuditLog" (id, "userId", action, description, "clinicId", "resourceType",
                          "resourceId", "ipAddress", "userAgent", metadata, "updatedAt")
  SELECT gen_random_uuid()::text, $3::text, 'PHI_UPDATE', 'UPDATE PATIENT_RECORD_CLAIM (SUCCESS)',
         $8::text, 'PATIENT_RECORD_CLAIM', $4::text, $9::text, $10::text,
         jsonb_build_object('patientId', $4::text, 'mergedUserId', $1::text,
                            'purpose', 'patient claimed an imported record'), NOW()
   WHERE EXISTS (SELECT 1 FROM claim_user) RETURNING 1
)
SELECT (SELECT count(*) FROM claim_user)::int AS claimed
`;

/**
 * Lets a patient who has just signed in by one-time code take over the record the clinic imported
 * from its old register, instead of ending up with a second, empty account next to it.
 *
 * Safety rules:
 *  - only a record whose contact number is the caller's OTP-verified number is considered;
 *  - the typed name must match the record's name (see namesMatch), and exactly one record may match;
 *  - the record must be unclaimed (no phone, e-mail, password or sign-in);
 *  - the caller's own, new account must be empty: if the database refuses to delete its patient row
 *    or it already has visits, documents, diagnoses or identifiers, nothing is merged and the clinic
 *    desk resolves it;
 *  - the answers for "no match" and "more than one match" do not reveal who is on file.
 * Afterwards the caller signs in again and lands in the imported record.
 */
@Injectable()
export class RecordClaimService {
  constructor(
    private readonly database: DatabaseService,
    private readonly logger: LoggingService
  ) {}

  /**
   * How many unclaimed imported records hold the caller's verified number. Only a count: no names
   * or ids, so it cannot be used to learn who is on file.
   */
  async countAvailable(userId: string): Promise<number> {
    return this.database.executeHealthcareRead(async client => {
      const tx = client as unknown as RawTx;
      const rows = await tx.$queryRawUnsafe<CallerRow[]>(
        `SELECT id, role::text AS role, phone, "phoneVerified", email, "googleId", "primaryClinicId"
           FROM "users" WHERE id = $1::text AND "deletedAt" IS NULL`,
        userId
      );
      const caller = rows[0];
      if (
        !caller ||
        caller.role !== 'PATIENT' ||
        !caller.phone ||
        !caller.phoneVerified ||
        !caller.primaryClinicId
      ) {
        return 0;
      }
      const counted = await tx.$queryRawUnsafe<Array<{ available: number }>>(
        `SELECT count(DISTINCT p.id)::int AS available
           FROM "patient_contact_points" c
           JOIN "Patient" p ON p.id = c."patientId"
           JOIN "users" u ON u.id = p."userId"
          WHERE c."clinicId" = $1::text AND c.system = 'phone' AND c.value = $2::text
            AND u.id <> $3::text AND u.phone IS NULL AND u.email IS NULL AND u.password IS NULL
            AND u."lastLogin" IS NULL AND u."deletedAt" IS NULL`,
        caller.primaryClinicId,
        normalizeAuthPhoneNumber(caller.phone),
        caller.id
      );
      return Number(counted[0]?.available ?? 0);
    });
  }

  async claim(input: RecordClaimInput, actor: RecordClaimActor): Promise<RecordClaimResult> {
    const plan = await this.database.executeHealthcareRead(async client => {
      const tx = client as unknown as RawTx;
      const caller = await this.loadCaller(tx, actor.userId);
      const phone = normalizeAuthPhoneNumber(caller.phone as string);
      const clinicId = caller.primaryClinicId as string;
      const candidate = await this.findSingleCandidate(tx, input, phone, clinicId, caller.id);
      const callerPatientId = await this.loadOwnPatientId(tx, caller.id);
      await this.requireEmptyAccount(tx, callerPatientId, caller.id);
      return { caller, phone, clinicId, candidate, callerPatientId };
    });

    await this.merge(plan, actor);
    void this.logger.log(LogType.AUDIT, LogLevel.INFO, 'Imported record claimed', CONTEXT, {
      patientId: plan.candidate.patientId,
    });
    return { claimed: true, requiresSignIn: true };
  }

  /**
   * The whole merge is ONE statement, so it either happens completely or not at all (a statement
   * with data-modifying CTEs is atomic, unlike a callback of separate queries):
   *  - `guard` locks the imported user while it is still unclaimed; a second claim of the same
   *    record waits, then finds it claimed and does nothing;
   *  - the caller's empty patient row is deleted (a foreign key from any related row aborts it all);
   *  - the caller's account gives up its unique phone / e-mail / Google id and is soft-deleted;
   *  - only after that does the imported user take them (a data dependency orders the two updates,
   *    so the unique indexes never see the same value twice).
   */
  private async merge(plan: ClaimPlan, actor: RecordClaimActor): Promise<void> {
    const { caller, phone, clinicId, candidate, callerPatientId } = plan;
    const params = [
      caller.id,
      callerPatientId,
      candidate.userId,
      candidate.patientId,
      phone,
      caller.email,
      caller.googleId,
      clinicId,
      actor.ipAddress ?? null,
      actor.userAgent ? actor.userAgent.slice(0, 256) : null,
    ];
    let claimed: number;
    try {
      claimed = await this.database.executeHealthcareWrite(
        async client => {
          const rows = await (client as unknown as RawTx).$queryRawUnsafe<
            Array<{ claimed: number }>
          >(MERGE_SQL, ...params);
          return Number(rows[0]?.claimed ?? 0);
        },
        {
          userId: candidate.userId,
          clinicId,
          resourceType: 'PATIENT_RECORD_CLAIM',
          operation: 'UPDATE',
          resourceId: candidate.patientId,
          userRole: 'PATIENT',
          skipCacheInvalidation: true,
        }
      );
    } catch (error) {
      const text =
        error instanceof Error ? `${error.message} ${JSON.stringify(error)}` : String(error);
      // A related row (appointment, prescription...) refuses the delete: not an empty account.
      if (/foreign key|23503/i.test(text)) throw this.accountInUse();
      throw error;
    }
    if (claimed === 0) {
      throw fail(
        ErrorCode.PATIENT_IDENTIFIER_CONFLICT,
        'That record has just been claimed. Ask the clinic desk.',
        HttpStatus.CONFLICT
      );
    }
  }

  private async loadCaller(tx: RawTx, userId: string): Promise<CallerRow> {
    const rows = await tx.$queryRawUnsafe<CallerRow[]>(
      `SELECT id, role::text AS role, phone, "phoneVerified", email, "googleId", "primaryClinicId"
         FROM "users" WHERE id = $1::text AND "deletedAt" IS NULL`,
      userId
    );
    const caller = rows[0];
    if (!caller || caller.role !== 'PATIENT') {
      throw fail(
        ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS,
        'Only a patient can claim a record',
        HttpStatus.FORBIDDEN
      );
    }
    if (!caller.phone || !caller.phoneVerified || !caller.primaryClinicId) {
      throw fail(
        ErrorCode.VALIDATION_ERROR,
        'Verify your mobile number first, then claim your record',
        HttpStatus.BAD_REQUEST
      );
    }
    return caller;
  }

  private async findSingleCandidate(
    tx: RawTx,
    input: RecordClaimInput,
    phone: string,
    clinicId: string,
    callerUserId: string
  ): Promise<ClaimCandidate> {
    const params: unknown[] = [clinicId, phone, callerUserId];
    let identifierFilter = '';
    const system = input.uhid ? 'UHID' : input.legacyRegistration ? 'LEGACY_REGISTRATION' : null;
    const value = (input.uhid ?? input.legacyRegistration ?? '').trim();
    if (system && value) {
      params.push(system, system === 'UHID' ? value.toUpperCase() : value);
      identifierFilter = `AND EXISTS (SELECT 1 FROM "patient_identifiers" i
                                     WHERE i."patientId" = p.id AND i."clinicId" = $1::text
                                       AND i.system = $4::text AND i.value = $5::text)`;
    }
    const rows = await tx.$queryRawUnsafe<
      Array<{
        patient_id: string;
        user_id: string;
        name: string | null;
        first_name: string | null;
        last_name: string | null;
      }>
    >(
      `SELECT p.id AS patient_id, u.id AS user_id, u.name,
              u."firstName" AS first_name, u."lastName" AS last_name
         FROM "patient_contact_points" c
         JOIN "Patient" p ON p.id = c."patientId"
         JOIN "users" u ON u.id = p."userId"
        WHERE c."clinicId" = $1::text AND c.system = 'phone' AND c.value = $2::text
          AND u.id <> $3::text AND u.phone IS NULL AND u.email IS NULL AND u.password IS NULL
          AND u."lastLogin" IS NULL AND u."deletedAt" IS NULL
          ${identifierFilter}
        LIMIT 50`,
      ...params
    );
    const matches = candidatesMatchingName(
      input.fullName,
      rows.map(row => ({
        patientId: row.patient_id,
        userId: row.user_id,
        name: row.name,
        firstName: row.first_name,
        lastName: row.last_name,
      }))
    );
    if (matches.length === 0) {
      throw fail(
        ErrorCode.PATIENT_NOT_FOUND,
        'No record on file matches that name and your mobile number. Ask the clinic desk.',
        HttpStatus.NOT_FOUND
      );
    }
    if (matches.length > 1) {
      throw fail(
        ErrorCode.PATIENT_IDENTIFIER_CONFLICT,
        'More than one record matches. Ask the clinic desk to link yours.',
        HttpStatus.CONFLICT
      );
    }
    return matches[0] as ClaimCandidate;
  }

  private async loadOwnPatientId(tx: RawTx, userId: string): Promise<string | null> {
    const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "Patient" WHERE "userId" = $1::text LIMIT 1`,
      userId
    );
    return rows[0]?.id ?? null;
  }

  /** The new account must hold nothing yet: no visits, documents, diagnoses, UHID or consents. */
  private async requireEmptyAccount(
    tx: RawTx,
    patientId: string | null,
    userId: string
  ): Promise<void> {
    if (!patientId) return;
    const rows = await tx.$queryRawUnsafe<Array<{ used: number }>>(
      `SELECT ((SELECT count(*) FROM "patient_visits" WHERE "patientId" = $1::text)
             + (SELECT count(*) FROM "patient_documents" WHERE "patientId" = $1::text)
             + (SELECT count(*) FROM "ayurvedic_diagnoses" WHERE "patientId" = $1::text)
             + (SELECT count(*) FROM "patient_identifiers" WHERE "patientId" = $1::text)
             + (SELECT count(*) FROM "patient_consents" WHERE "patientId" = $1::text)
             + (SELECT count(*) FROM "Invoice" WHERE "userId" = $2::text))::int AS used`,
      patientId,
      userId
    );
    if ((rows[0]?.used ?? 0) > 0) throw this.accountInUse();
  }

  private accountInUse(): HealthcareError {
    return fail(
      ErrorCode.PATIENT_IDENTIFIER_CONFLICT,
      'Your new account already has activity, so it cannot be merged automatically. Ask the clinic desk.',
      HttpStatus.CONFLICT
    );
  }
}
