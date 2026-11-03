/**
 * Background token / live-queue work of the in-person flow (product decision: token ALLOCATION
 * stays in the API's check-in transaction; this runs in the separate worker, where the crons fire
 * - the API registers ScheduleModule with `cronJobs: false`).
 *
 *   - every 5 min: rebuild + consistency check of every live queue of the day (per clinic with
 *     arrivals, all its locations), reusing the live-queue rebuild rules;
 *   - daily: delete `location_token_counters` rows older than 30 days (one row per location/day);
 *   - every minute: safety net of the "2 ahead" / "you're next" alerts (QueuePatientAlertService,
 *     normally fired by the queue mutation itself; the shared per appointment + threshold keys
 *     keep it to one message whoever runs first).
 *
 * Every cron takes the distributed cron lock first (one replica per tick; the lock is not released
 * and expires just before the next tick). None of it touches the API request path.
 */
import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging';
import { AppointmentQueueService } from '@infrastructure/queue';
import { supportsRawSql } from '@infrastructure/queue/src/services/location-token.allocator';
import { LogLevel, LogType } from '@core/types';
import { endOfIstDay, startOfIstDay } from '@utils/clock.util';
import { formatDateKeyInIST } from '@utils/date-time.util';
import { resolveClinicVisitDurations } from '@utils/visit-duration.util';
import { QueuePatientAlertService } from '@services/appointments/in-person/queue-patient-alert.service';
import { clinicIdsFromQueueKeys } from '@services/appointments/in-person/queue-maintenance.util';

const SOURCE = 'InPersonQueueMaintenanceService';
/** Token counter rows (one per location/day) are kept this many days. */
export const TOKEN_COUNTER_RETENTION_DAYS = 30;
const LIVE_STATUSES = ['CONFIRMED', 'IN_PROGRESS'];

export const QUEUE_MAINTENANCE_LOCKS = {
  reconcile: { key: 'lock:cron:in-person:live-queue-reconcile', ttlSeconds: 240 },
  counters: { key: 'lock:cron:in-person:token-counter-cleanup', ttlSeconds: 3000 },
  notify: { key: 'lock:cron:in-person:queue-position-notify', ttlSeconds: 50 },
} as const;

/** Deletes the old counter rows and answers how many went (raw: the table has no Prisma model). */
export const DELETE_OLD_TOKEN_COUNTERS_SQL = `
  WITH deleted AS (
    DELETE FROM "location_token_counters"
     WHERE "day" < (CURRENT_DATE - $1::int)
    RETURNING 1
  )
  SELECT count(*)::int AS "deleted" FROM deleted`;

interface ActiveClinicRow {
  clinicId: string;
  locationId: string | null;
}

@Injectable()
export class InPersonQueueMaintenanceService {
  constructor(
    @Inject(forwardRef(() => DatabaseService))
    private readonly database: DatabaseService,
    @Inject(forwardRef(() => CacheService))
    private readonly cache: CacheService,
    @Inject(forwardRef(() => LoggingService))
    private readonly logging: LoggingService,
    @Inject(forwardRef(() => AppointmentQueueService))
    private readonly queue: AppointmentQueueService,
    @Inject(forwardRef(() => QueuePatientAlertService))
    private readonly alerts: QueuePatientAlertService
  ) {}

  // ------------------------------------------------------------------ crons

  @Cron(CronExpression.EVERY_5_MINUTES)
  async reconcileLiveQueuesCron(): Promise<void> {
    if (!(await this.acquire(QUEUE_MAINTENANCE_LOCKS.reconcile))) return;
    await this.reconcileLiveQueues();
  }

  @Cron('15 3 * * *')
  async cleanupTokenCountersCron(): Promise<void> {
    if (!(await this.acquire(QUEUE_MAINTENANCE_LOCKS.counters))) return;
    await this.cleanupTokenCounters();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async notifyQueuePositionsCron(): Promise<void> {
    if (!(await this.acquire(QUEUE_MAINTENANCE_LOCKS.notify))) return;
    await this.notifyQueuePositions();
  }

  // ------------------------------------------------------------------ jobs

  /** Rebuild + consistency check of today's live queues, per clinic (all active locations). */
  async reconcileLiveQueues(now: Date = new Date()): Promise<{
    clinics: number;
    locations: number;
    added: number;
    removed: number;
    updated: number;
  }> {
    const totals = { clinics: 0, locations: 0, added: 0, removed: 0, updated: 0 };
    try {
      const day = formatDateKeyInIST(now);
      const active = await this.activeClinicLocations(day);
      const byClinic = new Map<string, Set<string>>();
      for (const row of active) {
        const set = byClinic.get(row.clinicId) ?? new Set<string>();
        if (row.locationId) set.add(row.locationId);
        byClinic.set(row.clinicId, set);
      }
      // A clinic with a live list but no live arrival left (every visit finished, or the
      // appointment behind an entry was deleted) is reconciled too, so its orphans are dropped.
      for (const clinicId of await this.clinicsWithLiveLists(day)) {
        if (!byClinic.has(clinicId)) byClinic.set(clinicId, new Set<string>());
      }
      for (const [clinicId, locations] of byClinic) {
        const result = await this.queue.reconcileLiveQueue(clinicId, 'clinic', day);
        totals.clinics += 1;
        totals.locations += locations.size;
        totals.added += result.added;
        totals.removed += result.removed;
        totals.updated += result.updated;
      }
      void this.logging.log(
        LogType.APPOINTMENT,
        totals.added + totals.removed + totals.updated > 0 ? LogLevel.WARN : LogLevel.INFO,
        'Live queue consistency check finished',
        SOURCE,
        { date: day, ...totals }
      );
    } catch (error) {
      this.logFailure('Live queue consistency check failed', error);
    }
    return totals;
  }

  /** Deletes token counter rows older than TOKEN_COUNTER_RETENTION_DAYS. */
  async cleanupTokenCounters(): Promise<number> {
    try {
      const deleted = await this.database.executeInTransaction(async client => {
        if (!supportsRawSql(client)) return 0;
        const [row] = await client.$queryRawUnsafe<Array<{ deleted: number }>>(
          DELETE_OLD_TOKEN_COUNTERS_SQL,
          TOKEN_COUNTER_RETENTION_DAYS
        );
        return Number(row?.deleted ?? 0);
      });
      void this.logging.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Old location token counters deleted',
        SOURCE,
        { deleted, retentionDays: TOKEN_COUNTER_RETENTION_DAYS }
      );
      return deleted;
    } catch (error) {
      this.logFailure('Token counter cleanup failed', error);
      return 0;
    }
  }

  /** Safety net: "2 ahead" / "you're next" still due on every live queue today. */
  async notifyQueuePositions(now: Date = new Date()): Promise<number> {
    let sent = 0;
    try {
      const day = formatDateKeyInIST(now);
      const clinicIds = [...new Set((await this.activeClinicLocations(day)).map(r => r.clinicId))];
      for (const clinicId of clinicIds) {
        const entries = await this.queue.getClinicQueue(clinicId, day, 'clinic');
        const minutes = await this.inPersonMinutes(clinicId);
        sent += await this.alerts.alertEntries(clinicId, entries, now, minutes);
      }
    } catch (error) {
      this.logFailure('Queue position notifications failed', error);
    }
    return sent;
  }

  // ------------------------------------------------------------------ helpers

  private async acquire(lock: { key: string; ttlSeconds: number }): Promise<boolean> {
    try {
      const acquired = await this.cache.acquireLock(lock.key, lock.ttlSeconds);
      if (!acquired) {
        void this.logging.log(
          LogType.SYSTEM,
          LogLevel.DEBUG,
          'Cron run skipped: its lock is held by another replica',
          SOURCE,
          { lockKey: lock.key }
        );
      }
      return acquired;
    } catch {
      return false;
    }
  }

  /** Clinics that hold a live doctor list of the day in the cache (never throws). */
  private async clinicsWithLiveLists(day: string): Promise<string[]> {
    try {
      return clinicIdsFromQueueKeys(await this.cache.keys(`queue:clinic:*:${day}`), day);
    } catch {
      return [];
    }
  }

  /** Clinics / locations with in-person arrivals still live today (one bounded, indexed read). */
  private async activeClinicLocations(day: string): Promise<ActiveClinicRow[]> {
    const from = startOfIstDay(day);
    const to = endOfIstDay(day);
    if (!from || !to) return [];
    return await this.database.executeHealthcareRead(async client =>
      (
        client as unknown as {
          appointment: { findMany: (args: unknown) => Promise<ActiveClinicRow[]> };
        }
      ).appointment.findMany({
        where: {
          type: { not: 'VIDEO_CALL' },
          status: { in: LIVE_STATUSES },
          checkedInAt: { gte: from, lte: to },
        },
        select: { clinicId: true, locationId: true },
        distinct: ['clinicId', 'locationId'],
        take: 1000,
      })
    );
  }

  private async inPersonMinutes(clinicId: string): Promise<number> {
    try {
      const clinic = await this.database.executeHealthcareRead(async client =>
        (
          client as unknown as {
            clinic: { findUnique: (args: unknown) => Promise<{ settings?: unknown } | null> };
          }
        ).clinic.findUnique({ where: { id: clinicId }, select: { settings: true } })
      );
      return resolveClinicVisitDurations(clinic?.settings).inPersonMinutes;
    } catch {
      return resolveClinicVisitDurations(undefined).inPersonMinutes;
    }
  }

  private logFailure(message: string, error: unknown): void {
    void this.logging.log(
      LogType.ERROR,
      LogLevel.WARN,
      `${message}: ${error instanceof Error ? error.message : String(error)}`,
      SOURCE,
      { error: error instanceof Error ? error.stack : undefined }
    );
  }
}
