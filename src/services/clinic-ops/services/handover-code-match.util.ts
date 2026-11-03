/**
 * One collection code per patient visit at the counter (pure, unit-tested).
 *
 * A patient with several ready-to-collect prescriptions at a clinic gets ONE 6-digit code that
 * is stored (hashed per hand-over row) on every one of them. At the counter the desk enters the
 * code on whichever prescription it opened; the code is compared with every live hand-over row
 * of that patient at the clinic, and every row it matches is verified. So the right code typed
 * on the "wrong" prescription is never refused, and never spends a wrong-try attempt.
 */

export interface HandoverCandidateRow {
  id: string;
  prescriptionId: string;
  otpHash: string | null;
  otpExpiresAt: Date | null;
  otpAttempts: number;
}

export interface HandoverCandidates<Row extends HandoverCandidateRow> {
  /** Has a code, not expired, not locked: may be compared. */
  live: Row[];
  /** Has a code, still valid, but the wrong-try limit is reached. */
  locked: Row[];
  /** Has a code that expired. */
  expired: Row[];
}

/** Splits a patient's open (unverified) hand-over rows by what the desk may do with them. */
export function classifyHandoverCandidates<Row extends HandoverCandidateRow>(
  rows: readonly Row[],
  nowMs: number,
  maxAttempts: number
): HandoverCandidates<Row> {
  const result: HandoverCandidates<Row> = { live: [], locked: [], expired: [] };
  for (const row of rows) {
    if (!row.otpHash || !row.otpExpiresAt) continue;
    if (row.otpExpiresAt.getTime() < nowMs) {
      result.expired.push(row);
    } else if (row.otpAttempts >= maxAttempts) {
      result.locked.push(row);
    } else {
      result.live.push(row);
    }
  }
  return result;
}

/** Rows whose stored hash matches the entered code (hash keyed by each row's own id). */
export function matchHandoverCode<Row extends HandoverCandidateRow>(
  rows: readonly Row[],
  code: string,
  hashOf: (handoverId: string, code: string) => string,
  equals: (given: string, stored: string) => boolean
): Row[] {
  return rows.filter(row => row.otpHash !== null && equals(hashOf(row.id, code), row.otpHash));
}

/**
 * The hand-over the verify response describes: the one of the prescription the desk opened when
 * the code covered it, otherwise the first one the code verified.
 */
export function primaryVerifiedRow<Row extends HandoverCandidateRow>(
  verified: readonly Row[],
  prescriptionId: string
): Row | null {
  return verified.find(row => row.prescriptionId === prescriptionId) ?? verified[0] ?? null;
}

export type IdentityCheck = 'PHONE_LAST4' | 'UHID';

const digitsOf = (value: string): string => value.replace(/\D/g, '');

/**
 * Counter fallback without a code: the desk confirms the patient by the last 4 digits of the
 * phone on file, or by the clinic UHID (case- and space-insensitive). False when the record has
 * nothing to compare with.
 */
export function identityMatches(
  check: IdentityCheck,
  entered: string,
  record: { phone: string | null; uhids: readonly string[] }
): boolean {
  if (check === 'PHONE_LAST4') {
    const phone = digitsOf(record.phone ?? '');
    const given = digitsOf(entered);
    return phone.length >= 4 && given.length === 4 && phone.endsWith(given);
  }
  const normalize = (value: string): string => value.replace(/\s+/g, '').toUpperCase();
  const given = normalize(entered);
  return given.length > 0 && record.uhids.some(uhid => normalize(uhid) === given);
}
