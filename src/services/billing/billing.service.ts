import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Inject,
  forwardRef,
  Optional,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events/event.service';
import { QueueService } from '@queue/src/queue.service';
import {
  LogLevel,
  LogType,
  EventCategory,
  EventPriority,
  EnterpriseEventPayload,
} from '@core/types';
import { JobType } from '@core/types/queue.types';
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
  CreateClinicExpenseDto,
  CreateInsuranceClaimDto,
  UpdateInsuranceClaimDto,
} from '@dtos/billing.dto';
import {
  AppointmentServiceMetadataDto,
  AppointmentType,
  TreatmentType,
} from '@dtos/appointment.dto';
import { InvoicePDFService } from './invoice-pdf.service';
import { WhatsAppService } from '@communication/channels/whatsapp/whatsapp.service';
import { PaymentService } from '@payment/payment.service';
import { ConfigService } from '@config/config.service';
import type {
  PaymentIntentOptions,
  PaymentResult,
  PaymentStatusResult,
} from '@core/types/payment.types';
import { PaymentProvider } from '@core/types/payment.types';

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

type AppointmentsServiceLike = {
  getAppointmentServiceCatalog: () => AppointmentServiceMetadataDto[];
};

@Injectable()
export class BillingService {
  private appointmentsServiceRef: AppointmentsServiceLike | null = null;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService,
    private readonly invoicePDFService: InvoicePDFService,
    private readonly whatsAppService: WhatsAppService,
    private readonly paymentService: PaymentService,
    private readonly configService: ConfigService,
    private readonly moduleRef: ModuleRef,
    @Optional()
    @Inject(forwardRef(() => QueueService))
    private readonly queueService?: QueueService
  ) {}

  private getAppointmentsService(): AppointmentsServiceLike {
    if (!this.appointmentsServiceRef) {
      this.appointmentsServiceRef = this.moduleRef.get<AppointmentsServiceLike>(
        'APPOINTMENTS_SERVICE',
        { strict: false }
      );
    }

    if (!this.appointmentsServiceRef) {
      throw new Error('APPOINTMENTS_SERVICE is not available');
    }

    return this.appointmentsServiceRef;
  }

  private resolveVideoConsultationService(
    treatmentType?: TreatmentType | string | null
  ): AppointmentServiceMetadataDto {
    const serviceCatalog = this.getAppointmentsService().getAppointmentServiceCatalog();
    const matchedService = serviceCatalog.find(service => service.treatmentType === treatmentType);

    if (!matchedService) {
      throw new BadRequestException('Unsupported appointment service for VIDEO_CALL payment');
    }

    if (!matchedService.appointmentModes.includes(AppointmentType.VIDEO_CALL)) {
      throw new BadRequestException(
        `${matchedService.label} is not eligible for VIDEO_CALL payment`
      );
    }

    if (
      typeof matchedService.videoConsultationFee !== 'number' ||
      !Number.isFinite(matchedService.videoConsultationFee) ||
      matchedService.videoConsultationFee <= 0
    ) {
      throw new BadRequestException(
        `No video consultation fee configured for ${matchedService.label}`
      );
    }

    return matchedService;
  }

  private isSoleProprietorModeEnabled(): boolean {
    const raw =
      this.configService.getEnv('SOLE_PROPRIETOR_MODE') ??
      this.configService.getEnv('PAYMENT_SOLE_PROPRIETOR_MODE') ??
      'true';
    return String(raw).toLowerCase() === 'true';
  }

  private async emitPaymentLifecycleEvents(args: {
    clinicId: string;
    paymentId: string;
    userId?: string;
    appointmentId?: string;
    subscriptionId?: string;
    status: string;
    amount: number;
  }): Promise<void> {
    const normalizedStatus = String(args.status).toLowerCase();
    const eventType =
      normalizedStatus === 'completed'
        ? 'payment.completed'
        : normalizedStatus === 'failed'
          ? 'payment.failed'
          : normalizedStatus === 'cancelled'
            ? 'payment.cancelled'
            : 'payment.pending';

    const paymentLifecycleEvent: EnterpriseEventPayload = {
      eventId: `${eventType.replace('.', '-')}-${args.paymentId}`,
      eventType,
      category: EventCategory.BILLING,
      priority: EventPriority.HIGH,
      timestamp: new Date().toISOString(),
      source: 'BillingService',
      version: '1.0.0',
      clinicId: args.clinicId,
      ...(args.userId && { userId: args.userId }),
      metadata: {
        paymentId: args.paymentId,
        amount: args.amount,
        status: normalizedStatus,
        ...(args.appointmentId && { appointmentId: args.appointmentId }),
        ...(args.subscriptionId && { subscriptionId: args.subscriptionId }),
      },
    };

    await this.eventService.emitEnterprise(eventType, paymentLifecycleEvent);

    if (args.appointmentId) {
      await this.eventService.emit(eventType, {
        appointmentId: args.appointmentId,
        paymentId: args.paymentId,
        status: normalizedStatus,
        clinicId: args.clinicId,
      });

      if (this.isSoleProprietorModeEnabled() && normalizedStatus === 'completed') {
        await this.eventService.emit('billing.payout.pending', {
          appointmentId: args.appointmentId,
          paymentId: args.paymentId,
          clinicId: args.clinicId,
          reason: 'Sole proprietor mode: payout deferred until consultation completion',
        });
      }
    }
  }

  private buildPaymentCallbackUrl(
    clinicId: string,
    orderId: string,
    provider?: PaymentProvider
  ): string {
    // Priority 1: Provider-specific environment override (e.g., for local development)
    if (provider === PaymentProvider.CASHFREE) {
      const cashfreeReturnUrl = this.configService.getEnv('CASHFREE_RETURN_URL');
      if (cashfreeReturnUrl) {
        try {
          const url = new URL(cashfreeReturnUrl);
          url.searchParams.set('clinicId', clinicId);
          url.searchParams.set('orderId', orderId);
          url.searchParams.set('provider', 'cashfree');
          return url.toString();
        } catch {
          // Fall through if URL is invalid
        }
      }
    }

    // Priority 2: Standard application URLs
    const frontendBaseUrl =
      this.configService.getEnv('FRONTEND_URL') ||
      this.configService.getEnv('NEXT_PUBLIC_APP_URL') ||
      'http://localhost:3000';

    const normalizedFrontendUrl = frontendBaseUrl.replace(/\/+$/, '');
    const callbackUrl = new URL(`${normalizedFrontendUrl}/payment/callback`);
    callbackUrl.searchParams.set('clinicId', clinicId);
    callbackUrl.searchParams.set('orderId', orderId);
    if (provider) {
      callbackUrl.searchParams.set('provider', String(provider));
    }
    return callbackUrl.toString();
  }

  private roundToTwo(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private asSafeString(value: unknown, fallback: string = ''): string {
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value);
    }
    return fallback;
  }

  private getPlatformFeePercent(): number {
    const raw = this.configService.getEnv('PLATFORM_FEE_PERCENT', '20') || '20';
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : 20;
  }

  private normalizePaymentProvider(value?: unknown): PaymentProvider | undefined {
    if (typeof value !== 'string' || !value.trim()) {
      return undefined;
    }
    const normalized = value.trim().toLowerCase();
    const providers = Object.values(PaymentProvider) as string[];
    return providers.includes(normalized) ? (normalized as PaymentProvider) : undefined;
  }

  private normalizeGatewayPaymentStatus(status: unknown): PaymentStatus {
    const normalized = this.asSafeString(status).trim().toLowerCase();
    if (
      normalized === 'completed' ||
      normalized === 'success' ||
      normalized === 'paid' ||
      normalized === 'captured'
    ) {
      return PaymentStatus.COMPLETED;
    }
    if (normalized === 'pending' || normalized === 'processing') {
      return PaymentStatus.PENDING;
    }
    if (normalized === 'failed' || normalized === 'cancelled' || normalized === 'canceled') {
      return PaymentStatus.FAILED;
    }
    if (normalized === 'refunded') {
      return PaymentStatus.REFUNDED;
    }
    throw new BadRequestException(`Unsupported payment status from gateway: ${String(status)}`);
  }

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
        ...(data.appointmentsIncluded !== undefined && {
          appointmentsIncluded: data.appointmentsIncluded,
        }),
        ...(data.isUnlimitedAppointments !== undefined && {
          isUnlimitedAppointments: data.isUnlimitedAppointments,
        }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
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
    const existingSubscriptions = await this.databaseService.findSubscriptionsSafe({
      userId: data.userId,
      clinicId: data.clinicId,
      planId: data.planId,
    });
    const blockingStatuses = new Set<string>([
      String(SubscriptionStatus.ACTIVE),
      String(SubscriptionStatus.TRIALING),
      String(SubscriptionStatus.INCOMPLETE),
      String(SubscriptionStatus.PAST_DUE),
    ]);

    if (
      existingSubscriptions.some(subscription => blockingStatuses.has(String(subscription.status)))
    ) {
      throw new ConflictException(
        'An active or pending subscription already exists for this user and plan'
      );
    }

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
    let status = SubscriptionStatus.INCOMPLETE;

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

  async getUserSubscriptions(
    userId: string,
    role?: string,
    requestingUserId?: string,
    clinicId?: string
  ) {
    // Apply role-based filtering
    // Patients can only see their own subscriptions
    // Clinic staff can see subscriptions for their clinic
    if (role === 'PATIENT' && requestingUserId && requestingUserId !== userId) {
      throw new BadRequestException('You can only view your own subscriptions');
    }

    const cacheKey = `billing_subscriptions:user:${userId}:${clinicId || 'all'}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const whereClause: Record<string, unknown> = { userId };

        // If clinic staff, also filter by clinic
        if (role && role !== 'PATIENT' && role !== 'SUPER_ADMIN') {
          if (clinicId) {
            whereClause['clinicId'] = clinicId;
          } else {
            // Fallback: Get user's clinic to filter subscriptions (Legacy)
            const user = await this.databaseService.findUserByIdSafe(userId);
            if (user?.primaryClinicId) {
              whereClause['clinicId'] = user.primaryClinicId;
            }
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

  async getClinicSubscriptions(clinicId: string) {
    const cacheKey = `billing_subscriptions:clinic:${clinicId}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        return await this.databaseService.findSubscriptionsSafe({ clinicId });
      },
      {
        ttl: 1800,
        tags: ['billing_subscriptions', `clinic:${clinicId}`],
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
    const totalAmount = data.amount + (data.tax || 0) - (data.discount || 0);
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const invoice = await this.createInvoiceRecordAtomically(data, totalAmount);
        const invoiceNumber = invoice.invoiceNumber;

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
              JobType.INVOICE_PDF,
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
        if (this.isInvoiceNumberUniqueConstraint(error) && attempt < maxAttempts) {
          await this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            'Invoice number collision detected, retrying with a fresh number',
            'BillingService',
            {
              attempt,
              maxAttempts,
              clinicId: data.clinicId,
              userId: data.userId,
            }
          );

          continue;
        }

        await this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          'Failed to create invoice',
          'BillingService',
          {
            error: error instanceof Error ? error.message : 'Unknown error',
            data,
            attempt,
          }
        );
        throw error;
      }
    }

    throw new Error('Failed to create invoice after exhausting invoice number retries');
  }

  private async createInvoiceRecordAtomically(data: CreateInvoiceDto, totalAmount: number) {
    return this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
        };

        // Serialize invoice-number allocation even when cache is unavailable.
        await typedClient.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)', 2026032901);

        const invoiceNumber = await this.allocateInvoiceNumberInTransaction(typedClient);

        return typedClient.invoice.create({
          data: {
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
          } as never,
          include: {
            subscription: true,
            payments: true,
          },
        } as PrismaDelegateArgs);
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: data.clinicId,
        operation: 'CREATE_INVOICE',
        resourceType: 'INVOICE',
        resourceId: 'pending',
        timestamp: new Date(),
      }
    );
  }

  private async allocateInvoiceNumberInTransaction(
    typedClient: PrismaTransactionClientWithDelegates & {
      $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
    }
  ): Promise<string> {
    const rows = await typedClient.$queryRawUnsafe<Array<{ maxSequence: number | string | null }>>(
      `
        SELECT COALESCE(
          MAX(CAST(SUBSTRING("invoiceNumber" FROM '([0-9]+)$') AS INTEGER)),
          0
        ) AS "maxSequence"
        FROM "Invoice"
        WHERE "invoiceNumber" ~ '^INV-[0-9]{4}-[0-9]+$'
      `
    );

    const maxSequenceRaw = rows?.[0]?.maxSequence ?? 0;
    const maxSequence = Number(maxSequenceRaw);
    const nextSequence = Number.isNaN(maxSequence) ? 1 : maxSequence + 1;

    // Keep the shared cache warm for the fast path after the transaction commits.
    await this.cacheService.set('invoice:counter', nextSequence.toString());

    return this.formatInvoiceNumber(nextSequence);
  }

  private async getMaxInvoiceSequence(): Promise<number> {
    const lastInvoice = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return await typedClient.invoice.findFirst({
        orderBy: { invoiceNumber: 'desc' },
        select: { invoiceNumber: true },
      });
    });

    if (!lastInvoice?.invoiceNumber) {
      return 0;
    }

    const match = lastInvoice.invoiceNumber.match(/(\d+)$/);
    if (!match?.[0]) {
      return 0;
    }

    const parsed = parseInt(match[0], 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  private formatInvoiceNumber(sequence: number): string {
    const year = new Date().getFullYear();
    return `INV-${year}-${sequence.toString().padStart(6, '0')}`;
  }

  private isInvoiceNumberUniqueConstraint(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    const message = 'message' in error && typeof error.message === 'string' ? error.message : '';

    return (
      code === 'P2002' && (message.includes('invoiceNumber') || message.includes('"invoiceNumber"'))
    );
  }

  async getUserInvoices(
    userId: string,
    role?: string,
    requestingUserId?: string,
    clinicId?: string
  ) {
    // Apply role-based filtering
    // Patients can only see their own invoices
    // Clinic staff can see invoices for their clinic
    if (role === 'PATIENT' && requestingUserId && requestingUserId !== userId) {
      throw new BadRequestException('You can only view your own invoices');
    }

    const cacheKey = `user_invoices:${userId}:${clinicId || 'all'}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const whereClause: Record<string, unknown> = { userId };

        // If clinic staff, also filter by clinic
        if (role && role !== 'PATIENT' && role !== 'SUPER_ADMIN') {
          if (clinicId) {
            whereClause['clinicId'] = clinicId;
          } else {
            // Fallback: Get user's clinic to filter invoices (Legacy)
            const user = await this.databaseService.findUserByIdSafe(userId);
            if (user?.primaryClinicId) {
              whereClause['clinicId'] = user.primaryClinicId;
            }
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

  async getClinicInvoices(clinicId: string) {
    const cacheKey = `billing_invoices:clinic:${clinicId}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        return await this.databaseService.findInvoicesSafe({ clinicId });
      },
      {
        ttl: 900,
        tags: ['billing_invoices', `clinic:${clinicId}`],
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
      await this.eventService.emit('payment.pending', {
        paymentId: payment.id,
        clinicId: payment.clinicId,
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

    const paymentMetadata =
      payment.metadata && typeof payment.metadata === 'object' && !Array.isArray(payment.metadata)
        ? (payment.metadata as Record<string, unknown>)
        : {};
    const paymentFor =
      typeof paymentMetadata['paymentFor'] === 'string' ? paymentMetadata['paymentFor'] : '';
    if (
      ((data.status || payment.status) as PaymentStatus) === PaymentStatus.COMPLETED &&
      paymentFor.toUpperCase() === 'PRESCRIPTION_DISPENSE'
    ) {
      await this.eventService.emit('pharmacy.medicine_desk.updated', {
        clinicId: payment.clinicId,
        paymentId: id,
        prescriptionId:
          typeof paymentMetadata['prescriptionId'] === 'string'
            ? paymentMetadata['prescriptionId']
            : null,
        action: 'PAYMENT_UPDATED',
        queueCategory:
          typeof paymentMetadata['queueCategory'] === 'string'
            ? paymentMetadata['queueCategory']
            : 'MEDICINE_DESK',
        paymentStatus: 'PAID',
        pendingAmount: 0,
        queueStatus: 'PENDING',
      });
    }

    // Invalidate cache if payment has userId
    if ('userId' in payment && payment.userId) {
      await this.cacheService.invalidateCacheByTag(`user_payments:${payment.userId}`);
    }

    // Auto-update invoice if payment is linked to one
    if ('invoiceId' in payment && payment.invoiceId && data.status === PaymentStatus.COMPLETED) {
      await this.markInvoiceAsPaid(payment.invoiceId);
    }

    return payment;
  }

  async getUserPayments(
    userId: string,
    role?: string,
    requestingUserId?: string,
    clinicId?: string
  ) {
    // Apply role-based filtering
    // Patients can only see their own payments
    // Clinic staff can see payments for their clinic
    if (role === 'PATIENT' && requestingUserId && requestingUserId !== userId) {
      throw new BadRequestException('You can only view your own payments');
    }

    const cacheKey = `user_payments:${userId}:${clinicId || 'all'}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const whereClause: Record<string, unknown> = { userId };

        // If clinic staff, also filter by clinic
        if (role && role !== 'PATIENT' && role !== 'SUPER_ADMIN') {
          if (clinicId) {
            whereClause['clinicId'] = clinicId;
          } else {
            // Fallback: Get user's clinic to filter payments (Legacy)
            const user = await this.databaseService.findUserByIdSafe(userId);
            if (user?.primaryClinicId) {
              whereClause['clinicId'] = user.primaryClinicId;
            }
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

  async getClinicPayments(
    clinicId: string,
    filters?: {
      status?: string;
      startDate?: Date;
      endDate?: Date;
      revenueModel?: 'APPOINTMENT' | 'SUBSCRIPTION' | 'OTHER';
      appointmentType?: string;
      provider?: string;
    }
  ) {
    const whereClause: Record<string, unknown> = { clinicId };
    if (filters?.status) {
      whereClause['status'] = filters.status;
    }

    const payments = await this.databaseService.findPaymentsSafe(whereClause);

    return payments.filter(payment => {
      if (!filters?.startDate && !filters?.endDate) {
        // continue and evaluate metadata filters
      } else {
        const createdAt = new Date(payment.createdAt);
        if (filters?.startDate && createdAt < filters.startDate) {
          return false;
        }
        if (filters?.endDate && createdAt > filters.endDate) {
          return false;
        }
      }

      const metadata = this.asRecord(payment.metadata) || {};
      const payout = this.asRecord(metadata['payout']) || {};
      const model = this.asSafeString(
        metadata['revenueModel'] ||
          payout['revenueModel'] ||
          (payment.subscriptionId
            ? 'SUBSCRIPTION'
            : payment.appointmentId
              ? 'APPOINTMENT'
              : 'OTHER')
      ).toUpperCase();
      const appointmentType = this.asSafeString(
        metadata['appointmentType'] || payout['appointmentType'] || ''
      ).toUpperCase();
      const provider = this.asSafeString(metadata['provider']).toUpperCase();

      if (filters?.revenueModel && model !== filters.revenueModel.toUpperCase()) {
        return false;
      }
      if (filters?.appointmentType && appointmentType !== filters.appointmentType.toUpperCase()) {
        return false;
      }
      if (filters?.provider && provider !== filters.provider.toUpperCase()) {
        return false;
      }

      return true;
    });
  }

  async getLedgerEntriesForClinic(
    clinicId: string,
    filters?: {
      status?: string;
      startDate?: Date;
      endDate?: Date;
      revenueModel?: 'APPOINTMENT' | 'SUBSCRIPTION' | 'OTHER';
      appointmentType?: string;
      provider?: string;
    }
  ): Promise<{
    payments: Array<Record<string, unknown>>;
    summary: {
      totalCollections: number;
      totalDoctorPayable: number;
      totalPlatformRevenue: number;
      totalRefunded: number;
      totalPayoutReleased: number;
      pendingPayouts: number;
      byRevenueModel: {
        APPOINTMENT: number;
        SUBSCRIPTION: number;
        OTHER: number;
      };
      byAppointmentType: {
        VIDEO_CALL: number;
        IN_PERSON: number;
        HOME_VISIT: number;
        OTHER: number;
      };
    };
  }> {
    const payments = await this.getClinicPayments(clinicId, filters);

    const paymentRows = payments.map(payment => {
      const metadata = this.asRecord(payment.metadata) || {};
      const payout = this.asRecord(metadata['payout']) || {};
      const ledger = Array.isArray(payout['ledger']) ? (payout['ledger'] as unknown[]) : [];
      const revenueModel = this.asSafeString(
        metadata['revenueModel'] ||
          payout['revenueModel'] ||
          (payment.subscriptionId
            ? 'SUBSCRIPTION'
            : payment.appointmentId
              ? 'APPOINTMENT'
              : 'OTHER')
      ).toUpperCase();
      const appointmentType = this.asSafeString(
        metadata['appointmentType'] || payout['appointmentType'] || ''
      ).toUpperCase();
      const provider = this.asSafeString(metadata['provider']).toUpperCase();

      return {
        paymentId: payment.id,
        appointmentId: payment.appointmentId || null,
        userId: payment.userId || null,
        amount: payment.amount,
        status: payment.status,
        refundAmount: payment.refundAmount || 0,
        createdAt: payment.createdAt,
        updatedAt: payment.updatedAt,
        payoutState: payout['state'] || 'N/A',
        payoutDoctorId: payout['doctorId'] || null,
        payoutDoctorShareAmount: payout['doctorShareAmount'] || 0,
        payoutPlatformFeeAmount: payout['platformFeeAmount'] || 0,
        payoutReference: payout['payoutReference'] || null,
        revenueModel,
        appointmentType: appointmentType || null,
        provider: provider || null,
        ledgerEntries: ledger,
      };
    });

    const summary = paymentRows.reduce(
      (acc, row) => {
        const amount = Number(row['amount'] || 0);
        const refunded = Number(row['refundAmount'] || 0);
        const doctorPayable = Number(row['payoutDoctorShareAmount'] || 0);
        const platformFee = Number(row['payoutPlatformFeeAmount'] || 0);
        const payoutState = this.asSafeString(row['payoutState']);
        const payoutRef = row['payoutReference'];

        acc.totalCollections += amount;
        acc.totalRefunded += refunded;
        acc.totalDoctorPayable += doctorPayable;
        acc.totalPlatformRevenue += platformFee;
        const revenueModel = String(row['revenueModel'] || 'OTHER').toUpperCase();
        if (revenueModel === 'APPOINTMENT') {
          acc.byRevenueModel.APPOINTMENT += amount;
        } else if (revenueModel === 'SUBSCRIPTION') {
          acc.byRevenueModel.SUBSCRIPTION += amount;
        } else {
          acc.byRevenueModel.OTHER += amount;
        }
        const apptType = String(row['appointmentType'] || 'OTHER').toUpperCase();
        if (apptType === 'VIDEO_CALL') {
          acc.byAppointmentType.VIDEO_CALL += amount;
        } else if (apptType === 'IN_PERSON') {
          acc.byAppointmentType.IN_PERSON += amount;
        } else if (apptType === 'HOME_VISIT') {
          acc.byAppointmentType.HOME_VISIT += amount;
        } else {
          acc.byAppointmentType.OTHER += amount;
        }
        if (payoutState === 'PAYOUT_PENDING' || payoutState === 'PAYOUT_READY') {
          acc.pendingPayouts += doctorPayable;
        }
        if (payoutState === 'PAYOUT_SUCCESS' || payoutRef) {
          acc.totalPayoutReleased += doctorPayable;
        }
        return acc;
      },
      {
        totalCollections: 0,
        totalDoctorPayable: 0,
        totalPlatformRevenue: 0,
        totalRefunded: 0,
        totalPayoutReleased: 0,
        pendingPayouts: 0,
        byRevenueModel: {
          APPOINTMENT: 0,
          SUBSCRIPTION: 0,
          OTHER: 0,
        },
        byAppointmentType: {
          VIDEO_CALL: 0,
          IN_PERSON: 0,
          HOME_VISIT: 0,
          OTHER: 0,
        },
      }
    );

    return {
      payments: paymentRows,
      summary: {
        totalCollections: this.roundToTwo(summary.totalCollections),
        totalDoctorPayable: this.roundToTwo(summary.totalDoctorPayable),
        totalPlatformRevenue: this.roundToTwo(summary.totalPlatformRevenue),
        totalRefunded: this.roundToTwo(summary.totalRefunded),
        totalPayoutReleased: this.roundToTwo(summary.totalPayoutReleased),
        pendingPayouts: this.roundToTwo(summary.pendingPayouts),
        byRevenueModel: {
          APPOINTMENT: this.roundToTwo(summary.byRevenueModel.APPOINTMENT),
          SUBSCRIPTION: this.roundToTwo(summary.byRevenueModel.SUBSCRIPTION),
          OTHER: this.roundToTwo(summary.byRevenueModel.OTHER),
        },
        byAppointmentType: {
          VIDEO_CALL: this.roundToTwo(summary.byAppointmentType.VIDEO_CALL),
          IN_PERSON: this.roundToTwo(summary.byAppointmentType.IN_PERSON),
          HOME_VISIT: this.roundToTwo(summary.byAppointmentType.HOME_VISIT),
          OTHER: this.roundToTwo(summary.byAppointmentType.OTHER),
        },
      },
    };
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
    const nextId = await this.cacheService.incr(COUNTER_KEY);

    // Cache providers can degrade to no-op / disconnected mode and return 0.
    // In that case, derive a best-effort next number from the database and let
    // createInvoice() retry on any residual uniqueness race.
    if (nextId <= 0) {
      const maxSequence = await this.getMaxInvoiceSequence();
      return this.formatInvoiceNumber(maxSequence + 1);
    }

    // If the counter restarted at 1, re-seed from the database before using it.
    if (nextId === 1) {
      const maxSequence = await this.getMaxInvoiceSequence();
      if (maxSequence > 0) {
        await this.cacheService.set(COUNTER_KEY, maxSequence.toString());
        const reseededNextId = await this.cacheService.incr(COUNTER_KEY);
        if (reseededNextId > maxSequence) {
          return this.formatInvoiceNumber(reseededNextId);
        }

        return this.formatInvoiceNumber(maxSequence + 1);
      }
    }

    return this.formatInvoiceNumber(nextId);
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

    if (
      (subscription.status as SubscriptionStatus) !== SubscriptionStatus.ACTIVE &&
      (subscription.status as SubscriptionStatus) !== SubscriptionStatus.TRIALING
    ) {
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
      VIDEO_CALL: 500,
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

  async bookAppointmentWithSubscription(
    subscriptionId: string,
    appointmentId: string,
    requester?: { userId?: string; role?: string; clinicId?: string }
  ) {
    const canBook = await this.canBookAppointment(subscriptionId, 'IN_PERSON');

    if (!canBook.allowed) {
      throw new BadRequestException(canBook.reason);
    }

    const subscription = await this.databaseService.findSubscriptionByIdSafe(subscriptionId);

    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }

    if (requester?.clinicId && subscription.clinicId !== requester.clinicId) {
      throw new BadRequestException('Subscription does not belong to current clinic');
    }

    if (
      requester?.role === 'PATIENT' &&
      requester.userId &&
      subscription.userId !== requester.userId
    ) {
      throw new BadRequestException('Patients can only use their own subscription');
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
        redirectUrl: this.buildPaymentCallbackUrl(
          subscription.clinicId,
          invoice.invoiceNumber,
          provider
        ),
      },
    };

    const paymentIntentResult: PaymentResult = await this.paymentService.createPaymentIntent(
      subscription.clinicId,
      paymentIntentOptions,
      provider
    );
    paymentIntentResult.metadata = {
      ...(this.asRecord(paymentIntentResult.metadata) || {}),
      clinicId: subscription.clinicId,
      invoiceId: invoice.id,
      subscriptionId: subscription.id,
    };

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
        revenueModel: 'SUBSCRIPTION',
        serviceType: 'SUBSCRIPTION_PLAN',
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
    appointmentType: 'VIDEO_CALL' | 'IN_PERSON' | 'HOME_VISIT',
    provider?: PaymentProvider
  ): Promise<{ invoice: unknown; paymentIntent: PaymentResult }> {
    if (appointmentType !== 'VIDEO_CALL') {
      throw new BadRequestException('Only VIDEO_CALL appointments require per-appointment payment');
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

    const serviceMetadata = this.resolveVideoConsultationService(
      appointment.treatmentType as TreatmentType | string | null
    );
    const amount = serviceMetadata.videoConsultationFee as number;

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
            description: `${serviceMetadata.label} Appointment`,
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
      description: `Payment for ${serviceMetadata.label} appointment`,
      appointmentId: appointment.id,
      appointmentType,
      clinicId: appointment.clinicId,
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        appointmentId: appointment.id,
        appointmentType,
        baseUrl,
        redirectUrl: this.buildPaymentCallbackUrl(
          appointment.clinicId,
          invoice.invoiceNumber,
          provider
        ),
      },
    };

    const paymentIntentResult: PaymentResult = await this.paymentService.createPaymentIntent(
      appointment.clinicId,
      paymentIntentOptions,
      provider
    );
    paymentIntentResult.metadata = {
      ...(this.asRecord(paymentIntentResult.metadata) || {}),
      clinicId: appointment.clinicId,
      invoiceId: invoice.id,
      appointmentId: appointment.id,
      appointmentType,
    };

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
      description: `Payment for ${serviceMetadata.label} appointment`,
      metadata: {
        paymentIntentId: paymentId,
        orderId,
        provider: providerName,
        appointmentType,
        revenueModel: 'APPOINTMENT',
        serviceType: appointmentType,
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
        treatmentType: appointment.treatmentType,
        serviceLabel: serviceMetadata.label,
      }
    );

    return {
      invoice,
      paymentIntent: paymentIntentResult,
    };
  }

  async processInvoicePayment(
    invoiceId: string,
    provider?: PaymentProvider
  ): Promise<{ invoice: unknown; paymentIntent: PaymentResult }> {
    const invoice = await this.databaseService.findInvoiceByIdSafe(invoiceId);

    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }

    const invoiceStatus = String(invoice.status);

    if (invoiceStatus === 'PAID') {
      throw new BadRequestException('Invoice is already paid');
    }

    if (invoiceStatus === 'VOID') {
      throw new BadRequestException('Void invoices cannot be paid');
    }

    const user = await this.databaseService.findUserByIdSafe(invoice.userId);
    const invoiceAmount =
      typeof invoice.totalAmount === 'number' ? invoice.totalAmount : Number(invoice.totalAmount);
    const invoiceRecord = invoice as unknown as Record<string, unknown>;
    const currency =
      typeof invoiceRecord['currency'] === 'string' ? String(invoiceRecord['currency']) : 'INR';
    const baseUrl =
      this.configService.getEnv('BASE_URL') ||
      this.configService.getEnv('API_URL') ||
      (() => {
        throw new Error(
          'Missing required environment variable: BASE_URL or API_URL. Please set BASE_URL or API_URL in environment configuration.'
        );
      })();

    const paymentIntentOptions: PaymentIntentOptions = {
      amount: invoiceAmount * 100,
      currency,
      orderId: invoice.invoiceNumber,
      customerId: invoice.userId,
      ...(user?.email && { customerEmail: user.email }),
      ...(user?.phone && { customerPhone: user.phone }),
      ...(user?.name && { customerName: user.name }),
      description: `Payment for invoice ${invoice.invoiceNumber}`,
      clinicId: invoice.clinicId,
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        baseUrl,
        redirectUrl: this.buildPaymentCallbackUrl(
          invoice.clinicId,
          invoice.invoiceNumber,
          provider
        ),
      },
    };

    const paymentIntentResult: PaymentResult = await this.paymentService.createPaymentIntent(
      invoice.clinicId,
      paymentIntentOptions,
      provider
    );
    paymentIntentResult.metadata = {
      ...(this.asRecord(paymentIntentResult.metadata) || {}),
      clinicId: invoice.clinicId,
      invoiceId: invoice.id,
    };

    const paymentId = paymentIntentResult.paymentId || '';
    const orderId = paymentIntentResult.orderId || '';
    const providerName = paymentIntentResult.provider || '';
    const redirectUrl =
      paymentIntentResult.metadata &&
      typeof paymentIntentResult.metadata === 'object' &&
      !Array.isArray(paymentIntentResult.metadata)
        ? paymentIntentResult.metadata['redirectUrl']
        : undefined;

    await this.createPayment({
      amount: invoiceAmount,
      clinicId: invoice.clinicId,
      userId: invoice.userId,
      invoiceId: invoice.id,
      ...(paymentId && { transactionId: paymentId }),
      description: `Payment for invoice ${invoice.invoiceNumber}`,
      metadata: {
        paymentIntentId: paymentId,
        orderId,
        provider: providerName,
        revenueModel: 'OTHER',
        serviceType: 'INVOICE',
        ...(typeof redirectUrl === 'string' ? { redirectUrl } : {}),
      },
    });

    await this.loggingService.log(
      LogType.PAYMENT,
      LogLevel.INFO,
      'Invoice payment intent created',
      'BillingService',
      {
        invoiceId,
        amount: invoiceAmount,
        provider: providerName || provider || 'default',
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
      const normalizedProvider = this.normalizePaymentProvider(provider);

      // Verify payment status with provider
      const paymentStatus: PaymentStatusResult = await this.paymentService.verifyPayment(
        clinicId,
        { paymentId, orderId },
        normalizedProvider
      );
      const normalizedIncomingStatus = this.normalizeGatewayPaymentStatus(paymentStatus.status);

      // Find payment record: by ID, gateway transaction ID, then order ID fallback
      let payment = await this.databaseService.findPaymentByIdSafe(paymentId);
      if (!payment) {
        const byPaymentIdTx = await this.databaseService.findPaymentsSafe({
          transactionId: paymentId,
        });
        payment = byPaymentIdTx[0] || null;
      }
      if (!payment) {
        const byOrderIdTx = await this.databaseService.findPaymentsSafe({ transactionId: orderId });
        payment = byOrderIdTx[0] || null;
      }
      if (!payment) {
        throw new NotFoundException('Payment record not found');
      }

      const currentStatusLower = String(payment.status || '').toLowerCase();
      const incomingStatusLower = String(normalizedIncomingStatus).toLowerCase();
      const isSameStatus = currentStatusLower === incomingStatusLower;
      const isCurrentFinal =
        currentStatusLower === 'completed' ||
        currentStatusLower === 'refunded' ||
        currentStatusLower === 'cancelled';

      // Idempotency + anti-regression for repeated gateway callbacks.
      if (
        isSameStatus ||
        (isCurrentFinal && incomingStatusLower !== currentStatusLower) ||
        (currentStatusLower === 'failed' && incomingStatusLower === 'pending')
      ) {
        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.INFO,
          'Ignoring duplicate or regressive payment callback',
          'BillingService',
          {
            clinicId,
            paymentId: payment.id,
            currentStatus: currentStatusLower,
            incomingStatus: incomingStatusLower,
            orderId,
            provider: normalizedProvider || 'unknown',
          }
        );
        return { payment };
      }

      const callbackMetadata = this.asRecord(payment.metadata)
        ? { ...(payment.metadata as Record<string, unknown>) }
        : {};
      callbackMetadata['callbackAudit'] = {
        provider: normalizedProvider || 'unknown',
        orderId,
        requestedPaymentId: paymentId,
        verifiedTransactionId: paymentStatus.transactionId || paymentId,
        receivedAt: new Date().toISOString(),
        incomingStatus: incomingStatusLower,
      };

      const updatedPayment = await this.updatePayment(payment.id, {
        status: normalizedIncomingStatus,
        transactionId: paymentStatus.transactionId || paymentId,
        metadata: callbackMetadata,
      });

      let invoice: unknown;
      if (incomingStatusLower === 'completed' && payment.invoiceId) {
        invoice = await this.markInvoiceAsPaid(payment.invoiceId);
      }

      if (incomingStatusLower === 'completed' && payment.subscriptionId) {
        await this.renewSubscriptionAfterPayment(payment.subscriptionId);
        await this.prepareLedgerForSubscriptionPayment(payment.id, clinicId);
      }

      await this.emitPaymentLifecycleEvents({
        clinicId,
        paymentId: payment.id,
        status: paymentStatus.status,
        amount: paymentStatus.amount,
        ...(payment.userId ? { userId: payment.userId } : {}),
        ...(payment.appointmentId ? { appointmentId: payment.appointmentId } : {}),
        ...(payment.subscriptionId ? { subscriptionId: payment.subscriptionId } : {}),
      });

      return { payment: updatedPayment, ...(invoice ? { invoice } : {}) };
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

  async preparePayoutForAppointmentPayment(paymentId: string, clinicId: string): Promise<void> {
    const payment = await this.databaseService.findPaymentByIdSafe(paymentId);
    if (!payment || payment.clinicId !== clinicId || !payment.appointmentId) {
      return;
    }
    if (String(payment.status) !== String(PaymentStatus.COMPLETED)) {
      return;
    }

    const appointment = await this.databaseService.findAppointmentByIdSafe(payment.appointmentId);
    if (!appointment || appointment.clinicId !== clinicId) {
      return;
    }

    const metadata =
      payment.metadata && typeof payment.metadata === 'object' && !Array.isArray(payment.metadata)
        ? { ...(payment.metadata as Record<string, unknown>) }
        : {};

    const existingPayout =
      metadata['payout'] &&
      typeof metadata['payout'] === 'object' &&
      !Array.isArray(metadata['payout'])
        ? (metadata['payout'] as Record<string, unknown>)
        : null;
    if (existingPayout && existingPayout['state']) {
      return; // idempotent
    }

    const gross = this.roundToTwo(payment.amount);
    const feePercent = this.getPlatformFeePercent();
    const platformFee = this.roundToTwo((gross * feePercent) / 100);
    const doctorShare = this.roundToTwo(gross - platformFee);

    const payout = {
      mode: 'SOLE_PROPRIETOR',
      state: 'PAYOUT_PENDING',
      grossAmount: gross,
      platformFeePercent: feePercent,
      platformFeeAmount: platformFee,
      doctorShareAmount: doctorShare,
      doctorId: appointment.doctorId,
      preparedAt: new Date().toISOString(),
      ledger: [
        {
          type: 'PLATFORM_CREDIT',
          amount: gross,
          reference: payment.id,
          createdAt: new Date().toISOString(),
        },
        {
          type: 'DOCTOR_PAYABLE_CREDIT',
          amount: doctorShare,
          reference: payment.id,
          createdAt: new Date().toISOString(),
        },
      ],
    };

    await this.updatePayment(payment.id, {
      metadata: {
        ...metadata,
        payout,
      },
    });
  }

  async prepareLedgerForSubscriptionPayment(paymentId: string, clinicId: string): Promise<void> {
    const payment = await this.databaseService.findPaymentByIdSafe(paymentId);
    if (!payment || payment.clinicId !== clinicId || !payment.subscriptionId) {
      return;
    }
    if (String(payment.status) !== String(PaymentStatus.COMPLETED)) {
      return;
    }

    const metadata = this.asRecord(payment.metadata)
      ? { ...(payment.metadata as Record<string, unknown>) }
      : {};
    const existingPayout = this.asRecord(metadata['payout']);
    if (existingPayout && existingPayout['state']) {
      return;
    }

    const gross = this.roundToTwo(payment.amount);
    const payout = {
      state: 'REVENUE_RECORDED',
      revenueModel: 'SUBSCRIPTION',
      doctorId: null,
      doctorShareAmount: 0,
      platformFeePercent: 100,
      platformFeeAmount: gross,
      ledger: [
        {
          type: 'PLATFORM_CREDIT',
          amount: gross,
          at: new Date().toISOString(),
          note: 'Subscription payment credited to platform revenue',
        },
      ],
    };

    await this.updatePayment(payment.id, {
      metadata: {
        ...metadata,
        revenueModel: 'SUBSCRIPTION',
        payout,
      },
    });
  }

  async markPayoutReadyForCompletedAppointment(
    appointmentId: string,
    clinicId: string
  ): Promise<void> {
    const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);
    if (!appointment || appointment.clinicId !== clinicId) {
      return;
    }
    if (String(appointment.status) !== String('COMPLETED')) {
      return;
    }

    const payments = await this.databaseService.findPaymentsSafe({
      appointmentId,
      clinicId,
      status: PaymentStatus.COMPLETED,
    });
    const payment = payments.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (!payment) {
      return;
    }

    const metadata =
      payment.metadata && typeof payment.metadata === 'object' && !Array.isArray(payment.metadata)
        ? { ...(payment.metadata as Record<string, unknown>) }
        : {};
    const payout =
      metadata['payout'] &&
      typeof metadata['payout'] === 'object' &&
      !Array.isArray(metadata['payout'])
        ? { ...(metadata['payout'] as Record<string, unknown>) }
        : null;
    if (!payout) {
      return;
    }
    if (payout['state'] === 'PAYOUT_SUCCESS' || payout['state'] === 'PAYOUT_READY') {
      return;
    }

    payout['state'] = 'PAYOUT_READY';
    payout['readyAt'] = new Date().toISOString();

    await this.updatePayment(payment.id, {
      metadata: {
        ...metadata,
        payout,
      },
    });
  }

  async releasePayoutForAppointment(
    appointmentId: string,
    clinicId: string,
    initiatedBy: string
  ): Promise<{
    success: boolean;
    paymentId?: string;
    doctorId?: string;
    doctorShareAmount?: number;
    message: string;
  }> {
    const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);
    if (!appointment || appointment.clinicId !== clinicId) {
      throw new NotFoundException('Appointment not found');
    }
    if (String(appointment.status) !== String('COMPLETED')) {
      throw new BadRequestException('Payout is allowed only after consultation is completed');
    }

    const payments = await this.databaseService.findPaymentsSafe({
      appointmentId,
      clinicId,
      status: PaymentStatus.COMPLETED,
    });
    const payment = payments.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (!payment) {
      throw new BadRequestException('No completed payment found for this appointment');
    }

    const metadata =
      payment.metadata && typeof payment.metadata === 'object' && !Array.isArray(payment.metadata)
        ? { ...(payment.metadata as Record<string, unknown>) }
        : {};
    const payout =
      metadata['payout'] &&
      typeof metadata['payout'] === 'object' &&
      !Array.isArray(metadata['payout'])
        ? { ...(metadata['payout'] as Record<string, unknown>) }
        : null;
    if (!payout) {
      throw new BadRequestException('Payout details are not prepared for this payment');
    }
    if (payout['state'] === 'PAYOUT_PENDING') {
      payout['state'] = 'PAYOUT_READY';
      payout['readyAt'] = new Date().toISOString();
    }
    if (payout['state'] !== 'PAYOUT_READY' && payout['state'] !== 'PAYOUT_SUCCESS') {
      throw new BadRequestException('Payout is not in a releasable state');
    }
    if (payout['state'] === 'PAYOUT_SUCCESS') {
      const payoutDoctorId =
        this.asSafeString(payout['doctorId']) || this.asSafeString(appointment.doctorId);
      return {
        success: true,
        paymentId: payment.id,
        doctorId: payoutDoctorId,
        doctorShareAmount: Number(payout['doctorShareAmount'] || 0),
        message: 'Payout already completed',
      };
    }

    const ledger = Array.isArray(payout['ledger'])
      ? [...(payout['ledger'] as Array<Record<string, unknown>>)]
      : [];
    ledger.push({
      type: 'PLATFORM_DEBIT',
      amount: Number(payout['doctorShareAmount'] || 0),
      reference: payment.id,
      createdAt: new Date().toISOString(),
    });
    ledger.push({
      type: 'DOCTOR_PAYOUT_CREDIT',
      amount: Number(payout['doctorShareAmount'] || 0),
      reference: payment.id,
      createdAt: new Date().toISOString(),
    });

    payout['state'] = 'PAYOUT_SUCCESS';
    payout['paidAt'] = new Date().toISOString();
    payout['payoutReference'] = `manual-${Date.now()}`;
    payout['initiatedBy'] = initiatedBy;
    payout['ledger'] = ledger;

    await this.updatePayment(payment.id, {
      metadata: {
        ...metadata,
        payout,
      },
    });

    const payoutDoctorId =
      this.asSafeString(payout['doctorId']) || this.asSafeString(appointment.doctorId);
    await this.eventService.emit('billing.payout.success', {
      appointmentId,
      clinicId,
      paymentId: payment.id,
      doctorId: payoutDoctorId,
      amount: Number(payout['doctorShareAmount'] || 0),
      initiatedBy,
    });

    return {
      success: true,
      paymentId: payment.id,
      doctorId: payoutDoctorId,
      doctorShareAmount: Number(payout['doctorShareAmount'] || 0),
      message: 'Payout marked as successful',
    };
  }

  async getAppointmentPayoutStatus(
    appointmentId: string,
    clinicId: string
  ): Promise<{
    paymentId?: string;
    appointmentId: string;
    payoutState: string;
    payoutData?: Record<string, unknown>;
  }> {
    const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);
    if (!appointment || appointment.clinicId !== clinicId) {
      throw new NotFoundException('Appointment not found');
    }

    const payments = await this.databaseService.findPaymentsSafe({
      appointmentId,
      clinicId,
    });
    const payment = payments.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (!payment) {
      return {
        appointmentId,
        payoutState: 'NO_PAYMENT',
      };
    }

    const metadata =
      payment.metadata && typeof payment.metadata === 'object' && !Array.isArray(payment.metadata)
        ? (payment.metadata as Record<string, unknown>)
        : {};
    const payout =
      metadata['payout'] &&
      typeof metadata['payout'] === 'object' &&
      !Array.isArray(metadata['payout'])
        ? (metadata['payout'] as Record<string, unknown>)
        : undefined;

    return {
      paymentId: payment.id,
      appointmentId,
      payoutState: payout
        ? this.asSafeString(payout['state'], 'PAYOUT_PENDING')
        : 'PAYOUT_NOT_PREPARED',
      ...(payout ? { payoutData: payout } : {}),
    };
  }

  async reconcilePaymentForClinic(
    clinicId: string,
    paymentRecordId: string,
    provider?: PaymentProvider
  ): Promise<{ payment: unknown; invoice?: unknown }> {
    const payment = await this.databaseService.findPaymentByIdSafe(paymentRecordId);
    if (!payment || payment.clinicId !== clinicId) {
      throw new NotFoundException('Payment record not found for this clinic');
    }

    const metadata = this.asRecord(payment.metadata) || {};
    const orderId =
      this.asSafeString(metadata['orderId']) ||
      this.asSafeString(metadata['invoiceNumber']) ||
      this.asSafeString(payment.transactionId) ||
      payment.id;
    const gatewayPaymentId = this.asSafeString(payment.transactionId) || payment.id;

    const metadataProvider = this.normalizePaymentProvider(metadata['provider']);

    return this.handlePaymentCallback(
      clinicId,
      gatewayPaymentId,
      orderId,
      provider || metadataProvider
    );
  }

  /**
   * Renew subscription after successful payment (internal method)
   */
  private async renewSubscriptionAfterPayment(subscriptionId: string): Promise<void> {
    const subscription = await this.databaseService.findSubscriptionByIdSafe(subscriptionId);

    if (!subscription || !subscription.plan) {
      return;
    }

    const currentStatus = subscription.status;
    const appointmentsRemaining = subscription.plan.isUnlimitedAppointments
      ? null
      : subscription.plan.appointmentsIncluded || null;

    if (
      (currentStatus as SubscriptionStatus) === SubscriptionStatus.INCOMPLETE ||
      (currentStatus as SubscriptionStatus) === SubscriptionStatus.INCOMPLETE_EXPIRED ||
      (currentStatus as SubscriptionStatus) === SubscriptionStatus.PAST_DUE
    ) {
      await this.databaseService.updateSubscriptionSafe(subscriptionId, {
        status: SubscriptionStatus.ACTIVE,
        appointmentsUsed: 0,
        ...(appointmentsRemaining !== null && { appointmentsRemaining }),
      });

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Subscription activated after initial payment',
        'BillingService',
        {
          subscriptionId,
          periodStart: subscription.currentPeriodStart.toISOString(),
          periodEnd: subscription.currentPeriodEnd.toISOString(),
        }
      );

      await this.eventService.emit('billing.subscription.renewed', {
        subscriptionId,
        periodStart: subscription.currentPeriodStart,
        periodEnd: subscription.currentPeriodEnd,
      });

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
      if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
        throw new BadRequestException('Refund amount must be a positive number');
      }

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
            `Refund amount exceeds remaining amount. Remaining: INR ${paymentAmount - totalRefunded}`
          );
        }
      }

      // Sole proprietor policy: for appointment-linked payments, full refund only before consultation starts.
      if (
        this.isSoleProprietorModeEnabled() &&
        'appointmentId' in payment &&
        payment.appointmentId
      ) {
        const appointment = await this.databaseService.findAppointmentByIdSafe(
          payment.appointmentId
        );
        if (!appointment) {
          throw new NotFoundException('Linked appointment not found for refund');
        }
        const appointmentStatus = String(appointment.status || '').toUpperCase();
        if (appointmentStatus === 'IN_PROGRESS' || appointmentStatus === 'COMPLETED') {
          throw new BadRequestException(
            'Refund not allowed after consultation has started or completed.'
          );
        }

        const alreadyRefunded = ('refundAmount' in payment && payment.refundAmount) || 0;
        const remainingAmount = payment.amount - alreadyRefunded;
        if (amount !== undefined && Math.abs(amount - remainingAmount) > 0.01) {
          throw new BadRequestException(
            `Only full refund is allowed before consultation. Required amount: INR ${remainingAmount}`
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
        refundOptions.amount = Math.round(amount * 100); // Convert to paise
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
      const refundAmountInRupees = refundResult.amount / 100;
      const newRefundAmount = currentRefundAmount + refundAmountInRupees;

      await this.updatePayment(payment.id, {
        refundAmount: newRefundAmount,
        status:
          newRefundAmount >= payment.amount ? PaymentStatus.REFUNDED : PaymentStatus.COMPLETED,
      });

      const paymentAfterRefund = await this.databaseService.findPaymentByIdSafe(payment.id);
      if (paymentAfterRefund) {
        const metadata =
          paymentAfterRefund.metadata &&
          typeof paymentAfterRefund.metadata === 'object' &&
          !Array.isArray(paymentAfterRefund.metadata)
            ? { ...(paymentAfterRefund.metadata as Record<string, unknown>) }
            : {};
        const payout =
          metadata['payout'] &&
          typeof metadata['payout'] === 'object' &&
          !Array.isArray(metadata['payout'])
            ? { ...(metadata['payout'] as Record<string, unknown>) }
            : null;

        if (payout) {
          const currentDoctorShare = Number(payout['doctorShareAmount'] || 0);
          const adjustedDoctorShare = this.roundToTwo(
            Math.max(0, currentDoctorShare - refundAmountInRupees)
          );
          const currentPlatformFee = Number(payout['platformFeeAmount'] || 0);
          const adjustedPlatformFee = this.roundToTwo(
            Math.max(0, currentPlatformFee - Math.min(currentPlatformFee, refundAmountInRupees))
          );
          const ledger = Array.isArray(payout['ledger'])
            ? [...(payout['ledger'] as Array<Record<string, unknown>>)]
            : [];
          ledger.push({
            type: 'REFUND_DEBIT',
            amount: refundAmountInRupees,
            reference: payment.id,
            createdAt: new Date().toISOString(),
          });
          payout['doctorShareAmount'] = adjustedDoctorShare;
          payout['platformFeeAmount'] = adjustedPlatformFee;
          payout['lastRefundAt'] = new Date().toISOString();
          payout['ledger'] = ledger;

          await this.updatePayment(payment.id, {
            metadata: {
              ...metadata,
              payout,
            },
          });
        }
      }

      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'Payment refund processed successfully',
        'BillingService',
        {
          paymentId: payment.id,
          refundId: refundResult.refundId,
          amount: refundAmountInRupees,
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
        amount: refundAmountInRupees,
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
          ((sub.status as SubscriptionStatus) === SubscriptionStatus.ACTIVE ||
            (sub.status as SubscriptionStatus) === SubscriptionStatus.TRIALING) &&
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
      (s: SubscriptionWithPlan) => (s.status as SubscriptionStatus) === SubscriptionStatus.ACTIVE
    ).length;
    const trialing = subscriptions.filter(
      (s: SubscriptionWithPlan) => (s.status as SubscriptionStatus) === SubscriptionStatus.TRIALING
    ).length;
    const cancelled = subscriptions.filter(
      (s: SubscriptionWithPlan) => (s.status as SubscriptionStatus) === SubscriptionStatus.CANCELLED
    ).length;
    const pastDue = subscriptions.filter(
      (s: SubscriptionWithPlan) => (s.status as SubscriptionStatus) === SubscriptionStatus.PAST_DUE
    ).length;

    const monthlyRecurringRevenue = subscriptions
      .filter(
        (s: SubscriptionWithPlan) => (s.status as SubscriptionStatus) === SubscriptionStatus.ACTIVE
      )
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
      if (!subscriptionId) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Skipping subscription confirmation because subscriptionId is missing',
          'BillingService'
        );
        return;
      }

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
  async getStats(clinicId: string) {
    const stats = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;

      const revenue = (await typedClient.payment.aggregate({
        where: { clinicId, status: PaymentStatus.COMPLETED } as PrismaDelegateArgs,
        _sum: { amount: true },
      } as PrismaDelegateArgs)) as unknown as { _sum: { amount: number | null } };

      const expenses = (await typedClient.clinicExpense.aggregate({
        where: { clinicId } as PrismaDelegateArgs,
        _sum: { amount: true },
      } as PrismaDelegateArgs)) as unknown as { _sum: { amount: number | null } };

      const totalRevenue = revenue._sum?.amount || 0;
      const totalExpenses = expenses._sum?.amount || 0;

      return {
        totalRevenue,
        totalExpenses,
        netProfit: totalRevenue - totalExpenses,
      };
    });

    return stats;
  }

  // ============ Clinic Expenses ============

  async createClinicExpense(data: CreateClinicExpenseDto, userId: string) {
    return await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        return await typedClient.clinicExpense.create({
          data: {
            ...data,
            userId,
            date: data.date ? new Date(data.date) : new Date(),
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId,
        clinicId: data.clinicId,
        resourceType: 'EXPENSE',
        operation: 'CREATE',
        resourceId: 'new',
        userRole: 'system',
        details: { amount: data.amount, category: data.category },
      }
    );
  }

  async getClinicExpenses(clinicId: string) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return await typedClient.clinicExpense.findMany({
        where: { clinicId } as PrismaDelegateArgs,
        orderBy: { date: 'desc' } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
  }

  // ============ Insurance Claims ============

  async createInsuranceClaim(data: CreateInsuranceClaimDto) {
    return await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        return await typedClient.insuranceClaim.create({
          data: {
            ...data,
            status: 'SUBMITTED',
            submittedAt: new Date(),
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: 'system',
        clinicId: data.clinicId,
        resourceType: 'INSURANCE_CLAIM',
        operation: 'CREATE',
        resourceId: 'new',
        userRole: 'system',
        details: { claimNumber: data.claimNumber, amount: data.amount },
      }
    );
  }

  async updateInsuranceClaimStatus(id: string, data: UpdateInsuranceClaimDto, clinicId: string) {
    return await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        return await typedClient.insuranceClaim.update({
          where: { id } as PrismaDelegateArgs,
          data: {
            ...data,
            responseAt: data.responseAt ? new Date(data.responseAt) : undefined,
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: 'system',
        clinicId,
        resourceType: 'INSURANCE_CLAIM',
        operation: 'UPDATE',
        resourceId: id,
        userRole: 'system',
        details: data as unknown as Record<string, unknown>,
      }
    );
  }

  async getInsuranceClaims(clinicId: string) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return await typedClient.insuranceClaim.findMany({
        where: { clinicId } as PrismaDelegateArgs,
        include: {
          patient: { include: { user: { select: { name: true } } } },
        } as PrismaDelegateArgs,
        orderBy: { submittedAt: 'desc' } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
  }

  async deleteClinicExpense(id: string, clinicId: string) {
    return await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        return await typedClient.clinicExpense.delete({
          where: { id, clinicId } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: 'system',
        clinicId,
        resourceType: 'EXPENSE',
        operation: 'DELETE',
        resourceId: id,
        userRole: 'system',
      }
    );
  }

  async deleteInsuranceClaim(id: string, clinicId: string) {
    return await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        return await typedClient.insuranceClaim.delete({
          where: { id, clinicId } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: 'system',
        clinicId,
        resourceType: 'INSURANCE_CLAIM',
        operation: 'DELETE',
        resourceId: id,
        userRole: 'system',
      }
    );
  }
}
