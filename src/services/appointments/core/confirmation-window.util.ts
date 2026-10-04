import { getVideoActiveWindowMinutes } from '@config/video.config';
import { formatDateKeyInIST } from '@utils/date-time.util';

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
  const start = computeAppointmentStartTime(appointment);
  if (!start) return null;

  return new Date(start.getTime() + getVideoActiveWindowMinutes() * 60_000);
}

/**
 * The scheduled start instant of an appointment: its IST calendar day (`date`) combined with the
 * wall-clock `time` ("HH:mm"). Null when the date is missing or the pair does not parse. Used for
 * the ISO `startTime` the check-in candidate lists return next to the raw date/time pair.
 */
export function computeAppointmentStartTime(appointment: {
  date?: Date | string | null;
  time?: string | null;
}): Date | null {
  if (!appointment?.date) return null;

  const dateStr = formatDateKeyInIST(appointment.date);
  const timeStr = String(appointment.time || '00:00');

  const start = new Date(`${dateStr}T${timeStr}+05:30`);
  return Number.isNaN(start.getTime()) ? null : start;
}

/**
 * Returns the active-window length in minutes. The frontend uses this
 * value to drive the countdown interval length and badge labels
 * without needing to know the env config.
 */
export function getConfirmationWindowMinutes(): number {
  return getVideoActiveWindowMinutes();
}
