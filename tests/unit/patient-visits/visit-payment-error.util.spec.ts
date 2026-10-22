import { describe, expect, it } from '@jest/globals';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  VISIT_PAYMENT_FALLBACK_MESSAGE,
  visitPaymentErrorMessage,
} from '../../../src/services/patient-visits/utils/visit-payment-error.util';

describe('visitPaymentErrorMessage', () => {
  it('surfaces 409 / 400 messages', () => {
    expect(visitPaymentErrorMessage(new ConflictException('Invoice is already paid'))).toBe(
      'Fee not recorded: Invoice is already paid'
    );
    expect(
      visitPaymentErrorMessage(new BadRequestException({ message: ['amount must be positive'] }))
    ).toBe('Fee not recorded: amount must be positive');
  });

  it('hides internal failures behind the fallback', () => {
    expect(visitPaymentErrorMessage(new InternalServerErrorException('db down'))).toBe(
      VISIT_PAYMENT_FALLBACK_MESSAGE
    );
    expect(visitPaymentErrorMessage(new Error('boom'))).toBe(VISIT_PAYMENT_FALLBACK_MESSAGE);
    expect(visitPaymentErrorMessage(null)).toBe(VISIT_PAYMENT_FALLBACK_MESSAGE);
  });
});
