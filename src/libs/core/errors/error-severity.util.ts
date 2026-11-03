/**
 * Log severity of a caught error (pure, duck-typed so it needs no Nest import).
 *
 * A 4xx (HttpException / HealthcareError with a 4xx status) is the client or a business rule
 * saying "no": rate-limited OTP, patient too far from the clinic, unknown QR code, slot being
 * booked. That is expected traffic and belongs at WARN; logging it at ERROR buried the real
 * failures. Anything without a 4xx status (5xx, plain Error, provider failure) stays ERROR.
 */

import { LogLevel } from '@core/types/logging.types';

/** The HTTP status an error carries (`getStatus()`, `status` or `statusCode`), if any. */
export function httpStatusOf(error: unknown): number | undefined {
  if (error === null || typeof error !== 'object') return undefined;
  const candidate = error as { getStatus?: unknown; status?: unknown; statusCode?: unknown };
  if (typeof candidate.getStatus === 'function') {
    const status: unknown = (candidate.getStatus as () => unknown).call(error);
    if (typeof status === 'number') return status;
  }
  if (typeof candidate.status === 'number') return candidate.status;
  if (typeof candidate.statusCode === 'number') return candidate.statusCode;
  return undefined;
}

export function isClientError(error: unknown): boolean {
  const status = httpStatusOf(error);
  return status !== undefined && status >= 400 && status < 500;
}

/** WARN for an expected 4xx refusal, ERROR for everything else. */
export function logLevelForError(error: unknown): LogLevel {
  return isClientError(error) ? LogLevel.WARN : LogLevel.ERROR;
}
