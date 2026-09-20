/**
 * Error Message Extraction Utilities
 * ==================================
 * Part of the centralized healthcare error system.
 *
 * Third-party SDKs frequently reject with plain objects rather than `Error`
 * instances:
 *
 * - Razorpay: `{ statusCode, error: { code, description, reason, field } }`
 * - axios-based clients (Cashfree, PhonePe, ...): `{ response: { status, data: { message, code } } }`
 *
 * The common `error instanceof Error ? error.message : String(error)` idiom turns
 * those into the literal text `[object Object]`. Worse, wrapping them with
 * `new Error(String(error))` bakes that useless text into a real `Error.message`,
 * after which the original diagnostic payload is unrecoverable downstream — which
 * is exactly how production logs ended up reading
 * `Failed to verify payment: [object Object]`.
 *
 * These helpers are intentionally pure and dependency-free so any layer
 * (adapters, services, error handlers) can use them without DI.
 *
 * @module ErrorMessageUtil
 */

/**
 * An `Error` enriched with structured details recovered from a non-Error value.
 */
export interface NormalizedError extends Error {
  /** Provider-specific error code, e.g. `BAD_REQUEST_ERROR` */
  code?: string;
  /** HTTP status reported by the provider, when available */
  statusCode?: number;
  /** The original thrown value, preserved for structured logging */
  cause?: unknown;
}

/** Placeholder produced by `String()` on a plain object. */
const USELESS_MESSAGE = '[object Object]';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

function asText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asStatusCode(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Extract the most descriptive human-readable message available from any thrown
 * value, including provider SDK objects that are not `Error` instances.
 *
 * Returns `undefined` when nothing meaningful can be recovered, so callers can
 * substitute their own domain-appropriate default instead of logging noise.
 *
 * @example
 * ```typescript
 * catch (error) {
 *   const message = extractErrorMessage(error) ?? 'Payment verification failed';
 * }
 * ```
 */
export function extractErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    // Guard against a layer upstream having already collapsed a plain object
    // into `new Error(String(obj))`.
    return error.message === USELESS_MESSAGE ? undefined : error.message;
  }

  const text = asText(error);
  if (text) {
    return text;
  }

  const root = asRecord(error);
  if (!root) {
    return undefined;
  }

  // Razorpay shape: { statusCode, error: { code, description, reason, field } }
  const nested = asRecord(root['error']);
  if (nested) {
    const description = asText(nested['description']);
    const code = asText(nested['code']);
    const reason = asText(nested['reason']);
    const field = asText(nested['field']);
    const primary = description ?? code;

    if (primary) {
      const details = [
        code && description ? `code=${code}` : undefined,
        reason && reason !== description ? `reason=${reason}` : undefined,
        field ? `field=${field}` : undefined,
      ].filter((detail): detail is string => Boolean(detail));

      return details.length > 0 ? `${primary} (${details.join(', ')})` : primary;
    }
  }

  // axios shape: { response: { status, data: { message | error_description } } }
  const response = asRecord(root['response']);
  const responseData = asRecord(response?.['data']);
  const responseMessage =
    asText(responseData?.['message']) ||
    asText(responseData?.['error_description']) ||
    asText(responseData?.['error']);
  if (responseMessage) {
    const code = asText(responseData?.['code']) || asText(responseData?.['type']);
    return code ? `${responseMessage} (code=${code})` : responseMessage;
  }

  // Flat shapes: { message } / { description } / { error: 'text' }
  const flat =
    asText(root['message']) ||
    asText(root['description']) ||
    asText(root['error']) ||
    asText(root['error_description']);
  if (flat) {
    return flat;
  }

  // Last resort: serialize. Still far more useful than `[object Object]`.
  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== '{}' ? serialized : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Convert any thrown value into a real `Error` carrying a useful message.
 *
 * Genuine `Error` instances pass through untouched so stack traces and error
 * subclasses (including `HealthcareError`) survive. Only values that cannot
 * describe themselves — plain objects, and `Error`s already poisoned with
 * `[object Object]` — are rebuilt.
 *
 * Use this at the boundary where a third-party rejection first enters the
 * codebase, so every downstream log sees a real message.
 *
 * @param error   The caught value
 * @param context Optional prefix describing the failed operation
 */
export function toError(error: unknown, context?: string): NormalizedError {
  if (error instanceof Error && error.message && error.message !== USELESS_MESSAGE) {
    return error as NormalizedError;
  }

  const message = extractErrorMessage(error);
  const prefix = context ? `${context}: ` : '';
  const normalized = new Error(`${prefix}${message ?? 'Unknown error'}`) as NormalizedError;

  if (error instanceof Error && error.stack) {
    normalized.stack = error.stack;
  }

  const root = asRecord(error);
  if (root) {
    const nested = asRecord(root['error']);
    const response = asRecord(root['response']);
    const responseData = asRecord(response?.['data']);

    const code = asText(nested?.['code']) || asText(responseData?.['code']) || asText(root['code']);
    if (code) {
      normalized.code = code;
    }

    const statusCode =
      asStatusCode(root['statusCode']) ||
      asStatusCode(root['status']) ||
      asStatusCode(response?.['status']);
    if (statusCode !== undefined) {
      normalized.statusCode = statusCode;
    }
  }

  normalized.cause = error;
  return normalized;
}
