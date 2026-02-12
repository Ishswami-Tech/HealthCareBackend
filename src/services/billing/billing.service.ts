import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Inject,
  forwardRef,
  Optional,
} from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events';
import { QueueService } from '@queue/src/queue.service';
import {
  LogLevel,
  LogType,
  EventCategory,
  EventPriority,
  EnterpriseEventPayload,
} from '@core/types';
import { INVOICE_PDF_QUEUE } from '@queue/src/queue.constants';
// Future use: BULK_INVOICE_QUEUE, PAYMENT_RECONCILIATION_QUEUE
import { SubscriptionStatus, InvoiceStatus, PaymentStatus } from '@core/types/enums.types';
import {
  CreateBillingPlanDto,
  UpdateBillingPlanDto,
  CreateSubscriptionDto,
  UpdateSubscriptionDto,
  CreatePaymentDto,
  UpdatePaymentDto,
  CreateInvoiceDto,
  UpdateInvoiceDto,
} from '@dtos/billing.dto';
import { InvoicePDFService } from './invoice-pdf.service';
import { WhatsAppService } from '@communication/channels/whatsapp/whatsapp.service';
import { PaymentService } from '@payment/payment.service';
import { ConfigService } from '@config/config.service';
import type {
  PaymentIntentOptions,
  PaymentResult,
  PaymentStatusResult,
  PaymentProvider,
} from '@core/types/payment.types';

// Import centralized types
import type {
  AppointmentWhereInput,
  SubscriptionUpdateInput,
  InvoiceUpdateInput,
} from '@core/types/input.types';
import type {
  PrismaTransactionClientWithDelegates,
  PrismaDelegateArgs,
} from '@core/types/prisma.types';
import type { InvoicePDFData } from '@core/types/billing.types';
import type { AppointmentWithRelations } from '@core/types';

@Injectable()
export class BillingService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService,
    private readonly invoicePDFService: InvoicePDFService,
    private readonly whatsAppService: WhatsAppService,
    private readonly paymentService: PaymentService,
    private readonly configService: ConfigService,
    @Optional()
    @Inject(forwardRef(() => QueueService))
    private readonly queueService?: QueueService
  ) {}

  // ============ Billing Plans ============

  async createBillingPlan(data: CreateBillingPlanDto) {
    try {
      const plan = await this.databaseService.createBillingPlanSafe({
        name: data.name,
        amount: data.amount,
        currency: data.currency || 'INR',
        interval: data.interval,
        intervalCount: data.intervalCount || 1,
        ...(data.description && { description: data.description }),
        ...(data.trialPeriodDays && { trialPeriodDays: data.trialPeriodDays }),
        ...(data.features && { features: data.features }),
        ...(data.clinicId && { clinicId: data.clinicId }),
        ...(data.metadata && { metadata: data.metadata }),
      });

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Billing plan created',
        'BillingService',
        { planId: plan.id, name: plan.name }
      );

      await this.eventService.emit('billing.plan.created', { planId: plan.id });
      await this.cacheService.invalidateCacheByTag('billing_plans');

      return plan;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to create billing plan',
        'BillingService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          data,
        }
      );
      throw error;
    }
  }

  /**
   * Build role-based where clause for billing queries
   */
  private buildBillingWhereClause(
    role: string,
    userId: string,
    clinicId?: string
  ): Record<string, unknown> {
    const where: Record<string, unknown> = {};

    // Apply role-based filtering
    switch (role) {
      case 'SUPER_ADMIN':
        // Super admin can see all (no filter)
        if (clinicId) {
          where['clinicId'] = clinicId;
        }
        break;
      case 'CLINIC_ADMIN':
      case 'FINANCE_BILLING':
        // Clinic admin and finance staff can see their clinic's data
        if (clinicId) {
          where['clinicId'] = clinicId;
        }
        break;
      case 'PATIENT':
        // Patients can only see their own data
        where['userId'] = userId;
        break;
      case 'RECEPTIONIST':
        // Receptionists can see their clinic's data
        if (clinicId) {
          where['clinicId'] = clinicId;
        }
        break;
      default:
        // For other roles, restrict to user's own data
        where['userId'] = userId;
        break;
    }

    return where;
  }

  async getBillingPlans(clinicId?: string, role?: string, _userId?: string) {
    // Build where clause for BillingPlan (doesn't have userId field)
    // BillingPlan only has clinicId, so we filter by clinic or show all active plans
    // IMPORTANT: Never include userId in BillingPlan queries - BillingPlan doesn't have userId field
    const whereClause: Record<string, unknown> = { isActive: true };

    // Apply role-based filtering for BillingPlan
    if (role === 'SUPER_ADMIN') {
      // Super admin can see all (no additional filter beyond isActive)
      if (clinicId) {
        whereClause['clinicId'] = clinicId;
      }
    } else if (role === 'CLINIC_ADMIN' || role === 'FINANCE_BILLING' || role === 'RECEPTIONIST') {
      // Clinic staff can see their clinic's plans
      if (clinicId) {
        whereClause['clinicId'] = clinicId;
      }
    } else if (role === 'PATIENT' || role === 'DOCTOR' || role === 'ASSISTANT_DOCTOR') {
      // Patients and doctors can see:
      // 1. Public plans (clinicId is null)
      // 2. Plans for their clinic (if clinicId is provided)
      if (clinicId) {
        whereClause['clinicId'] = clinicId;
      } else {
        // Show public plans (clinicId is null) or all if no clinic context
        // For now, show all active plans - clinic filtering happens at subscription level
      }
    } else if (clinicId) {
      // Default: filter by clinic if provided
      whereClause['clinicId'] = clinicId;
    }

    // Explicitly remove userId if it somehow got added (defensive programming)
    // BillingPlan model doesn't have userId field
    if ('userId' in whereClause) {
      delete whereClause['userId'];
    }

    const cacheKey = `billing_plans:${clinicId || 'all'}:${role || 'all'}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        return await this.databaseService.findBillingPlansSafe(whereClause);
      },
      {
        ttl: 1800,
        tags: ['billing_plans'],
        priority: 'normal',
      }
    );
  }

  async getBillingPlan(id: string) {
    const cacheKey = `billing_plan:${id}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const plan = await this.databaseService.findBillingPlanByIdSafe(id);

        if (!plan) {
          throw new NotFoundException(`Billing plan with ID ${id} not found`);
        }

        return plan;
      },
      {
        ttl: 3600, // 1 hour
        tags: ['billing_plans', `billing_plan:${id}`],
        priority: 'normal',
      }
    );
  }

  async updateBillingPlan(id: string, data: UpdateBillingPlanDto) {
    const plan = await this.databaseService.updateBillingPlanSafe(id, data);

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Billing plan updated',
      'BillingService',
      { planId: id }
    );

    await this.eventService.emit('billing.plan.updated', { planId: id });
    await this.cacheService.invalidateCacheByTag('billing_plans');

    return plan;
  }

  async deleteBillingPlan(id: string) {
    // Check if plan has active subscriptions
    const activeSubscriptions = await this.databaseService.findSubscriptionsSafe({
      planId: id,
      status: SubscriptionStatus.ACTIVE,
    });

    if (activeSubscriptions.length > 0) {
      throw new ConflictException(
        `Cannot delete plan with ${activeSubscriptions.length} active subscriptions`
      );
    }

    await this.databaseService.deleteBillingPlanSafe(id);

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Billing plan deleted',
      'BillingService',
      { planId: id }
    );

    await this.eventService.emit('billing.plan.deleted', { planId: id });
    await this.cacheService.invalidateCacheByTag('billing_plans');
  }

  // ============ Subscriptions ============

  async createSubscription(data: CreateSubscriptionDto) {
    const plan = await this.getBillingPlan(data.planId);

    // Calculate period dates
    const startDate = data.startDate ? new Date(data.startDate) : new Date();
    const currentPeriodStart = new Date(startDate);
    const currentPeriodEnd = this.calculatePeriodEnd(
      currentPeriodStart,
      plan.interval,
      plan.intervalCount
    );

    // Handle trial period
    let trialStart = data.trialStart ? new Date(data.trialStart) : undefined;
    let trialEnd = data.trialEnd ? new Date(data.trialEnd) : undefined;
    let status = SubscriptionStatus.ACTIVE;

    if (plan.trialPeriodDays && !data.trialStart && !data.trialEnd) {
      trialStart = new Date();
      trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + plan.trialPeriodDays);
      status = SubscriptionStatus.TRIALING;
    }

    // Set appointment quota
    const appointmentsRemaining = plan.isUnlimitedAppointments
      ? null
      : plan.appointmentsIncluded || null;

    try {
      const subscription = await this.databaseService.createSubscriptionSafe({
        userId: data.userId,
        planId: data.planId,
        clinicId: data.clinicId,
        status,
        startDate,
        currentPeriodStart,
        currentPeriodEnd,
        ...(trialStart && { trialStart }),
        ...(trialEnd && { trialEnd }),
        appointmentsUsed: 0,
        ...(data.endDate && { endDate: new Date(data.endDate) }),
        ...(appointmentsRemaining !== null &&
          appointmentsRemaining !== undefined && { appointmentsRemaining }),
        ...(data.metadata && { metadata: data.metadata }),
      });

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Subscription created',
        'BillingService',
        { subscriptionId: subscription.id, userId: data.userId }
      );

      await this.eventService.emit('billing.subscription.created', {
        subscriptionId: subscription.id,
        userId: data.userId,
      });

      await this.cacheService.invalidateCacheByTag(`user_subscriptions:${data.userId}`);

      return subscription;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to create subscription',
        'BillingService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          data,
        }
      );
      throw error;
    }
  }

  async getUserSubscriptions(userId: string, role?: string, requestingUserId?: string) {
    // Apply role-based filtering
    // Patients can only see their own subscriptions
    // Clinic staff can see subscriptions for their clinic
    if (role === 'PATIENT' && requestingUserId && requestingUserId !== userId) {
      throw new BadRequestException('You can only view your own subscriptions');
    }

    const cacheKey = `billing_subscriptions:user:${userId}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const whereClause: Record<string, unknown> = { userId };

        // If clinic staff, also filter by clinic
        if (role && role !== 'PATIENT' && role !== 'SUPER_ADMIN') {
          // Get user's clinic to filter subscriptions
          const user = await this.databaseService.findUserByIdSafe(userId);
          if (user?.primaryClinicId) {
            whereClause['clinicId'] = user.primaryClinicId;
          }
        }

        return await this.databaseService.findSubscriptionsSafe(whereClause);
      },
      {
        ttl: 1800, // 30 minutes
        tags: ['billing_subscriptions', `user:${userId}`],
        priority: 'normal',
      }
    );
  }

  async getSubscription(id: string) {
    const cacheKey = `billing_subscription:${id}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const subscription = await this.databaseService.findSubscriptionByIdSafe(id);

        if (!subscription) {
          throw new NotFoundException(`Subscription with ID ${id} not found`);
        }

        return subscription;
      },
      {
        ttl: 1800, // 30 minutes
        tags: ['billing_subscriptions', `billing_subscription:${id}`],
        priority: 'normal',
      }
    );
  }

  async updateSubscription(id: string, data: UpdateSubscriptionDto) {
    const updateData: SubscriptionUpdateInput = {
      ...(data.status && { status: data.status }),
      ...(data.endDate && { endDate: new Date(data.endDate) }),
      ...(data.cancelAtPeriodEnd !== undefined && {
        cancelAtPeriodEnd: data.cancelAtPeriodEnd,
      }),
      ...(data.metadata && {
        metadata: data.metadata as Record<string, string | number | boolean>,
      }),
    };

    const subscription = await this.databaseService.updateSubscriptionSafe(id, updateData);

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Subscription updated',
      'BillingService',
      { subscriptionId: id }
    );

    await this.eventService.emit('billing.subscription.updated', {
      subscriptionId: id,
    });
    await this.cacheService.invalidateCacheByTag(`user_subscriptions:${subscription.userId}`);

    return subscription;
  }

  async cancelSubscription(id: string, immediate: boolean = false) {
    const subscription = await this.getSubscription(id);

    const updateData: {
      cancelledAt: Date;
      status?: typeof SubscriptionStatus.CANCELLED;
      endDate?: Date;
      cancelAtPeriodEnd?: boolean;
    } = {
      cancelledAt: new Date(),
    };

    if (immediate) {
      updateData.status = SubscriptionStatus.CANCELLED;
      updateData.endDate = new Date();
    } else {
      updateData.cancelAtPeriodEnd = true;
    }

    const updated = await this.databaseService.updateSubscriptionSafe(id, updateData);

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Subscription cancelled',
      'BillingService',
      { subscriptionId: id, immediate }
    );

    await this.eventService.emit('billing.subscription.cancelled', {
      subscriptionId: id,
      immediate,
    });

    await this.cacheService.invalidateCacheByTag(`user_subscriptions:${subscription.userId}`);

    return updated;
  }

  /**
   * Manually renew subscription (public method for admin use)
   */
  async renewSubscription(id: string) {
    const subscription = await this.getSubscription(id);

    if (String(subscription.status) === 'ACTIVE') {
      throw new BadRequestException('Subscription is already active');
    }

    const currentPeriodStart = new Date();
    const currentPeriodEnd = this.calculatePeriodEnd(
      currentPeriodStart,
      subscription.plan?.interval || 'MONTHLY',
      subscription.plan?.intervalCount || 1
    );

    const updated = await this.databaseService.updateSubscriptionSafe(id, {
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: false,
    });

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Subscription renewed',
      'BillingService',
      { subscriptionId: id }
    );

    await this.eventService.emit('billing.subscription.renewed', {
      subscriptionId: id,
    });
    await this.cacheService.invalidateCacheByTag(`user_subscriptions:${subscription.userId}`);

    return updated;
  }

  // ============ Invoices ============

  async createInvoice(data: CreateInvoiceDto) {
    const invoiceNumber = await this.generateInvoiceNumber();
    const totalAmount = data.amount + (data.tax || 0) - (data.discount || 0);

    try {
      const invoice = await this.databaseService.createInvoiceSafe({
        invoiceNumber,
        userId: data.userId,
        clinicId: data.clinicId,
        amount: data.amount,
        tax: data.tax || 0,
        discount: data.discount || 0,
        totalAmount,
        status: InvoiceStatus.DRAFT,
        dueDate: new Date(data.dueDate),
        ...(data.subscriptionId && { subscriptionId: data.subscriptionId }),
        ...(data.description && { description: data.description }),
        ...(data.lineItems && { lineItems: data.lineItems }),
        ...(data.metadata && { metadata: data.metadata }),
      });

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Invoice created',
        'BillingService',
        { invoiceId: invoice.id, invoiceNumber }
      );

      await this.eventService.emit('billing.invoice.created', {
        invoiceId: invoice.id,
      });
      await this.cacheService.invalidateCacheByTag(`user_invoices:${data.userId}`);

      // Queue PDF generation (heavy operation) asynchronously
      if (this.queueService) {
        void this.queueService
          .addJob(
            INVOICE_PDF_QUEUE as string,
            'generate_pdf',
            {
              invoiceId: invoice.id,
              clinicId: invoice.clinicId || '',
              userId: invoice.userId,
              action: 'generate_pdf',
              metadata: {
                invoiceNumber: invoice.invoiceNumber,
                amount:
                  typeof invoice.amount === 'number' ? invoice.amount : Number(invoice.amount),
                totalAmount:
                  typeof invoice.totalAmount === 'number'
                    ? invoice.totalAmount
                    : Number(invoice.totalAmount),
              },
            },
            {
              priority: 5, // NORMAL priority (QueueService.PRIORITIES.NORMAL)
              attempts: 3,
            }
          )
          .catch((error: unknown) => {
            void this.loggingService.log(
              LogType.QUEUE,
              LogLevel.WARN,
              'Failed to queue invoice PDF generation',
              'BillingService',
              {
                invoiceId: invoice.id,
                error: error instanceof Error ? error.message : String(error),
              }
            );
          });
      }

      return invoice;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to create invoice',
        'BillingService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          data,
        }
      );
      throw error;
    }
  }

  async getUserInvoices(userId: string, role?: string, requestingUserId?: string) {
    // Apply role-based filtering
    // Patients can only see their own invoices
    // Clinic staff can see invoices for their clinic
    if (role === 'PATIENT' && requestingUserId && requestingUserId !== userId) {
      throw new BadRequestException('You can only view your own invoices');
    }

    const cacheKey = `user_invoices:${userId}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const whereClause: Record<string, unknown> = { userId };

        // If clinic staff, also filter by clinic
        if (role && role !== 'PATIENT' && role !== 'SUPER_ADMIN') {
          // Get user's clinic to filter invoices
          const user = await this.databaseService.findUserByIdSafe(userId);
          if (user?.primaryClinicId) {
            whereClause['clinicId'] = user.primaryClinicId;
          }
        }

        return await this.databaseService.findInvoicesSafe(whereClause);
      },
      {
        ttl: 900,
        tags: [`user_invoices:${userId}`],
        priority: 'normal',
      }
    );
  }

  async getInvoice(id: string) {
    const invoice = await this.databaseService.findInvoiceByIdSafe(id);

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    return invoice;
  }

  async updateInvoice(id: string, data: UpdateInvoiceDto) {
    const updateData: UpdateInvoiceDto & { totalAmount?: number } = { ...data };

    if (data.amount !== undefined || data.tax !== undefined || data.discount !== undefined) {
      const invoice = await this.databaseService.findInvoiceByIdSafe(id);
      if (!invoice) {
        throw new NotFoundException(`Invoice with ID ${id} not found`);
      }

      const amount = data.amount ?? invoice.amount;
      const tax = data.tax ?? invoice.tax ?? 0;
      const discount = data.discount ?? invoice.discount ?? 0;
      updateData.totalAmount = amount + tax - discount;
    }

    // Convert string dates to Date objects for InvoiceUpdateInput
    const invoiceUpdateData: InvoiceUpdateInput = {
      ...(updateData.status && { status: updateData.status }),
      ...(updateData.amount !== undefined && { amount: updateData.amount }),
      ...(updateData.tax !== undefined && { tax: updateData.tax }),
      ...(updateData.discount !== undefined && { discount: updateData.discount }),
      ...(updateData.description && { description: updateData.description }),
      ...(updateData.lineItems && { lineItems: updateData.lineItems }),
      ...(updateData.metadata && { metadata: updateData.metadata }),
      ...(updateData.totalAmount !== undefined && { totalAmount: updateData.totalAmount }),
      ...(updateData.dueDate
        ? {
            dueDate:
              typeof updateData.dueDate === 'string'
                ? new Date(updateData.dueDate)
                : updateData.dueDate &&
                    typeof updateData.dueDate === 'object' &&
                    'getTime' in updateData.dueDate
                  ? (updateData.dueDate as Date)
                  : new Date(String(updateData.dueDate)),
          }
        : {}),
    };

    const invoice = await this.databaseService.updateInvoiceSafe(id, invoiceUpdateData);

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Invoice updated',
      'BillingService',
      { invoiceId: id }
    );

    await this.eventService.emit('billing.invoice.updated', { invoiceId: id });
    await this.cacheService.invalidateCacheByTag(`user_invoices:${invoice.userId}`);

    return invoice;
  }

  async markInvoiceAsPaid(id: string) {
    const invoice = await this.databaseService.updateInvoiceSafe(id, {
      status: InvoiceStatus.PAID,
      paidAt: new Date(),
    });

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Invoice marked as paid',
      'BillingService',
      { invoiceId: id }
    );

    await this.eventService.emit('billing.invoice.paid', { invoiceId: id });
    await this.cacheService.invalidateCacheByTag(`user_invoices:${invoice.userId}`);

    return invoice;
  }

  // ============ Payments ============

  async createPayment(data: CreatePaymentDto) {
    try {
      const payment = await this.databaseService.createPaymentSafe({
        amount: data.amount,
        clinicId: data.clinicId,
        status: PaymentStatus.PENDING,
        ...(data.appointmentId && { appointmentId: data.appointmentId }),
        ...(data.userId && { userId: data.userId }),
        ...(data.invoiceId && { invoiceId: data.invoiceId }),
        ...(data.subscriptionId && { subscriptionId: data.subscriptionId }),
        ...(data.method && { method: data.method }),
        ...(data.transactionId && { transactionId: data.transactionId }),
        ...(data.description && { description: data.description }),
        ...(data.metadata && { metadata: data.metadata }),
      });

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Payment created',
        'BillingService',
        { paymentId: payment.id, amount: payment.amount }
      );

      await this.eventService.emit('billing.payment.created', {
        paymentId: payment.id,
      });

      if (data.userId) {
        await this.cacheService.invalidateCacheByTag(`user_payments:${data.userId}`);
      }

      return payment;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to create payment',
        'BillingService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          data,
        }
      );
      throw error;
    }
  }

  async updatePayment(id: string, data: UpdatePaymentDto) {
    const payment = await this.databaseService.updatePaymentSafe(id, {
      ...data,
      ...(data.refundAmount !== undefined && { refundedAt: new Date() }),
    });

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Payment updated',
      'BillingService',
      { paymentId: id }
    );

    await this.eventService.emit('billing.payment.updated', { paymentId: id });

    // Invalidate cache if payment has userId
    if ('userId' in payment && payment.userId) {
      await this.cacheService.invalidateCacheByTag(`user_payments:${payment.userId}`);
    }

    // Auto-update invoice if payment is linked to one
    if ('invoiceId' in payment && payment.invoiceId && String(data.status) === 'COMPLETED') {
      await this.markInvoiceAsPaid(payment.invoiceId);
    }

    return payment;
  }

  async getUserPayments(userId: string, role?: string, requestingUserId?: string) {
    // Apply role-based filtering
    // Patients can only see their own payments
    // Clinic staff can see payments for their clinic
    if (role === 'PATIENT' && requestingUserId && requestingUserId !== userId) {
      throw new BadRequestException('You can only view your own payments');
    }

    const cacheKey = `user_payments:${userId}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const whereClause: Record<string, unknown> = { userId };

        // If clinic staff, also filter by clinic
        if (role && role !== 'PATIENT' && role !== 'SUPER_ADMIN') {
          // Get user's clinic to filter payments
          const user = await this.databaseService.findUserByIdSafe(userId);
          if (user?.primaryClinicId) {
            whereClause['clinicId'] = user.primaryClinicId;
          }
        }

        return await this.databaseService.findPaymentsSafe(whereClause);
      },
      {
        ttl: 900,
        tags: [`user_payments:${userId}`],
        priority: 'normal',
      }
    );
  }

  async getPayment(id: string) {
    const payment = await this.databaseService.findPaymentByIdSafe(id);

    if (!payment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }

    return payment;
  }

  // ============ Helper Methods ============

  private calculatePeriodEnd(start: Date, interval: string, intervalCount: number): Date {
    const end = new Date(start);

    switch (interval) {
      case 'DAILY':
        end.setDate(end.getDate() + intervalCount);
        break;
      case 'WEEKLY':
        end.setDate(end.getDate() + intervalCount * 7);
        break;
      case 'MONTHLY':
        end.setMonth(end.getMonth() + intervalCount);
        break;
      case 'QUARTERLY':
        end.setMonth(end.getMonth() + intervalCount * 3);
        break;
      case 'YEARLY':
        end.setFullYear(end.getFullYear() + intervalCount);
        break;
    }

    return end;
  }

  private async generateInvoiceNumber(): Promise<string> {
    const COUNTER_KEY = 'invoice:counter';
    const currentId = await this.cacheService.get(COUNTER_KEY);
    const nextId = currentId ? parseInt(currentId as string) + 1 : 1;
    await this.cacheService.set(COUNTER_KEY, nextId.toString());

    const year = new Date().getFullYear();
    return `INV-${year}-${nextId.toString().padStart(6, '0')}`;
  }

  // ============ Subscription Appointment Management ============

  async canBookAppointment(
    subscriptionId: string,
    appointmentType?: string
  ): Promise<{
    allowed: boolean;
    requiresPayment?: boolean;
    paymentAmount?: number;
    reason?: string;
  }> {
    const subscription = await this.databaseService.findSubscriptionByIdSafe(subscriptionId);

    if (!subscription) {
      return { allowed: false, reason: 'Subscription not found' };
    }

    if (String(subscription.status) !== 'ACTIVE' && String(subscription.status) !== 'TRIALING') {
      return {
        allowed: false,
        reason: `Subscription is ${subscription.status.toLowerCase()}`,
      };
    }

    // Check if current period has ended
    if (new Date() > subscription.currentPeriodEnd) {
      return { allowed: false, reason: 'Subscription period has ended' };
    }

    // Check if specific appointment type is covered
    if (appointmentType && subscription.plan?.appointmentTypes) {
      const appointmentTypes = subscription.plan.appointmentTypes;
      const isCovered = appointmentTypes[appointmentType] === true;

      if (!isCovered) {
        // Get payment amount from metadata
        const metadata =
          (subscription.plan?.metadata as Record<string, string | number | boolean>) || {};
        const paymentKey = `${appointmentType.toLowerCase()}Price`;
        const paymentAmount =
          Number(metadata[paymentKey]) || this.getDefaultAppointmentPrice(appointmentType);

        return {
          allowed: false,
          requiresPayment: true,
          paymentAmount,
          reason: `${appointmentType} appointments require separate payment of ₹${paymentAmount}`,
        };
      }
    }

    // If unlimited appointments, allow
    if (subscription.plan?.isUnlimitedAppointments) {
      return { allowed: true };
    }

    // Check if appointments are included in plan
    if (!subscription.plan?.appointmentsIncluded) {
      return {
        allowed: false,
        requiresPayment: true,
        reason: 'Plan does not include appointments',
      };
    }

    // Check remaining quota
    if (
      subscription.appointmentsRemaining !== null &&
      subscription.appointmentsRemaining !== undefined &&
      subscription.appointmentsRemaining <= 0
    ) {
      return {
        allowed: false,
        requiresPayment: true,
        reason: 'Appointment quota exceeded for this period',
      };
    }

    return { allowed: true };
  }

  private getDefaultAppointmentPrice(appointmentType: string): number {
    const prices: Record<string, number> = {
      IN_PERSON: 500,
      VIDEO_CALL: 1000,
      HOME_VISIT: 1500,
    };
    return prices[appointmentType] || 500;
  }

  async checkAppointmentCoverage(subscriptionId: string, appointmentType: string) {
    const result = await this.canBookAppointment(subscriptionId, appointmentType);

    if (result.allowed) {
      const subscription = await this.databaseService.findSubscriptionByIdSafe(subscriptionId);

      return {
        covered: true,
        requiresPayment: false,
        quotaAvailable: true,
        remaining: subscription?.appointmentsRemaining || null,
        total: subscription?.plan?.appointmentsIncluded || null,
        isUnlimited: subscription?.plan?.isUnlimitedAppointments || false,
      };
    }

    return {
      covered: false,
      requiresPayment: result.requiresPayment || false,
      paymentAmount: result.paymentAmount || null,
      message: result.reason,
    };
  }

  async bookAppointmentWithSubscription(subscriptionId: string, appointmentId: string) {
    const canBook = await this.canBookAppointment(subscriptionId);

    if (!canBook.allowed) {
      throw new BadRequestException(canBook.reason);
    }

    const subscription = await this.databaseService.findSubscriptionByIdSafe(subscriptionId);

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    // Update appointment to link with subscription using executeHealthcareWrite
    // Note: subscriptionId and isSubscriptionBased are not part of AppointmentUpdateInput
    // Use executeHealthcareWrite for direct Prisma access with full optimization layers
    await this.databaseService.executeHealthcareWrite<AppointmentWithRelations>(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        return await typedClient.appointment.update({
          where: { id: appointmentId } as PrismaDelegateArgs,
          data: {
            subscriptionId,
            isSubscriptionBased: true,
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: 'system',
        clinicId: subscription.clinicId || '',
        resourceType: 'APPOINTMENT',
        operation: 'UPDATE',
        resourceId: appointmentId,
        userRole: 'system',
        details: { subscriptionId, isSubscriptionBased: true },
      }
    );

    // Update subscription usage if not unlimited
    if (!subscription.plan?.isUnlimitedAppointments) {
      await this.databaseService.updateSubscriptionSafe(subscriptionId, {
        appointmentsUsed: subscription.appointmentsUsed + 1,
        ...(subscription.appointmentsRemaining !== null &&
          subscription.appointmentsRemaining !== undefined && {
            appointmentsRemaining: subscription.appointmentsRemaining - 1,
          }),
      });
    }

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Appointment booked with subscription',
      'BillingService',
      { subscriptionId, appointmentId }
    );

    await this.eventService.emit('billing.appointment.booked', {
      subscriptionId,
      appointmentId,
    });
    await this.cacheService.invalidateCacheByTag(`user_subscriptions:${subscription.userId}`);
  }

  // ============ Payment Processing ============

  /**
   * Process subscription payment (monthly for in-person appointments)
   * Creates invoice and payment intent for subscription renewal
   */
  async processSubscriptionPayment(
    subscriptionId: string,
    provider?: PaymentProvider
  ): Promise<{ invoice: unknown; paymentIntent: PaymentResult }> {
    const subscription = await this.databaseService.findSubscriptionByIdSafe(subscriptionId);

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    if (!subscription.plan) {
      throw new BadRequestException('Subscription plan not found');
    }

    // Create invoice for subscription renewal
    const invoice = await this.createInvoice({
      userId: subscription.userId,
      clinicId: subscription.clinicId,
      subscriptionId: subscription.id,
      amount: subscription.plan.amount,
      tax: 0,
      discount: 0,
      dueDate: new Date(subscription.currentPeriodEnd).toISOString(),
      description: `Subscription renewal for ${subscription.plan.name}`,
      lineItems: {
        items: [
          {
            description: subscription.plan.name,
            amount: subscription.plan.amount,
            quantity: 1,
          },
        ],
      },
      metadata: {
        subscriptionId: subscription.id,
        planId: subscription.planId,
        periodStart: subscription.currentPeriodStart.toISOString(),
        periodEnd: subscription.currentPeriodEnd.toISOString(),
      },
    });

    // Get user details for payment
    const user = await this.databaseService.findUserByIdSafe(subscription.userId);

    // Create payment intent via payment service
    // SECURITY: Use ConfigService instead of hardcoded URL
    const baseUrl =
      this.configService.getEnv('BASE_URL') ||
      this.configService.getEnv('API_URL') ||
      (() => {
        throw new Error(
          'Missing required environment variable: BASE_URL or API_URL. Please set BASE_URL or API_URL in environment configuration.'
        );
      })();
    const paymentIntentOptions: PaymentIntentOptions = {
      amount: subscription.plan.amount * 100, // Convert to paise
      currency: subscription.plan.currency || 'INR',
      orderId: invoice.invoiceNumber,
      customerId: subscription.userId,
      ...(user?.email && { customerEmail: user.email }),
      ...(user?.phone && { customerPhone: user.phone }),
      ...(user?.name && { customerName: user.name }),
      description: `Subscription payment for ${subscription.plan.name}`,
      isSubscription: true,
      subscriptionId: subscription.id,
      subscriptionInterval: subscription.plan.interval.toLowerCase() as
        | 'daily'
        | 'weekly'
        | 'monthly'
        | 'quarterly'
        | 'yearly',
      clinicId: subscription.clinicId,
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        subscriptionId: subscription.id,
        planId: subscription.planId,
        baseUrl,
        redirectUrl: `${baseUrl}/payment/callback`,
        callbackUrl: `${baseUrl}/api/v1/payments/webhook`,
      },
    };

    const paymentIntentResult: PaymentResult = await this.paymentService.createPaymentIntent(
      subscription.clinicId,
      paymentIntentOptions,
      provider
    );

    // Extract payment intent details with proper type checking
    const paymentId = paymentIntentResult.paymentId || '';
    const orderId = paymentIntentResult.orderId || '';
    const providerName = paymentIntentResult.provider || '';
    const redirectUrl =
      paymentIntentResult.metadata &&
      typeof paymentIntentResult.metadata === 'object' &&
      !Array.isArray(paymentIntentResult.metadata)
        ? paymentIntentResult.metadata['redirectUrl']
        : undefined;

    // Create payment record
    const payment = await this.createPayment({
      amount: subscription.plan.amount,
      clinicId: subscription.clinicId,
      userId: subscription.userId,
      invoiceId: invoice.id,
      subscriptionId: subscription.id,
      ...(paymentId && { transactionId: paymentId }),
      description: `Subscription payment for ${subscription.plan.name}`,
      metadata: {
        paymentIntentId: paymentId,
        orderId,
        provider: providerName,
        ...(typeof redirectUrl === 'string' ? { redirectUrl } : {}),
      },
    });

    await this.loggingService.log(
      LogType.PAYMENT,
      LogLevel.INFO,
      'Subscription payment intent created',
      'BillingService',
      {
        subscriptionId,
        invoiceId: invoice.id,
        paymentId: payment.id,
        amount: subscription.plan.amount,
      }
    );

    return {
      invoice,
      paymentIntent: paymentIntentResult,
    };
  }

  /**
   * Process per-appointment payment (VIDEO_CALL only).
   * IN_PERSON appointments require subscription - use bookAppointmentWithSubscription.
   */
  async processAppointmentPayment(
    appointmentId: string,
    amount: number,
    appointmentType: 'VIDEO_CALL' | 'IN_PERSON' | 'HOME_VISIT',
    provider?: PaymentProvider
  ): Promise<{ invoice: unknown; paymentIntent: PaymentResult }> {
    if (appointmentType === 'IN_PERSON') {
      throw new BadRequestException(
        'IN_PERSON appointments are covered by subscription. Please use an active subscription to book.'
      );
    }

    const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    if (String(appointment.type) !== appointmentType) {
      throw new BadRequestException(
        `Appointment type mismatch. Expected ${appointmentType}, got ${appointment.type}`
      );
    }

    // Get user details
    const user = await this.databaseService.findUserByIdSafe(appointment.patientId);

    // Create invoice for appointment payment
    const invoice = await this.createInvoice({
      userId: appointment.patientId,
      clinicId: appointment.clinicId,
      amount,
      tax: 0,
      discount: 0,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
      description: `Payment for ${appointmentType} appointment`,
      lineItems: {
        items: [
          {
            description: `${appointmentType} Appointment`,
            amount,
            quantity: 1,
          },
        ],
      },
      metadata: {
        appointmentId: appointment.id,
        appointmentType,
      },
    });

    // Create payment intent via payment service
    // SECURITY: Use ConfigService instead of hardcoded URL
    const baseUrl =
      this.configService.getEnv('BASE_URL') ||
      this.configService.getEnv('API_URL') ||
      (() => {
        throw new Error(
          'Missing required environment variable: BASE_URL or API_URL. Please set BASE_URL or API_URL in environment configuration.'
        );
      })();
    const paymentIntentOptions: PaymentIntentOptions = {
      amount: amount * 100, // Convert to paise
      currency: 'INR',
      orderId: invoice.invoiceNumber,
      customerId: appointment.patientId,
      ...(user?.email && { customerEmail: user.email }),
      ...(user?.phone && { customerPhone: user.phone }),
      ...(user?.name && { customerName: user.name }),
      description: `Payment for ${appointmentType} appointment`,
      appointmentId: appointment.id,
      appointmentType,
      clinicId: appointment.clinicId,
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        appointmentId: appointment.id,
        appointmentType,
        baseUrl,
        redirectUrl: `${baseUrl}/payment/callback`,
        callbackUrl: `${baseUrl}/api/v1/payments/webhook`,
      },
    };

    const paymentIntentResult: PaymentResult = await this.paymentService.createPaymentIntent(
      appointment.clinicId,
      paymentIntentOptions,
      provider
    );

    // Extract payment intent details with proper type checking
    const paymentId = paymentIntentResult.paymentId || '';
    const orderId = paymentIntentResult.orderId || '';
    const providerName = paymentIntentResult.provider || '';
    const redirectUrl =
      paymentIntentResult.metadata &&
      typeof paymentIntentResult.metadata === 'object' &&
      !Array.isArray(paymentIntentResult.metadata)
        ? paymentIntentResult.metadata['redirectUrl']
        : undefined;

    // Create payment record
    const payment = await this.createPayment({
      amount,
      clinicId: appointment.clinicId,
      userId: appointment.patientId,
      appointmentId: appointment.id,
      invoiceId: invoice.id,
      ...(paymentId && { transactionId: paymentId }),
      description: `Payment for ${appointmentType} appointment`,
      metadata: {
        paymentIntentId: paymentId,
        orderId,
        provider: providerName,
        appointmentType,
        ...(typeof redirectUrl === 'string' ? { redirectUrl } : {}),
      },
    });

    await this.loggingService.log(
      LogType.PAYMENT,
      LogLevel.INFO,
      'Appointment payment intent created',
      'BillingService',
      {
        appointmentId,
        invoiceId: invoice.id,
        paymentId: payment.id,
        amount,
        appointmentType,
      }
    );

    return {
      invoice,
      paymentIntent: paymentIntentResult,
    };
  }

  /**
   * Handle payment callback/webhook
   * Updates payment status and processes completion
   */
  async handlePaymentCallback(
    clinicId: string,
    paymentId: string,
    orderId: string,
    provider?: PaymentProvider
  ): Promise<{ payment: unknown; invoice?: unknown }> {
    try {
      // Verify payment status with provider
      const paymentStatus: PaymentStatusResult = await this.paymentService.verifyPayment(
        clinicId,
        { paymentId, orderId },
        provider
      );

      // Find payment record
      const payment = await this.databaseService.findPaymentByIdSafe(paymentId);
      if (!payment) {
        // Try to find by transactionId
        const payments = await this.databaseService.findPaymentsSafe({
          transactionId: paymentId,
        });
        if (payments.length === 0) {
          throw new NotFoundException('Payment record not found');
        }
        const foundPayment = payments[0]!;

        // Update payment status
        const updatedPayment = await this.updatePayment(foundPayment.id, {
          status: paymentStatus.status as PaymentStatus,
          transactionId: paymentStatus.transactionId || paymentId,
        });

        // If payment completed and linked to invoice, mark invoice as paid
        if (
          paymentStatus.status === 'completed' &&
          'invoiceId' in foundPayment &&
          foundPayment.invoiceId
        ) {
          await this.markInvoiceAsPaid(foundPayment.invoiceId);
        }

        // If payment is for subscription, update subscription
        if (
          paymentStatus.status === 'completed' &&
          'subscriptionId' in foundPayment &&
          foundPayment.subscriptionId
        ) {
          await this.renewSubscriptionAfterPayment(foundPayment.subscriptionId);
        }

        const paymentCompletedEvent: EnterpriseEventPayload = {
          eventId: `payment-completed-${foundPayment.id}`,
          eventType: 'payment.completed',
          category: EventCategory.BILLING,
          priority: EventPriority.HIGH,
          timestamp: new Date().toISOString(),
          source: 'BillingService',
          version: '1.0.0',
          clinicId,
          ...(foundPayment.userId && { userId: foundPayment.userId }),
          metadata: {
            paymentId: foundPayment.id,
            amount: paymentStatus.amount,
            status: paymentStatus.status,
            ...(foundPayment.appointmentId && { appointmentId: foundPayment.appointmentId }),
            ...(foundPayment.subscriptionId && { subscriptionId: foundPayment.subscriptionId }),
          },
        };
        await this.eventService.emitEnterprise('payment.completed', paymentCompletedEvent);

        // Also emit simple event for @OnEvent listeners
        if (foundPayment.appointmentId && paymentStatus.status === 'completed') {
          await this.eventService.emit('payment.completed', {
            appointmentId: foundPayment.appointmentId,
            paymentId: foundPayment.id,
            status: paymentStatus.status,
            clinicId,
          });
        }

        return { payment: updatedPayment };
      }

      // Update payment status
      const updatedPayment = await this.updatePayment(payment.id, {
        status: paymentStatus.status as PaymentStatus,
        transactionId: paymentStatus.transactionId || paymentId,
      });

      // If payment completed and linked to invoice, mark invoice as paid
      if (paymentStatus.status === 'completed' && 'invoiceId' in payment && payment.invoiceId) {
        const invoice = await this.markInvoiceAsPaid(payment.invoiceId);
        return { payment: updatedPayment, invoice };
      }

      // If payment is for subscription, update subscription
      if (
        paymentStatus.status === 'completed' &&
        'subscriptionId' in payment &&
        payment.subscriptionId
      ) {
        await this.renewSubscriptionAfterPayment(payment.subscriptionId);
      }

      const paymentCompletedEvent: EnterpriseEventPayload = {
        eventId: `payment-completed-${payment.id}`,
        eventType: 'payment.completed',
        category: EventCategory.BILLING,
        priority: EventPriority.HIGH,
        timestamp: new Date().toISOString(),
        source: 'BillingService',
        version: '1.0.0',
        clinicId,
        ...(payment.userId && { userId: payment.userId }),
        metadata: {
          paymentId: payment.id,
          amount: paymentStatus.amount,
          status: paymentStatus.status,
          ...(payment.appointmentId && { appointmentId: payment.appointmentId }),
          ...(payment.subscriptionId && { subscriptionId: payment.subscriptionId }),
        },
      };
      await this.eventService.emitEnterprise('payment.completed', paymentCompletedEvent);

      // Also emit simple event for @OnEvent listeners
      if (payment.appointmentId && paymentStatus.status === 'completed') {
        await this.eventService.emit('payment.completed', {
          appointmentId: payment.appointmentId,
          paymentId: payment.id,
          status: paymentStatus.status,
          clinicId,
        });
      }

      return { payment: updatedPayment };
    } catch (error) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        `Failed to handle payment callback: ${error instanceof Error ? error.message : String(error)}`,
        'BillingService',
        {
          clinicId,
          paymentId,
          orderId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Renew subscription after successful payment (internal method)
   */
  private async renewSubscriptionAfterPayment(subscriptionId: string): Promise<void> {
    const subscription = await this.databaseService.findSubscriptionByIdSafe(subscriptionId);

    if (!subscription || !subscription.plan) {
      return;
    }

    // Calculate new period
    const newPeriodStart = new Date(subscription.currentPeriodEnd);
    const newPeriodEnd = this.calculatePeriodEnd(
      newPeriodStart,
      subscription.plan.interval,
      subscription.plan.intervalCount
    );

    // Reset appointment usage for new period
    const appointmentsRemaining = subscription.plan.isUnlimitedAppointments
      ? null
      : subscription.plan.appointmentsIncluded || null;

    await this.databaseService.updateSubscriptionSafe(subscriptionId, {
      currentPeriodStart: newPeriodStart,
      currentPeriodEnd: newPeriodEnd,
      status: SubscriptionStatus.ACTIVE,
      appointmentsUsed: 0,
      ...(appointmentsRemaining !== null && { appointmentsRemaining }),
    });

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Subscription renewed after payment',
      'BillingService',
      {
        subscriptionId,
        newPeriodStart: newPeriodStart.toISOString(),
        newPeriodEnd: newPeriodEnd.toISOString(),
      }
    );

    await this.eventService.emit('billing.subscription.renewed', {
      subscriptionId,
      periodStart: newPeriodStart,
      periodEnd: newPeriodEnd,
    });
  }

  /**
   * Process refund for a payment
   */
  async refundPayment(
    clinicId: string,
    paymentId: string,
    amount?: number,
    reason?: string,
    provider?: PaymentProvider
  ): Promise<{
    success: boolean;
    refundId?: string;
    amount: number;
    status: string;
    error?: string;
  }> {
    try {
      // Get payment to verify it exists and get amount
      const payment = await this.databaseService.findPaymentByIdSafe(paymentId);
      if (!payment) {
        throw new NotFoundException('Payment not found');
      }

      // Verify payment belongs to clinic
      if (payment.clinicId !== clinicId) {
        throw new BadRequestException('Payment does not belong to this clinic');
      }

      // Check if payment is already refunded
      if ('refundAmount' in payment && payment.refundAmount && payment.refundAmount > 0) {
        const totalRefunded = payment.refundAmount;
        const paymentAmount = payment.amount;
        if (totalRefunded >= paymentAmount) {
          throw new BadRequestException('Payment has already been fully refunded');
        }
        if (amount && totalRefunded + amount > paymentAmount) {
          throw new BadRequestException(
            `Refund amount exceeds remaining amount. Remaining: ₹${paymentAmount - totalRefunded}`
          );
        }
      }

      // Process refund via payment service
      const refundOptions: {
        paymentId: string;
        amount?: number;
        reason?: string;
        metadata?: Record<string, string | number | boolean>;
      } = {
        paymentId: payment.transactionId || paymentId,
        metadata: {
          clinicId,
          originalPaymentId: payment.id,
          refundedBy: 'system',
        },
      };
      if (amount !== undefined) {
        refundOptions.amount = amount * 100; // Convert to paise
      }
      if (reason !== undefined) {
        refundOptions.reason = reason;
      }
      const refundResult = await this.paymentService.refund(clinicId, refundOptions, provider);

      if (!refundResult.success) {
        throw new BadRequestException(refundResult.error || 'Refund failed');
      }

      // Update payment record with refund information
      const currentRefundAmount = ('refundAmount' in payment && payment.refundAmount) || 0;
      const refundAmount = refundResult.amount;
      const newRefundAmount = currentRefundAmount + refundAmount;

      await this.updatePayment(payment.id, {
        refundAmount: newRefundAmount,
        status:
          newRefundAmount >= payment.amount ? PaymentStatus.REFUNDED : PaymentStatus.COMPLETED,
      });

      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'Payment refund processed successfully',
        'BillingService',
        {
          paymentId: payment.id,
          refundId: refundResult.refundId,
          amount: refundAmount,
          clinicId,
        }
      );

      const result: {
        success: boolean;
        refundId?: string;
        amount: number;
        status: string;
        error?: string;
      } = {
        success: true,
        amount: refundAmount,
        status: refundResult.status,
      };
      if (refundResult.refundId !== undefined) {
        result.refundId = refundResult.refundId;
      }
      return result;
    } catch (error) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        `Failed to process refund: ${error instanceof Error ? error.message : String(error)}`,
        'BillingService',
        {
          paymentId,
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  async cancelSubscriptionAppointment(appointmentId: string) {
    const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);

    // Type-safe check for subscription properties
    if (!appointment || !('subscriptionId' in appointment) || !appointment.subscriptionId) {
      return;
    }

    // Get subscription with proper type checking
    const subscription = await this.databaseService.findSubscriptionByIdSafe(
      appointment.subscriptionId
    );

    if (!subscription) {
      return;
    }

    // Restore appointment quota if not unlimited
    if (!subscription.plan?.isUnlimitedAppointments) {
      await this.databaseService.updateSubscriptionSafe(appointment.subscriptionId, {
        appointmentsUsed:
          subscription.appointmentsRemaining !== null &&
          subscription.appointmentsRemaining !== undefined
            ? subscription.appointmentsRemaining + 1
            : 1,
        ...(subscription.appointmentsRemaining !== null &&
          subscription.appointmentsRemaining !== undefined && {
            appointmentsRemaining: subscription.appointmentsRemaining + 1,
          }),
      });
    }

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Subscription appointment cancelled, quota restored',
      'BillingService',
      {
        subscriptionId: appointment.subscriptionId,
        appointmentId,
      }
    );

    await this.eventService.emit('billing.appointment.cancelled', {
      subscriptionId: appointment.subscriptionId,
      appointmentId,
    });

    await this.cacheService.invalidateCacheByTag(`user_subscriptions:${subscription.userId}`);
  }

  async getActiveUserSubscription(userId: string, clinicId: string) {
    const subscriptions = await this.databaseService.findSubscriptionsSafe({
      userId,
      clinicId,
    });

    const subscription = subscriptions
      .filter(
        sub =>
          (String(sub.status) === 'ACTIVE' || String(sub.status) === 'TRIALING') &&
          sub.currentPeriodEnd >= new Date()
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

    return subscription;
  }

  async getSubscriptionUsageStats(subscriptionId: string) {
    const subscription = await this.getSubscription(subscriptionId);

    const appointments = await this.databaseService.findAppointmentsSafe({
      subscriptionId,
      status: 'SCHEDULED',
    } as AppointmentWhereInput);

    const appointmentCount = appointments.length;

    return {
      subscriptionId,
      planName: subscription.plan?.name || '',
      appointmentsIncluded: subscription.plan?.appointmentsIncluded,
      isUnlimited: subscription.plan?.isUnlimitedAppointments || false,
      appointmentsUsed: subscription.appointmentsUsed,
      appointmentsRemaining: subscription.appointmentsRemaining,
      actualAppointmentCount: appointmentCount,
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      status: subscription.status,
    };
  }

  async resetSubscriptionQuota(subscriptionId: string) {
    const subscription = await this.getSubscription(subscriptionId);

    // Reset quota for new period
    const appointmentsRemaining = subscription.plan?.isUnlimitedAppointments
      ? null
      : subscription.plan?.appointmentsIncluded || null;

    await this.databaseService.updateSubscriptionSafe(subscriptionId, {
      appointmentsUsed: 0,
      ...(appointmentsRemaining !== null &&
        appointmentsRemaining !== undefined && { appointmentsRemaining }),
    });

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Subscription quota reset',
      'BillingService',
      { subscriptionId }
    );

    await this.eventService.emit('billing.subscription.quota_reset', {
      subscriptionId,
    });
    await this.cacheService.invalidateCacheByTag(`user_subscriptions:${subscription.userId}`);
  }

  // ============ Analytics ============

  async getClinicRevenue(
    clinicId: string,
    startDate?: Date,
    endDate?: Date,
    role?: string,
    userId?: string
  ) {
    // Apply role-based filtering - only clinic staff and super admin can access
    if (role && role !== 'SUPER_ADMIN' && role !== 'CLINIC_ADMIN' && role !== 'FINANCE_BILLING') {
      throw new BadRequestException('Insufficient permissions to view clinic revenue');
    }

    // Build role-based where clause for additional filtering
    const roleBasedFilter =
      role && userId ? this.buildBillingWhereClause(role, userId, clinicId) : {};

    const where: {
      clinicId: string;
      status: typeof PaymentStatus.COMPLETED;
      createdAt?: {
        gte?: Date;
        lte?: Date;
      };
      userId?: string;
    } = {
      clinicId,
      status: PaymentStatus.COMPLETED,
      ...roleBasedFilter,
    };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const payments = await this.databaseService.findPaymentsSafe(where);

    const totalRevenue = payments.reduce(
      (sum: number, payment: { amount: number }) => sum + payment.amount,
      0
    );

    return {
      totalRevenue,
      paymentCount: payments.length,
      averagePayment: payments.length > 0 ? totalRevenue / payments.length : 0,
      payments,
    };
  }

  async getSubscriptionMetrics(clinicId: string, role?: string, userId?: string) {
    // Apply role-based filtering - only clinic staff and super admin can access
    if (role && role !== 'SUPER_ADMIN' && role !== 'CLINIC_ADMIN' && role !== 'FINANCE_BILLING') {
      throw new BadRequestException('Insufficient permissions to view subscription metrics');
    }

    const whereClause = this.buildBillingWhereClause(role || 'SUPER_ADMIN', userId || '', clinicId);
    const subscriptions = await this.databaseService.findSubscriptionsSafe({
      ...whereClause,
      clinicId,
    });

    type SubscriptionWithPlan = (typeof subscriptions)[number];

    const active = subscriptions.filter(
      (s: SubscriptionWithPlan) => String(s.status) === 'ACTIVE'
    ).length;
    const trialing = subscriptions.filter(
      (s: SubscriptionWithPlan) => String(s.status) === 'TRIALING'
    ).length;
    const cancelled = subscriptions.filter(
      (s: SubscriptionWithPlan) => String(s.status) === 'CANCELLED'
    ).length;
    const pastDue = subscriptions.filter(
      (s: SubscriptionWithPlan) => String(s.status) === 'PAST_DUE'
    ).length;

    const monthlyRecurringRevenue = subscriptions
      .filter((s: SubscriptionWithPlan) => String(s.status) === 'ACTIVE')
      .reduce((sum: number, sub: SubscriptionWithPlan) => {
        const planAmount = sub.plan?.amount || 0;
        const monthlyAmount =
          sub.plan?.interval === 'MONTHLY'
            ? planAmount
            : sub.plan?.interval === 'YEARLY'
              ? planAmount / 12
              : sub.plan?.interval === 'QUARTERLY'
                ? planAmount / 3
                : sub.plan?.interval === 'WEEKLY'
                  ? (planAmount * 52) / 12
                  : planAmount * 30;

        return sum + monthlyAmount;
      }, 0);

    return {
      total: subscriptions.length,
      active,
      trialing,
      cancelled,
      pastDue,
      monthlyRecurringRevenue,
      churnRate: subscriptions.length > 0 ? (cancelled / subscriptions.length) * 100 : 0,
    };
  }

  // ============ Invoice PDF Generation ============

  /**
   * Generate PDF for an invoice
   */
  async generateInvoicePDF(invoiceId: string): Promise<void> {
    try {
      const invoice = await this.databaseService.findInvoiceByIdSafe(invoiceId);

      if (!invoice) {
        throw new NotFoundException(`Invoice ${invoiceId} not found`);
      }

      // Get user details
      const subscriptionUser = invoice.subscription as {
        user?: { name: string | null; email: string; phone: string | null };
      } | null;
      const subscriptionUserData = subscriptionUser?.user;
      const fetchedUser = await this.databaseService.findUserByIdSafe(invoice.userId);

      // Use type-safe user data - prefer fetched user as it has all properties
      const user = fetchedUser || subscriptionUserData;

      if (!user) {
        throw new NotFoundException(`User ${invoice.userId} not found`);
      }

      // Get clinic details
      const clinic = await this.databaseService.findClinicByIdSafe(invoice.clinicId);

      if (!clinic) {
        throw new NotFoundException(`Clinic ${invoice.clinicId} not found`);
      }

      // Extract user name safely - handle both UserWithRelations and simplified user types
      const getUserName = (u: typeof user): string => {
        if ('name' in u && u.name) return u.name;
        if ('firstName' in u || 'lastName' in u) {
          const firstName = 'firstName' in u ? u.firstName || '' : '';
          const lastName = 'lastName' in u ? u.lastName || '' : '';
          const fullName = `${firstName} ${lastName}`.trim();
          if (fullName) return fullName;
        }
        if ('email' in u && u.email) return u.email;
        return 'Unknown User';
      };

      // Prepare PDF data with proper type safety
      const pdfData = {
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.createdAt,
        dueDate: invoice.dueDate,
        status: invoice.status,

        // Clinic details - using type-safe access
        clinicName: clinic.name,
        clinicAddress: clinic.address || undefined,
        clinicPhone: clinic.phone || undefined,
        clinicEmail: clinic.email || undefined,

        // User details - using type-safe access
        userName: getUserName(user),
        userEmail: 'email' in user ? user.email || undefined : undefined,
        userPhone: 'phone' in user ? user.phone || undefined : undefined,

        // Subscription details - type-safe access
        subscriptionPlan:
          invoice.subscription &&
          typeof invoice.subscription === 'object' &&
          'plan' in invoice.subscription &&
          invoice.subscription.plan &&
          typeof invoice.subscription.plan === 'object' &&
          'name' in invoice.subscription.plan &&
          typeof invoice.subscription.plan.name === 'string'
            ? invoice.subscription.plan.name
            : undefined,
        subscriptionPeriod:
          'subscription' in invoice &&
          invoice.subscription &&
          'currentPeriodStart' in invoice.subscription &&
          'currentPeriodEnd' in invoice.subscription
            ? `${new Date(invoice.subscription.currentPeriodStart).toLocaleDateString()} - ${new Date(invoice.subscription.currentPeriodEnd).toLocaleDateString()}`
            : undefined,

        // Line items
        lineItems: Array.isArray(invoice.lineItems)
          ? (invoice.lineItems as Array<{
              description: string;
              amount: number;
            }>)
          : [
              {
                description: invoice.description || 'Subscription Payment',
                amount: invoice.amount,
              },
            ],

        // Totals
        subtotal: invoice.amount,
        tax: invoice.tax || 0,
        discount: invoice.discount || 0,
        total: invoice.totalAmount,

        // Payment details
        paidAt: invoice.paidAt || undefined,
        paymentMethod: undefined as string | undefined,
        transactionId: undefined as string | undefined,

        // Notes - type-safe access
        notes: `Thank you for your payment. This invoice is for ${
          (invoice.subscription &&
          typeof invoice.subscription === 'object' &&
          'plan' in invoice.subscription &&
          invoice.subscription.plan &&
          typeof invoice.subscription.plan === 'object' &&
          'name' in invoice.subscription.plan &&
          typeof invoice.subscription.plan.name === 'string'
            ? invoice.subscription.plan.name
            : null) || 'services'
        }.`,
        termsAndConditions:
          'Payment is due within 30 days. Please include the invoice number with your payment.',
      };

      // Get payment details if invoice is paid
      if (invoice.paidAt) {
        const payments = await this.databaseService.findPaymentsSafe({
          invoiceId: invoice.id,
        });

        const payment = payments.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

        if (payment) {
          pdfData.paymentMethod = payment.method || undefined;
          pdfData.transactionId = payment.transactionId || undefined;
        }
      }

      // Generate PDF
      const { filePath, fileName } = await this.invoicePDFService.generateInvoicePDF(
        pdfData as InvoicePDFData
      );

      // Get public URL
      const pdfUrl = this.invoicePDFService.getPublicInvoiceUrl(fileName);

      // Update invoice with PDF info
      await this.databaseService.updateInvoiceSafe(invoiceId, {
        pdfFilePath: filePath,
        pdfUrl,
      });

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Invoice PDF generated',
        'BillingService',
        { invoiceId, fileName }
      );

      await this.eventService.emit('billing.invoice.pdf_generated', {
        invoiceId,
        pdfUrl,
      });
      await this.cacheService.invalidateCacheByTag(`user_invoices:${invoice.userId}`);
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to generate invoice PDF',
        'BillingService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          invoiceId,
        }
      );
      throw error;
    }
  }

  /**
   * Send invoice via WhatsApp
   */
  async sendInvoiceViaWhatsApp(invoiceId: string): Promise<boolean> {
    try {
      const invoice = await this.databaseService.findInvoiceByIdSafe(invoiceId);

      if (!invoice) {
        throw new NotFoundException(`Invoice ${invoiceId} not found`);
      }

      // Get user details
      const subscriptionUser = invoice.subscription as {
        user?: { phone?: string | null; id: string };
      } | null;
      const subscriptionUserData = subscriptionUser?.user;
      const fetchedUser = await this.databaseService.findUserByIdSafe(invoice.userId);

      // Use type-safe user data - prefer fetched user as it has all properties
      const user = fetchedUser || subscriptionUserData;

      if (!user) {
        throw new NotFoundException(`User ${invoice.userId} not found`);
      }

      const userPhone = 'phone' in user ? user.phone : null;
      if (!userPhone) {
        const userId = 'id' in user ? user.id : invoice.userId;
        throw new BadRequestException(`User ${userId} has no phone number`);
      }

      // Generate PDF if not already generated
      if (!invoice.pdfUrl || !invoice.pdfFilePath) {
        await this.generateInvoicePDF(invoiceId);

        // Fetch updated invoice
        const updatedInvoice = await this.databaseService.findInvoiceByIdSafe(invoiceId);

        if (!updatedInvoice?.pdfUrl) {
          throw new Error('Failed to generate invoice PDF');
        }

        invoice.pdfUrl = updatedInvoice.pdfUrl;
      }

      // Send via WhatsApp - using type-safe access
      const getUserNameForWhatsApp = (u: typeof user): string => {
        if (typeof u === 'object' && u !== null) {
          if ('name' in u && typeof u.name === 'string' && u.name) return u.name;
          if (('firstName' in u || 'lastName' in u) && typeof u === 'object') {
            const firstName =
              'firstName' in u && typeof u.firstName === 'string' ? u.firstName : '';
            const lastName = 'lastName' in u && typeof u.lastName === 'string' ? u.lastName : '';
            const fullName = `${firstName} ${lastName}`.trim();
            if (fullName) return fullName;
          }
          if ('email' in u && typeof u.email === 'string' && u.email) return u.email;
        }
        return 'User';
      };

      const userName = getUserNameForWhatsApp(user);
      const success = await this.whatsAppService.sendInvoice(
        userPhone,
        userName,
        invoice.invoiceNumber,
        invoice.totalAmount,
        invoice.dueDate.toLocaleDateString(),
        invoice.pdfUrl || ''
      );

      if (success) {
        // Update invoice
        await this.databaseService.updateInvoiceSafe(invoiceId, {
          sentViaWhatsApp: true,
          whatsappSentAt: new Date(),
        } as InvoiceUpdateInput);

        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Invoice sent via WhatsApp',
          'BillingService',
          { invoiceId, userId: user.id }
        );

        await this.eventService.emit('billing.invoice.sent_whatsapp', {
          invoiceId,
          userId: user.id,
        });
        await this.cacheService.invalidateCacheByTag(`user_invoices:${invoice.userId}`);
      }

      return success;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to send invoice via WhatsApp',
        'BillingService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          invoiceId,
        }
      );
      return false;
    }
  }

  /**
   * Send subscription confirmation via WhatsApp and generate invoice
   */
  async sendSubscriptionConfirmation(subscriptionId: string): Promise<void> {
    try {
      const subscription = await this.databaseService.findSubscriptionByIdSafe(subscriptionId);

      if (!subscription) {
        throw new NotFoundException(`Subscription ${subscriptionId} not found`);
      }

      // Get user with proper type checking
      const subscriptionWithUser = subscription as {
        user?: {
          phone?: string | null;
          id: string;
          name?: string | null;
          firstName?: string | null;
          lastName?: string | null;
          email?: string;
        };
      };
      const user = subscriptionWithUser.user;
      const subscriptionPlan = subscription.plan;

      if (!user || !user.phone) {
        const userId = user?.id || subscription.userId;
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `User ${userId} has no phone number, skipping WhatsApp confirmation`,
          'BillingService',
          { userId, subscriptionId }
        );
        return;
      }

      // Send subscription confirmation
      const getUserNameForSubscription = (u: typeof user): string => {
        if (u.name) return u.name;
        if (u.firstName || u.lastName) {
          const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim();
          if (fullName) return fullName;
        }
        if (u.email) return u.email;
        return 'User';
      };

      const userName = getUserNameForSubscription(user);
      await this.whatsAppService.sendSubscriptionConfirmation(
        user.phone,
        userName,
        subscriptionPlan?.name || 'Unknown Plan',
        subscriptionPlan?.amount || 0,
        subscription.currentPeriodStart.toLocaleDateString(),
        subscription.currentPeriodEnd.toLocaleDateString()
      );

      // Check if invoice exists for this subscription
      const invoices = await this.databaseService.findInvoicesSafe({
        subscriptionId: subscription.id,
      });

      const invoice = invoices.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

      if (invoice) {
        // Send existing invoice via WhatsApp
        await this.sendInvoiceViaWhatsApp(invoice.id);
      } else {
        // Create and send new invoice
        const newInvoice = await this.createInvoice({
          userId: subscription.userId,
          subscriptionId: subscription.id,
          clinicId: subscription.clinicId,
          amount: subscriptionPlan?.amount || 0,
          tax: (subscriptionPlan?.amount || 0) * 0.18, // 18% GST
          dueDate: subscription.currentPeriodEnd.toISOString(),
          description: `Subscription: ${subscriptionPlan?.name || 'Unknown Plan'}`,
          lineItems: {
            items: [
              {
                description: subscriptionPlan?.name || 'Unknown Plan',
                quantity: 1,
                unitPrice: subscriptionPlan?.amount || 0,
                amount: subscriptionPlan?.amount || 0,
              },
            ],
          } as Record<string, unknown>,
        });

        // Generate PDF and send via WhatsApp
        await this.sendInvoiceViaWhatsApp(newInvoice.id);
      }

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Subscription confirmation sent',
        'BillingService',
        { subscriptionId }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to send subscription confirmation',
        'BillingService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          subscriptionId,
        }
      );
    }
  }
}
