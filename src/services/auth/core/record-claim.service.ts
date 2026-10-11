import { HttpStatus, Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { HealthcareError } from '@core/errors/healthcare-error.class';
import { normalizeAuthPhoneNumber } from './phone-normalizer.util';
import { candidatesMatchingName, isForeignKeyOrUniqueViolation } from './record-claim.util';
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
   WHERE id = $3::text AND role::text = 'PATIENT' AND "isActive" = true
     AND phone IS NULL AND email IS NULL AND password IS NULL
     AND "lastLogin" IS NULL AND "deletedAt" IS NULL
     FOR UPDATE
),
caller_guard AS (
  SELECT id FROM "users"
   WHERE id = $1::text AND role::text = 'PATIENT' AND "deletedAt" IS NULL AND phone = $5::text
     FOR UPDATE
),
ok AS (
  SELECT 1 FROM guard, caller_guard
   WHERE NOT EXISTS (SELECT 1 FROM "patient_visits" WHERE "patientId" = $2::text)
     AND NOT EXISTS (SELECT 1 FROM "patient_documents" WHERE "patientId" = $2::text)
     AND NOT EXISTS (SELECT 1 FROM "ayurvedic_diagnoses" WHERE "patientId" = $2::text)
     AND NOT EXISTS (SELECT 1 FROM "patient_identifiers" WHERE "patientId" = $2::text)
     AND NOT EXISTS (SELECT 1 FROM "patient_consents" WHERE "patientId" = $2::text)
     AND NOT EXISTS (SELECT 1 FROM "family_members" WHERE "patientId" = $2::text AND "deletedAt" IS NULL)
     AND NOT EXISTS (SELECT 1 FROM "Invoice" WHERE "userId" = $1::text)
),
del_contacts AS (
  DELETE FROM "patient_contact_points"
   WHERE "patientId" = $2::text AND EXISTS (SELECT 1 FROM ok) RETURNING 1
),
del_patient AS (
  DELETE FROM "Patient"
   WHERE id = $2::text AND EXISTS (SELECT 1 FROM ok) RETURNING 1
),
free_caller AS (
  UPDATE "users"
     SET phone = NULL, email = NULL, "googleId" = NULL, "isActive" = false,
         "deletedAt" = NOW(), "updatedAt" = NOW()
   WHERE id = $1::text AND "deletedAt" IS NULL AND EXISTS (SELECT 1 FROM ok) RETURNING id
),
claim_user AS (
  UPDATE "users"
     SET phone = $5::text, "phoneVerified" = true, "phoneVerifiedAt" = NOW(), "isVerified" = true,
         email = COALESCE(email, $6::text), "googleId" = COALESCE("googleId", $7::text),
         password = COALESCE(password, (SELECT password FROM "users" WHERE id = $1::text)),
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
  SELECT gen_random_uuid()::text, $1::text, 'PHI_UPDATE', 'UPDATE PATIENT_RECORD_CLAIM (SUCCESS)',
         $8::text, 'PATIENT_RECORD_CLAIM', $4::text, $9::text, $10::text,
         jsonb_build_object('patientId', $4::text, 'recordUserId', $3::text,
                            'purpose', 'patient claimed an imported record'), NOW()
   WHERE EXISTS (SELECT 1 FROM claim_user) RETURNING 1
)
SELECT (SELECT count(*) FROM claim_user)::int AS claimed
`;

const CALLER_SQL = `SELECT id, role::text AS role, phone, "phoneVerified", email, "googleId", "primaryClinicId"
   FROM "users" WHERE id = $1::text AND "deletedAt" IS NULL`;

/**
 * Lets a patient who has just signed in by one-time code take over the record the clinic imported
 * from its old register, instead of ending up with a second, empty account next to it.
 *
 * Safety rules:
 *  - only a record whose contact number is the caller's OTP-verified number is considered;
 *  - the caller must ALSO give the UHID or old patient number of that record (printed on a receipt or
 *    card): a name alone is known to relatives who share the number, so it is never enough;
 *  - the typed name must match the record's name (see namesMatch), and exactly one record may match;
 *  - the record must be an unclaimed, active patient (no phone, e-mail, password or sign-in);
 *  - the caller's own, new account must be empty (no visits, documents, diagnoses, UHID, consents,
 *    dependents or invoices; a foreign key from any related row refuses the delete). These checks are
 *    part of the single merge statement, so nothing can slip in between check and merge;
 *  - "no match" and "more than one match" give the same answer, every failed attempt is logged as a
 *    security event, and the routes are rate limited.
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
      const rows = await tx.$queryRawUnsafe<CallerRow[]>(CALLER_SQL, userId);
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
            AND u.id <> $3::text AND u.role::text = 'PATIENT' AND u."isActive" = true
            AND u.phone IS NULL AND u.email IS NULL AND u.password IS NULL
            AND u."lastLogin" IS NULL AND u."deletedAt" IS NULL`,
        caller.primaryClinicId,
        normalizeAuthPhoneNumber(caller.phone),
        caller.id
      );
      return Number(counted[0]?.available ?? 0);
    });
  }

  async claim(input: RecordClaimInput, actor: RecordClaimActor): Promise<RecordClaimResult> {
    try {
      this.requireSecondSecret(input);
      // A refusal is an expected answer, not a database failure: it is carried out of the read as a
      // value so the database layer does not log it as an error (and Sentry does not open an issue).
      const outcome = await this.database.executeHealthcareRead(
        async (client): Promise<{ plan: ClaimPlan } | { refusal: HealthcareError }> => {
          try {
            const tx = client as unknown as RawTx;
            const caller = await this.loadCaller(tx, actor.userId);
            const phone = normalizeAuthPhoneNumber(caller.phone as string);
            const clinicId = caller.primaryClinicId as string;
            const candidate = await this.findSingleCandidate(tx, input, phone, clinicId, caller.id);
            const callerPatientId = await this.loadOwnPatientId(tx, caller.id);
            return { plan: { caller, phone, clinicId, candidate, callerPatientId } };
          } catch (error) {
            if (error instanceof HealthcareError) return { refusal: error };
            throw error;
          }
        }
      );
      if ('refusal' in outcome) throw outcome.refusal;
      const { plan } = outcome;

      await this.merge(plan, actor);
      await this.dropCaches(plan);
      void this.logger.log(LogType.AUDIT, LogLevel.INFO, 'Imported record claimed', CONTEXT, {
        patientId: plan.candidate.patientId,
      });
      return { claimed: true, requiresSignIn: true };
    } catch (error) {
      // A failed claim is a security-relevant event (name or number guessing): never silent.
      void this.logger.log(LogType.SECURITY, LogLevel.WARN, 'Record claim refused', CONTEXT, {
        userId: actor.userId,
        reason: error instanceof HealthcareError ? error.message : 'unexpected error',
      });
      throw error;
    }
  }

  /** The UHID or the old patient number: something printed for the patient, not just a name. */
  private requireSecondSecret(input: RecordClaimInput): void {
    if (!input.uhid?.trim() && !input.legacyRegistration?.trim()) {
      throw fail(
        ErrorCode.VALIDATION_ERROR,
        'Enter the UHID or the old patient number printed on your clinic receipt or card',
        HttpStatus.BAD_REQUEST
      );
    }
  }

  /**
   * The whole merge is ONE statement, so it either happens completely or not at all (a statement
   * with data-modifying CTEs is atomic, unlike a callback of separate queries):
   *  - `guard` and `caller_guard` lock both users while the checks hold; a second claim of the
   *    same record waits, then finds it claimed and does nothing;
   *  - `ok` is the emptiness check of the caller's new account, made in the same snapshot;
   *  - the caller's empty patient row is deleted (a foreign key from any related row aborts it all);
   *  - the caller's account gives up its unique phone / e-mail / Google id and is soft-deleted;
   *  - only after that does the imported user take them (a data dependency orders the two updates,
   *    so the unique indexes never see the same value twice).
   * No retry: a repeated attempt after a commit would report "already claimed" for a success.
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
          userId: caller.id,
          clinicId,
          resourceType: 'PATIENT_RECORD_CLAIM',
          operation: 'UPDATE',
          resourceId: candidate.patientId,
          userRole: 'PATIENT',
        },
        { retries: 1 }
      );
    } catch (error) {
      // A related row (appointment, prescription...) refuses the delete, or a parallel claim already
      // took the number: either way the clinic desk resolves it.
      if (isForeignKeyOrUniqueViolation(error)) throw this.cannotMerge();
      throw error;
    }
    if (claimed === 0) throw this.cannotMerge();
  }

  /** User and patient lookups are cached: drop both users so the next sign-in sees the merge. */
  private async dropCaches(plan: ClaimPlan): Promise<void> {
    const { caller, clinicId, candidate } = plan;
    await Promise.allSettled([
      this.database.invalidateEntityCache('User', caller.id, clinicId),
      this.database.invalidateEntityCache('User', candidate.userId, clinicId),
      this.database.invalidateEntityCache('Patient', candidate.patientId, clinicId),
    ]);
  }

  private async loadCaller(tx: RawTx, userId: string): Promise<CallerRow> {
    const rows = await tx.$queryRawUnsafe<CallerRow[]>(CALLER_SQL, userId);
    const caller = rows[0];
    if (!caller || caller.role !== 'PATIENT') {
      throw fail(
        ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS,
        'Only a patient can claim a record',
        HttpStatus.FORBIDDEN
      );
    }
    if (!caller.phone || !caller.phoneVerified) {
      throw fail(
        ErrorCode.VALIDATION_ERROR,
        'Verify your mobile number first, then claim your record',
        HttpStatus.BAD_REQUEST
      );
    }
    if (!caller.primaryClinicId) {
      throw fail(
        ErrorCode.VALIDATION_ERROR,
        'Choose your clinic first, then claim your record',
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
    const system = input.uhid?.trim() ? 'UHID' : 'LEGACY_REGISTRATION';
    const raw = (input.uhid?.trim() || input.legacyRegistration?.trim() || '').trim();
    const value = system === 'UHID' ? raw.toUpperCase() : raw;
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
          AND u.id <> $3::text AND u.role::text = 'PATIENT' AND u."isActive" = true
          AND u.phone IS NULL AND u.email IS NULL AND u.password IS NULL
          AND u."lastLogin" IS NULL AND u."deletedAt" IS NULL
          AND EXISTS (SELECT 1 FROM "patient_identifiers" i
                       WHERE i."patientId" = p.id AND i."clinicId" = $1::text
                         AND i.system = $4::text AND i.value = $5::text)
        LIMIT 50`,
      clinicId,
      phone,
      callerUserId,
      system,
      value
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
    // One answer for "nothing matches" and "several match": a caller learns nothing about who is on file.
    if (matches.length !== 1) {
      throw fail(
        ErrorCode.PATIENT_NOT_FOUND,
        'No record could be linked with those details. Ask the clinic desk.',
        HttpStatus.NOT_FOUND
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

  private cannotMerge(): HealthcareError {
    return fail(
      ErrorCode.PATIENT_IDENTIFIER_CONFLICT,
      'Your records could not be merged automatically. Ask the clinic desk to link them.',
      HttpStatus.CONFLICT
    );
  }
}
