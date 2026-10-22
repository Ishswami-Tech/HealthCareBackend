/**
 * Turns a record-payment refusal into the message shown with the registered visit. record-payment
 * answers 409 (already paid / payment in flight / amount mismatch) or 400 (bad method / amount);
 * those carry a user-facing message. Anything else is an internal failure with a generic text.
 * The visit registration itself never fails because of the fee collection.
 */
import { HttpException, HttpStatus } from '@nestjs/common';

export const VISIT_PAYMENT_FALLBACK_MESSAGE =
  'The visit was registered but the fee could not be recorded. Collect it from Billing.';

const USER_FACING_STATUSES = new Set<number>([HttpStatus.BAD_REQUEST, HttpStatus.CONFLICT]);

function messageOf(response: string | object): string | null {
  if (typeof response === 'string') return response.trim() || null;
  const message = (response as { message?: string | string[] }).message;
  if (Array.isArray(message)) return message.filter(Boolean).join('; ') || null;
  return typeof message === 'string' && message.trim() ? message.trim() : null;
}

export function visitPaymentErrorMessage(error: Error | HttpException | null | undefined): string {
  if (error instanceof HttpException && USER_FACING_STATUSES.has(error.getStatus())) {
    const message = messageOf(error.getResponse());
    if (message) return `Fee not recorded: ${message}`;
  }
  return VISIT_PAYMENT_FALLBACK_MESSAGE;
}
