/**
 * Background token / live-queue work of the in-person flow (product decision: token ALLOCATION
 * stays in the API's check-in transaction; this runs in the separate worker, where the crons fire
 * - the API registers ScheduleModule with `cronJobs: false`).
 *
 *   - every 5 min: rebuild + consistency check of every live queue of the day (per clinic with
 *     arrivals, all its locations), reusing the live-queue rebuild rules;
 *   - daily: delete `location_token_counters` rows older than 30 days (one row per location/day);
 *   - every minute: "you're next" / "N ahead of you" to waiting patients (once per appointment and
 *     threshold, through the CommunicationService; a channel that is not configured just logs).
 *
 * Every cron takes the distributed cron lock first (one replica per tick; the lock is not released
 * and expires just before the next tick). None of it touches the API request path.
 */
import { Inject, Injectable, Optional, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging';
import { AppointmentQueueService } from '@infrastructure/queue';
import { supportsRawSql } from '@infrastructure/queue/src/services/location-token.allocator';
import { CommunicationService } from '@communication/communication.service';
import { LogLevel, LogType } from '@core/types';
import { CommunicationCategory, CommunicationPriority } from '@core/types/communication.types';
import { endOfIstDay, startOfIstDay } from '@utils/clock.util';
import { formatDateKeyInIST } from '@utils/date-time.util';
import { resolveClinicVisitDurations } from '@utils/visit-duration.util';
import {
  QUEUE_NOTIFY_DEBOUNCE_SECONDS,
  queueNotifyKey,
  queueNotifyMessage,
  selectQueueNotifications,
  type QueueNotification,
} from './queue-notify.util';
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

interface NotifyRecipientRow {
  id: string;
  clinicId: string;
  userId: string | null;
  patient: { user: { id: string; phone: string | null } | null } | null;
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
    @Optional()
    @Inject(forwardRef(() => CommunicationService))
    private readonly communication?: CommunicationService
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

  /** "You're next" / "N ahead" to the waiting patients of every live queue today. */
  async notifyQueuePositions(now: Date = new Date()): Promise<number> {
    let sent = 0;
    try {
      const day = formatDateKeyInIST(now);
      const clinicIds = [...new Set((await this.activeClinicLocations(day)).map(r => r.clinicId))];
      for (const clinicId of clinicIds) {
        const entries = await this.queue.getClinicQueue(clinicId, day, 'clinic');
        const minutes = await this.inPersonMinutes(clinicId);
        const due = selectQueueNotifications(entries, minutes);
        if (due.length === 0) continue;
        const recipients = await this.recipientsOf(due.map(item => item.appointmentId));
        for (const notification of due) {
          if (
            await this.notifyOnce(
              clinicId,
              notification,
              recipients.get(notification.appointmentId)
            )
          ) {
            sent += 1;
          }
        }
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

  /** The patient user (and phone) to notify, per appointment (one batched read). */
  private async recipientsOf(
    appointmentIds: readonly string[]
  ): Promise<Map<string, { userId: string; phone: string | null }>> {
    const rows = await this.database.executeHealthcareRead(async client =>
      (
        client as unknown as {
          appointment: { findMany: (args: unknown) => Promise<NotifyRecipientRow[]> };
        }
      ).appointment.findMany({
        where: { id: { in: [...new Set(appointmentIds)] } },
        select: {
          id: true,
          clinicId: true,
          userId: true,
          patient: { select: { user: { select: { id: true, phone: true } } } },
        },
      })
    );
    const recipients = new Map<string, { userId: string; phone: string | null }>();
    for (const row of rows) {
      const userId = row.patient?.user?.id || row.userId;
      if (userId) recipients.set(row.id, { userId, phone: row.patient?.user?.phone ?? null });
    }
    return recipients;
  }

  /** Sends one threshold message unless it was already sent (SET NX debounce). Never throws. */
  private async notifyOnce(
    clinicId: string,
    notification: QueueNotification,
    recipient: { userId: string; phone: string | null } | undefined
  ): Promise<boolean> {
    if (!recipient) return false;
    // NEAR after NEXT would read backwards: once "next" was sent, "near" is never sent.
    if (
      notification.threshold === 'NEAR' &&
      (await this.cache.get<string>(queueNotifyKey(notification.appointmentId, 'NEXT')))
    ) {
      return false;
    }
    const key = queueNotifyKey(notification.appointmentId, notification.threshold);
    if (!(await this.cache.acquireLock(key, QUEUE_NOTIFY_DEBOUNCE_SECONDS))) return false;
    if (notification.threshold === 'NEXT') {
      await this.cache.set(key, '1', QUEUE_NOTIFY_DEBOUNCE_SECONDS);
    }
    const message = queueNotifyMessage(notification);
    if (!this.communication) {
      void this.logging.log(LogType.NOTIFICATION, LogLevel.INFO, message.title, SOURCE, {
        appointmentId: notification.appointmentId,
        threshold: notification.threshold,
        delivered: false,
        reason: 'communication service unavailable',
      });
      return true;
    }
    try {
      const result = await this.communication.send({
        category: CommunicationCategory.APPOINTMENT,
        title: message.title,
        body: message.body,
        recipients: [
          {
            userId: recipient.userId,
            ...(recipient.phone ? { phoneNumber: recipient.phone } : {}),
          },
        ],
        channels: ['push', 'socket', 'whatsapp'],
        priority: CommunicationPriority.HIGH,
        data: {
          type: 'QUEUE_POSITION',
          appointmentId: notification.appointmentId,
          clinicId,
          threshold: notification.threshold,
          peopleAhead: notification.peopleAhead,
          ...(notification.token ? { token: notification.token } : {}),
        },
        respectPreferences: true,
        applyRateLimit: false,
        initiatorRole: 'SYSTEM',
      });
      void this.logging.log(
        LogType.NOTIFICATION,
        LogLevel.INFO,
        'Queue position notification processed',
        SOURCE,
        {
          appointmentId: notification.appointmentId,
          threshold: notification.threshold,
          success: result.success,
        }
      );
    } catch (error) {
      // An unconfigured channel (placeholder WhatsApp credentials ...) is logged, never retried.
      void this.logging.log(
        LogType.NOTIFICATION,
        LogLevel.WARN,
        `Queue position notification not delivered: ${error instanceof Error ? error.message : String(error)}`,
        SOURCE,
        { appointmentId: notification.appointmentId, threshold: notification.threshold }
      );
    }
    return true;
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
