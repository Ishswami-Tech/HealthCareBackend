/**
 * Database primitives of the payment-finalisation protocol.
 *
 * Every method is a single atomic statement (or an optimistic compare-and-set loop) over the
 * primary database. Reads that feed a decision go through the write client on purpose:
 * `findPaymentByIdSafe` & co. are cached for minutes and may be served by a read replica, so a
 * decision taken from them can be older than the claim another delivery committed a moment ago.
 */
import type { DatabaseService } from '@infrastructure/database';
import {
  asJsonRecord,
  readFinalisationMarker,
} from '@services/billing/billing-payment-finalisation.util';
import type {
  FinalisationMarker,
  JsonRecord,
} from '@services/billing/billing-payment-finalisation.util';
import {
  openAttemptsToClose,
  planInvoicePaymentAttempt,
} from '@services/billing/invoice-payment-attempt.util';

export interface PaymentRow {
  id: string;
  clinicId: string;
  amount: number;
  status: string;
  userId: string | null;
  invoiceId: string | null;
  subscriptionId: string | null;
  appointmentId: string | null;
  transactionId: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceRow {
  id: string;
  invoiceNumber?: string;
  clinicId: string;
  userId: string;
  subscriptionId: string | null;
  status: string;
  amount: number;
  totalAmount: number;
  paidAt: Date | null;
  metadata: unknown;
}

type WhereInput = Record<string, unknown>;
type UpdateManyResult = { count: number };

interface PaymentDelegate {
  findUnique: (args: { where: { id: string } }) => Promise<PaymentRow | null>;
  findMany: (args: {
    where: WhereInput;
    take?: number;
    orderBy?: { updatedAt?: 'asc' | 'desc'; createdAt?: 'asc' | 'desc' };
  }) => Promise<PaymentRow[]>;
  updateMany: (args: { where: WhereInput; data: WhereInput }) => Promise<UpdateManyResult>;
  create: (args: { data: WhereInput }) => Promise<PaymentRow>;
  update: (args: { where: { id: string }; data: WhereInput }) => Promise<PaymentRow>;
}

interface InvoiceDelegate {
  findUnique: (args: { where: { id: string } }) => Promise<InvoiceRow | null>;
  updateMany: (args: { where: WhereInput; data: WhereInput }) => Promise<UpdateManyResult>;
}

interface AppointmentDelegate {
  updateMany: (args: { where: WhereInput; data: WhereInput }) => Promise<UpdateManyResult>;
}

interface SubscriptionDelegate {
  updateMany: (args: { where: WhereInput; data: WhereInput }) => Promise<UpdateManyResult>;
}

type StoreClient = {
  payment: PaymentDelegate;
  invoice: InvoiceDelegate;
  appointment: AppointmentDelegate;
  subscription: SubscriptionDelegate;
};

type TransactionStoreClient = StoreClient & {
  $executeRaw: (query: TemplateStringsArray, ...values: Array<string | number>) => Promise<number>;
};

export interface InvoiceAttemptOutcome {
  payment: PaymentRow;
  /** True when an open row for the same gateway order was reused instead of inserting one. */
  reused: boolean;
  /** Open rows closed as superseded by this attempt. */
  supersededIds: string[];
}

/** Status given to an open payment attempt that can no longer be paid usefully. */
const CLOSED_ATTEMPT_STATUS = 'CANCELLED';

export type MetadataMutationResult = 'written' | 'unchanged' | 'conflict' | 'missing';

const METADATA_CAS_ATTEMPTS = 5;

export class BillingPaymentStore {
  constructor(private readonly database: DatabaseService) {}

  private audit(
    clinicId: string,
    resourceType: string,
    resourceId: string,
    operation: string,
    details: Record<string, unknown> = {},
    skipCacheInvalidation = false
  ): {
    userId: string;
    userRole: string;
    clinicId: string;
    resourceType: string;
    resourceId: string;
    operation: string;
    details: Record<string, unknown>;
    skipCacheInvalidation?: boolean;
  } {
    return {
      userId: 'system',
      userRole: 'system',
      clinicId,
      resourceType,
      resourceId,
      operation,
      details,
      ...(skipCacheInvalidation ? { skipCacheInvalidation: true } : {}),
    };
  }

  /** Fresh primary-database read of one payment (never cached, never a replica). */
  async readPayment(paymentId: string, clinicId: string): Promise<PaymentRow | null> {
    return this.database.executeHealthcareWrite(
      async client =>
        (client as unknown as StoreClient).payment.findUnique({ where: { id: paymentId } }),
      this.audit(clinicId, 'PAYMENT', paymentId, 'READ_FRESH', {}, true)
    );
  }

  /** Fresh primary-database read of one invoice. */
  async readInvoice(invoiceId: string, clinicId: string): Promise<InvoiceRow | null> {
    return this.database.executeHealthcareWrite(
      async client =>
        (client as unknown as StoreClient).invoice.findUnique({ where: { id: invoiceId } }),
      this.audit(clinicId, 'INVOICE', invoiceId, 'READ_FRESH', {}, true)
    );
  }

  /** Fresh read of every payment recorded against an invoice. */
  async listInvoicePayments(invoiceId: string, clinicId: string): Promise<PaymentRow[]> {
    return this.database.executeHealthcareWrite(
      async client => (client as unknown as StoreClient).payment.findMany({ where: { invoiceId } }),
      this.audit(clinicId, 'PAYMENT', invoiceId, 'READ_INVOICE_PAYMENTS', {}, true)
    );
  }

  /**
   * Booking and invoice payments still PENDING after `olderThan` but started after `newerThan`,
   * oldest first.
   */
  async listStalePending(args: {
    olderThan: Date;
    newerThan: Date;
    limit: number;
  }): Promise<PaymentRow[]> {
    return this.database.executeHealthcareWrite(
      async client =>
        (client as unknown as StoreClient).payment.findMany({
          where: {
            status: 'PENDING',
            OR: [{ appointmentId: { not: null } }, { invoiceId: { not: null } }],
            createdAt: { gte: args.newerThan, lte: args.olderThan },
          },
          take: args.limit,
          orderBy: { createdAt: 'asc' },
        }),
      this.audit('SYSTEM', 'PAYMENT', 'sweep', 'READ_STALE_PENDING', {}, true)
    );
  }

  /** Fresh read of every payment recorded against a subscription (any of its invoices). */
  async listSubscriptionPayments(subscriptionId: string, clinicId: string): Promise<PaymentRow[]> {
    return this.database.executeHealthcareWrite(
      async client =>
        (client as unknown as StoreClient).payment.findMany({ where: { subscriptionId } }),
      this.audit(clinicId, 'PAYMENT', subscriptionId, 'READ_SUBSCRIPTION_PAYMENTS', {}, true)
    );
  }

  /** COMPLETED payments last touched inside [since, until] - candidates for a stalled finalisation. */
  async listRecentCompleted(args: {
    since: Date;
    until: Date;
    limit: number;
    clinicId?: string;
  }): Promise<PaymentRow[]> {
    return this.database.executeHealthcareWrite(
      async client =>
        (client as unknown as StoreClient).payment.findMany({
          where: {
            status: 'COMPLETED',
            updatedAt: { gte: args.since, lte: args.until },
            ...(args.clinicId ? { clinicId: args.clinicId } : {}),
          },
          take: args.limit,
          orderBy: { updatedAt: 'asc' },
        }),
      this.audit(
        args.clinicId ?? 'SYSTEM',
        'PAYMENT',
        'sweep',
        'READ_STALLED_FINALISATIONS',
        {},
        true
      )
    );
  }

  /**
   * Records one payment attempt for an invoice, serialised per invoice by a transaction-scoped
   * advisory lock so a double click can never insert two open rows. The open row for the same
   * gateway order is reused (refreshed with `refresh`); every other open row is closed as
   * superseded; only when no open row matches is a new row inserted from `create`.
   */
  async recordInvoiceAttempt(args: {
    invoiceId: string;
    orderId: string;
    create: WhereInput;
    refresh: WhereInput;
    supersededMetadata: (current: JsonRecord) => JsonRecord;
    preserveMetadataKeys?: readonly string[];
    /** Provider of this attempt: an open row of the same order id at another provider is not reused. */
    provider?: string;
  }): Promise<InvoiceAttemptOutcome> {
    return this.database.executeInTransaction(async client => {
      const tx = client as unknown as TransactionStoreClient;
      const lockKey = `invoice-payment-attempt:${args.invoiceId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      const rows = await tx.payment.findMany({ where: { invoiceId: args.invoiceId } });
      const plan = planInvoicePaymentAttempt(rows, args.orderId, args.provider);
      const supersededIds: string[] = [];
      for (const id of plan.supersedeIds) {
        const row = rows.find(candidate => candidate.id === id);
        const closed = await tx.payment.updateMany({
          where: { id, status: 'PENDING' },
          data: {
            status: CLOSED_ATTEMPT_STATUS,
            metadata: args.supersededMetadata(asJsonRecord(row?.metadata) ?? {}),
          },
        });
        if (closed.count === 1) {
          supersededIds.push(id);
        }
      }

      if (plan.reuseId) {
        const current = rows.find(candidate => candidate.id === plan.reuseId);
        const currentMetadata = asJsonRecord(current?.metadata) ?? {};
        const refreshMetadata = asJsonRecord(args.refresh['metadata']) ?? {};
        // Keys the reused row keeps (e.g. its payment window: the provider order is the same one,
        // so its expiry does not move when the patient presses Pay again).
        const kept = Object.fromEntries(
          (args.preserveMetadataKeys ?? [])
            .filter(key => currentMetadata[key] !== undefined)
            .map(key => [key, currentMetadata[key]])
        );
        const payment = await tx.payment.update({
          where: { id: plan.reuseId },
          data: {
            ...args.refresh,
            metadata: { ...currentMetadata, ...refreshMetadata, ...kept },
          },
        });
        return { payment, reused: true, supersededIds };
      }

      const payment = await tx.payment.create({ data: { ...args.create, status: 'PENDING' } });
      return { payment, reused: false, supersededIds };
    });
  }

  /**
   * After `settledPaymentId` paid the invoice, closes every other open attempt of that invoice.
   * Each row is a compare-and-set on PENDING, so a row a concurrent callback is settling is never
   * overwritten. Returns the ids actually closed.
   */
  async closeOpenInvoiceAttempts(args: {
    invoiceId: string;
    clinicId: string;
    settledPaymentId: string;
    closedMetadata: (current: JsonRecord) => JsonRecord;
  }): Promise<string[]> {
    const rows = await this.listInvoicePayments(args.invoiceId, args.clinicId);
    const closed: string[] = [];
    for (const id of openAttemptsToClose(rows, args.settledPaymentId)) {
      const row = rows.find(candidate => candidate.id === id);
      const result = await this.database.executeHealthcareWrite(
        async client =>
          (client as unknown as StoreClient).payment.updateMany({
            where: { id, status: 'PENDING' },
            data: {
              status: CLOSED_ATTEMPT_STATUS,
              metadata: args.closedMetadata(asJsonRecord(row?.metadata) ?? {}),
            },
          }),
        this.audit(args.clinicId, 'PAYMENT', id, 'UPDATE', {
          reason: 'Open payment attempt closed: invoice settled by another payment',
          settledByPaymentId: args.settledPaymentId,
        })
      );
      if (result.count === 1) {
        closed.push(id);
      }
    }
    return closed;
  }

  /**
   * Invoice / plan payments (no booking: those follow the booking's own window) still PENDING and
   * opened before `openedBefore`, oldest first: candidates for the payment-window sweep (the
   * caller checks each row's own window end).
   */
  async listOpenCheckoutAttempts(args: {
    openedBefore: Date;
    limit: number;
  }): Promise<PaymentRow[]> {
    return this.database.executeHealthcareWrite(
      async client =>
        (client as unknown as StoreClient).payment.findMany({
          where: {
            status: 'PENDING',
            appointmentId: null,
            OR: [{ invoiceId: { not: null } }, { subscriptionId: { not: null } }],
            createdAt: { lte: args.openedBefore },
          },
          take: args.limit,
          orderBy: { createdAt: 'asc' },
        }),
      this.audit('SYSTEM', 'PAYMENT', 'sweep', 'READ_PAYMENT_WINDOW_CANDIDATES', {}, true)
    );
  }

  /** PENDING -> EXPIRED, only while still PENDING (a payment completing meanwhile wins). */
  async expireOpenAttempt(args: { payment: PaymentRow; metadata: JsonRecord }): Promise<boolean> {
    const result = await this.database.executeHealthcareWrite(
      async client =>
        (client as unknown as StoreClient).payment.updateMany({
          where: { id: args.payment.id, status: 'PENDING' },
          data: { status: 'EXPIRED', metadata: args.metadata },
        }),
      this.audit(args.payment.clinicId, 'PAYMENT', args.payment.id, 'UPDATE', {
        reason: 'Payment window expired',
      })
    );
    return result.count === 1;
  }

  /** PENDING -> VOID, only while still PENDING (an invoice paid meanwhile is never voided). */
  async voidPendingInvoice(args: {
    invoice: InvoiceRow;
    clinicId: string;
    metadata: JsonRecord;
    /** Audit reason; defaults to the checkout payment-window sweep. */
    reason?: string;
  }): Promise<boolean> {
    const result = await this.database.executeHealthcareWrite(
      async client =>
        (client as unknown as StoreClient).invoice.updateMany({
          where: { id: args.invoice.id, status: 'PENDING' },
          data: { status: 'VOID', metadata: args.metadata },
        }),
      this.audit(args.clinicId, 'INVOICE', args.invoice.id, 'UPDATE', {
        reason: args.reason ?? 'Checkout payment window expired',
      })
    );
    return result.count === 1;
  }

  /**
   * INCOMPLETE -> INCOMPLETE_EXPIRED: a plan purchase that was waiting for its first payment.
   * Any other status (ACTIVE, PAST_DUE, ...) is left alone, so a paid plan is never touched.
   */
  async expireIncompleteSubscription(args: {
    subscriptionId: string;
    clinicId: string;
  }): Promise<boolean> {
    const result = await this.database.executeHealthcareWrite(
      async client =>
        (client as unknown as StoreClient).subscription.updateMany({
          where: { id: args.subscriptionId, status: 'INCOMPLETE' },
          data: { status: 'INCOMPLETE_EXPIRED' },
        }),
      this.audit(args.clinicId, 'SUBSCRIPTION', args.subscriptionId, 'UPDATE', {
        reason: 'Plan purchase payment window expired',
      })
    );
    return result.count === 1;
  }

  /**
   * Compare-and-set of the payment status. `data` (status, transaction id, audit + claim marker
   * metadata) is written in the same statement, so a crash right after the claim never leaves a
   * COMPLETED payment without its transaction id or claim token.
   */
  async claimStatusTransition(args: {
    paymentId: string;
    clinicId: string;
    observedStatus: string;
    data: WhereInput;
  }): Promise<boolean> {
    const result = await this.database.executeHealthcareWrite(
      async client =>
        (client as unknown as StoreClient).payment.updateMany({
          where: { id: args.paymentId, status: args.observedStatus },
          data: args.data,
        }),
      this.audit(args.clinicId, 'PAYMENT', args.paymentId, 'UPDATE', {
        reason: 'Payment callback status transition',
        from: args.observedStatus,
        to: String(args.data['status']),
      })
    );
    return result.count === 1;
  }

  /**
   * Takes over a COMPLETED payment whose finalisation never finished. Optimistic on `updatedAt`:
   * if anything touched the row since it was read (another repair run, a payout write) the
   * takeover loses and the caller reports "processing" instead of racing a live worker.
   */
  async takeOverClaim(args: {
    payment: PaymentRow;
    marker: FinalisationMarker;
    clinicId: string;
  }): Promise<boolean> {
    const metadata = {
      ...(asJsonRecord(args.payment.metadata) ?? {}),
      finalisation: args.marker,
    };
    const result = await this.database.executeHealthcareWrite(
      async client =>
        (client as unknown as StoreClient).payment.updateMany({
          where: { id: args.payment.id, status: 'COMPLETED', updatedAt: args.payment.updatedAt },
          data: { metadata },
        }),
      this.audit(args.clinicId, 'PAYMENT', args.payment.id, 'UPDATE', {
        reason: 'Payment finalisation takeover',
      })
    );
    return result.count === 1;
  }

  /**
   * Read-modify-write of `payment.metadata` guarded by `updatedAt`, retried a few times, so a
   * concurrent writer (payout preparation, another worker) is never silently overwritten.
   * `mutate` returns the next metadata, or null when there is nothing to write.
   */
  async mutateMetadata(
    paymentId: string,
    clinicId: string,
    mutate: (current: JsonRecord) => JsonRecord | null
  ): Promise<MetadataMutationResult> {
    for (let attempt = 0; attempt < METADATA_CAS_ATTEMPTS; attempt += 1) {
      const row = await this.readPayment(paymentId, clinicId);
      if (!row) {
        return 'missing';
      }
      const next = mutate(asJsonRecord(row.metadata) ?? {});
      if (next === null) {
        return 'unchanged';
      }
      const result = await this.database.executeHealthcareWrite(
        async client =>
          (client as unknown as StoreClient).payment.updateMany({
            where: { id: paymentId, updatedAt: row.updatedAt },
            data: { metadata: next },
          }),
        this.audit(clinicId, 'PAYMENT', paymentId, 'UPDATE', { reason: 'Payment metadata merge' })
      );
      if (result.count === 1) {
        return 'written';
      }
    }
    return 'conflict';
  }

  /**
   * Records a gateway-confirmed late payment on a released (EXPIRED / CANCELLED) payment row:
   * status COMPLETED + the verified transaction id + `mutate(current metadata)`. Compare-and-set
   * on the released status and `updatedAt`, so a row that moved on in between is never touched.
   * Returns the status the row had when it was recorded, or null when nothing was written.
   */
  async recordLateSettlement(args: {
    paymentId: string;
    clinicId: string;
    releasedStatuses: readonly string[];
    completedStatus: string;
    transactionId?: string | undefined;
    mutate: (current: JsonRecord, releasedStatus: string) => JsonRecord;
  }): Promise<string | null> {
    for (let attempt = 0; attempt < METADATA_CAS_ATTEMPTS; attempt += 1) {
      const row = await this.readPayment(args.paymentId, args.clinicId);
      const status = String(row?.status ?? '').toUpperCase();
      if (!row || !args.releasedStatuses.includes(status)) {
        return null;
      }
      const result = await this.database.executeHealthcareWrite(
        async client =>
          (client as unknown as StoreClient).payment.updateMany({
            where: { id: args.paymentId, status: row.status, updatedAt: row.updatedAt },
            data: {
              status: args.completedStatus,
              ...(args.transactionId ? { transactionId: args.transactionId } : {}),
              metadata: args.mutate(asJsonRecord(row.metadata) ?? {}, status),
            },
          }),
        this.audit(args.clinicId, 'PAYMENT', args.paymentId, 'UPDATE', {
          reason: 'Late settlement recorded (gateway-confirmed payment after release)',
        })
      );
      if (result.count === 1) {
        return status;
      }
    }
    return null;
  }

  /** Stamps `sideEffectsAppliedAt` LAST, and only while the caller still owns the claim. */
  async markSideEffectsApplied(
    paymentId: string,
    clinicId: string,
    claimToken: string,
    now: Date
  ): Promise<boolean> {
    let alreadyApplied = false;
    const result = await this.mutateMetadata(paymentId, clinicId, current => {
      const marker = readFinalisationMarker(current);
      if (!marker || marker.claimToken !== claimToken) {
        return null;
      }
      if (marker.sideEffectsAppliedAt) {
        alreadyApplied = true;
        return null;
      }
      return {
        ...current,
        finalisation: { ...marker, sideEffectsAppliedAt: now.toISOString() },
      };
    });
    return result === 'written' || alreadyApplied;
  }

  /**
   * Atomically moves an invoice to PAID. Returns true only for the call that performed the
   * transition (the one that may therefore send the receipt). Stamps which payment settled it.
   */
  async markInvoicePaid(args: {
    invoice: InvoiceRow;
    clinicId: string;
    paidAt: Date;
    settledByPaymentId?: string;
  }): Promise<boolean> {
    const metadata = args.settledByPaymentId
      ? {
          ...(asJsonRecord(args.invoice.metadata) ?? {}),
          settledByPaymentId: args.settledByPaymentId,
        }
      : undefined;
    const result = await this.database.executeHealthcareWrite(
      async client =>
        (client as unknown as StoreClient).invoice.updateMany({
          where: { id: args.invoice.id, status: { not: 'PAID' } },
          data: {
            status: 'PAID',
            paidAt: args.paidAt,
            ...(metadata ? { metadata } : {}),
          },
        }),
      this.audit(args.clinicId, 'INVOICE', args.invoice.id, 'UPDATE', {
        reason: 'Invoice marked paid',
        ...(args.settledByPaymentId ? { settledByPaymentId: args.settledByPaymentId } : {}),
      })
    );
    return result.count === 1;
  }

  /**
   * Conditional appointment confirmation: matches only while the appointment is still in a state
   * a payment may advance (and, when enforced, while its payment window is still open).
   */
  async confirmAppointment(args: {
    appointmentId: string;
    appointmentClinicId: string;
    statusFilter: { in: string[] } | { notIn: string[] };
    enforcePaymentWindow: boolean;
    confirmationExpiresAt: Date | null;
    confirmedStatus: string;
    details: Record<string, unknown>;
    actorUserId?: string;
  }): Promise<boolean> {
    const now = new Date();
    const result = await this.database.executeHealthcareWrite(
      async client =>
        (client as unknown as StoreClient).appointment.updateMany({
          where: {
            id: args.appointmentId,
            status: args.statusFilter,
            ...(args.enforcePaymentWindow
              ? { OR: [{ paymentExpiresAt: null }, { paymentExpiresAt: { gt: now } }] }
              : {}),
          },
          data: {
            status: args.confirmedStatus,
            confirmationExpiresAt: args.confirmationExpiresAt,
          },
        }),
      {
        ...this.audit(
          args.appointmentClinicId,
          'APPOINTMENT',
          args.appointmentId,
          'UPDATE',
          args.details
        ),
        userId: args.actorUserId ?? 'system',
      }
    );
    return result.count > 0;
  }
}
