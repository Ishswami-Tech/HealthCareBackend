/// <reference types="jest" />
/**
 * Staff billing lists and subscription rows (B6, B7, S6):
 *  - GET invoices/clinic rows carry patientName/patientPhone, items[] (normalised lineItems),
 *    paidAmount and balance; PHARMACIST scoping is untouched;
 *  - GET payments/clinic rows carry patientName and orderId;
 *  - GET analytics/revenue returns summary figures (monthly, by month, subscriptions, invoices)
 *    and no longer the raw payment rows;
 *  - subscription rows carry appointmentsLimit, nextBillingDate, autoRenew and plan.billingCycle /
 *    plan.price aliases;
 *  - POST invoices takes the clinic from the guard, never from the body.
 */

jest.mock('@payment/payment.service', () => ({ PaymentService: class {} }), { virtual: true });
jest.mock(
  '@payment/payment.handoff-token.service',
  () => ({ PaymentHandoffTokenService: class {} }),
  { virtual: true }
);
jest.mock('@infrastructure/database', () => ({ DatabaseService: class {} }));
jest.mock('@core/guards/jwt-auth.guard', () => ({ JwtAuthGuard: class {} }));
jest.mock('@core/guards/roles.guard', () => ({ RolesGuard: class {} }));
jest.mock('@core/guards/clinic.guard', () => ({ ClinicGuard: class {} }));
jest.mock('@core/guards/profile-completion.guard', () => ({ ProfileCompletionGuard: class {} }));
jest.mock('@core/rbac/rbac.guard', () => ({ RbacGuard: class {} }));
jest.mock('@queue/src/queue.service', () => ({ QueueService: class {} }));
jest.mock('@services/billing/invoice-pdf.service', () => ({ InvoicePDFService: class {} }));

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { createBillingService } from './billing-test-harness';
import type { MockMap } from './billing-test-harness';
import { BillingController } from '@services/billing/controllers/billing.controller';
import { Role } from '@core/types/enums.types';

const CLINIC = 'clinic-1';
const OTHER_CLINIC = 'clinic-2';

const USERS = [
  { id: 'user-a', name: 'Asha Rao', phone: '+911111111111' },
  { id: 'user-b', name: 'Bala Iyer', phone: '+912222222222' },
];

function databaseWith(rows: {
  invoices?: Array<Record<string, unknown>>;
  payments?: Array<Record<string, unknown>>;
  subscriptions?: Array<Record<string, unknown>>;
}): MockMap {
  const client = {
    user: {
      findMany: jest.fn(async (args: { where: { id: { in: string[] } } }) =>
        USERS.filter(user => args.where.id.in.includes(user.id))
      ),
    },
  };
  return {
    executeHealthcareRead: jest.fn(async (op: (c: unknown) => Promise<unknown>) => op(client)),
    findInvoicesSafe: jest.fn(async () => rows.invoices ?? []),
    findPaymentsSafe: jest.fn(async () => rows.payments ?? []),
    findSubscriptionsSafe: jest.fn(async () => rows.subscriptions ?? []),
  };
}

describe('getClinicInvoices enrichment', () => {
  const invoices = [
    {
      id: 'inv-1',
      clinicId: CLINIC,
      userId: 'user-a',
      billType: 'CONSULTATION',
      status: 'PENDING',
      amount: 500,
      totalAmount: 590,
      lineItems: [{ description: 'Consultation', quantity: 1, unitPrice: 500, amount: 500 }],
      payments: [
        { status: 'COMPLETED', amount: 200 },
        { status: 'FAILED', amount: 390 },
      ],
    },
    {
      id: 'inv-2',
      clinicId: CLINIC,
      userId: 'user-b',
      billType: 'PHARMACY',
      status: 'PAID',
      amount: 120,
      totalAmount: 120,
      lineItems: { items: [{ description: 'Ashwagandha', quantity: 2, amount: 120 }] },
      payments: [],
    },
    {
      id: 'inv-3',
      clinicId: CLINIC,
      userId: 'user-unknown',
      billType: 'OTHER',
      status: 'PENDING',
      amount: 10,
      totalAmount: 10,
      lineItems: null,
      payments: [],
    },
  ];

  it('adds patientName/phone, items[], paidAmount and balance to every row', async () => {
    const { service } = createBillingService({ databaseService: databaseWith({ invoices }) });

    const rows = (await service.getClinicInvoices(CLINIC)) as unknown as Array<
      Record<string, unknown>
    >;

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      id: 'inv-1',
      patientName: 'Asha Rao',
      patientPhone: '+911111111111',
      items: [{ id: '1', description: 'Consultation', quantity: 1, unitPrice: 500, total: 500 }],
      paidAmount: 200,
      balance: 390,
    });
    // PAID without payment rows (cash at the desk) is fully settled; `{ items: [...] }` shape and
    // per-unit price derived from the amount.
    expect(rows[1]).toMatchObject({
      patientName: 'Bala Iyer',
      items: [{ description: 'Ashwagandha', quantity: 2, unitPrice: 60, total: 120 }],
      paidAmount: 120,
      balance: 0,
    });
    expect(rows[2]).toMatchObject({ patientName: 'Unknown', patientPhone: null, items: [] });
  });

  it('keeps the PHARMACIST scope: only pharmacy invoices, still enriched', async () => {
    const { service } = createBillingService({ databaseService: databaseWith({ invoices }) });

    const rows = (await service.getClinicInvoices(CLINIC, 'PHARMACIST')) as unknown as Array<
      Record<string, unknown>
    >;

    expect(rows.map(row => row['id'])).toEqual(['inv-2']);
    expect(rows[0]).toMatchObject({ patientName: 'Bala Iyer' });
  });
});

describe('getClinicPayments enrichment', () => {
  it('adds patientName (appointment patient, else paying user) and orderId', async () => {
    const payments = [
      {
        id: 'pay-1',
        clinicId: CLINIC,
        userId: 'user-b',
        appointmentId: 'apt-1',
        amount: 500,
        status: 'COMPLETED',
        createdAt: new Date('2026-10-01T00:00:00Z'),
        metadata: { orderId: 'order_123' },
        appointment: { patient: { user: { name: 'Family Member' } } },
      },
      {
        id: 'pay-2',
        clinicId: CLINIC,
        userId: 'user-a',
        amount: 120,
        status: 'COMPLETED',
        createdAt: new Date('2026-10-02T00:00:00Z'),
        metadata: { paymentIntentId: 'pi_9' },
        invoice: { id: 'inv-2', userId: 'user-a', billType: 'PHARMACY' },
      },
      {
        id: 'pay-3',
        clinicId: CLINIC,
        userId: null,
        amount: 10,
        status: 'PENDING',
        createdAt: new Date('2026-10-03T00:00:00Z'),
        metadata: null,
        invoice: { id: 'inv-9', userId: 'user-unknown', billType: 'OTHER' },
      },
    ];
    const { service } = createBillingService({ databaseService: databaseWith({ payments }) });

    const rows = (await service.getClinicPayments(CLINIC)) as Array<Record<string, unknown>>;

    expect(rows.map(row => [row['id'], row['patientName'], row['orderId']])).toEqual([
      ['pay-1', 'Family Member', 'order_123'],
      ['pay-2', 'Asha Rao', 'pi_9'],
      ['pay-3', 'Unknown', 'pay-3'],
    ]);
  });
});

describe('getClinicRevenue summary', () => {
  it('returns monthly / by-month revenue, subscription and invoice counts, and no payment rows', async () => {
    const thisMonth = new Date();
    const lastMonth = new Date(thisMonth.getFullYear(), thisMonth.getMonth() - 1, 15, 12);
    const payments = [
      { id: 'p1', amount: 100.1, status: 'COMPLETED', createdAt: thisMonth, userId: 'user-a' },
      { id: 'p2', amount: 200.2, status: 'COMPLETED', createdAt: thisMonth, userId: 'user-b' },
      { id: 'p3', amount: 50, status: 'COMPLETED', createdAt: lastMonth, userId: 'user-a' },
    ];
    const invoices = [
      { id: 'i1', status: 'PENDING' },
      { id: 'i2', status: 'PAID' },
    ];
    const subscriptions = [{ id: 's1', status: 'ACTIVE' }];
    const { service, databaseService } = createBillingService({
      databaseService: databaseWith({ payments, invoices, subscriptions }),
    });

    const result = (await service.getClinicRevenue(
      CLINIC,
      undefined,
      undefined,
      'CLINIC_ADMIN'
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      totalRevenue: 350.3,
      paymentCount: 3,
      monthlyRevenue: 300.3,
      activeSubscriptions: 1,
      totalInvoices: 2,
      pendingInvoices: 1,
    });
    expect(result['revenueByMonth']).toHaveLength(2);
    expect((result['revenueByMonth'] as Array<{ revenue: number }>)[1]?.revenue).toBe(300.3);
    expect(result).not.toHaveProperty('payments');
    expect(databaseService['findSubscriptionsSafe']).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: CLINIC, status: 'ACTIVE' })
    );
  });
});

describe('subscription row decoration', () => {
  const plan = {
    id: 'plan-1',
    name: 'Gold',
    amount: 999,
    interval: 'MONTHLY',
    appointmentsIncluded: 4,
    isUnlimitedAppointments: false,
  };
  const periodEnd = new Date('2026-11-01T00:00:00Z');

  it('getUserSubscriptions adds appointmentsLimit, nextBillingDate, autoRenew and plan aliases', async () => {
    const subscriptions = [
      {
        id: 'sub-1',
        userId: 'user-a',
        clinicId: CLINIC,
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: periodEnd,
        createdAt: new Date('2026-10-01T00:00:00Z'),
        plan,
      },
      {
        id: 'sub-2',
        userId: 'user-a',
        clinicId: CLINIC,
        status: 'CANCELLED',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: periodEnd,
        createdAt: new Date('2026-09-01T00:00:00Z'),
        plan: { ...plan, isUnlimitedAppointments: true },
      },
    ];
    const { service } = createBillingService({
      databaseService: {
        ...databaseWith({ subscriptions }),
        findUserByIdSafe: jest.fn().mockResolvedValue({ id: 'user-a', primaryClinicId: CLINIC }),
      },
    });

    const rows = (await service.getUserSubscriptions(
      'user-a',
      'PATIENT',
      'user-a',
      CLINIC
    )) as unknown as Array<Record<string, unknown>>;

    expect(rows[0]).toMatchObject({
      appointmentsLimit: 4,
      nextBillingDate: periodEnd,
      autoRenew: true,
      plan: { billingCycle: 'MONTHLY', price: 999, name: 'Gold' },
    });
    expect(rows[1]).toMatchObject({
      appointmentsLimit: null,
      nextBillingDate: null,
      autoRenew: false,
    });
  });

  it('getActiveUserSubscription returns the decorated active row', async () => {
    const subscriptions = [
      {
        id: 'sub-1',
        userId: 'user-a',
        clinicId: CLINIC,
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
        createdAt: new Date('2026-10-01T00:00:00Z'),
        plan,
      },
    ];
    const { service } = createBillingService({ databaseService: databaseWith({ subscriptions }) });

    const row = (await service.getActiveUserSubscription('user-a', CLINIC, {
      userId: 'user-a',
      role: 'PATIENT',
      clinicId: CLINIC,
    })) as unknown as Record<string, unknown>;

    expect(row).toMatchObject({ id: 'sub-1', autoRenew: true, appointmentsLimit: 4 });
  });
});

describe('POST billing/invoices clinic pinning', () => {
  function controllerWith(billingService: MockMap): BillingController {
    return new BillingController(billingService as never, {} as never, {} as never, {} as never);
  }
  const body = { userId: 'user-a', amount: 100, dueDate: '2026-10-10' };

  it('uses the guard clinic when the body has none', async () => {
    const billingService = { createInvoice: jest.fn().mockResolvedValue({ id: 'inv' }) };
    await controllerWith(billingService).createInvoice(
      body as never,
      {
        user: { role: Role.RECEPTIONIST },
        clinicContext: { clinicId: CLINIC },
      } as never
    );
    expect(billingService['createInvoice']).toHaveBeenCalledWith({ ...body, clinicId: CLINIC });
  });

  it('refuses a body clinic that is not the caller’s clinic', async () => {
    const billingService = { createInvoice: jest.fn() };
    await expect(
      controllerWith(billingService).createInvoice(
        { ...body, clinicId: OTHER_CLINIC } as never,
        {
          user: { role: Role.CLINIC_ADMIN },
          clinicContext: { clinicId: CLINIC },
        } as never
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(billingService['createInvoice']).not.toHaveBeenCalled();
  });

  it('accepts a body clinic equal to the guard clinic', async () => {
    const billingService = { createInvoice: jest.fn().mockResolvedValue({ id: 'inv' }) };
    await controllerWith(billingService).createInvoice(
      { ...body, clinicId: CLINIC } as never,
      {
        user: { role: Role.FINANCE_BILLING },
        clinicContext: { clinicId: CLINIC },
      } as never
    );
    expect(billingService['createInvoice']).toHaveBeenCalledWith({ ...body, clinicId: CLINIC });
  });

  it('without a guard clinic only SUPER_ADMIN may name one; others get 400', async () => {
    const billingService = { createInvoice: jest.fn().mockResolvedValue({ id: 'inv' }) };
    await controllerWith(billingService).createInvoice(
      { ...body, clinicId: OTHER_CLINIC } as never,
      {
        user: { role: Role.SUPER_ADMIN },
      } as never
    );
    expect(billingService['createInvoice']).toHaveBeenCalledWith({
      ...body,
      clinicId: OTHER_CLINIC,
    });

    await expect(
      controllerWith(billingService).createInvoice(
        { ...body, clinicId: OTHER_CLINIC } as never,
        {
          user: { role: Role.RECEPTIONIST },
        } as never
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('send-whatsapp is open to the billing desk and front desk too', () => {
    const handler = BillingController.prototype.sendReceiptViaWhatsApp as unknown as object;
    expect(Reflect.getMetadata('roles', handler)).toEqual(
      expect.arrayContaining([Role.FINANCE_BILLING, Role.RECEPTIONIST, Role.CLINIC_ADMIN])
    );
  });
});
