/**
 * Unit tests for BillingService.
 */

import { BillingService } from '@services/billing/billing.service';
import { Role } from '@core/types/enums.types';
import type { CreateBillingPlanDto, CreateSubscriptionDto } from '@dtos/billing.dto';

describe('BillingService', () => {
  function createService(overrides: {
    databaseService?: Record<string, jest.Mock>;
    cacheService?: Record<string, jest.Mock>;
    loggingService?: Record<string, jest.Mock>;
    eventService?: Record<string, jest.Mock>;
    invoicePDFService?: Record<string, jest.Mock>;
    whatsAppService?: Record<string, jest.Mock>;
    paymentService?: Record<string, jest.Mock>;
    paymentHandoffTokenService?: Record<string, jest.Mock>;
    configService?: Record<string, jest.Mock>;
    moduleRef?: Record<string, jest.Mock>;
    queueService?: Record<string, jest.Mock>;
  } = {}) {
    const databaseService = overrides.databaseService || {
      executeHealthcareRead: jest.fn(),
      executeHealthcareWrite: jest.fn(),
      executeHealthcareWriteTransaction: jest.fn(),
    };

    const cacheService = overrides.cacheService || {
      cache: jest.fn((_key: string, fn: () => Promise<unknown>) => fn()),
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      getString: jest.fn(),
      setString: jest.fn(),
      invalidateCacheByTag: jest.fn(),
    };

    const loggingService = overrides.loggingService || {
      log: jest.fn(),
      logError: jest.fn(),
    };

    const eventService = overrides.eventService || {
      emit: jest.fn(),
    };

    const invoicePDFService = overrides.invoicePDFService || {
      generatePDF: jest.fn(),
    };

    const whatsAppService = overrides.whatsAppService || {
      sendMessage: jest.fn(),
    };

    const paymentService = overrides.paymentService || {
      createPaymentIntent: jest.fn(),
      confirmPayment: jest.fn(),
    };

    const paymentHandoffTokenService = overrides.paymentHandoffTokenService || {
      generateToken: jest.fn(),
      verifyToken: jest.fn(),
    };

    const configService = overrides.configService || {
      get: jest.fn(),
    };

    const moduleRef = overrides.moduleRef || {
      get: jest.fn(),
    };

    const queueService = overrides.queueService || {
      enqueue: jest.fn(),
      close: jest.fn(),
    };

    return new BillingService(
      databaseService as any,
      cacheService as any,
      loggingService as any,
      eventService as any,
      invoicePDFService as any,
      whatsAppService as any,
      paymentService as any,
      paymentHandoffTokenService as any,
      configService as any,
      moduleRef as any,
      queueService as any,
    );
  }

  describe('constructor', () => {
    it('should accept all required dependencies', () => {
      const service = createService();
      expect(service).toBeDefined();
    });
  });

  describe('createBillingPlan', () => {
    it('should create a new billing plan', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn(),
        executeHealthcareWrite: jest.fn().mockResolvedValue({
          id: 'plan-123',
          name: 'Basic Plan',
          price: 999,
          duration: 'MONTHLY',
          isActive: true,
          clinicId: 'clinic-1',
        }),
        executeHealthcareWriteTransaction: jest.fn(),
      };

      const service = createService({ databaseService });
      const result = await (service as any).createBillingPlan({
        name: 'Basic Plan',
        price: 999,
        duration: 'MONTHLY',
        clinicId: 'clinic-1',
        features: ['consultation', 'followup'],
      } as CreateBillingPlanDto);

      expect(result).toBeDefined();
      expect(result.id).toBe('plan-123');
      expect(result.name).toBe('Basic Plan');
    });
  });

  describe('getBillingPlans', () => {
    it('should return billing plans for a clinic', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue([
          {
            id: 'plan-1',
            name: 'Basic Plan',
            price: 999,
            duration: 'MONTHLY',
          },
          {
            id: 'plan-2',
            name: 'Premium Plan',
            price: 2999,
            duration: 'MONTHLY',
          },
        ]),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
      };

      const service = createService({ databaseService });
      const result = await (service as any).getBillingPlans('clinic-1');

      expect(result).toHaveLength(2);
    });
  });

  describe('getBillingPlan', () => {
    it('should return a specific billing plan', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue({
          id: 'plan-123',
          name: 'Basic Plan',
          price: 999,
          duration: 'MONTHLY',
        }),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
      };

      const service = createService({ databaseService });
      const result = await (service as any).getBillingPlan('plan-123');

      expect(result).toBeDefined();
      expect(result.id).toBe('plan-123');
    });

    it('should throw when billing plan not found', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue(null),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
      };

      const service = createService({ databaseService });

      await expect(
        (service as any).getBillingPlan('nonexistent')
      ).rejects.toThrow();
    });
  });

  describe('updateBillingPlan', () => {
    it('should update billing plan fields', async () => {
      const updatedPlan = {
        id: 'plan-123',
        name: 'Updated Plan',
        price: 1499,
      };
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue({ id: 'plan-123' }),
        executeHealthcareWrite: jest.fn().mockResolvedValue(updatedPlan),
        executeHealthcareWriteTransaction: jest.fn(),
      };

      const service = createService({ databaseService });
      expect(result).toBeDefined();
      const result = await (service as any).updateBillingPlan(
        'plan-123',
        { price: 1499 } as any,
      );

      expect(result.price).toBeDefined();
    });

    it('should throw when updating non-existent plan', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue(null),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
      };

      const service = createService({ databaseService });
      await expect(
        (service as any).updateBillingPlan('nonexistent', { name: 'Test' } as any)
      ).rejects.toThrow();
    });

    describe('deleteBillingPlan', () => {
    it('should delete a billing plan', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue({ id: 'plan-123' }),
        executeHealthcareWrite: jest.fn().mockResolvedValue({ count: 1 }),
        executeHealthcareWriteTransaction: jest.fn(),
      };

      const service = createService({ databaseService });
      await expect(
        (service as any).deleteBillingPlan('plan-123')
      ).resolves.toBeUndefined();
    });
  });

  describe('createSubscription', () => {
    it('should create a subscription for a user', async () => {
      const subscription = {
        id: 'sub-123',
        userId: 'user-1',
        billingPlanId: 'plan-1',
        status: 'ACTIVE',
        startDate: new Date('2026-10-01'),
        endDate: new Date('2026-11-01'),
      };
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue({ id: 'plan-1' }),
        executeHealthcareWrite: jest.fn().mockResolvedValue(subscription),
        executeHealthcareWriteTransaction: jest.fn(),
      };

      const service = createService({ databaseService });
      const result = await (service as any).createSubscription({
        billingPlanId: 'plan-1',
        userId: 'user-1',
      } as CreateSubscriptionDto, { role: Role.PATIENT, userId: 'user-1' });

      expect(result).toBeDefined();
      expect(result.id).toBe('sub-123');
      expect(result.status).toBe('ACTIVE');
    });
  });

  describe('getActiveUserSubscription', () => {
    it('should return active subscription for user', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue({
          id: 'sub-123',
          userId: 'user-1',
          status: 'ACTIVE',
          billingPlan: { id: 'plan-1', name: 'Basic Plan' },
        }),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
      };

      const service = createService({ databaseService });
      const result = await (service as any).getActiveUserSubscription(
        'user-1',
        'clinic-1',
      );

      expect(result).toBeDefined();
      expect(result.status).toBe('ACTIVE');
    });

    it('should return null when no active subscription', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue(null),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
      };

      const service = createService({ databaseService });
      const result = await (service as any).getActiveUserSubscription(
        'user-nonexistent',
        'clinic-1',
      );

      expect(result).toBeNull();
    });
  });

  describe('canBookAppointment', () => {
    it('should allow booking when subscription is active and has remaining quota', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn()
          .mockResolvedValueOnce({
            id: 'sub-123',
            status: 'ACTIVE',
            plan: { maxAppointmentsPerMonth: 10 },
          })
          .mockResolvedValueOnce({ count: 5 }), // 5 used out of 10
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
      };

      const service = createService({ databaseService });
      const result = await (service as any).canBookAppointment('user-1', 'clinic-1');

      expect(result.canBook).toBe(true);
    });

    it('should reject booking when quota is exceeded', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn()
          .mockResolvedValueOnce({
            id: 'sub-123',
            status: 'ACTIVE',
            plan: { maxAppointmentsPerMonth: 10 },
          })
          .mockResolvedValueOnce({ count: 10 }), // quota exhausted
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
      };

      const service = createService({ databaseService });
      const result = await (service as any).canBookAppointment('user-1', 'clinic-1');

      expect(result.canBook).toBe(false);
    });
  });

  describe('cancelSubscription', () => {
    it('should cancel an active subscription', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue({
          id: 'sub-123',
          status: 'ACTIVE',
        }),
        executeHealthcareWrite: jest.fn().mockResolvedValue({
          id: 'sub-123',
          status: 'CANCELLED',
          cancelledAt: new Date(),
        }),
        executeHealthcareWriteTransaction: jest.fn(),
      };

      const service = createService({ databaseService });
      const result = await (service as any).cancelSubscription(
        'sub-123',
        'User requested cancellation',
        { role: Role.PATIENT, userId: 'user-1' },
      );

      expect(result.status).toBe('CANCELLED');
    });
  });

  describe('clinic isolation', () => {
    it('should filter billing plans by clinic', async () => {
      const databaseService = {
        executeHealthcareRead: jest.fn().mockResolvedValue([]),
        executeHealthcareWrite: jest.fn(),
        executeHealthcareWriteTransaction: jest.fn(),
      };

      const service = createService({ databaseService });
      await (service as any).getBillingPlans('clinic-1', Role.CLINIC_ADMIN, 'user-1');

      expect(databaseService.executeHealthcareRead).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ clinicId: 'clinic-1' }),
        }),
      );
    });
  });
});
