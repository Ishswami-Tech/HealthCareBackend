/**
 * Recognising database errors after DatabaseService has wrapped them.
 *
 * `executeHealthcareWrite` rethrows every callback error as a generic HealthcareError
 * ("Write operation failed: ...") whose original message sits in `message` and
 * `metadata.originalError`. A `catch` that tests `error.code === 'P2002'` therefore never matches
 * and the intended 409 becomes a 500. This helper looks at every place the information can be.
 */

const UNIQUE_VIOLATION_PATTERN = /P2002|Unique constraint failed|duplicate key value/i;
const MAX_DEPTH = 3;

interface ErrorLike {
  code?: unknown;
  message?: unknown;
  cause?: unknown;
  metadata?: { originalError?: unknown; originalErrorMessage?: unknown } | null;
}

function textMatches(value: unknown): boolean {
  return typeof value === 'string' && UNIQUE_VIOLATION_PATTERN.test(value);
}

export function isUniqueViolation(error: unknown, depth = 0): boolean {
  if (typeof error !== 'object' || error === null || depth > MAX_DEPTH) {
    return false;
  }
  const candidate = error as ErrorLike;
  if (candidate.code === 'P2002') return true;
  if (
    textMatches(candidate.message) ||
    textMatches(candidate.metadata?.originalError) ||
    textMatches(candidate.metadata?.originalErrorMessage)
  ) {
    return true;
  }
  return isUniqueViolation(candidate.cause, depth + 1);
}
