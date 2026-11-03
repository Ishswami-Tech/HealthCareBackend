/**
 * Errors the database retry wrapper must never re-run.
 *
 * RetryService decides retryability by substring-matching the error name/message against a list
 * that includes `PrismaClient` (meant for "PrismaClient did not initialize yet" during startup).
 * Every query error Prisma raises is a `PrismaClientKnownRequestError`, so that entry made every
 * deterministic query failure "retryable": a duplicate phone (P2002 on `users_phone_key`) was
 * attempted twice before surfacing as a 500 (clinic-day run, 2026-10-31).
 *
 * A Prisma request error with a P2xxx code is a property of the query and the data, not of the
 * connection: re-running it gives the same answer. The two exceptions are transient by nature —
 * P2024 (timed out fetching a connection from the pool) and P2034 (write conflict / deadlock,
 * which Prisma itself documents as "please retry").
 *
 * A 4xx HttpException raised by business code inside the callback is a deliberate refusal and is
 * never retried either.
 */

const TRANSIENT_PRISMA_REQUEST_CODES: ReadonlySet<string> = new Set(['P2024', 'P2034']);
const PRISMA_REQUEST_CODE_PATTERN = /^P2\d{3}$/;
const CLIENT_ERROR_MIN = 400;
const CLIENT_ERROR_MAX = 499;

interface ErrorWithCode {
  code?: string | number;
  status?: number;
  getStatus?: () => number;
}

function readStatus(error: ErrorWithCode): number | undefined {
  if (typeof error.getStatus === 'function') {
    const status = error.getStatus();
    return typeof status === 'number' ? status : undefined;
  }
  return typeof error.status === 'number' ? error.status : undefined;
}

/** True when re-running the operation cannot change the outcome. */
export function isDeterministicDatabaseError(error: Error): boolean {
  const candidate = error as Error & ErrorWithCode;
  const code = typeof candidate.code === 'string' ? candidate.code : undefined;
  if (code && PRISMA_REQUEST_CODE_PATTERN.test(code)) {
    return !TRANSIENT_PRISMA_REQUEST_CODES.has(code);
  }
  const status = readStatus(candidate);
  return status !== undefined && status >= CLIENT_ERROR_MIN && status <= CLIENT_ERROR_MAX;
}
