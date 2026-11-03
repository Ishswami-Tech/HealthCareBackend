/// <reference types="jest" />
/**
 * Unit tests for BillingService plan / subscription basics, against the current DatabaseService
 * surface (the `*Safe` convenience methods) and the current DTOs.
 */

jest.mock('@payment/payment.service', () => ({ PaymentService: class {} }), { virtual: true });
jest.mock(
  '@payment/payment.handoff-token.service',
  () => ({ PaymentHandoffTokenService: class {} }),
  { virtual: true }
);
jest.mock('@infrastructure/database', () => ({ DatabaseService: class {} }));

import { ConflictException, NotFoundException } from '@nestjs/common';
import { BillingInterval, Role } from '@core/types/enums.types';
import type { CreateBillingPlanDto, CreateSubscriptionDto } from '@dtos/billing.dto';
import { createBillingService } from './billing-test-harness';

const CLINIC_ID = 'clinic-1';
const DAY_MS = 24 * 3600 * 1000;

function planRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'plan-123',
    name: 'Basic Plan',
    amount: 999,
    currency: 'INR',
    interval: BillingInterval.MONTHLY,
    intervalCount: 1,
    isActive: true,
    clinicId: CLINIC_ID,
    isUnlimitedAppointments: false,
    appointmentsIncluded: 10,
    trialPeriodDays: 0,
    ...overrides,
  };
}

function subscriptionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sub-123',
    userId: 'user-1',
    clinicId: CLINIC_ID,
    planId: 'plan-1',
    status: 'ACTIVE',
    createdAt: new Date(),
    currentPeriodStart: new Date(Date.now() - 3 * DAY_MS),
    currentPeriodEnd: new Date(Date.now() + 27 * DAY_MS),
    cancelAtPeriodEnd: false,
    appointmentsUsed: 5,
    appointmentsRemaining: 5,
    plan: planRow({ id: 'plan-1' }),
    ...overrides,
  };
}

describe('BillingService', () => {
  describe('constructor', () => {
    it('should accept all required dependencies', () => {
      const { service } = createBillingService();
      expect(service).toBeDefined();
    });
  });

  describe('createBillingPlan', () => {
    it('should create a new billing plan from the current DTO', async () => {
      const databaseService = {
        createBillingPlanSafe: jest.fn().mockResolvedValue(planRow()),
      };
      const { service } = createBillingService({ databaseService });
      const plan: CreateBillingPlanDto = {
        name: 'Basic Plan',
        amount: 999,
        interval: BillingInterval.MONTHLY,
        clinicId: CLINIC_ID,
        features: { consultation: true, followup: true },
      };

      const result = await service.createBillingPlan(plan);

      expect(result.id).toBe('plan-123');
      expect(result.name).toBe('Basic Plan');
      expect(databaseService.createBillingPlanSafe).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Basic Plan',
          amount: 999,
          currency: 'INR',
          interval: BillingInterval.MONTHLY,
          intervalCount: 1,
          clinicId: CLINIC_ID,
        })
      );
    });
  });

  describe('getBillingPlans', () => {
    it('should return billing plans for a clinic', async () => {
      const databaseService = {
        findBillingPlansSafe: jest
          .fn()
          .mockResolvedValue([planRow({ id: 'plan-1' }), planRow({ id: 'plan-2' })]),
      };
      const { service } = createBillingService({ databaseService });

      const result = await service.getBillingPlans(CLINIC_ID);

      expect(result).toHaveLength(2);
    });
  });

  describe('getBillingPlan', () => {
    it('should return a specific billing plan', async () => {
      const databaseService = { findBillingPlanByIdSafe: jest.fn().mockResolvedValue(planRow()) };
      const { service } = createBillingService({ databaseService });

      const result = await service.getBillingPlan('plan-123');

      expect(result.id).toBe('plan-123');
    });

    it('should throw when billing plan not found', async () => {
      const databaseService = { findBillingPlanByIdSafe: jest.fn().mockResolvedValue(null) };
      const { service } = createBillingService({ databaseService });

      await expect(service.getBillingPlan('nonexistent')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateBillingPlan', () => {
    it('should update billing plan fields', async () => {
      const databaseService = {
        findBillingPlanByIdSafe: jest.fn().mockResolvedValue(planRow()),
        updateBillingPlanSafe: jest.fn().mockResolvedValue(planRow({ amount: 1499 })),
      };
      const { service } = createBillingService({ databaseService });

      const result = await service.updateBillingPlan('plan-123', { amount: 1499 });

      expect(result.amount).toBe(1499);
      expect(databaseService.updateBillingPlanSafe).toHaveBeenCalledWith('plan-123', {
        amount: 1499,
      });
    });

    it('should throw when updating non-existent plan', async () => {
      const databaseService = {
        findBillingPlanByIdSafe: jest.fn().mockResolvedValue(null),
        updateBillingPlanSafe: jest.fn(),
      };
      const { service } = createBillingService({ databaseService });

      await expect(
        service.updateBillingPlan('nonexistent', { name: 'Test' })
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(databaseService.updateBillingPlanSafe).not.toHaveBeenCalled();
    });
  });

  describe('deleteBillingPlan', () => {
    it('should delete a billing plan without active subscriptions', async () => {
      const databaseService = {
        findBillingPlanByIdSafe: jest.fn().mockResolvedValue(planRow()),
        findSubscriptionsSafe: jest.fn().mockResolvedValue([]),
        deleteBillingPlanSafe: jest.fn().mockResolvedValue(planRow()),
      };
      const { service } = createBillingService({ databaseService });

      await expect(service.deleteBillingPlan('plan-123')).resolves.toBeUndefined();
      expect(databaseService.deleteBillingPlanSafe).toHaveBeenCalledWith('plan-123');
    });

    it('refuses (409) to delete a plan that still has active subscriptions', async () => {
      const databaseService = {
        findBillingPlanByIdSafe: jest.fn().mockResolvedValue(planRow()),
        findSubscriptionsSafe: jest.fn().mockResolvedValue([subscriptionRow()]),
        deleteBillingPlanSafe: jest.fn(),
      };
      const { service } = createBillingService({ databaseService });

      await expect(service.deleteBillingPlan('plan-123')).rejects.toBeInstanceOf(ConflictException);
      expect(databaseService.deleteBillingPlanSafe).not.toHaveBeenCalled();
    });
  });

  describe('createSubscription', () => {
    it('should create a subscription for a user from the current DTO', async () => {
      const created = subscriptionRow({ status: 'INCOMPLETE' });
      const databaseService = {
        findBillingPlanByIdSafe: jest.fn().mockResolvedValue(planRow({ id: 'plan-1' })),
        // No existing plan in the clinic: the one-plan guard lets the purchase through.
        findSubscriptionsSafe: jest.fn().mockResolvedValue([]),
        createSubscriptionSafe: jest.fn().mockResolvedValue(created),
      };
      const { service } = createBillingService({ databaseService });
      const dto: CreateSubscriptionDto = {
        planId: 'plan-1',
        userId: 'user-1',
        clinicId: CLINIC_ID,
      };

      const result = await service.createSubscription(dto, {
        role: Role.PATIENT,
        userId: 'user-1',
      });

      expect(result.id).toBe('sub-123');
      expect(databaseService.createSubscriptionSafe).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          planId: 'plan-1',
          clinicId: CLINIC_ID,
          status: 'INCOMPLETE',
          appointmentsRemaining: 10,
        })
      );
    });
  });

  describe('getActiveUserSubscription', () => {
    it('should return active subscription for user', async () => {
      const databaseService = {
        findSubscriptionsSafe: jest.fn().mockResolvedValue([subscriptionRow()]),
      };
      const { service } = createBillingService({ databaseService });

      const result = await service.getActiveUserSubscription('user-1', CLINIC_ID);

      expect(result?.id).toBe('sub-123');
      expect(result?.status).toBe('ACTIVE');
    });

    it('should return undefined when no active subscription', async () => {
      const databaseService = {
        findSubscriptionsSafe: jest
          .fn()
          .mockResolvedValue([
            subscriptionRow({ currentPeriodEnd: new Date(Date.now() - DAY_MS) }),
            subscriptionRow({ id: 'sub-2', status: 'CANCELLED' }),
          ]),
      };
      const { service } = createBillingService({ databaseService });

      const result = await service.getActiveUserSubscription('user-nonexistent', CLINIC_ID);

      expect(result).toBeUndefined();
    });
  });

  describe('canBookAppointment', () => {
    it('should allow booking when subscription is active and has remaining quota', async () => {
      const databaseService = {
        findSubscriptionByIdSafe: jest.fn().mockResolvedValue(subscriptionRow()),
      };
      const { service } = createBillingService({ databaseService });

      const result = await service.canBookAppointment('sub-123');

      expect(result.allowed).toBe(true);
    });

    it('should reject booking when quota is exceeded', async () => {
      const databaseService = {
        findSubscriptionByIdSafe: jest
          .fn()
          .mockResolvedValue(subscriptionRow({ appointmentsUsed: 10, appointmentsRemaining: 0 })),
      };
      const { service } = createBillingService({ databaseService });

      const result = await service.canBookAppointment('sub-123');

      expect(result.allowed).toBe(false);
      expect(result.requiresPayment).toBe(true);
    });
  });

  describe('cancelSubscription', () => {
    it('should cancel an active subscription immediately', async () => {
      const databaseService = {
        findSubscriptionByIdSafe: jest.fn().mockResolvedValue(subscriptionRow()),
        updateSubscriptionSafe: jest
          .fn()
          .mockResolvedValue(subscriptionRow({ status: 'CANCELLED', cancelledAt: new Date() })),
      };
      const { service } = createBillingService({ databaseService });

      const result = await service.cancelSubscription('sub-123', true, {
        role: Role.PATIENT,
        userId: 'user-1',
      });

      expect(result.status).toBe('CANCELLED');
      expect(databaseService.updateSubscriptionSafe).toHaveBeenCalledWith(
        'sub-123',
        expect.objectContaining({ status: 'CANCELLED' })
      );
    });
  });

  describe('clinic isolation', () => {
    it('should filter billing plans by clinic', async () => {
      const databaseService = { findBillingPlansSafe: jest.fn().mockResolvedValue([]) };
      const { service } = createBillingService({ databaseService });

      await service.getBillingPlans(CLINIC_ID, Role.CLINIC_ADMIN, 'user-1');

      expect(databaseService.findBillingPlansSafe).toHaveBeenCalledWith(
        expect.objectContaining({ clinicId: CLINIC_ID, isActive: true })
      );
    });
  });
});
