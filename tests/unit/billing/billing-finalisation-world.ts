/// <reference types="jest" />
/**
 * Test world for the payment-finalisation specs: the REAL BillingService running against the
 * stateful FakeBillingDb. Importing specs must register the same module mocks as
 * billing-test-harness.ts (jest.mock is hoisted per file).
 */
import { createBillingService } from './billing-test-harness';
import type { MockMap } from './billing-test-harness';
import { FakeBillingDb } from './billing-fake-db';
import type { Row } from './billing-fake-db';
import type { BillingService } from '@services/billing/billing.service';

export const CLINIC_ID = 'clinic-1';

export function gatewayResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    paymentId: 'order-1',
    status: 'completed',
    amount: 118,
    currency: 'INR',
    transactionId: 'cf-tx-1',
    provider: 'cashfree',
    timestamp: new Date(),
    metadata: {},
    ...overrides,
  };
}

export interface FinalisationWorld {
  db: FakeBillingDb;
  service: BillingService;
  eventService: MockMap;
  loggingService: MockMap;
  paymentService: MockMap;
  generatePdf: jest.SpyInstance;
  /** Runs one gateway delivery for payment `pay-1` / order `order-1` (or the given ids). */
  deliver: (
    paymentId?: string,
    orderId?: string
  ) => ReturnType<BillingService['handlePaymentCallback']>;
  events: (name: string) => unknown[][];
  enterpriseEvents: (name: string) => unknown[][];
}

export interface WorldOptions {
  invoice?: Row | null;
  payment?: Row;
  subscription?: Row | null;
  appointment?: Row | null;
}

export function seedSubscriptionWorld(db: FakeBillingDb, options: WorldOptions = {}): void {
  db.seed('billingPlan', {
    id: 'plan-1',
    name: 'Gold',
    amount: 100,
    currency: 'INR',
    interval: 'MONTHLY',
    intervalCount: 1,
    isUnlimitedAppointments: false,
    appointmentsIncluded: 4,
    clinicId: CLINIC_ID,
  });
  if (options.subscription !== null) {
    db.seed('subscription', {
      id: 'sub-1',
      userId: 'user-1',
      clinicId: CLINIC_ID,
      planId: 'plan-1',
      status: 'INCOMPLETE',
      currentPeriodStart: new Date(Date.now() - 3 * 24 * 3600 * 1000),
      currentPeriodEnd: new Date(Date.now() + 27 * 24 * 3600 * 1000),
      appointmentsUsed: 0,
      appointmentsRemaining: 4,
      metadata: null,
      ...options.subscription,
    });
  }
  if (options.invoice !== null) {
    db.seed('invoice', {
      id: 'inv-1',
      invoiceNumber: 'INV-2026-000001',
      userId: 'user-1',
      clinicId: CLINIC_ID,
      subscriptionId: 'sub-1',
      amount: 100,
      tax: 18,
      totalAmount: 118,
      status: 'PENDING',
      paidAt: null,
      metadata: {},
      ...options.invoice,
    });
  }
  db.seed('payment', {
    id: 'pay-1',
    clinicId: CLINIC_ID,
    userId: 'user-1',
    invoiceId: options.invoice === null ? null : 'inv-1',
    subscriptionId: 'sub-1',
    appointmentId: null,
    amount: 118,
    status: 'PENDING',
    transactionId: 'order-1',
    metadata: { orderId: 'order-1', provider: 'cashfree' },
    ...options.payment,
  });
  if (options.appointment) {
    db.seed('appointment', options.appointment);
  }
}

export function createFinalisationWorld(
  options: WorldOptions = {},
  gateway: Record<string, unknown> = gatewayResult()
): FinalisationWorld {
  const db = new FakeBillingDb();
  seedSubscriptionWorld(db, options);

  const paymentService: MockMap = {
    verifyPaymentStatus: jest.fn().mockResolvedValue(gateway),
  };
  const harness = createBillingService({
    databaseService: db.service as unknown as MockMap,
    paymentService,
  });
  const generatePdf = jest
    .spyOn(harness.service, 'generateInvoicePDF')
    .mockResolvedValue(undefined);
  jest.spyOn(harness.service, 'syncAppointmentAfterPayment').mockResolvedValue(null);

  const callsOf = (mock: jest.Mock | undefined, name: string): unknown[][] =>
    (mock?.mock.calls ?? []).filter((call: unknown[]) => call[0] === name);

  return {
    db,
    service: harness.service,
    eventService: harness.eventService,
    loggingService: harness.loggingService,
    paymentService,
    generatePdf,
    deliver: (paymentId = 'pay-1', orderId = 'order-1') =>
      harness.service.handlePaymentCallback(CLINIC_ID, paymentId, orderId),
    events: name => callsOf(harness.eventService['emit'], name),
    enterpriseEvents: name => callsOf(harness.eventService['emitEnterprise'], name),
  };
}

/** Waits (event-loop turns) until `predicate` holds - used to line a second delivery up. */
export async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  throw new Error(`waitFor timed out: ${label}`);
}

/** Pretends the claim was taken `ageMs` ago, so the grace window has elapsed. */
export function ageClaim(db: FakeBillingDb, paymentId: string, ageMs: number): void {
  const metadata = db.metadata('payment', paymentId);
  const marker = metadata['finalisation'] as Record<string, unknown>;
  marker['claimedAt'] = new Date(Date.now() - ageMs).toISOString();
}
