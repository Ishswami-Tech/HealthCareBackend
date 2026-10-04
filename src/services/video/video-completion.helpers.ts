/**
 * Announcing that the video end route completed an appointment, and making sure the announcement
 * is not silently lost.
 *
 * `EventService.emitEnterprise` never throws: it resolves with `{ success: false }` when the
 * emission failed. A `try/catch` around it is therefore dead code, and a lost
 * `appointment.completed` leaves the payout of a COMPLETED visit pending forever. The helpers here
 * check the result, retry once, and let the caller persist a small marker
 * (`appointment.metadata.completionEventPending`) so a later end request can announce it again.
 */

import type { DatabaseService } from '@infrastructure/database/database.service';
import type { Prisma } from '@infrastructure/database/prisma/generated/client';
import type { EventService } from '@infrastructure/events/event.service';
import { EventCategory, EventPriority } from '@core/types';
import type { EnterpriseEventPayload, EventResult } from '@core/types/event.types';
import { AppointmentStatus } from '@core/types/enums.types';
import { extractErrorMessage } from '@core/errors/error-message.util';
import { HttpException } from '@nestjs/common';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';

/** Key of the marker in `appointment.metadata`: the completion event still has to be announced. */
export const COMPLETION_EVENT_PENDING_KEY = 'completionEventPending';

const COMPLETION_EMIT_ATTEMPTS = 2;

/** The slice of an appointment the completion event is built from. */
export interface CompletedAppointmentRef {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  type?: unknown;
  date?: unknown;
  time?: unknown;
  duration?: unknown;
}

export interface CompletionEmitResult {
  delivered: boolean;
  attempts: number;
  /** Why the last attempt failed (for the log only, never for a client). */
  failure?: string;
}

/**
 * The `appointment.completed` envelope, in the shape AppointmentsService.completeAppointment uses,
 * so payout readiness (billing), follow-up/EHR listeners and the patient notification run for a
 * visit completed through the video end route as well. The appointment is a compact summary, not
 * the loaded row: no payment records or profile data on the bus.
 */
export function buildAppointmentCompletedEvent(
  appointment: CompletedAppointmentRef,
  userId: string,
  completedAt: Date,
  nowMs: number
): EnterpriseEventPayload {
  return {
    eventId: `appointment-completed-${appointment.id}-${nowMs}`,
    eventType: 'appointment.completed',
    category: EventCategory.APPOINTMENT,
    priority: EventPriority.HIGH,
    timestamp: new Date(nowMs).toISOString(),
    source: 'VideoService',
    version: '1.0.0',
    userId: appointment.patientId || userId,
    clinicId: appointment.clinicId,
    payload: {
      appointmentId: appointment.id,
      clinicId: appointment.clinicId,
      completedBy: userId,
      status: AppointmentStatus.COMPLETED,
      patientId: appointment.patientId,
      doctorId: appointment.doctorId,
      appointment: {
        id: appointment.id,
        clinicId: appointment.clinicId,
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        type: appointment.type,
        date: appointment.date,
        time: appointment.time,
        duration: appointment.duration,
        status: AppointmentStatus.COMPLETED,
        completedAt,
      },
    },
  };
}

/**
 * Emit `appointment.completed`, checking the result and retrying once. An emission counts as
 * delivered unless the event service reports `success: false` or throws.
 */
export async function emitAppointmentCompletedWithRetry(
  eventService: Pick<EventService, 'emitEnterprise'>,
  appointment: CompletedAppointmentRef,
  userId: string,
  completedAt: Date
): Promise<CompletionEmitResult> {
  let failure: string | undefined;

  for (let attempt = 1; attempt <= COMPLETION_EMIT_ATTEMPTS; attempt += 1) {
    try {
      const result: EventResult | undefined = await eventService.emitEnterprise(
        'appointment.completed',
        buildAppointmentCompletedEvent(appointment, userId, completedAt, Date.now())
      );
      if (result?.success !== false) {
        return { delivered: true, attempts: attempt };
      }
      failure = result.error?.message ?? 'The event service reported a failed emission';
    } catch (error: unknown) {
      failure = extractErrorMessage(error) ?? 'Unknown error';
    }
  }

  return { delivered: false, attempts: COMPLETION_EMIT_ATTEMPTS, ...(failure ? { failure } : {}) };
}

/** True when the appointment's metadata says its completion event was never announced. */
export function hasCompletionEventPending(metadata: unknown): boolean {
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    !Array.isArray(metadata) &&
    (metadata as Record<string, unknown>)[COMPLETION_EVENT_PENDING_KEY] === true
  );
}

function toMetadataRecord(metadata: unknown): Record<string, unknown> {
  return typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

/**
 * Conditional merge of the marker into a COMPLETED appointment's metadata. The metadata is re-read
 * inside the write and only the one key changes, so a concurrent writer of another key (a rating)
 * is not overwritten with a stale snapshot. Returns true only when this call changed the marker.
 *
 * Setting is conditional on the appointment being COMPLETED in the given clinic; clearing is also
 * conditional on the marker still being set, so of two concurrent callers exactly one wins.
 */
async function writeCompletionMarker(
  databaseService: DatabaseService,
  appointment: { id: string; clinicId: string },
  userId: string,
  pending: boolean
): Promise<boolean> {
  return await databaseService.executeHealthcareWrite(
    async client => {
      const tx = client as unknown as Prisma.TransactionClient;
      const current = await tx.appointment.findUnique({
        where: { id: appointment.id },
        select: { metadata: true },
      });
      const metadata = toMetadataRecord(current?.metadata);
      if ((metadata[COMPLETION_EVENT_PENDING_KEY] === true) === pending) {
        return false;
      }

      const nextMetadata: Record<string, unknown> = pending
        ? { ...metadata, [COMPLETION_EVENT_PENDING_KEY]: true }
        : Object.fromEntries(
            Object.entries(metadata).filter(([key]) => key !== COMPLETION_EVENT_PENDING_KEY)
          );

      const result = await tx.appointment.updateMany({
        where: {
          id: appointment.id,
          clinicId: appointment.clinicId,
          status: AppointmentStatus.COMPLETED,
          ...(pending ? {} : { metadata: { path: [COMPLETION_EVENT_PENDING_KEY], equals: true } }),
        },
        data: { metadata: nextMetadata as Prisma.InputJsonValue },
      });
      return result.count > 0;
    },
    {
      userId,
      userRole: 'DOCTOR',
      clinicId: appointment.clinicId,
      operation: 'UPDATE_APPOINTMENT',
      resourceType: 'APPOINTMENT',
      resourceId: appointment.id,
      timestamp: new Date(),
      details: { marker: COMPLETION_EVENT_PENDING_KEY, pending },
    }
  );
}

/** Record that `appointment.completed` could not be announced, so a later end can re-announce it. */
export async function markCompletionEventPending(
  databaseService: DatabaseService,
  appointment: { id: string; clinicId: string },
  userId: string
): Promise<boolean> {
  return await writeCompletionMarker(databaseService, appointment, userId, true);
}

/**
 * Take the right to re-announce a pending completion event: clears the marker and returns true for
 * exactly one caller.
 */
export async function claimPendingCompletionEvent(
  databaseService: DatabaseService,
  appointment: { id: string; clinicId: string },
  userId: string
): Promise<boolean> {
  return await writeCompletionMarker(databaseService, appointment, userId, false);
}

/**
 * The doctor opening the call: move the appointment to IN_PROGRESS and claim the "first start".
 *
 * `startedAt` is the claim. The write that stamps it is conditional on `startedAt` still being
 * null, so of two devices (or a double tap) that open the call at the same moment exactly one
 * gets `firstStart: true` and tells the patient. The claim is decided by the database, not by a
 * value read earlier in the request, and a failed stamp claims nothing instead of re-notifying on
 * every rejoin.
 */

export interface DoctorStartAppointment {
  id: string;
  clinicId: string;
  status: unknown;
  startedAt?: Date | null | undefined;
}

export interface DoctorStartOutcome {
  /** True only for the call that stamped `startedAt`: the one that notifies the patient. */
  firstStart: boolean;
  /** True when this call changed the appointment row (the cache must be invalidated). */
  changed: boolean;
}

const NO_CHANGE: DoctorStartOutcome = { firstStart: false, changed: false };

/**
 * Claim the doctor's first start and/or move the appointment to IN_PROGRESS.
 *
 * Both writes are scoped to the appointment's clinic and conditional on the appointment still
 * being open. A visit that already has `startedAt` only gets the status move (legacy rows).
 *
 * @param openStatuses - statuses a visit can be started from
 */
export async function claimDoctorStart(
  databaseService: DatabaseService,
  appointment: DoctorStartAppointment,
  userId: string,
  openStatuses: readonly AppointmentStatus[]
): Promise<DoctorStartOutcome> {
  const needsStartedAt = !appointment.startedAt;
  const needsStatus = String(appointment.status) !== String(AppointmentStatus.IN_PROGRESS);
  if (!needsStartedAt && !needsStatus) {
    return NO_CHANGE;
  }

  return await databaseService.executeHealthcareWrite(
    async client => {
      const tx = client as unknown as Prisma.TransactionClient;
      const open = { in: [...openStatuses] };

      if (needsStartedAt) {
        const claim = await tx.appointment.updateMany({
          where: {
            id: appointment.id,
            clinicId: appointment.clinicId,
            status: open,
            startedAt: null,
          },
          data: { status: AppointmentStatus.IN_PROGRESS, startedAt: new Date() },
        });
        // Losing the race means another request stamped it first (and moved the status).
        return claim.count > 0 ? { firstStart: true, changed: true } : NO_CHANGE;
      }

      const moved = await tx.appointment.updateMany({
        where: { id: appointment.id, clinicId: appointment.clinicId, status: open },
        data: { status: AppointmentStatus.IN_PROGRESS },
      });
      return { firstStart: false, changed: moved.count > 0 };
    },
    {
      userId,
      userRole: 'DOCTOR',
      clinicId: appointment.clinicId,
      operation: 'UPDATE_APPOINTMENT',
      resourceType: 'APPOINTMENT',
      resourceId: appointment.id,
      timestamp: new Date(),
    }
  );
}

/**
 * Routing fields for the video lifecycle events the notification listener turns into patient
 * notifications (`video.consultation.started` / `video.consultation.ended`).
 *
 * The listener never loads the appointment; it reads who to notify from the event envelope:
 * - `userId`                    -> the patient's user account
 * - `clinicId`                  -> the appointment's clinic
 * - `metadata.appointmentId`    -> deep link target for the push
 * - `metadata.bookerUserId`     -> the account that booked the visit, when it is not the patient
 *                                  (already vetted by `resolveVideoBookerUserId`)
 * - `metadata.actorRole`        -> who caused the event ('doctor', 'patient', ...)
 * - `metadata.firstStart`       -> true when this was the doctor's first start of the visit
 *
 * Nothing here is clinical: ids and a role only (the notification text itself is generic).
 */

/** The slice of an appointment the routing fields are derived from. */
export interface VideoNotificationAppointment {
  id: string;
  clinicId: string;
  patient?: { userId?: string | null | undefined } | null | undefined;
  doctor?: { userId?: string | null | undefined } | null | undefined;
}

export interface VideoLifecycleRouting {
  clinicId: string;
  /** The patient's user account, omitted when the patient has no login. */
  userId?: string;
  metadata: Record<string, string | boolean>;
}

/**
 * Build the envelope fields (`userId`, `clinicId`, `metadata`) for a video lifecycle event.
 *
 * @param extraMetadata - event specific flags merged into `metadata` (actor role, first start)
 * @param eligibleBookerUserId - the booking account vetted by `resolveVideoBookerUserId`
 *   (a PATIENT-role user or the owner of the family dependent). It is dropped when it is the
 *   patient or the treating doctor, so the appointment's raw `userId` is never trusted here.
 */
export function buildVideoLifecycleRouting(
  appointment: VideoNotificationAppointment,
  extraMetadata: Record<string, string | boolean> = {},
  eligibleBookerUserId?: string | null
): VideoLifecycleRouting {
  const patientUserId = appointment.patient?.userId || undefined;
  const doctorUserId = appointment.doctor?.userId || undefined;
  const bookerUserId =
    eligibleBookerUserId &&
    eligibleBookerUserId !== patientUserId &&
    eligibleBookerUserId !== doctorUserId
      ? eligibleBookerUserId
      : undefined;

  return {
    clinicId: appointment.clinicId,
    ...(patientUserId ? { userId: patientUserId } : {}),
    metadata: {
      appointmentId: appointment.id,
      ...(bookerUserId ? { bookerUserId } : {}),
      ...extraMetadata,
    },
  };
}

/**
 * Video consultation error mapping helpers.
 *
 * Raw error text (Prisma messages, provider responses, stack traces) must only ever reach the
 * logger. These helpers classify an error so the service can answer with a fixed, generic
 * message while still telling the client apart "provider is down" (retry later) from a plain
 * internal failure.
 */

const SERVICE_UNAVAILABLE_STATUS = 503;
const GATEWAY_TIMEOUT_STATUS = 504;

const PROVIDER_UNAVAILABLE_CODES: ReadonlySet<string> = new Set<string>([
  ErrorCode.SERVICE_UNAVAILABLE,
  ErrorCode.EXTERNAL_SERVICE_UNAVAILABLE,
  ErrorCode.EXTERNAL_SERVICE_TIMEOUT,
]);

/** Node/undici network error codes that mean the provider could not be reached. */
const NETWORK_ERROR_CODES: ReadonlySet<string> = new Set<string>([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** Provider adapters throw `<Provider> ... failed with status <code>`; 429 and 5xx mean an outage. */
const PROVIDER_OUTAGE_STATUS_PATTERN = /failed with status (?:429|5\d\d)\b/;

function readStringProperty(source: unknown, key: string): string | undefined {
  if (typeof source !== 'object' || source === null) {
    return undefined;
  }
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * True only for errors that are recognisably "the video provider is unavailable or too slow":
 * aborted/timed-out requests, network failures, provider 429/5xx responses and the service's own
 * unavailable error codes. Everything else is an internal error.
 */
export function isProviderUnavailableError(error: unknown): boolean {
  if (error instanceof HealthcareError) {
    return PROVIDER_UNAVAILABLE_CODES.has(error.code);
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    return status === SERVICE_UNAVAILABLE_STATUS || status === GATEWAY_TIMEOUT_STATUS;
  }
  if (!(error instanceof Error)) {
    return false;
  }

  if (error.name === 'AbortError' || error.name === 'TimeoutError') {
    return true;
  }

  const ownCode = readStringProperty(error, 'code');
  if (ownCode && NETWORK_ERROR_CODES.has(ownCode)) {
    return true;
  }

  // undici reports network failures as `TypeError: fetch failed` with the reason in `cause`.
  const cause: unknown = (error as { cause?: unknown }).cause;
  const causeCode = readStringProperty(cause, 'code');
  if (causeCode && NETWORK_ERROR_CODES.has(causeCode)) {
    return true;
  }
  if (error instanceof TypeError && error.message === 'fetch failed') {
    return true;
  }

  return PROVIDER_OUTAGE_STATUS_PATTERN.test(error.message);
}
