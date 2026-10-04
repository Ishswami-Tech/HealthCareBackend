/// <reference types="jest" />
/**
 * PaymentController callbacks must never report success for a payment the backend could not
 * find or verify. Regression: the handoff callback defaulted its status to 'completed', so a
 * callback with no local payment record (BillingService returns `{ payment: {} }`) answered
 * `success: true`.
 */
import type { ModuleRef } from '@nestjs/core';

jest.mock('../../../src/libs/payment/payment.service', () => ({ PaymentService: class {} }));
jest.mock('../../../src/libs/payment/payment.handoff-token.service', () => ({
  PaymentHandoffTokenService: class {},
}));
jest.mock('@infrastructure/database', () => ({ DatabaseService: class {} }));
jest.mock('@infrastructure/cache', () => ({ CacheService: class {} }));
jest.mock('@infrastructure/logging/logging.service', () => ({ LoggingService: class {} }));
jest.mock('@config/payment-config.service', () => ({ PaymentConfigService: class {} }));
jest.mock('@queue/src/queue.service', () => ({ QueueService: class {} }));
jest.mock('@core/guards/jwt-auth.guard', () => ({ JwtAuthGuard: class {} }));
jest.mock('@core/guards/roles.guard', () => ({ RolesGuard: class {} }));
jest.mock('@core/guards/clinic.guard', () => ({ ClinicGuard: class {} }));
jest.mock('@core/rbac/rbac.guard', () => ({ RbacGuard: class {} }));
jest.mock('@utils/clinic.utils', () => ({ resolveClinicUUID: jest.fn() }));

import { PaymentController } from '../../../src/libs/payment/payment.controller';

function setup(handlePaymentCallback: jest.Mock) {
  const handoffTokenService = {
    verifyHandoffToken: jest.fn().mockResolvedValue({
      clinicId: 'clinic-1',
      orderId: 'order-1',
      paymentId: 'pay-1',
      provider: 'cashfree',
      iat: 0,
      exp: 0,
      jti: 'jti-1',
    }),
    releaseReplayToken: jest.fn().mockResolvedValue(undefined),
  };
  const moduleRef = {
    get: jest.fn().mockReturnValue({ handlePaymentCallback }),
  } as unknown as ModuleRef;
  const controller = new PaymentController(
    {} as never,
    handoffTokenService as never,
    {} as never,
    moduleRef,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    {} as never,
    {} as never,
    {} as never
  );
  return { controller, handoffTokenService };
}

describe('PaymentController handoff callback', () => {
  it('reports success: false (status unknown) when no local payment record exists', async () => {
    const { controller, handoffTokenService } = setup(jest.fn().mockResolvedValue({ payment: {} }));

    const result = await controller.handleHandoffCallback('token', 'order-1', 'pay-1', 'cashfree');

    expect(result.success).toBe(false);
    expect(result.message).toContain('unknown');
    // Clients keep polling (not-found grace) instead of treating this as terminal.
    expect(result.code).toBe('PAYMENT_NOT_FOUND');
    expect(result.retryable).toBe(true);
    expect(result.payment).toBeUndefined();
    // A non-success outcome releases the replay lock so the client can retry.
    expect(handoffTokenService.releaseReplayToken).toHaveBeenCalledWith('jti-1');
  });

  it('reports success: true only for a COMPLETED payment', async () => {
    const { controller } = setup(
      jest.fn().mockResolvedValue({ payment: { id: 'pay-1', status: 'COMPLETED' } })
    );

    const result = await controller.handleHandoffCallback('token', 'order-1', 'pay-1', 'cashfree');

    expect(result.success).toBe(true);
    expect(result.code).toBeUndefined();
    expect(result.retryable).toBeUndefined();
    // Same value the plain /payments/callback returns in payment.status.
    expect(result.payment).toEqual({ id: 'pay-1', status: 'COMPLETED' });
  });

  it('reports a COMPLETED payment that is still being finalised as retryable PAYMENT_PROCESSING', async () => {
    const { controller, handoffTokenService } = setup(
      jest
        .fn()
        .mockResolvedValue({ payment: { id: 'pay-1', status: 'COMPLETED' }, processing: true })
    );

    const result = await controller.handleHandoffCallback('token', 'order-1', 'pay-1', 'cashfree');

    expect(result.success).toBe(false);
    expect(result.code).toBe('PAYMENT_PROCESSING');
    expect(result.retryable).toBe(true);
    expect(result.payment).toEqual({ id: 'pay-1', status: 'COMPLETED' });
    expect(handoffTokenService.releaseReplayToken).toHaveBeenCalledWith('jti-1');
  });

  it.each([
    ['FAILED', 'PAYMENT_FAILED'],
    ['CANCELLED', 'PAYMENT_CANCELLED'],
    ['EXPIRED', 'PAYMENT_EXPIRED'],
  ])(
    'reports a terminal %s payment in one call: payment.status + non-retryable %s',
    async (status, code) => {
      const { controller } = setup(
        jest.fn().mockResolvedValue({ payment: { id: 'pay-1', status } })
      );

      const result = await controller.handleHandoffCallback(
        'token',
        'order-1',
        'pay-1',
        'cashfree'
      );

      expect(result.success).toBe(false);
      expect(result.payment).toEqual({ id: 'pay-1', status });
      expect(result.code).toBe(code);
      expect(result.retryable).toBe(false);
    }
  );

  it('reports success: false for a pending payment', async () => {
    const { controller } = setup(
      jest.fn().mockResolvedValue({ payment: { id: 'pay-1', status: 'PENDING' } })
    );

    const result = await controller.handleHandoffCallback('token', 'order-1', 'pay-1', 'cashfree');

    expect(result.success).toBe(false);
    expect(result.payment).toEqual({ id: 'pay-1', status: 'PENDING' });
    expect(result.code).toBe('PAYMENT_PENDING');
    expect(result.retryable).toBe(true);
  });
});

describe('PaymentController POST /payments/callback', () => {
  it('returns success: false when no local payment record exists, keeping the declared shape', async () => {
    const { controller } = setup(jest.fn().mockResolvedValue({ payment: {} }));

    const result = await controller.handlePaymentCallback('clinic-1', 'pay-1', 'order-1');

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.payment).toBeUndefined();
    expect(result.code).toBe('PAYMENT_NOT_FOUND');
    expect(result.retryable).toBe(true);
  });

  it('answers PAYMENT_PROCESSING (retryable) while another delivery is still finalising', async () => {
    const payment = { id: 'pay-1', status: 'COMPLETED' };
    const { controller } = setup(jest.fn().mockResolvedValue({ payment, processing: true }));

    const result = await controller.handlePaymentCallback('clinic-1', 'pay-1', 'order-1');

    expect(result.success).toBe(false);
    expect(result.code).toBe('PAYMENT_PROCESSING');
    expect(result.retryable).toBe(true);
    expect(result.payment).toBe(payment);
  });

  it('keeps the payment / invoice / appointment fields on a successful callback', async () => {
    const payment = { id: 'pay-1', status: 'COMPLETED' };
    const invoice = { id: 'inv-1' };
    const appointment = { id: 'apt-1' };
    const { controller } = setup(jest.fn().mockResolvedValue({ payment, invoice, appointment }));

    const result = await controller.handlePaymentCallback('clinic-1', 'pay-1', 'order-1');

    expect(result).toEqual({ success: true, payment, invoice, appointment });
  });
});
