/// <reference types="jest" />
/**
 * Billing plans are clinic-scoped. Regression: plan get / update / delete had no clinic or
 * ownership check, so a CLINIC_ADMIN of clinic A could edit or delete a plan of clinic B, any
 * role could read any plan by id, and a subscription could be created on another clinic's plan.
 */

jest.mock('@payment/payment.service', () => ({ PaymentService: class {} }), { virtual: true });
jest.mock(
  '@payment/payment.handoff-token.service',
  () => ({ PaymentHandoffTokenService: class {} }),
  { virtual: true }
);
jest.mock('@infrastructure/database', () => ({ DatabaseService: class {} }));

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  assertPlanMatchesClinic,
  assertPlanReadable,
  assertPlanWritable,
  resolvePlanClinicId,
} from '@services/billing/billing-subscription.store';
import { createBillingService, createWarmableCache } from './billing-test-harness';

const CLINIC_A = 'clinic-a';
const CLINIC_B = 'clinic-b';

const ADMIN_A = { userId: 'admin-a', role: 'CLINIC_ADMIN', clinicId: CLINIC_A };
const PATIENT_A = { userId: 'patient-a', role: 'PATIENT', clinicId: CLINIC_A };
const SUPER = { userId: 'root', role: 'SUPER_ADMIN' };

describe('plan access rules', () => {
  const planB = { clinicId: CLINIC_B };
  const planA = { clinicId: CLINIC_A };
  const platformPlan = { clinicId: null };

  it('reads: own clinic, platform-wide plans and SUPER_ADMIN; another clinic answers 404', () => {
    expect(() => assertPlanReadable(planA, PATIENT_A)).not.toThrow();
    expect(() => assertPlanReadable(platformPlan, PATIENT_A)).not.toThrow();
    expect(() => assertPlanReadable(planB, SUPER)).not.toThrow();
    expect(() => assertPlanReadable(planB, undefined)).not.toThrow(); // internal caller
    expect(() => assertPlanReadable(planB, PATIENT_A)).toThrow(NotFoundException);
    expect(() => assertPlanReadable(planB, ADMIN_A)).toThrow(NotFoundException);
    expect(() => assertPlanReadable(planA, { role: 'PATIENT' })).toThrow(NotFoundException);
  });

  it('writes: only the CLINIC_ADMIN of the plan clinic (or SUPER_ADMIN)', () => {
    expect(() => assertPlanWritable(planA, ADMIN_A)).not.toThrow();
    expect(() => assertPlanWritable(planB, SUPER)).not.toThrow();
    expect(() => assertPlanWritable(planB, ADMIN_A)).toThrow(NotFoundException);
    expect(() => assertPlanWritable(platformPlan, ADMIN_A)).toThrow(ForbiddenException);
    expect(() => assertPlanWritable(planA, PATIENT_A)).toThrow(ForbiddenException);
    expect(() =>
      assertPlanWritable(planA, { userId: 'f', role: 'FINANCE_BILLING', clinicId: CLINIC_A })
    ).toThrow(ForbiddenException);
  });

  it('a subscription may only use its own clinic plan or a platform-wide plan', () => {
    expect(() => assertPlanMatchesClinic(planA, CLINIC_A)).not.toThrow();
    expect(() => assertPlanMatchesClinic(platformPlan, CLINIC_A)).not.toThrow();
    expect(() => assertPlanMatchesClinic(planB, CLINIC_A)).toThrow(NotFoundException);
  });

  it('a non-super-admin can only create plans for the guard-validated clinic', () => {
    expect(resolvePlanClinicId(CLINIC_B, ADMIN_A)).toBe(CLINIC_A);
    expect(resolvePlanClinicId(undefined, ADMIN_A)).toBe(CLINIC_A);
    expect(resolvePlanClinicId(CLINIC_B, SUPER)).toBe(CLINIC_B);
    expect(resolvePlanClinicId(CLINIC_B, undefined)).toBe(CLINIC_B);
  });
});

describe('BillingService plan routes', () => {
  const PLAN_B = { id: 'plan-b', clinicId: CLINIC_B, name: 'B plan', amount: 100 };
  const PLAN_A = { id: 'plan-a', clinicId: CLINIC_A, name: 'A plan', amount: 100 };

  function setup() {
    const warm = createWarmableCache();
    const plans = new Map([
      [PLAN_A.id, PLAN_A],
      [PLAN_B.id, PLAN_B],
    ]);
    const databaseService = {
      findBillingPlanByIdSafe: jest.fn(async (id: string) => plans.get(id) ?? null),
      updateBillingPlanSafe: jest.fn(async (id: string, data: Record<string, unknown>) => ({
        ...plans.get(id),
        ...data,
      })),
      deleteBillingPlanSafe: jest.fn().mockResolvedValue(undefined),
      findSubscriptionsSafe: jest.fn().mockResolvedValue([]),
      createBillingPlanSafe: jest.fn(async (data: Record<string, unknown>) => ({
        id: 'new',
        ...data,
      })),
    };
    const harness = createBillingService({
      databaseService,
      cacheService: { cache: warm.cache, invalidateCacheByTag: jest.fn().mockResolvedValue(0) },
    });
    return { ...harness, databaseService };
  }

  it('GET plan/:id: another clinic gets 404 even when the row is already cached', async () => {
    const { service, databaseService } = setup();

    await expect(service.getBillingPlan('plan-b', ADMIN_A)).rejects.toBeInstanceOf(
      NotFoundException
    );
    // Warm entry: still refused (the check runs outside the cache loader).
    await expect(service.getBillingPlan('plan-b', PATIENT_A)).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(databaseService.findBillingPlanByIdSafe).toHaveBeenCalledTimes(1);

    await expect(service.getBillingPlan('plan-a', PATIENT_A)).resolves.toMatchObject({
      id: 'plan-a',
    });
  });

  it('PUT plan/:id: a CLINIC_ADMIN of another clinic cannot edit it', async () => {
    const { service, databaseService } = setup();

    await expect(
      service.updateBillingPlan('plan-b', { name: 'hacked' } as never, ADMIN_A)
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(databaseService.updateBillingPlanSafe).not.toHaveBeenCalled();

    await expect(
      service.updateBillingPlan('plan-a', { name: 'renamed' } as never, ADMIN_A)
    ).resolves.toMatchObject({ name: 'renamed' });
  });

  it('DELETE plan/:id: a CLINIC_ADMIN of another clinic cannot delete it', async () => {
    const { service, databaseService } = setup();

    await expect(service.deleteBillingPlan('plan-b', ADMIN_A)).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(databaseService.deleteBillingPlanSafe).not.toHaveBeenCalled();

    await expect(service.deleteBillingPlan('plan-a', ADMIN_A)).resolves.toBeUndefined();
    expect(databaseService.deleteBillingPlanSafe).toHaveBeenCalledWith('plan-a');
  });

  it('a missing plan is a 404, not a silent no-op', async () => {
    const { service } = setup();

    await expect(service.deleteBillingPlan('ghost', ADMIN_A)).rejects.toBeInstanceOf(
      NotFoundException
    );
    await expect(service.updateBillingPlan('ghost', {} as never, ADMIN_A)).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('POST plan: a CLINIC_ADMIN can only create plans for its own clinic', async () => {
    const { service, databaseService } = setup();

    await service.createBillingPlan(
      { name: 'x', amount: 1, interval: 'MONTHLY', clinicId: CLINIC_B } as never,
      ADMIN_A
    );

    expect(databaseService.createBillingPlanSafe).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: CLINIC_A })
    );
  });
});
