/**
 * The core appointment service answers refusals as `{ success: false, error, message }` (internal
 * callers such as the schedulers branch on it). An HTTP route must not turn that into a 200 / 201
 * with `success: false` (M1 / M2): the client then shows "booked" / "cancelled" for something that
 * never happened. `httpErrorForFailedResult` maps the core error code to the HTTP class.
 */
import { HttpException, HttpStatus } from '@nestjs/common';

export interface AppointmentResultLike {
  success: boolean;
  error?: string | undefined;
  message?: string | undefined;
}

/** Core error code -> HTTP status. Anything unknown is the caller's request (400). */
const STATUS_BY_CODE: Readonly<Record<string, HttpStatus>> = {
  VALIDATION_ERROR: HttpStatus.BAD_REQUEST,
  BUSINESS_RULE_VIOLATION: HttpStatus.BAD_REQUEST,
  APPOINTMENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  SCHEDULING_CONFLICT: HttpStatus.CONFLICT,
  APPOINTMENT_CONFLICT: HttpStatus.CONFLICT,
  CANCELLATION_NOT_ALLOWED: HttpStatus.CONFLICT,
  INVALID_STATUS_TRANSITION: HttpStatus.CONFLICT,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
};

const DEFAULT_MESSAGES: Readonly<Partial<Record<HttpStatus, string>>> = {
  [HttpStatus.BAD_REQUEST]: 'The request could not be processed',
  [HttpStatus.NOT_FOUND]: 'Appointment not found',
  [HttpStatus.CONFLICT]: 'The appointment cannot be changed in its current state',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'The appointment could not be processed. Please try again.',
};

export function httpStatusForAppointmentError(code: string | undefined): HttpStatus {
  return (code && STATUS_BY_CODE[code]) || HttpStatus.BAD_REQUEST;
}

/** The HTTP exception for a failed core result (`{ statusCode, code, message }`). */
export function httpErrorForFailedResult(result: AppointmentResultLike): HttpException {
  const status = httpStatusForAppointmentError(result.error);
  const message = result.message?.trim() || DEFAULT_MESSAGES[status] || 'Request failed';
  return new HttpException(
    { statusCode: status, code: result.error || 'APPOINTMENT_REQUEST_FAILED', message },
    status
  );
}

/** The result itself when it succeeded; a failed one is thrown as its HTTP error. */
export function assertAppointmentResultOk<T extends AppointmentResultLike>(result: T): T {
  if (result.success) return result;
  throw httpErrorForFailedResult(result);
}

/**
 * The same check for a service answer typed `unknown` (e.g. `updateStatus`, which dispatches to
 * check-in / start / complete / cancel): a `{ success: false, error, message }` result is thrown
 * as its HTTP error (CANCELLATION_NOT_ALLOWED -> 409 with the core message); anything else
 * passes through unchanged.
 */
export function assertUnknownAppointmentResultOk<T>(result: T): T {
  if (!result || typeof result !== 'object') return result;
  const candidate = result as { success?: unknown; error?: unknown; message?: unknown };
  if (candidate.success !== false) return result;
  throw httpErrorForFailedResult({
    success: false,
    error: typeof candidate.error === 'string' ? candidate.error : undefined,
    message: typeof candidate.message === 'string' ? candidate.message : undefined,
  });
}
