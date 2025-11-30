/**
 * Billing-related database methods
 * Code splitting: Billing convenience methods extracted from database.service.ts
 * Includes: Invoice, Subscription, BillingPlan, Payment
 */

import { DatabaseMethodsBase } from './database-methods.base';
import type {
  BillingPlanWithRelations,
  SubscriptionWithRelations,
  InvoiceWithRelations,
  PaymentWithRelations,
} from '@core/types/database.types';
import type {
  BillingPlanCreateInput,
  BillingPlanUpdateInput,
  BillingPlanWhereInput,
  SubscriptionCreateInput,
  SubscriptionUpdateInput,
  SubscriptionWhereInput,
  InvoiceCreateInput,
  InvoiceUpdateInput,
  InvoiceWhereInput,
  PaymentCreateInput,
  PaymentUpdateInput,
  PaymentWhereInput,
} from '@core/types/input.types';

/**
 * Billing methods implementation
 * All methods use executeRead/Write for full optimization layers
 */
export class BillingMethods extends DatabaseMethodsBase {
  // ===== Invoice Methods =====

  /**
   * Find invoice by ID
   */
  async findInvoiceByIdSafe(id: string): Promise<InvoiceWithRelations | null> {
    return await this.executeRead<InvoiceWithRelations | null>(async prisma => {
      return await prisma.invoice.findUnique({
        where: { id },
        include: {
          subscription: true,
          payments: true,
          billingPlan: true,
        },
      });
    }, this.queryOptionsBuilder.useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(true).build());
  }

  /**
   * Find invoices with filtering
   */
  async findInvoicesSafe(where: InvoiceWhereInput): Promise<InvoiceWithRelations[]> {
    return await this.executeRead<InvoiceWithRelations[]>(async prisma => {
      return await prisma.invoice.findMany({
        where,
        include: {
          subscription: true,
          payments: true,
          billingPlan: true,
        },
      });
    }, this.queryOptionsBuilder.useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(true).build());
  }

  /**
   * Create invoice
   */
  async createInvoiceSafe(data: InvoiceCreateInput): Promise<InvoiceWithRelations> {
    const result = await this.executeWrite<InvoiceWithRelations>(
      async prisma => {
        return await prisma.invoice.create({
          data: data as never,
          include: {
            subscription: true,
            payments: true,
            billingPlan: true,
          },
        });
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'CREATE_INVOICE',
        resourceType: 'INVOICE',
        resourceId: 'pending',
        timestamp: new Date(),
      }
    );

    if (result?.id) {
      await this.invalidateCache([`invoice:${result.id}`, 'invoices']);
    }

    return result;
  }

  /**
   * Update invoice
   */
  async updateInvoiceSafe(id: string, data: InvoiceUpdateInput): Promise<InvoiceWithRelations> {
    const result = await this.executeWrite<InvoiceWithRelations>(
      async prisma => {
        return await prisma.invoice.update({
          where: { id },
          data: data as never,
          include: {
            subscription: true,
            payments: true,
            billingPlan: true,
          },
        });
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'UPDATE_INVOICE',
        resourceType: 'INVOICE',
        resourceId: id,
        timestamp: new Date(),
      }
    );

    await this.invalidateCache([`invoice:${id}`, 'invoices']);

    return result;
  }

  // ===== Subscription Methods =====

  /**
   * Find subscription by ID
   */
  async findSubscriptionByIdSafe(id: string): Promise<SubscriptionWithRelations | null> {
    return await this.executeRead<SubscriptionWithRelations | null>(async prisma => {
      return await prisma.subscription.findUnique({
        where: { id },
        include: {
          billingPlan: true,
          invoices: true,
        },
      });
    }, this.queryOptionsBuilder.useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(true).build());
  }

  /**
   * Find subscriptions with filtering
   */
  async findSubscriptionsSafe(where: SubscriptionWhereInput): Promise<SubscriptionWithRelations[]> {
    return await this.executeRead<SubscriptionWithRelations[]>(async prisma => {
      return await prisma.subscription.findMany({
        where,
        include: {
          billingPlan: true,
          invoices: true,
        },
      });
    }, this.queryOptionsBuilder.useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(true).build());
  }

  /**
   * Create subscription
   */
  async createSubscriptionSafe(data: SubscriptionCreateInput): Promise<SubscriptionWithRelations> {
    const result = await this.executeWrite<SubscriptionWithRelations>(
      async prisma => {
        return await prisma.subscription.create({
          data: data as never,
          include: {
            billingPlan: true,
            invoices: true,
          },
        });
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'CREATE_SUBSCRIPTION',
        resourceType: 'SUBSCRIPTION',
        resourceId: 'pending',
        timestamp: new Date(),
      }
    );

    if (result?.id) {
      await this.invalidateCache([`subscription:${result.id}`, 'subscriptions']);
    }

    return result;
  }

  /**
   * Update subscription
   */
  async updateSubscriptionSafe(
    id: string,
    data: SubscriptionUpdateInput
  ): Promise<SubscriptionWithRelations> {
    const result = await this.executeWrite<SubscriptionWithRelations>(
      async prisma => {
        return await prisma.subscription.update({
          where: { id },
          data: data as never,
          include: {
            billingPlan: true,
            invoices: true,
          },
        });
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'UPDATE_SUBSCRIPTION',
        resourceType: 'SUBSCRIPTION',
        resourceId: id,
        timestamp: new Date(),
      }
    );

    await this.invalidateCache([`subscription:${id}`, 'subscriptions']);

    return result;
  }

  // ===== BillingPlan Methods =====

  /**
   * Find billing plan by ID
   */
  async findBillingPlanByIdSafe(id: string): Promise<BillingPlanWithRelations | null> {
    return await this.executeRead<BillingPlanWithRelations | null>(async prisma => {
      return await prisma.billingPlan.findUnique({
        where: { id },
        include: {
          subscriptions: true,
          invoices: true,
        },
      });
    }, this.queryOptionsBuilder.useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(true).build());
  }

  /**
   * Find billing plans with filtering
   */
  async findBillingPlansSafe(where: BillingPlanWhereInput): Promise<BillingPlanWithRelations[]> {
    return await this.executeRead<BillingPlanWithRelations[]>(async prisma => {
      return await prisma.billingPlan.findMany({
        where,
        include: {
          subscriptions: true,
          invoices: true,
        },
      });
    }, this.queryOptionsBuilder.useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(true).build());
  }

  /**
   * Create billing plan
   */
  async createBillingPlanSafe(data: BillingPlanCreateInput): Promise<BillingPlanWithRelations> {
    const result = await this.executeWrite<BillingPlanWithRelations>(
      async prisma => {
        return await prisma.billingPlan.create({
          data: data as never,
          include: {
            subscriptions: true,
            invoices: true,
          },
        });
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'CREATE_BILLING_PLAN',
        resourceType: 'BILLING_PLAN',
        resourceId: 'pending',
        timestamp: new Date(),
      }
    );

    if (result?.id) {
      await this.invalidateCache([`billingPlan:${result.id}`, 'billingPlans']);
    }

    return result;
  }

  /**
   * Update billing plan
   */
  async updateBillingPlanSafe(
    id: string,
    data: BillingPlanUpdateInput
  ): Promise<BillingPlanWithRelations> {
    const result = await this.executeWrite<BillingPlanWithRelations>(
      async prisma => {
        return await prisma.billingPlan.update({
          where: { id },
          data: data as never,
          include: {
            subscriptions: true,
            invoices: true,
          },
        });
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'UPDATE_BILLING_PLAN',
        resourceType: 'BILLING_PLAN',
        resourceId: id,
        timestamp: new Date(),
      }
    );

    await this.invalidateCache([`billingPlan:${id}`, 'billingPlans']);

    return result;
  }

  /**
   * Delete billing plan
   */
  async deleteBillingPlanSafe(id: string): Promise<BillingPlanWithRelations> {
    const result = await this.executeWrite<BillingPlanWithRelations>(
      async prisma => {
        return await prisma.billingPlan.delete({
          where: { id },
          include: {
            subscriptions: true,
            invoices: true,
          },
        });
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'DELETE_BILLING_PLAN',
        resourceType: 'BILLING_PLAN',
        resourceId: id,
        timestamp: new Date(),
      }
    );

    await this.invalidateCache([`billingPlan:${id}`, 'billingPlans']);

    return result;
  }

  // ===== Payment Methods =====

  /**
   * Find payment by ID
   */
  async findPaymentByIdSafe(id: string): Promise<PaymentWithRelations | null> {
    return await this.executeRead<PaymentWithRelations | null>(async prisma => {
      return await prisma.payment.findUnique({
        where: { id },
        include: {
          invoice: true,
        },
      });
    }, this.queryOptionsBuilder.useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(true).build());
  }

  /**
   * Find payments with filtering
   */
  async findPaymentsSafe(where: PaymentWhereInput): Promise<PaymentWithRelations[]> {
    return await this.executeRead<PaymentWithRelations[]>(async prisma => {
      return await prisma.payment.findMany({
        where,
        include: {
          invoice: true,
        },
      });
    }, this.queryOptionsBuilder.useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(true).build());
  }

  /**
   * Create payment
   */
  async createPaymentSafe(data: PaymentCreateInput): Promise<PaymentWithRelations> {
    const result = await this.executeWrite<PaymentWithRelations>(
      async prisma => {
        return await prisma.payment.create({
          data: data as never,
          include: {
            invoice: true,
          },
        });
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'CREATE_PAYMENT',
        resourceType: 'PAYMENT',
        resourceId: 'pending',
        timestamp: new Date(),
      }
    );

    if (result?.id) {
      await this.invalidateCache([`payment:${result.id}`, 'payments']);
    }

    return result;
  }

  /**
   * Update payment
   */
  async updatePaymentSafe(id: string, data: PaymentUpdateInput): Promise<PaymentWithRelations> {
    const result = await this.executeWrite<PaymentWithRelations>(
      async prisma => {
        return await prisma.payment.update({
          where: { id },
          data: data as never,
          include: {
            invoice: true,
          },
        });
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'UPDATE_PAYMENT',
        resourceType: 'PAYMENT',
        resourceId: id,
        timestamp: new Date(),
      }
    );

    await this.invalidateCache([`payment:${id}`, 'payments']);

    return result;
  }
}
