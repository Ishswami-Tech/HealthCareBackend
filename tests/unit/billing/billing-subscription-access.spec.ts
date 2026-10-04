/// <reference types="jest" />
/**
 * Ownership / clinic checks on subscriptions must run on EVERY call, including when the
 * subscription row is served from the cache. Regression for the cached ownership bypass:
 * the check used to live inside the cache loader, so a warm entry skipped it and any patient
 * who knew a subscription id could cancel (or read, renew, pay) another patient's plan.
 */
import { NotFoundException } from '@nestjs/common';

jest.mock('@payment/payment.service', () => ({ PaymentService: class {} }), { virtual: true });
jest.mock(
  '@payment/payment.handoff-token.service',
  () => ({ PaymentHandoffTokenService: class {} }),
  { virtual: true }
);
jest.mock('@infrastructure/database', () => ({ DatabaseService: class {} }));

import { createBillingService, createWarmableCache } from './billing-test-harness';

const SUBSCRIPTION = {
  id: 'sub-1',
  userId: 'patient-a',
  clinicId: 'clinic-1',
  planId: 'plan-1',
  status: 'ACTIVE',
  plan: { id: 'plan-1', name: 'Gold', amount: 100 },
};

const PATIENT_A = { userId: 'patient-a', role: 'PATIENT', clinicId: 'clinic-1' };
const PATIENT_B = { userId: 'patient-b', role: 'PATIENT', clinicId: 'clinic-1' };

function setup() {
  const warm = createWarmableCache();
  const databaseService = {
    findSubscriptionByIdSafe: jest.fn().mockResolvedValue(SUBSCRIPTION),
    updateSubscriptionSafe: jest
      .fn()
      .mockResolvedValue({ ...SUBSCRIPTION, cancelAtPeriodEnd: true }),
  };
  const harness = createBillingService({
    databaseService,
    cacheService: {
      cache: warm.cache,
      invalidateCacheByTag: jest.fn().mockResolvedValue(0),
    },
  });
  return { ...harness, databaseService, warm };
}

describe('BillingService.getSubscription ownership on a warm cache', () => {
  it('rejects another patient even though the row is already cached', async () => {
    const { service, databaseService } = setup();

    // Patient A warms the cache.
    await expect(service.getSubscription('sub-1', PATIENT_A)).resolves.toMatchObject({
      id: 'sub-1',
    });
    expect(databaseService.findSubscriptionByIdSafe).toHaveBeenCalledTimes(1);

    // Patient B hits the warm entry and must still be refused.
    await expect(service.getSubscription('sub-1', PATIENT_B)).rejects.toBeInstanceOf(
      NotFoundException
    );
    // ... and it really was a cache hit (no second database read).
    expect(databaseService.findSubscriptionByIdSafe).toHaveBeenCalledTimes(1);
  });

  it('rejects staff of a different clinic on a warm entry, allows the owning clinic', async () => {
    const { service } = setup();
    await service.getSubscription('sub-1', PATIENT_A);

    await expect(
      service.getSubscription('sub-1', {
        userId: 'admin-2',
        role: 'CLINIC_ADMIN',
        clinicId: 'clinic-2',
      })
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.getSubscription('sub-1', {
        userId: 'admin-1',
        role: 'CLINIC_ADMIN',
        clinicId: 'clinic-1',
      })
    ).resolves.toMatchObject({ id: 'sub-1' });
    await expect(
      service.getSubscription('sub-1', { userId: 'root', role: 'SUPER_ADMIN' })
    ).resolves.toMatchObject({ id: 'sub-1' });
  });

  it('fails closed for a patient requester that carries no user id', async () => {
    const { service } = setup();
    await service.getSubscription('sub-1', PATIENT_A);

    await expect(
      service.getSubscription('sub-1', { role: 'PATIENT', clinicId: 'clinic-1' })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("does not let patient B cancel patient A's subscription when the cache is warm", async () => {
    const { service, databaseService } = setup();
    await service.getSubscription('sub-1', PATIENT_A);

    await expect(service.cancelSubscription('sub-1', false, PATIENT_B)).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(databaseService.updateSubscriptionSafe).not.toHaveBeenCalled();

    // The owner can still cancel it.
    await expect(service.cancelSubscription('sub-1', false, PATIENT_A)).resolves.toBeDefined();
    expect(databaseService.updateSubscriptionSafe).toHaveBeenCalledTimes(1);
  });

  it('blocks renew and quota reset for a non-owner on a warm entry', async () => {
    const { service, databaseService } = setup();
    await service.getSubscription('sub-1', PATIENT_A);

    await expect(service.renewSubscription('sub-1', PATIENT_B)).rejects.toBeInstanceOf(
      NotFoundException
    );
    await expect(service.resetSubscriptionQuota('sub-1', PATIENT_B)).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(databaseService.updateSubscriptionSafe).not.toHaveBeenCalled();
  });

  it('keeps cache invalidation non-fatal: a cache outage must not abort a cancel', async () => {
    const { service, cacheService, databaseService } = setup();
    cacheService['invalidateCacheByTag']!.mockRejectedValue(new Error('cache down'));

    await expect(service.cancelSubscription('sub-1', false, PATIENT_A)).resolves.toBeDefined();
    expect(databaseService.updateSubscriptionSafe).toHaveBeenCalledTimes(1);
  });
});
