import { getVideoActiveWindowMinutes } from '@config/video.config';

/**
 * Compute the timestamp at which a CONFIRMED appointment will be
 * auto-expired by the backend scheduler if not completed.
 *
 * Mirrors the scheduler logic in
 * VideoAppointmentSchedulerService.handleExpiredConfirmedVideoAppointments
 * — the same source of truth (`getVideoActiveWindowMinutes`) is used so
 * the frontend's countdown is always in sync with what the backend will
 * actually do.
 *
 * Returns `null` when:
 * - date/time can't be derived from the row
 * - the appointment type doesn't participate in auto-expiry
 *
 * Frontend reads `confirmationExpiresAt` from the API response (populated
 * when the row was last CONFIRMED) and renders a live "Expires in"
 * countdown against it.
 */
export function computeConfirmationExpiresAt(appointment: {
  date?: Date | string | null;
  time?: string | null;
  type?: string | null;
}): Date | null {
  if (!appointment?.date) return null;

  const rawDate = appointment.date;
  const dateStr =
    rawDate instanceof Date ? rawDate.toISOString().slice(0, 10) : String(rawDate).slice(0, 10);
  const timeStr = String(appointment.time || '00:00');

  const start = new Date(`${dateStr}T${timeStr}+05:30`);
  if (Number.isNaN(start.getTime())) return null;

  return new Date(start.getTime() + getVideoActiveWindowMinutes() * 60_000);
}

/**
 * Returns the active-window length in minutes. The frontend uses this
 * value to drive the countdown interval length and badge labels
 * without needing to know the env config.
 */
export function getConfirmationWindowMinutes(): number {
  return getVideoActiveWindowMinutes();
}
