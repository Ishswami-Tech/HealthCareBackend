import { HttpException } from '@nestjs/common';

/**
 * A deliberate refusal raised by business code inside a database callback: any `HttpException`
 * (including `HealthcareError`, which extends it) with a 4xx status — 400 invalid amount, 404
 * unknown prescription, 409 "already dispensed" ...
 *
 * The database wrappers rethrow these unchanged instead of wrapping them into a 500
 * DATABASE_QUERY_FAILED ("Write operation failed after 1 attempts: ..."), and do not count them
 * as database failures for the circuit breaker. 5xx exceptions (real database / infrastructure
 * failures) keep the existing wrapping.
 */
export function isClientRefusal(error: unknown): error is HttpException {
  if (!(error instanceof HttpException)) return false;
  const status = error.getStatus();
  return status >= 400 && status < 500;
}
