/**
 * Pure helpers for validating FHIR request input and bounding work. No Nest imports, so they
 * can be unit-tested directly.
 */

export const PATIENT_PARAM_MAX_LENGTH = 64;
export const EXPORT_REASON_MAX_LENGTH = 200;
export const USER_AGENT_MAX_LENGTH = 256;
export const DEFAULT_EXPORT_PURPOSE = 'treatment';
export const VISIT_READ_CONCURRENCY = 4;

const PATIENT_ID_PATTERN = /^[A-Za-z0-9\-.]+$/;
const PATIENT_REFERENCE_PREFIX = 'Patient/';

/** A query-string value as Fastify delivers it: absent, one string, or repeated (array). */
export type RawQueryValue = string | string[] | undefined;

export type ParseResult =
  { readonly ok: true; readonly value: string } | { readonly ok: false; readonly message: string };

/** Accepts `abc` or `Patient/abc`; rejects missing, repeated (array) and malformed values. */
export function parsePatientParam(raw: RawQueryValue): ParseResult {
  if (typeof raw !== 'string') {
    return { ok: false, message: 'Exactly one "patient" parameter is required' };
  }
  const trimmed = raw.trim();
  const id = trimmed.startsWith(PATIENT_REFERENCE_PREFIX)
    ? trimmed.slice(PATIENT_REFERENCE_PREFIX.length)
    : trimmed;
  if (id.length === 0 || id.length > PATIENT_PARAM_MAX_LENGTH || !PATIENT_ID_PATTERN.test(id)) {
    return { ok: false, message: 'The "patient" parameter must be a Patient id' };
  }
  return { ok: true, value: id };
}

/** Optional free-text reason: absent/blank gives the default; repeated or too long is invalid. */
export function parseExportReason(raw: RawQueryValue): ParseResult {
  if (raw === undefined) return { ok: true, value: DEFAULT_EXPORT_PURPOSE };
  if (typeof raw !== 'string') {
    return { ok: false, message: 'The "reason" parameter may be given only once' };
  }
  const trimmed = raw.trim();
  if (trimmed.length > EXPORT_REASON_MAX_LENGTH) {
    return {
      ok: false,
      message: `The "reason" parameter must be at most ${EXPORT_REASON_MAX_LENGTH} characters`,
    };
  }
  return { ok: true, value: trimmed.length > 0 ? trimmed : DEFAULT_EXPORT_PURPOSE };
}

export function truncateUserAgent(value: string | string[] | undefined): string | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  return typeof text === 'string' && text.length > 0
    ? text.slice(0, USER_AGENT_MAX_LENGTH)
    : undefined;
}

/** Maps `items` with at most `limit` calls in flight; results keep input order. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  const workers = Math.max(1, Math.min(Math.floor(limit), items.length));
  let next = 0;
  const run = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: workers }, run));
  return results;
}
