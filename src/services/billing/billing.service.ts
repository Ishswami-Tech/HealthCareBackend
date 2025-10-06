import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../libs/infrastructure/database/prisma/prisma.service";
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

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService,
    private readonly invoicePDFService: InvoicePDFService,
    private readonly whatsAppService: WhatsAppService,
  ) {}

  // ============ Billing Plans ============

  async createBillingPlan(data: CreateBillingPlanDto) {
    try {
      const plan = await this.prisma.billingPlan.create({
        data: {
          name: data.name,
          description: data.description,
          amount: data.amount,
          currency: data.currency || "INR",
          interval: data.interval,
          intervalCount: data.intervalCount || 1,
          trialPeriodDays: data.trialPeriodDays,
          features: data.features,
          clinicId: data.clinicId,
          metadata: data.metadata,
        },
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
        return await this.prisma.billingPlan.findMany({
          where: {
            ...(clinicId ? { clinicId } : {}),
            isActive: true,
          },
          orderBy: { amount: "asc" },
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
    const plan = await this.prisma.billingPlan.findUnique({
      where: { id },
    });

    if (!plan) {
      throw new NotFoundException(`Billing plan with ID ${id} not found`);
    }

    return plan;
  }

  async updateBillingPlan(id: string, data: UpdateBillingPlanDto) {
    const plan = await this.prisma.billingPlan.update({
      where: { id },
      data,
    });

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
    const activeSubscriptions = await this.prisma.subscription.count({
      where: {
        planId: id,
        status: SubscriptionStatus.ACTIVE,
      },
    });

    if (activeSubscriptions > 0) {
      throw new ConflictException(
        `Cannot delete plan with ${activeSubscriptions} active subscriptions`,
      );
    }

    await this.prisma.billingPlan.delete({
      where: { id },
    });

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
      const subscription = await this.prisma.subscription.create({
        data: {
          userId: data.userId,
          planId: data.planId,
          clinicId: data.clinicId,
          status,
          startDate,
          endDate: data.endDate ? new Date(data.endDate) : undefined,
          currentPeriodStart,
          currentPeriodEnd,
          trialStart,
          trialEnd,
          appointmentsUsed: 0,
          appointmentsRemaining,
          metadata: data.metadata,
        },
        include: {
          plan: true,
        },
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
        return await this.prisma.subscription.findMany({
          where: { userId },
          include: {
            plan: true,
          },
          orderBy: { createdAt: "desc" },
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
    const subscription = await this.prisma.subscription.findUnique({
      where: { id },
      include: {
        plan: true,
        payments: true,
        invoices: true,
      },
    });

    if (!subscription) {
      throw new NotFoundException(`Subscription with ID ${id} not found`);
    }

    return subscription;
  }

  async updateSubscription(id: string, data: UpdateSubscriptionDto) {
    const subscription = await this.prisma.subscription.update({
      where: { id },
      data,
      include: {
        plan: true,
      },
    });

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

    const updated = await this.prisma.subscription.update({
      where: { id },
      data: updateData,
      include: {
        plan: true,
      },
    });

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

    if (subscription.status === SubscriptionStatus.ACTIVE) {
      throw new BadRequestException("Subscription is already active");
    }

    const currentPeriodStart = new Date();
    const currentPeriodEnd = this.calculatePeriodEnd(
      currentPeriodStart,
      subscription.plan.interval,
      subscription.plan.intervalCount,
    );

    const updated = await this.prisma.subscription.update({
      where: { id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: false,
      },
      include: {
        plan: true,
      },
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
      const invoice = await this.prisma.invoice.create({
        data: {
          invoiceNumber,
          userId: data.userId,
          subscriptionId: data.subscriptionId,
          clinicId: data.clinicId,
          amount: data.amount,
          tax: data.tax || 0,
          discount: data.discount || 0,
          totalAmount,
          status: InvoiceStatus.DRAFT,
          dueDate: new Date(data.dueDate),
          description: data.description,
          lineItems: data.lineItems,
          metadata: data.metadata,
        },
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
        return await this.prisma.invoice.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
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
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        payments: true,
        subscription: {
          include: {
            plan: true,
          },
        },
      },
    });

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
      const invoice = await this.prisma.invoice.findUnique({ where: { id } });
      if (!invoice) {
        throw new NotFoundException(`Invoice with ID ${id} not found`);
      }

      const amount = data.amount ?? invoice.amount;
      const tax = data.tax ?? invoice.tax ?? 0;
      const discount = data.discount ?? invoice.discount ?? 0;
      updateData.totalAmount = amount + tax - discount;
    }

    const invoice = await this.prisma.invoice.update({
      where: { id },
      data: updateData,
    });

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
    const invoice = await this.prisma.invoice.update({
      where: { id },
      data: {
        status: InvoiceStatus.PAID,
        paidAt: new Date(),
      },
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
      const payment = await this.prisma.payment.create({
        data: {
          amount: data.amount,
          clinicId: data.clinicId,
          appointmentId: data.appointmentId,
          userId: data.userId,
          invoiceId: data.invoiceId,
          subscriptionId: data.subscriptionId,
          method: data.method,
          transactionId: data.transactionId,
          description: data.description,
          metadata: data.metadata,
          status: PaymentStatus.PENDING,
        },
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
    const payment = await this.prisma.payment.update({
      where: { id },
      data: {
        ...data,
        ...(data.refundAmount !== undefined && { refundedAt: new Date() }),
      },
    });

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      "Payment updated",
      "BillingService",
      { paymentId: id },
    );

    await this.eventService.emit("billing.payment.updated", { paymentId: id });

    if (payment.userId) {
      await this.cacheService.invalidateCacheByTag(
        `user_payments:${payment.userId}`,
      );
    }

    // Auto-update invoice if payment is linked to one
    if (payment.invoiceId && data.status === PaymentStatus.COMPLETED) {
      await this.markInvoiceAsPaid(payment.invoiceId);
    }

    return payment;
  }

  async getUserPayments(userId: string) {
    const cacheKey = `user_payments:${userId}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        return await this.prisma.payment.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
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
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: {
        appointment: true,
        invoice: true,
        subscription: {
          include: {
            plan: true,
          },
        },
      },
    });

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
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });

    if (!subscription) {
      return { allowed: false, reason: "Subscription not found" };
    }

    if (
      subscription.status !== SubscriptionStatus.ACTIVE &&
      subscription.status !== SubscriptionStatus.TRIALING
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
    if (appointmentType && subscription.plan.appointmentTypes) {
      const appointmentTypes = subscription.plan.appointmentTypes as Record<
        string,
        any
      >;
      const isCovered = appointmentTypes[appointmentType] === true;

      if (!isCovered) {
        // Get payment amount from metadata
        const metadata =
          (subscription.plan.metadata as Record<string, any>) || {};
        const paymentKey = `${appointmentType.toLowerCase()}Price`;
        const paymentAmount =
          metadata[paymentKey] ||
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
    if (subscription.plan.isUnlimitedAppointments) {
      return { allowed: true };
    }

    // Check if appointments are included in plan
    if (!subscription.plan.appointmentsIncluded) {
      return {
        allowed: false,
        requiresPayment: true,
        reason: "Plan does not include appointments",
      };
    }

    // Check remaining quota
    if (
      subscription.appointmentsRemaining !== null &&
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
      const subscription = await this.prisma.subscription.findUnique({
        where: { id: subscriptionId },
        include: { plan: true },
      });

      return {
        covered: true,
        requiresPayment: false,
        quotaAvailable: true,
        remaining: subscription?.appointmentsRemaining || null,
        total: subscription?.plan.appointmentsIncluded || null,
        isUnlimited: subscription?.plan.isUnlimitedAppointments || false,
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

    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });

    if (!subscription) {
      throw new NotFoundException("Subscription not found");
    }

    // Update appointment to link with subscription
    await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        subscriptionId,
        isSubscriptionBased: true,
      },
    });

    // Update subscription usage if not unlimited
    if (!subscription.plan.isUnlimitedAppointments) {
      await this.prisma.subscription.update({
        where: { id: subscriptionId },
        data: {
          appointmentsUsed: { increment: 1 },
          appointmentsRemaining:
            subscription.appointmentsRemaining !== null
              ? { decrement: 1 }
              : undefined,
        },
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
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        subscription: {
          include: { plan: true },
        },
      },
    });

    if (
      !appointment ||
      !appointment.subscriptionId ||
      !appointment.subscription
    ) {
      return;
    }

    // Restore appointment quota if not unlimited
    if (!appointment.subscription.plan.isUnlimitedAppointments) {
      await this.prisma.subscription.update({
        where: { id: appointment.subscriptionId },
        data: {
          appointmentsUsed: { decrement: 1 },
          appointmentsRemaining:
            appointment.subscription.appointmentsRemaining !== null
              ? { increment: 1 }
              : undefined,
        },
      });
    }

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      "Subscription appointment cancelled, quota restored",
      "BillingService",
      { subscriptionId: appointment.subscriptionId, appointmentId },
    );

    await this.eventService.emit("billing.appointment.cancelled", {
      subscriptionId: appointment.subscriptionId,
      appointmentId,
    });

    await this.cacheService.invalidateCacheByTag(
      `user_subscriptions:${appointment.subscription.userId}`,
    );
  }

  async getActiveUserSubscription(userId: string, clinicId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: {
        userId,
        clinicId,
        status: {
          in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING],
        },
        currentPeriodEnd: {
          gte: new Date(),
        },
      },
      include: {
        plan: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return subscription;
  }

  async getSubscriptionUsageStats(subscriptionId: string) {
    const subscription = await this.getSubscription(subscriptionId);

    const appointmentCount = await this.prisma.appointment.count({
      where: {
        subscriptionId,
        status: {
          in: [
            "SCHEDULED",
            "CONFIRMED",
            "COMPLETED",
            "IN_PROGRESS",
            "CHECKED_IN",
          ],
        },
      },
    });

    return {
      subscriptionId,
      planName: subscription.plan.name,
      appointmentsIncluded: subscription.plan.appointmentsIncluded,
      isUnlimited: subscription.plan.isUnlimitedAppointments,
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
    const appointmentsRemaining = subscription.plan.isUnlimitedAppointments
      ? null
      : subscription.plan.appointmentsIncluded || null;

    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        appointmentsUsed: 0,
        appointmentsRemaining,
      },
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

    const payments = await this.prisma.payment.findMany({
      where,
      select: {
        amount: true,
        createdAt: true,
      },
    });

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
    const subscriptions = await this.prisma.subscription.findMany({
      where: { clinicId },
      include: {
        plan: true,
      },
    });

    type SubscriptionWithPlan = (typeof subscriptions)[number];

    const active = subscriptions.filter(
      (s: SubscriptionWithPlan) => s.status === SubscriptionStatus.ACTIVE,
    ).length;
    const trialing = subscriptions.filter(
      (s: SubscriptionWithPlan) => s.status === SubscriptionStatus.TRIALING,
    ).length;
    const cancelled = subscriptions.filter(
      (s: SubscriptionWithPlan) => s.status === SubscriptionStatus.CANCELLED,
    ).length;
    const pastDue = subscriptions.filter(
      (s: SubscriptionWithPlan) => s.status === SubscriptionStatus.PAST_DUE,
    ).length;

    const monthlyRecurringRevenue = subscriptions
      .filter(
        (s: SubscriptionWithPlan) => s.status === SubscriptionStatus.ACTIVE,
      )
      .reduce((sum: number, sub: SubscriptionWithPlan) => {
        const planAmount = sub.plan.amount;
        const monthlyAmount =
          sub.plan.interval === "MONTHLY"
            ? planAmount
            : sub.plan.interval === "YEARLY"
              ? planAmount / 12
              : sub.plan.interval === "QUARTERLY"
                ? planAmount / 3
                : sub.plan.interval === "WEEKLY"
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
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          subscription: {
            include: {
              plan: true,
              user: true,
            },
          },
        },
      });

      if (!invoice) {
        throw new NotFoundException(`Invoice ${invoiceId} not found`);
      }

      // Get user details
      const user =
        invoice.subscription?.user ||
        (await this.prisma.user.findUnique({
          where: { id: invoice.userId },
        }));

      if (!user) {
        throw new NotFoundException(`User ${invoice.userId} not found`);
      }

      // Get clinic details
      const clinic = await this.prisma.clinic.findUnique({
        where: { id: invoice.clinicId },
      });

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
        clinicName: clinic.name,
        clinicAddress: clinic.address || undefined,
        clinicPhone: clinic.phone || undefined,
        clinicEmail: clinic.email || undefined,

        // User details
        userName: user.name,
        userEmail: user.email || undefined,
        userPhone: user.phone || undefined,

        // Subscription details
        subscriptionPlan: invoice.subscription?.plan.name,
        subscriptionPeriod: invoice.subscription
          ? `${new Date(invoice.subscription.currentPeriodStart).toLocaleDateString()} - ${new Date(invoice.subscription.currentPeriodEnd).toLocaleDateString()}`
          : undefined,

        // Line items
        lineItems: (invoice.lineItems as any[]) || [
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
        paymentMethod: undefined,
        transactionId: undefined,

        // Notes
        notes: `Thank you for your payment. This invoice is for ${invoice.subscription?.plan.name || "services"}.`,
        termsAndConditions:
          "Payment is due within 30 days. Please include the invoice number with your payment.",
      };

      // Get payment details if invoice is paid
      if (invoice.paidAt) {
        const payment = await this.prisma.payment.findFirst({
          where: { invoiceId: invoice.id },
          orderBy: { createdAt: "desc" },
        });

        if (payment) {
          pdfData.paymentMethod = payment.method;
          pdfData.transactionId = payment.transactionId || undefined;
        }
      }

      // Generate PDF
      const { filePath, fileName } =
        await this.invoicePDFService.generateInvoicePDF(pdfData);

      // Get public URL
      const pdfUrl = this.invoicePDFService.getPublicInvoiceUrl(fileName);

      // Update invoice with PDF info
      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          pdfFilePath: filePath,
          pdfUrl,
        },
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
      const invoice = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          subscription: {
            include: {
              user: true,
            },
          },
        },
      });

      if (!invoice) {
        throw new NotFoundException(`Invoice ${invoiceId} not found`);
      }

      // Get user details
      const user =
        invoice.subscription?.user ||
        (await this.prisma.user.findUnique({
          where: { id: invoice.userId },
        }));

      if (!user) {
        throw new NotFoundException(`User ${invoice.userId} not found`);
      }

      if (!user.phone) {
        throw new BadRequestException(`User ${user.id} has no phone number`);
      }

      // Generate PDF if not already generated
      if (!invoice.pdfUrl || !invoice.pdfFilePath) {
        await this.generateInvoicePDF(invoiceId);

        // Fetch updated invoice
        const updatedInvoice = await this.prisma.invoice.findUnique({
          where: { id: invoiceId },
        });

        if (!updatedInvoice?.pdfUrl) {
          throw new Error("Failed to generate invoice PDF");
        }

        invoice.pdfUrl = updatedInvoice.pdfUrl;
      }

      // Send via WhatsApp
      const success = await this.whatsAppService.sendInvoice(
        user.phone,
        user.name,
        invoice.invoiceNumber,
        invoice.totalAmount,
        invoice.dueDate.toLocaleDateString(),
        invoice.pdfUrl,
      );

      if (success) {
        // Update invoice
        await this.prisma.invoice.update({
          where: { id: invoiceId },
          data: {
            sentViaWhatsApp: true,
            whatsappSentAt: new Date(),
          },
        });

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
      const subscription = await this.prisma.subscription.findUnique({
        where: { id: subscriptionId },
        include: {
          plan: true,
          user: true,
        },
      });

      if (!subscription) {
        throw new NotFoundException(`Subscription ${subscriptionId} not found`);
      }

      if (!subscription.user.phone) {
        this.logger.warn(
          `User ${subscription.user.id} has no phone number, skipping WhatsApp confirmation`,
        );
        return;
      }

      // Send subscription confirmation
      await this.whatsAppService.sendSubscriptionConfirmation(
        subscription.user.phone,
        subscription.user.name,
        subscription.plan.name,
        subscription.plan.amount,
        subscription.currentPeriodStart.toLocaleDateString(),
        subscription.currentPeriodEnd.toLocaleDateString(),
      );

      // Check if invoice exists for this subscription
      const invoice = await this.prisma.invoice.findFirst({
        where: { subscriptionId: subscription.id },
        orderBy: { createdAt: "desc" },
      });

      if (invoice) {
        // Send existing invoice via WhatsApp
        await this.sendInvoiceViaWhatsApp(invoice.id);
      } else {
        // Create and send new invoice
        const newInvoice = await this.createInvoice({
          userId: subscription.userId,
          subscriptionId: subscription.id,
          clinicId: subscription.clinicId,
          amount: subscription.plan.amount,
          tax: subscription.plan.amount * 0.18, // 18% GST
          dueDate: subscription.currentPeriodEnd,
          description: `Subscription: ${subscription.plan.name}`,
          lineItems: [
            {
              description: subscription.plan.name,
              quantity: 1,
              unitPrice: subscription.plan.amount,
              amount: subscription.plan.amount,
            },
          ],
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
