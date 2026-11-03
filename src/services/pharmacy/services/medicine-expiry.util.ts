/**
 * New stock must not already be expired: an expiry date entered on medicine create / edit has to
 * be after today (IST calendar day, the clinic's day). Writing off expired stock goes through the
 * inventory movement flows (EXPIRY write-off), never through this field.
 */
import { formatDateKeyInIST } from '@utils/date-time.util';

export const PAST_EXPIRY_MESSAGE = 'Expiry date must be after today for new stock';

/** True when `expiry` falls on a later IST day than `now`. */
export function isFutureExpiry(expiry: Date, now: Date = new Date()): boolean {
  if (Number.isNaN(expiry.getTime())) return false;
  return formatDateKeyInIST(expiry) > formatDateKeyInIST(now);
}
