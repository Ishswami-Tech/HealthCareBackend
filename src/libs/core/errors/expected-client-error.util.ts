import { HttpException } from '@nestjs/common';

/**
 * True for errors that are the client's to correct: an HttpException with a 4xx status
 * (not found, bad request, forbidden, conflict, ...).
 *
 * The API request logger already records every 4xx response as one WARN line with its message, so
 * handlers should not log these again as ERROR. Server-side failures (5xx, or anything that is not
 * an HttpException) still return false and keep their error logs.
 */
export function isExpectedClientError(error: unknown): boolean {
  if (!(error instanceof HttpException)) {
    return false;
  }
  const status = error.getStatus();
  return status >= 400 && status < 500;
}
