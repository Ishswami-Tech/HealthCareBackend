import type { ConsentPurpose, PatientConsentRecord } from '@core/types/compliance.types';

type ConsentLedgerRow = Pick<PatientConsentRecord, 'purpose' | 'status' | 'recordedAt'>;

function recordedAtMs(row: ConsentLedgerRow): number {
  return row.recordedAt instanceof Date ? row.recordedAt.getTime() : Number.NaN;
}

/**
 * Latest ledger row per purpose. The ledger is append-only, so the newest row is the current
 * state. Ties on `recordedAt` are resolved in favour of the row that appears later in the input
 * (callers pass rows ordered oldest to newest or rely on distinct timestamps).
 */
export function resolveCurrentConsents<T extends ConsentLedgerRow>(
  rows: readonly T[]
): Map<ConsentPurpose, T> {
  const latest = new Map<ConsentPurpose, T>();
  for (const row of rows) {
    const current = latest.get(row.purpose);
    if (!current || recordedAtMs(row) >= recordedAtMs(current)) {
      latest.set(row.purpose, row);
    }
  }
  return latest;
}

/** True only when the newest row for the purpose is a GRANT. No row means no consent. */
export function isConsentGranted(
  rows: readonly ConsentLedgerRow[],
  purpose: ConsentPurpose
): boolean {
  return resolveCurrentConsents(rows).get(purpose)?.status === 'GRANTED';
}
