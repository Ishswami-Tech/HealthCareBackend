import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  forwardRef,
  Optional,
  OnModuleInit,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Cron, CronExpression } from '@nestjs/schedule';
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
import {
  SubscriptionStatus,
  InvoiceStatus,
  PaymentStatus,
  PaymentMethod,
  AppointmentQueueCategory,
} from '@core/types/enums.types';
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
  AppointmentStatus,
  TreatmentType,
} from '@dtos/appointment.dto';
import { InvoicePDFService } from './invoice-pdf.service';
import { BillingPaymentStore } from '@services/billing/billing-payment.store';
import type { InvoiceRow, PaymentRow } from '@services/billing/billing-payment.store';
import {
  BillingSubscriptionStore,
  assertPlanMatchesClinic,
  assertPlanReadable,
  assertPlanWritable,
  calculatePeriodEnd,
  planSubscriptionRenewal,
  resolvePlanClinicId,
} from '@services/billing/billing-subscription.store';
import { BillingPaymentFinaliser } from '@services/billing/billing-payment-finaliser';
import type {
  FinalisationOutcome,
  InvoiceSettlement,
  SettlementFlag,
} from '@services/billing/billing-payment-finaliser';
import {
  buildSettlementReviewMetadata,
  hasSettlementReview,
  hasSubscriptionRenewalStamp,
  isAmountCovered,
  isPersistedAnomaly,
  preserveReservedSubscriptionMetadata,
  readFinalisationMarker,
  resolvePaidConfirmationExpiresAt,
  sumCompletedPaymentMinorUnits,
  toMinorUnits,
  withSubscriptionRenewalStamp,
} from '@services/billing/billing-payment-finalisation.util';
import { WhatsAppService } from '@communication/channels/whatsapp/whatsapp.service';
import { PaymentService } from '@payment/payment.service';
import { PaymentHandoffTokenService } from '@payment/payment.handoff-token.service';
import { ConfigService } from '@config/config.service';
import type {
  PaymentIntentOptions,
  PaymentResult,
  PaymentStatusResult,
  RefundResult,
} from '@core/types/payment.types';
import { PaymentProvider } from '@core/types/payment.types';
import { formatDateInIST, IST_TIMEZONE, nowIso } from '@utils/date-time.util';
import { formatCurrencyFromMinorUnits } from '@utils/currency.util';

// Import centralized types
import type {
  AppointmentWhereInput,
  SubscriptionUpdateInput,
  SubscriptionWhereInput,
  InvoiceUpdateInput,
} from '@core/types/input.types';
import type {
  PrismaTransactionClientWithDelegates,
  PrismaDelegateArgs,
} from '@core/types/prisma.types';
import type {
  InvoicePDFData,
  InvoiceRecord,
  BillType,
  PatientBillRow,
  PatientBillHistory,
} from '@core/types/billing.types';
import type { ClinicSettings } from '@core/types/clinic.types';
import type {
  AppointmentWithRelations,
  InvoiceWithRelations,
  PaymentWithRelations,
  SubscriptionWithRelations,
} from '@core/types';

type AppointmentsServiceLike = {
  getAppointmentServiceCatalog: () => AppointmentServiceMetadataDto[];
};

/** Name / phone joined onto staff invoice and payment rows (plain `userId` FKs, no relation). */
type UserContact = { name: string | null; phone: string | null };

/** One `items[]` entry of a staff invoice row (normalised from the `lineItems` JSON). */
export type InvoiceLineItemView = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

/** `GET /billing/invoices/clinic` row. */
export type ClinicInvoiceView = InvoiceWithRelations & {
  patientName: string;
  patientPhone: string | null;
  items: InvoiceLineItemView[];
  paidAmount: number;
  balance: number;
};

/** Subscription row with the computed fields the subscription cards read. */
export type SubscriptionView = SubscriptionWithRelations & {
  appointmentsLimit: number | null;
  nextBillingDate: Date | null;
  autoRenew: boolean;
  plan?: SubscriptionWithRelations['plan'] & { billingCycle: string; price: number };
};

type BillingAccessContext = {
  userId?: string;
  role?: string;
  clinicId?: string;
};

@Injectable()
export class BillingService implements OnModuleInit {
  private appointmentsServiceRef: AppointmentsServiceLike | null = null;
  private readonly invoiceWhatsAppSendLocks = new Map<string, Promise<boolean>>();

  constructor(
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => EventService))
    private readonly eventService: EventService,
    @Inject(forwardRef(() => InvoicePDFService))
    private readonly invoicePDFService: InvoicePDFService,
    @Inject(forwardRef(() => WhatsAppService))
    private readonly whatsAppService: WhatsAppService,
    @Inject(forwardRef(() => PaymentService))
    private readonly paymentService: PaymentService,
    @Inject(forwardRef(() => PaymentHandoffTokenService))
    private readonly paymentHandoffTokenService: PaymentHandoffTokenService,
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => ModuleRef))
    private readonly moduleRef: ModuleRef,
    @Optional()
    @Inject(forwardRef(() => QueueService))
    private readonly queueService?: QueueService
  ) {}

  onModuleInit(): void {
    void this.reconcileLegacyPaidAppointments().catch(async error => {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to start appointment payment reconciliation: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'BillingService',
        {
          error: error instanceof Error ? error.stack : undefined,
        }
      );
    });
  }

  private paymentStoreRef: BillingPaymentStore | null = null;
  private subscriptionStoreRef: BillingSubscriptionStore | null = null;
  private finaliserRef: BillingPaymentFinaliser | null = null;

  /** Atomic payment / invoice / appointment primitives (fresh primary-database reads + CAS). */
  private get paymentStore(): BillingPaymentStore {
    this.paymentStoreRef ??= new BillingPaymentStore(this.databaseService);
    return this.paymentStoreRef;
  }

  private get subscriptionStore(): BillingSubscriptionStore {
    this.subscriptionStoreRef ??= new BillingSubscriptionStore(this.databaseService);
    return this.subscriptionStoreRef;
  }

  /** The claim / repair protocol; its side effects are the idempotent methods below. */
  private get finaliser(): BillingPaymentFinaliser {
    this.finaliserRef ??= new BillingPaymentFinaliser({
      store: this.paymentStore,
      log: (level, message, context) =>
        this.loggingService.log(LogType.PAYMENT, level, message, 'BillingService', context),
      updatePaymentAfterClaim: (paymentId, data) =>
        this.updatePayment(paymentId, data, undefined, { skipInvoiceSettlement: true }),
      settleInvoice: (payment, clinicId) => this.settleInvoiceForPayment(payment, clinicId),
      isPlanAmountCovered: (subscriptionId, payment) =>
        this.isPlanAmountCovered(subscriptionId, payment),
      renewSubscription: (subscriptionId, payment, options) =>
        this.renewSubscriptionAfterPayment(subscriptionId, {
          ...options,
          paymentId: payment.id,
          clinicId: payment.clinicId,
        }),
      recordSubscriptionLedger: (paymentId, clinicId, subscriptionId) =>
        this.prepareLedgerForSubscriptionPayment(paymentId, clinicId, subscriptionId),
      loadAppointment: appointmentId => this.databaseService.findAppointmentByIdSafe(appointmentId),
      syncAppointment: args =>
        this.syncAppointmentAfterPayment({
          appointmentId: args.appointmentId,
          clinicId: args.clinicId,
          paymentId: args.paymentId,
          paymentStatus: PaymentStatus.COMPLETED,
          amount: args.amount,
          appointment: args.appointment,
          userId: args.userId,
          emitAppointmentUpdated: true,
        }),
      emitPaymentLifecycle: args => this.emitPaymentLifecycleEvents(args),
      flagSettlement: flag => this.flagSettlement(flag),
    });
    return this.finaliserRef;
  }

  /**
   * Cache invalidation after a committed write must never abort the caller: the database
   * already holds the new state and a thrown cache error would skip the remaining steps of
   * a payment/subscription flow (ledger, activation, ...) and push a retry into the
   * duplicate-callback path. Failures are logged; entries age out via their TTL.
   */
  private async invalidateCacheTagsSafely(tags: readonly string[]): Promise<void> {
    const results = await Promise.allSettled(
      tags.map(tag => this.cacheService.invalidateCacheByTag(tag))
    );
    const failedTags = tags.filter((_tag, index) => results[index]?.status === 'rejected');
    if (failedTags.length > 0) {
      try {
        await this.loggingService.log(
          LogType.CACHE,
          LogLevel.WARN,
          'Billing cache invalidation failed; entries will expire via TTL',
          'BillingService',
          { failedTags }
        );
      } catch {
        // A logging failure must not turn a best-effort invalidation into a flow abort.
      }
    }
  }

  private async invalidateUserEntityCaches(userId: string, entityTag: string): Promise<void> {
    await this.invalidateCacheTagsSafely([`${entityTag}:${userId}`, `user:${userId}`]);
  }

  // Deprecated: use invalidateUserEntityCaches(userId, entityTag) instead
  private async invalidateUserInvoiceCaches(userId: string): Promise<void> {
    await this.invalidateUserEntityCaches(userId, 'user_invoices');
  }

  private async invalidateUserPaymentCaches(userId: string): Promise<void> {
    await this.invalidateUserEntityCaches(userId, 'user_payments');
  }

  private async invalidateUserSubscriptionCaches(userId: string): Promise<void> {
    await this.invalidateUserEntityCaches(userId, 'user_subscriptions');
  }

  private async withInvoiceWhatsAppSendLock(
    invoiceId: string,
    task: () => Promise<boolean>
  ): Promise<boolean> {
    const existingTask = this.invoiceWhatsAppSendLocks.get(invoiceId);
    if (existingTask) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Skipping duplicate invoice WhatsApp send while a send is already in progress',
        'BillingService',
        { invoiceId }
      );
      return await existingTask;
    }

    const taskPromise = (async () => {
      try {
        return await task();
      } finally {
        this.invoiceWhatsAppSendLocks.delete(invoiceId);
      }
    })();

    this.invoiceWhatsAppSendLocks.set(invoiceId, taskPromise);
    return await taskPromise;
  }

  private async emitBillingPaymentStateEvents(params: {
    paymentId: string;
    clinicId: string;
    appointmentId?: string;
    status?: string;
    payment?: PaymentWithRelations;
  }): Promise<void> {
    await this.eventService.emit('billing.payment.updated', {
      paymentId: params.paymentId,
      clinicId: params.clinicId,
      ...(params.appointmentId ? { appointmentId: params.appointmentId } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.payment ? { payment: params.payment } : {}),
    });
    await this.eventService.emit('payment.pending', {
      paymentId: params.paymentId,
      clinicId: params.clinicId,
      ...(params.appointmentId
        ? {
            appointmentId: params.appointmentId,
            status: params.status ?? 'pending',
          }
        : {}),
    });
  }

  private async emitBillingPaymentUpdatedEvent(
    paymentId: string,
    payment?: PaymentWithRelations
  ): Promise<void> {
    await this.eventService.emit('billing.payment.updated', {
      paymentId,
      ...(payment
        ? { payment, clinicId: payment.clinicId, appointmentId: payment.appointmentId }
        : {}),
    });
  }

  private assertBillingEntityAccess(
    entity: { clinicId?: string | null; userId?: string | null },
    requester?: BillingAccessContext
  ): void {
    if (!requester) {
      return;
    }

    if (requester.role === 'SUPER_ADMIN') {
      return;
    }

    // A patient may only touch their own records. Fail closed when the requester carries no
    // user id instead of skipping the comparison.
    if (requester.role === 'PATIENT' && entity.userId !== requester.userId) {
      throw new NotFoundException('Billing record not found');
    }

    if (requester.clinicId && entity.clinicId !== requester.clinicId) {
      throw new NotFoundException('Billing record not found');
    }
  }

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

  private async resolveAppointmentBillingUserId(
    appointment: Pick<AppointmentWithRelations, 'patientId'> & {
      patient?: { userId?: string | null } | null;
    }
  ): Promise<string | null> {
    if (appointment.patient?.userId) {
      return appointment.patient.userId;
    }

    if (!appointment.patientId) {
      return null;
    }

    const patientRecord = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        patient: {
          findUnique: (args: PrismaDelegateArgs) => Promise<unknown>;
        };
      };

      return (await typedClient.patient.findUnique({
        where: { id: appointment.patientId } as PrismaDelegateArgs,
        select: { userId: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as { userId?: string | null } | null;
    });

    return patientRecord?.userId ?? null;
  }

  public async syncAppointmentAfterPayment(args: {
    appointmentId: string;
    clinicId: string;
    paymentId: string;
    paymentStatus: string;
    amount?: number;
    appointment?: AppointmentWithRelations | null;
    userId?: string | null;
    emitAppointmentUpdated?: boolean;
  }): Promise<AppointmentWithRelations | null> {
    const normalizedPaymentStatus = String(args.paymentStatus || '')
      .trim()
      .toLowerCase();
    const appointment =
      args.appointment ?? (await this.databaseService.findAppointmentByIdSafe(args.appointmentId));

    if (!appointment) {
      await Promise.all([
        this.cacheService.invalidateAppointmentCache(
          args.appointmentId,
          undefined,
          undefined,
          args.clinicId
        ),
        args.userId
          ? this.cacheService.invalidateMyAppointmentsCache(args.userId)
          : Promise.resolve(0),
        args.userId
          ? this.cacheService.invalidateUpcomingAppointmentsCache(args.userId)
          : Promise.resolve(0),
      ]);

      await this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.WARN,
        'Appointment not found while syncing payment completion',
        'BillingService',
        {
          appointmentId: args.appointmentId,
          clinicId: args.clinicId,
          paymentId: args.paymentId,
          paymentStatus: normalizedPaymentStatus,
        }
      );

      return null;
    }

    const resolvedClinicId = appointment.clinicId || args.clinicId;
    const resolvedUserId = args.userId || (await this.resolveAppointmentBillingUserId(appointment));
    const shouldEmit = args.emitAppointmentUpdated ?? true;
    const patientProfileId = appointment.patientId || undefined;
    const cacheIdentityIds = Array.from(
      new Set([resolvedUserId, patientProfileId].filter((value): value is string => Boolean(value)))
    );

    await Promise.all([
      this.cacheService.invalidateAppointmentCache(
        appointment.id,
        patientProfileId,
        appointment.doctorId || undefined,
        resolvedClinicId
      ),
      // Invalidate video consultation status cache for video appointments after payment
      appointment.type === 'VIDEO'
        ? this.cacheService.invalidateVideoCacheForAppointment(appointment.id)
        : Promise.resolve(false),
      ...cacheIdentityIds.map(identityId =>
        this.cacheService.invalidateMyAppointmentsCache(identityId)
      ),
      ...cacheIdentityIds.map(identityId =>
        this.cacheService.invalidateUpcomingAppointmentsCache(identityId)
      ),
      ...cacheIdentityIds.map(identityId =>
        this.cacheService.invalidatePatientCache(identityId, resolvedClinicId)
      ),
      appointment.doctorId
        ? this.cacheService.invalidateDoctorCache(appointment.doctorId, resolvedClinicId)
        : Promise.resolve(0),
    ]);

    if (shouldEmit) {
      const eventPayload: EnterpriseEventPayload = {
        eventId: `appointment-payment-updated-${appointment.id}-${args.paymentId}`,
        eventType: 'appointment.updated',
        category: EventCategory.APPOINTMENT,
        priority: EventPriority.NORMAL,
        timestamp: nowIso(),
        source: 'BillingService',
        version: '1.0.0',
        ...(resolvedUserId ? { userId: resolvedUserId } : {}),
        clinicId: resolvedClinicId,
        metadata: {
          appointmentId: appointment.id,
          patientId: appointment.patientId,
          doctorId: appointment.doctorId,
          clinicId: resolvedClinicId,
          paymentId: args.paymentId,
          paymentStatus: normalizedPaymentStatus,
          amount: args.amount,
          status: appointment.status,
          source: 'BillingService',
        },
        payload: {
          appointmentId: appointment.id,
          patientId: appointment.patientId,
          doctorId: appointment.doctorId,
          clinicId: resolvedClinicId,
          userId: resolvedUserId ?? appointment.patient?.userId ?? undefined,
          paymentId: args.paymentId,
          paymentStatus: normalizedPaymentStatus,
          amount: args.amount,
          status: appointment.status,
          appointment,
          source: 'BillingService',
        },
      };

      await this.eventService.emitEnterprise('appointment.updated', eventPayload);
    }

    return appointment;
  }

  private isSoleProprietorModeEnabled(): boolean {
    const raw =
      this.configService.getEnv('SOLE_PROPRIETOR_MODE') ??
      this.configService.getEnv('PAYMENT_SOLE_PROPRIETOR_MODE') ??
      'true';
    return String(raw).toLowerCase() === 'true';
  }

  private formatDisplayAmount(amount: number, currency = 'INR'): string {
    return formatCurrencyFromMinorUnits(amount, currency);
  }

  private async emitPaymentLifecycleEvents(args: {
    clinicId: string;
    paymentId: string;
    userId?: string;
    appointmentId?: string;
    appointment?: AppointmentWithRelations | null;
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

    const resolvedAppointment =
      args.appointment ??
      (args.appointmentId
        ? await this.databaseService.findAppointmentByIdSafe(args.appointmentId)
        : null);

    const paymentLifecycleEvent: EnterpriseEventPayload = {
      eventId: `${eventType.replace('.', '-')}-${args.paymentId}`,
      eventType,
      category: EventCategory.BILLING,
      priority: EventPriority.HIGH,
      timestamp: nowIso(),
      source: 'BillingService',
      version: '1.0.0',
      clinicId: args.clinicId,
      ...(args.userId && { userId: args.userId }),
      metadata: {
        paymentId: args.paymentId,
        amount: args.amount,
        displayAmount: this.formatDisplayAmount(args.amount),
        status: normalizedStatus,
        ...(args.clinicId ? { clinicId: args.clinicId } : {}),
        ...(args.appointmentId && { appointmentId: args.appointmentId }),
        ...(args.subscriptionId && { subscriptionId: args.subscriptionId }),
      },
      payload: {
        paymentId: args.paymentId,
        amount: args.amount,
        displayAmount: this.formatDisplayAmount(args.amount),
        status: normalizedStatus,
        clinicId: args.clinicId,
        ...(args.userId ? { userId: args.userId } : {}),
        ...(args.appointmentId ? { appointmentId: args.appointmentId } : {}),
        ...(resolvedAppointment ? { appointment: resolvedAppointment } : {}),
        ...(args.subscriptionId ? { subscriptionId: args.subscriptionId } : {}),
      },
    };

    await this.eventService.emitEnterprise(eventType, paymentLifecycleEvent);

    if (args.appointmentId) {
      await this.eventService.emit(eventType, {
        appointmentId: args.appointmentId,
        paymentId: args.paymentId,
        status: normalizedStatus,
        clinicId: args.clinicId,
        ...(resolvedAppointment ? { appointment: resolvedAppointment } : {}),
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
    provider?: PaymentProvider,
    appointmentId?: string,
    paymentId?: string,
    appointmentType?: 'VIDEO_CALL' | 'IN_PERSON' | 'HOME_VISIT'
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
          if (paymentId) {
            url.searchParams.set('paymentId', paymentId);
          }
          if (appointmentId) {
            url.searchParams.set('appointmentId', appointmentId);
          }
          if (appointmentType) {
            url.searchParams.set('appointmentType', appointmentType);
          }
          return url.toString();
        } catch {
          // Fall through if URL is invalid
        }
      }
    }

    // Priority 2: Standard application URLs
    const paymentBaseUrl =
      this.configService.getEnv('PAYMENT_RETURN_BASE_URL') ||
      this.configService.getEnv('PAYMENT_SITE_URL') ||
      this.configService.getEnv('FRONTEND_URL') ||
      this.configService.getEnv('NEXT_PUBLIC_APP_URL') ||
      this.configService.getAppConfig().baseUrl ||
      'http://localhost:3000';

    const normalizedPaymentUrl = paymentBaseUrl.replace(/\/+$/, '');
    const callbackUrl = new URL(`${normalizedPaymentUrl}/payment/callback`);
    callbackUrl.searchParams.set('clinicId', clinicId);
    callbackUrl.searchParams.set('orderId', orderId);
    if (provider) {
      callbackUrl.searchParams.set('provider', String(provider));
    }
    if (paymentId) {
      callbackUrl.searchParams.set('paymentId', paymentId);
    }
    if (appointmentId) {
      callbackUrl.searchParams.set('appointmentId', appointmentId);
    }
    if (appointmentType) {
      callbackUrl.searchParams.set('appointmentType', appointmentType);
    }
    return callbackUrl.toString();
  }

  private async createPaymentHandoffDetails(params: {
    clinicId: string;
    orderId: string;
    paymentId?: string;
    provider?: PaymentProvider;
    appointmentId?: string;
    appointmentType?: 'VIDEO_CALL' | 'IN_PERSON' | 'HOME_VISIT';
    callbackUrl: string;
  }): Promise<{
    token: string;
    callbackUrl: string;
    expiresAt: Date;
  }> {
    const handoffParams = {
      clinicId: params.clinicId,
      orderId: params.orderId,
      frontendCallbackBase: params.callbackUrl,
      ...(params.provider ? { provider: params.provider } : {}),
      ...(params.paymentId ? { paymentId: params.paymentId } : {}),
      ...(params.appointmentId ? { appointmentId: params.appointmentId } : {}),
      ...(params.appointmentType ? { appointmentType: params.appointmentType } : {}),
    };
    const result = await this.paymentHandoffTokenService.generateHandoffToken({
      ...handoffParams,
    });

    return {
      token: result.token,
      callbackUrl: result.frontendCallbackUrlWithToken,
      expiresAt: result.expiresAt,
    };
  }

  private getResolvedBackendBaseUrl(): string {
    const appConfig = this.configService.getAppConfig();
    return appConfig.baseUrl || appConfig.apiUrl || this.configService.getEnv('BASE_URL') || '';
  }

  private buildGatewayOrderId(baseOrderId: string, uniqueKey: string): string {
    const normalizedBase = String(baseOrderId || '').replace(/[^A-Za-z0-9_-]/g, '-');
    const normalizedUnique = String(uniqueKey || '')
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 8);

    if (!normalizedBase) {
      return normalizedUnique || `order-${Date.now()}`;
    }

    return normalizedUnique ? `${normalizedBase}${normalizedUnique}` : normalizedBase;
  }

  private roundToTwo(value: number): number {
    return Math.round(value * 100) / 100;
  }

  /**
   * Rupees -> integer paise, and back. Summing/subtracting rupee floats
   * directly (even with a final .toFixed(2)/roundToTwo pass) still lets
   * IEEE-754 rounding error accumulate across multiple line items, partial
   * payments, and refunds on the same invoice. Doing the arithmetic in
   * integer paise avoids that; only convert back to rupees at the boundary
   * (DB write / API response) where the existing rupee-based schema and
   * DTOs are unchanged.
   */
  private toPaise(rupees: number): number {
    return Math.round((rupees || 0) * 100);
  }

  private fromPaise(paise: number): number {
    return paise / 100;
  }

  private getGstRatePercent(): number {
    const configuredRate =
      Number(this.configService.getEnv('BILLING_GST_RATE_PERCENT')) ||
      Number(this.configService.getEnv('GST_RATE_PERCENT')) ||
      0;

    return Number.isFinite(configuredRate) && configuredRate >= 0 ? configuredRate : 0;
  }

  private calculateGstAmount(amount: number): number {
    return this.roundToTwo((amount * this.getGstRatePercent()) / 100);
  }

  private getInvoiceTotalAmount(invoice: unknown, fallbackAmount: number): number {
    const invoiceRecord = invoice as Record<string, unknown>;
    const totalAmount = Number(invoiceRecord['totalAmount']);

    return Number.isFinite(totalAmount) && totalAmount > 0
      ? this.roundToTwo(totalAmount)
      : this.roundToTwo(fallbackAmount);
  }

  /**
   * Resolve the open appointment payment for a gateway order that has no local record,
   * using the appointment/clinic tags the gateway echoes back (Cashfree `order_tags`).
   * Only trusts tags from a real gateway verification, never skipped verifications.
   */
  private async findOpenPaymentByGatewayTags(
    clinicId: string,
    paymentStatus: PaymentStatusResult
  ): Promise<PaymentWithRelations | null> {
    const statusMetadata = this.asRecord(paymentStatus.metadata);
    if (!statusMetadata || statusMetadata['verificationSkipped'] === true) {
      return null;
    }

    const tags = this.asRecord(statusMetadata['order_tags']);
    const appointmentId = this.asSafeString(tags?.['appointmentId']);
    const taggedClinicId = this.asSafeString(tags?.['clinicId']);
    if (!appointmentId || (taggedClinicId && taggedClinicId !== clinicId)) {
      return null;
    }

    const closedStatuses = new Set(
      [PaymentStatus.COMPLETED, PaymentStatus.REFUNDED].map(status => String(status))
    );
    const openPayments = (
      await this.databaseService.findPaymentsSafe({ appointmentId, clinicId })
    ).filter(candidate => !closedStatuses.has(String(candidate.status)));

    return (
      openPayments.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0] ||
      null
    );
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

  // ============ Staff list enrichment (patient contact, items, balances) ============

  /**
   * `User.id -> { name, phone }` for the ids given. Invoices and payments carry plain `userId`
   * FKs (no Prisma relation), so the staff lists join the contact here in one query.
   */
  private async lookupUserContacts(
    userIds: Array<string | null | undefined>
  ): Promise<Map<string, UserContact>> {
    const ids = [
      ...new Set(userIds.filter((id): id is string => typeof id === 'string' && id.length > 0)),
    ];
    if (ids.length === 0) {
      return new Map();
    }
    const users = await this.databaseService.executeHealthcareRead(async client => {
      const userClient = client as unknown as {
        user: {
          findMany: (args: {
            where: { id: { in: string[] } };
            select: { id: true; name: true; phone: true };
          }) => Promise<Array<{ id: string; name: string | null; phone: string | null }>>;
        };
      };
      return userClient.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, phone: true },
      });
    });
    return new Map(
      users.map(user => [user.id, { name: user.name ?? null, phone: user.phone ?? null }])
    );
  }

  /**
   * `lineItems` is stored either as an array or as `{ items: [...] }`, with `amount` and/or
   * `unitPrice` per entry. The clients read `items[{ id, description, quantity, unitPrice, total }]`.
   */
  private normaliseInvoiceItems(lineItems: unknown): InvoiceLineItemView[] {
    const container = this.asRecord(lineItems);
    const raw: unknown[] = Array.isArray(lineItems)
      ? lineItems
      : Array.isArray(container?.['items'])
        ? (container?.['items'] as unknown[])
        : [];
    return raw.map((entry, index) => {
      const item = this.asRecord(entry) ?? {};
      const quantity = Math.max(1, Math.round(Number(item['quantity']) || 1));
      const amount = Number(item['amount'] ?? item['total']);
      const unitPriceRaw = Number(item['unitPrice'] ?? item['price']);
      const unitPrice = Number.isFinite(unitPriceRaw)
        ? unitPriceRaw
        : Number.isFinite(amount)
          ? this.fromPaise(Math.round(this.toPaise(amount) / quantity))
          : 0;
      const total = Number.isFinite(amount)
        ? amount
        : this.fromPaise(this.toPaise(unitPrice) * quantity);
      return {
        id: this.asSafeString(item['id'], String(index + 1)),
        description: this.asSafeString(
          item['description'] || item['name'] || item['label'],
          'Item'
        ),
        quantity,
        unitPrice: this.roundToTwo(unitPrice),
        total: this.roundToTwo(total),
      };
    });
  }

  /** Staff invoice row: patient contact, `items[]`, paid amount and outstanding balance. */
  private decorateClinicInvoice(
    invoice: InvoiceWithRelations,
    contacts: Map<string, UserContact>
  ): ClinicInvoiceView {
    const contact = contacts.get(invoice.userId);
    const totalPaise = this.toPaise(Number(invoice.totalAmount) || 0);
    const completedPaise = (invoice.payments ?? [])
      .filter(payment => String(payment.status).toUpperCase() === String(PaymentStatus.COMPLETED))
      .reduce((sum, payment) => sum + this.toPaise(Number(payment.amount) || 0), 0);
    // A cash invoice marked paid at the desk has no payment row: PAID means fully settled.
    const paidPaise =
      String(invoice.status) === String(InvoiceStatus.PAID)
        ? Math.max(totalPaise, completedPaise)
        : Math.min(totalPaise, completedPaise);
    return {
      ...invoice,
      patientName: contact?.name || 'Unknown',
      patientPhone: contact?.phone ?? null,
      items: this.normaliseInvoiceItems(invoice.lineItems),
      paidAmount: this.fromPaise(paidPaise),
      balance: this.fromPaise(Math.max(0, totalPaise - paidPaise)),
    };
  }

  /** `YYYY-MM` of a timestamp in clinic (IST) time; revenue is bucketed per calendar month. */
  private monthKeyInIST(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: IST_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
    }).format(date);
  }

  /**
   * Fields the subscription cards read but the row does not store: `appointmentsLimit`
   * (null = unlimited), `nextBillingDate`, `autoRenew`, and `plan.billingCycle` / `plan.price`
   * as aliases of the plan's `interval` / `amount`.
   */
  private decorateSubscriptionRow(subscription: SubscriptionWithRelations): SubscriptionView {
    const { plan, ...row } = subscription;
    const status = String(subscription.status);
    const renewable =
      status === String(SubscriptionStatus.ACTIVE) ||
      status === String(SubscriptionStatus.TRIALING) ||
      status === String(SubscriptionStatus.PAST_DUE);
    const autoRenew = renewable && !subscription.cancelAtPeriodEnd;
    const appointmentsLimit = plan
      ? plan.isUnlimitedAppointments
        ? null
        : (plan.appointmentsIncluded ?? null)
      : null;
    const decorated: SubscriptionView = {
      ...row,
      appointmentsLimit,
      nextBillingDate: autoRenew ? (subscription.currentPeriodEnd ?? null) : null,
      autoRenew,
    };
    return plan
      ? { ...decorated, plan: { ...plan, billingCycle: plan.interval, price: plan.amount } }
      : decorated;
  }

  /**
   * Payment method named by the gateway on a verified payment, mapped to the stored
   * PaymentMethod enum. Undefined when the gateway did not report one we recognise.
   */
  private resolveGatewayPaymentMethod(
    paymentStatus: PaymentStatusResult
  ): PaymentMethod | undefined {
    const metadata = this.asRecord(paymentStatus.metadata);
    const reported = (
      this.asSafeString(metadata?.['paymentMethod']) ||
      this.asSafeString(metadata?.['paymentMode']) ||
      this.asSafeString(metadata?.['payment_group']) ||
      this.asSafeString(metadata?.['payment_method'])
    )
      .trim()
      .toUpperCase();

    if (!reported) return undefined;
    if (reported.includes('UPI')) return PaymentMethod.UPI;
    if (reported.includes('NET') && reported.includes('BANK')) return PaymentMethod.NET_BANKING;
    if (reported.includes('WALLET')) return PaymentMethod.WALLET;
    if (reported.includes('CARD') && !reported.includes('CARDLESS')) return PaymentMethod.CARD;
    return undefined;
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
    if (normalized === 'pending' || normalized === 'processing' || normalized === 'active') {
      return PaymentStatus.PENDING;
    }
    if (
      normalized === 'failed' ||
      normalized === 'cancelled' ||
      normalized === 'canceled' ||
      normalized === 'expired'
    ) {
      return PaymentStatus.FAILED;
    }
    if (normalized === 'refunded') {
      return PaymentStatus.REFUNDED;
    }
    throw new BadRequestException(`Unsupported payment status from gateway: ${String(status)}`);
  }

  // ============ Billing Plans ============

  async createBillingPlan(data: CreateBillingPlanDto, requester?: BillingAccessContext) {
    try {
      // Non-super-admins can only create plans for the clinic the guard validated.
      const planClinicId = resolvePlanClinicId(data.clinicId, requester);
      const plan = await this.databaseService.createBillingPlanSafe({
        name: data.name,
        amount: data.amount,
        currency: data.currency || 'INR',
        interval: data.interval,
        intervalCount: data.intervalCount || 1,
        ...(data.description && { description: data.description }),
        ...(data.trialPeriodDays && { trialPeriodDays: data.trialPeriodDays }),
        ...(data.features && { features: data.features }),
        ...(planClinicId && { clinicId: planClinicId }),
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

      await this.eventService.emit('billing.plan.created', {
        planId: plan.id,
        clinicId: plan.clinicId,
        plan,
      });
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

  async getBillingPlan(id: string, requester?: BillingAccessContext) {
    const cacheKey = `billing_plan:${id}`;

    // Only the raw row is cached (the key carries no requester); the clinic check depends on WHO
    // is asking, so it runs on every call, outside the loader.
    const plan = await this.cacheService.cache(
      cacheKey,
      async () => {
        const row = await this.databaseService.findBillingPlanByIdSafe(id);

        if (!row) {
          throw new NotFoundException(`Billing plan with ID ${id} not found`);
        }

        return row;
      },
      {
        ttl: 3600, // 1 hour
        tags: ['billing_plans', `billing_plan:${id}`],
        priority: 'normal',
      }
    );

    assertPlanReadable(plan, requester);
    return plan;
  }

  async updateBillingPlan(
    id: string,
    data: UpdateBillingPlanDto,
    requester?: BillingAccessContext
  ) {
    const existingPlan = await this.databaseService.findBillingPlanByIdSafe(id);
    if (!existingPlan) {
      throw new NotFoundException(`Billing plan with ID ${id} not found`);
    }
    assertPlanWritable(existingPlan, requester);

    const plan = await this.databaseService.updateBillingPlanSafe(id, data);

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Billing plan updated',
      'BillingService',
      { planId: id }
    );

    await this.eventService.emit('billing.plan.updated', {
      planId: id,
      clinicId: plan.clinicId,
      plan,
    });
    await this.cacheService.invalidateCacheByTag('billing_plans');

    return plan;
  }

  async deleteBillingPlan(id: string, requester?: BillingAccessContext) {
    const plan = await this.databaseService.findBillingPlanByIdSafe(id);
    if (!plan) {
      throw new NotFoundException(`Billing plan with ID ${id} not found`);
    }
    assertPlanWritable(plan, requester);

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

    await this.eventService.emit('billing.plan.deleted', {
      planId: id,
      clinicId: plan.clinicId,
      plan,
    });
    await this.cacheService.invalidateCacheByTag('billing_plans');
  }

  // ============ Subscriptions ============

  async createSubscription(data: CreateSubscriptionDto, requester?: BillingAccessContext) {
    this.assertBillingEntityAccess(
      {
        clinicId: data.clinicId,
        userId: data.userId,
      },
      requester
    );

    if (requester?.role && requester.role !== 'SUPER_ADMIN' && requester.clinicId) {
      const patientBelongsToClinic = await this.databaseService.executeHealthcareRead(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            user: {
              findUnique: (args: PrismaDelegateArgs) => Promise<unknown>;
            };
            patient: {
              findUnique: (args: PrismaDelegateArgs) => Promise<unknown>;
            };
            appointment: {
              findFirst: (args: PrismaDelegateArgs) => Promise<unknown>;
            };
          };

          const user = (await typedClient.user.findUnique({
            where: { id: data.userId } as PrismaDelegateArgs,
            select: { primaryClinicId: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs)) as { primaryClinicId?: string | null } | null;

          if (user?.primaryClinicId === requester.clinicId) {
            return true;
          }

          const patient = (await typedClient.patient.findUnique({
            where: { userId: data.userId } as PrismaDelegateArgs,
            select: { id: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs)) as { id: string } | null;

          if (!patient) {
            return false;
          }

          const appointment = await typedClient.appointment.findFirst({
            where: {
              patientId: patient.id,
              clinicId: requester.clinicId,
            } as PrismaDelegateArgs,
            select: { id: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);

          return !!appointment;
        }
      );

      if (!patientBelongsToClinic) {
        throw new NotFoundException('Patient not found');
      }
    }

    const plan = await this.getBillingPlan(data.planId);
    // A subscription may only use a plan of its own clinic (or a platform-wide plan).
    assertPlanMatchesClinic(plan, data.clinicId);
    const existingSubscriptions = await this.databaseService.findSubscriptionsSafe({
      userId: data.userId,
      clinicId: data.clinicId,
      planId: data.planId,
    });
    const now = new Date();

    const hasBlockingSubscription = existingSubscriptions.some(subscription => {
      const status = String(subscription.status);

      // If it's active or trialing, ensure it's not mathematically expired
      if (
        status === String(SubscriptionStatus.ACTIVE) ||
        status === String(SubscriptionStatus.TRIALING)
      ) {
        const targetDate = subscription.currentPeriodEnd || subscription.endDate;
        const isExpired = targetDate && new Date(targetDate) < now;
        return !isExpired; // If not expired, it blocks
      }

      // Do not block INCOMPLETE subscriptions; users shouldn't be locked out if they abandon a prior checkout.
      if (status === String(SubscriptionStatus.INCOMPLETE)) {
        return false;
      }

      // PAST_DUE subscriptions are functionally lapsed; do not block a fresh checkout
      return false;
    });

    if (hasBlockingSubscription) {
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

    // An abandoned checkout leaves an unpaid (INCOMPLETE) subscription behind. For a plain
    // re-subscribe to the same plan, reuse it with a fresh period instead of adding another.
    const reusableSubscription =
      String(status) === String(SubscriptionStatus.INCOMPLETE) &&
      !data.startDate &&
      !data.endDate &&
      !data.metadata &&
      !trialStart &&
      !trialEnd
        ? existingSubscriptions
            .filter(existing => String(existing.status) === String(SubscriptionStatus.INCOMPLETE))
            .sort(
              (left, right) =>
                new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
            )[0]
        : undefined;

    if (reusableSubscription) {
      // A re-subscribe must not inherit a cancellation: clear the cancel flags so the plan
      // is not cancelled at period end the moment it is paid for. SubscriptionUpdateInput
      // types `cancelledAt` as `Date`, but the column is nullable and null is what clears it.
      const reuseUpdate: Omit<SubscriptionUpdateInput, 'cancelledAt'> & { cancelledAt: null } = {
        startDate,
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: false,
        cancelledAt: null,
        appointmentsUsed: 0,
        ...(appointmentsRemaining !== null &&
          appointmentsRemaining !== undefined && { appointmentsRemaining }),
      };
      const reused = await this.databaseService.updateSubscriptionSafe(
        reusableSubscription.id,
        reuseUpdate as unknown as SubscriptionUpdateInput
      );

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Unpaid subscription reused for a new checkout',
        'BillingService',
        { subscriptionId: reused.id, userId: data.userId }
      );

      await this.invalidateSubscriptionCaches(data.userId, reused.id);

      return reused;
    }

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
        subscription,
      });

      await this.invalidateUserSubscriptionCaches(data.userId);

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
    if (role === 'PATIENT' && requestingUserId && requestingUserId !== userId) {
      throw new BadRequestException('You can only view your own subscriptions');
    }

    // Resolve the clinic scope BEFORE the cache so the key carries the scope that is really
    // queried; keyed by the raw `clinicId` a staff caller without clinic context shared the
    // `all` entry with an unscoped patient request.
    const resolvedClinicId = await this.resolveUserClinicId(userId, clinicId, role);
    const cacheKey = `billing_subscriptions:user:${userId}:${resolvedClinicId || 'all'}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const whereClause: Record<string, unknown> = { userId };
        if (resolvedClinicId) {
          whereClause['clinicId'] = resolvedClinicId;
        }
        const rows = await this.databaseService.findSubscriptionsSafe(whereClause);
        return rows.map(row => this.decorateSubscriptionRow(row));
      },
      {
        ttl: 1800,
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
        const rows = await this.databaseService.findSubscriptionsSafe({ clinicId });
        return rows.map(row => this.decorateSubscriptionRow(row));
      },
      {
        ttl: 1800,
        tags: ['billing_subscriptions', `clinic:${clinicId}`],
        priority: 'normal',
      }
    );
  }

  async getSubscription(id: string, requester?: BillingAccessContext) {
    const cacheKey = `billing_subscription:${id}`;

    // Only the raw row is cached (the key carries no requester). The ownership/clinic check
    // depends on WHO is asking, so it must run on every call, outside the loader: inside the
    // loader it ran on a cache miss only, and a warm entry let any caller who knew a
    // subscription id read, cancel, renew or pay another patient's/clinic's plan.
    const subscription = await this.cacheService.cache(
      cacheKey,
      async () => {
        const row = await this.databaseService.findSubscriptionByIdSafe(id);

        if (!row) {
          throw new NotFoundException(`Subscription with ID ${id} not found`);
        }

        return row;
      },
      {
        ttl: 1800, // 30 minutes
        // `subscription:{id}` / `subscriptions` are the tags DatabaseService invalidates on every
        // subscription write, so a write through any path drops this entry too.
        tags: [
          'billing_subscriptions',
          `billing_subscription:${id}`,
          `subscription:${id}`,
          'subscriptions',
        ],
        priority: 'normal',
      }
    );

    this.assertBillingEntityAccess(subscription, requester);
    return subscription;
  }

  async updateSubscription(
    id: string,
    data: UpdateSubscriptionDto,
    requester?: BillingAccessContext
  ) {
    const existingSubscription = await this.getSubscription(id, requester);
    const updateData: SubscriptionUpdateInput = {
      ...(data.status && { status: data.status }),
      ...(data.endDate && { endDate: new Date(data.endDate) }),
      ...(data.cancelAtPeriodEnd !== undefined && {
        cancelAtPeriodEnd: data.cancelAtPeriodEnd,
      }),
      ...(data.metadata && {
        // The payment-protocol keys (renewed payment ids) survive a staff metadata edit.
        metadata: preserveReservedSubscriptionMetadata(
          existingSubscription.metadata,
          data.metadata as Record<string, unknown>
        ) as Record<string, string | number | boolean>,
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
      subscription,
    });
    await this.invalidateSubscriptionCaches(existingSubscription.userId, id);

    return subscription;
  }

  async cancelSubscription(
    id: string,
    immediate: boolean = false,
    requester?: BillingAccessContext
  ) {
    const subscription = await this.getSubscription(id, requester);

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
      subscription: updated,
    });

    await this.invalidateSubscriptionCaches(subscription.userId, id);

    return updated;
  }

  /**
   * Automated cron job to mark expired active subscriptions as PAST_DUE
   */
  @Cron(CronExpression.EVERY_HOUR)
  async checkExpiredSubscriptions() {
    try {
      const expiredSubscriptions = await this.databaseService.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            subscription: {
              findMany: (args: unknown) => Promise<SubscriptionWithRelations[]>;
              update: (args: unknown) => Promise<unknown>;
            };
          };

          const now = new Date();
          now.setDate(now.getDate() - 1);

          const expired = await typedClient.subscription.findMany({
            where: {
              status: SubscriptionStatus.ACTIVE,
              currentPeriodEnd: { lt: now },
            } as PrismaDelegateArgs,
            select: { id: true, userId: true, clinicId: true },
          });

          await Promise.all(
            expired.map(sub =>
              typedClient.subscription.update({
                where: { id: sub.id },
                data: { status: SubscriptionStatus.PAST_DUE },
              })
            )
          );

          return expired;
        },
        {
          userId: 'SYSTEM_CRON',
          userRole: 'SYSTEM',
          clinicId: 'SYSTEM',
          operation: 'UPDATE_EXPIRED_SUBSCRIPTIONS',
          resourceType: 'SUBSCRIPTION',
          resourceId: 'BATCH_UPDATE',
          timestamp: new Date(),
        }
      );

      if (expiredSubscriptions.length > 0) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          `Marked ${expiredSubscriptions.length} subscriptions as PAST_DUE due to expiration schedule`,
          'BillingService',
          { count: expiredSubscriptions.length }
        );

        // Invalidate caches for affected users
        const userIds = [...new Set(expiredSubscriptions.map(s => s.userId))];
        await Promise.all(userIds.map(id => this.invalidateUserSubscriptionCaches(id)));
      }
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to process expired subscriptions via cron',
        'BillingService',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Manually renew subscription (public method for admin use)
   */
  async renewSubscription(id: string, requester?: BillingAccessContext) {
    const subscription = await this.getSubscription(id, requester);

    // This route activates a plan without taking money, so it is for staff only.
    // A patient renews by paying: POST /billing/subscriptions/:id/process-payment.
    if (requester?.role === 'PATIENT') {
      throw new BadRequestException(
        'Payment is required to renew this plan. Please pay for the plan to renew it.'
      );
    }

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
      subscription: updated,
    });
    await this.invalidateSubscriptionCaches(subscription.userId, id);

    return updated;
  }

  // ============ Invoices ============

  async createInvoice(data: CreateInvoiceDto) {
    const totalAmount = this.fromPaise(
      this.toPaise(data.amount) + this.toPaise(data.tax || 0) - this.toPaise(data.discount || 0)
    );
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const invoice = await this.createInvoiceRecordAtomically(data, totalAmount);
        const invoiceNumber = invoice.invoiceNumber;

        // Non-blocking: fire and forget all post-creation operations
        // These MUST NOT block the invoice creation response
        setImmediate(() => {
          const postCreationTasks: Promise<unknown>[] = [
            this.loggingService.log(
              LogType.SYSTEM,
              LogLevel.INFO,
              'Invoice created',
              'BillingService',
              { invoiceId: invoice.id, invoiceNumber }
            ),
            this.eventService.emit('billing.invoice.created', {
              invoiceId: invoice.id,
              invoice,
            }),
            this.invalidateUserInvoiceCaches(data.userId),
          ];

          if (this.queueService) {
            postCreationTasks.push(
              this.queueService.addJob(
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
                  priority: 5, // NORMAL priority
                  attempts: 3,
                }
              )
            );
          }

          void Promise.allSettled(postCreationTasks)
            .then(results => {
              const rejected = results.filter(result => result.status === 'rejected');
              if (rejected.length > 0) {
                void this.loggingService.log(
                  LogType.BUSINESS,
                  LogLevel.WARN,
                  'Invoice post-processing completed with failures',
                  'BillingService',
                  {
                    invoiceId: invoice.id,
                    invoiceNumber,
                    failedTasks: rejected.length,
                  }
                );
              }
            })
            .catch(() => {
              // This should never fire (Promise.allSettled never rejects),
              // but we guard it to prevent any unhandled rejection
              void this.loggingService.log(
                LogType.BUSINESS,
                LogLevel.ERROR,
                'Invoice post-processing promise chain failed',
                'BillingService',
                {
                  invoiceId: invoice.id,
                }
              );
            });
        });

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
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;

        // Allocate invoice number within transaction - uses advisory lock internally
        // to serialize concurrent requests and prevent duplicate invoice numbers
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
            status: data.status || InvoiceStatus.PENDING,
            dueDate: new Date(data.dueDate),
            billType: data.billType || 'OTHER',
            ...(data.subscriptionId && { subscriptionId: data.subscriptionId }),
            ...(data.description && { description: data.description }),
            ...(data.lineItems && { lineItems: data.lineItems }),
            ...(data.metadata && { metadata: data.metadata }),
            ...(data.patientId && { patientId: data.patientId }),
            ...(data.visitId && { visitId: data.visitId }),
            ...(data.prescriptionId && { prescriptionId: data.prescriptionId }),
            ...(data.appointmentId && { appointmentId: data.appointmentId }),
            ...(data.paidAt && { paidAt: new Date(data.paidAt) }),
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
    typedClient: PrismaTransactionClientWithDelegates
  ): Promise<string> {
    // Serialize invoice number allocation within the transaction using advisory lock.
    // This prevents race conditions when multiple invoices are created concurrently.
    // Using $executeRaw/$queryRaw template-tag form (not $unsafe variants) — the
    // SQL here contains no user-supplied values, but the safer form is the project standard.
    await typedClient.$executeRaw`SELECT pg_advisory_xact_lock(${2026032901})`;

    // Now safe to query - no other transaction can be allocating at the same time
    const rows = await typedClient.$queryRaw<Array<{ maxSequence: number | string | null }>>`
      SELECT COALESCE(
        MAX(CAST(SUBSTRING("invoiceNumber" FROM '([0-9]+)$') AS INTEGER)),
        0
      ) AS "maxSequence"
      FROM "Invoice"
      WHERE "invoiceNumber" ~ '^INV-[0-9]{4}-[0-9]+$'
    `;

    const maxSequenceRaw = rows?.[0]?.maxSequence ?? 0;
    const maxSequence = Number(maxSequenceRaw);
    const nextSequence = Number.isNaN(maxSequence) ? 1 : maxSequence + 1;

    // Update cache after commit (fire and forget, safe since lock guarantees uniqueness)
    void this.cacheService.set('invoice:counter', nextSequence.toString());

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

  private isPaymentAppointmentUniqueConstraint(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    const message = 'message' in error && typeof error.message === 'string' ? error.message : '';

    return (
      code === 'P2002' && (message.includes('appointmentId') || message.includes('"appointmentId"'))
    );
  }

  private async resolveUserClinicId(
    userId: string,
    clinicId?: string,
    role?: string
  ): Promise<string | undefined> {
    if (role && role !== 'PATIENT' && role !== 'SUPER_ADMIN') {
      if (clinicId) {
        return clinicId;
      }
      const user = await this.databaseService.findUserByIdSafe(userId);
      return user?.primaryClinicId ?? undefined;
    }
    return clinicId;
  }

  async getUserInvoices(
    userId: string,
    role?: string,
    requestingUserId?: string,
    clinicId?: string
  ) {
    if (role === 'PATIENT' && requestingUserId && requestingUserId !== userId) {
      throw new BadRequestException('You can only view your own invoices');
    }

    const resolvedClinicId = await this.resolveUserClinicId(userId, clinicId, role);
    const cacheKey = `user_invoices:${userId}:${resolvedClinicId || 'all'}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const whereClause: Record<string, unknown> = { userId };
        if (resolvedClinicId) {
          whereClause['clinicId'] = resolvedClinicId;
        }
        // Exclude VOID invoices (cancelled/expired appointments)
        whereClause['status'] = { not: InvoiceStatus.VOID };
        return await this.databaseService.findInvoicesSafe(whereClause);
      },
      {
        ttl: 900,
        tags: [`user_invoices:${userId}`],
        priority: 'normal',
      }
    );
  }

  /**
   * Pharmacy scope: PHARMACIST only ever sees pharmacy/prescription finance data of the clinic
   * (never appointment or subscription invoices/payments). Fail closed: a row with no pharmacy
   * marker is excluded.
   */
  private isPharmacyInvoice(invoice: object): boolean {
    const { billType, prescriptionId } = invoice as {
      billType?: unknown;
      prescriptionId?: unknown;
    };
    return billType === 'PHARMACY' || Boolean(prescriptionId);
  }

  async getClinicInvoices(clinicId: string, role?: string) {
    const pharmacyOnly = role === 'PHARMACIST';
    const cacheKey = pharmacyOnly
      ? `billing_invoices:clinic:${clinicId}:pharmacy`
      : `billing_invoices:clinic:${clinicId}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const allInvoices = await this.databaseService.findInvoicesSafe({ clinicId });
        const invoices = pharmacyOnly
          ? allInvoices.filter(invoice => this.isPharmacyInvoice(invoice))
          : allInvoices;
        const contacts = await this.lookupUserContacts(invoices.map(invoice => invoice.userId));
        return invoices.map(invoice => this.decorateClinicInvoice(invoice, contacts));
      },
      {
        ttl: 900,
        tags: ['billing_invoices', `clinic:${clinicId}`],
        priority: 'normal',
      }
    );
  }

  async getInvoice(id: string, requester?: BillingAccessContext) {
    const invoice = await this.databaseService.findInvoiceByIdSafe(id);

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    this.assertBillingEntityAccess(invoice, requester);
    return invoice;
  }

  /**
   * Generated invoice PDFs are named `invoice_<invoiceNumber>_<suffix>.pdf`. Downloading by file
   * name must pass the same ownership / clinic check as reading the invoice itself.
   */
  async assertInvoiceFileAccess(fileName: string, requester?: BillingAccessContext): Promise<void> {
    const baseName = String(fileName).split(/[\\/]/).pop() ?? '';
    const invoiceNumber = /^invoice_(.+)_[^_]+\.pdf$/.exec(baseName)?.[1];
    if (!invoiceNumber) {
      throw new NotFoundException('Invoice PDF not found');
    }
    const [invoice] = await this.databaseService.findInvoicesSafe({ invoiceNumber });
    if (!invoice) {
      throw new NotFoundException('Invoice PDF not found');
    }
    this.assertBillingEntityAccess(invoice, requester);
  }

  async updateInvoice(id: string, data: UpdateInvoiceDto, requester?: BillingAccessContext) {
    const existingInvoice = await this.getInvoice(id, requester);
    const updateData: UpdateInvoiceDto & { totalAmount?: number } = { ...data };

    if (data.amount !== undefined || data.tax !== undefined || data.discount !== undefined) {
      const amount = data.amount ?? existingInvoice.amount;
      const tax = data.tax ?? existingInvoice.tax ?? 0;
      const discount = data.discount ?? existingInvoice.discount ?? 0;
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

    await this.eventService.emit('billing.invoice.updated', { invoiceId: id, invoice });
    await this.invalidateUserInvoiceCaches(invoice.userId);

    return invoice;
  }

  async markInvoiceAsPaid(
    id: string,
    requester?: BillingAccessContext,
    options?: { skipWhatsApp?: boolean; settledByPaymentId?: string }
  ) {
    const existingInvoice = await this.getInvoice(id, requester);

    // Idempotent: an invoice that is already PAID keeps its original paidAt and does not emit a
    // second receipt (PDF regeneration + WhatsApp/email) when a payment callback is replayed.
    if (String(existingInvoice.status).toUpperCase() === String(InvoiceStatus.PAID)) {
      return existingInvoice;
    }

    const transition = await this.transitionInvoiceToPaid(
      existingInvoice as unknown as InvoiceRow,
      options
    );
    return transition.invoice;
  }

  /**
   * PENDING/VOID -> PAID as ONE conditional statement. Only the call whose statement matched
   * (`transitioned`) regenerates the PDF and emits the receipt, so two racing callers can never
   * both send one.
   */
  private async transitionInvoiceToPaid(
    existingInvoice: InvoiceRow,
    options?: { skipWhatsApp?: boolean; settledByPaymentId?: string }
  ): Promise<{ transitioned: boolean; invoice: unknown }> {
    const id = existingInvoice.id;
    const paidAt = new Date();
    const transitioned = await this.paymentStore.markInvoicePaid({
      invoice: existingInvoice,
      clinicId: existingInvoice.clinicId,
      paidAt,
      ...(options?.settledByPaymentId ? { settledByPaymentId: options.settledByPaymentId } : {}),
    });
    if (!transitioned) {
      return {
        transitioned: false,
        invoice: (await this.databaseService.findInvoiceByIdSafe(id)) ?? existingInvoice,
      };
    }

    // The conditional write bypassed the invoice read cache: drop it before the PDF is rebuilt.
    try {
      await this.databaseService.invalidateEntityCache('invoice', id, existingInvoice.clinicId);
    } catch {
      // Best effort: entries age out via their TTL.
    }
    const invoice = {
      ...existingInvoice,
      status: InvoiceStatus.PAID,
      paidAt,
      ...(options?.settledByPaymentId
        ? {
            metadata: {
              ...(this.asRecord(existingInvoice.metadata) ?? {}),
              settledByPaymentId: options.settledByPaymentId,
            },
          }
        : {}),
    };

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Invoice marked as paid',
      'BillingService',
      { invoiceId: id }
    );

    // Always regenerate the PDF after payment so the patient/WhatsApp copy
    // shows PAID status and payment details (not the stale unpaid draft).
    try {
      await this.generateInvoicePDF(id);
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to regenerate invoice PDF after payment',
        'BillingService',
        {
          invoiceId: id,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }

    await this.eventService.emit('billing.receipt.paid', {
      receiptId: id,
      invoice,
      skipWhatsApp: Boolean(options?.skipWhatsApp),
    });
    await this.invalidateUserInvoiceCaches(existingInvoice.userId);

    return { transitioned: true, invoice };
  }

  // ============ Bill History (OPD consultation + pharmacy invoices) ============

  /**
   * Reads `Clinic.settings.billingSettings` (a loosely-typed `Json?` column)
   * as the domain `ClinicSettings['billingSettings']` shape. Returns null
   * when the clinic has no settings configured yet (`resolveConsultationFee`
   * falls through to the "no fee configured" case in that scenario).
   */
  private async getClinicBillingSettings(
    clinicId: string
  ): Promise<ClinicSettings['billingSettings'] | null> {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      const clinic = (await typedClient.clinic.findUnique({
        where: { id: clinicId } as PrismaDelegateArgs,
        select: { settings: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as { settings?: unknown } | null;

      const settings = this.asRecord(clinic?.settings);
      const billingSettings = settings ? this.asRecord(settings['billingSettings']) : null;
      return billingSettings as ClinicSettings['billingSettings'] | null;
    });
  }

  /**
   * Resolves the consultation fee for a visit: an explicit `Doctor.consultationFee`
   * (for the visit's assigned doctor) takes priority over the clinic-wide
   * `billingSettings.opdConsultationFee` default. Returns null when neither is
   * configured, so callers can fall back to asking the user for an amount.
   */
  async resolveConsultationFee(clinicId: string, doctorId?: string | null): Promise<number | null> {
    if (doctorId) {
      const doctorFee = await this.databaseService.executeHealthcareRead(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        const doctor = (await typedClient.doctor.findUnique({
          where: { id: doctorId } as PrismaDelegateArgs,
          select: { consultationFee: true } as PrismaDelegateArgs,
        } as PrismaDelegateArgs)) as { consultationFee?: number | null } | null;
        return typeof doctor?.consultationFee === 'number' ? doctor.consultationFee : null;
      });

      if (typeof doctorFee === 'number' && doctorFee > 0) {
        return doctorFee;
      }
    }

    const billingSettings = await this.getClinicBillingSettings(clinicId);
    if (
      typeof billingSettings?.opdConsultationFee === 'number' &&
      billingSettings.opdConsultationFee > 0
    ) {
      return billingSettings.opdConsultationFee;
    }

    return null;
  }

  /**
   * Generic unique-constraint (P2002) detector for a named column, used by
   * the idempotent ensure* methods below to recover from a concurrent
   * duplicate create instead of failing the request.
   */
  private isUniqueConstraintOnField(error: unknown, field: string): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    const message = 'message' in error && typeof error.message === 'string' ? error.message : '';

    return code === 'P2002' && (message.includes(field) || message.includes(`"${field}"`));
  }

  private async findInvoiceByVisitId(
    visitId: string,
    clinicId: string,
    billType: BillType
  ): Promise<InvoiceRecord | null> {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return (await typedClient.invoice.findFirst({
        where: { visitId, clinicId, billType } as PrismaDelegateArgs,
        include: { payments: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as unknown as InvoiceRecord | null;
    });
  }

  private async findInvoiceByPrescriptionId(
    prescriptionId: string,
    clinicId?: string
  ): Promise<InvoiceRecord | null> {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return (await typedClient.invoice.findFirst({
        where: {
          prescriptionId,
          billType: 'PHARMACY',
          ...(clinicId ? { clinicId } : {}),
        } as PrismaDelegateArgs,
        include: { payments: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as unknown as InvoiceRecord | null;
    });
  }

  /**
   * Full invoice record (including the bill-history columns) by ID, scoped
   * to a clinic. Used by `recordInvoicePayment` instead of `getInvoice()`
   * because `InvoiceWithRelations` does not yet expose `billType`/`visitId`/
   * `prescriptionId` at the type level (see `InvoiceRecord` doc-comment).
   */
  private async getInvoiceRecord(
    invoiceId: string,
    clinicId?: string
  ): Promise<InvoiceRecord | null> {
    const invoice = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return (await typedClient.invoice.findUnique({
        where: { id: invoiceId } as PrismaDelegateArgs,
        include: { payments: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as unknown as InvoiceRecord | null;
    });

    if (!invoice) {
      return null;
    }
    if (clinicId && invoice.clinicId !== clinicId) {
      return null;
    }
    return invoice;
  }

  /**
   * Idempotent per visit on the `(visitId, CONSULTATION)` unique constraint:
   * a second call (e.g. a retried request) returns the existing invoice
   * instead of erroring. Reuses `createInvoice()` so invoice numbering, the
   * PDF-generation queue job, and the `billing.invoice.created` event all
   * stay consistent with every other invoice in the system.
   */
  async ensureVisitConsultationInvoice(
    visitId: string,
    clinicId: string,
    options: {
      amount?: number;
      discount?: number;
      waive?: boolean;
      actor?: { userId?: string; role?: string };
    } = {}
  ): Promise<InvoiceRecord> {
    const existing = await this.findInvoiceByVisitId(visitId, clinicId, 'CONSULTATION');
    if (existing) {
      return existing;
    }

    const visit = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        patientVisit: {
          findFirst: (args: PrismaDelegateArgs) => Promise<{
            id: string;
            opdNumber: string;
            patientId: string;
            doctorId: string | null;
            clinicId: string;
          } | null>;
        };
      };
      return await typedClient.patientVisit.findFirst({
        where: { id: visitId, clinicId } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });

    if (!visit) {
      throw new NotFoundException(`Visit ${visitId} not found`);
    }

    const patient = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return (await typedClient.patient.findUnique({
        where: { id: visit.patientId } as PrismaDelegateArgs,
        select: { userId: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as { userId?: string } | null;
    });

    if (!patient?.userId) {
      throw new BadRequestException(`Patient for visit ${visitId} has no linked user account`);
    }

    const waive = Boolean(options.waive);
    const discount = Math.max(0, Number(options.discount || 0));
    const resolvedAmount = waive
      ? 0
      : typeof options.amount === 'number' && options.amount >= 0
        ? options.amount
        : await this.resolveConsultationFee(clinicId, visit.doctorId);

    if (resolvedAmount === null) {
      throw new BadRequestException(
        'No consultation fee configured for this clinic/doctor. Provide an amount to bill.'
      );
    }

    const unitPrice = Number(resolvedAmount);
    const now = new Date();
    const lineItemDescription = `OPD consultation – ${visit.opdNumber}`;
    const lineItems = [
      {
        description: lineItemDescription,
        quantity: 1,
        unitPrice,
        amount: waive ? 0 : unitPrice,
        itemType: 'CONSULTATION',
        refId: visitId,
      },
    ];

    const createData: CreateInvoiceDto = {
      userId: patient.userId,
      clinicId,
      amount: waive ? 0 : unitPrice,
      tax: 0,
      discount: waive ? 0 : discount,
      dueDate: now.toISOString(),
      description: lineItemDescription,
      lineItems: lineItems as unknown as Record<string, unknown>,
      billType: 'CONSULTATION',
      patientId: visit.patientId,
      visitId,
      ...(waive
        ? {
            status: InvoiceStatus.PAID,
            paidAt: now.toISOString(),
            metadata: {
              waived: true,
              waivedBy: options.actor?.userId ?? null,
              skipWhatsApp: true,
            },
          }
        : {}),
    };

    try {
      return (await this.createInvoice(createData)) as unknown as InvoiceRecord;
    } catch (error) {
      if (this.isUniqueConstraintOnField(error, 'visitId')) {
        const retried = await this.findInvoiceByVisitId(visitId, clinicId, 'CONSULTATION');
        if (retried) {
          return retried;
        }
      }
      throw error;
    }
  }

  /**
   * Idempotent per prescription on the `(prescriptionId, PHARMACY)` unique
   * constraint. Line items mirror `PharmacyService.getPrescriptionTotal`
   * (quantity x Medicine.price per item).
   */
  async ensurePrescriptionInvoice(
    prescriptionId: string,
    clinicId: string,
    actor?: { userId?: string; role?: string }
  ): Promise<InvoiceRecord> {
    const existing = await this.findInvoiceByPrescriptionId(prescriptionId, clinicId);
    if (existing) {
      return existing;
    }

    const prescription = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return await typedClient.prescription.findUnique({
        where: { id: prescriptionId } as PrismaDelegateArgs,
        include: {
          items: { include: { medicine: true } },
          patient: { include: { user: { select: { id: true } } } },
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });

    const prescriptionRecord = prescription as {
      id: string;
      clinicId: string;
      patientId: string;
      visitId?: string | null;
      items?: Array<{
        id: string;
        quantity?: number | null;
        medicine?: { name?: string | null; price?: number | null } | null;
      }>;
      patient?: { user?: { id?: string | null } | null } | null;
    } | null;

    if (!prescriptionRecord) {
      throw new NotFoundException(`Prescription ${prescriptionId} not found`);
    }
    if (clinicId && prescriptionRecord.clinicId !== clinicId) {
      throw new BadRequestException('Prescription does not belong to this clinic');
    }

    const patientUserId = prescriptionRecord.patient?.user?.id;
    if (!patientUserId) {
      throw new BadRequestException('Prescription patient has no linked user account');
    }

    const lineItems = (prescriptionRecord.items || []).map(item => {
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.medicine?.price || 0);
      const amount = this.fromPaise(Math.round(quantity * this.toPaise(unitPrice)));
      return {
        description: item.medicine?.name
          ? `${item.medicine.name} x${quantity}`
          : `Medicine item x${quantity}`,
        quantity,
        unitPrice,
        amount,
        itemType: 'PHARMACY',
        refId: item.id,
      };
    });
    const amount = this.fromPaise(
      lineItems.reduce((sum, item) => sum + this.toPaise(item.amount), 0)
    );

    const createData: CreateInvoiceDto = {
      userId: patientUserId,
      clinicId,
      amount,
      tax: 0,
      discount: 0,
      dueDate: new Date().toISOString(),
      description: `Pharmacy bill for prescription ${prescriptionId}`,
      lineItems: lineItems as unknown as Record<string, unknown>,
      billType: 'PHARMACY',
      patientId: prescriptionRecord.patientId,
      prescriptionId,
      metadata: { createdByUserId: actor?.userId ?? null, createdByRole: actor?.role ?? null },
      ...(prescriptionRecord.visitId ? { visitId: prescriptionRecord.visitId } : {}),
    };

    try {
      return (await this.createInvoice(createData)) as unknown as InvoiceRecord;
    } catch (error) {
      if (this.isUniqueConstraintOnField(error, 'prescriptionId')) {
        const retried = await this.findInvoiceByPrescriptionId(prescriptionId, clinicId);
        if (retried) {
          return retried;
        }
      }
      throw error;
    }
  }

  /**
   * Read-only lookup used by PharmacyService to enrich a single prescription
   * with its invoice (if one exists yet) without creating one. Public
   * counterpart of the private `findInvoiceByPrescriptionId` used by
   * `ensurePrescriptionInvoice`'s idempotency check.
   */
  async findPrescriptionInvoice(
    prescriptionId: string,
    clinicId?: string
  ): Promise<InvoiceRecord | null> {
    return this.findInvoiceByPrescriptionId(prescriptionId, clinicId);
  }

  /**
   * Batched counterpart of `findPrescriptionInvoice` for list/queue views
   * (medicine desk queue, prescription lists) so enriching N prescriptions
   * costs one query instead of N.
   */
  async findPrescriptionInvoices(
    clinicId: string,
    prescriptionIds: string[]
  ): Promise<Map<string, InvoiceRecord>> {
    if (prescriptionIds.length === 0) {
      return new Map();
    }

    const invoices = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return (await typedClient.invoice.findMany({
        where: {
          clinicId,
          billType: 'PHARMACY',
          prescriptionId: { in: prescriptionIds },
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as unknown as InvoiceRecord[];
    });

    return new Map(
      invoices
        .filter(invoice => Boolean(invoice.prescriptionId))
        .map(invoice => [String(invoice.prescriptionId), invoice] as const)
    );
  }

  /**
   * Records a manual (cash/UPI/card/net-banking) payment against an invoice.
   * When completed payments now cover the full total, marks the invoice PAID
   * — suppressing the automatic WhatsApp receipt send unless the clinic has
   * opted in via `billingSettings.autoWhatsAppReceipts`. Also nudges the
   * medicine desk queue for PHARMACY invoices so a paid prescription flips to
   * dispensable without waiting for the next poll.
   */
  async recordInvoicePayment(
    invoiceId: string,
    clinicId: string,
    options: {
      method: PaymentMethod;
      amount?: number;
      transactionId?: string;
      note?: string;
      actor?: { userId?: string; role?: string };
    }
  ): Promise<{ invoice: InvoiceRecord; payment: PaymentWithRelations }> {
    const invoice = await this.getInvoiceRecord(invoiceId, clinicId);
    if (!invoice) {
      throw new NotFoundException(`Invoice ${invoiceId} not found`);
    }

    const paidSoFar = this.fromPaise(
      (invoice.payments || [])
        .filter(payment => String(payment.status).toUpperCase() === 'COMPLETED')
        .reduce((sum, payment) => sum + this.toPaise(Number(payment.amount || 0)), 0)
    );
    const balance = this.fromPaise(
      Math.max(0, this.toPaise(invoice.totalAmount) - this.toPaise(paidSoFar))
    );
    const amount =
      typeof options.amount === 'number' && options.amount > 0 ? options.amount : balance;

    if (amount <= 0) {
      throw new BadRequestException('Invoice is already fully paid');
    }

    const payment = await this.databaseService.createPaymentSafe({
      amount: Number(amount.toFixed(2)),
      clinicId,
      userId: invoice.userId,
      invoiceId,
      status: PaymentStatus.COMPLETED,
      method: options.method,
      ...(options.transactionId && { transactionId: options.transactionId }),
      description: `Payment collected for invoice ${invoice.invoiceNumber}`,
      metadata: {
        collectedBy: options.actor?.userId ?? null,
        collectedByRole: options.actor?.role ?? null,
        collectedAt: new Date().toISOString(),
        paymentFor: invoice.billType,
        ...(invoice.prescriptionId ? { prescriptionId: invoice.prescriptionId } : {}),
        ...(invoice.visitId ? { visitId: invoice.visitId } : {}),
        ...(options.note ? { note: options.note } : {}),
      },
    });

    await this.emitBillingPaymentStateEvents({
      paymentId: payment.id,
      clinicId,
      payment,
    });

    if (invoice.userId) {
      await this.invalidateUserPaymentCaches(invoice.userId);
    }

    let updatedInvoice: InvoiceRecord = invoice;
    const newPaidTotal = paidSoFar + amount;
    // Small epsilon guards against float rounding leaving the invoice
    // PENDING forever when paidSoFar + amount is e.g. 499.9999999999999.
    if (newPaidTotal + 0.005 >= invoice.totalAmount) {
      const billingSettings = await this.getClinicBillingSettings(clinicId);
      await this.markInvoiceAsPaid(invoiceId, undefined, {
        skipWhatsApp: !billingSettings?.autoWhatsAppReceipts,
      });
      updatedInvoice = (await this.getInvoiceRecord(invoiceId, clinicId)) ?? invoice;

      if (invoice.billType === 'PHARMACY') {
        await this.eventService.emit('pharmacy.medicine_desk.updated', {
          clinicId,
          paymentId: payment.id,
          prescriptionId: invoice.prescriptionId ?? null,
          action: 'PAYMENT_UPDATED',
          queueCategory: AppointmentQueueCategory.MEDICINE_DESK,
          paymentStatus: 'PAID',
          pendingAmount: 0,
          queueStatus: 'PENDING',
        });
      }
    }

    return { invoice: updatedInvoice, payment };
  }

  private deriveBillRowStatus(
    rawStatus: string,
    paidAmount: number,
    total: number
  ): 'PENDING' | 'PARTIAL' | 'PAID' | 'VOID' | 'REFUNDED' {
    const normalized = rawStatus.toUpperCase();
    if (normalized === 'VOID') {
      return 'VOID';
    }
    if (normalized === 'PAID') {
      return 'PAID';
    }
    if (paidAmount <= 0) {
      return 'PENDING';
    }
    if (paidAmount >= total) {
      return 'PAID';
    }
    return 'PARTIAL';
  }

  private inferLegacyPaymentBillType(metadata: unknown): BillType {
    const paymentFor = this.asSafeString(this.asRecord(metadata)?.['paymentFor']).toUpperCase();
    if (paymentFor.includes('PRESCRIPTION')) {
      return 'PHARMACY';
    }
    if (paymentFor.includes('CONSULTATION')) {
      return 'CONSULTATION';
    }
    return 'OTHER';
  }

  /**
   * Per-patient Bill History: every Invoice for this patient (consultation,
   * pharmacy, and any other bill type) merged with legacy orphan Payments
   * (no invoiceId — pre-dates the bill-history columns, e.g. old prescription
   * cash payments) so nothing collected before this feature disappears from
   * the tab. Newest first, paginated after merging since the two sources
   * can't be paginated independently.
   */
  async getPatientBillHistory(
    patientId: string,
    clinicId: string,
    filters: {
      type?: string;
      status?: string;
      from?: string;
      to?: string;
      limit?: number;
      offset?: number;
    } = {},
    actor?: { userId?: string; role?: string }
  ): Promise<PatientBillHistory> {
    const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
    const offset = Math.max(filters.offset ?? 0, 0);

    const patient = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return (await typedClient.patient.findUnique({
        where: { id: patientId } as PrismaDelegateArgs,
        select: { id: true, userId: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as { id: string; userId: string } | null;
    });

    if (!patient) {
      throw new NotFoundException(`Patient ${patientId} not found`);
    }

    if (actor?.role === 'PATIENT' && actor.userId && actor.userId !== patient.userId) {
      throw new ForbiddenException('You can only view your own bill history');
    }

    const bundle = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        patientVisit: {
          findMany: (args: PrismaDelegateArgs) => Promise<Array<{ id: string; opdNumber: string }>>;
        };
      };

      const invoiceWhere: Record<string, unknown> = {
        clinicId,
        OR: [{ patientId }, { userId: patient.userId }],
      };
      if (filters.from || filters.to) {
        invoiceWhere['createdAt'] = {
          ...(filters.from ? { gte: new Date(filters.from) } : {}),
          ...(filters.to ? { lte: new Date(filters.to) } : {}),
        };
      }

      const invoices = (await typedClient.invoice.findMany({
        where: invoiceWhere as PrismaDelegateArgs,
        include: { payments: true } as PrismaDelegateArgs,
        orderBy: { createdAt: 'desc' } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as unknown as InvoiceRecord[];

      const orphanPayments = (await typedClient.payment.findMany({
        where: {
          clinicId,
          userId: patient.userId,
          invoiceId: null,
        } as PrismaDelegateArgs,
        orderBy: { createdAt: 'desc' } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as unknown as Array<{
        id: string;
        amount: number;
        method: string | null;
        status: string;
        transactionId: string | null;
        description: string | null;
        metadata: unknown;
        createdAt: Date;
      }>;

      const visitIds = Array.from(
        new Set(invoices.map(invoice => invoice.visitId).filter((id): id is string => Boolean(id)))
      );
      const visits = visitIds.length
        ? await typedClient.patientVisit.findMany({
            where: { id: { in: visitIds } } as PrismaDelegateArgs,
            select: { id: true, opdNumber: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs)
        : [];

      return { invoices, orphanPayments, visits };
    });

    const opdByVisitId = new Map(bundle.visits.map(visit => [visit.id, visit.opdNumber]));

    const invoiceRows: PatientBillRow[] = bundle.invoices.map(invoice => {
      const payments = (invoice.payments || []).map(payment => ({
        id: payment.id,
        amount: Number(payment.amount || 0),
        method: payment.method ?? null,
        status: String(payment.status),
        transactionId: payment.transactionId ?? null,
        createdAt: new Date(payment.createdAt).toISOString(),
      }));
      const paidAmount = this.fromPaise(
        payments
          .filter(payment => payment.status.toUpperCase() === 'COMPLETED')
          .reduce((sum, payment) => sum + this.toPaise(payment.amount), 0)
      );
      const total = Number(invoice.totalAmount || 0);
      const balance = this.fromPaise(Math.max(0, this.toPaise(total) - this.toPaise(paidAmount)));

      return {
        id: invoice.id,
        source: 'INVOICE',
        billType: invoice.billType || 'OTHER',
        invoiceNumber: invoice.invoiceNumber,
        date: new Date(invoice.createdAt).toISOString(),
        description: invoice.description ?? null,
        visitId: invoice.visitId ?? null,
        opdNumber: invoice.visitId ? (opdByVisitId.get(invoice.visitId) ?? null) : null,
        prescriptionId: invoice.prescriptionId ?? null,
        appointmentId: invoice.appointmentId ?? null,
        subtotal: Number(invoice.amount || 0),
        tax: Number(invoice.tax || 0),
        discount: Number(invoice.discount || 0),
        total,
        paidAmount,
        balance,
        status: this.deriveBillRowStatus(String(invoice.status), paidAmount, total),
        payments,
        downloadable: true,
      };
    });

    const paymentRows: PatientBillRow[] = bundle.orphanPayments.map(payment => {
      const isCompleted = String(payment.status).toUpperCase() === 'COMPLETED';
      const amount = Number(payment.amount || 0);

      return {
        id: payment.id,
        source: 'PAYMENT',
        billType: this.inferLegacyPaymentBillType(payment.metadata),
        invoiceNumber: null,
        date: new Date(payment.createdAt).toISOString(),
        description: payment.description ?? null,
        visitId: null,
        opdNumber: null,
        prescriptionId:
          this.asSafeString(this.asRecord(payment.metadata)?.['prescriptionId']) || null,
        appointmentId: null,
        subtotal: amount,
        tax: 0,
        discount: 0,
        total: amount,
        paidAmount: isCompleted ? amount : 0,
        balance: isCompleted ? 0 : amount,
        status: isCompleted ? 'PAID' : 'PENDING',
        payments: [
          {
            id: payment.id,
            amount,
            method: payment.method ?? null,
            status: String(payment.status),
            transactionId: payment.transactionId ?? null,
            createdAt: new Date(payment.createdAt).toISOString(),
          },
        ],
        downloadable: false,
      };
    });

    let rows = [...invoiceRows, ...paymentRows].sort(
      (left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()
    );

    if (filters.type) {
      rows = rows.filter(row => row.billType === filters.type);
    }
    if (filters.status) {
      rows = rows.filter(row => row.status === filters.status);
    }

    const total = rows.length;
    const paged = rows.slice(offset, offset + limit);

    const summaryPaise = rows.reduce(
      (accumulator, row) => {
        accumulator.totalBilled += this.toPaise(row.total);
        accumulator.totalPaid += this.toPaise(row.paidAmount);
        accumulator.outstanding += row.status === 'VOID' ? 0 : this.toPaise(row.balance);
        return accumulator;
      },
      { totalBilled: 0, totalPaid: 0, outstanding: 0 }
    );

    return {
      rows: paged,
      total,
      summary: {
        totalBilled: this.fromPaise(summaryPaise.totalBilled),
        totalPaid: this.fromPaise(summaryPaise.totalPaid),
        outstanding: this.fromPaise(summaryPaise.outstanding),
      },
    };
  }

  // ============ Payments ============

  /**
   * A payment created through the API (staff / finance) must point at entities of its own clinic
   * and, when it names a user, at that entity's user. Without this a caller-chosen invoice /
   * plan id would let one clinic record money against another clinic's billing records.
   */
  private async assertPaymentTargetsBelongToClinic(data: CreatePaymentDto): Promise<void> {
    if (data.invoiceId) {
      const invoice = await this.databaseService.findInvoiceByIdSafe(data.invoiceId);
      if (!invoice || invoice.clinicId !== data.clinicId) {
        throw new NotFoundException('Invoice not found');
      }
      if (data.userId && invoice.userId !== data.userId) {
        throw new BadRequestException('Payment user does not match the invoice user');
      }
    }
    if (data.subscriptionId) {
      const subscription = await this.databaseService.findSubscriptionByIdSafe(data.subscriptionId);
      if (!subscription || subscription.clinicId !== data.clinicId) {
        throw new NotFoundException('Subscription not found');
      }
      if (data.userId && subscription.userId !== data.userId) {
        throw new BadRequestException('Payment user does not match the subscription user');
      }
    }
    if (data.appointmentId) {
      const appointment = await this.databaseService.findAppointmentByIdSafe(data.appointmentId);
      if (!appointment || appointment.clinicId !== data.clinicId) {
        throw new NotFoundException('Appointment not found');
      }
    }
  }

  /**
   * The requester is passed by the API layer only: internal callers (payment intents the service
   * builds itself) are trusted and skip the target ownership validation.
   */
  async createPayment(data: CreatePaymentDto, requester?: BillingAccessContext) {
    if (requester) {
      this.assertBillingEntityAccess({ clinicId: data.clinicId }, requester);
      await this.assertPaymentTargetsBelongToClinic(data);
    }

    if (data.appointmentId) {
      const recovered = await this.recoverFromDuplicatePayment(data);
      if (recovered) {
        return recovered;
      }
    }

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
        clinicId: payment.clinicId,
        ...(payment.appointmentId ? { appointmentId: payment.appointmentId } : {}),
        payment,
      });
      await this.eventService.emit('payment.pending', {
        paymentId: payment.id,
        clinicId: payment.clinicId,
        ...(payment.appointmentId ? { appointmentId: payment.appointmentId } : {}),
        payment,
      });

      if (data.userId) {
        await this.invalidateUserPaymentCaches(data.userId);
      }

      return payment;
    } catch (error) {
      if (data.appointmentId && this.isPaymentAppointmentUniqueConstraint(error)) {
        const recovered = await this.recoverFromDuplicatePayment(data);
        if (recovered) {
          return recovered;
        }
      }

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

  private async recoverFromDuplicatePayment(
    data: CreatePaymentDto
  ): Promise<Awaited<ReturnType<typeof this.databaseService.createPaymentSafe>> | null> {
    const advisoryLockKey = this.computeAppointmentLockKey(data.appointmentId!);
    const existingPayment = await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        await typedClient.$executeRaw`SELECT pg_advisory_xact_lock(${advisoryLockKey})`;

        const payments = await this.databaseService.findPaymentsSafe({
          clinicId: data.clinicId,
          ...(data.appointmentId && { appointmentId: data.appointmentId }),
        });
        const sorted = payments.sort(
          (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
        );
        return sorted[0] || null;
      },
      {
        userId: data.userId || 'SYSTEM',
        userRole: 'SYSTEM',
        clinicId: data.clinicId,
        operation: 'RECOVER_DUPLICATE_PAYMENT',
        resourceType: 'PAYMENT',
        resourceId: data.appointmentId!,
        timestamp: new Date(),
      }
    );

    if (!existingPayment) {
      return null;
    }

    const updatedPayment = await this.databaseService.updatePaymentSafe(existingPayment.id, {
      amount: data.amount,
      status: PaymentStatus.PENDING,
      ...(data.userId ? { userId: data.userId } : {}),
      ...(data.invoiceId ? { invoiceId: data.invoiceId } : {}),
      ...(data.subscriptionId ? { subscriptionId: data.subscriptionId } : {}),
      ...(data.method ? { method: data.method } : {}),
      ...(data.transactionId ? { transactionId: data.transactionId } : {}),
      ...(data.description ? { description: data.description } : {}),
      ...(data.metadata ? { metadata: data.metadata } : {}),
    });

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.WARN,
      existingPayment.createdAt.getTime() > new Date().getTime() - 60000
        ? 'Recovered from duplicate appointment payment create by reusing existing payment'
        : 'Reused existing appointment payment',
      'BillingService',
      {
        paymentId: updatedPayment.id,
        appointmentId: data.appointmentId,
      }
    );

    await this.emitBillingPaymentStateEvents({
      paymentId: updatedPayment.id,
      clinicId: updatedPayment.clinicId,
      ...(updatedPayment.appointmentId
        ? {
            appointmentId: updatedPayment.appointmentId,
            status: 'pending',
            payment: updatedPayment,
          }
        : {}),
    });

    if (data.userId) {
      await this.invalidateUserPaymentCaches(data.userId);
    }

    return updatedPayment;
  }

  private computeAppointmentLockKey(appointmentId: string): number {
    let hash = 0;
    for (let index = 0; index < appointmentId.length; index++) {
      const char = appointmentId.charCodeAt(index);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return Math.abs(hash);
  }

  async updatePayment(
    id: string,
    data: UpdatePaymentDto,
    requester?: BillingAccessContext,
    options: { skipInvoiceSettlement?: boolean } = {}
  ) {
    const existingPayment = await this.getPayment(id, requester);
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

    await this.emitBillingPaymentUpdatedEvent(id, payment);

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
            : AppointmentQueueCategory.MEDICINE_DESK,
        paymentStatus: 'PAID',
        pendingAmount: 0,
        queueStatus: 'PENDING',
      });
    }

    // Invalidate cache if payment has userId
    if (existingPayment.userId) {
      await this.invalidateUserPaymentCaches(existingPayment.userId);
    }

    // Auto-update the invoice if the payment is linked to one: PAID only once the COMPLETED
    // payments recorded against it cover its total (the callback path settles it itself).
    if (
      'invoiceId' in payment &&
      payment.invoiceId &&
      data.status === PaymentStatus.COMPLETED &&
      !options.skipInvoiceSettlement
    ) {
      await this.settleInvoiceForPayment(payment as unknown as PaymentRow, payment.clinicId);
    }

    return payment;
  }

  async getUserPayments(
    userId: string,
    role?: string,
    requestingUserId?: string,
    clinicId?: string
  ) {
    if (role === 'PATIENT' && requestingUserId && requestingUserId !== userId) {
      throw new BadRequestException('You can only view your own payments');
    }

    const resolvedClinicId = await this.resolveUserClinicId(userId, clinicId, role);
    const cacheKey = `user_payments:${userId}:${resolvedClinicId || 'all'}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const allPayments = await this.databaseService.findPaymentsSafe({
          ...(resolvedClinicId ? { clinicId: resolvedClinicId } : {}),
        });
        // Filter to this user's payments and exclude payments from
        // expired/cancelled/no-show appointments. Also enrich with
        // patientName and orderId from metadata.
        //
        // Non-appointment payments (consultation/pharmacy invoice payments,
        // and legacy prescription cash/online payments that never had an
        // appointment to begin with) used to be dropped unconditionally here
        // because of the `if (!apt) return false` short-circuit below — this
        // silently hid every prescription/consultation payment from the
        // patient's payment history. They are now included whenever the
        // payment's own `userId` matches the requested user.
        return allPayments
          .filter(p => {
            const apt = p.appointment;
            if (apt) {
              const aptPatient = (apt as unknown as { patient?: { userId?: string } }).patient;
              if (aptPatient?.userId !== userId) return false;
              const aptStatus = String(apt.status || '').toUpperCase();
              if (!['EXPIRED', 'CANCELLED', 'NO_SHOW'].includes(aptStatus)) return true;
              // A cancelled visit's payment stays visible once money came back, so the
              // patient can see the refund.
              return (
                String(p.status || '').toUpperCase() === String(PaymentStatus.REFUNDED) ||
                Number(p.refundAmount ?? 0) > 0
              );
            }
            return p.userId === userId;
          })
          .map(p => {
            const metadata = this.asRecord(p.metadata);
            const patientName =
              (p.appointment as unknown as { patient?: { user?: { name?: string } } })?.patient
                ?.user?.name || 'Unknown';
            return {
              ...p,
              patientName,
              orderId:
                this.asSafeString(metadata?.['orderId']) ||
                this.asSafeString(metadata?.['paymentIntentId']) ||
                p.id,
            };
          });
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
    },
    role?: string
  ) {
    const whereClause: Record<string, unknown> = { clinicId };
    if (filters?.status) {
      whereClause['status'] = filters.status;
    }

    const payments = await this.databaseService.findPaymentsSafe(whereClause);
    const pharmacyOnly = role === 'PHARMACIST';

    const filtered = payments.filter(payment => {
      if (
        pharmacyOnly &&
        (payment.appointmentId ||
          payment.subscriptionId ||
          !payment.invoice ||
          !this.isPharmacyInvoice(payment.invoice))
      ) {
        return false;
      }
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

    // Same enrichment as getUserPayments(): patient contact (appointment patient, else the
    // paying user / invoice user) and the gateway order id for the ledger rows.
    const contacts = await this.lookupUserContacts(
      filtered.map(payment => payment.userId || payment.invoice?.userId)
    );
    return filtered.map(payment => {
      const metadata = this.asRecord(payment.metadata);
      const appointmentPatient = (
        payment.appointment as unknown as { patient?: { user?: { name?: string | null } } } | null
      )?.patient?.user?.name;
      const contact = contacts.get(payment.userId || payment.invoice?.userId || '');
      return {
        ...payment,
        patientName: appointmentPatient || contact?.name || 'Unknown',
        orderId:
          this.asSafeString(metadata?.['orderId']) ||
          this.asSafeString(metadata?.['paymentIntentId']) ||
          payment.id,
      };
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

  async getPayment(id: string, requester?: BillingAccessContext) {
    const payment = await this.databaseService.findPaymentByIdSafe(id);

    if (!payment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }

    this.assertBillingEntityAccess(
      {
        clinicId: payment.clinicId,
        userId: payment.userId ?? payment.invoice?.userId ?? null,
      },
      requester
    );
    return payment;
  }

  // ============ Helper Methods ============

  private calculatePeriodEnd(start: Date, interval: string, intervalCount: number): Date {
    return calculatePeriodEnd(start, interval, intervalCount);
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

  /**
   * True when the invoice has a payment attempt that is still open (PENDING) or already settled
   * (COMPLETED/REFUNDED). Only FAILED/CANCELLED/EXPIRED attempts leave an invoice safe to reuse.
   */
  private invoiceHasLivePayment(invoice: {
    payments?: ReadonlyArray<{ status?: string | null }> | null;
  }): boolean {
    const deadStatuses = new Set<string>([
      String(PaymentStatus.FAILED),
      String(PaymentStatus.CANCELLED),
      String(PaymentStatus.EXPIRED),
    ]);
    return (invoice.payments ?? []).some(
      payment => !deadStatuses.has(String(payment.status ?? '').toUpperCase())
    );
  }

  private getDefaultAppointmentPrice(appointmentType: string): number {
    const prices: Record<string, number> = {
      IN_PERSON: 1251,
      VIDEO_CALL: 1251,
      HOME_VISIT: 1500,
    };
    return prices[appointmentType] || 1251;
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

    const cachedSubscription = await this.databaseService.findSubscriptionByIdSafe(subscriptionId);

    if (!cachedSubscription) {
      throw new NotFoundException('Subscription not found');
    }

    if (requester?.clinicId && cachedSubscription.clinicId !== requester.clinicId) {
      throw new BadRequestException('Subscription does not belong to current clinic');
    }

    if (
      requester?.role === 'PATIENT' &&
      requester.userId &&
      cachedSubscription.userId !== requester.userId
    ) {
      throw new BadRequestException('Patients can only use their own subscription');
    }

    // The appointment must be the subscription holder's own, in the subscription's clinic:
    // otherwise any patient could attach somebody else's appointment to their plan.
    const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);
    if (!appointment || appointment.clinicId !== cachedSubscription.clinicId) {
      throw new NotFoundException('Appointment not found');
    }
    const appointmentUserId = await this.resolveAppointmentBillingUserId(appointment);
    if (!appointmentUserId || appointmentUserId !== cachedSubscription.userId) {
      throw new ForbiddenException('This appointment does not belong to the subscription holder');
    }

    // Fresh row for the quota decision; the link + quota change below is one atomic transaction
    // (compare-and-set on `subscriptionId IS NULL`, conditional `appointmentsRemaining > 0`).
    const subscription =
      (await this.subscriptionStore.readSubscription(
        subscriptionId,
        cachedSubscription.clinicId
      )) ?? null;
    if (!subscription) {
      throw new NotFoundException('Subscription not found');
    }
    const outcome = await this.subscriptionStore.bookAppointment({ subscription, appointmentId });
    if (outcome === 'linked-elsewhere') {
      throw new BadRequestException('Appointment is already covered by a subscription');
    }
    if (outcome === 'quota-exhausted') {
      throw new BadRequestException('Appointment quota exceeded for this period');
    }
    if (outcome === 'already-linked') {
      return; // idempotent: nothing was charged to the quota twice
    }

    try {
      await this.databaseService.invalidateEntityCache(
        'subscription',
        subscriptionId,
        subscription.clinicId
      );
    } catch {
      // Best effort: entries age out via their TTL.
    }
    void Promise.allSettled([
      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Appointment booked with subscription',
        'BillingService',
        { subscriptionId, appointmentId }
      ),
      this.eventService.emit('billing.appointment.booked', {
        subscriptionId,
        appointmentId,
      }),
      this.invalidateSubscriptionCaches(subscription.userId, subscriptionId),
    ]);
  }

  // ============ Payment Processing ============

  /**
   * Process subscription payment (monthly for in-person appointments)
   * Creates invoice and payment intent for subscription renewal
   */
  async processSubscriptionPayment(
    subscriptionId: string,
    provider?: PaymentProvider,
    requester?: BillingAccessContext
  ): Promise<{ invoice: unknown; paymentIntent: PaymentResult }> {
    const subscription = await this.getSubscription(subscriptionId, requester);

    if (!subscription.plan) {
      throw new BadRequestException('Subscription plan not found');
    }

    const subscriptionAmount = this.roundToTwo(subscription.plan.amount);
    const subscriptionTax = this.calculateGstAmount(subscriptionAmount);

    // A checkout that never produced a payment attempt leaves an unpaid invoice behind. Reuse it
    // (same plan price only) instead of adding another PENDING invoice on every attempt.
    // An invoice that already carries a live payment (open PENDING attempt - the customer may
    // still be paying at the gateway - or a settled one) is NEVER reused: a second gateway order
    // against it could be paid as well and charge the customer twice for one invoice.
    const expectedSubscriptionTotal = this.roundToTwo(subscriptionAmount + subscriptionTax);
    const pendingSubscriptionInvoices = await this.databaseService.findInvoicesSafe({
      subscriptionId: subscription.id,
      status: InvoiceStatus.PENDING,
    });
    const reusableInvoice =
      pendingSubscriptionInvoices
        .filter(
          pending =>
            pending.userId === subscription.userId &&
            pending.clinicId === subscription.clinicId &&
            Math.abs(this.getInvoiceTotalAmount(pending, 0) - expectedSubscriptionTotal) < 0.005 &&
            !this.invoiceHasLivePayment(pending)
        )
        .sort(
          (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
        )[0] ?? null;

    // Create invoice for subscription renewal
    const invoice =
      reusableInvoice ??
      (await this.createInvoice({
        userId: subscription.userId,
        clinicId: subscription.clinicId,
        subscriptionId: subscription.id,
        amount: subscriptionAmount,
        tax: subscriptionTax,
        discount: 0,
        dueDate: new Date(subscription.currentPeriodEnd).toISOString(),
        description: `Subscription renewal for ${subscription.plan.name}`,
        lineItems: {
          items: [
            {
              description: subscription.plan.name,
              amount: subscriptionAmount,
              quantity: 1,
            },
          ],
        },
        metadata: {
          subscriptionId: subscription.id,
          planId: subscription.planId,
          gstRatePercent: this.getGstRatePercent(),
          periodStart: subscription.currentPeriodStart.toISOString(),
          periodEnd: subscription.currentPeriodEnd.toISOString(),
        },
      }));
    // Every attempt still opens its own gateway order, as before: a reused invoice gets a
    // new order id because some gateways reject a repeated order id.
    const gatewayOrderId = this.buildGatewayOrderId(
      invoice.invoiceNumber,
      reusableInvoice ? Date.now().toString(36) : invoice.id
    );

    // Get user details for payment
    const user = await this.databaseService.findUserByIdSafe(subscription.userId);

    // Create payment intent via payment service
    // SECURITY: Use ConfigService instead of hardcoded URL
    const baseUrl = this.getResolvedBackendBaseUrl();
    if (!baseUrl) {
      throw new Error('API URL is not configured in application config');
    }
    const subscriptionTotalAmount = this.getInvoiceTotalAmount(invoice, subscriptionAmount);
    const paymentIntentOptions: PaymentIntentOptions = {
      amount: Math.round(subscriptionTotalAmount * 100),
      currency: subscription.plan.currency || 'INR',
      orderId: gatewayOrderId,
      customerId: subscription.userId,
      ...(user?.email && { customerEmail: user.email }),
      ...(user?.phone && { customerPhone: user.phone }),
      ...(user?.name && { customerName: user.name }),
      description: `Subscription payment for ${subscription.plan.name}`,
      isSubscription: true,
      subscriptionId: subscription.id,
      subscriptionInterval: subscription.plan.interval.toLowerCase() as
        'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly',
      clinicId: subscription.clinicId,
      metadata: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        subscriptionId: subscription.id,
        planId: subscription.planId,
        subtotal: subscriptionAmount,
        tax: subscriptionTax,
        totalAmount: subscriptionTotalAmount,
        gstRatePercent: this.getGstRatePercent(),
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
    // Extract payment intent details with proper type checking
    const paymentId = paymentIntentResult.paymentId || '';
    const orderId = paymentIntentResult.orderId || '';
    const providerName = paymentIntentResult.provider || '';
    const providerResponse = this.asRecord(paymentIntentResult.providerResponse) || {};
    const gatewayRedirectUrl =
      this.asSafeString(paymentIntentResult.metadata?.['redirectUrl']) ||
      this.asSafeString(providerResponse['redirectUrl']) ||
      this.asSafeString(providerResponse['redirect_url']);
    const redirectUrl = this.buildPaymentCallbackUrl(
      subscription.clinicId,
      orderId || gatewayOrderId,
      provider,
      undefined,
      paymentId || undefined
    );
    const handoff = await this.createPaymentHandoffDetails({
      clinicId: subscription.clinicId,
      orderId: orderId || gatewayOrderId,
      callbackUrl: redirectUrl,
      ...(paymentId ? { paymentId } : {}),
      ...(paymentIntentResult.provider
        ? { provider: paymentIntentResult.provider as PaymentProvider }
        : {}),
    });
    const paymentIntentWithHandoff = {
      ...paymentIntentResult,
      handoffToken: handoff.token,
      handoffCallbackUrl: handoff.callbackUrl,
      callbackUrl: handoff.callbackUrl,
    } as PaymentResult & Record<string, unknown>;
    paymentIntentResult.metadata = {
      ...(this.asRecord(paymentIntentResult.metadata) || {}),
      clinicId: subscription.clinicId,
      invoiceId: invoice.id,
      subscriptionId: subscription.id,
      gatewayRedirectUrl,
      handoffToken: handoff.token,
      handoffCallbackUrl: handoff.callbackUrl,
      callbackUrl: handoff.callbackUrl,
      redirectUrl: handoff.callbackUrl,
    };

    // Create payment record
    const payment = await this.createPayment({
      amount: subscriptionTotalAmount,
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
        subtotal: subscriptionAmount,
        tax: subscriptionTax,
        totalAmount: subscriptionTotalAmount,
        gstRatePercent: this.getGstRatePercent(),
        handoffToken: handoff.token,
        handoffCallbackUrl: handoff.callbackUrl,
        redirectUrl: handoff.callbackUrl,
      },
    });

    void Promise.allSettled([
      this.loggingService.log(
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
      ),
    ]);

    return {
      invoice,
      paymentIntent: paymentIntentWithHandoff,
    };
  }

  /**
   * Process per-appointment payment (VIDEO_CALL only).
   * IN_PERSON appointments require subscription - use bookAppointmentWithSubscription.
   */
  async processAppointmentPayment(
    appointmentId: string,
    appointmentType: 'VIDEO_CALL' | 'IN_PERSON' | 'HOME_VISIT',
    provider?: PaymentProvider,
    requester?: BillingAccessContext
  ): Promise<{ invoice: unknown; paymentIntent: PaymentResult }> {
    if (appointmentType !== 'VIDEO_CALL') {
      throw new BadRequestException('Only VIDEO_CALL appointments require per-appointment payment');
    }

    const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    if (
      [
        AppointmentStatus.CANCELLED,
        AppointmentStatus.EXPIRED,
        AppointmentStatus.COMPLETED,
      ].includes(appointment.status as AppointmentStatus)
    ) {
      throw new BadRequestException(
        'This appointment is no longer payable. Please book a new appointment.'
      );
    }

    const paymentExpiresAt = (appointment as { paymentExpiresAt?: Date | string | null })
      .paymentExpiresAt;
    const expiresAt =
      paymentExpiresAt instanceof Date
        ? paymentExpiresAt.getTime()
        : typeof paymentExpiresAt === 'string'
          ? new Date(paymentExpiresAt).getTime()
          : null;
    if (expiresAt && expiresAt <= Date.now()) {
      throw new BadRequestException(
        'The payment window for this appointment has expired. Please book a new appointment.'
      );
    }

    const billingUserId = await this.resolveAppointmentBillingUserId(appointment);

    this.assertBillingEntityAccess(
      { clinicId: appointment.clinicId, userId: billingUserId },
      requester
    );

    if (String(appointment.type) !== appointmentType) {
      throw new BadRequestException(
        `Appointment type mismatch. Expected ${appointmentType}, got ${appointment.type}`
      );
    }

    // Reject payment for appointments whose time slot has already passed.
    // The 3-hour payment/slot confirmation cron cancels these, but a user
    // could still attempt a retry via the UI; we must refuse at the
    // payment-intent layer so the gateway is not invoked for a dead slot.
    // Allow a small grace window (5 minutes) past `endTime` for late payment
    // attempts only if the appointment is still CONFIRMED/SCHEDULED.
    const now = new Date();
    const appointmentEndTime = (appointment as { endTime?: Date | null }).endTime ?? null;
    if (appointmentEndTime && appointmentEndTime instanceof Date) {
      const graceMs = 5 * 60 * 1000;
      if (
        now.getTime() > appointmentEndTime.getTime() + graceMs &&
        String(appointment.status) !== String('CONFIRMED')
      ) {
        throw new BadRequestException(
          'This appointment time slot has already passed. Please book a new appointment.'
        );
      }
    }

    const serviceMetadata = this.resolveVideoConsultationService(
      appointment.treatmentType as TreatmentType | string | null
    );
    const amount = serviceMetadata.videoConsultationFee as number;
    const existingAppointmentPayments = await this.databaseService.findPaymentsSafe({
      appointmentId: appointment.id,
      clinicId: appointment.clinicId,
    });
    const existingPayment =
      existingAppointmentPayments.sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
      )[0] || null;

    // Phone is guaranteed only when the PATIENT pays for their own appointment:
    // BillingController carries @RequiresProfileCompletion(), and ProfileCompletionGuard
    // demands a verified phone for the PATIENT role. It is NOT guaranteed here, because
    // this endpoint is also open to SUPER_ADMIN / CLINIC_ADMIN / FINANCE_BILLING, and
    // those roles are in STAFF_ROLES, which bypass that guard entirely. In that case the
    // phone below belongs to the patient being billed, who may never have completed
    // profile completion themselves (staff-created or legacy patient records).
    const user = billingUserId ? await this.databaseService.findUserByIdSafe(billingUserId) : null;

    // NOTE: there is no secondary source to fall back to — Patient has no phone column;
    // the number lives only on User. A phone is deliberately NOT substituted from the
    // requester or the clinic, since that would write someone else's contact details into
    // the patient's payment record. Providers that require a phone are skipped instead
    // (see PaymentService.createPaymentIntent).
    const customerPhone = user?.phone?.trim() || undefined;

    if (!customerPhone) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.WARN,
        'No phone number on file for the patient being billed; phone-dependent payment providers will be skipped',
        'BillingService.processAppointmentPayment',
        {
          appointmentId: appointment.id,
          clinicId: appointment.clinicId,
          billingUserId,
          requesterUserId: requester?.userId,
          requesterRole: requester?.role,
        }
      );
    }

    if (existingPayment && String(existingPayment.status) === String(PaymentStatus.COMPLETED)) {
      throw new BadRequestException('Payment is already completed for this appointment');
    }

    const existingPaymentMetadata = existingPayment
      ? this.asRecord(existingPayment.metadata)
      : null;
    const existingGatewayOrderId =
      this.asSafeString(existingPaymentMetadata?.['orderId']) ||
      this.asSafeString(existingPaymentMetadata?.['paymentIntentId']) ||
      this.asSafeString(existingPaymentMetadata?.['paymentSessionId']);
    const existingInvoice = existingPayment?.invoiceId
      ? await this.databaseService.findInvoiceByIdSafe(existingPayment.invoiceId)
      : null;
    const existingInvoiceStatus = existingInvoice ? String(existingInvoice.status) : '';
    const canReuseExistingInvoice =
      Boolean(existingInvoice) &&
      existingInvoiceStatus !== String(InvoiceStatus.PAID) &&
      existingInvoiceStatus !== String(InvoiceStatus.VOID);
    const appointmentAmount = this.roundToTwo(amount);
    const appointmentTax = this.calculateGstAmount(appointmentAmount);

    const createAppointmentInvoice = async () =>
      this.createInvoice({
        userId: billingUserId || appointment.patientId,
        clinicId: appointment.clinicId,
        amount: appointmentAmount,
        tax: appointmentTax,
        discount: 0,
        // Appointment invoices are paid immediately through the gateway, so a future due date
        // is misleading in payment history. Keep a due date for schema requirements, but make it immediate.
        dueDate: nowIso(),
        description: `Payment for ${appointmentType} appointment`,
        lineItems: {
          items: [
            {
              description: `${serviceMetadata.label} Appointment`,
              amount: appointmentAmount,
              quantity: 1,
            },
          ],
        },
        metadata: {
          appointmentId: appointment.id,
          appointmentType,
          gstRatePercent: this.getGstRatePercent(),
          ...(existingPayment ? { retriedPaymentId: existingPayment.id } : {}),
        },
      });

    let supersededInvoiceId: string | null = null;
    if (existingPayment?.invoiceId && existingInvoice) {
      if (existingInvoiceStatus === String(InvoiceStatus.PAID)) {
        throw new BadRequestException('Invoice is already paid for this appointment');
      }
      if (existingInvoiceStatus !== String(InvoiceStatus.VOID) && !canReuseExistingInvoice) {
        supersededInvoiceId = existingInvoice.id;
      }
    }

    const invoice =
      canReuseExistingInvoice && existingInvoice
        ? existingInvoice
        : await createAppointmentInvoice();
    const gatewayOrderId =
      existingGatewayOrderId || this.buildGatewayOrderId(invoice.invoiceNumber, invoice.id);
    const appointmentTotalAmount = this.getInvoiceTotalAmount(invoice, appointmentAmount);
    const resolvedAppointmentTax = this.roundToTwo(appointmentTotalAmount - appointmentAmount);

    // Create payment intent via payment service
    // SECURITY: Use ConfigService instead of hardcoded URL
    const baseUrl = this.getResolvedBackendBaseUrl();
    if (!baseUrl) {
      throw new Error('API URL is not configured in application config');
    }
    const paymentIntentOptions: PaymentIntentOptions = {
      amount: Math.round(appointmentTotalAmount * 100),
      currency: 'INR',
      orderId: gatewayOrderId,
      customerId: billingUserId || appointment.patientId,
      ...(customerPhone && { customerPhone }),
      ...(user?.email && { customerEmail: user.email }),
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
        subtotal: appointmentAmount,
        tax: resolvedAppointmentTax,
        totalAmount: appointmentTotalAmount,
        gstRatePercent: this.getGstRatePercent(),
        baseUrl,
        redirectUrl: this.buildPaymentCallbackUrl(
          appointment.clinicId,
          gatewayOrderId,
          provider,
          appointment.id,
          undefined,
          appointmentType
        ),
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
    const providerName = paymentIntentResult.provider || provider || PaymentProvider.CASHFREE;
    const providerResponse = this.asRecord(paymentIntentResult.providerResponse) || {};
    const gatewayRedirectUrl =
      this.asSafeString(paymentIntentResult.metadata?.['redirectUrl']) ||
      this.asSafeString(providerResponse['redirectUrl']) ||
      this.asSafeString(providerResponse['redirect_url']);
    const redirectUrl = this.buildPaymentCallbackUrl(
      appointment.clinicId,
      orderId || gatewayOrderId,
      providerName as PaymentProvider,
      appointment.id,
      paymentId || undefined,
      appointmentType
    );
    const handoff = await this.createPaymentHandoffDetails({
      clinicId: appointment.clinicId,
      orderId: orderId || gatewayOrderId,
      appointmentId: appointment.id,
      appointmentType,
      callbackUrl: redirectUrl,
      ...(paymentId ? { paymentId } : {}),
      ...(paymentIntentResult.provider
        ? { provider: paymentIntentResult.provider as PaymentProvider }
        : {}),
    });
    const paymentIntentWithHandoff = {
      ...paymentIntentResult,
      handoffToken: handoff.token,
      handoffCallbackUrl: handoff.callbackUrl,
      callbackUrl: handoff.callbackUrl,
    } as PaymentResult & Record<string, unknown>;
    paymentIntentResult.metadata = {
      ...(this.asRecord(paymentIntentResult.metadata) || {}),
      clinicId: appointment.clinicId,
      invoiceId: invoice.id,
      appointmentId: appointment.id,
      appointmentType,
      subtotal: appointmentAmount,
      tax: resolvedAppointmentTax,
      totalAmount: appointmentTotalAmount,
      gstRatePercent: this.getGstRatePercent(),
      gatewayRedirectUrl,
      handoffToken: handoff.token,
      handoffCallbackUrl: handoff.callbackUrl,
      callbackUrl: handoff.callbackUrl,
      redirectUrl: handoff.callbackUrl,
    };

    const paymentMetadata = {
      paymentIntentId: paymentId,
      orderId,
      provider: providerName,
      appointmentType,
      revenueModel: 'APPOINTMENT',
      serviceType: appointmentType,
      handoffToken: handoff.token,
      handoffCallbackUrl: handoff.callbackUrl,
      redirectUrl: handoff.callbackUrl,
    };

    let payment: PaymentWithRelations;
    if (existingPayment) {
      payment = await this.databaseService.updatePaymentSafe(existingPayment.id, {
        status: PaymentStatus.PENDING,
        invoiceId: invoice.id,
        ...(paymentId ? { transactionId: paymentId } : {}),
        amount: appointmentTotalAmount,
        description: `Payment for ${serviceMetadata.label} appointment`,
        metadata: paymentMetadata,
      });

      if (!canReuseExistingInvoice && supersededInvoiceId && supersededInvoiceId !== invoice.id) {
        await this.updateInvoice(supersededInvoiceId, {
          status: InvoiceStatus.VOID,
          metadata: {
            supersededByInvoiceId: invoice.id,
            supersededAt: nowIso(),
            supersededByPaymentId: payment.id,
          },
        });
      }

      void Promise.allSettled([
        this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.INFO,
          'Reused existing appointment payment record',
          'BillingService',
          {
            appointmentId,
            paymentId: payment.id,
            previousInvoiceId: supersededInvoiceId,
            newInvoiceId: invoice.id,
          }
        ),
        this.emitBillingPaymentStateEvents({
          paymentId: payment.id,
          clinicId: appointment.clinicId,
          appointmentId: appointment.id,
          status: PaymentStatus.PENDING.toLowerCase(),
        }),
        this.invalidateUserPaymentCaches(billingUserId || appointment.patientId),
      ]);
    } else {
      payment = await this.createPayment({
        amount: appointmentTotalAmount,
        clinicId: appointment.clinicId,
        userId: billingUserId || appointment.patientId,
        appointmentId: appointment.id,
        invoiceId: invoice.id,
        ...(paymentId && { transactionId: paymentId }),
        description: `Payment for ${serviceMetadata.label} appointment`,
        metadata: paymentMetadata,
      });
    }

    void Promise.allSettled([
      this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'Appointment payment intent created',
        'BillingService',
        {
          appointmentId,
          invoiceId: invoice.id,
          paymentId: payment.id,
          amount: appointmentTotalAmount,
          tax: resolvedAppointmentTax,
          appointmentType,
          treatmentType: appointment.treatmentType,
          serviceLabel: serviceMetadata.label,
        }
      ),
    ]);

    return {
      invoice,
      paymentIntent: paymentIntentWithHandoff,
    };
  }

  private async buildPaymentIntentCommon<T extends Record<string, unknown>>(context: {
    invoice: T;
    clinicId: string;
    paymentIntentOptions: PaymentIntentOptions;
    buildHandoff: (handoffContext: {
      orderId: string;
      redirectUrl: string;
      paymentId: string;
      provider: string;
      invoiceId: string;
    }) => Promise<{
      token: string;
      callbackUrl: string;
    }>;
    buildRedirectUrl: (context: {
      clinicId: string;
      orderId: string;
      provider?: PaymentProvider;
      appointmentId?: string;
      paymentId?: string;
      appointmentType?: string;
    }) => string;
    createPaymentRecord: (context: {
      amount: number;
      clinicId: string;
      userId: string;
      invoiceId: string;
      paymentId: string;
      orderId: string;
      provider: string;
    }) => Promise<unknown>;
    logMessage: string;
    logContext: Record<string, unknown>;
  }): Promise<{ invoice: T; paymentIntent: PaymentResult & Record<string, unknown> }> {
    const {
      invoice,
      paymentIntentOptions,
      buildHandoff,
      buildRedirectUrl,
      createPaymentRecord,
      logMessage,
      logContext,
      clinicId,
    } = context;

    const paymentIntentResult: PaymentResult = await this.paymentService.createPaymentIntent(
      clinicId,
      paymentIntentOptions
    );
    const paymentId = paymentIntentResult.paymentId || '';
    const orderId = paymentIntentResult.orderId || '';
    const providerName = paymentIntentResult.provider || '';
    const providerResponse = this.asRecord(paymentIntentResult.providerResponse) || {};
    const gatewayRedirectUrl =
      this.asSafeString(paymentIntentResult.metadata?.['redirectUrl']) ||
      this.asSafeString(providerResponse['redirectUrl']) ||
      this.asSafeString(providerResponse['redirect_url']);

    const redirectUrl = buildRedirectUrl({
      clinicId,
      orderId: orderId || paymentIntentOptions.orderId || '',
      provider: providerName as PaymentProvider,
    });

    const handoff = await buildHandoff({
      orderId: orderId || paymentIntentOptions.orderId || '',
      redirectUrl,
      paymentId,
      provider: providerName,
      invoiceId: (paymentIntentOptions.metadata?.['invoiceId'] as string | undefined) || '',
    });

    const paymentIntentWithHandoff = {
      ...paymentIntentResult,
      handoffToken: handoff.token,
      handoffCallbackUrl: handoff.callbackUrl,
      callbackUrl: handoff.callbackUrl,
    } as PaymentResult & Record<string, unknown>;

    paymentIntentResult.metadata = {
      ...(this.asRecord(paymentIntentResult.metadata) || {}),
      clinicId,
      ...(paymentIntentOptions.metadata || {}),
      gatewayRedirectUrl,
      handoffToken: handoff.token,
      handoffCallbackUrl: handoff.callbackUrl,
      callbackUrl: handoff.callbackUrl,
      redirectUrl: handoff.callbackUrl,
    };

    const invoiceFromOptions = paymentIntentOptions.metadata?.['invoiceId'] as string | undefined;
    const userIdFromOptions = (paymentIntentOptions.customerId as string) || '';
    await createPaymentRecord({
      amount: paymentIntentResult.amount || 0,
      clinicId,
      userId: userIdFromOptions,
      invoiceId: invoiceFromOptions || '',
      paymentId,
      orderId,
      provider: providerName,
    });

    void Promise.allSettled([
      this.loggingService.log(LogType.PAYMENT, LogLevel.INFO, logMessage, 'BillingService', {
        ...logContext,
      }),
    ]);

    return {
      invoice,
      paymentIntent: paymentIntentWithHandoff,
    };
  }

  async processInvoicePayment(
    invoiceId: string,
    provider?: PaymentProvider,
    requester?: BillingAccessContext
  ): Promise<{ invoice: unknown; paymentIntent: PaymentResult }> {
    const invoice = await this.getInvoice(invoiceId, requester);

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
    const baseUrl = this.getResolvedBackendBaseUrl();
    if (!baseUrl) {
      throw new Error('API URL is not configured in application config');
    }

    const paymentIntentOptions: PaymentIntentOptions = {
      amount: invoiceAmount * 100,
      currency,
      orderId: this.buildGatewayOrderId(invoice.invoiceNumber, invoice.id),
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
          this.buildGatewayOrderId(invoice.invoiceNumber, invoice.id),
          provider
        ),
      },
    };

    const paymentIntentResult: PaymentResult = await this.paymentService.createPaymentIntent(
      invoice.clinicId,
      paymentIntentOptions,
      provider
    );
    const paymentId = paymentIntentResult.paymentId || '';
    const orderId = paymentIntentResult.orderId || '';
    const providerName = paymentIntentResult.provider || '';
    const providerResponse = this.asRecord(paymentIntentResult.providerResponse) || {};
    const gatewayRedirectUrl =
      this.asSafeString(paymentIntentResult.metadata?.['redirectUrl']) ||
      this.asSafeString(providerResponse['redirectUrl']) ||
      this.asSafeString(providerResponse['redirect_url']);
    const redirectUrl = this.buildPaymentCallbackUrl(
      invoice.clinicId,
      orderId || this.buildGatewayOrderId(invoice.invoiceNumber, invoice.id),
      provider,
      undefined,
      paymentId || undefined
    );
    const handoff = await this.createPaymentHandoffDetails({
      clinicId: invoice.clinicId,
      orderId: orderId || this.buildGatewayOrderId(invoice.invoiceNumber, invoice.id),
      callbackUrl: redirectUrl,
      ...(paymentId ? { paymentId } : {}),
      ...(paymentIntentResult.provider
        ? { provider: paymentIntentResult.provider as PaymentProvider }
        : {}),
    });
    const paymentIntentWithHandoff = {
      ...paymentIntentResult,
      handoffToken: handoff.token,
      handoffCallbackUrl: handoff.callbackUrl,
      callbackUrl: handoff.callbackUrl,
    } as PaymentResult & Record<string, unknown>;
    paymentIntentResult.metadata = {
      ...(this.asRecord(paymentIntentResult.metadata) || {}),
      clinicId: invoice.clinicId,
      invoiceId: invoice.id,
      gatewayRedirectUrl,
      handoffToken: handoff.token,
      handoffCallbackUrl: handoff.callbackUrl,
      callbackUrl: handoff.callbackUrl,
      redirectUrl: handoff.callbackUrl,
    };

    await this.createPayment({
      amount: invoiceAmount,
      clinicId: invoice.clinicId,
      userId: invoice.userId,
      invoiceId: invoice.id,
      // A care-plan invoice paid from the invoice list must activate the plan in the callback.
      ...(invoice.subscriptionId && { subscriptionId: invoice.subscriptionId }),
      ...(paymentId && { transactionId: paymentId }),
      description: `Payment for invoice ${invoice.invoiceNumber}`,
      metadata: {
        paymentIntentId: paymentId,
        orderId,
        provider: providerName,
        revenueModel: 'OTHER',
        serviceType: 'INVOICE',
        handoffToken: handoff.token,
        handoffCallbackUrl: handoff.callbackUrl,
        redirectUrl: handoff.callbackUrl,
      },
    });

    void Promise.allSettled([
      this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'Invoice payment intent created',
        'BillingService',
        {
          invoiceId,
          amount: invoiceAmount,
          provider: providerName || provider || 'default',
        }
      ),
    ]);

    return {
      invoice,
      paymentIntent: paymentIntentWithHandoff,
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
    provider?: PaymentProvider,
    surchargeData?: { surchargeServiceCharge: number; surchargeServiceTax: number }
  ): Promise<FinalisationOutcome> {
    try {
      const normalizedProvider =
        this.normalizePaymentProvider(provider) ?? PaymentProvider.CASHFREE;

      // Verify payment status with provider — capability-aware routing.
      // Uses provider metadata to decide whether to call the gateway
      // with orderId, paymentId, or skip verification entirely.
      const paymentStatus: PaymentStatusResult = await this.paymentService.verifyPaymentStatus(
        clinicId,
        {
          orderId,
          paymentId,
          provider: normalizedProvider,
        }
      );
      const normalizedIncomingStatus = this.normalizeGatewayPaymentStatus(paymentStatus.status);

      // Find payment record: by payment ID, gateway transaction ID, then order_id from metadata
      let payment = await this.databaseService.findPaymentByIdSafe(paymentId);
      if (!payment) {
        const byPaymentIdTx = await this.databaseService.findPaymentsSafe({
          transactionId: paymentId,
        });
        payment = byPaymentIdTx[0] || null;
      }
      if (!payment) {
        const byOrderIdTx = await this.databaseService.findPaymentsSafe({
          appointmentId: orderId,
        });
        payment = byOrderIdTx[0] || null;
      }

      // Search by order_id stored in metadata across clinic payments (scoped to recent)
      if (!payment) {
        try {
          const clinicPayments = await this.databaseService.findPaymentsSafe({
            clinicId,
            createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString() },
          } as Parameters<typeof this.databaseService.findPaymentsSafe>[0]);
          payment =
            clinicPayments.find(
              p => (this.asRecord(p.metadata)?.['orderId'] as string | undefined) === orderId
            ) || null;
        } catch {
          // Non-fatal: proceed to creation path below
        }
      }

      // The gateway order may not be the one stored on the payment record — e.g. the
      // payment bridge opened a fresh Cashfree order while a Razorpay order was pending.
      // Bind it through the gateway-verified appointment tag instead of dropping it.
      let reboundFromOrderId: string | null = null;
      if (!payment) {
        payment = await this.findOpenPaymentByGatewayTags(clinicId, paymentStatus);
        if (payment) {
          reboundFromOrderId = this.asSafeString(this.asRecord(payment.metadata)?.['orderId']);
          await this.loggingService.log(
            LogType.PAYMENT,
            LogLevel.WARN,
            `Payment callback bound to appointment payment via gateway order tags: orderId=${orderId}`,
            'BillingService',
            {
              clinicId,
              orderId,
              paymentId,
              localPaymentId: payment.id,
              previousOrderId: reboundFromOrderId,
              provider: normalizedProvider,
            }
          );
        }
      }

      if (!payment) {
        // Payment record never created — this happens when the payment intent failed
        // (e.g. Cashfree rejected the order) but the gateway callback still arrives.
        // We cannot safely create a payment record without an invoice/appointment
        // reference, so we log and return gracefully to avoid breaking the webhook.
        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          `Payment callback received but no local payment record exists: orderId=${orderId}, paymentId=${paymentId}`,
          'BillingService',
          { clinicId, orderId, paymentId, provider: normalizedProvider }
        );
        return { payment: {} };
      }

      // Bind payment record to the gateway result — reject if clinic, amount, or currency mismatch.
      const paymentRecord = payment as {
        clinicId?: string;
        amount?: number;
      };
      if (paymentRecord.clinicId && String(paymentRecord.clinicId) !== String(clinicId)) {
        throw new ForbiddenException(
          `Payment record clinic ${paymentRecord.clinicId} does not match callback clinic ${clinicId}`
        );
      }
      // The amount must match before a payment is claimed. A payment that is already settled /
      // released is never changed by a callback, so a mismatching amount there is the signature
      // of a second gateway order: it is flagged by the finaliser instead of being dropped here.
      const localStatus = String(payment.status || '').toLowerCase();
      const isUnclaimedStatus = !['completed', 'cancelled', 'expired', 'refunded'].includes(
        localStatus
      );
      if (
        isUnclaimedStatus &&
        paymentStatus.amount &&
        paymentRecord.amount &&
        Math.abs(paymentRecord.amount - paymentStatus.amount) > 0.01
      ) {
        throw new BadRequestException(
          `Payment amount mismatch: record has ${paymentRecord.amount}, gateway returned ${paymentStatus.amount}`
        );
      }
      if (paymentStatus.currency && String(paymentStatus.currency).toLowerCase() !== 'inr') {
        void this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'Unexpected payment currency',
          'BillingService',
          {
            clinicId,
            paymentId: payment.id,
            orderId,
            currency: paymentStatus.currency,
          }
        );
      }

      // Idempotent finalisation: compare-and-set claim with a per-delivery token, repair of a
      // crashed finalisation, duplicate / late settlement detection (BillingPaymentFinaliser).
      const gatewayMethod = this.resolveGatewayPaymentMethod(paymentStatus);
      const baseMetadata: Record<string, unknown> = this.asRecord(payment.metadata)
        ? { ...(payment.metadata as Record<string, unknown>) }
        : {};
      if (reboundFromOrderId !== null) {
        baseMetadata['orderId'] = orderId;
        baseMetadata['provider'] = normalizedProvider;
        baseMetadata['supersededOrderId'] = reboundFromOrderId;
      }

      if (String(normalizedIncomingStatus).toLowerCase() === 'completed') {
        await this.assertPaymentTargetsConsistent(payment, clinicId);
      }

      return await this.finaliser.process({
        payment: payment as unknown as PaymentRow,
        clinicId,
        paymentId,
        orderId,
        provider: normalizedProvider || 'unknown',
        paymentStatus,
        incomingStatus: normalizedIncomingStatus,
        baseMetadata,
        update: {
          status: normalizedIncomingStatus,
          transactionId: paymentStatus.transactionId || paymentId,
          // "Paid via" on the invoice: only set when the gateway names a method we store.
          ...(gatewayMethod && { method: gatewayMethod }),
          ...(surchargeData && {
            surchargeServiceCharge: surchargeData.surchargeServiceCharge,
            surchargeServiceTax: surchargeData.surchargeServiceTax,
          }),
        },
      });
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
   * The payment row is the trust anchor of the callback, so the entities it points at must be
   * the same clinic's and the same user's: a payment can never settle someone else's invoice or
   * plan.
   */
  private async assertPaymentTargetsConsistent(
    payment: {
      clinicId?: string | null;
      userId?: string | null;
      invoiceId?: string | null;
      subscriptionId?: string | null;
    },
    clinicId: string
  ): Promise<void> {
    const paymentClinicId = payment.clinicId || clinicId;
    const targets: Array<{
      kind: 'invoice' | 'subscription';
      id: string;
      row: { clinicId?: string | null; userId?: string | null } | null;
    }> = [];
    if (payment.invoiceId) {
      targets.push({
        kind: 'invoice',
        id: payment.invoiceId,
        row: await this.databaseService.findInvoiceByIdSafe(payment.invoiceId),
      });
    }
    if (payment.subscriptionId) {
      targets.push({
        kind: 'subscription',
        id: payment.subscriptionId,
        row: await this.databaseService.findSubscriptionByIdSafe(payment.subscriptionId),
      });
    }

    for (const target of targets) {
      if (!target.row) {
        continue;
      }
      const clinicMismatch =
        Boolean(target.row.clinicId) && target.row.clinicId !== paymentClinicId;
      const userMismatch =
        Boolean(payment.userId) &&
        Boolean(target.row.userId) &&
        payment.userId !== target.row.userId;
      if (clinicMismatch || userMismatch) {
        await this.loggingService.log(
          LogType.SECURITY,
          LogLevel.ERROR,
          `Payment ${target.kind} does not belong to the payment's clinic/user; callback rejected`,
          'BillingService',
          { clinicId, targetKind: target.kind, targetId: target.id, clinicMismatch, userMismatch }
        );
        throw new ForbiddenException(
          `Payment ${target.kind} does not belong to the same clinic and user as the payment`
        );
      }
    }
  }

  /**
   * Settles the invoice a completed payment points at. The invoice becomes PAID only once the
   * COMPLETED payments recorded against it cover its total (compared in paise); the transition
   * itself is one conditional statement, so exactly one caller performs it (and sends the
   * receipt). A payment landing on an invoice another payment already settled is a duplicate;
   * one that does not cover the total leaves the invoice PENDING.
   */
  async settleInvoiceForPayment(payment: PaymentRow, clinicId: string): Promise<InvoiceSettlement> {
    if (!payment.invoiceId) {
      return { state: 'none' };
    }
    const invoice = await this.paymentStore.readInvoice(payment.invoiceId, clinicId);
    if (!invoice) {
      return { state: 'none' };
    }

    const settledBy = (row: InvoiceRow): string =>
      this.asSafeString(this.asRecord(row.metadata)?.['settledByPaymentId']);
    if (String(invoice.status).toUpperCase() === String(InvoiceStatus.PAID)) {
      return {
        state: settledBy(invoice) === payment.id ? 'already-settled' : 'duplicate',
        invoice,
      };
    }

    const recorded = await this.paymentStore.listInvoicePayments(invoice.id, clinicId);
    const counted = recorded.some(row => row.id === payment.id)
      ? recorded.map(row => (row.id === payment.id ? { ...row, status: 'COMPLETED' } : row))
      : [...recorded, { ...payment, status: 'COMPLETED' }];
    const paidMinor = sumCompletedPaymentMinorUnits(counted);
    const requiredMinor = toMinorUnits(invoice.totalAmount);
    if (!isAmountCovered(paidMinor, requiredMinor)) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.WARN,
        'Completed payments do not cover the invoice total; invoice left unpaid',
        'BillingService',
        { clinicId, paymentId: payment.id, invoiceId: invoice.id, paidMinor, requiredMinor }
      );
      return { state: 'underpaid', invoice };
    }

    const transition = await this.transitionInvoiceToPaid(invoice, {
      settledByPaymentId: payment.id,
    });
    if (transition.transitioned) {
      return { state: 'settled', invoice: transition.invoice as InvoiceRow };
    }
    const latest = await this.paymentStore.readInvoice(invoice.id, clinicId);
    return {
      state: latest && settledBy(latest) === payment.id ? 'already-settled' : 'duplicate',
      invoice: latest ?? invoice,
    };
  }

  /**
   * Server-side check for the PUBLIC payment bridge (`POST /payments/payment-intents`), which has
   * no authenticated user - only the clinic header. The client-chosen amount is never trusted:
   * the target must exist, belong to that clinic and be open, and the amount (minor units) must
   * equal the amount really due (invoice balance, VIDEO_CALL fee + GST, or plan price + GST),
   * compared in paise. Prescription payments are not supported on the bridge (they have their own
   * authenticated endpoint). Throws 404 / 400 with fixed messages.
   */
  async assertPublicPaymentIntentAmount(
    target: {
      appointmentId?: string | undefined;
      subscriptionId?: string | undefined;
      invoiceId?: string | undefined;
      prescriptionId?: string | undefined;
    },
    clinicId: string,
    amountMinorUnits: number
  ): Promise<void> {
    const provided = [
      target.appointmentId,
      target.subscriptionId,
      target.invoiceId,
      target.prescriptionId,
    ].filter(Boolean);
    if (provided.length !== 1) {
      throw new BadRequestException('Exactly one payment target is required');
    }
    if (target.prescriptionId) {
      throw new BadRequestException('Prescription payments use the prescription payment endpoint');
    }

    const notFound = new NotFoundException('Payment target not found');
    const notOpen = new BadRequestException('Payment target is not open for payment');
    let dueMinor = 0;

    if (target.invoiceId) {
      const invoice = await this.paymentStore.readInvoice(target.invoiceId, clinicId);
      if (!invoice || invoice.clinicId !== clinicId) {
        throw notFound;
      }
      if (String(invoice.status).toUpperCase() !== String(InvoiceStatus.PENDING)) {
        throw notOpen;
      }
      const recorded = await this.paymentStore.listInvoicePayments(invoice.id, clinicId);
      dueMinor = toMinorUnits(invoice.totalAmount) - sumCompletedPaymentMinorUnits(recorded);
    } else if (target.appointmentId) {
      const appointment = await this.databaseService.findAppointmentByIdSafe(target.appointmentId);
      if (!appointment || appointment.clinicId !== clinicId) {
        throw notFound;
      }
      const lapsed = (appointment as { paymentExpiresAt?: Date | string | null }).paymentExpiresAt;
      if (
        [
          AppointmentStatus.CANCELLED,
          AppointmentStatus.EXPIRED,
          AppointmentStatus.COMPLETED,
        ].includes(appointment.status as AppointmentStatus) ||
        String(appointment.type) !== 'VIDEO_CALL' ||
        (lapsed && new Date(lapsed).getTime() <= Date.now())
      ) {
        throw notOpen;
      }
      const fee = this.roundToTwo(
        this.resolveVideoConsultationService(appointment.treatmentType)
          .videoConsultationFee as number
      );
      dueMinor = toMinorUnits(this.roundToTwo(fee + this.calculateGstAmount(fee)));
    } else if (target.subscriptionId) {
      const subscription = await this.subscriptionStore.readSubscription(
        target.subscriptionId,
        clinicId
      );
      if (!subscription || subscription.clinicId !== clinicId || !subscription.plan) {
        throw notFound;
      }
      if (String(subscription.status) === String(SubscriptionStatus.CANCELLED)) {
        throw notOpen;
      }
      const price = this.roundToTwo(subscription.plan.amount);
      dueMinor = toMinorUnits(this.roundToTwo(price + this.calculateGstAmount(price)));
    }

    if (dueMinor <= 0 || !Number.isInteger(amountMinorUnits) || amountMinorUnits !== dueMinor) {
      await this.loggingService.log(
        LogType.SECURITY,
        LogLevel.WARN,
        'Public payment intent refused: amount does not match the amount due',
        'BillingService',
        { clinicId, ...target, requestedMinor: amountMinorUnits, dueMinor }
      );
      throw new BadRequestException('Payment amount does not match the amount due');
    }
  }

  /**
   * Subscription payment without an invoice: the paid amount must reach the plan price. (With an
   * invoice the invoice total - plan price plus the tax the invoice defines - is the bar.)
   */
  private async isPlanAmountCovered(subscriptionId: string, payment: PaymentRow): Promise<boolean> {
    const subscription = await this.subscriptionStore.readSubscription(
      subscriptionId,
      payment.clinicId
    );
    if (!subscription?.plan) {
      return true;
    }
    return isAmountCovered(toMinorUnits(payment.amount), toMinorUnits(subscription.plan.amount));
  }

  /**
   * Records an anomaly the system did not apply as a normal settlement. Late settlements only log
   * and emit (no refunds for visits that never take place); duplicates and underpayments are also
   * stored on `payment.metadata.settlementReview` as admin-visible data. Never throws, never
   * refunds, never notifies.
   */
  async flagSettlement(flag: SettlementFlag): Promise<void> {
    try {
      let recorded = !isPersistedAnomaly(flag.reason);
      if (isPersistedAnomaly(flag.reason)) {
        const reason = flag.reason;
        const result = await this.paymentStore.mutateMetadata(
          flag.paymentId,
          flag.clinicId,
          current =>
            buildSettlementReviewMetadata(
              current,
              {
                reason,
                appointmentId: flag.appointmentId,
                invoiceId: flag.invoiceId,
                orderId: flag.orderId,
                transactionId: flag.transactionId,
                amount: flag.amount,
              },
              new Date()
            )?.next ?? null
        );
        recorded = result === 'written' || result === 'conflict' || result === 'missing';
      }
      if (!recorded) {
        return; // already recorded by an earlier delivery: no log / event spam on every poll
      }

      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.WARN,
        `Payment settlement anomaly: ${flag.reason}`,
        'BillingService',
        {
          clinicId: flag.clinicId,
          paymentId: flag.paymentId,
          reason: flag.reason,
          invoiceId: flag.invoiceId,
          appointmentId: flag.appointmentId,
          orderId: flag.orderId,
          amount: flag.amount,
        }
      );
      const eventName =
        flag.reason === 'LATE_SETTLEMENT'
          ? 'billing.payment.late_settlement'
          : flag.reason === 'DUPLICATE_SETTLEMENT'
            ? 'billing.payment.duplicate_settlement'
            : 'billing.payment.underpaid';
      await this.eventService.emit(eventName, {
        clinicId: flag.clinicId,
        paymentId: flag.paymentId,
        ...(flag.invoiceId ? { invoiceId: flag.invoiceId } : {}),
        ...(flag.appointmentId ? { appointmentId: flag.appointmentId } : {}),
        ...(flag.orderId ? { orderId: flag.orderId } : {}),
        ...(flag.amount !== undefined ? { amount: flag.amount } : {}),
        ...(flag.userId ? { userId: flag.userId } : {}),
        reason: flag.reason,
      });
    } catch (error) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.WARN,
        `Failed to record payment settlement anomaly: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'BillingService',
        { clinicId: flag.clinicId, paymentId: flag.paymentId, reason: flag.reason }
      );
    }
  }

  /** Cron: repairs payments stuck between the claim and their side effects (crashed finalisation). */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async repairStalledPaymentFinalisations(): Promise<number> {
    try {
      return await this.finaliser.repairStalled();
    } catch (error) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        `Stalled payment finalisation sweep failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'BillingService'
      );
      return 0;
    }
  }

  async preparePayoutForAppointmentPayment(paymentId: string, clinicId: string): Promise<void> {
    const payment = await this.paymentStore.readPayment(paymentId, clinicId);
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
      preparedAt: nowIso(),
      ledger: [
        {
          type: 'PLATFORM_CREDIT',
          amount: gross,
          reference: payment.id,
          createdAt: nowIso(),
        },
        {
          type: 'DOCTOR_PAYABLE_CREDIT',
          amount: doctorShare,
          reference: payment.id,
          createdAt: nowIso(),
        },
      ],
    };

    // Written once, guarded by `updatedAt` so it never overwrites a concurrent metadata write
    // (finalisation marker, settlement review). A payment flagged as a duplicate / underpayment
    // was not settled as a normal booking payment and earns no payout.
    await this.paymentStore.mutateMetadata(payment.id, clinicId, current => {
      if (this.asRecord(current['payout'])?.['state'] || hasSettlementReview(current)) {
        return null; // idempotent
      }
      return { ...current, payout };
    });
  }

  /**
   * Records the platform-revenue ledger entry for a completed subscription payment.
   * `subscriptionIdOverride` covers invoice-initiated plan payments whose payment row carries
   * no subscription id of its own (the plan is reached through the paid invoice).
   * Written at most once per payment (compare-and-set on the metadata), never for a payment that
   * was flagged as a duplicate / underpayment.
   */
  async prepareLedgerForSubscriptionPayment(
    paymentId: string,
    clinicId: string,
    subscriptionIdOverride?: string | null
  ): Promise<void> {
    const payment = await this.paymentStore.readPayment(paymentId, clinicId);
    if (
      !payment ||
      payment.clinicId !== clinicId ||
      !(payment.subscriptionId || subscriptionIdOverride)
    ) {
      return;
    }
    if (String(payment.status) !== String(PaymentStatus.COMPLETED)) {
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
          at: nowIso(),
          note: 'Subscription payment credited to platform revenue',
        },
      ],
    };

    await this.paymentStore.mutateMetadata(payment.id, clinicId, current => {
      if (this.asRecord(current['payout'])?.['state'] || hasSettlementReview(current)) {
        return null;
      }
      return { ...current, revenueModel: 'SUBSCRIPTION', payout };
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
    payout['readyAt'] = nowIso();

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
      payout['readyAt'] = nowIso();
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
      createdAt: nowIso(),
    });
    ledger.push({
      type: 'DOCTOR_PAYOUT_CREDIT',
      amount: Number(payout['doctorShareAmount'] || 0),
      reference: payment.id,
      createdAt: nowIso(),
    });

    payout['state'] = 'PAYOUT_SUCCESS';
    payout['paidAt'] = nowIso();
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

  /**
   * Payout ledger of an appointment (doctor share, platform fee). Only billing / admin roles of
   * the appointment's clinic and the treating doctor may read it - never a patient or a
   * different doctor.
   */
  private async assertPayoutStatusAccess(
    appointment: { doctorId?: string | null; doctor?: { userId?: string | null } | null },
    requester?: BillingAccessContext
  ): Promise<void> {
    if (!requester) {
      return; // internal caller
    }
    if (
      requester.role === 'SUPER_ADMIN' ||
      requester.role === 'CLINIC_ADMIN' ||
      requester.role === 'FINANCE_BILLING'
    ) {
      return;
    }
    if (requester.role === 'DOCTOR' && requester.userId) {
      const treatingDoctorUserId =
        appointment.doctor?.userId ??
        (appointment.doctorId ? await this.resolveDoctorUserId(appointment.doctorId) : null);
      if (treatingDoctorUserId && treatingDoctorUserId === requester.userId) {
        return;
      }
    }
    throw new NotFoundException('Appointment not found');
  }

  private async resolveDoctorUserId(doctorId: string): Promise<string | null> {
    const doctor = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as {
        doctor: {
          findUnique: (args: {
            where: { id: string };
            select: { userId: true };
          }) => Promise<{ userId: string | null } | null>;
        };
      };
      return typedClient.doctor.findUnique({ where: { id: doctorId }, select: { userId: true } });
    });
    return doctor?.userId ?? null;
  }

  async getAppointmentPayoutStatus(
    appointmentId: string,
    clinicId: string,
    requester?: BillingAccessContext
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
    await this.assertPayoutStatusAccess(appointment, requester);

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
  ): Promise<FinalisationOutcome> {
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
   * Manual admin recovery path for a single appointment's payment.
   *
   * `reconcilePaymentForClinic`/`handlePaymentCallback` only work when (a) a
   * local Payment record already exists and (b) the appointment's
   * `paymentExpiresAt` window hasn't lapsed yet. Both assumptions break when a
   * provider webhook is missed or rejected (e.g. a signature/timestamp bug) —
   * the payment can succeed at the gateway while our system never learns
   * about it, and the appointment auto-expires in the meantime. This method
   * is the clinic-admin-triggered recovery for exactly that situation: it
   * independently re-verifies with the payment provider (never trusts the
   * caller's claim alone), creates the local Payment record if one was never
   * written, and confirms the appointment without requiring the payment
   * window to still be open — an admin has already confirmed payment was
   * received, so the automatic expiry guard is the wrong check here.
   */
  async manualReconcileAppointmentPayment(
    clinicId: string,
    appointmentId: string,
    actorUserId: string,
    options: { provider?: PaymentProvider; orderId?: string; transactionId?: string } = {}
  ): Promise<{ payment: unknown; appointment: unknown }> {
    const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);
    if (!appointment || String(appointment.clinicId) !== String(clinicId)) {
      throw new NotFoundException('Appointment not found for this clinic');
    }
    if (
      String(appointment.status) === String(AppointmentStatus.CANCELLED) ||
      String(appointment.status) === String(AppointmentStatus.COMPLETED)
    ) {
      throw new BadRequestException(
        `Cannot reconcile payment for an appointment that is already ${appointment.status}`
      );
    }

    let payment = (await this.databaseService.findPaymentsSafe({ appointmentId }))[0] ?? null;
    // A COMPLETED payment is only repaired when something is left to repair: its finalisation
    // never finished, or the booking was left unconfirmed (e.g. the payment window had lapsed).
    const completedLocally =
      Boolean(payment) && String(payment?.status) === String(PaymentStatus.COMPLETED);
    if (completedLocally) {
      const marker = readFinalisationMarker(payment?.metadata);
      const finalisationUnfinished = marker !== null && !marker.sideEffectsAppliedAt;
      if (
        String(appointment.status) === String(AppointmentStatus.CONFIRMED) &&
        !finalisationUnfinished
      ) {
        throw new BadRequestException('This appointment payment is already marked completed');
      }
    }

    const normalizedProvider =
      this.normalizePaymentProvider(options.provider) ??
      this.normalizePaymentProvider((this.asRecord(payment?.metadata) ?? {})['provider']) ??
      PaymentProvider.CASHFREE;
    const orderId =
      options.orderId ||
      (this.asRecord(payment?.metadata)?.['orderId'] as string | undefined) ||
      payment?.transactionId ||
      appointmentId;
    const gatewayPaymentId = options.transactionId || payment?.transactionId || orderId;

    // Independently verify with the provider — never trust the caller's claim alone.
    const paymentStatus: PaymentStatusResult = await this.paymentService.verifyPaymentStatus(
      clinicId,
      { orderId, paymentId: gatewayPaymentId, provider: normalizedProvider }
    );
    const normalizedIncomingStatus = this.normalizeGatewayPaymentStatus(paymentStatus.status);
    if (String(normalizedIncomingStatus).toLowerCase() !== 'completed') {
      throw new BadRequestException(
        `${normalizedProvider} reports this payment as "${paymentStatus.status}", not completed — refusing to reconcile`
      );
    }
    if (
      paymentStatus.amount &&
      payment?.amount &&
      Math.abs(payment.amount - paymentStatus.amount) > 0.01
    ) {
      throw new BadRequestException(
        `Payment amount mismatch: local record has ${payment.amount}, gateway returned ${paymentStatus.amount}`
      );
    }

    if (completedLocally && payment) {
      const repaired = await this.finaliser.repairManually(payment as unknown as PaymentRow, {
        actorUserId,
        orderId,
      });
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'Completed payment repaired by clinic admin',
        'BillingService.manualReconcileAppointmentPayment',
        { clinicId, appointmentId, paymentId: payment.id, actorUserId, orderId }
      );
      return {
        payment: repaired.payment,
        appointment:
          repaired.appointment ??
          (await this.databaseService.findAppointmentByIdSafe(appointmentId)) ??
          appointment,
      };
    }

    if (!payment) {
      payment = await this.createPayment({
        amount: paymentStatus.amount || 0,
        clinicId,
        appointmentId,
        ...(appointment.userId ? { userId: appointment.userId } : {}),
        transactionId: paymentStatus.transactionId || gatewayPaymentId,
        description: 'Manually reconciled: provider payment succeeded but no webhook was recorded',
        metadata: { orderId, provider: normalizedProvider },
      });
    }

    const updatedPayment = await this.updatePayment(payment.id, {
      status: PaymentStatus.COMPLETED,
      transactionId: paymentStatus.transactionId || gatewayPaymentId,
      metadata: {
        ...(this.asRecord(payment.metadata) ?? {}),
        orderId,
        provider: normalizedProvider,
        manualReconciliation: {
          reconciledBy: actorUserId,
          reconciledAt: nowIso(),
          reason: 'Admin-confirmed payment receipt; automated webhook did not process it in time',
          verifiedGatewayStatus: paymentStatus.status,
        },
      },
    });

    let updatedAppointment: unknown = appointment;
    if (String(appointment.status) !== String(AppointmentStatus.CONFIRMED)) {
      const confirmationResult = await this.databaseService.executeHealthcareWrite(
        async client => {
          const appointmentClient = client as unknown as {
            appointment: {
              updateMany: (args: {
                where: { id: string; status: { notIn: string[] } };
                data: { status: string; confirmationExpiresAt: Date | null };
              }) => Promise<{ count: number }>;
            };
          };
          return appointmentClient.appointment.updateMany({
            where: {
              id: appointmentId,
              status: { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.COMPLETED] },
            },
            data: {
              status: AppointmentStatus.CONFIRMED,
              // Clamped: an admin often reconciles after the visit's own window has
              // already elapsed; a past expiry would get the confirmed visit expired
              // again by the scheduler on its next run.
              confirmationExpiresAt: resolvePaidConfirmationExpiresAt(appointment),
            },
          });
        },
        {
          userId: actorUserId,
          clinicId,
          resourceType: 'APPOINTMENT',
          operation: 'UPDATE',
          resourceId: appointmentId,
          userRole: 'system',
          details: { reason: 'Manual payment reconciliation', paymentId: payment.id, orderId },
        }
      );

      if (confirmationResult.count) {
        updatedAppointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);
        void this.syncAppointmentAfterPayment({
          appointmentId,
          clinicId,
          paymentId: payment.id,
          paymentStatus: PaymentStatus.COMPLETED,
          amount: paymentStatus.amount,
          appointment: updatedAppointment as AppointmentWithRelations | null,
          userId: appointment.userId ?? null,
          emitAppointmentUpdated: true,
        }).catch((error: unknown) => {
          void this.loggingService.log(
            LogType.PAYMENT,
            LogLevel.WARN,
            `Failed to sync appointment after manual reconciliation: ${
              error instanceof Error ? error.message : String(error)
            }`,
            'BillingService.manualReconcileAppointmentPayment',
            { clinicId, paymentId: payment.id, appointmentId }
          );
        });
      }
    }

    await this.loggingService.log(
      LogType.PAYMENT,
      LogLevel.INFO,
      'Payment manually reconciled by clinic admin',
      'BillingService.manualReconcileAppointmentPayment',
      {
        clinicId,
        appointmentId,
        paymentId: payment.id,
        actorUserId,
        orderId,
        provider: normalizedProvider,
      }
    );

    return { payment: updatedPayment, appointment: updatedAppointment };
  }

  /**
   * Renew subscription after successful payment (internal method).
   *
   * Idempotent per payment id: the renewal stamps `metadata.renewedPaymentIds` in the SAME
   * conditional statement that moves the period, and a repeat with a stamped id is a no-op, so
   * one payment can never buy two intervals. The write is optimistic on (status, period): a
   * concurrent renewal makes it re-read instead of extending the same period twice.
   *
   * `activationOnly` is used when re-driving a payment of unknown history (completed before the
   * claim protocol existed): it activates a plan that is still INCOMPLETE / INCOMPLETE_EXPIRED /
   * PAST_DUE but never extends one that is already active.
   */
  private async renewSubscriptionAfterPayment(
    subscriptionId: string,
    options: { activationOnly?: boolean; paymentId?: string; clinicId?: string } = {}
  ): Promise<void> {
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const subscription = await this.subscriptionStore.readSubscription(
        subscriptionId,
        options.clinicId ?? 'SYSTEM'
      );
      if (!subscription || !subscription.plan) {
        return;
      }
      if (
        options.paymentId &&
        hasSubscriptionRenewalStamp(subscription.metadata, options.paymentId)
      ) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Subscription already renewed for this payment; skipping',
          'BillingService',
          { subscriptionId, paymentId: options.paymentId }
        );
        return;
      }

      const now = new Date();
      const renewal = planSubscriptionRenewal(
        subscription,
        { ...(options.activationOnly ? { activationOnly: true } : {}) },
        now
      );
      if (renewal.kind === 'noop') {
        return;
      }

      const applied = await this.subscriptionStore.updateIfUnchanged(subscription, {
        ...renewal.data,
        ...(options.paymentId
          ? {
              metadata: withSubscriptionRenewalStamp(subscription.metadata, options.paymentId, now),
            }
          : {}),
      });
      if (!applied) {
        continue;
      }

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        renewal.kind === 'activation'
          ? 'Subscription activated after initial payment'
          : 'Subscription renewed after payment',
        'BillingService',
        {
          subscriptionId,
          paymentId: options.paymentId,
          periodStart: renewal.periodStart.toISOString(),
          periodEnd: renewal.periodEnd.toISOString(),
        }
      );
      await this.eventService.emit('billing.subscription.renewed', {
        subscriptionId,
        periodStart: renewal.periodStart,
        periodEnd: renewal.periodEnd,
      });
      try {
        await this.databaseService.invalidateEntityCache(
          'subscription',
          subscriptionId,
          subscription.clinicId
        );
      } catch {
        // Best effort: entries age out via their TTL.
      }
      await this.invalidateSubscriptionCaches(subscription.userId, subscriptionId);
      return;
    }

    throw new ConflictException(
      'The subscription changed while the payment was being applied; it will be retried'
    );
  }

  /**
   * Drops the cached plan row and the user's plan lists (cached for 30 minutes) so a paid,
   * cancelled or edited plan is reflected at once. Never throws (see invalidateCacheTagsSafely).
   */
  private async invalidateSubscriptionCaches(
    userId: string,
    subscriptionId: string
  ): Promise<void> {
    await this.invalidateCacheTagsSafely([
      `user_subscriptions:${userId}`,
      `user:${userId}`,
      `billing_subscription:${subscriptionId}`,
      `subscription:${subscriptionId}`,
    ]);
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
    // Prevent concurrent refund requests for the same payment from both
    // reading refundAmount=0, both passing the "already refunded" check,
    // and both successfully calling the gateway (double payout while the
    // DB only records one). 30s covers the gateway round-trip below.
    const lockKey = `refund:payment:${paymentId}`;
    const lockAcquired = await this.cacheService.acquireLock(lockKey, 30);
    if (!lockAcquired) {
      throw new BadRequestException(
        'A refund is already being processed for this payment. Please try again shortly.'
      );
    }

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
            createdAt: nowIso(),
          });
          payout['doctorShareAmount'] = adjustedDoctorShare;
          payout['platformFeeAmount'] = adjustedPlatformFee;
          payout['lastRefundAt'] = nowIso();
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
    } finally {
      await this.cacheService.releaseLock(lockKey);
    }
  }

  /**
   * Handle refund callback/webhook
   */
  async handleRefundCallback(
    clinicId: string,
    paymentId: string,
    refundId: string,
    orderId?: string,
    provider?: PaymentProvider,
    callbackState?: string,
    callbackAmount?: number
  ): Promise<{ payment: unknown; refund?: unknown }> {
    try {
      const normalizedProvider =
        this.normalizePaymentProvider(provider) ?? PaymentProvider.CASHFREE;

      let payment = await this.databaseService.findPaymentByIdSafe(paymentId);
      if (!payment && paymentId) {
        const byPaymentIdTx = await this.databaseService.findPaymentsSafe({
          transactionId: paymentId,
        });
        payment = byPaymentIdTx[0] || null;
      }
      if (!payment && orderId) {
        const byOrderIdTx = await this.databaseService.findPaymentsSafe({ transactionId: orderId });
        payment = byOrderIdTx[0] || null;
      }
      if (!payment) {
        throw new NotFoundException('Payment record not found');
      }

      const existingRefundAmount = Number(payment.refundAmount || 0);
      const resolvedCallbackState = String(callbackState || '')
        .trim()
        .toLowerCase();
      let providerRefundStatus: RefundResult | null = null;

      if (refundId && normalizedProvider) {
        try {
          providerRefundStatus = await this.paymentService.getRefundStatus(
            clinicId,
            refundId,
            normalizedProvider
          );
        } catch (error) {
          await this.loggingService.log(
            LogType.PAYMENT,
            LogLevel.WARN,
            'Refund status lookup failed; falling back to webhook payload',
            'BillingService',
            {
              clinicId,
              paymentId: payment.id,
              refundId,
              provider: normalizedProvider,
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
      }

      const statusSource = providerRefundStatus?.status || resolvedCallbackState;
      const refundAmountFromProvider =
        typeof providerRefundStatus?.amount === 'number' &&
        Number.isFinite(providerRefundStatus.amount)
          ? providerRefundStatus.amount
          : Number.isFinite(callbackAmount || NaN)
            ? Number(callbackAmount)
            : 0;
      const normalizedStatus = statusSource
        ? statusSource.toLowerCase()
        : existingRefundAmount >= payment.amount
          ? 'completed'
          : 'processing';

      const shouldStoreRefundAmount =
        existingRefundAmount <= 0 &&
        Number.isFinite(refundAmountFromProvider) &&
        refundAmountFromProvider > 0;
      const computedRefundAmount = shouldStoreRefundAmount
        ? refundAmountFromProvider
        : existingRefundAmount;
      const fullyRefunded =
        computedRefundAmount > 0 && computedRefundAmount >= Number(payment.amount || 0);

      const metadata = this.asRecord(payment.metadata)
        ? { ...(payment.metadata as Record<string, unknown>) }
        : {};
      metadata['refundCallbackAudit'] = {
        provider: normalizedProvider || 'unknown',
        paymentId: payment.id,
        refundId,
        orderId: orderId || null,
        callbackState: normalizedStatus,
        receivedAt: nowIso(),
        amount: refundAmountFromProvider || null,
      };
      metadata['refund'] = {
        refundId,
        orderId: orderId || payment.transactionId || payment.id,
        provider: normalizedProvider || 'unknown',
        state: normalizedStatus,
        amount: refundAmountFromProvider || null,
        processedAt: nowIso(),
      };

      const updateData: UpdatePaymentDto = {
        metadata,
      };
      if (shouldStoreRefundAmount) {
        updateData.refundAmount = refundAmountFromProvider;
      }
      if (normalizedStatus === 'completed' || normalizedStatus === 'confirmed') {
        updateData.status = fullyRefunded ? PaymentStatus.REFUNDED : PaymentStatus.COMPLETED;
      }

      const updatedPayment = await this.updatePayment(payment.id, updateData);

      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'Refund callback processed successfully',
        'BillingService',
        {
          clinicId,
          paymentId: payment.id,
          refundId,
          provider: normalizedProvider || 'unknown',
          state: normalizedStatus,
          fullyRefunded,
        }
      );

      return {
        payment: updatedPayment,
        refund: providerRefundStatus || {
          success: normalizedStatus !== 'failed',
          refundId,
          paymentId: payment.id,
          amount: refundAmountFromProvider || 0,
          status:
            normalizedStatus === 'failed'
              ? 'failed'
              : normalizedStatus === 'completed' || normalizedStatus === 'confirmed'
                ? 'completed'
                : 'processing',
          provider: normalizedProvider || 'unknown',
          timestamp: new Date(),
        },
      };
    } catch (error) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        `Failed to process refund callback: ${error instanceof Error ? error.message : String(error)}`,
        'BillingService',
        {
          clinicId,
          paymentId,
          refundId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Reconcile legacy paid appointments that are still stuck in SCHEDULED state.
   * This keeps the database aligned with completed payment records.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async reconcileLegacyPaidAppointments(): Promise<{ reconciled: number }> {
    try {
      const completedPayments = await this.databaseService.findPaymentsSafe({
        status: PaymentStatus.COMPLETED,
      });

      const latestPaymentByAppointment = new Map<string, (typeof completedPayments)[number]>();
      const sortedPayments = [...completedPayments].sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
      );

      for (const payment of sortedPayments) {
        if (!payment.appointmentId || latestPaymentByAppointment.has(payment.appointmentId)) {
          continue;
        }

        const appointment = await this.databaseService.findAppointmentByIdSafe(
          payment.appointmentId
        );
        if (!appointment) {
          continue;
        }

        const normalizedStatus = String(appointment.status || '')
          .trim()
          .toUpperCase();
        if (
          normalizedStatus !== String(AppointmentStatus.SCHEDULED) &&
          normalizedStatus !== 'PENDING_PAYMENT' &&
          normalizedStatus !== 'AWAITING_PAYMENT'
        ) {
          continue;
        }

        latestPaymentByAppointment.set(payment.appointmentId, payment);
      }

      let reconciled = 0;
      for (const [appointmentId, payment] of latestPaymentByAppointment.entries()) {
        const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);
        if (!appointment) {
          continue;
        }

        const currentStatus = String(appointment.status || '')
          .trim()
          .toUpperCase();
        if (currentStatus === String(AppointmentStatus.CONFIRMED)) {
          continue;
        }

        await this.loggingService.log(
          LogType.APPOINTMENT,
          LogLevel.INFO,
          'Reconciling legacy paid appointment to CONFIRMED',
          'BillingService',
          {
            appointmentId,
            paymentId: payment.id,
            clinicId: payment.clinicId,
            previousStatus: currentStatus,
            nextStatus: String(AppointmentStatus.CONFIRMED),
          }
        );

        await this.eventService.emit('payment.completed', {
          appointmentId,
          paymentId: payment.id,
          status: 'completed',
          clinicId: payment.clinicId,
          appointment,
        });

        reconciled++;
      }

      if (reconciled > 0) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          `Reconciled ${reconciled} legacy paid appointment(s) to CONFIRMED`,
          'BillingService',
          { reconciled }
        );
      }

      return { reconciled };
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to reconcile legacy paid appointments: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'BillingService',
        {
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      return { reconciled: 0 };
    }
  }

  async cancelSubscriptionAppointment(appointmentId: string, requester?: BillingAccessContext) {
    const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);

    // Type-safe check for subscription properties
    if (!appointment || !('subscriptionId' in appointment) || !appointment.subscriptionId) {
      return;
    }
    const linkedSubscriptionId = appointment.subscriptionId;

    // Get subscription with proper type checking (fresh: the quota decision needs the real row)
    const subscription = await this.subscriptionStore.readSubscription(
      linkedSubscriptionId,
      appointment.clinicId ?? requester?.clinicId ?? ''
    );

    if (!subscription) {
      return;
    }

    this.assertBillingEntityAccess(subscription, requester);

    // Idempotent: the link is cleared by a conditional statement on `subscriptionId = X` and the
    // quota slot is restored only when THAT statement matched - repeated calls restore nothing,
    // and the slot never goes above the plan limit.
    const outcome = await this.subscriptionStore.releaseAppointment({
      subscription,
      appointmentId,
    });
    if (outcome === 'not-linked') {
      return;
    }

    try {
      await this.databaseService.invalidateEntityCache(
        'subscription',
        linkedSubscriptionId,
        subscription.clinicId
      );
    } catch {
      // Best effort: entries age out via their TTL.
    }
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Subscription appointment cancelled, quota restored',
      'BillingService',
      {
        subscriptionId: linkedSubscriptionId,
        appointmentId,
      }
    );

    await this.eventService.emit('billing.appointment.cancelled', {
      subscriptionId: linkedSubscriptionId,
      appointmentId,
    });

    await this.invalidateSubscriptionCaches(subscription.userId, linkedSubscriptionId);
  }

  async getActiveUserSubscription(
    userId: string,
    clinicId?: string,
    requester?: BillingAccessContext
  ) {
    if (requester?.role === 'PATIENT' && requester.userId !== userId) {
      throw new BadRequestException('You can only view your own subscriptions');
    }

    // The guard-validated clinic wins over a client-supplied one; only SUPER_ADMIN (who has no
    // clinic of its own) may name any clinic.
    const scopedClinicId =
      requester?.role !== 'SUPER_ADMIN' && requester?.clinicId ? requester.clinicId : clinicId;

    const subscriptions = await this.databaseService.findSubscriptionsSafe({
      userId,
      ...(scopedClinicId ? { clinicId: scopedClinicId } : {}),
    });

    const now = new Date();
    const subscription = subscriptions
      .filter(sub => {
        if (scopedClinicId && sub.clinicId !== scopedClinicId) {
          return false;
        }
        const status = sub.status as SubscriptionStatus;
        if (status !== SubscriptionStatus.ACTIVE && status !== SubscriptionStatus.TRIALING) {
          return false;
        }
        const targetDate = sub.currentPeriodEnd || sub.endDate;
        return !targetDate || new Date(targetDate) >= now;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

    return subscription ? this.decorateSubscriptionRow(subscription) : subscription;
  }

  async getSubscriptionUsageStats(subscriptionId: string, requester?: BillingAccessContext) {
    const subscription = await this.getSubscription(subscriptionId, requester);

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

  async resetSubscriptionQuota(subscriptionId: string, requester?: BillingAccessContext) {
    const subscription = await this.getSubscription(subscriptionId, requester);

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
      subscription,
    });
    await this.invalidateSubscriptionCaches(subscription.userId, subscriptionId);
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

    const [payments, invoices, activeSubscriptions] = await Promise.all([
      this.databaseService.findPaymentsSafe(where),
      this.databaseService.findInvoicesSafe({ clinicId }),
      this.databaseService.findSubscriptionsSafe({
        clinicId,
        status: SubscriptionStatus.ACTIVE,
      } as SubscriptionWhereInput),
    ]);

    const totalPaise = payments.reduce(
      (sum, payment) => sum + this.toPaise(Number(payment.amount) || 0),
      0
    );
    const totalRevenue = this.fromPaise(totalPaise);

    // Revenue per calendar month (IST), oldest first; `monthlyRevenue` is the current month.
    const byMonth = new Map<string, { paise: number; paymentCount: number }>();
    for (const payment of payments) {
      const key = this.monthKeyInIST(new Date(payment.createdAt));
      const bucket = byMonth.get(key) ?? { paise: 0, paymentCount: 0 };
      byMonth.set(key, {
        paise: bucket.paise + this.toPaise(Number(payment.amount) || 0),
        paymentCount: bucket.paymentCount + 1,
      });
    }
    const revenueByMonth = [...byMonth.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([month, bucket]) => ({
        month,
        revenue: this.fromPaise(bucket.paise),
        paymentCount: bucket.paymentCount,
      }));
    const currentMonth = this.monthKeyInIST(new Date());

    // Full payment rows are PHI and were never needed by the dashboards: summary figures only.
    return {
      totalRevenue,
      paymentCount: payments.length,
      averagePayment:
        payments.length > 0 ? this.fromPaise(Math.round(totalPaise / payments.length)) : 0,
      monthlyRevenue: this.fromPaise(byMonth.get(currentMonth)?.paise ?? 0),
      revenueByMonth,
      activeSubscriptions: activeSubscriptions.length,
      totalInvoices: invoices.length,
      pendingInvoices: invoices.filter(
        invoice => String(invoice.status) === String(InvoiceStatus.PENDING)
      ).length,
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
   * Build the PDF payload for an invoice after access checks have passed.
   */
  async buildInvoicePDFData(
    invoiceId: string,
    accessContext?: BillingAccessContext
  ): Promise<InvoicePDFData> {
    const invoice = accessContext
      ? await this.getInvoice(invoiceId, accessContext)
      : await this.databaseService.findInvoiceByIdSafe(invoiceId);

    if (!invoice) {
      throw new NotFoundException(`Invoice ${invoiceId} not found`);
    }

    const invoiceUserId = String(invoice.userId ?? '');
    const invoiceClinicId = String(invoice.clinicId ?? '');

    // Get user details
    const subscriptionUser = invoice.subscription as {
      user?: { name: string | null; email: string; phone: string | null };
    } | null;
    const subscriptionUserData = subscriptionUser?.user;
    const fetchedUser = await this.databaseService.findUserByIdSafe(invoiceUserId);

    // Use type-safe user data - prefer fetched user as it has all properties
    const user = fetchedUser || subscriptionUserData;

    if (!user) {
      throw new NotFoundException(`User ${invoiceUserId} not found`);
    }

    // Get clinic details
    const clinic = await this.databaseService.findClinicByIdSafe(invoiceClinicId);

    if (!clinic) {
      throw new NotFoundException(`Clinic ${invoiceClinicId} not found`);
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

    const subscriptionPlanName =
      invoice.subscription &&
      typeof invoice.subscription === 'object' &&
      'plan' in invoice.subscription &&
      invoice.subscription.plan &&
      typeof invoice.subscription.plan === 'object' &&
      'name' in invoice.subscription.plan &&
      typeof invoice.subscription.plan.name === 'string'
        ? invoice.subscription.plan.name
        : null;

    const subscriptionPeriod =
      invoice.subscription &&
      typeof invoice.subscription === 'object' &&
      'currentPeriodStart' in invoice.subscription &&
      'currentPeriodEnd' in invoice.subscription
        ? `${formatDateInIST(String(invoice.subscription.currentPeriodStart), {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
          })} - ${formatDateInIST(String(invoice.subscription.currentPeriodEnd), {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
          })}`
        : null;

    const pdfData: InvoicePDFData = {
      invoiceNumber: String(invoice.invoiceNumber ?? invoiceId),
      gatewayOrderId: this.buildGatewayOrderId(
        String(invoice.invoiceNumber ?? invoiceId),
        String(invoice.id ?? invoiceId)
      ),
      invoiceDate: new Date(invoice.createdAt),
      dueDate: new Date(invoice.dueDate),
      status: String(invoice.status ?? 'PENDING'),

      clinicName: String(clinic.name ?? 'Clinic'),
      ...(clinic.address ? { clinicAddress: clinic.address } : {}),
      ...(clinic.phone ? { clinicPhone: clinic.phone } : {}),
      ...(clinic.email ? { clinicEmail: clinic.email } : {}),

      userName: getUserName(user),
      ...('email' in user && user.email ? { userEmail: user.email } : {}),
      ...('phone' in user && user.phone ? { userPhone: user.phone } : {}),
      ...(subscriptionPlanName ? { subscriptionPlan: subscriptionPlanName } : {}),
      ...(subscriptionPeriod ? { subscriptionPeriod } : {}),

      lineItems: Array.isArray(invoice.lineItems)
        ? (invoice.lineItems as Array<{
            description: string;
            amount: number;
            quantity?: number;
            unitPrice?: number;
          }>)
        : [
            {
              description: String(invoice.description ?? 'Subscription Payment'),
              amount: Number(invoice.amount ?? 0),
            },
          ],

      subtotal: Number(invoice.amount ?? 0),
      tax: Number(invoice.tax ?? 0),
      discount: Number(invoice.discount ?? 0),
      total: Number(invoice.totalAmount ?? invoice.amount ?? 0),

      ...(invoice.paidAt ? { paidAt: new Date(invoice.paidAt) } : {}),

      notes: `Thank you for your payment. This invoice is for ${
        subscriptionPlanName || 'services'
      }.`,
      termsAndConditions:
        'Payment is due within 30 days. Please include the invoice number with your payment.',
    };

    if (invoice.paidAt && invoice.id) {
      const payments = await this.databaseService.findPaymentsSafe({
        invoiceId: String(invoice.id),
      });

      const payment = payments.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

      if (payment) {
        if (payment.method) pdfData.paymentMethod = payment.method;
        if (payment.transactionId) pdfData.transactionId = payment.transactionId;
      }
    }

    return pdfData;
  }

  /**
   * Generate PDF for an invoice and persist the generated file metadata.
   */
  async generateInvoicePDF(invoiceId: string): Promise<void> {
    try {
      const invoice = await this.databaseService.findInvoiceByIdSafe(invoiceId);

      if (!invoice) {
        throw new NotFoundException(`Invoice ${invoiceId} not found`);
      }

      const pdfData = await this.buildInvoicePDFData(invoiceId);

      // Generate PDF
      const { filePath, fileName } = await this.invoicePDFService.generateInvoicePDF(pdfData);

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
      await this.invalidateUserInvoiceCaches(invoice.userId);
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
   * Send receipt via WhatsApp
   */
  async sendReceiptViaWhatsApp(receiptId: string): Promise<boolean> {
    return await this.withInvoiceWhatsAppSendLock(receiptId, async () => {
      try {
        const invoice = await this.databaseService.findInvoiceByIdSafe(receiptId);

        if (!invoice) {
          throw new NotFoundException(`Invoice ${receiptId} not found`);
        }

        if (invoice.sentViaWhatsApp) {
          await this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.INFO,
            'Skipping invoice WhatsApp delivery because invoice was already sent',
            'BillingService',
            { receiptId }
          );
          return true;
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
          await this.generateInvoicePDF(receiptId);

          // Fetch updated invoice
          const updatedInvoice = await this.databaseService.findInvoiceByIdSafe(receiptId);

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
        const paymentDate = formatDateInIST(
          invoice.paidAt ?? invoice.updatedAt ?? invoice.createdAt,
          {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
          }
        );
        const gatewayOrderId = this.buildGatewayOrderId(invoice.invoiceNumber, invoice.id);
        const receiptReference = `${invoice.invoiceNumber} | Ref: ${gatewayOrderId}`;
        const success = await this.whatsAppService.sendReceipt(
          userPhone,
          userName,
          receiptReference,
          invoice.totalAmount,
          paymentDate,
          invoice.pdfUrl || '',
          invoice.clinicId
        );

        if (success) {
          // Update invoice
          await this.databaseService.updateInvoiceSafe(receiptId, {
            sentViaWhatsApp: true,
            whatsappSentAt: new Date(),
          } as InvoiceUpdateInput);

          await this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.INFO,
            'Receipt sent via WhatsApp',
            'BillingService',
            { receiptId, userId: user.id }
          );

          await this.eventService.emit('billing.receipt.sent_whatsapp', {
            receiptId,
            userId: user.id,
            receiptReference,
          });
          await this.invalidateUserInvoiceCaches(invoice.userId);
        }

        return success;
      } catch (error) {
        await this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          'Failed to send receipt via WhatsApp',
          'BillingService',
          {
            error: error instanceof Error ? error.message : 'Unknown error',
            receiptId,
          }
        );
        return false;
      }
    });
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
        formatDateInIST(subscription.currentPeriodStart, {
          year: 'numeric',
          month: 'short',
          day: '2-digit',
        }),
        formatDateInIST(subscription.currentPeriodEnd, {
          year: 'numeric',
          month: 'short',
          day: '2-digit',
        })
      );

      // Check if invoice exists for this subscription
      const invoices = await this.databaseService.findInvoicesSafe({
        subscriptionId: subscription.id,
      });

      const invoice = invoices.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

      if (invoice) {
        // Send existing receipt via WhatsApp
        await this.sendReceiptViaWhatsApp(invoice.id);
      } else {
        // Create and send new receipt
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

        // Generate PDF and send receipt via WhatsApp
        await this.sendReceiptViaWhatsApp(newInvoice.id);
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

  /** Patient row owned by the given user (null when the user has no patient profile). */
  private async findOwnPatientId(userId: string): Promise<string | null> {
    const patient = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return (await typedClient.patient.findFirst({
        where: { userId } as PrismaDelegateArgs,
        select: { id: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as { id: string } | null;
    });
    return patient?.id ?? null;
  }

  /**
   * Staff may file claims only for a patient who belongs to the guard-validated clinic
   * (primary clinic or an appointment there).
   */
  private async assertPatientInClinic(patientId: string, clinicId: string): Promise<void> {
    const belongs = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      const patient = (await typedClient.patient.findFirst({
        where: {
          id: patientId,
          OR: [{ user: { primaryClinicId: clinicId } }, { appointments: { some: { clinicId } } }],
        } as PrismaDelegateArgs,
        select: { id: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as { id: string } | null;
      return Boolean(patient);
    });
    if (!belongs) {
      throw new NotFoundException('Patient not found');
    }
  }

  private async assertClaimLinksOwnedByPatient(
    data: CreateInsuranceClaimDto,
    patientId: string,
    userId: string | undefined,
    clinicId: string
  ): Promise<void> {
    if (!data.appointmentId && !data.invoiceId) {
      return;
    }
    const ok = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      if (data.appointmentId) {
        const appointment = await typedClient.appointment.findFirst({
          where: { id: data.appointmentId, patientId, clinicId } as PrismaDelegateArgs,
          select: { id: true } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        if (!appointment) return false;
      }
      if (data.invoiceId) {
        const invoice = await typedClient.invoice.findFirst({
          where: { id: data.invoiceId, userId, clinicId } as PrismaDelegateArgs,
          select: { id: true } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        if (!invoice) return false;
      }
      return true;
    });
    if (!ok) {
      throw new NotFoundException('Appointment or invoice not found');
    }
  }

  async createInsuranceClaim(data: CreateInsuranceClaimDto, requester: BillingAccessContext) {
    const clinicId = requester.clinicId;
    if (!clinicId || !requester.role) {
      throw new NotFoundException('Clinic context required');
    }

    if (requester.role === 'PATIENT') {
      // Fail closed: a patient can only claim for their own patient profile, and only against
      // their own appointment / invoice.
      const ownPatientId = requester.userId ? await this.findOwnPatientId(requester.userId) : null;
      if (!ownPatientId || data.patientId !== ownPatientId) {
        throw new NotFoundException('Patient not found');
      }
      await this.assertClaimLinksOwnedByPatient(data, ownPatientId, requester.userId, clinicId);
    } else if (requester.role !== 'SUPER_ADMIN') {
      await this.assertPatientInClinic(data.patientId, clinicId);
    }

    return await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        return await typedClient.insuranceClaim.create({
          data: {
            ...data,
            clinicId,
            status: 'SUBMITTED',
            submittedAt: new Date(),
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: requester.userId ?? 'system',
        clinicId,
        resourceType: 'INSURANCE_CLAIM',
        operation: 'CREATE',
        resourceId: 'new',
        userRole: requester.role,
        details: { claimNumber: data.claimNumber, amount: data.amount },
      }
    );
  }

  async updateInsuranceClaimStatus(id: string, data: UpdateInsuranceClaimDto, clinicId: string) {
    return await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        return await typedClient.insuranceClaim.update({
          // clinicId in the where: a claim of another clinic can never be updated by id alone.
          where: { id, clinicId } as PrismaDelegateArgs,
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

  async getInsuranceClaims(clinicId: string, requester?: BillingAccessContext) {
    let patientScope: { patientId?: string } = {};
    if (requester?.role === 'PATIENT') {
      // Fail closed: no patient profile -> no claims.
      const ownPatientId = requester.userId ? await this.findOwnPatientId(requester.userId) : null;
      if (!ownPatientId) {
        return [];
      }
      patientScope = { patientId: ownPatientId };
    }
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return await typedClient.insuranceClaim.findMany({
        where: { clinicId, ...patientScope } as PrismaDelegateArgs,
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
