import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';
import { UhidAllocatorService } from '@services/compliance/services/uhid-allocator.service';

/** Patients given a UHID per run, so one run stays short. */
export const UHID_BACKFILL_BATCH_SIZE = 100;
/** How often the sweep runs, and how long after start the first run is. */
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60 * 1000;
const LOCK_KEY = 'lock:cron:compliance:uhid-backfill';
/** Held just under the 5 minute schedule so two replicas do not both run a tick. */
const LOCK_TTL_SECONDS = 240;

interface PatientWithoutUhid {
  patient_id: string;
  clinic_id: string;
}

type RawClient = {
  $queryRawUnsafe: <T>(query: string, ...values: unknown[]) => Promise<T>;
};

/**
 * Gives every patient a UHID. A UHID is otherwise issued only when a visit is entered in the OPD
 * register, so patients who signed up in the app and booked online never got one and showed
 * without a clinic id in the doctor's list. This sweep issues them within minutes of signing up,
 * through the same allocator the register uses (one UHID per patient, never reused).
 */
@Injectable()
export class UhidBackfillService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly serviceName = 'UhidBackfillService';
  private timer: ReturnType<typeof setInterval> | null = null;
  private firstRun: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly cache: CacheService,
    private readonly allocator: UhidAllocatorService,
    private readonly logger: LoggingService
  ) {}

  /**
   * A timer, not @Cron: crons fire only in the worker process, which does not load this module.
   * The cache lock keeps several API instances from running the same tick.
   */
  onApplicationBootstrap(): void {
    this.firstRun = setTimeout(() => void this.issueMissingUhids(), FIRST_RUN_DELAY_MS);
    this.timer = setInterval(() => void this.issueMissingUhids(), SWEEP_INTERVAL_MS);
    this.firstRun.unref();
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.firstRun) clearTimeout(this.firstRun);
    if (this.timer) clearInterval(this.timer);
  }

  async issueMissingUhids(): Promise<number> {
    const acquired = await this.cache.acquireLock(LOCK_KEY, LOCK_TTL_SECONDS);
    if (!acquired) {
      return 0;
    }
    // The lock is not released: it expires just before the next tick.
    try {
      const patients = await this.findPatientsWithoutUhid();
      let issued = 0;
      for (const patient of patients) {
        try {
          await this.allocator.ensureUhid(patient.patient_id, patient.clinic_id, 'SYSTEM');
          issued += 1;
        } catch (error) {
          void this.logger.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Could not issue a UHID: ${error instanceof Error ? error.message : String(error)}`,
            this.serviceName,
            { patientId: patient.patient_id, clinicId: patient.clinic_id }
          );
        }
      }
      if (issued > 0) {
        void this.logger.log(
          LogType.AUDIT,
          LogLevel.INFO,
          'UHIDs issued by sweep',
          this.serviceName,
          {
            issued,
          }
        );
      }
      return issued;
    } catch (error) {
      void this.logger.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `UHID sweep failed: ${error instanceof Error ? error.message : String(error)}`,
        this.serviceName
      );
      return 0;
    }
  }

  private async findPatientsWithoutUhid(): Promise<PatientWithoutUhid[]> {
    return await this.database.executeHealthcareRead(async client => {
      const raw = client as unknown as RawClient;
      return await raw.$queryRawUnsafe<PatientWithoutUhid[]>(
        `SELECT p.id AS patient_id, u."primaryClinicId" AS clinic_id
           FROM "Patient" p
           JOIN "users" u ON u.id = p."userId"
          WHERE u."primaryClinicId" IS NOT NULL
            AND u."deletedAt" IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM "patient_identifiers" i
               WHERE i."patientId" = p.id AND i."clinicId" = u."primaryClinicId" AND i.system = 'UHID'
            )
          ORDER BY p."createdAt"
          LIMIT ${UHID_BACKFILL_BATCH_SIZE}`
      );
    });
  }
}
