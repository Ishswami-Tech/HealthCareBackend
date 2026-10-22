import {
  ConflictException,
  Injectable,
  NotFoundException,
  Inject,
  forwardRef,
  Optional,
} from '@nestjs/common';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events/event.service';
import { LogType, LogLevel, EventCategory, EventPriority } from '@core/types';
import type { IEventService } from '@core/types';
import { isEventService } from '@core/types';
import { LaneType, AppointmentQueueCategory } from '@core/types/enums.types';
import {
  findTreatmentCatalogEntryOrUndefined,
  isAyurvedaTreatmentType,
} from '@core/types/treatment-catalog.types';
import type { EnterpriseEventPayload } from '@core/types/event.types';

import type { AppointmentQueueStats } from '@core/types';
import type {
  QueueEntry,
  QueueEntryData,
  DoctorQueueResponse,
  PatientQueuePositionResponse,
  OperationResponse,
  LocationQueueStatsResponse,
  QueueMetricsResponse,
} from '@core/types/appointment.types';
import { formatDateKeyInIST, nowIso } from '../../../../utils/date-time.util';
import { formatQueueToken } from '../../../../utils/in-person-flow.util';
import { endOfIstDay, startOfIstDay } from '../../../../utils/clock.util';
import { DatabaseService } from '@infrastructure/database/database.service';
import { assignLocationToken, supportsRawSql } from './location-token.allocator';
import { QUEUE_LOCK_RETRY, acquireWithRetry } from './queue-lock-retry.util';
import {
  LIVE_QUEUE_DB_STATUSES,
  LIVE_QUEUE_REBUILD_MAX_ROWS,
  compareLiveQueueEntries,
  queuePriorityWeight,
  dedupeQueueEntries,
  groupRebuildRowsByDoctor,
  reconcileLiveEntries,
  toRebuiltEntry,
  type LiveQueueRebuildRow,
} from './live-queue-rebuild.util';
import {
  LIVE_QUEUE_INDEX_SENTINEL,
  isLiveQueueIndexBackfilled,
  liveQueueDayPattern,
  liveQueueIndexKey,
  liveQueueKeysOfIndex,
  parseLiveQueueKey,
} from './live-queue-index.util';

// Re-export types for backward compatibility
export type { QueueEntry, QueueEntryData, AppointmentQueueStats as QueueStats };

/** Domain of the in-person doctor queue (the only one rebuilt from the database). */
const IN_PERSON_QUEUE_DOMAIN = 'clinic';
/** A clinic/day was checked against the database this recently: skip the check. */
const REBUILD_CHECK_TTL_SECONDS = 20;
/** Distributed lock of one clinic/day rebuild (one replica rebuilds, the others wait). */
const REBUILD_LOCK_TTL_SECONDS = 15;
const REBUILD_WAIT_ATTEMPTS = 10;
const REBUILD_WAIT_MS = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

interface RebuildReadClient {
  appointment: { findMany: (args: unknown) => Promise<LiveQueueRebuildRow[]> };
}

/** The persisted token handed to check-in (allocated in the check-in transaction). */
interface ResolvedToken {
  tokenNumber: number;
  tokenLabel: string | null;
}

/** Thrown when the visit is already in today's queue (a repeated or concurrent check-in). */
const ALREADY_CHECKED_IN_MESSAGE = 'Appointment arrival is already confirmed';

/** Tag set of one location's cached queue metrics (every period). */
function queueMetricsTag(clinicId: string, locationId: string, domain: string): string {
  return `queue_metrics:${clinicId}:${locationId}:${domain}`;
}

@Injectable()
export class AppointmentQueueService {
  private readonly QUEUE_CACHE_TTL = 3600; // 1 hour
  private readonly METRICS_CACHE_TTL = 300; // 5 minutes
  /** The raw per doctor/day live list (`queue:<domain>:<clinic>:<owner>:<day>`), same as the token counter. */
  private readonly LIVE_QUEUE_LIST_TTL = 48 * 3600;
  private typedEventService?: IEventService;

  constructor(
    @Inject('CACHE_SERVICE')
    private readonly cacheService: CacheService,
    @Inject('LOGGING_SERVICE')
    private readonly loggingService: LoggingService,
    @Optional()
    @Inject(forwardRef(() => EventService))
    private readonly eventService?: unknown,
    @Optional()
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService?: DatabaseService
  ) {
    // Type guard ensures type safety when using the service
    if (this.eventService && isEventService(this.eventService)) {
      this.typedEventService = this.eventService;
    }
  }

  private getQueueDate(date?: string): string {
    return date || formatDateKeyInIST(new Date()) || '';
  }

  private buildQueueKey(domain: string, clinicId: string, ownerId: string, date?: string): string {
    return `queue:${domain}:${clinicId}:${ownerId}:${this.getQueueDate(date)}`;
  }

  /**
   * Records a live list in its clinic / domain / day index (see live-queue-index.util.ts). Called
   * after every write that can create a list; best effort (a missed add is recovered by the
   * one-time SCAN backfill only while the index has no sentinel, so failures are logged).
   */
  private async trackLiveQueueList(queueKey: string): Promise<void> {
    const parts = parseLiveQueueKey(queueKey);
    if (!parts) return;
    const indexKey = liveQueueIndexKey(parts.domain, parts.clinicId, parts.day);
    try {
      await this.cacheService.sAdd(indexKey, queueKey);
      await this.cacheService.expire(indexKey, this.LIVE_QUEUE_LIST_TTL);
    } catch (error) {
      void this.loggingService.log(
        LogType.CACHE,
        LogLevel.WARN,
        `Live queue index update failed: ${error instanceof Error ? error.message : String(error)}`,
        'AppointmentQueueService',
        { queueKey }
      );
    }
  }

  /**
   * Every live list key of a clinic / domain / day, from the SET index. The keyspace SCAN only
   * runs when the index was never backfilled (lists written before it existed, or it was lost),
   * and then backfills it, or when the index itself cannot be read.
   */
  private async listDayQueueKeys(clinicId: string, domain: string, day: string): Promise<string[]> {
    const indexKey = liveQueueIndexKey(domain, clinicId, day);
    let members: string[];
    try {
      members = await this.cacheService.sMembers(indexKey);
    } catch {
      return await this.cacheService.keys(liveQueueDayPattern(domain, clinicId, day));
    }
    if (isLiveQueueIndexBackfilled(members)) return liveQueueKeysOfIndex(members);

    const scanned = await this.cacheService.keys(liveQueueDayPattern(domain, clinicId, day));
    try {
      await this.cacheService.sAdd(indexKey, LIVE_QUEUE_INDEX_SENTINEL, ...scanned);
      await this.cacheService.expire(indexKey, this.LIVE_QUEUE_LIST_TTL);
    } catch {
      // Next read scans again; correctness does not depend on the backfill.
    }
    return liveQueueKeysOfIndex([...members, ...scanned]);
  }

  /**
   * Counter of the token series. ONE series per clinic location per day (booked and walk-in
   * patients share it); entries without a location keep the older per doctor/day series.
   */
  private tokenCounterKey(
    clinicId: string,
    date: string,
    locationId: string | undefined,
    ownerId: string
  ): string {
    return locationId
      ? `queue:token:${clinicId}:location:${locationId}:${date}`
      : `queue:token:${clinicId}:${ownerId}:${date}`;
  }

  /**
   * Cache-only token counter: the fallback for callers without a database client (operational
   * consultation-lane items, unit worlds). It only moves forward; when the counter is unavailable
   * the call FAILS (callers answer 503) instead of guessing a number from one doctor's list, which
   * handed out duplicate tokens at a multi-doctor location (audit P0-2).
   */
  private async nextCacheTokenNumber(counterKey: string): Promise<number> {
    const next = await this.cacheService.incr(counterKey);
    if (!Number.isInteger(next) || next <= 0) {
      throw new Error(`Token counter unavailable, please retry: ${counterKey}`);
    }
    await this.cacheService.expire(counterKey, this.LIVE_QUEUE_LIST_TTL);
    return next;
  }

  /**
   * Token of an in-person arrival. The database is the source of truth (audit P0-1): the token
   * handed in by the check-in transaction, else the one stored on the appointment / allocated now
   * from `location_token_counters` (same atomic upsert), else (no database client) the cache
   * counter of the location/day.
   */
  private async resolveCheckInToken(params: {
    appointmentId: string;
    clinicId: string;
    doctorId: string;
    date: string;
    locationId?: string | undefined;
    tokenNumber?: number | undefined;
    tokenLabel?: string | undefined;
    tokenPrefix?: string | undefined;
  }): Promise<ResolvedToken> {
    if (typeof params.tokenNumber === 'number' && params.tokenNumber > 0) {
      return {
        tokenNumber: params.tokenNumber,
        tokenLabel:
          params.tokenLabel ||
          formatQueueToken(params.tokenNumber, params.tokenPrefix || undefined),
      };
    }
    if (this.databaseService) {
      const persisted = await this.databaseService.executeInTransaction(async client =>
        supportsRawSql(client)
          ? await assignLocationToken(client, params.appointmentId, { prefix: params.tokenPrefix })
          : null
      );
      if (persisted) {
        return { tokenNumber: persisted.tokenNumber, tokenLabel: persisted.tokenLabel };
      }
    }
    const tokenNumber = await this.nextCacheTokenNumber(
      this.tokenCounterKey(params.clinicId, params.date, params.locationId, params.doctorId)
    );
    return {
      tokenNumber,
      tokenLabel: formatQueueToken(tokenNumber, params.tokenPrefix || undefined),
    };
  }

  /** Token of a consultation-lane operational item; no token (never a guessed one) on failure. */
  private async operationalTokenNumber(queueData: {
    entryId: string;
    appointmentId?: string | undefined;
    clinicId: string;
    queueOwnerId: string;
    locationId?: string | undefined;
  }): Promise<number | undefined> {
    try {
      const token = await this.resolveCheckInToken({
        appointmentId: queueData.appointmentId || queueData.entryId,
        clinicId: queueData.clinicId,
        doctorId: queueData.queueOwnerId,
        date: this.getQueueDate(),
        locationId: queueData.locationId,
      });
      return token.tokenNumber;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Operational queue item enqueued without a token: ${error instanceof Error ? error.message : String(error)}`,
        'AppointmentQueueService',
        { entryId: queueData.entryId, clinicId: queueData.clinicId }
      );
      return undefined;
    }
  }

  /**
   * Live queue durability (audit P0-1). The per doctor/day lists live only in Dragonfly; when a
   * doctor's list for the day is missing or empty while the database still has that doctor's
   * arrivals of the day (checked in today, CONFIRMED / IN_PROGRESS), the list is rebuilt from the
   * database in serving order with the tokens stored at check-in. Runs before every in-person
   * queue read and mutation; one bounded query per clinic/day at most every
   * REBUILD_CHECK_TTL_SECONDS per replica, and a short distributed lock so only one replica
   * rebuilds while the others wait briefly. Never fails the caller (logged as WARN).
   */
  async ensureLiveQueueHydrated(clinicId: string, domain: string, date?: string): Promise<void> {
    if (domain !== IN_PERSON_QUEUE_DOMAIN || !this.databaseService || !clinicId) return;
    const day = this.getQueueDate(date);
    const checkedKey = `queue-rebuild:checked:${domain}:${clinicId}:${day}`;
    try {
      if (await this.cacheService.get<string>(checkedKey)) return;
      const lockKey = `lock:queue-rebuild:${domain}:${clinicId}:${day}`;
      if (!(await this.cacheService.acquireLock(lockKey, REBUILD_LOCK_TTL_SECONDS))) {
        // Another request is running the periodic check. Only a clinic/day whose lists are ALL
        // gone (cache flush) waits for that rebuild; otherwise the lists are served as they are
        // (M6: every reader used to wait up to 1 s each time the 20 s check came due).
        if (!(await this.hasAnyLiveList(clinicId, domain, day))) {
          await this.waitForRebuild(checkedKey);
        }
        return;
      }
      try {
        const rebuilt = await this.rebuildMissingLists(clinicId, domain, day);
        await this.cacheService.set(checkedKey, '1', REBUILD_CHECK_TTL_SECONDS);
        if (rebuilt > 0) {
          void this.loggingService.log(
            LogType.APPOINTMENT,
            LogLevel.WARN,
            'Live queue rebuilt from the database (cache entries were missing)',
            'AppointmentQueueService',
            { clinicId, date: day, rebuiltEntries: rebuilt }
          );
        }
      } finally {
        await this.cacheService.releaseLock(lockKey);
      }
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Live queue rebuild check failed: ${error instanceof Error ? error.message : String(error)}`,
        'AppointmentQueueService',
        { clinicId, date: day }
      );
    }
  }

  /** True when at least one live list of the clinic/day exists. */
  private async hasAnyLiveList(clinicId: string, domain: string, day: string): Promise<boolean> {
    try {
      // The index may still name a list that has since emptied (an empty list does not exist,
      // which is what the SCAN used to see), so only a non-empty list counts.
      for (const key of await this.listDayQueueKeys(clinicId, domain, day)) {
        if ((await this.cacheService.lLen(key)) > 0) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private async waitForRebuild(checkedKey: string): Promise<void> {
    for (let attempt = 0; attempt < REBUILD_WAIT_ATTEMPTS; attempt++) {
      await new Promise<void>(resolve => setTimeout(resolve, REBUILD_WAIT_MS));
      if (await this.cacheService.get<string>(checkedKey)) return;
    }
  }

  /** Arrivals of the day that belong in a live list (one bounded, indexed query). */
  private async loadLiveArrivals(clinicId: string, day: string): Promise<LiveQueueRebuildRow[]> {
    const from = startOfIstDay(day);
    const to = endOfIstDay(day);
    if (!from || !to || !this.databaseService) return [];
    return await this.databaseService.executeHealthcareRead(async client =>
      (client as unknown as RebuildReadClient).appointment.findMany({
        where: {
          clinicId,
          type: { not: 'VIDEO_CALL' },
          status: { in: [...LIVE_QUEUE_DB_STATUSES] },
          // The slot day is within a day of the arrival (cross-midnight window), which lets the
          // (clinicId, date, status) index drive the query; checkedInAt picks today's arrivals.
          date: { gte: new Date(from.getTime() - DAY_MS), lte: new Date(to.getTime() + DAY_MS) },
          checkedInAt: { gte: from, lte: to },
        },
        select: {
          id: true,
          doctorId: true,
          patientId: true,
          clinicId: true,
          locationId: true,
          type: true,
          status: true,
          priority: true,
          metadata: true,
          checkedInAt: true,
          startedAt: true,
          tokenNumber: true,
          tokenLabel: true,
        },
        orderBy: [{ checkedInAt: 'asc' }],
        take: LIVE_QUEUE_REBUILD_MAX_ROWS,
      })
    );
  }

  /** Rebuild every doctor list of the day that is missing / empty; returns the entries written. */
  private async rebuildMissingLists(
    clinicId: string,
    domain: string,
    day: string
  ): Promise<number> {
    const rows = await this.loadLiveArrivals(clinicId, day);
    if (rows.length === 0) return 0;
    let written = 0;
    for (const [doctorId, doctorRows] of groupRebuildRowsByDoctor(rows)) {
      const queueKey = this.buildQueueKey(domain, clinicId, doctorId, day);
      if ((await this.cacheService.lLen(queueKey)) > 0) continue;
      written += await this.rebuildDoctorList(queueKey, doctorRows);
      for (const locationId of new Set(doctorRows.map(row => row.locationId ?? undefined))) {
        await this.invalidateQueueReadCaches({ clinicId, domain, doctorId, date: day, locationId });
      }
    }
    return written;
  }

  /**
   * Consistency pass over every live list of a clinic/day (worker cron, see
   * InPersonQueueMaintenanceService): missing lists are rebuilt, and every list is reconciled
   * with the database (reconcileLiveEntries). Each list is rewritten under its queue lock and only
   * when something changed. Returns the totals for the log.
   */
  async reconcileLiveQueue(
    clinicId: string,
    domain: string = IN_PERSON_QUEUE_DOMAIN,
    date?: string
  ): Promise<{ lists: number; added: number; removed: number; updated: number }> {
    const totals = { lists: 0, added: 0, removed: 0, updated: 0 };
    if (domain !== IN_PERSON_QUEUE_DOMAIN || !this.databaseService || !clinicId) return totals;
    const day = this.getQueueDate(date);
    const rows = await this.loadLiveArrivals(clinicId, day);
    const byDoctor = groupRebuildRowsByDoctor(rows);
    const listKeys = new Set(await this.listDayQueueKeys(clinicId, domain, day));
    for (const doctorId of byDoctor.keys()) {
      listKeys.add(this.buildQueueKey(domain, clinicId, doctorId, day));
    }
    for (const queueKey of listKeys) {
      const doctorId = this.extractOwnerIdFromQueueKey(queueKey);
      const outcome = await this.reconcileList(queueKey, byDoctor.get(doctorId) ?? []);
      if (!outcome) continue;
      totals.lists += 1;
      totals.added += outcome.added;
      totals.removed += outcome.removed;
      totals.updated += outcome.updated;
      if (outcome.added + outcome.removed + outcome.updated > 0) {
        for (const locationId of outcome.locationIds) {
          await this.invalidateQueueReadCaches({
            clinicId,
            domain,
            doctorId,
            date: day,
            locationId,
          });
        }
        await this.invalidateQueueReadCaches({ clinicId, domain, doctorId, date: day });
      }
    }
    return totals;
  }

  /** One list reconciled under its lock; null when the list is busy right now (next run). */
  private async reconcileList(
    queueKey: string,
    liveRows: readonly LiveQueueRebuildRow[]
  ): Promise<{ added: number; removed: number; updated: number; locationIds: Set<string> } | null> {
    try {
      return await this.withQueueLock(queueKey, async () => {
        const raw = await this.cacheService.lRange(queueKey, 0, -1);
        const current = raw.flatMap(entry => {
          try {
            return [JSON.parse(entry) as QueueEntryData];
          } catch {
            return [];
          }
        });
        const liveIds = new Set(liveRows.map(row => row.id));
        const otherIds = current
          .map(entry => entry.appointmentId)
          .filter((id): id is string => Boolean(id) && !liveIds.has(id));
        const known = await this.loadAppointmentStatuses(otherIds);
        const result = reconcileLiveEntries(current, liveRows, known, type =>
          this.resolveDisplayLabel(AppointmentQueueCategory.DOCTOR_CONSULTATION, type)
        );
        if (result.added + result.removed + result.updated > 0) {
          await this.rewriteQueueList(
            queueKey,
            result.entries.map(entry => JSON.stringify(entry)),
            raw.length
          );
        }
        const locationIds = new Set(
          result.entries.map(entry => entry.locationId).filter((id): id is string => Boolean(id))
        );
        return {
          added: result.added,
          removed: result.removed,
          updated: result.updated,
          locationIds,
        };
      });
    } catch (error) {
      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.WARN,
        `Live queue reconcile skipped a list: ${error instanceof Error ? error.message : String(error)}`,
        'AppointmentQueueService',
        { queueKey }
      );
      return null;
    }
  }

  /** Database status of the given appointment ids (ids that are not appointments are absent). */
  private async loadAppointmentStatuses(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0 || !this.databaseService) return new Map();
    const rows = await this.databaseService.executeHealthcareRead(async client =>
      (
        client as unknown as {
          appointment: {
            findMany: (args: unknown) => Promise<Array<{ id: string; status: string }>>;
          };
        }
      ).appointment.findMany({
        where: { id: { in: [...new Set(ids)] } },
        select: { id: true, status: true },
      })
    );
    return new Map(rows.map(row => [row.id, String(row.status)]));
  }

  /** One doctor's list, under its queue lock (a list someone is rewriting right now is skipped). */
  private async rebuildDoctorList(
    queueKey: string,
    doctorRows: readonly LiveQueueRebuildRow[]
  ): Promise<number> {
    const lockKey = `lock:${queueKey}`;
    if (!(await this.cacheService.acquireLock(lockKey, 10))) return 0;
    try {
      if ((await this.cacheService.lLen(queueKey)) > 0) return 0;
      const entries = doctorRows.map(row =>
        JSON.stringify(
          toRebuiltEntry(row, type =>
            this.resolveDisplayLabel(AppointmentQueueCategory.DOCTOR_CONSULTATION, type)
          )
        )
      );
      const length = await this.cacheService.rPush(queueKey, ...entries);
      if (length < entries.length) {
        throw new Error(`Queue rebuild write failed: ${queueKey}`);
      }
      await this.cacheService.expire(queueKey, this.LIVE_QUEUE_LIST_TTL);
      await this.trackLiveQueueList(queueKey);
      return entries.length;
    } finally {
      await this.cacheService.releaseLock(lockKey);
    }
  }

  private normalizeQueueLabel(value?: string): string {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_');
  }

  private resolveDisplayLabel(queueCategory: string, treatmentType?: string): string {
    const catalogEntry = findTreatmentCatalogEntryOrUndefined(treatmentType);
    if (catalogEntry) {
      return catalogEntry.label;
    }

    const normalizedCategory = this.normalizeQueueLabel(queueCategory);
    if (normalizedCategory === 'doctor_consultation') return 'Consultation';
    if (normalizedCategory === 'medicine_desk') return 'Medicine Desk';
    if (normalizedCategory === 'therapy_procedure') {
      return isAyurvedaTreatmentType(treatmentType) ? 'Ayurvedic Procedures' : 'Procedural Care';
    }
    return String(queueCategory || treatmentType || 'General Consultation')
      .split(/[_\s-]+/)
      .filter(Boolean)
      .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Read caches are written with `cacheService.set`, which stores the VERSIONED key
   * (`<key>:v1`), and `cacheService.del(key)` versions the key again. So an exact key is deleted
   * as given (keys() on the unversioned name matched nothing, which left the doctor / desk
   * queue views stale for the whole 1 h TTL), and a wildcard match from keys() is stripped of
   * its version suffix before del().
   */
  private async deleteCacheKeys(patterns: string[]): Promise<void> {
    const keysToDelete = new Set<string>();

    for (const pattern of patterns) {
      if (!pattern.includes('*')) {
        keysToDelete.add(pattern);
        continue;
      }
      const keys = await this.cacheService.keys(pattern);
      for (const key of keys) {
        keysToDelete.add(key.replace(/:v\d+$/u, ''));
      }
    }

    for (const key of keysToDelete) {
      await this.cacheService.del(key);
    }
  }

  private async emitAppointmentQueueEvent(
    eventType: 'appointment.queue.updated' | 'appointment.queue.position.updated',
    params: {
      eventId: string;
      priority?: EventPriority;
      appointmentId?: string;
      payload: Record<string, unknown>;
    }
  ): Promise<void> {
    if (!this.typedEventService) {
      return;
    }

    await this.typedEventService.emitEnterprise(eventType, {
      eventId: params.eventId,
      eventType,
      category: EventCategory.APPOINTMENT,
      priority: params.priority ?? EventPriority.NORMAL,
      timestamp: nowIso(),
      source: 'AppointmentQueueService',
      version: '1.0.0',
      ...(params.appointmentId ? { appointmentId: params.appointmentId } : {}),
      payload: params.payload,
    } as EnterpriseEventPayload);
  }

  /**
   * Replace the snapshot the caller read (the first `readLength` items of the raw live list) with
   * `entries`. The list is a raw (unversioned) key: `cacheService.del()` versions keys
   * (`<key>:v1`), so it never removed the list and every rewrite appended a full copy (the list
   * doubled on each call-next / start / priority / reorder). New items are appended first and the
   * old snapshot is trimmed off the head afterwards, so a check-in rPush that lands meanwhile
   * (check-in does not take the queue lock) is kept instead of being wiped by a delete.
   */
  private async rewriteQueueList(
    queueKey: string,
    entries: string[],
    readLength: number
  ): Promise<void> {
    if (entries.length > 0) {
      const length = await this.cacheService.rPush(queueKey, ...entries);
      if (length < entries.length) {
        throw new Error(`Queue write failed, please retry: ${queueKey}`);
      }
    }
    if (readLength > 0) {
      await this.cacheService.lTrim(queueKey, readLength, -1);
    }
    await this.cacheService.expire(queueKey, this.LIVE_QUEUE_LIST_TTL);
    if (entries.length > 0) await this.trackLiveQueueList(queueKey);
  }

  /**
   * Every read-modify-write on a per-doctor queue list (lRange -> compute ->
   * rewriteQueueList) is not atomic on its own — two concurrent callers
   * (e.g. a double-clicked "Call Next", or a BullMQ job retry racing the
   * original attempt) can both read the same snapshot, and the last write
   * wins, silently reverting or duplicating queue entries. Serialize the
   * whole read-modify-write span per queueKey with a short-lived
   * distributed lock instead.
   */
  private async withQueueLock<T>(queueKey: string, fn: () => Promise<T>): Promise<T> {
    const lockKey = `lock:${queueKey}`;
    // L2: a lock held for a few ms by a concurrent rewrite is waited for (short retries with
    // jitter, ~300 ms in total) before the caller gets a retryable 409.
    const acquired = await acquireWithRetry(
      () => this.cacheService.acquireLock(lockKey, 10),
      QUEUE_LOCK_RETRY
    );
    if (!acquired) {
      throw new ConflictException(`Queue is busy, please retry: ${queueKey}`);
    }
    try {
      return await fn();
    } finally {
      await this.cacheService.releaseLock(lockKey);
    }
  }

  private async invalidateQueueReadCaches(params: {
    clinicId: string;
    domain: string;
    doctorId?: string | undefined;
    date?: string | undefined;
    locationId?: string | undefined;
    appointmentId?: string | undefined;
  }): Promise<void> {
    const patterns: string[] = [];
    const normalizedDate = this.getQueueDate(params.date);

    if (params.doctorId) {
      patterns.push(
        `queue:doctor:${params.clinicId}:${params.doctorId}:${normalizedDate}:${params.domain}`
      );
      if (params.locationId) {
        patterns.push(
          `queue:doctor:${params.clinicId}:${params.doctorId}:${normalizedDate}:${params.domain}:${params.locationId}`
        );
      }
      // `queue:status:...` is the doctor's PAUSE flag (pauseQueue / resumeQueue), not a read
      // cache: it must survive check-ins and status changes, so it is not invalidated here.
    }

    // Exact keys only (no keyspace SCAN on every check-in / status change): the position is
    // cached per (clinic, appointment, domain) and the legacy check-in key, both listed here.
    if (params.appointmentId) {
      patterns.push(`queue:position:${params.clinicId}:${params.appointmentId}:${params.domain}`);
      patterns.push(`queue:position:${params.appointmentId}:${params.clinicId}`);
    }

    if (params.locationId) {
      patterns.push(
        `queue:stats:location:${params.clinicId}:${params.locationId}:${params.domain}`
      );
    }

    await this.deleteCacheKeys(patterns);
    if (params.locationId) {
      // Every period of the location's metrics, through its tag set (see getQueueMetrics).
      await this.cacheService.invalidateCacheByTag(
        queueMetricsTag(params.clinicId, params.locationId, params.domain)
      );
    }
  }

  async enqueueOperationalItem(
    queueData: {
      entryId: string;
      queueOwnerId: string;
      patientId: string;
      clinicId: string;
      appointmentId?: string | undefined;
      assignedDoctorId?: string | undefined;
      primaryDoctorId?: string | undefined;
      locationId?: string | undefined;
      queueCategory: string;
      displayLabel?: string | undefined;
      laneType?: string | undefined;
      type?: string | undefined;
      notes?: string | undefined;
      estimatedWaitTime?: number | undefined;
    },
    domain: string
  ): Promise<OperationResponse> {
    const queueKey = this.buildQueueKey(domain, queueData.clinicId, queueData.queueOwnerId);

    // Reject enqueues while queue is paused
    const pauseStatus = await this.cacheService.get<string>(
      `queue:status:${domain}:${queueData.clinicId}:${queueData.queueOwnerId}:${this.getQueueDate()}`
    );
    if (pauseStatus === 'PAUSED') {
      return { success: false, message: 'Queue is currently paused. Please try again later.' };
    }

    try {
      const existingEntries = await this.cacheService.lRange(queueKey, 0, -1);
      const exists = existingEntries.some(entry => {
        const data = JSON.parse(entry) as QueueEntryData;
        return data.entryId === queueData.entryId;
      });

      if (exists) {
        return { success: true, message: 'Queue item already exists' };
      }

      if (queueData.laneType && !Object.values(LaneType).includes(queueData.laneType as LaneType)) {
        throw new Error(`Invalid laneType: ${queueData.laneType}`);
      }

      // Only consultation-lane entries get a token (they are in-person arrivals).
      const tokenNumber =
        queueData.queueCategory === String(AppointmentQueueCategory.DOCTOR_CONSULTATION)
          ? await this.operationalTokenNumber(queueData)
          : undefined;

      const queueEntry: QueueEntryData = {
        entryId: queueData.entryId,
        appointmentId: queueData.appointmentId || queueData.entryId,
        patientId: queueData.patientId,
        doctorId: queueData.assignedDoctorId || queueData.queueOwnerId,
        clinicId: queueData.clinicId,
        status: 'WAITING',
        checkedInAt: nowIso(),
        ...(tokenNumber !== undefined && { tokenNumber }),
        priority:
          queueData.laneType === 'VIP'
            ? 100
            : typeof queueData.notes === 'string' && queueData.notes.includes('URGENT')
              ? 80
              : 0,
        ...(queueData.estimatedWaitTime !== undefined && {
          estimatedWaitTime: queueData.estimatedWaitTime,
        }),
        ...(queueData.type && { type: queueData.type }),
        ...(queueData.notes && { notes: queueData.notes }),
        ...(queueData.locationId && { locationId: queueData.locationId }),
        queueCategory: queueData.queueCategory,
        displayLabel:
          queueData.displayLabel ||
          this.resolveDisplayLabel(queueData.queueCategory, queueData.type),
        ...(queueData.laneType && { laneType: queueData.laneType }),
        queueOwnerId: queueData.queueOwnerId,
        ...(queueData.primaryDoctorId && { primaryDoctorId: queueData.primaryDoctorId }),
        ...(queueData.assignedDoctorId && { assignedDoctorId: queueData.assignedDoctorId }),
      };

      await this.cacheService.rPush(queueKey, JSON.stringify(queueEntry));
      // Every per-day list expires (the medicine-desk list had no TTL and stayed forever).
      await this.cacheService.expire(queueKey, this.LIVE_QUEUE_LIST_TTL);
      await this.trackLiveQueueList(queueKey);
      await this.invalidateQueueReadCaches({
        clinicId: queueData.clinicId,
        domain,
        doctorId: queueData.assignedDoctorId || queueData.queueOwnerId,
        appointmentId: queueEntry.appointmentId,
        locationId: queueData.locationId,
      });

      const totalInQueue = await this.cacheService.lLen(queueKey);
      await this.emitAppointmentQueueEvent('appointment.queue.updated', {
        eventId: `queue-enqueue-${queueData.entryId}-${Date.now()}`,
        priority: EventPriority.NORMAL,
        payload: {
          doctorId: queueData.queueOwnerId,
          domain,
          action: 'CHECK_IN',
          appointmentId: queueEntry.appointmentId,
          entryId: queueData.entryId,
          queueCategory: queueData.queueCategory,
          displayLabel:
            queueData.displayLabel ||
            this.resolveDisplayLabel(queueData.queueCategory, queueData.type),
          position: totalInQueue,
          totalInQueue,
          clinicId: queueData.clinicId,
          queueOwnerId: queueData.queueOwnerId,
          locationId: queueData.locationId,
          primaryDoctorId: queueData.primaryDoctorId,
          assignedDoctorId: queueData.assignedDoctorId,
        },
      });

      return { success: true, message: 'Queue item added successfully' };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to enqueue operational item: ${error instanceof Error ? error.message : String(error)}`,
        'AppointmentQueueService',
        {
          entryId: queueData.entryId,
          queueOwnerId: queueData.queueOwnerId,
        }
      );
      throw error;
    }
  }

  async getOperationalQueue(
    queueOwnerId: string,
    clinicId: string,
    domain: string,
    date?: string
  ): Promise<QueueEntryData[]> {
    await this.ensureLiveQueueHydrated(clinicId, domain, date);
    const queueKey = this.buildQueueKey(domain, clinicId, queueOwnerId, date);
    const entries = await this.cacheService.lRange(queueKey, 0, -1);
    const parsedEntries = dedupeQueueEntries(
      entries.map(entry => JSON.parse(entry) as QueueEntryData)
    );

    // Priority (desc), then token at the same location, then check-in time
    const sortedEntries = [...parsedEntries].sort(compareLiveQueueEntries);

    return sortedEntries.map((entry, index) => ({
      ...entry,
      position: index + 1,
    }));
  }

  async getClinicQueue(clinicId: string, date: string, domain: string): Promise<QueueEntryData[]> {
    const normalizedDate = this.getQueueDate(date);
    await this.ensureLiveQueueHydrated(clinicId, domain, normalizedDate);
    const queueKeys = await this.listDayQueueKeys(clinicId, domain, normalizedDate);
    const clinicEntries: QueueEntryData[] = [];

    for (const queueKey of queueKeys) {
      const ownerId = this.extractOwnerIdFromQueueKey(queueKey);
      const entries = await this.cacheService.lRange(queueKey, 0, -1);

      entries.forEach((entry, index) => {
        try {
          const parsed = JSON.parse(entry) as QueueEntryData;
          clinicEntries.push({
            ...parsed,
            queueOwnerId: parsed.queueOwnerId || ownerId,
            doctorId: parsed.doctorId || ownerId,
            position: parsed.position || index + 1,
          });
        } catch {
          // Ignore malformed entries and continue building the clinic queue snapshot.
        }
      });
    }

    const ordered = [...clinicEntries].sort(compareLiveQueueEntries);

    return dedupeQueueEntries(ordered).map((entry, index) => ({
      ...entry,
      position: index + 1,
    }));
  }

  async removeOperationalQueueItem(
    entryId: string,
    queueOwnerId: string,
    clinicId: string,
    domain: string,
    date?: string
  ): Promise<OperationResponse> {
    const queueKey = this.buildQueueKey(domain, clinicId, queueOwnerId, date);
    const entries = await this.cacheService.lRange(queueKey, 0, -1);
    const remainingEntries = entries.filter(entry => {
      const data = JSON.parse(entry) as QueueEntryData;
      return data.entryId !== entryId;
    });

    if (entries.length === remainingEntries.length) {
      return { success: false, message: 'Queue item not found' };
    }

    await this.rewriteQueueList(queueKey, remainingEntries, entries.length);

    const queueCategory =
      remainingEntries.length > 0
        ? (() => {
            const parsed = JSON.parse(remainingEntries[0] || '{}') as QueueEntryData;
            return typeof parsed.queueCategory === 'string' ? parsed.queueCategory : undefined;
          })()
        : undefined;
    await this.emitAppointmentQueueEvent('appointment.queue.updated', {
      eventId: `queue-remove-${entryId}-${Date.now()}`,
      priority: EventPriority.NORMAL,
      payload: {
        doctorId: queueOwnerId,
        domain,
        action: 'REMOVED',
        entryId,
        clinicId,
        queueOwnerId,
        ...(queueCategory ? { queueCategory } : {}),
      },
    });

    return { success: true, message: 'Queue item removed successfully' };
  }

  async transferOperationalQueueItem(
    entryId: string,
    clinicId: string,
    domain: string,
    targetQueue: string,
    treatmentType?: string,
    notes?: string
  ): Promise<OperationResponse & { data?: Record<string, unknown> }> {
    const normalizedTargetQueue = String(targetQueue || '')
      .trim()
      .toUpperCase();
    const nextQueueCategory = this.mapTargetQueueToCategory(normalizedTargetQueue);
    const nextType = this.resolveQueueEntryType(nextQueueCategory, treatmentType);
    const today = this.getQueueDate();
    await this.ensureLiveQueueHydrated(clinicId, domain, today);

    const searchPatterns = [
      `queue:${domain}:${clinicId}:*:${today}`,
      `queue:${domain}:${clinicId}:*:*`,
    ];

    const visitedKeys = new Set<string>();
    const queueKeys: string[] = [];
    for (const pattern of searchPatterns) {
      const keys = await this.cacheService.keys(pattern);
      keys.forEach(key => {
        if (!visitedKeys.has(key)) {
          visitedKeys.add(key);
          queueKeys.push(key);
        }
      });
    }

    for (const queueKey of queueKeys) {
      const entries = await this.cacheService.lRange(queueKey, 0, -1);
      const ownerId = this.extractOwnerIdFromQueueKey(queueKey);
      let updated = false;
      let appointmentId = '';
      let previousQueueCategory = '';
      const nextEntries = entries.map(entry => {
        try {
          const parsed = JSON.parse(entry) as QueueEntryData;
          const parsedEntryId = parsed.entryId || parsed.appointmentId;
          if (String(parsedEntryId) !== String(entryId)) {
            return entry;
          }

          appointmentId = String(parsed.appointmentId || parsed.entryId || entryId);
          previousQueueCategory = String(parsed.queueCategory || '');
          const mergedNotes = [parsed.notes, notes].filter(Boolean).join(' | ');

          const nextEntry: QueueEntryData = {
            ...parsed,
            queueCategory: nextQueueCategory,
            displayLabel: this.resolveDisplayLabel(nextQueueCategory, nextType || treatmentType),
            ...(nextType ? { type: nextType } : {}),
            ...(mergedNotes ? { notes: mergedNotes } : {}),
            queueOwnerId: parsed.queueOwnerId || ownerId || parsed.doctorId,
          };
          updated = true;
          return JSON.stringify(nextEntry);
        } catch {
          return entry;
        }
      });

      if (!updated) continue;

      await this.rewriteQueueList(queueKey, nextEntries, entries.length);

      await this.invalidateQueueReadCaches({
        clinicId,
        domain,
        doctorId: ownerId,
        date: queueKey.split(':')[4] || this.getQueueDate(),
        locationId: (() => {
          try {
            const parsed = nextEntries.find(entry => {
              const data = JSON.parse(entry) as QueueEntryData;
              return String(data.entryId || data.appointmentId || '') === String(entryId);
            });
            if (!parsed) return undefined;
            return (JSON.parse(parsed) as QueueEntryData).locationId;
          } catch {
            return undefined;
          }
        })(),
        appointmentId,
      });

      await this.emitAppointmentQueueEvent('appointment.queue.updated', {
        eventId: `queue-transfer-${entryId}-${Date.now()}`,
        priority: EventPriority.HIGH,
        payload: {
          action: 'TRANSFERRED',
          entryId,
          appointmentId,
          clinicId,
          domain,
          queueOwnerId: ownerId,
          doctorId: ownerId,
          targetQueue: normalizedTargetQueue,
          treatmentType: nextType || treatmentType,
          queueCategory: nextQueueCategory,
          displayLabel: this.resolveDisplayLabel(nextQueueCategory, nextType || treatmentType),
          previousQueueCategory,
        },
      });

      return {
        success: true,
        message: 'Queue item transferred successfully',
        data: {
          entryId,
          appointmentId,
          queueOwnerId: ownerId,
          previousQueueCategory,
          queueCategory: nextQueueCategory,
          targetQueue: normalizedTargetQueue,
          treatmentType: nextType || treatmentType,
          displayLabel: this.resolveDisplayLabel(nextQueueCategory, nextType || treatmentType),
        },
      };
    }

    return { success: false, message: 'Queue item not found' };
  }

  async checkIn(
    checkInData: {
      appointmentId: string;
      doctorId: string;
      patientId: string;
      clinicId: string;
      appointmentType?: string;
      notes?: string;
      locationId?: string;
      priority?: string | number;
      priorityLabel?: string;
      priorityReason?: string;
      /** Location token prefix ("K", "B"): the stored display token is `${prefix}-nnn`. */
      tokenPrefix?: string;
      /** Walk-in tag (same series and ordering as booked patients; priority stays a flag). */
      isWalkIn?: boolean;
      /**
       * Token allocated in the check-in transaction (stored on the appointment). Omitted: the
       * stored token is read / allocated from the database here (never a second number).
       */
      tokenNumber?: number;
      tokenLabel?: string;
      /**
       * Arrival recorded on the appointment. A re-queue (undo no-show, queue repair) keeps the
       * original arrival, so the patient goes back to their place, not to the back (M4).
       */
      checkedInAt?: string;
    },
    domain: string
  ): Promise<OperationResponse> {
    const { appointmentId, doctorId, patientId, clinicId, appointmentType, notes, locationId } =
      checkInData;
    const date = formatDateKeyInIST(new Date());
    // P1 FIX: Include clinicId in cache key for strict isolation
    const cacheKey = `queue:${domain}:${clinicId}:${doctorId}:${date}`;

    try {
      // A list lost with the cache is rebuilt first, so this arrival never becomes the only
      // entry of a list that should hold the whole morning.
      await this.ensureLiveQueueHydrated(clinicId, domain, date);
      // Check if already in queue
      const existingEntries = await this.cacheService.lRange(cacheKey, 0, -1);
      const exists = existingEntries.some(entry => {
        const data = JSON.parse(entry) as QueueEntryData;
        return data.appointmentId === appointmentId;
      });

      if (exists) {
        throw new Error(ALREADY_CHECKED_IN_MESSAGE);
      }

      const { tokenNumber, tokenLabel } = await this.resolveCheckInToken({
        appointmentId,
        clinicId,
        doctorId,
        date,
        locationId,
        tokenNumber: checkInData.tokenNumber,
        tokenLabel: checkInData.tokenLabel,
        tokenPrefix: checkInData.tokenPrefix,
      });

      const queueEntry: QueueEntryData = {
        appointmentId,
        patientId,
        doctorId,
        clinicId,
        status: 'WAITING',
        checkedInAt: checkInData.checkedInAt || nowIso(),
        tokenNumber,
        ...(tokenLabel ? { tokenLabel } : {}),
        ...(checkInData.isWalkIn ? { isWalkIn: true } : {}),
        // One scale for every arrival (M3 / B6): NORMAL / MEDIUM (staff DTO default) are 0.
        priority: queuePriorityWeight(checkInData.priority),
      };

      if (appointmentType) {
        queueEntry.type = appointmentType;
        queueEntry.displayLabel = this.resolveDisplayLabel(
          AppointmentQueueCategory.DOCTOR_CONSULTATION,
          appointmentType
        );
      }
      if (!queueEntry.displayLabel) {
        queueEntry.displayLabel = this.resolveDisplayLabel(
          AppointmentQueueCategory.DOCTOR_CONSULTATION,
          appointmentType
        );
      }
      if (notes) queueEntry.notes = notes;
      if (locationId) queueEntry.locationId = locationId;
      if (checkInData.priorityLabel) queueEntry.priorityLabel = checkInData.priorityLabel;
      if (checkInData.priorityReason) queueEntry.priorityReason = checkInData.priorityReason;

      // The cache client answers 0 instead of throwing on a failed write: never report
      // "Checked in" without a queue entry (the caller maps this to a retryable 503).
      const pushedLength = await this.cacheService.rPush(cacheKey, JSON.stringify(queueEntry));
      if (!Number.isInteger(pushedLength) || pushedLength < 1) {
        throw new Error(`Queue write failed, please retry: ${cacheKey}`);
      }
      await this.cacheService.expire(cacheKey, this.LIVE_QUEUE_LIST_TTL);
      await this.trackLiveQueueList(cacheKey);
      await this.invalidateQueueReadCaches({
        clinicId,
        domain,
        doctorId,
        date,
        appointmentId,
        locationId,
      });

      // Emit WebSocket event
      const totalInQueue = await this.cacheService.lLen(cacheKey);
      await this.emitAppointmentQueueEvent('appointment.queue.updated', {
        eventId: `queue-checkin-${appointmentId}-${Date.now()}`,
        priority: EventPriority.NORMAL,
        payload: {
          doctorId,
          domain,
          action: 'CHECK_IN',
          appointmentId,
          position: totalInQueue,
          totalInQueue,
          clinicId,
          queueOwnerId: doctorId,
          locationId,
          queueCategory: AppointmentQueueCategory.DOCTOR_CONSULTATION,
        },
      });

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Patient arrival confirmed successfully',
        'AppointmentQueueService',
        {
          appointmentId,
          doctorId,
          queueLength: exists ? existingEntries.length : existingEntries.length + 1,
        }
      );

      return { success: true, message: 'Checked in successfully' };
    } catch (error) {
      // A repeated scan / double tap of a visit already in the queue is expected, not a fault.
      const duplicate = error instanceof Error && error.message === ALREADY_CHECKED_IN_MESSAGE;
      void this.loggingService.log(
        duplicate ? LogType.APPOINTMENT : LogType.ERROR,
        duplicate ? LogLevel.WARN : LogLevel.ERROR,
        `Check-in ${duplicate ? 'skipped' : 'failed'}: ${error instanceof Error ? error.message : String(error)}`,
        'AppointmentQueueService',
        {
          appointmentId,
          ...(duplicate ? {} : { error: error instanceof Error ? error.stack : undefined }),
        }
      );
      throw error;
    }
  }

  async getDoctorQueue(
    doctorId: string,
    clinicId: string,
    date: string,
    domain: string,
    locationId?: string
  ): Promise<DoctorQueueResponse> {
    const startTime = Date.now();
    // P1 FIX: Include clinicId in cache key
    const cacheKey = `queue:doctor:${clinicId}:${doctorId}:${date}:${domain}${locationId ? `:${locationId}` : ''}`;

    try {
      // A lost live list is rebuilt (and the read caches dropped) before any cached view is
      // served, so an empty view cached while the list was missing never outlives the rebuild.
      await this.ensureLiveQueueHydrated(clinicId, domain, date);
      // Try to get from cache first
      const cached = await this.cacheService.get<DoctorQueueResponse>(cacheKey);
      if (cached) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Doctor queue retrieved from cache',
          'AppointmentQueueService',
          { doctorId, date, domain, locationId, responseTime: Date.now() - startTime }
        );
        return cached;
      }

      // Get queue from Redis with clinic isolation (rebuilt from the database above when lost)
      const queueKey = `queue:${domain}:${clinicId}:${doctorId}:${date}`;
      const queueEntries = await this.cacheService.lRange(queueKey, 0, -1);

      // Filter by locationId if provided
      let filteredEntries = queueEntries;
      if (locationId) {
        filteredEntries = queueEntries.filter(entry => {
          const entryData = JSON.parse(entry) as QueueEntryData;
          return entryData.locationId === locationId;
        });
      }

      const parsedEntries = dedupeQueueEntries(
        filteredEntries.map(entry => JSON.parse(entry) as QueueEntryData)
      );

      // Priority (desc), then token at the same location, then check-in time
      const sortedEntries = [...parsedEntries].sort(compareLiveQueueEntries);

      const queue: QueueEntryData[] = sortedEntries.map((entry, index) => {
        return {
          ...entry,
          position: index + 1,
          estimatedWaitTime: this.calculateEstimatedWaitTime(index + 1, domain),
        };
      });

      const result: DoctorQueueResponse = {
        doctorId,
        date,
        domain,
        queue,
        totalLength: queue.length,
        averageWaitTime: this.calculateAverageWaitTime(queue),
        estimatedNextWaitTime: queue.length > 0 ? this.calculateEstimatedWaitTime(1, domain) : 0,
      };

      // Cache the result (CacheService handles serialization internally)
      await this.cacheService.set(cacheKey, result as unknown as string, this.QUEUE_CACHE_TTL);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Doctor queue retrieved successfully',
        'AppointmentQueueService',
        {
          doctorId,
          date,
          domain,
          locationId: locationId || 'all',
          queueLength: queue.length,
          responseTime: Date.now() - startTime,
        }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get doctor queue: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentQueueService',
        {
          doctorId,
          date,
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async getPatientQueuePosition(
    appointmentId: string,
    clinicId: string,
    domain: string
  ): Promise<PatientQueuePositionResponse> {
    const cacheKey = `queue:position:${clinicId}:${appointmentId}:${domain}`;

    try {
      await this.ensureLiveQueueHydrated(clinicId, domain);
      // Try to get from cache first
      const cached = await this.cacheService.get<PatientQueuePositionResponse>(cacheKey);
      if (cached) {
        return cached;
      }

      // Find appointment in all doctor queues for this clinic
      const pattern = `queue:${domain}:${clinicId}:*`;
      const queueKeys = await this.cacheService.keys(pattern);

      let position = -1;
      let doctorId = '';
      let queueKey = '';

      for (const key of queueKeys) {
        const entries = await this.cacheService.lRange(key, 0, -1);
        const entryIndex = entries.findIndex(entry => {
          const entryData = JSON.parse(entry) as QueueEntryData;
          return entryData.appointmentId === appointmentId;
        });

        if (entryIndex !== -1) {
          position = entryIndex + 1;
          // Key format: queue:{domain}:{clinicId}:{doctorId}:{date}
          doctorId = key.split(':')[3] || '';
          queueKey = key;
          break;
        }
      }

      if (position === -1) {
        throw new NotFoundException(`Appointment ${appointmentId} not found in any queue`);
      }

      const estimatedWaitTime = this.calculateEstimatedWaitTime(position, domain);
      const totalInQueue = await this.cacheService.lLen(queueKey);

      const result: PatientQueuePositionResponse = {
        appointmentId,
        position,
        totalInQueue,
        estimatedWaitTime,
        domain,
        doctorId,
      };

      // Cache for a shorter time (queue positions change frequently)
      await this.cacheService.set(cacheKey, result as unknown as string, 60);

      // Emit WebSocket event for queue position update
      try {
        await this.emitAppointmentQueueEvent('appointment.queue.position.updated', {
          eventId: `queue-position-${appointmentId}-${Date.now()}`,
          priority: EventPriority.NORMAL,
          appointmentId,
          payload: {
            appointmentId,
            position,
            totalInQueue,
            estimatedWaitTime,
            doctorId,
            domain,
          },
        });
      } catch (eventError) {
        // Don't fail queue position retrieval if event emission fails
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Failed to emit queue position event: ${eventError instanceof Error ? eventError.message : String(eventError)}`,
          'AppointmentQueueService'
        );
      }

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Patient queue position retrieved successfully',
        'AppointmentQueueService',
        {
          appointmentId,
          domain,
          position,
        }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get patient queue position: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentQueueService',
        {
          appointmentId,
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async confirmAppointment(
    appointmentId: string,
    clinicId: string,
    domain: string
  ): Promise<OperationResponse> {
    const startTime = Date.now();

    try {
      // Find and update appointment in queue
      // Strict isolation: only look in this clinic's queues
      await this.ensureLiveQueueHydrated(clinicId, domain);
      const pattern = `queue:${domain}:${clinicId}:*`;
      const queueKeys = await this.cacheService.keys(pattern);

      for (const key of queueKeys) {
        const lockResult = await this.withQueueLock(key, async () => {
          const entries = await this.cacheService.lRange(key, 0, -1);
          const foundIndex = entries.findIndex(entry => {
            const entryData = JSON.parse(entry) as QueueEntryData;
            return entryData.appointmentId === appointmentId;
          });

          if (foundIndex === -1) {
            return null;
          }

          const entryData = JSON.parse(entries[foundIndex] || '{}') as QueueEntryData;
          entryData.status = 'CONFIRMED';
          entryData.confirmedAt = nowIso();
          const updatedEntries = [...entries];
          updatedEntries[foundIndex] = JSON.stringify(entryData);
          await this.rewriteQueueList(key, updatedEntries, entries.length);
          return entryData;
        });

        if (lockResult) {
          const entryData = lockResult;
          const keyParts = key.split(':');
          const queueDate = keyParts[4] || this.getQueueDate();
          await this.invalidateQueueReadCaches({
            clinicId,
            domain,
            doctorId: entryData.doctorId || entryData.queueOwnerId || undefined,
            date: queueDate,
            locationId: entryData.locationId,
            appointmentId,
          });

          await this.emitAppointmentQueueEvent('appointment.queue.updated', {
            eventId: `queue-confirm-${appointmentId}-${Date.now()}`,
            priority: EventPriority.NORMAL,
            payload: {
              doctorId: entryData.doctorId || entryData.queueOwnerId,
              domain,
              action: 'CONFIRMED',
              appointmentId,
              clinicId,
              queueOwnerId: entryData.queueOwnerId || entryData.doctorId,
              queueCategory:
                entryData.queueCategory || AppointmentQueueCategory.DOCTOR_CONSULTATION,
              displayLabel: entryData.displayLabel,
              locationId: entryData.locationId,
            },
          });

          void this.loggingService.log(
            LogType.APPOINTMENT,
            LogLevel.INFO,
            'Appointment confirmed in queue',
            'AppointmentQueueService',
            { appointmentId, domain, responseTime: Date.now() - startTime }
          );

          return { success: true, message: 'Appointment confirmed' };
        }
      }

      throw new Error('Appointment not found in queue');
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to confirm appointment: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentQueueService',
        {
          appointmentId,
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async startConsultation(
    appointmentId: string,
    doctorId: string,
    clinicId: string,
    domain: string
  ): Promise<OperationResponse> {
    const startTime = Date.now();

    try {
      // P1 FIX: Include clinicId in key
      await this.ensureLiveQueueHydrated(clinicId, domain);
      const queueKey = `queue:${domain}:${clinicId}:${doctorId}:${formatDateKeyInIST(new Date())}`;
      const entryData = await this.withQueueLock(queueKey, async () => {
        const entries = await this.cacheService.lRange(queueKey, 0, -1);

        const entryIndex = entries.findIndex(entry => {
          const parsed = JSON.parse(entry) as QueueEntryData;
          return parsed.appointmentId === appointmentId;
        });

        if (entryIndex === -1) {
          throw new NotFoundException(`Appointment ${appointmentId} not found in queue`);
        }

        const parsedEntryData = JSON.parse(entries[entryIndex] || '{}') as QueueEntryData;
        parsedEntryData.status = 'IN_PROGRESS';
        parsedEntryData.startedAt = nowIso();
        parsedEntryData.actualWaitTime = this.calculateActualWaitTime(
          parsedEntryData.checkedInAt || ''
        );
        const updatedEntries = [...entries];
        updatedEntries[entryIndex] = JSON.stringify(parsedEntryData);
        await this.rewriteQueueList(queueKey, updatedEntries, entries.length);
        return parsedEntryData;
      });

      // Invalidate cache
      await this.invalidateQueueReadCaches({
        clinicId,
        domain,
        doctorId,
        date: formatDateKeyInIST(new Date()),
        locationId: entryData.locationId,
        appointmentId,
      });

      // Emit WebSocket event for queue update (consultation started)
      try {
        // Recalculate queue positions after consultation started
        const updatedEntries = await this.cacheService.lRange(queueKey, 0, -1);
        const updatedPositions = updatedEntries.map((entry, index) => {
          const entryData = JSON.parse(entry) as QueueEntryData;
          return {
            appointmentId: entryData.appointmentId,
            position: index + 1,
          };
        });

        await this.emitAppointmentQueueEvent('appointment.queue.updated', {
          eventId: `queue-updated-${doctorId}-${Date.now()}`,
          priority: EventPriority.NORMAL,
          payload: {
            doctorId,
            domain,
            action: 'STARTED',
            appointmentId,
            clinicId,
            queueOwnerId: doctorId,
            queueCategory: AppointmentQueueCategory.DOCTOR_CONSULTATION,
            displayLabel:
              entryData.displayLabel ||
              this.resolveDisplayLabel(
                AppointmentQueueCategory.DOCTOR_CONSULTATION,
                entryData.type
              ),
            queuePositions: updatedPositions,
          },
        });
      } catch (eventError) {
        // Don't fail if event emission fails
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Failed to emit queue update event: ${eventError instanceof Error ? eventError.message : String(eventError)}`,
          'AppointmentQueueService'
        );
      }

      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Consultation started',
        'AppointmentQueueService',
        {
          appointmentId,
          doctorId,
          domain,
          responseTime: Date.now() - startTime,
        }
      );

      return { success: true, message: 'Consultation started' };
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to start consultation: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentQueueService',
        {
          appointmentId,
          doctorId,
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async reorderQueue(
    reorderData: {
      doctorId: string;
      clinicId: string;
      date: string;
      newOrder: string[];
    },
    domain: string
  ): Promise<OperationResponse> {
    const startTime = Date.now();

    try {
      const { doctorId, clinicId, date, newOrder } = reorderData;
      await this.ensureLiveQueueHydrated(clinicId, domain, date);
      // P1 FIX: Include clinicId
      const queueKey = `queue:${domain}:${clinicId}:${doctorId}:${date}`;

      const reorderedEntries = await this.withQueueLock(queueKey, async () => {
        // Get current queue
        const entries = await this.cacheService.lRange(queueKey, 0, -1);

        // Reorder based on new order
        const reordered = newOrder
          .map((appointmentId: string) => {
            return entries.find(entry => {
              const entryData = JSON.parse(entry) as QueueEntryData;
              return entryData.appointmentId === appointmentId;
            });
          })
          .filter(Boolean);

        // Clear and repopulate queue
        await this.rewriteQueueList(
          queueKey,
          reordered.map(entry => entry as string),
          entries.length
        );
        return reordered;
      });

      // Invalidate cache
      await this.invalidateQueueReadCaches({
        clinicId,
        domain,
        doctorId,
        date,
      });

      // Emit WebSocket event for queue reorder
      if (this.typedEventService) {
        try {
          const updatedPositions = reorderedEntries.map((entry, index) => {
            const entryData = JSON.parse(entry as string) as QueueEntryData;
            return {
              appointmentId: entryData.appointmentId,
              position: index + 1,
            };
          });

          await this.typedEventService.emitEnterprise('appointment.queue.reordered', {
            eventId: `queue-reordered-${doctorId}-${Date.now()}`,
            eventType: 'appointment.queue.reordered',
            category: EventCategory.APPOINTMENT,
            priority: EventPriority.NORMAL,
            timestamp: nowIso(),
            source: 'AppointmentQueueService',
            version: '1.0.0',
            payload: {
              doctorId,
              date,
              domain,
              action: 'REORDERED',
              clinicId,
              queueOwnerId: doctorId,
              queueCategory: AppointmentQueueCategory.DOCTOR_CONSULTATION,
              queuePositions: updatedPositions,
            },
          });
          await this.emitAppointmentQueueEvent('appointment.queue.updated', {
            eventId: `queue-reordered-alias-${doctorId}-${Date.now()}`,
            priority: EventPriority.NORMAL,
            payload: {
              doctorId,
              date,
              domain,
              action: 'REORDERED',
              clinicId,
              queueOwnerId: doctorId,
              queueCategory: AppointmentQueueCategory.DOCTOR_CONSULTATION,
              queuePositions: updatedPositions,
            },
          });
        } catch (eventError) {
          // Don't fail if event emission fails
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Failed to emit queue reorder event: ${eventError instanceof Error ? eventError.message : String(eventError)}`,
            'AppointmentQueueService'
          );
        }
      }

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Queue reordered successfully',
        'AppointmentQueueService',
        {
          doctorId,
          date,
          domain,
          newOrderLength: newOrder.length,
          responseTime: Date.now() - startTime,
        }
      );

      return { success: true, message: 'Queue reordered successfully' };
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to reorder queue: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentQueueService',
        {
          reorderData,
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async getLocationQueueStats(
    locationId: string,
    clinicId: string,
    domain: string
  ): Promise<LocationQueueStatsResponse> {
    const startTime = Date.now();
    // P1 FIX: Include clinicId in metrics cache
    const cacheKey = `queue:stats:location:${clinicId}:${locationId}:${domain}`;

    try {
      await this.ensureLiveQueueHydrated(clinicId, domain);
      // Try to get from cache first
      const cached = await this.cacheService.get<LocationQueueStatsResponse>(cacheKey);
      if (cached) {
        return cached;
      }

      // Get all queues for the location (scoped by clinic)
      const pattern = `queue:${domain}:${clinicId}:*`;
      const queueKeys = await this.cacheService.keys(pattern);

      let totalWaiting = 0;
      let totalWaitTime = 0;
      let completedCount = 0;

      for (const key of queueKeys) {
        const entries = await this.cacheService.lRange(key, 0, -1);

        for (const entry of entries) {
          const entryData = JSON.parse(entry) as QueueEntryData;
          if (entryData.locationId === locationId) {
            if (entryData.status === 'WAITING') {
              totalWaiting++;
              totalWaitTime += entryData.estimatedWaitTime || 0;
            } else if (entryData.status === 'COMPLETED') {
              completedCount++;
            }
          }
        }
      }

      const averageWaitTime = totalWaiting > 0 ? totalWaitTime / totalWaiting : 0;
      const efficiency =
        completedCount > 0 ? (completedCount / (completedCount + totalWaiting)) * 100 : 0;
      const utilization = totalWaiting > 0 ? Math.min((totalWaiting / 50) * 100, 100) : 0; // Assuming max capacity of 50

      const result: LocationQueueStatsResponse = {
        locationId,
        domain,
        stats: {
          totalWaiting,
          averageWaitTime,
          efficiency,
          utilization,
          completedCount,
        },
      };

      // Cache the result (CacheService handles serialization internally)
      await this.cacheService.set(cacheKey, result as unknown as string, this.METRICS_CACHE_TTL);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Location queue stats retrieved successfully',
        'AppointmentQueueService',
        {
          locationId,
          domain,
          totalWaiting,
          responseTime: Date.now() - startTime,
        }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get location queue stats: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentQueueService',
        {
          locationId,
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async getQueueMetrics(
    locationId: string,
    clinicId: string,
    domain: string,
    period: string
  ): Promise<QueueMetricsResponse> {
    const startTime = Date.now();
    const cacheKey = `queue:metrics:${clinicId}:${locationId}:${domain}:${period}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get<QueueMetricsResponse>(cacheKey);
      if (cached) {
        return cached;
      }

      // Calculate metrics based on period
      const statsResult = await this.getLocationQueueStats(locationId, clinicId, domain);

      // Add period-specific calculations
      const metrics: QueueMetricsResponse = {
        ...statsResult,
        period,
        metrics: {
          efficiency: statsResult.stats.efficiency || 0,
          utilization: statsResult.stats.utilization || 0,
          throughput: this.calculateThroughput(domain, period),
          responseTime: this.calculateAverageResponseTime(domain, period),
        },
      };

      // Cache the result (CacheService handles serialization internally)
      // Registered in a per location / domain tag set, so a check-in drops every period's entry
      // with SMEMBERS + DEL instead of a keyspace SCAN (invalidateQueueReadCaches).
      await this.cacheService.set(cacheKey, metrics as unknown as string, {
        ttl: this.METRICS_CACHE_TTL,
        tags: [queueMetricsTag(clinicId, locationId, domain)],
      });

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Queue metrics retrieved successfully',
        'AppointmentQueueService',
        { locationId, domain, period, responseTime: Date.now() - startTime }
      );

      return metrics;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get queue metrics: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentQueueService',
        {
          locationId,
          domain,
          period,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async handleEmergencyAppointment(
    appointmentId: string,
    priority: number,
    clinicId: string,
    domain: string
  ): Promise<OperationResponse> {
    const startTime = Date.now();

    try {
      // Find the appointment in queue (scoped by clinic)
      await this.ensureLiveQueueHydrated(clinicId, domain);
      const pattern = `queue:${domain}:${clinicId}:*`;
      const queueKeys = await this.cacheService.keys(pattern);

      for (const key of queueKeys) {
        const entries = await this.cacheService.lRange(key, 0, -1);
        const entryIndex = entries.findIndex(entry => {
          const entryData = JSON.parse(entry) as QueueEntryData;
          return entryData.appointmentId === appointmentId;
        });

        if (entryIndex !== -1) {
          const entryData = JSON.parse(entries[entryIndex] || '{}') as QueueEntryData;
          entryData.priority = priority;
          entryData.status = 'EMERGENCY';
          entryData.emergencyAt = nowIso();

          // Remove from current position and add to front of queue
          const updatedEntries = entries.filter((_, index) => index !== entryIndex);
          await this.cacheService.del(key);
          await this.cacheService.rPush(key, JSON.stringify(entryData));
          for (const entry of updatedEntries) {
            await this.cacheService.rPush(key, entry);
          }

          await this.invalidateQueueReadCaches({
            clinicId,
            domain,
            doctorId: entryData.doctorId || entryData.queueOwnerId,
            date: key.split(':')[4] || this.getQueueDate(),
            locationId: entryData.locationId,
            appointmentId,
          });

          void this.loggingService.log(
            LogType.APPOINTMENT,
            LogLevel.INFO,
            'Emergency appointment handled',
            'AppointmentQueueService',
            {
              appointmentId,
              priority,
              domain,
              responseTime: Date.now() - startTime,
            }
          );

          return {
            success: true,
            message: 'Emergency appointment prioritized',
          };
        }
      }

      throw new NotFoundException(`Appointment ${appointmentId} not found in queue`);
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to handle emergency appointment: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentQueueService',
        {
          appointmentId,
          priority,
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  /**
   * Raises (or clears) the priority of a patient who is already in the live queue, in place:
   * the entry keeps its token and status, only `priority` / `priorityLabel` / `priorityReason`
   * change. Reads sort by priority (highest first) then check-in time, so the patient moves ahead
   * of normal-priority waiters on the next read. Returns `updated: false` when the appointment is
   * not in any queue of the clinic (not checked in yet) - the caller still stores the priority on
   * the appointment so check-in applies it.
   */
  async setEntryPriority(
    appointmentId: string,
    change: { priority: number; label: string | null; reason: string | null },
    clinicId: string,
    domain: string
  ): Promise<{ updated: boolean; queueKey?: string }> {
    await this.ensureLiveQueueHydrated(clinicId, domain);
    const keys = await this.cacheService.keys(`queue:${domain}:${clinicId}:*`);
    for (const key of keys) {
      const entries = await this.cacheService.lRange(key, 0, -1);
      const hit = entries.some(entry => {
        try {
          return (JSON.parse(entry) as QueueEntryData).appointmentId === appointmentId;
        } catch {
          return false;
        }
      });
      if (!hit) continue;

      let touched: QueueEntryData | undefined;
      await this.withQueueLock(key, async () => {
        const fresh = await this.cacheService.lRange(key, 0, -1);
        const next = fresh.map(entry => {
          try {
            const parsed = JSON.parse(entry) as QueueEntryData;
            if (parsed.appointmentId !== appointmentId) return entry;
            parsed.priority = change.priority;
            if (change.label) {
              parsed.priorityLabel = change.label;
            } else {
              delete parsed.priorityLabel;
            }
            if (change.reason) {
              parsed.priorityReason = change.reason;
            } else {
              delete parsed.priorityReason;
            }
            touched = parsed;
            return JSON.stringify(parsed);
          } catch {
            return entry;
          }
        });
        await this.rewriteQueueList(key, next, fresh.length);
      });

      if (touched) {
        await this.invalidateQueueReadCaches({
          clinicId,
          domain,
          doctorId: touched.doctorId || touched.queueOwnerId,
          date: key.split(':')[4] || this.getQueueDate(),
          locationId: touched.locationId,
          appointmentId,
        });
        return { updated: true, queueKey: key };
      }
    }
    return { updated: false };
  }

  // Helper methods
  private calculateEstimatedWaitTime(position: number, domain: string): number {
    const baseWaitTime = domain === 'healthcare' ? 15 : 10; // minutes
    return position * baseWaitTime;
  }

  private calculateAverageWaitTime(queue: QueueEntryData[]): number {
    if (queue.length === 0) return 0;
    const totalWaitTime = queue.reduce(
      (sum: number, entry: QueueEntryData) => sum + (entry.estimatedWaitTime || 0),
      0
    );
    return totalWaitTime / queue.length;
  }

  private calculateActualWaitTime(checkedInAt: string): number {
    if (!checkedInAt) return 0;
    const checkedInTime = new Date(checkedInAt).getTime();
    const currentTime = Date.now();
    return Math.floor((currentTime - checkedInTime) / (1000 * 60)); // minutes
  }

  private calculateThroughput(domain: string, period: string): number {
    // Placeholder implementation - would integrate with actual analytics
    // Use period to determine throughput calculation
    const baseThroughput = domain === 'healthcare' ? 25 : 15;
    const periodMultiplier = period === 'daily' ? 1 : period === 'weekly' ? 7 : 1;
    return baseThroughput * periodMultiplier; // appointments per hour
  }

  private calculateAverageResponseTime(domain: string, period: string): number {
    // Placeholder implementation - would integrate with actual analytics
    // Use period to determine response time calculation
    const baseResponseTime = domain === 'healthcare' ? 12 : 8;
    const periodAdjustment = period === 'daily' ? 1 : period === 'weekly' ? 0.8 : 1;
    return Math.round(baseResponseTime * periodAdjustment); // minutes
  }

  async removePatientFromQueue(
    appointmentId: string,
    doctorId: string,
    clinicId: string,
    domain: string
  ): Promise<OperationResponse> {
    const date = formatDateKeyInIST(new Date());
    const queueKey = `queue:${domain}:${clinicId}:${doctorId}:${date}`;

    try {
      await this.ensureLiveQueueHydrated(clinicId, domain, date);
      const removedEntry = await this.withQueueLock(queueKey, async () => {
        const entries = await this.cacheService.lRange(queueKey, 0, -1);
        const newEntries = entries.filter(entry => {
          const data = JSON.parse(entry) as QueueEntryData;
          return data.appointmentId !== appointmentId;
        });

        if (entries.length === newEntries.length) {
          return undefined;
        }

        await this.rewriteQueueList(queueKey, newEntries, entries.length);
        return entries
          .map(entry => JSON.parse(entry) as QueueEntryData)
          .find(entry => entry.appointmentId === appointmentId);
      });

      if (!removedEntry) {
        return { success: false, message: 'Patient not found in queue' };
      }

      await this.invalidateQueueReadCaches({
        clinicId,
        domain,
        doctorId,
        date,
        locationId: removedEntry?.locationId,
        appointmentId,
      });

      // Emit Event
      await this.emitAppointmentQueueEvent('appointment.queue.updated', {
        eventId: `queue-remove-${appointmentId}-${Date.now()}`,
        priority: EventPriority.NORMAL,
        payload: {
          doctorId,
          domain,
          action: 'REMOVED',
          appointmentId,
          clinicId,
          queueOwnerId: doctorId,
          queueCategory: AppointmentQueueCategory.DOCTOR_CONSULTATION,
          displayLabel: removedEntry?.displayLabel,
        },
      });

      return { success: true, message: 'Patient removed from queue' };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to remove patient from queue: ${error instanceof Error ? error.message : String(error)}`,
        'AppointmentQueueService',
        { error: error instanceof Error ? error.stack : undefined }
      );
      throw error;
    }
  }

  async callNext(
    doctorId: string,
    clinicId: string,
    domain: string,
    appointmentId: string
  ): Promise<OperationResponse & { nextPatient?: QueueEntryData }> {
    const date = formatDateKeyInIST(new Date());
    // P1 FIX: Include clinicId
    const queueKey = `queue:${domain}:${clinicId}:${doctorId}:${date}`;

    try {
      await this.ensureLiveQueueHydrated(clinicId, domain, date);
      const entryData = await this.withQueueLock(queueKey, async () => {
        const entries = await this.cacheService.lRange(queueKey, 0, -1);

        // Find the specific patient being called
        const nextIndex = entries.findIndex(entry => {
          const data = JSON.parse(entry) as QueueEntryData;
          return data.appointmentId === appointmentId;
        });

        if (nextIndex === -1) {
          return null;
        }

        const parsedEntryData = JSON.parse(entries[nextIndex] || '{}') as QueueEntryData;
        parsedEntryData.status = 'IN_PROGRESS';
        parsedEntryData.startedAt = nowIso();

        // Update local array
        entries[nextIndex] = JSON.stringify(parsedEntryData);

        // Replace list in Redis
        await this.rewriteQueueList(queueKey, entries, entries.length);
        return parsedEntryData;
      });

      if (!entryData) {
        return { success: false, message: 'Patient not found in queue' };
      }

      // Invalidate cache
      await this.invalidateQueueReadCaches({
        clinicId,
        domain,
        doctorId,
        date,
        locationId: entryData.locationId,
        appointmentId,
      });

      // Emit Event
      await this.emitAppointmentQueueEvent('appointment.queue.updated', {
        eventId: `queue-callnext-${doctorId}-${Date.now()}`,
        priority: EventPriority.HIGH,
        payload: {
          doctorId,
          domain,
          action: 'CALL_NEXT',
          appointmentId: entryData.appointmentId,
          entryId: entryData.entryId,
          nextPatient: entryData,
          clinicId,
          queueOwnerId: doctorId,
          queueCategory: AppointmentQueueCategory.DOCTOR_CONSULTATION,
          displayLabel: entryData.displayLabel,
        },
      });

      return { success: true, message: 'Next patient called', nextPatient: entryData };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to call next patient: ${error instanceof Error ? error.message : String(error)}`,
        'AppointmentQueueService',
        { error: error instanceof Error ? error.stack : undefined }
      );
      throw error;
    }
  }

  async pauseQueue(doctorId: string, clinicId: string, domain: string): Promise<OperationResponse> {
    const date = formatDateKeyInIST(new Date());
    const now = Date.now();
    await this.cacheService.set(
      `queue:status:${domain}:${clinicId}:${doctorId}:${date}`,
      'PAUSED',
      86400 // 24h TTL — auto-resumes if the process crashes
    );
    // Record when the pause started so stale jobs can be filtered on resume
    await this.cacheService.set(
      `queue:pause:ts:${domain}:${clinicId}:${doctorId}:${date}`,
      String(now),
      86400
    );
    await this.invalidateQueueReadCaches({
      clinicId,
      domain,
      doctorId,
      date,
    });

    await this.emitAppointmentQueueEvent('appointment.queue.updated', {
      eventId: `queue-pause-${doctorId}-${Date.now()}`,
      priority: EventPriority.NORMAL,
      payload: {
        doctorId,
        domain,
        action: 'PAUSED',
        clinicId,
        queueOwnerId: doctorId,
        queueCategory: AppointmentQueueCategory.DOCTOR_CONSULTATION,
      },
    });
    return { success: true, message: 'Queue paused' };
  }

  /**
   * Pause flag of one owner's queue for a day: 'PAUSED' while pauseQueue is in effect, null
   * otherwise. Read-only; the key is the one pauseQueue / resumeQueue maintain.
   */
  async getQueuePauseStatus(
    doctorId: string,
    clinicId: string,
    date: string,
    domain: string
  ): Promise<string | null> {
    const status = await this.cacheService.get<string>(
      `queue:status:${domain}:${clinicId}:${doctorId}:${date}`
    );
    return typeof status === 'string' && status.length > 0 ? status : null;
  }

  async resumeQueue(
    doctorId: string,
    clinicId: string,
    domain: string
  ): Promise<OperationResponse> {
    const date = formatDateKeyInIST(new Date());
    await this.cacheService.del(`queue:status:${domain}:${clinicId}:${doctorId}:${date}`);
    // Clean up the pause timestamp — stale-job filter (in the BullMQ job
    // processor) no longer needs it once resumed.
    //
    // Deliberately NOT touching the queue list itself here: an earlier
    // version rebuilt it by filtering entries against the resume timestamp,
    // but `checkedInAt` is always earlier than resume time by construction,
    // so that filter discarded every currently-waiting patient on every
    // pause/resume cycle. Resuming should only clear the paused status, not
    // mutate who's actually in the queue.
    await this.cacheService.del(`queue:pause:ts:${domain}:${clinicId}:${doctorId}:${date}`);

    await this.invalidateQueueReadCaches({
      clinicId,
      domain,
      doctorId,
      date,
    });

    await this.emitAppointmentQueueEvent('appointment.queue.updated', {
      eventId: `queue-resume-${doctorId}-${Date.now()}`,
      priority: EventPriority.NORMAL,
      payload: {
        doctorId,
        domain,
        action: 'RESUMED',
        clinicId,
        queueOwnerId: doctorId,
        queueCategory: AppointmentQueueCategory.DOCTOR_CONSULTATION,
      },
    });
    return { success: true, message: 'Queue resumed' };
  }

  private extractOwnerIdFromQueueKey(queueKey: string): string {
    const parts = queueKey.split(':');
    return parts.length >= 5 ? parts[3] || '' : '';
  }

  private mapTargetQueueToCategory(targetQueue: string): string {
    switch (targetQueue) {
      case 'DOCTOR_CONSULTATION':
      case 'CONSULTATION':
        return 'DOCTOR_CONSULTATION';
      case 'THERAPY_PROCEDURE':
      case 'THERAPY':
        return 'THERAPY_PROCEDURE';
      case 'MEDICINE_DESK':
      case 'PHARMACY':
        return 'MEDICINE_DESK';
      default:
        return targetQueue;
    }
  }

  private resolveQueueEntryType(queueCategory: string, treatmentType?: string): string {
    if (treatmentType) return String(treatmentType).trim().toUpperCase();
    if (queueCategory === 'DOCTOR_CONSULTATION') return 'CONSULTATION';
    if (queueCategory === 'THERAPY_PROCEDURE') return 'THERAPY';
    if (queueCategory === 'MEDICINE_DESK') return 'MEDICINE_DESK';
    return '';
  }
}
