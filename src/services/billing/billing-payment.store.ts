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
    orderBy?: { updatedAt: 'asc' | 'desc' };
  }) => Promise<PaymentRow[]>;
  updateMany: (args: { where: WhereInput; data: WhereInput }) => Promise<UpdateManyResult>;
}

interface InvoiceDelegate {
  findUnique: (args: { where: { id: string } }) => Promise<InvoiceRow | null>;
  updateMany: (args: { where: WhereInput; data: WhereInput }) => Promise<UpdateManyResult>;
}

interface AppointmentDelegate {
  updateMany: (args: { where: WhereInput; data: WhereInput }) => Promise<UpdateManyResult>;
}

type StoreClient = {
  payment: PaymentDelegate;
  invoice: InvoiceDelegate;
  appointment: AppointmentDelegate;
};

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
