/**
 * Pure integrity helpers of the clinic-ops services (no Nest / database imports, unit-testable).
 * @module ClinicOps
 */

import { BadRequestException } from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';

/**
 * Hash of a hand-over code as stored on the row. Keyed (HMAC-SHA256) with a server secret when one
 * is configured, so a leaked table row cannot be brute-forced offline over the 10^6 code space.
 */
export function hashHandoverCode(handoverId: string, code: string, secret?: string): string {
  const message = `${handoverId}:${code}`;
  return secret
    ? createHmac('sha256', secret).update(message).digest('hex')
    : createHash('sha256').update(message).digest('hex');
}

/** Constant-time comparison of two hashes (false on any length mismatch). */
export function handoverHashesMatch(given: string, stored: string): boolean {
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(stored, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Deterministic id of the DOCTOR_LEAVE calendar block a leave approval creates (UUID-shaped,
 * version 5 / RFC variant, so the holiday routes' ParseUUIDPipe accepts it). Cancelling the leave
 * finds the block again through this id without a link column.
 */
export function leaveHolidayId(leaveRequestId: string): string {
  const hex = createHash('sha256').update(`leave-holiday:${leaveRequestId}`).digest('hex');
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

/** Order-independent signature of dispensed lines (`medicineId:qty`, merged and sorted). */
export function dispenseLinesSignature(
  lines: ReadonlyArray<{ medicineId: string; quantity: number }>
): string {
  const merged = new Map<string, number>();
  for (const line of lines) {
    merged.set(line.medicineId, (merged.get(line.medicineId) ?? 0) + line.quantity);
  }
  return [...merged.entries()]
    .map(([id, qty]) => `${id}:${qty}`)
    .sort()
    .join('|');
}

/**
 * The tests stored on a lab booking always come from the server-side package. A patient may
 * deselect tests (send a subset), but never add free-text tests the package does not include.
 */
export function resolvePackageTests(
  packageTests: readonly string[],
  requested?: readonly string[] | null
): string[] {
  if (!requested?.length) return [...packageTests];
  const allowed = new Set(packageTests);
  const unknown = requested.filter(t => !allowed.has(t));
  if (unknown.length) {
    throw new BadRequestException(`Tests not in this package: ${unknown.join(', ')}`);
  }
  return packageTests.filter(t => requested.includes(t));
}
