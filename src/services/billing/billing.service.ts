import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { DatabaseService } from "../../libs/infrastructure/database";
import { CacheService } from "../../libs/infrastructure/cache";
import { LoggingService } from "../../libs/infrastructure/logging/logging.service";
import { EventService } from "../../libs/infrastructure/events/event.service";
import {
  LogLevel,
  LogType,
} from "../../libs/infrastructure/logging/types/logging.types";
import {
  CreateBillingPlanDto,
  UpdateBillingPlanDto,
  CreateSubscriptionDto,
  UpdateSubscriptionDto,
  CreatePaymentDto,
  UpdatePaymentDto,
  CreateInvoiceDto,
  UpdateInvoiceDto,
  SubscriptionStatus,
  InvoiceStatus,
  PaymentStatus,
} from "./dto/billing.dto";
import { InvoicePDFService } from "./invoice-pdf.service";
import { WhatsAppService } from "../../libs/communication/messaging/whatsapp/whatsapp.service";

// Type-safe interfaces for database operations
interface AppointmentWhereInput {
  subscriptionId?: string;
  status?: string;
}

interface SubscriptionUpdateInput {
  status?: string;
  endDate?: Date;
  cancelAtPeriodEnd?: boolean;
  metadata?: Record<string, string | number | boolean>;
}

interface InvoiceUpdateInput {
  status?: string;
  amount?: number;
  tax?: number;
  discount?: number;
  totalAmount?: number;
  dueDate?: Date;
  description?: string;
  lineItems?: Record<string, string | number | boolean>;
  metadata?: Record<string, string | number | boolean>;
  sentViaWhatsApp?: boolean;
  whatsappSentAt?: Date;
}

interface InvoicePDFData {
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate: Date;
  status: string;
  clinicName: string;
  clinicAddress?: string;
  clinicPhone?: string;
  clinicEmail?: string;
  userName: string;
  userEmail?: string;
  userPhone?: string;
  subscriptionPlan?: string;
  subscriptionPeriod?: string;
  lineItems: Array<{
    description: string;
    quantity?: number;
    unitPrice?: number;
    amount: number;
  }>;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paidAt?: Date;
  paymentMethod?: string;
  transactionId?: string;
  notes: string;
  termsAndConditions: string;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService,
    private readonly invoicePDFService: InvoicePDFService,
    private readonly whatsAppService: WhatsAppService,
  ) {}

  // ============ Billing Plans ============

  async createBillingPlan(data: CreateBillingPlanDto) {
    try {
      const plan = await this.databaseService.createBillingPlanSafe({
        name: data.name,
        amount: data.amount,
        currency: data.currency || "INR",
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
        "Billing plan created",
        "BillingService",
        { planId: plan.id, name: plan.name },
      );

      await this.eventService.emit("billing.plan.created", { planId: plan.id });
      await this.cacheService.invalidateCacheByTag("billing_plans");

      return plan;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        "Failed to create billing plan",
        "BillingService",
        {
          error: error instanceof Error ? error.message : "Unknown error",
          data,
        },
      );
      throw error;
    }
  }

  async getBillingPlans(clinicId?: string) {
    const cacheKey = `billing_plans:${clinicId || "all"}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        return await this.databaseService.findBillingPlansSafe({
          ...(clinicId ? { clinicId } : {}),
          isActive: true,
        });
      },
      {
        ttl: 1800,
        tags: ["billing_plans"],
        priority: "normal",
      },
    );
  }

  async getBillingPlan(id: string) {
    const plan = await this.databaseService.findBillingPlanByIdSafe(id);

    if (!plan) {
      throw new NotFoundException(`Billing plan with ID ${id} not found`);
    }

    return plan;
  }

  async updateBillingPlan(id: string, data: UpdateBillingPlanDto) {
    const plan = await this.databaseService.updateBillingPlanSafe(id, data);

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      "Billing plan updated",
      "BillingService",
      { planId: id },
    );

    await this.eventService.emit("billing.plan.updated", { planId: id });
    await this.cacheService.invalidateCacheByTag("billing_plans");

    return plan;
  }

  async deleteBillingPlan(id: string) {
    // Check if plan has active subscriptions
    const activeSubscriptions =
      await this.databaseService.findSubscriptionsSafe({
        planId: id,
        status: SubscriptionStatus.ACTIVE,
      });

    if (activeSubscriptions.length > 0) {
      throw new ConflictException(
        `Cannot delete plan with ${activeSubscriptions.length} active subscriptions`,
      );
    }

    await this.databaseService.deleteBillingPlanSafe(id);

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      "Billing plan deleted",
      "BillingService",
      { planId: id },
    );

    await this.eventService.emit("billing.plan.deleted", { planId: id });
    await this.cacheService.invalidateCacheByTag("billing_plans");
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
      plan.intervalCount,
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
        "Subscription created",
        "BillingService",
        { subscriptionId: subscription.id, userId: data.userId },
      );

      await this.eventService.emit("billing.subscription.created", {
        subscriptionId: subscription.id,
        userId: data.userId,
      });

      await this.cacheService.invalidateCacheByTag(
        `user_subscriptions:${data.userId}`,
      );

      return subscription;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        "Failed to create subscription",
        "BillingService",
        {
          error: error instanceof Error ? error.message : "Unknown error",
          data,
        },
      );
      throw error;
    }
  }

  async getUserSubscriptions(userId: string) {
    const cacheKey = `user_subscriptions:${userId}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        return await this.databaseService.findSubscriptionsSafe({
          userId,
        });
      },
      {
        ttl: 900,
        tags: [`user_subscriptions:${userId}`],
        priority: "high",
      },
    );
  }

  async getSubscription(id: string) {
    const subscription =
      await this.databaseService.findSubscriptionByIdSafe(id);

    if (!subscription) {
      throw new NotFoundException(`Subscription with ID ${id} not found`);
    }

    return subscription;
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

    const subscription = await this.databaseService.updateSubscriptionSafe(
      id,
      updateData,
    );

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      "Subscription updated",
      "BillingService",
      { subscriptionId: id },
    );

    await this.eventService.emit("billing.subscription.updated", {
      subscriptionId: id,
    });
    await this.cacheService.invalidateCacheByTag(
      `user_subscriptions:${subscription.userId}`,
    );

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

    const updated = await this.databaseService.updateSubscriptionSafe(
      id,
      updateData,
    );

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      "Subscription cancelled",
      "BillingService",
      { subscriptionId: id, immediate },
    );

    await this.eventService.emit("billing.subscription.cancelled", {
      subscriptionId: id,
      immediate,
    });

    await this.cacheService.invalidateCacheByTag(
      `user_subscriptions:${subscription.userId}`,
    );

    return updated;
  }

  async renewSubscription(id: string) {
    const subscription = await this.getSubscription(id);

    if (String(subscription.status) === "ACTIVE") {
      throw new BadRequestException("Subscription is already active");
    }

    const currentPeriodStart = new Date();
    const currentPeriodEnd = this.calculatePeriodEnd(
      currentPeriodStart,
      subscription.plan?.interval || "MONTHLY",
      subscription.plan?.intervalCount || 1,
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
      "Subscription renewed",
      "BillingService",
      { subscriptionId: id },
    );

    await this.eventService.emit("billing.subscription.renewed", {
      subscriptionId: id,
    });
    await this.cacheService.invalidateCacheByTag(
      `user_subscriptions:${subscription.userId}`,
    );

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
        "Invoice created",
        "BillingService",
        { invoiceId: invoice.id, invoiceNumber },
      );

      await this.eventService.emit("billing.invoice.created", {
        invoiceId: invoice.id,
      });
      await this.cacheService.invalidateCacheByTag(
        `user_invoices:${data.userId}`,
      );

      return invoice;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        "Failed to create invoice",
        "BillingService",
        {
          error: error instanceof Error ? error.message : "Unknown error",
          data,
        },
      );
      throw error;
    }
  }

  async getUserInvoices(userId: string) {
    const cacheKey = `user_invoices:${userId}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        return await this.databaseService.findInvoicesSafe({
          userId,
        });
      },
      {
        ttl: 900,
        tags: [`user_invoices:${userId}`],
        priority: "normal",
      },
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

    if (
      data.amount !== undefined ||
      data.tax !== undefined ||
      data.discount !== undefined
    ) {
      const invoice = await this.databaseService.findInvoiceByIdSafe(id);
      if (!invoice) {
        throw new NotFoundException(`Invoice with ID ${id} not found`);
      }

      const amount = data.amount ?? invoice.amount;
      const tax = data.tax ?? invoice.tax ?? 0;
      const discount = data.discount ?? invoice.discount ?? 0;
      updateData.totalAmount = amount + tax - discount;
    }

    // Convert string dates to Date objects
    if (updateData.dueDate && typeof updateData.dueDate === "string") {
      (updateData as any).dueDate = new Date(updateData.dueDate);
    }

    const invoice = await this.databaseService.updateInvoiceSafe(id, {
      ...updateData,
      ...(updateData.dueDate && { dueDate: new Date(updateData.dueDate) }),
    } as InvoiceUpdateInput);

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      "Invoice updated",
      "BillingService",
      { invoiceId: id },
    );

    await this.eventService.emit("billing.invoice.updated", { invoiceId: id });
    await this.cacheService.invalidateCacheByTag(
      `user_invoices:${invoice.userId}`,
    );

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
      "Invoice marked as paid",
      "BillingService",
      { invoiceId: id },
    );

    await this.eventService.emit("billing.invoice.paid", { invoiceId: id });
    await this.cacheService.invalidateCacheByTag(
      `user_invoices:${invoice.userId}`,
    );

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
        "Payment created",
        "BillingService",
        { paymentId: payment.id, amount: payment.amount },
      );

      await this.eventService.emit("billing.payment.created", {
        paymentId: payment.id,
      });

      if (data.userId) {
        await this.cacheService.invalidateCacheByTag(
          `user_payments:${data.userId}`,
        );
      }

      return payment;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        "Failed to create payment",
        "BillingService",
        {
          error: error instanceof Error ? error.message : "Unknown error",
          data,
        },
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
      "Payment updated",
      "BillingService",
      { paymentId: id },
    );

    await this.eventService.emit("billing.payment.updated", { paymentId: id });

    const paymentWithUserId = payment as { userId?: string };
    if (paymentWithUserId.userId) {
      await this.cacheService.invalidateCacheByTag(
        `user_payments:${paymentWithUserId.userId}`,
      );
    }

    // Auto-update invoice if payment is linked to one
    const paymentWithInvoiceId = payment as { invoiceId?: string };
    if (paymentWithInvoiceId.invoiceId && String(data.status) === "COMPLETED") {
      await this.markInvoiceAsPaid(paymentWithInvoiceId.invoiceId);
    }

    return payment;
  }

  async getUserPayments(userId: string) {
    const cacheKey = `user_payments:${userId}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        return await this.databaseService.findPaymentsSafe({
          userId,
        });
      },
      {
        ttl: 900,
        tags: [`user_payments:${userId}`],
        priority: "normal",
      },
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

  private calculatePeriodEnd(
    start: Date,
    interval: string,
    intervalCount: number,
  ): Date {
    const end = new Date(start);

    switch (interval) {
      case "DAILY":
        end.setDate(end.getDate() + intervalCount);
        break;
      case "WEEKLY":
        end.setDate(end.getDate() + intervalCount * 7);
        break;
      case "MONTHLY":
        end.setMonth(end.getMonth() + intervalCount);
        break;
      case "QUARTERLY":
        end.setMonth(end.getMonth() + intervalCount * 3);
        break;
      case "YEARLY":
        end.setFullYear(end.getFullYear() + intervalCount);
        break;
    }

    return end;
  }

  private async generateInvoiceNumber(): Promise<string> {
    const COUNTER_KEY = "invoice:counter";
    const currentId = await this.cacheService.get(COUNTER_KEY);
    const nextId = currentId ? parseInt(currentId as string) + 1 : 1;
    await this.cacheService.set(COUNTER_KEY, nextId.toString());

    const year = new Date().getFullYear();
    return `INV-${year}-${nextId.toString().padStart(6, "0")}`;
  }

  // ============ Subscription Appointment Management ============

  async canBookAppointment(
    subscriptionId: string,
    appointmentType?: string,
  ): Promise<{
    allowed: boolean;
    requiresPayment?: boolean;
    paymentAmount?: number;
    reason?: string;
  }> {
    const subscription =
      await this.databaseService.findSubscriptionByIdSafe(subscriptionId);

    if (!subscription) {
      return { allowed: false, reason: "Subscription not found" };
    }

    if (
      String(subscription.status) !== "ACTIVE" &&
      String(subscription.status) !== "TRIALING"
    ) {
      return {
        allowed: false,
        reason: `Subscription is ${subscription.status.toLowerCase()}`,
      };
    }

    // Check if current period has ended
    if (new Date() > subscription.currentPeriodEnd) {
      return { allowed: false, reason: "Subscription period has ended" };
    }

    // Check if specific appointment type is covered
    if (appointmentType && subscription.plan?.appointmentTypes) {
      const appointmentTypes = subscription.plan.appointmentTypes;
      const isCovered = appointmentTypes[appointmentType] === true;

      if (!isCovered) {
        // Get payment amount from metadata
        const metadata =
          (subscription.plan?.metadata as Record<
            string,
            string | number | boolean
          >) || {};
        const paymentKey = `${appointmentType.toLowerCase()}Price`;
        const paymentAmount =
          Number(metadata[paymentKey]) ||
          this.getDefaultAppointmentPrice(appointmentType);

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
        reason: "Plan does not include appointments",
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
        reason: "Appointment quota exceeded for this period",
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

  async checkAppointmentCoverage(
    subscriptionId: string,
    appointmentType: string,
  ) {
    const result = await this.canBookAppointment(
      subscriptionId,
      appointmentType,
    );

    if (result.allowed) {
      const subscription =
        await this.databaseService.findSubscriptionByIdSafe(subscriptionId);

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
  ) {
    const canBook = await this.canBookAppointment(subscriptionId);

    if (!canBook.allowed) {
      throw new BadRequestException(canBook.reason);
    }

    const subscription =
      await this.databaseService.findSubscriptionByIdSafe(subscriptionId);

    if (!subscription) {
      throw new NotFoundException("Subscription not found");
    }

    // Update appointment to link with subscription
    // Note: subscriptionId and isSubscriptionBased are not part of AppointmentUpdateInput
    // This would need to be handled through a direct Prisma call or a custom method
    const prismaClient = this.databaseService.getPrismaClient() as {
      appointment: {
        update: (args: {
          where: { id: string };
          data: { subscriptionId: string; isSubscriptionBased: boolean };
        }) => Promise<{
          id: string;
          subscriptionId: string;
          isSubscriptionBased: boolean;
        }>;
      };
    };
    await prismaClient.appointment.update({
      where: { id: appointmentId },
      data: {
        subscriptionId,
        isSubscriptionBased: true,
      },
    });

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
      "Appointment booked with subscription",
      "BillingService",
      { subscriptionId, appointmentId },
    );

    await this.eventService.emit("billing.appointment.booked", {
      subscriptionId,
      appointmentId,
    });
    await this.cacheService.invalidateCacheByTag(
      `user_subscriptions:${subscription.userId}`,
    );
  }

  async cancelSubscriptionAppointment(appointmentId: string) {
    const appointment =
      await this.databaseService.findAppointmentByIdSafe(appointmentId);

    const appointmentWithSubscription = appointment as {
      subscriptionId?: string;
      subscription?: {
        plan: { isUnlimitedAppointments: boolean };
        appointmentsRemaining: number | null;
        userId: string;
      };
    };
    if (
      !appointment ||
      !appointmentWithSubscription.subscriptionId ||
      !appointmentWithSubscription.subscription
    ) {
      return;
    }

    // Restore appointment quota if not unlimited
    const subscription = appointmentWithSubscription.subscription;
    if (!subscription?.plan?.isUnlimitedAppointments) {
      await this.databaseService.updateSubscriptionSafe(
        appointmentWithSubscription.subscriptionId,
        {
          appointmentsUsed:
            subscription?.appointmentsRemaining !== null
              ? subscription.appointmentsRemaining + 1
              : 1,
          ...(subscription?.appointmentsRemaining !== null && {
            appointmentsRemaining: subscription.appointmentsRemaining + 1,
          }),
        },
      );
    }

    const appointmentSubscription = appointmentWithSubscription.subscription;
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      "Subscription appointment cancelled, quota restored",
      "BillingService",
      {
        subscriptionId: appointmentWithSubscription.subscriptionId,
        appointmentId,
      },
    );

    await this.eventService.emit("billing.appointment.cancelled", {
      subscriptionId: appointmentWithSubscription.subscriptionId,
      appointmentId,
    });

    await this.cacheService.invalidateCacheByTag(
      `user_subscriptions:${appointmentSubscription?.userId}`,
    );
  }

  async getActiveUserSubscription(userId: string, clinicId: string) {
    const subscriptions = await this.databaseService.findSubscriptionsSafe({
      userId,
      clinicId,
    });

    const subscription = subscriptions
      .filter(
        (sub) =>
          (String(sub.status) === "ACTIVE" ||
            String(sub.status) === "TRIALING") &&
          sub.currentPeriodEnd >= new Date(),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

    return subscription;
  }

  async getSubscriptionUsageStats(subscriptionId: string) {
    const subscription = await this.getSubscription(subscriptionId);

    const appointments = await this.databaseService.findAppointmentsSafe({
      subscriptionId,
      status: "SCHEDULED",
    } as AppointmentWhereInput);

    const appointmentCount = appointments.length;

    return {
      subscriptionId,
      planName: subscription.plan?.name || "",
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
      "Subscription quota reset",
      "BillingService",
      { subscriptionId },
    );

    await this.eventService.emit("billing.subscription.quota_reset", {
      subscriptionId,
    });
    await this.cacheService.invalidateCacheByTag(
      `user_subscriptions:${subscription.userId}`,
    );
  }

  // ============ Analytics ============

  async getClinicRevenue(clinicId: string, startDate?: Date, endDate?: Date) {
    const where: {
      clinicId: string;
      status: typeof PaymentStatus.COMPLETED;
      createdAt?: {
        gte?: Date;
        lte?: Date;
      };
    } = {
      clinicId,
      status: PaymentStatus.COMPLETED,
    };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const payments = await this.databaseService.findPaymentsSafe(where);

    const totalRevenue = payments.reduce(
      (sum: number, payment: { amount: number }) => sum + payment.amount,
      0,
    );

    return {
      totalRevenue,
      paymentCount: payments.length,
      averagePayment: payments.length > 0 ? totalRevenue / payments.length : 0,
      payments,
    };
  }

  async getSubscriptionMetrics(clinicId: string) {
    const subscriptions = await this.databaseService.findSubscriptionsSafe({
      clinicId,
    });

    type SubscriptionWithPlan = (typeof subscriptions)[number];

    const active = subscriptions.filter(
      (s: SubscriptionWithPlan) => String(s.status) === "ACTIVE",
    ).length;
    const trialing = subscriptions.filter(
      (s: SubscriptionWithPlan) => String(s.status) === "TRIALING",
    ).length;
    const cancelled = subscriptions.filter(
      (s: SubscriptionWithPlan) => String(s.status) === "CANCELLED",
    ).length;
    const pastDue = subscriptions.filter(
      (s: SubscriptionWithPlan) => String(s.status) === "PAST_DUE",
    ).length;

    const monthlyRecurringRevenue = subscriptions
      .filter((s: SubscriptionWithPlan) => String(s.status) === "ACTIVE")
      .reduce((sum: number, sub: SubscriptionWithPlan) => {
        const planAmount = sub.plan?.amount || 0;
        const monthlyAmount =
          sub.plan?.interval === "MONTHLY"
            ? planAmount
            : sub.plan?.interval === "YEARLY"
              ? planAmount / 12
              : sub.plan?.interval === "QUARTERLY"
                ? planAmount / 3
                : sub.plan?.interval === "WEEKLY"
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
      churnRate:
        subscriptions.length > 0 ? (cancelled / subscriptions.length) * 100 : 0,
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
        user?: { name: string; email: string; phone: string };
      } | null;
      const user =
        subscriptionUser?.user ||
        (await this.databaseService.findUserByIdSafe(invoice.userId));

      if (!user) {
        throw new NotFoundException(`User ${invoice.userId} not found`);
      }

      // Get clinic details
      const clinic = (await this.databaseService.findClinicByIdSafe(
        invoice.clinicId,
      )) as {
        name: string;
        address?: string;
        phone?: string;
        email?: string;
      } | null;

      if (!clinic) {
        throw new NotFoundException(`Clinic ${invoice.clinicId} not found`);
      }

      // Prepare PDF data
      const pdfData = {
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.createdAt,
        dueDate: invoice.dueDate,
        status: invoice.status,

        // Clinic details
        clinicName: (
          clinic as {
            name: string;
            address?: string;
            phone?: string;
            email?: string;
          }
        ).name,
        clinicAddress:
          (
            clinic as {
              name: string;
              address?: string;
              phone?: string;
              email?: string;
            }
          ).address || undefined,
        clinicPhone:
          (
            clinic as {
              name: string;
              address?: string;
              phone?: string;
              email?: string;
            }
          ).phone || undefined,
        clinicEmail:
          (
            clinic as {
              name: string;
              address?: string;
              phone?: string;
              email?: string;
            }
          ).email || undefined,

        // User details
        userName: (user as { name: string; email?: string; phone?: string })
          .name,
        userEmail:
          (user as { name: string; email?: string; phone?: string }).email ||
          undefined,
        userPhone:
          (user as { name: string; email?: string; phone?: string }).phone ||
          undefined,

        // Subscription details
        subscriptionPlan: invoice.subscription?.plan?.name,
        subscriptionPeriod: invoice.subscription
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
                description: invoice.description || "Subscription Payment",
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

        // Notes
        notes: `Thank you for your payment. This invoice is for ${invoice.subscription?.plan?.name || "services"}.`,
        termsAndConditions:
          "Payment is due within 30 days. Please include the invoice number with your payment.",
      };

      // Get payment details if invoice is paid
      if (invoice.paidAt) {
        const payments = await this.databaseService.findPaymentsSafe({
          invoiceId: invoice.id,
        });

        const payment = payments.sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
        )[0];

        if (payment) {
          pdfData.paymentMethod = payment.method as string;
          pdfData.transactionId = payment.transactionId as string;
        }
      }

      // Generate PDF
      const { filePath, fileName } =
        await this.invoicePDFService.generateInvoicePDF(
          pdfData as InvoicePDFData,
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
        "Invoice PDF generated",
        "BillingService",
        { invoiceId, fileName },
      );

      await this.eventService.emit("billing.invoice.pdf_generated", {
        invoiceId,
        pdfUrl,
      });
      await this.cacheService.invalidateCacheByTag(
        `user_invoices:${invoice.userId}`,
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        "Failed to generate invoice PDF",
        "BillingService",
        {
          error: error instanceof Error ? error.message : "Unknown error",
          invoiceId,
        },
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
        user?: { phone?: string; id: string };
      } | null;
      const user =
        subscriptionUser?.user ||
        (await this.databaseService.findUserByIdSafe(invoice.userId));

      if (!user) {
        throw new NotFoundException(`User ${invoice.userId} not found`);
      }

      const userWithPhone = user as { phone?: string; id: string };
      if (!userWithPhone.phone) {
        throw new BadRequestException(
          `User ${userWithPhone.id} has no phone number`,
        );
      }

      // Generate PDF if not already generated
      if (!invoice.pdfUrl || !invoice.pdfFilePath) {
        await this.generateInvoicePDF(invoiceId);

        // Fetch updated invoice
        const updatedInvoice =
          await this.databaseService.findInvoiceByIdSafe(invoiceId);

        if (!updatedInvoice?.pdfUrl) {
          throw new Error("Failed to generate invoice PDF");
        }

        invoice.pdfUrl = updatedInvoice.pdfUrl;
      }

      // Send via WhatsApp
      const userForWhatsApp = user as {
        phone: string;
        name: string;
      };
      const success = await this.whatsAppService.sendInvoice(
        userForWhatsApp.phone,
        userForWhatsApp.name,
        invoice.invoiceNumber,
        invoice.totalAmount,
        invoice.dueDate.toLocaleDateString(),
        invoice.pdfUrl,
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
          "Invoice sent via WhatsApp",
          "BillingService",
          { invoiceId, userId: user.id },
        );

        await this.eventService.emit("billing.invoice.sent_whatsapp", {
          invoiceId,
          userId: user.id,
        });
        await this.cacheService.invalidateCacheByTag(
          `user_invoices:${invoice.userId}`,
        );
      }

      return success;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        "Failed to send invoice via WhatsApp",
        "BillingService",
        {
          error: error instanceof Error ? error.message : "Unknown error",
          invoiceId,
        },
      );
      return false;
    }
  }

  /**
   * Send subscription confirmation via WhatsApp and generate invoice
   */
  async sendSubscriptionConfirmation(subscriptionId: string): Promise<void> {
    try {
      const subscription =
        await this.databaseService.findSubscriptionByIdSafe(subscriptionId);

      if (!subscription) {
        throw new NotFoundException(`Subscription ${subscriptionId} not found`);
      }

      const subscriptionUser = subscription as {
        user?: { phone?: string; id: string; name: string };
      };
      const user = subscriptionUser.user;
      const subscriptionPlan = subscription.plan as {
        name: string;
        amount: number;
      };
      if (!user?.phone) {
        this.logger.warn(
          `User ${user?.id} has no phone number, skipping WhatsApp confirmation`,
        );
        return;
      }

      // Send subscription confirmation
      await this.whatsAppService.sendSubscriptionConfirmation(
        user.phone,
        user.name,
        subscriptionPlan.name,
        subscriptionPlan.amount,
        subscription.currentPeriodStart.toLocaleDateString(),
        subscription.currentPeriodEnd.toLocaleDateString(),
      );

      // Check if invoice exists for this subscription
      const invoices = await this.databaseService.findInvoicesSafe({
        subscriptionId: subscription.id,
      });

      const invoice = invoices.sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      )[0];

      if (invoice) {
        // Send existing invoice via WhatsApp
        await this.sendInvoiceViaWhatsApp(invoice.id);
      } else {
        // Create and send new invoice
        const newInvoice = await this.createInvoice({
          userId: subscription.userId,
          subscriptionId: subscription.id,
          clinicId: subscription.clinicId,
          amount: subscription.plan?.amount || 0,
          tax: (subscription.plan?.amount || 0) * 0.18, // 18% GST
          dueDate: subscription.currentPeriodEnd.toISOString(),
          description: `Subscription: ${subscription.plan?.name || "Unknown Plan"}`,
          lineItems: {
            items: [
              {
                description: subscription.plan?.name || "Unknown Plan",
                quantity: 1,
                unitPrice: subscription.plan?.amount || 0,
                amount: subscription.plan?.amount || 0,
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
        "Subscription confirmation sent",
        "BillingService",
        { subscriptionId },
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        "Failed to send subscription confirmation",
        "BillingService",
        {
          error: error instanceof Error ? error.message : "Unknown error",
          subscriptionId,
        },
      );
    }
  }
}
