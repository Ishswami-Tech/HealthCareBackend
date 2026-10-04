/**
 * Payment finalisation: turns a gateway-verified payment into its business effects exactly once,
 * and repairs the cases where that did not finish.
 *
 * Safety properties (see billing-payment-finalisation.util.ts for the marker format):
 *  (a) concurrent deliveries: only the delivery whose compare-and-set claim succeeds applies the
 *      side effects; a loser that sees a young unfinished claim answers "processing" and does
 *      nothing, a loser that sees a finished claim only reads;
 *  (b) crash between the claim and the side effects: a COMPLETED payment whose claim is older
 *      than the grace window and was never stamped `sideEffectsAppliedAt` is taken over and the
 *      FULL set of side effects is re-applied;
 *  (c) lost acknowledgement: the claim carries a per-delivery token, so a delivery whose claim
 *      committed but reported "0 rows" re-reads, recognises its own token and IS the winner.
 *
 * Every side effect is individually idempotent per payment id, and `sideEffectsAppliedAt` is
 * stamped last. Final payment state only ever comes from backend verification: nothing here
 * trusts the client.
 */
import { LogLevel } from '@core/types';
import type { AppointmentWithRelations } from '@core/types';
import type { PaymentStatusResult } from '@core/types/payment.types';
import type { PaymentStatus } from '@core/types/enums.types';
import { AppointmentStatus } from '@dtos/appointment.dto';
import type { UpdatePaymentDto } from '@dtos/billing.dto';
import {
  FINALISATION_GRACE_MS,
  asJsonRecord,
  buildFinalisationMarker,
  classifyFinalisationClaim,
  createClaimToken,
  isDistinctGatewayPayment,
  ownsClaim,
  readFinalisationMarker,
  resolvePaidConfirmationExpiresAt,
  type JsonRecord,
  type SettlementAnomalyReason,
} from '@services/billing/billing-payment-finalisation.util';
import type {
  BillingPaymentStore,
  InvoiceRow,
  PaymentRow,
} from '@services/billing/billing-payment.store';

export interface InvoiceSettlement {
  /**
   * - none: the payment is not linked to an invoice
   * - settled: THIS call moved the invoice to PAID
   * - already-settled: the invoice was already PAID by this very payment (a repair re-run)
   * - duplicate: the invoice was already PAID by a different payment / staff
   * - underpaid: completed payments do not cover the invoice total
   */
  state: 'none' | 'settled' | 'already-settled' | 'duplicate' | 'underpaid';
  invoice?: InvoiceRow | null;
}

export interface SettlementFlag {
  paymentId: string;
  clinicId: string;
  reason: SettlementAnomalyReason;
  appointmentId?: string | undefined;
  invoiceId?: string | undefined;
  orderId?: string | undefined;
  transactionId?: string | undefined;
  amount?: number | undefined;
  userId?: string | null | undefined;
}

export interface PaymentFinaliserPorts {
  store: BillingPaymentStore;
  log: (level: LogLevel, message: string, context: Record<string, unknown>) => Promise<void>;
  /** Re-applies status/transaction id through the normal path (events + cache), no settlement. */
  updatePaymentAfterClaim: (paymentId: string, data: UpdatePaymentDto) => Promise<unknown>;
  settleInvoice: (payment: PaymentRow, clinicId: string) => Promise<InvoiceSettlement>;
  isPlanAmountCovered: (subscriptionId: string, payment: PaymentRow) => Promise<boolean>;
  renewSubscription: (
    subscriptionId: string,
    payment: PaymentRow,
    options: { activationOnly: boolean }
  ) => Promise<void>;
  recordSubscriptionLedger: (
    paymentId: string,
    clinicId: string,
    subscriptionId: string
  ) => Promise<void>;
  loadAppointment: (appointmentId: string) => Promise<AppointmentWithRelations | null>;
  syncAppointment: (args: {
    appointmentId: string;
    clinicId: string;
    paymentId: string;
    amount: number;
    appointment: AppointmentWithRelations;
    userId: string | null;
  }) => Promise<unknown>;
  emitPaymentLifecycle: (args: {
    clinicId: string;
    paymentId: string;
    status: string;
    amount: number;
    userId?: string;
    appointmentId?: string;
    appointment?: AppointmentWithRelations | null;
    subscriptionId?: string;
  }) => Promise<void>;
  flagSettlement: (flag: SettlementFlag) => Promise<void>;
}

export interface FinaliserInput {
  /** The payment as found by the caller (may come from a cache). */
  payment: PaymentRow;
  clinicId: string;
  /** The payment id the delivery referenced (gateway or local). */
  paymentId: string;
  orderId: string;
  provider: string;
  paymentStatus: PaymentStatusResult;
  incomingStatus: PaymentStatus;
  /** Status / transaction id / method / surcharge to persist. Metadata is composed here. */
  update: Omit<UpdatePaymentDto, 'metadata'>;
  /** Existing metadata plus any order re-binding keys. */
  baseMetadata: JsonRecord;
}

export interface FinalisationOutcome {
  payment: unknown;
  invoice?: unknown;
  appointment?: unknown;
  /** The winner is still finalising: retry shortly. No side effect was run by this call. */
  processing?: boolean;
}

interface SideEffectContext {
  payment: PaymentRow;
  clinicId: string;
  orderId: string;
  claimToken: string;
  gatewayStatus: string;
  gatewayAmount: number;
  /** Admin repair: confirm even when the payment window elapsed. */
  manualActorUserId?: string;
}

const PAYABLE_APPOINTMENT_STATUSES: readonly string[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.FOLLOW_UP_SCHEDULED,
];

function lower(value: unknown): string {
  return (typeof value === 'string' ? value : '').toLowerCase();
}

export class BillingPaymentFinaliser {
  constructor(private readonly ports: PaymentFinaliserPorts) {}

  /** Entry point for a gateway-verified delivery (webhook job, callback, poll, reconcile). */
  async process(input: FinaliserInput, depth = 0): Promise<FinalisationOutcome> {
    const { payment, clinicId, orderId } = input;
    const currentStatus = lower(payment.status);
    const incomingStatus = lower(input.incomingStatus);
    const incomingCompleted = incomingStatus === 'completed';

    if (currentStatus === 'completed') {
      if (!incomingCompleted) {
        await this.logIgnored(input, currentStatus, incomingStatus);
        return { payment };
      }
      return this.handleSettledPayment(input);
    }

    // The gateway reports success for a payment this system already cancelled or expired: the
    // booking was released. Never revive it; it is only logged and announced (no refunds for
    // visits that never take place).
    if ((currentStatus === 'cancelled' || currentStatus === 'expired') && incomingCompleted) {
      await this.ports.flagSettlement({
        paymentId: payment.id,
        clinicId,
        reason: 'LATE_SETTLEMENT',
        orderId,
        transactionId: input.paymentStatus.transactionId || input.paymentId,
        amount: input.paymentStatus.amount,
        userId: payment.userId,
        ...(payment.appointmentId ? { appointmentId: payment.appointmentId } : {}),
        ...(payment.invoiceId ? { invoiceId: payment.invoiceId } : {}),
      });
      return { payment };
    }

    if (
      currentStatus === incomingStatus ||
      currentStatus === 'refunded' ||
      currentStatus === 'cancelled' ||
      currentStatus === 'expired' ||
      (currentStatus === 'failed' && incomingStatus === 'pending')
    ) {
      await this.logIgnored(input, currentStatus, incomingStatus);
      return { payment };
    }

    return this.claimAndApply(input, depth);
  }

  /**
   * Repairs a COMPLETED payment whose finalisation never finished. `force` skips the grace window
   * (admin action / sweeper that already waited). Returns null when nothing was repaired.
   */
  async repairCompleted(
    payment: PaymentRow,
    options: { force?: boolean; orderId?: string; manualActorUserId?: string } = {}
  ): Promise<FinalisationOutcome | null> {
    const fresh = (await this.ports.store.readPayment(payment.id, payment.clinicId)) ?? payment;
    if (lower(fresh.status) !== 'completed') {
      return null;
    }
    const marker = readFinalisationMarker(fresh.metadata);
    if (marker?.sideEffectsAppliedAt) {
      return null;
    }
    const audit = asJsonRecord(asJsonRecord(fresh.metadata)?.['callbackAudit']);
    const orderId =
      options.orderId ||
      (typeof audit?.['orderId'] === 'string' ? audit['orderId'] : '') ||
      fresh.transactionId ||
      fresh.id;
    return this.resolveCompleted({
      fresh,
      claimToken: null,
      clinicId: fresh.clinicId,
      orderId,
      gatewayStatus: 'completed',
      gatewayAmount: fresh.amount,
      force: options.force === true,
      ...(options.manualActorUserId ? { manualActorUserId: options.manualActorUserId } : {}),
    });
  }

  /**
   * Admin recovery of a COMPLETED payment (POST /billing/appointments/:id/manual-reconcile): runs
   * the full side-effect set when it never finished and, when it had been stamped earlier but the
   * booking was left unconfirmed (the payment window had lapsed), confirms it now without the
   * window. The caller has already re-verified the payment with the gateway.
   */
  async repairManually(
    payment: PaymentRow,
    args: { actorUserId: string; orderId: string }
  ): Promise<FinalisationOutcome> {
    const fresh = (await this.ports.store.readPayment(payment.id, payment.clinicId)) ?? payment;
    const repaired = await this.repairCompleted(fresh, {
      force: true,
      orderId: args.orderId,
      manualActorUserId: args.actorUserId,
    });
    if (repaired) {
      return repaired;
    }

    const { appointment, changed } = await this.confirmAppointment({
      payment: fresh,
      clinicId: fresh.clinicId,
      orderId: args.orderId,
      claimToken: '',
      gatewayStatus: 'completed',
      gatewayAmount: fresh.amount,
      manualActorUserId: args.actorUserId,
    });
    if (changed && appointment && fresh.appointmentId) {
      void this.ports
        .syncAppointment({
          appointmentId: fresh.appointmentId,
          clinicId: appointment.clinicId || fresh.clinicId,
          paymentId: fresh.id,
          amount: fresh.amount,
          appointment,
          userId: fresh.userId,
        })
        .catch((error: unknown) =>
          this.ports.log(LogLevel.WARN, 'Failed to sync appointment after manual repair', {
            clinicId: fresh.clinicId,
            paymentId: fresh.id,
            error: error instanceof Error ? error.message : String(error),
          })
        );
      await this.ports.emitPaymentLifecycle({
        clinicId: fresh.clinicId,
        paymentId: fresh.id,
        status: 'completed',
        amount: fresh.amount,
        ...(fresh.userId ? { userId: fresh.userId } : {}),
        appointmentId: fresh.appointmentId,
        appointment,
      });
    }
    return { payment: fresh, ...(appointment ? { appointment } : {}) };
  }

  /** Sweeper entry: repairs payments stuck between claim and side effects. */
  async repairStalled(limit = 50, now: Date = new Date()): Promise<number> {
    const rows = await this.ports.store.listRecentCompleted({
      since: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      until: new Date(now.getTime() - FINALISATION_GRACE_MS),
      limit,
    });
    let repaired = 0;
    for (const row of rows) {
      const marker = readFinalisationMarker(row.metadata);
      if (!marker || marker.sideEffectsAppliedAt) {
        continue;
      }
      try {
        const outcome = await this.repairCompleted(row);
        if (outcome && !outcome.processing) {
          repaired += 1;
        }
      } catch (error) {
        await this.ports.log(LogLevel.ERROR, 'Stalled payment finalisation repair failed', {
          paymentId: row.id,
          clinicId: row.clinicId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return repaired;
  }

  // -------------------------------------------------------------------------------------------

  private async logIgnored(
    input: FinaliserInput,
    currentStatus: string,
    incomingStatus: string
  ): Promise<void> {
    await this.ports.log(LogLevel.INFO, 'Ignoring duplicate or regressive payment callback', {
      clinicId: input.clinicId,
      paymentId: input.payment.id,
      currentStatus,
      incomingStatus,
      orderId: input.orderId,
      provider: input.provider || 'unknown',
    });
  }

  /** A delivery for a payment that is already COMPLETED locally. */
  private async handleSettledPayment(input: FinaliserInput): Promise<FinalisationOutcome> {
    const fresh = (await this.ports.store.readPayment(input.payment.id, input.clinicId)) ?? null;
    if (!fresh) {
      return { payment: input.payment };
    }

    const verifiedTransactionId = input.paymentStatus.transactionId || '';
    if (
      isDistinctGatewayPayment({
        storedTransactionId: fresh.transactionId,
        storedMetadata: fresh.metadata,
        verifiedTransactionId,
        orderId: input.orderId,
      })
    ) {
      // A different gateway order for an already settled payment was paid as well.
      await this.ports.flagSettlement({
        paymentId: fresh.id,
        clinicId: input.clinicId,
        reason: 'DUPLICATE_SETTLEMENT',
        orderId: input.orderId,
        transactionId: verifiedTransactionId,
        amount: input.paymentStatus.amount,
        userId: fresh.userId,
        ...(fresh.appointmentId ? { appointmentId: fresh.appointmentId } : {}),
        ...(fresh.invoiceId ? { invoiceId: fresh.invoiceId } : {}),
      });
      return { payment: fresh };
    }

    return this.resolveCompleted({
      fresh,
      claimToken: null,
      clinicId: input.clinicId,
      orderId: input.orderId,
      gatewayStatus: input.paymentStatus.status,
      gatewayAmount: input.paymentStatus.amount,
      force: false,
    });
  }

  /**
   * Decides what a delivery may do with a COMPLETED payment it did not claim itself, from the
   * stored marker: nothing (finished), "processing" (someone is working), or a takeover.
   */
  private async resolveCompleted(args: {
    fresh: PaymentRow;
    claimToken: string | null;
    clinicId: string;
    orderId: string;
    gatewayStatus: string;
    gatewayAmount: number;
    force: boolean;
    manualActorUserId?: string;
  }): Promise<FinalisationOutcome> {
    const { fresh, clinicId } = args;
    const view = classifyFinalisationClaim(fresh.metadata, args.claimToken, Date.now());
    const marker = readFinalisationMarker(fresh.metadata);

    if (view === 'applied') {
      return { payment: fresh };
    }
    if (view === 'legacy' && !args.manualActorUserId) {
      return this.reconcileLegacy(fresh, clinicId);
    }
    if (view === 'in_progress' && !args.force) {
      await this.ports.log(LogLevel.INFO, 'Payment is being finalised by another delivery', {
        clinicId,
        paymentId: fresh.id,
        orderId: args.orderId,
      });
      return { payment: fresh, processing: true };
    }

    // stale (or forced): take the claim over, then run the full idempotent set.
    const newToken = createClaimToken();
    const tookOver = await this.ports.store.takeOverClaim({
      payment: fresh,
      marker: buildFinalisationMarker(newToken, new Date()),
      clinicId,
    });
    if (!tookOver) {
      return { payment: fresh, processing: true };
    }
    await this.ports.log(LogLevel.WARN, 'Taking over a stalled payment finalisation', {
      clinicId,
      paymentId: fresh.id,
      orderId: args.orderId,
      previousClaimedAt: marker?.claimedAt,
    });
    return this.applyAsClaimOwner(fresh, newToken, args);
  }

  private async applyAsClaimOwner(
    payment: PaymentRow,
    claimToken: string,
    args: {
      clinicId: string;
      orderId: string;
      gatewayStatus: string;
      gatewayAmount: number;
      manualActorUserId?: string;
    }
  ): Promise<FinalisationOutcome> {
    const effects = await this.applyCompletedSideEffects({
      payment,
      clinicId: args.clinicId,
      orderId: args.orderId,
      claimToken,
      gatewayStatus: args.gatewayStatus,
      gatewayAmount: args.gatewayAmount,
      ...(args.manualActorUserId ? { manualActorUserId: args.manualActorUserId } : {}),
    });
    return {
      payment,
      ...(effects.invoice ? { invoice: effects.invoice } : {}),
      ...(effects.appointment ? { appointment: effects.appointment } : {}),
    };
  }

  /** The payment was completed before the claim protocol existed (or by staff): old, safe reconcile. */
  private async reconcileLegacy(
    payment: PaymentRow,
    clinicId: string
  ): Promise<FinalisationOutcome> {
    let settlement: InvoiceSettlement = { state: 'none' };
    if (payment.invoiceId) {
      settlement = await this.ports.settleInvoice(payment, clinicId);
    }
    const subscriptionId = payment.subscriptionId || settlement.invoice?.subscriptionId || null;
    if (subscriptionId && settlement.state !== 'underpaid') {
      // Activation only: a replay of a payment of unknown history can never extend a plan.
      await this.ports.renewSubscription(subscriptionId, payment, { activationOnly: true });
      await this.ports.recordSubscriptionLedger(payment.id, clinicId, subscriptionId);
    }
    return {
      payment,
      ...(settlement.state === 'settled' && settlement.invoice
        ? { invoice: settlement.invoice }
        : {}),
    };
  }

  private async claimAndApply(input: FinaliserInput, depth: number): Promise<FinalisationOutcome> {
    const { payment, clinicId, orderId } = input;
    const incomingStatus = lower(input.incomingStatus);
    const incomingCompleted = incomingStatus === 'completed';
    const claimToken = createClaimToken();
    const now = new Date();

    const metadata: JsonRecord = {
      ...input.baseMetadata,
      callbackAudit: {
        provider: input.provider || 'unknown',
        orderId,
        requestedPaymentId: input.paymentId,
        verifiedTransactionId: input.paymentStatus.transactionId || input.paymentId,
        receivedAt: now.toISOString(),
        incomingStatus,
        claimToken,
      },
      ...(incomingCompleted ? { finalisation: buildFinalisationMarker(claimToken, now) } : {}),
    };

    const claimed = await this.ports.store.claimStatusTransition({
      paymentId: payment.id,
      clinicId,
      observedStatus: String(payment.status),
      data: { ...input.update, metadata },
    });

    if (claimed) {
      return this.completeAsWinner(input, payment, claimToken);
    }

    // Lost the compare-and-set - or won it and lost the acknowledgement. Only the stored token
    // can tell the two apart.
    const fresh = await this.ports.store.readPayment(payment.id, clinicId);
    if (!fresh) {
      return { payment };
    }
    if (ownsClaim(fresh.metadata, claimToken)) {
      await this.ports.log(
        LogLevel.WARN,
        'Payment claim committed but was reported lost; resuming',
        {
          clinicId,
          paymentId: payment.id,
          orderId,
        }
      );
      return this.completeAsWinner(input, fresh, claimToken);
    }

    await this.ports.log(
      LogLevel.INFO,
      'Payment callback lost the status transition to a concurrent delivery',
      { clinicId, paymentId: payment.id, incomingStatus, orderId, provider: input.provider }
    );
    if (incomingCompleted && lower(fresh.status) === 'completed') {
      return this.resolveCompleted({
        fresh,
        claimToken: null,
        clinicId,
        orderId,
        gatewayStatus: input.paymentStatus.status,
        gatewayAmount: input.paymentStatus.amount,
        force: false,
      });
    }

    // The snapshot this delivery decided from was stale (it may come from a read cache): the row
    // is in a different, still unsettled state. Decide again from the fresh row, once.
    if (depth < 1 && lower(fresh.status) !== lower(payment.status)) {
      const rebound = input.baseMetadata['supersededOrderId'] !== undefined;
      return this.process(
        {
          ...input,
          payment: fresh,
          baseMetadata: {
            ...(asJsonRecord(fresh.metadata) ?? {}),
            ...(rebound
              ? {
                  orderId: input.baseMetadata['orderId'],
                  provider: input.baseMetadata['provider'],
                  supersededOrderId: input.baseMetadata['supersededOrderId'],
                }
              : {}),
          },
        },
        depth + 1
      );
    }
    return { payment: fresh };
  }

  private async completeAsWinner(
    input: FinaliserInput,
    payment: PaymentRow,
    claimToken: string
  ): Promise<FinalisationOutcome> {
    const updatedPayment = await this.ports.updatePaymentAfterClaim(payment.id, input.update);

    if (lower(input.incomingStatus) !== 'completed') {
      // failed / pending / cancelled transitions have no side effects beyond the lifecycle event.
      void this.ports
        .emitPaymentLifecycle({
          clinicId: input.clinicId,
          paymentId: payment.id,
          status: input.paymentStatus.status,
          amount: input.paymentStatus.amount,
          ...(payment.userId ? { userId: payment.userId } : {}),
          ...(payment.appointmentId ? { appointmentId: payment.appointmentId } : {}),
        })
        .catch((error: unknown) =>
          this.ports.log(LogLevel.WARN, 'Failed to emit payment lifecycle events', {
            clinicId: input.clinicId,
            paymentId: payment.id,
            error: error instanceof Error ? error.message : String(error),
          })
        );
      return { payment: updatedPayment };
    }

    const effects = await this.applyCompletedSideEffects({
      payment,
      clinicId: input.clinicId,
      orderId: input.orderId,
      claimToken,
      gatewayStatus: input.paymentStatus.status,
      gatewayAmount: input.paymentStatus.amount,
    });
    return {
      payment: updatedPayment,
      ...(effects.invoice ? { invoice: effects.invoice } : {}),
      ...(effects.appointment ? { appointment: effects.appointment } : {}),
    };
  }

  /**
   * The full, individually idempotent set of side effects of a completed payment. Runs for the
   * claim winner and, unchanged, for a repair run. `sideEffectsAppliedAt` is stamped last.
   */
  private async applyCompletedSideEffects(
    ctx: SideEffectContext
  ): Promise<{ invoice?: unknown; appointment?: unknown }> {
    const { payment, clinicId } = ctx;

    // 1. Invoice: PAID only once completed payments cover the total; a second payment on an
    //    already settled invoice is flagged, never silently granted service.
    let settlement: InvoiceSettlement = { state: 'none' };
    if (payment.invoiceId) {
      settlement = await this.ports.settleInvoice(payment, clinicId);
    }
    if (settlement.state === 'duplicate' || settlement.state === 'underpaid') {
      await this.ports.flagSettlement({
        paymentId: payment.id,
        clinicId,
        reason: settlement.state === 'duplicate' ? 'DUPLICATE_SETTLEMENT' : 'UNDERPAYMENT',
        orderId: ctx.orderId,
        amount: payment.amount,
        userId: payment.userId,
        ...(payment.invoiceId ? { invoiceId: payment.invoiceId } : {}),
        ...(payment.appointmentId ? { appointmentId: payment.appointmentId } : {}),
      });
      // Not settled by this payment: no plan period, no revenue, no confirmation, no event.
      await this.stampApplied(ctx);
      return {};
    }

    // 2. Subscription: activate / renew once per payment id, then book the revenue once.
    const subscriptionId = payment.subscriptionId || settlement.invoice?.subscriptionId || null;
    if (subscriptionId) {
      const covered =
        settlement.state === 'none'
          ? await this.ports.isPlanAmountCovered(subscriptionId, payment)
          : true;
      if (!covered) {
        await this.ports.flagSettlement({
          paymentId: payment.id,
          clinicId,
          reason: 'UNDERPAYMENT',
          orderId: ctx.orderId,
          amount: payment.amount,
          userId: payment.userId,
          ...(payment.appointmentId ? { appointmentId: payment.appointmentId } : {}),
        });
        await this.stampApplied(ctx);
        return {};
      }
      await this.ports.renewSubscription(subscriptionId, payment, { activationOnly: false });
      await this.ports.recordSubscriptionLedger(payment.id, clinicId, subscriptionId);
    }

    // 3. Appointment: conditional on an allowed prior state.
    const appointment = payment.appointmentId
      ? (await this.confirmAppointment(ctx)).appointment
      : null;
    if (appointment && payment.appointmentId) {
      void this.ports
        .syncAppointment({
          appointmentId: payment.appointmentId,
          clinicId: appointment.clinicId || clinicId,
          paymentId: payment.id,
          amount: ctx.gatewayAmount,
          appointment,
          userId: payment.userId,
        })
        .catch((error: unknown) =>
          this.ports.log(LogLevel.WARN, 'Failed to sync appointment after payment', {
            clinicId,
            paymentId: payment.id,
            appointmentId: payment.appointmentId,
            error: error instanceof Error ? error.message : String(error),
          })
        );
    }

    // 4. payment.completed - only the run that completes the finalisation emits it (awaited, so
    //    a failure leaves the marker unset and the repair path emits it again).
    await this.ports.emitPaymentLifecycle({
      clinicId,
      paymentId: payment.id,
      status: ctx.gatewayStatus,
      amount: ctx.gatewayAmount,
      ...(payment.userId ? { userId: payment.userId } : {}),
      ...(payment.appointmentId ? { appointmentId: payment.appointmentId } : {}),
      ...(appointment ? { appointment } : {}),
      ...(subscriptionId ? { subscriptionId } : {}),
    });

    // 5. LAST: mark the finalisation complete.
    await this.stampApplied(ctx);

    return {
      ...(settlement.state === 'settled' || settlement.state === 'already-settled'
        ? { invoice: settlement.invoice }
        : {}),
      ...(appointment ? { appointment } : {}),
    };
  }

  private async stampApplied(ctx: SideEffectContext): Promise<void> {
    const stamped = await this.ports.store.markSideEffectsApplied(
      ctx.payment.id,
      ctx.clinicId,
      ctx.claimToken,
      new Date()
    );
    if (!stamped) {
      await this.ports.log(
        LogLevel.WARN,
        'Could not stamp payment finalisation: the claim was taken over by another run',
        { clinicId: ctx.clinicId, paymentId: ctx.payment.id }
      );
    }
  }

  private async confirmAppointment(
    ctx: SideEffectContext
  ): Promise<{ appointment: AppointmentWithRelations | null; changed: boolean }> {
    const { payment } = ctx;
    if (!payment.appointmentId) {
      return { appointment: null, changed: false };
    }
    const appointment = await this.ports.loadAppointment(payment.appointmentId);
    if (!appointment) {
      return { appointment: null, changed: false };
    }
    if (String(appointment.status).toUpperCase() === String(AppointmentStatus.CONFIRMED)) {
      return { appointment, changed: false };
    }

    const manual = ctx.manualActorUserId !== undefined;
    const confirmed = await this.ports.store.confirmAppointment({
      appointmentId: appointment.id,
      appointmentClinicId: appointment.clinicId || ctx.clinicId,
      statusFilter: manual
        ? { notIn: [AppointmentStatus.CANCELLED, AppointmentStatus.COMPLETED] }
        : { in: [...PAYABLE_APPOINTMENT_STATUSES] },
      enforcePaymentWindow: !manual,
      // Computed from the appointment's own start: see billing.events.ts 'Auto-confirm after payment'.
      confirmationExpiresAt: resolvePaidConfirmationExpiresAt(appointment),
      confirmedStatus: AppointmentStatus.CONFIRMED,
      details: {
        reason: manual ? 'Manual payment reconciliation' : 'Payment callback completed',
        paymentId: payment.id,
        orderId: ctx.orderId,
      },
      ...(ctx.manualActorUserId ? { actorUserId: ctx.manualActorUserId } : {}),
    });
    if (!confirmed) {
      return { appointment: null, changed: false };
    }
    return {
      appointment: (await this.ports.loadAppointment(payment.appointmentId)) ?? appointment,
      changed: true,
    };
  }
}
