/// <reference types="jest" />
/**
 * The public payment bridge (`POST /payments/payment-intents`) has no user, only a clinic header.
 * The client-chosen amount must never be trusted: the target must exist in that clinic, be open,
 * and the amount (minor units) must equal the amount really due.
 */
import type { ModuleRef } from '@nestjs/core';

jest.mock('@payment/payment.service', () => ({ PaymentService: class {} }), { virtual: true });
jest.mock(
  '@payment/payment.handoff-token.service',
  () => ({ PaymentHandoffTokenService: class {} }),
  { virtual: true }
);
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

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { createBillingService } from './billing-test-harness';
import type { MockMap } from './billing-test-harness';
import { FakeBillingDb } from './billing-fake-db';
import { CLINIC_ID } from './billing-finalisation-world';
import { PaymentController } from '../../../src/libs/payment/payment.controller';
import { resolveClinicUUID } from '@utils/clinic.utils';

function setup() {
  const db = new FakeBillingDb();
  db.seed('billingPlan', {
    id: 'plan-1',
    name: 'Gold',
    amount: 100,
    interval: 'MONTHLY',
    intervalCount: 1,
    clinicId: CLINIC_ID,
  });
  db.seed('subscription', {
    id: 'sub-1',
    userId: 'user-1',
    clinicId: CLINIC_ID,
    planId: 'plan-1',
    status: 'INCOMPLETE',
  });
  db.seed('invoice', {
    id: 'inv-1',
    clinicId: CLINIC_ID,
    userId: 'user-1',
    status: 'PENDING',
    totalAmount: 118,
  });
  db.seed('invoice', {
    id: 'inv-paid',
    clinicId: CLINIC_ID,
    userId: 'user-1',
    status: 'PAID',
    totalAmount: 118,
  });
  db.seed('appointment', {
    id: 'apt-1',
    clinicId: CLINIC_ID,
    type: 'VIDEO_CALL',
    status: 'PENDING',
    treatmentType: 'GENERAL_CONSULTATION',
    paymentExpiresAt: new Date(Date.now() + 3600 * 1000),
  });
  const harness = createBillingService({
    databaseService: db.service as unknown as MockMap,
    configService: {
      getEnv: jest.fn((key: string) => (key === 'BILLING_GST_RATE_PERCENT' ? '18' : undefined)),
      getAppConfig: jest.fn().mockReturnValue({ baseUrl: '' }),
    },
  });
  jest
    .spyOn(
      harness.service as unknown as { resolveVideoConsultationService: () => unknown },
      'resolveVideoConsultationService'
    )
    .mockReturnValue({ videoConsultationFee: 500 });
  return { db, ...harness };
}

describe('BillingService.assertPublicPaymentIntentAmount', () => {
  it.each([
    ['invoice', { invoiceId: 'inv-1' }, 11800],
    ['subscription (plan price + GST)', { subscriptionId: 'sub-1' }, 11800],
    ['appointment (video fee + GST)', { appointmentId: 'apt-1' }, 59000],
  ])('accepts the exact amount due for an %s', async (_label, target, due) => {
    const { service } = setup();

    await expect(
      service.assertPublicPaymentIntentAmount(target, CLINIC_ID, due)
    ).resolves.toBeUndefined();
  });

  it.each([
    ['lower', 100],
    ['one paisa lower', 11799],
    ['higher', 11801],
    ['non-integer', 11800.5],
  ])('rejects a %s amount with 400 and a fixed message', async (_label, amount) => {
    const { service } = setup();

    await expect(
      service.assertPublicPaymentIntentAmount({ invoiceId: 'inv-1' }, CLINIC_ID, amount)
    ).rejects.toMatchObject({
      message: 'Payment amount does not match the amount due',
      status: 400,
    });
  });

  it.each([{ invoiceId: 'ghost' }, { subscriptionId: 'ghost' }, { appointmentId: 'ghost' }])(
    'answers 404 for an unknown target %j',
    async target => {
      const { service } = setup();

      await expect(
        service.assertPublicPaymentIntentAmount(target, CLINIC_ID, 100)
      ).rejects.toBeInstanceOf(NotFoundException);
    }
  );

  it.each([{ invoiceId: 'inv-1' }, { subscriptionId: 'sub-1' }, { appointmentId: 'apt-1' }])(
    'answers 404 for a target of another clinic %j',
    async target => {
      const { service } = setup();

      await expect(
        service.assertPublicPaymentIntentAmount(target, 'clinic-other', 11800)
      ).rejects.toBeInstanceOf(NotFoundException);
    }
  );

  it('refuses a target that is not open (paid invoice, cancelled appointment)', async () => {
    const { service, db } = setup();
    db.row('appointment', 'apt-1')['status'] = 'CANCELLED';

    await expect(
      service.assertPublicPaymentIntentAmount({ invoiceId: 'inv-paid' }, CLINIC_ID, 11800)
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.assertPublicPaymentIntentAmount({ appointmentId: 'apt-1' }, CLINIC_ID, 59000)
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires exactly one target and does not support prescriptions', async () => {
    const { service } = setup();

    await expect(
      service.assertPublicPaymentIntentAmount({}, CLINIC_ID, 100)
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.assertPublicPaymentIntentAmount(
        { invoiceId: 'inv-1', subscriptionId: 'sub-1' },
        CLINIC_ID,
        11800
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.assertPublicPaymentIntentAmount({ prescriptionId: 'rx-1' }, CLINIC_ID, 100)
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PaymentController POST /payments/payment-intents', () => {
  function controllerWith(assert: jest.Mock) {
    const createPaymentIntent = jest.fn().mockResolvedValue({ orderId: 'o1' });
    const moduleRef = {
      get: jest.fn().mockReturnValue({ assertPublicPaymentIntentAmount: assert }),
    } as unknown as ModuleRef;
    const databaseService = { findPaymentsSafe: jest.fn().mockResolvedValue([]) };
    const controller = new PaymentController(
      { createPaymentIntent } as never,
      {} as never,
      databaseService as never,
      moduleRef,
      { log: jest.fn().mockResolvedValue(undefined) } as never,
      {} as never,
      {} as never,
      {} as never
    );
    return { controller, createPaymentIntent };
  }

  beforeEach(() => {
    (resolveClinicUUID as jest.Mock).mockResolvedValue(CLINIC_ID);
  });

  it('creates the order when the amount check passes', async () => {
    const assert = jest.fn().mockResolvedValue(undefined);
    const { controller, createPaymentIntent } = controllerWith(assert);

    const result = await controller.createPaymentIntentPublic('CL0001', {
      invoiceId: 'inv-1',
      amount: 11800,
    });

    expect(result.success).toBe(true);
    expect(assert).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: 'inv-1' }),
      CLINIC_ID,
      11800
    );
    expect(createPaymentIntent).toHaveBeenCalledTimes(1);
  });

  it('never reaches the gateway when the amount does not match', async () => {
    const assert = jest.fn().mockRejectedValue(new BadRequestException('mismatch'));
    const { controller, createPaymentIntent } = controllerWith(assert);

    await expect(
      controller.createPaymentIntentPublic('CL0001', { invoiceId: 'inv-1', amount: 100 })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(createPaymentIntent).not.toHaveBeenCalled();
  });

  it('propagates 404 for an unknown / other-clinic target without creating an order', async () => {
    const assert = jest.fn().mockRejectedValue(new NotFoundException('Payment target not found'));
    const { controller, createPaymentIntent } = controllerWith(assert);

    await expect(
      controller.createPaymentIntentPublic('CL0001', { subscriptionId: 'x', amount: 100 })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(createPaymentIntent).not.toHaveBeenCalled();
  });
});
