/**
 * One patient notification per appointment happening, not per event emitted.
 *
 * A recorded arrival emits two events for its listeners — `appointment.checked_in` and
 * `appointment.confirmed` (CHECK_IN_EVENT_NAMES) — and the notification listener turned each into
 * its own notification. A walk-in is booked and checked in within the same second, so the patient
 * got "Appointment booked" and "Appointment confirmed" (plus a third "updated" push) for one desk
 * action (clinic-day run 2026-10-31: 14 duplicate inbox pairs).
 *
 * Rules:
 * - Both events of one check-in share the key `check-in|<appointment>`: the first notifies.
 * - A booking and a check-in of the same appointment inside `firstContactWindowMs` are one
 *   "first contact": whichever arrives first notifies (walk-in = booked and arrived at once).
 * - Every other appointment event keeps its own key `<event>|<appointment>|<payment>` (repeats
 *   inside `ttlMs` are dropped, as before).
 */

export const CHECK_IN_KIND = 'check-in';
const CREATED_EVENT = 'appointment.created';
const CHECKED_IN_EVENT = 'appointment.checked_in';
const CONFIRMED_EVENT = 'appointment.confirmed';
const MAX_ENTRIES_BEFORE_SWEEP = 500;

export interface AppointmentEventFacts {
  appointmentId: string;
  paymentId: string;
  /** The payload carries check-in markers (checkInMethod / checkedInAt). */
  fromCheckIn: boolean;
}

/** What kind of happening an appointment event notifies about. */
export function appointmentNotificationKind(
  eventType: string,
  facts: AppointmentEventFacts
): string {
  if (eventType === CHECKED_IN_EVENT) return CHECK_IN_KIND;
  if (eventType === CONFIRMED_EVENT && facts.fromCheckIn && !facts.paymentId) return CHECK_IN_KIND;
  return eventType;
}

export class AppointmentNotificationDedup {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly firstContactWindowMs: number
  ) {}

  /** True when this event repeats a notification already sent; records it otherwise. */
  shouldSkip(eventType: string, facts: AppointmentEventFacts, now: number): boolean {
    if (!eventType.startsWith('appointment.')) return false;
    const appointment = facts.appointmentId || 'no-appointment';
    const kind = appointmentNotificationKind(eventType, facts);
    const key = `${kind}|${appointment}|${facts.paymentId || 'no-payment'}`;
    const firstContact =
      facts.appointmentId && (kind === CHECK_IN_KIND || kind === CREATED_EVENT)
        ? `first-contact|${facts.appointmentId}`
        : null;

    if (this.isFresh(key, now, this.ttlMs)) return true;
    if (firstContact && this.isFresh(firstContact, now, this.firstContactWindowMs)) {
      this.seen.set(key, now);
      return true;
    }

    this.seen.set(key, now);
    if (firstContact) this.seen.set(firstContact, now);
    this.sweep(now);
    return false;
  }

  private isFresh(key: string, now: number, windowMs: number): boolean {
    const last = this.seen.get(key);
    return last !== undefined && now - last < windowMs;
  }

  private sweep(now: number): void {
    if (this.seen.size <= MAX_ENTRIES_BEFORE_SWEEP) return;
    const horizon = Math.max(this.ttlMs, this.firstContactWindowMs);
    for (const [key, timestamp] of this.seen.entries()) {
      if (now - timestamp >= horizon) this.seen.delete(key);
    }
  }
}

export const APPOINTMENT_COMPLETED_EVENT = 'appointment.completed';

/**
 * Visit completion (doctor "save & complete"): exactly one clear patient push. When the visit has
 * a prescription with medicines, the pharmacy's "Prescription ready — ₹N" push already tells the
 * patient the visit is done and what to do next, so the completion goes to the live socket only
 * (screens refresh, no second push). Without one, the patient gets "Visit completed".
 */
export function appointmentCompletedChannels(
  hasPrescriptionWithMedicines: boolean
): Array<'push' | 'socket'> {
  return hasPrescriptionWithMedicines ? ['socket'] : ['push', 'socket'];
}

/** Push copy of a completed visit (no PHI: no diagnosis or medicine names). */
export const APPOINTMENT_COMPLETED_PUSH = Object.freeze({
  title: 'Visit completed',
  body: 'Your visit is complete. Open the app for your visit summary.',
});
