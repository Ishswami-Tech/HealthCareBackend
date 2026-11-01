/**
 * `appointment.queue.patient_alert`: the one patient notification of the live in-person queue
 * ("2 ahead - please be near the consultation room" / "You're next - Dr X will call you shortly").
 *
 * QueuePatientAlertService emits it after a queue MUTATION (call-next, start, remove / no-show,
 * priority, reorder, check-in) once per appointment and threshold (Dragonfly SET NX, end of day),
 * with the recipient already resolved to the patient's User.id and the text already built. The
 * notification listener only routes it: in-app (socket) + push, preferences and quiet hours
 * respected, no extra appointment lookup, no per-appointment dedup window (NEAR then NEXT of the
 * same appointment can be seconds apart and both must go out).
 */
import type { EnterpriseEventPayload } from '@core/types';

export const QUEUE_PATIENT_ALERT_EVENT = 'appointment.queue.patient_alert';

export type QueuePatientAlertThreshold = 'NEAR' | 'NEXT';

/** What the emitter puts in the envelope `metadata` (all strings / numbers, no PHI beyond token). */
export interface QueuePatientAlertMetadata {
  appointmentId: string;
  clinicId: string;
  doctorId: string;
  /** User.id of the patient (Patient -> User resolved by the emitter). */
  patientUserId: string;
  threshold: QueuePatientAlertThreshold;
  peopleAhead: number;
  /** 1-based place in the waiting line (peopleAhead + 1). */
  position: number;
  token: string | null;
  doctorName: string | null;
  title: string;
  body: string;
}

export function isQueuePatientAlertEvent(eventType: string): boolean {
  return eventType === QUEUE_PATIENT_ALERT_EVENT;
}

type AlertEnvelope = Pick<EnterpriseEventPayload, 'userId' | 'metadata'>;

function text(envelope: AlertEnvelope, key: keyof QueuePatientAlertMetadata): string {
  const value = envelope.metadata?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** The patient's user id (envelope userId first, then metadata.patientUserId). */
export function queuePatientAlertRecipientUserId(envelope: AlertEnvelope): string | null {
  const userId = (envelope.userId ?? '').trim() || text(envelope, 'patientUserId');
  return userId || null;
}

/** The text the emitter built; a generic fallback when it is missing. */
export function queuePatientAlertContent(envelope: AlertEnvelope): { title: string; body: string } {
  return {
    title: text(envelope, 'title') || 'Queue update',
    body: text(envelope, 'body') || 'Your turn is coming up soon.',
  };
}
