/**
 * In-app inbox entry (Notification row, channel `socket`) for an appointment notification.
 * The web bell / mobile notifications screen read these rows; email / WhatsApp / push deliveries
 * do not create one for appointment events, so booking, confirmation, reschedule, cancellation
 * and expiry would otherwise never show up in the app. One row per (appointment, type): the
 * caller guards it with a short-lived lock built by `appointmentInboxLockKey`.
 */

export type AppointmentInboxType =
  'created' | 'confirmation' | 'reschedule' | 'cancellation' | 'expired';

const INBOX_TYPES: ReadonlySet<string> = new Set<AppointmentInboxType>([
  'created',
  'confirmation',
  'reschedule',
  'cancellation',
  'expired',
]);

/** Lock lifetime: long enough to absorb a duplicate event for the same change. */
export const APPOINTMENT_INBOX_LOCK_TTL_SECONDS = 600;

export interface AppointmentInboxFacts {
  readonly doctorName?: string | null;
  readonly appointmentDate?: string | null;
  readonly appointmentTime?: string | null;
  readonly clinicName?: string | null;
}

export interface AppointmentInboxEntry {
  readonly title: string;
  readonly message: string;
}

export function isAppointmentInboxType(type: string): type is AppointmentInboxType {
  return INBOX_TYPES.has(type);
}

export function appointmentInboxLockKey(appointmentId: string, type: string): string {
  return `notif:inapp:appointment:${appointmentId}:${type}`;
}

function clean(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function doctorLabel(name: string): string {
  if (!name) return 'your doctor';
  return /^dr\.?\s/i.test(name) ? name : `Dr. ${name}`;
}

function whenLabel(facts: AppointmentInboxFacts): string {
  const date = clean(facts.appointmentDate);
  const time = clean(facts.appointmentTime);
  if (date && time) return ` on ${date} at ${time}`;
  if (date) return ` on ${date}`;
  return '';
}

/** Title and message of the inbox row, or null for types that have no inbox entry. */
export function buildAppointmentInboxEntry(
  type: string,
  facts: AppointmentInboxFacts
): AppointmentInboxEntry | null {
  if (!isAppointmentInboxType(type)) return null;
  const doctor = doctorLabel(clean(facts.doctorName));
  const when = whenLabel(facts);
  const clinic = clean(facts.clinicName);
  const at = clinic ? ` at ${clinic}` : '';
  switch (type) {
    case 'created':
      return {
        title: 'Appointment booked',
        message: `Your appointment with ${doctor}${when}${at} is booked.`,
      };
    case 'confirmation':
      return {
        title: 'Appointment confirmed',
        message: `Your appointment with ${doctor}${when}${at} is confirmed.`,
      };
    case 'reschedule':
      return {
        title: 'Appointment rescheduled',
        message: `Your appointment with ${doctor} was moved${when ? ` to${when.replace(/^ on/, '')}` : ''}.`,
      };
    case 'cancellation':
      return {
        title: 'Appointment cancelled',
        message: `Your appointment with ${doctor}${when} was cancelled.`,
      };
    case 'expired':
      return {
        title: 'Appointment expired',
        message: `Your appointment with ${doctor}${when} expired before it was completed. Book again when you are ready.`,
      };
    default:
      return null;
  }
}
