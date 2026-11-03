/**
 * Live queue rebuild (audit P0-1): the per doctor/day live list lives only in Dragonfly. When it
 * is lost (crash, OOM kill, flush), it is rebuilt from the database rows that are still waiting
 * or with the doctor: checked in today (IST), status CONFIRMED / IN_PROGRESS, with the token stored
 * on the appointment at check-in. Pure helpers here; the service runs the query and the writes.
 */
import type { QueueEntryData } from '@core/types/appointment.types';
import { readWalkInFlag } from '@utils/in-person-flow.util';

/**
 * THE queue priority scale (M3 / B6), shared by check-in, the rebuild, the desk priority action and
 * the staff lists. Only a RAISED priority moves a patient ahead: SENIOR / PREGNANT (HIGH 50),
 * URGENT 80, EMERGENCY 100. Every ordinary value (NORMAL, the DTO default MEDIUM, LOW, ROUTINE,
 * empty) is 0, so walk-in, desk-booked and self-booked patients are equal and served by token, and
 * resetting a priority to NORMAL puts the patient back at their arrival place.
 */
export const PRIORITY_WEIGHTS: Readonly<Record<string, number>> = {
  EMERGENCY: 100,
  URGENT: 80,
  HIGH: 50,
  MEDIUM: 0,
  NORMAL: 0,
  LOW: 0,
  ROUTINE: 0,
};

/** Weight of a priority value on THE scale (numbers are taken as they are, unknown is 0). */
export function queuePriorityWeight(priority: string | number | null | undefined): number {
  if (typeof priority === 'number') return Number.isFinite(priority) ? priority : 0;
  const key = String(priority ?? '')
    .trim()
    .toUpperCase();
  return PRIORITY_WEIGHTS[key] ?? 0;
}

/** DB statuses of an arrival that belongs in the live queue. */
export const LIVE_QUEUE_DB_STATUSES = ['CONFIRMED', 'IN_PROGRESS'] as const;

/** Upper bound of rows one rebuild reads for one clinic and day (500/day x several locations). */
export const LIVE_QUEUE_REBUILD_MAX_ROWS = 3000;

export interface LiveQueueRebuildRow {
  id: string;
  doctorId: string;
  patientId: string;
  clinicId: string;
  locationId: string | null;
  type: string;
  status: string;
  priority: string | null;
  metadata?: unknown;
  checkedInAt: Date | null;
  startedAt: Date | null;
  tokenNumber: number | null;
  tokenLabel: string | null;
}

/**
 * Check-in weight of a priority column value. NORMAL / empty is 0, the same as a check-in that
 * carries no raised priority, so a rebuilt list sorts exactly like the original one.
 */
export function rebuildPriorityWeight(priority: string | null | undefined): number {
  return queuePriorityWeight(priority);
}

function textOf(metadata: unknown, key: string): string | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

interface OrderFacts {
  priority: number;
  tokenNumber?: number | null | undefined;
  locationId?: string | null | undefined;
  arrivedAt: number;
}

function validToken(token: number | null | undefined): token is number {
  return typeof token === 'number' && Number.isInteger(token) && token > 0;
}

/**
 * Serving order of the live queue: priority (highest first); then, at the same location, the
 * token (one series per location, so K-004 is served before K-005 even when a burst of parallel
 * check-ins recorded their arrival times a few ms out of token order); otherwise arrival time.
 */
function compareOrderFacts(a: OrderFacts, b: OrderFacts): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (
    validToken(a.tokenNumber) &&
    validToken(b.tokenNumber) &&
    (a.locationId ?? '') === (b.locationId ?? '')
  ) {
    return a.tokenNumber - b.tokenNumber;
  }
  return a.arrivedAt - b.arrivedAt;
}

function arrivalMs(value: string | Date | null | undefined): number {
  const ms = value instanceof Date ? value.getTime() : new Date(value || 0).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/** Live entries in serving order (the order every queue read shows). */
export function compareLiveQueueEntries(
  a: Pick<QueueEntryData, 'priority' | 'tokenNumber' | 'locationId' | 'checkedInAt'>,
  b: Pick<QueueEntryData, 'priority' | 'tokenNumber' | 'locationId' | 'checkedInAt'>
): number {
  return compareOrderFacts(
    {
      priority: a.priority ?? 0,
      tokenNumber: a.tokenNumber,
      locationId: a.locationId,
      arrivedAt: arrivalMs(a.checkedInAt),
    },
    {
      priority: b.priority ?? 0,
      tokenNumber: b.tokenNumber,
      locationId: b.locationId,
      arrivedAt: arrivalMs(b.checkedInAt),
    }
  );
}

/** Database rows in the same serving order as the live entries they rebuild. */
export function compareRebuildRows(a: LiveQueueRebuildRow, b: LiveQueueRebuildRow): number {
  return compareOrderFacts(
    {
      priority: rebuildPriorityWeight(a.priority),
      tokenNumber: a.tokenNumber,
      locationId: a.locationId,
      arrivedAt: arrivalMs(a.checkedInAt),
    },
    {
      priority: rebuildPriorityWeight(b.priority),
      tokenNumber: b.tokenNumber,
      locationId: b.locationId,
      arrivedAt: arrivalMs(b.checkedInAt),
    }
  );
}

/** The live queue entry check-in would have written for this row (token from the database). */
export function toRebuiltEntry(
  row: LiveQueueRebuildRow,
  displayLabelOf: (appointmentType: string) => string
): QueueEntryData {
  const inProgress = String(row.status).toUpperCase() === 'IN_PROGRESS';
  const priorityLabel = textOf(row.metadata, 'priorityLabel');
  const priorityReason = textOf(row.metadata, 'priorityReason');
  return {
    appointmentId: row.id,
    patientId: row.patientId,
    doctorId: row.doctorId,
    clinicId: row.clinicId,
    status: inProgress ? 'IN_PROGRESS' : 'WAITING',
    checkedInAt: (row.checkedInAt ?? new Date()).toISOString(),
    ...(inProgress && row.startedAt ? { startedAt: row.startedAt.toISOString() } : {}),
    ...(typeof row.tokenNumber === 'number' && row.tokenNumber > 0
      ? { tokenNumber: row.tokenNumber }
      : {}),
    ...(row.tokenLabel ? { tokenLabel: row.tokenLabel } : {}),
    ...(readWalkInFlag(row.metadata) ? { isWalkIn: true } : {}),
    priority: rebuildPriorityWeight(row.priority),
    ...(priorityLabel ? { priorityLabel } : {}),
    ...(priorityReason ? { priorityReason } : {}),
    type: row.type,
    displayLabel: displayLabelOf(row.type),
    ...(row.locationId ? { locationId: row.locationId } : {}),
  };
}

/** Rows grouped per doctor (one live list each), every group in serving order. */
export function groupRebuildRowsByDoctor(
  rows: readonly LiveQueueRebuildRow[]
): Map<string, LiveQueueRebuildRow[]> {
  const groups = new Map<string, LiveQueueRebuildRow[]>();
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id) || !row.doctorId) continue;
    seen.add(row.id);
    groups.set(row.doctorId, [...(groups.get(row.doctorId) ?? []), row]);
  }
  return new Map(
    [...groups.entries()].map(([doctorId, list]) => [doctorId, [...list].sort(compareRebuildRows)])
  );
}

/**
 * Keep the first entry of every appointment. A check-in racing a rebuild can push the same
 * arrival twice (both carry the same stored token); reads must never show it twice.
 */
export function dedupeQueueEntries<T extends { appointmentId?: string | undefined }>(
  entries: readonly T[]
): T[] {
  const seen = new Set<string>();
  return entries.filter(entry => {
    const id = entry.appointmentId;
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Outcome of one live list consistency pass. */
export interface LiveListReconciliation {
  entries: QueueEntryData[];
  added: number;
  removed: number;
  updated: number;
}

const WAITING_ENTRY_STATUSES: ReadonlySet<string> = new Set(['WAITING', 'CONFIRMED', 'CHECKED_IN']);

/**
 * A check-in entry (it carries a token or a location, which operational lane items never do) is
 * written right after its appointment row is committed. Younger than this it may simply not be
 * visible to the read yet, so it is not judged an orphan.
 */
export const ORPHAN_ENTRY_GRACE_MS = 2 * 60_000;

const APPOINTMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True for a check-in entry whose appointment does not exist (deleted): its id is an appointment
 * id (UUID), it holds a token / location, and it is older than the grace period. Called only for
 * ids that are neither live nor a known appointment, so operational lane items (no appointment
 * id) stay.
 */
export function isOrphanCheckInEntry(entry: QueueEntryData, nowMs: number): boolean {
  if (!APPOINTMENT_ID_PATTERN.test(String(entry.appointmentId ?? ''))) return false;
  const isCheckInEntry =
    Boolean(entry.tokenLabel) || validToken(entry.tokenNumber) || Boolean(entry.locationId);
  if (!isCheckInEntry) return false;
  const since = Date.parse(String(entry.checkedInAt ?? ''));
  return !Number.isFinite(since) || nowMs - since >= ORPHAN_ENTRY_GRACE_MS;
}

/**
 * One doctor's live list made consistent with the database (worker cron, every 5 min):
 *   - an arrival of the day (CONFIRMED / IN_PROGRESS, checked in) missing from the list is added,
 *     with the token stored on the appointment;
 *   - an entry whose appointment is no longer live (completed, cancelled, no-show, expired ...)
 *     is removed, and so is a check-in entry whose appointment no longer exists (deleted); other
 *     ids that are not appointments (operational lane items, no token / location) are kept;
 *   - a live entry follows the database: status (waiting / in progress), stored token, and the
 *     priority weight on THE scale (old 20 / 30 weights become 0).
 * Pure: `liveRows` are the doctor's live rows, `knownStatuses` the database status of every
 * other entry id that IS an appointment.
 */
export function reconcileLiveEntries(
  current: readonly QueueEntryData[],
  liveRows: readonly LiveQueueRebuildRow[],
  knownStatuses: ReadonlyMap<string, string>,
  displayLabelOf: (appointmentType: string) => string,
  nowMs: number = Date.now()
): LiveListReconciliation {
  const liveById = new Map(liveRows.map(row => [row.id, row]));
  const seen = new Set<string>();
  const entries: QueueEntryData[] = [];
  let removed = 0;
  let updated = 0;

  for (const entry of dedupeQueueEntries(current)) {
    const id = entry.appointmentId;
    const row = id ? liveById.get(id) : undefined;
    if (!row) {
      if (id && (knownStatuses.has(id) || isOrphanCheckInEntry(entry, nowMs))) {
        removed += 1;
        continue;
      }
      entries.push(entry);
      continue;
    }
    seen.add(row.id);
    const inProgress = String(row.status).toUpperCase() === 'IN_PROGRESS';
    const entryStatus = String(entry.status ?? '').toUpperCase();
    const statusOk = inProgress
      ? entryStatus === 'IN_PROGRESS'
      : WAITING_ENTRY_STATUSES.has(entryStatus);
    const weight = rebuildPriorityWeight(row.priority);
    const token = validToken(row.tokenNumber) ? row.tokenNumber : undefined;
    const tokenOk = token === undefined || entry.tokenNumber === token;
    if (statusOk && (entry.priority ?? 0) === weight && tokenOk) {
      entries.push(entry);
      continue;
    }
    updated += 1;
    entries.push({
      ...entry,
      ...(statusOk ? {} : { status: inProgress ? 'IN_PROGRESS' : 'WAITING' }),
      ...(inProgress && !entry.startedAt && row.startedAt
        ? { startedAt: row.startedAt.toISOString() }
        : {}),
      priority: weight,
      ...(token !== undefined ? { tokenNumber: token } : {}),
      ...(token !== undefined && row.tokenLabel ? { tokenLabel: row.tokenLabel } : {}),
    });
  }

  let added = 0;
  for (const row of liveRows) {
    if (seen.has(row.id)) continue;
    added += 1;
    entries.push(toRebuiltEntry(row, displayLabelOf));
  }
  return { entries, added, removed, updated };
}
