import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BillingService } from './billing.service';
import { DatabaseService } from '@infrastructure/database';
import { EventService } from '@infrastructure/events/event.service';
import { LoggingService } from '@infrastructure/logging';
import { EmailService } from '@communication/channels/email/email.service';
import { EmailTemplatesService } from '@communication/channels/email/email-templates.service';
import { LogType, LogLevel, AppointmentStatus, PaymentStatus } from '@core/types';
import type { AppointmentWithRelations } from '@core/types';
import { formatCurrencyFromMinorUnits } from '@utils/currency.util';
import { resolvePaidConfirmationExpiresAt } from './billing-payment-finalisation.util';

/**
 * Appointment statuses that are over. A payment that completes after the appointment reached one
 * of them must not change it: handlePaymentCallback refuses to confirm an expired hold for the
 * same reason (the slot may already be rebooked), and this listener has to agree.
 */
const SETTLED_APPOINTMENT_STATUSES: ReadonlySet<string> = new Set([
  String(AppointmentStatus.EXPIRED),
  String(AppointmentStatus.CANCELLED),
  String(AppointmentStatus.COMPLETED),
  String(AppointmentStatus.NO_SHOW),
]);

/** Statuses a completed payment may advance (PENDING → SCHEDULED, SCHEDULED → CONFIRMED). */
const PAYABLE_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  AppointmentStatus.PENDING,
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.FOLLOW_UP_SCHEDULED,
];

/**
 * Email address that receives an internal notification every time a
 * payment completes for an appointment. Configurable via the
 * `ADMIN_NOTIFICATION_EMAIL` env var; falls back to the project owner.
 */
const ADMIN_NOTIFICATION_EMAIL =
  process.env['ADMIN_NOTIFICATION_EMAIL'] || 'ishswami.tech@gmail.com';

function resolveRecordValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return fallback;
}

function buildAppointmentDetailsUrl(appointmentId: string, appointmentType: string): string {
  const frontendBaseUrl =
    process.env['FRONTEND_URL'] || process.env['NEXT_PUBLIC_APP_URL'] || 'http://localhost:3000';
  const normalizedFrontendUrl = frontendBaseUrl.replace(/\/+$/, '');
  const normalizedType = appointmentType.trim().toUpperCase();

  if (normalizedType.includes('VIDEO')) {
    return `${normalizedFrontendUrl}/meet/${encodeURIComponent(appointmentId)}`;
  }

  return `${normalizedFrontendUrl}/patient/appointments?appointmentId=${encodeURIComponent(appointmentId)}`;
}

/**
 * Billing event listeners for automatic invoice generation and delivery
 */
@Injectable()
export class BillingEventsListener {
  constructor(
    private readonly billingService: BillingService,
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService,
    private readonly emailService: EmailService,
    private readonly emailTemplatesService: EmailTemplatesService
  ) {}

  /**
   * Auto-send subscription confirmation when subscription is created
   */
  @OnEvent('billing.subscription.created')
  async handleSubscriptionCreated(payload: { subscriptionId: string; userId: string }) {
    if (!payload?.subscriptionId) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.WARN,
        'Skipping subscription.created event with missing subscriptionId',
        'BillingEventsListener',
        {
          userId: payload?.userId,
        }
      );
      return;
    }

    await this.loggingService.log(
      LogType.PAYMENT,
      LogLevel.INFO,
      `Handling subscription.created event for subscription ${payload.subscriptionId}`,
      'BillingEventsListener',
      { subscriptionId: payload.subscriptionId, userId: payload.userId }
    );

    try {
      // Send subscription confirmation and receipt via WhatsApp
      await this.billingService.sendSubscriptionConfirmation(payload.subscriptionId);

      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        `Subscription confirmation sent successfully for ${payload.subscriptionId}`,
        'BillingEventsListener',
        { subscriptionId: payload.subscriptionId }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to send subscription confirmation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'BillingEventsListener',
        {
          subscriptionId: payload.subscriptionId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }

  /**
   * Auto-generate PDF when invoice is created
   */
  @OnEvent('billing.invoice.created')
  async handleInvoiceCreated(payload: { invoiceId: string } | string) {
    const invoiceId = typeof payload === 'string' ? payload : payload?.invoiceId;
    try {
      if (!invoiceId) {
        // No redundant warning here, the billing service itself will handle failures
        return;
      }

      // PDF generation is handled by the QueueProcessor to avoid race conditions
      // and ensure consistent processing of heavy tasks
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `BillingEventsListener: Received invoice created event for ${invoiceId}. Handled by queue.`,
        'BillingEventsListener'
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to generate invoice PDF: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'BillingEventsListener',
        {
          invoiceId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }

  /**
   * Auto-send receipt via WhatsApp when payment is completed
   */
  @OnEvent('billing.payment.updated')
  async handlePaymentUpdated(payload: {
    paymentId?: string;
    payment?: { id?: string; status?: string; invoiceId?: string | null };
    payload?: {
      paymentId?: string;
      payment?: { id?: string; status?: string; invoiceId?: string | null };
    };
  }) {
    const paymentId = payload?.paymentId ?? payload?.payload?.paymentId;
    const paymentSnapshot = payload?.payment ?? payload?.payload?.payment;

    if (!paymentId) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.WARN,
        'Skipping payment.updated event with missing paymentId',
        'BillingEventsListener'
      );
      return;
    }

    await this.loggingService.log(
      LogType.PAYMENT,
      LogLevel.INFO,
      `Handling payment.updated event for payment ${paymentId}`,
      'BillingEventsListener',
      { paymentId }
    );

    try {
      // Payment updates are informational only.
      // Receipt WhatsApp delivery is handled by billing.receipt.paid to avoid duplicate sends.
      void paymentSnapshot;
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        `Skipping receipt delivery on payment.updated; handled by billing.receipt.paid`,
        'BillingEventsListener',
        { paymentId }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to send receipt via WhatsApp: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'BillingEventsListener',
        {
          paymentId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }

  /**
   * Auto-send receipt via WhatsApp when invoice is marked as paid
   */
  @OnEvent('billing.receipt.paid')
  async handleReceiptPaid(payload: {
    receiptId?: string;
    invoice?: { id?: string };
    skipWhatsApp?: boolean;
    payload?: {
      receiptId?: string;
      invoice?: { id?: string };
      skipWhatsApp?: boolean;
    };
  }) {
    const receiptId = payload?.receiptId ?? payload?.payload?.receiptId;
    const invoiceSnapshot = payload?.invoice ?? payload?.payload?.invoice;
    const skipWhatsApp = Boolean(payload?.skipWhatsApp ?? payload?.payload?.skipWhatsApp);

    if (!receiptId) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.WARN,
        'Skipping receipt.paid event with missing receiptId',
        'BillingEventsListener'
      );
      return;
    }

    if (skipWhatsApp) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'Skipping receipt.paid WhatsApp delivery — caller requested skipWhatsApp (e.g. manual cash/UPI collection without billingSettings.autoWhatsAppReceipts)',
        'BillingEventsListener',
        { receiptId }
      );
      return;
    }

    await this.loggingService.log(
      LogType.PAYMENT,
      LogLevel.INFO,
      `Handling receipt.paid event for receipt ${receiptId}`,
      'BillingEventsListener',
      { receiptId }
    );

    try {
      const invoiceRecord = await this.databaseService.findInvoiceByIdSafe(receiptId);
      if (invoiceRecord?.sentViaWhatsApp) {
        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.INFO,
          'Skipping receipt.paid delivery because the receipt was already sent via WhatsApp',
          'BillingEventsListener',
          { receiptId }
        );
        return;
      }

      // Make the receipt artifact available first so billing updates are deterministic.
      if (!invoiceRecord?.pdfUrl || !invoiceRecord?.pdfFilePath) {
        await this.billingService.generateInvoicePDF(receiptId);
      }

      // Send receipt via WhatsApp
      const sent = await this.billingService.sendReceiptViaWhatsApp(
        invoiceSnapshot?.id || receiptId
      );

      await this.loggingService.log(
        LogType.PAYMENT,
        sent ? LogLevel.INFO : LogLevel.WARN,
        sent
          ? `Receipt sent via WhatsApp for ${receiptId}`
          : `Receipt WhatsApp delivery skipped or failed for ${receiptId}`,
        'BillingEventsListener',
        { receiptId, sent }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to send receipt via WhatsApp: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'BillingEventsListener',
        {
          receiptId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }

  /**
   * Confirm appointment when payment is completed for appointment
   * Listens to payment.completed simple event (emitted after enterprise event)
   */
  @OnEvent('payment.completed')
  async handlePaymentCompleted(rawPayload: Record<string, unknown>) {
    // BillingService emits payment.completed twice for compatibility:
    // 1) enterprise envelope via emitEnterprise() (source: BillingService, category: BILLING)
    // 2) simple emit() wrapper (source: EventService, category: SYSTEM)
    // Only process the billing-origin envelope here to avoid duplicate confirmation messages.
    const source = resolveRecordValue(rawPayload['source']).toLowerCase();
    const category = resolveRecordValue(rawPayload['category']).toLowerCase();
    const isBillingEnvelope = source === 'billingservice' || category === 'billing';

    if (!isBillingEnvelope) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'Skipping plain payment.completed event to avoid duplicate confirmation processing',
        'BillingEventsListener'
      );
      return;
    }

    // EventService wraps every emit() in an enterprise envelope:
    // { eventId, eventType, payload: <original data>, clinicId, ... }
    // Unwrap the inner payload, falling back to top-level fields for compatibility.
    const inner =
      rawPayload['payload'] !== null &&
      typeof rawPayload['payload'] === 'object' &&
      !Array.isArray(rawPayload['payload'])
        ? (rawPayload['payload'] as Record<string, unknown>)
        : rawPayload;

    const payload = {
      appointmentId:
        (inner['appointmentId'] as string | undefined) ??
        (rawPayload['appointmentId'] as string | undefined),
      paymentId:
        (inner['paymentId'] as string | undefined) ??
        (rawPayload['paymentId'] as string | undefined) ??
        '',
      status:
        (inner['status'] as string | undefined) ??
        (rawPayload['status'] as string | undefined) ??
        '',
      clinicId:
        (inner['clinicId'] as string | undefined) ?? (rawPayload['clinicId'] as string | undefined),
      appointment: (inner['appointment'] ?? rawPayload['appointment']) as
        { clinicId?: string; patientId?: string; doctorId?: string } | undefined,
      amount:
        (inner['amount'] as number | undefined) ?? (rawPayload['amount'] as number | undefined),
    };

    const resolvedClinicId =
      payload.clinicId || payload.appointment?.clinicId || (await this.resolveClinicId(payload));

    if (!resolvedClinicId) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.WARN,
        'Skipping payment.completed event because clinicId could not be resolved',
        'BillingEventsListener',
        {
          paymentId: payload.paymentId,
          appointmentId: payload.appointmentId,
        }
      );
      return;
    }

    await this.loggingService.log(
      LogType.PAYMENT,
      LogLevel.INFO,
      `Handling payment.completed event for payment ${payload.paymentId}`,
      'BillingEventsListener',
      {
        paymentId: payload.paymentId,
        appointmentId: payload.appointmentId,
        clinicId: resolvedClinicId,
      }
    );

    try {
      // Only process if payment is for an appointment and status is completed
      if (payload.appointmentId && payload.status === 'completed') {
        const appointmentId = payload.appointmentId;
        const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);

        await this.loggingService.log(
          LogType.APPOINTMENT,
          LogLevel.INFO,
          'Evaluating appointment status transition after payment completion',
          'BillingEventsListener',
          {
            appointmentId,
            paymentId: payload.paymentId,
            clinicId: resolvedClinicId,
            appointmentType: appointment ? String(appointment.type) : 'NOT_FOUND',
            currentStatus: appointment ? String(appointment.status) : 'NOT_FOUND',
          }
        );

        if (appointment) {
          // A payment that lands after the booking was released (hold expired, cancelled, already
          // done) must not revive the appointment: its slot may have been given to someone else.
          // handlePaymentCallback already refuses to confirm an expired hold; this is the same
          // rule for the listener. The booking stays released and no payout is prepared.
          const priorStatus = String(appointment.status || '').toUpperCase();
          if (SETTLED_APPOINTMENT_STATUSES.has(priorStatus)) {
            await this.flagLateSettlement({
              appointmentId,
              paymentId: payload.paymentId,
              clinicId: resolvedClinicId,
              amount: payload.amount,
              appointmentStatus: priorStatus,
            });
            return;
          }

          await this.loggingService.log(
            LogType.APPOINTMENT,
            LogLevel.INFO,
            'Updating appointment status after payment completion',
            'BillingEventsListener',
            {
              appointmentId,
              paymentId: payload.paymentId,
              clinicId: resolvedClinicId,
              previousStatus: String(appointment.status),
              nextStatus: String(AppointmentStatus.CONFIRMED),
              appointmentType: String(appointment.type),
            }
          );

          const firstWriteApplied = await this.applyPaidStatusTransition(
            appointment,
            resolvedClinicId,
            payload.paymentId
          );
          if (!firstWriteApplied) {
            // The conditional write matched nothing: the row changed after the read above (for
            // example the scheduler expired the hold in between). Re-check before going on.
            const latestStatus = await this.readAppointmentStatus(
              appointmentId,
              appointment.clinicId
            );
            if (latestStatus && SETTLED_APPOINTMENT_STATUSES.has(latestStatus)) {
              await this.flagLateSettlement({
                appointmentId,
                paymentId: payload.paymentId,
                clinicId: resolvedClinicId,
                amount: payload.amount,
                appointmentStatus: latestStatus,
              });
              return;
            }
          }

          // The appointment was really settled by this payment (it was not released), so the
          // payout can be prepared now - never for a late settlement, which returned above:
          // a visit that never takes place must not get a PAYOUT_PENDING record.
          await this.billingService.preparePayoutForAppointmentPayment(
            payload.paymentId,
            resolvedClinicId
          );

          // After settling the appointment to SCHEDULED, immediately
          // confirm it. VIDEO_CALL appointments that just paid are
          // doctor-confirmed by virtue of payment (per product spec);
          // they don't need a separate receptionist confirmation step.
          // Re-read so we always work with fresh data.
          const settledAppointment =
            (await this.databaseService.findAppointmentByIdSafe(appointmentId)) || appointment;
          if (
            settledAppointment &&
            String(settledAppointment.status).toUpperCase() === String(AppointmentStatus.SCHEDULED)
          ) {
            await this.confirmScheduledAppointment(
              settledAppointment,
              resolvedClinicId,
              payload.paymentId
            );
          }

          const refreshedAppointment =
            await this.databaseService.findAppointmentByIdSafe(appointmentId);

          await this.billingService.syncAppointmentAfterPayment({
            appointmentId,
            clinicId: resolvedClinicId,
            paymentId: payload.paymentId,
            paymentStatus: payload.status,
            appointment: refreshedAppointment ?? appointment,
            emitAppointmentUpdated: true,
          });

          const confirmedAppointment = refreshedAppointment ?? appointment;
          const confirmedAppointmentRecord = confirmedAppointment as unknown as Record<
            string,
            unknown
          >;
          const patientRelation = confirmedAppointment.patient as
            | { user?: { name?: string; firstName?: string; lastName?: string; phone?: string } }
            | undefined;
          const doctorRelation = confirmedAppointment.doctor as
            | { user?: { name?: string; firstName?: string; lastName?: string; phone?: string } }
            | undefined;
          const locationRelation = confirmedAppointment.location as { name?: string } | undefined;
          const appointmentType = resolveRecordValue(
            confirmedAppointmentRecord['type'] ??
              confirmedAppointmentRecord['appointmentType'] ??
              appointment.type,
            'IN_PERSON'
          );
          const patientUser = patientRelation?.user;
          const doctorUser = doctorRelation?.user;
          const patientName =
            patientUser?.name ||
            [patientUser?.firstName, patientUser?.lastName].filter(Boolean).join(' ') ||
            (confirmedAppointment as { patientName?: string }).patientName ||
            'Patient';
          const doctorName =
            doctorUser?.name ||
            [doctorUser?.firstName, doctorUser?.lastName].filter(Boolean).join(' ') ||
            (confirmedAppointment as { doctorName?: string }).doctorName ||
            'Doctor';
          const clinicName =
            confirmedAppointment.clinic?.name || appointment.clinic?.name || 'Healthcare Clinic';
          const locationName = locationRelation?.name || appointment.location?.name || clinicName;
          const patientPhone =
            patientUser?.phone ||
            resolveRecordValue(confirmedAppointmentRecord['patientPhone']) ||
            resolveRecordValue(confirmedAppointmentRecord['phone']) ||
            'N/A';
          const paymentRelation = confirmedAppointmentRecord['payment'] as
            | {
                amount?: number;
                transactionId?: string | null;
              }
            | undefined;
          const phonePePaymentId =
            paymentRelation?.transactionId ||
            resolveRecordValue(confirmedAppointmentRecord['paymentTransactionId']) ||
            payload.paymentId;
          const paymentAmount =
            paymentRelation?.amount ??
            (typeof confirmedAppointmentRecord['paymentAmount'] === 'number'
              ? confirmedAppointmentRecord['paymentAmount']
              : (payload.amount ?? 0));
          const appointmentLink = buildAppointmentDetailsUrl(appointmentId, appointmentType);
          const appointmentDate = resolveRecordValue(
            confirmedAppointmentRecord['date'] ??
              confirmedAppointmentRecord['appointmentDate'] ??
              appointment.date
          );
          const appointmentTime = resolveRecordValue(
            confirmedAppointmentRecord['time'] ??
              confirmedAppointmentRecord['appointmentTime'] ??
              appointment.time
          );
          await this.eventService.emit('appointment.confirmed', {
            appointmentId,
            clinicId: resolvedClinicId,
            doctorId: confirmedAppointment.doctorId,
            patientId: confirmedAppointment.patientId,
            status: AppointmentStatus.CONFIRMED,
            paymentId: payload.paymentId,
            paymentStatus: payload.status,
            appointment: confirmedAppointment,
            appointmentType,
            patientName,
            doctorName,
            clinicName,
            location: locationName,
            appointmentDate,
            appointmentTime,
            context: {
              source: 'BillingEventsListener',
              paymentId: payload.paymentId,
            },
          });

          await this.loggingService.log(
            LogType.APPOINTMENT,
            LogLevel.INFO,
            'Appointment confirmed after payment completion',
            'BillingEventsListener',
            {
              appointmentId: payload.appointmentId,
              paymentId: payload.paymentId,
              clinicId: resolvedClinicId,
              previousStatus: String(appointment.status),
              nextStatus: String(AppointmentStatus.CONFIRMED),
              appointmentType: String(appointment.type),
            }
          );

          // Send admin notification email with appointment + payment details
          await this.notifyAdminPaymentReceived({
            patientName,
            doctorName,
            clinicName,
            appointmentType,
            appointmentDate,
            appointmentTime,
            locationName,
            paymentId: payload.paymentId,
            phonePePaymentId,
            amount: paymentAmount,
            phoneNumber: patientPhone,
            appointmentLink,
            appointmentId,
            clinicId: resolvedClinicId,
          });

          return;
        }

        await this.loggingService.log(
          LogType.APPOINTMENT,
          LogLevel.WARN,
          'Payment completed event received but appointment was not found for status transition',
          'BillingEventsListener',
          {
            appointmentId,
            paymentId: payload.paymentId,
            clinicId: resolvedClinicId,
          }
        );
      }
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to confirm appointment after payment: ${error instanceof Error ? error.message : String(error)}`,
        'BillingEventsListener',
        {
          appointmentId: payload.appointmentId,
          paymentId: payload.paymentId,
          clinicId: resolvedClinicId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }

  /**
   * Release the payment hold on the appointment and, while it is still in the booking flow, move
   * it one step forward (PENDING → SCHEDULED, otherwise → CONFIRMED).
   *
   * The write is conditional on the status: a row that has meanwhile left the booking flow
   * matches nothing and is left alone. Returns whether a row was written.
   */
  private async applyPaidStatusTransition(
    appointment: AppointmentWithRelations,
    clinicId: string,
    paymentId: string
  ): Promise<boolean> {
    // VIDEO_CALL appointments start in PENDING with a payment window. Now that payment has
    // succeeded, transition them through SCHEDULED → CONFIRMED in two steps so the UI can tell
    // apart "payment received, awaiting doctor confirmation" from "fully confirmed by the
    // clinic". We also clear `paymentExpiresAt` so the auto-cancel scheduler ignores this row
    // going forward.
    //
    // IN_PERSON appointments skip PENDING (they use the clinic's subscription model), so for
    // them we go straight to CONFIRMED exactly like the legacy flow did.
    const currentStatus = String(appointment.status || '').toUpperCase();
    const isPendingPaymentState =
      currentStatus === String(AppointmentStatus.PENDING) ||
      currentStatus === 'PENDING_PAYMENT' ||
      currentStatus === 'AWAITING_PAYMENT';
    const nextStatus = isPendingPaymentState
      ? AppointmentStatus.SCHEDULED
      : AppointmentStatus.CONFIRMED;

    // Only a row still in the booking flow advances. An already CONFIRMED (or in-progress) row
    // keeps its status and only has its payment hold released: re-sending CONFIRMED made the
    // Prisma middleware re-stamp `confirmationExpiresAt = now + window` over the expiry
    // handlePaymentCallback computed from the visit's own start, so a video visit paid today for
    // tomorrow expired tonight.
    const canAdvance =
      isPendingPaymentState || PAYABLE_APPOINTMENT_STATUSES.some(s => String(s) === currentStatus);

    const data: {
      paymentExpiresAt: null;
      status?: string;
      confirmationExpiresAt?: Date;
    } = { paymentExpiresAt: null };
    if (canAdvance) {
      data.status = nextStatus;
      if (nextStatus === AppointmentStatus.CONFIRMED) {
        // Explicit expiry, for the middleware reason above.
        data.confirmationExpiresAt = resolvePaidConfirmationExpiresAt(appointment);
      }
    }
    const status = canAdvance
      ? { in: [...PAYABLE_APPOINTMENT_STATUSES] }
      : { notIn: [...SETTLED_APPOINTMENT_STATUSES] };

    const result = await this.databaseService.executeHealthcareWrite(
      async client => {
        const appointmentDelegate = (
          client as unknown as {
            appointment: {
              updateMany: (args: {
                where: {
                  id: string;
                  clinicId: string;
                  status: { in: string[] } | { notIn: string[] };
                };
                data: {
                  paymentExpiresAt: null;
                  status?: string;
                  confirmationExpiresAt?: Date;
                };
              }) => Promise<{ count: number }>;
            };
          }
        ).appointment;

        return await appointmentDelegate.updateMany({
          where: { id: appointment.id, clinicId: appointment.clinicId, status },
          data,
        });
      },
      {
        userId: 'system',
        clinicId,
        resourceType: 'APPOINTMENT',
        operation: 'UPDATE',
        resourceId: appointment.id,
        userRole: 'system',
        details: {
          reason: 'Payment completed',
          paymentId,
          transition: canAdvance ? `${currentStatus}→${nextStatus}` : 'payment hold released',
        },
      }
    );
    return result.count > 0;
  }

  /**
   * SCHEDULED → CONFIRMED right after a payment settled the appointment. Conditional on the row
   * still being SCHEDULED, so it can never overwrite a status that moved on in the meantime.
   */
  private async confirmScheduledAppointment(
    appointment: AppointmentWithRelations,
    clinicId: string,
    paymentId: string
  ): Promise<void> {
    await this.databaseService.executeHealthcareWrite(
      async client => {
        const appointmentDelegate = (
          client as unknown as {
            appointment: {
              updateMany: (args: {
                where: { id: string; clinicId: string; status: string };
                data: { status: string; confirmationExpiresAt: Date | null };
              }) => Promise<{ count: number }>;
            };
          }
        ).appointment;
        return await appointmentDelegate.updateMany({
          where: {
            id: appointment.id,
            clinicId: appointment.clinicId,
            status: AppointmentStatus.SCHEDULED,
          },
          data: {
            status: AppointmentStatus.CONFIRMED,
            // Explicit: without this, the Prisma middleware's
            // `Date.now() + window` fallback stamps the expiry
            // relative to confirmation time rather than the
            // appointment's own scheduled start — for advance
            // bookings (paid hours/days before the visit) that
            // produces an expiry already in the past, so the
            // scheduler auto-expires a valid, paid appointment
            // the moment it's picked up as a candidate.
            confirmationExpiresAt: resolvePaidConfirmationExpiresAt(appointment),
          },
        });
      },
      {
        userId: 'system',
        clinicId,
        resourceType: 'APPOINTMENT',
        operation: 'UPDATE',
        resourceId: appointment.id,
        userRole: 'system',
        details: {
          reason: 'Auto-confirm after payment',
          paymentId,
          transition: 'SCHEDULED→CONFIRMED',
        },
      }
    );
  }

  private async readAppointmentStatus(
    appointmentId: string,
    clinicId: string
  ): Promise<string | null> {
    const row = await this.databaseService.executeHealthcareRead<{ status: unknown } | null>(
      async client =>
        (
          client as unknown as {
            appointment: {
              findFirst: (args: {
                where: { id: string; clinicId: string };
                select: { status: true };
              }) => Promise<{ status: unknown } | null>;
            };
          }
        ).appointment.findFirst({
          where: { id: appointmentId, clinicId },
          select: { status: true },
        })
    );
    return row ? String(row.status).toUpperCase() : null;
  }

  /**
   * A COMPLETED payment arrived for an appointment that is already EXPIRED, CANCELLED, COMPLETED
   * or NO_SHOW. The appointment is deliberately left as it is (its slot may have been released
   * and rebooked) and no payout is prepared. There are no refunds for visits that never take
   * place, so this only logs and emits the event (admin-visible); it never refunds, never
   * persists a refund flag and never throws.
   */
  private async flagLateSettlement(details: {
    appointmentId: string;
    paymentId: string;
    clinicId: string;
    amount?: number | undefined;
    appointmentStatus: string;
  }): Promise<void> {
    try {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.WARN,
        `Completed payment received for an appointment that is already ${details.appointmentStatus}; appointment left unchanged and no payout prepared`,
        'BillingEventsListener',
        {
          appointmentId: details.appointmentId,
          paymentId: details.paymentId,
          clinicId: details.clinicId,
          appointmentStatus: details.appointmentStatus,
          amount: details.amount,
        }
      );
      await this.eventService.emit('billing.payment.late_settlement', {
        clinicId: details.clinicId,
        paymentId: details.paymentId,
        appointmentId: details.appointmentId,
        appointmentStatus: details.appointmentStatus,
        ...(details.amount !== undefined ? { amount: details.amount } : {}),
        reason: `Completed payment received for an appointment that was already ${details.appointmentStatus}`,
      });
    } catch (error) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.WARN,
        `Failed to flag late settlement: ${error instanceof Error ? error.message : String(error)}`,
        'BillingEventsListener',
        { appointmentId: details.appointmentId, paymentId: details.paymentId }
      );
    }
  }

  private async resolveClinicId(payload: {
    appointmentId?: string | undefined;
    appointment?: { clinicId?: string | undefined } | undefined;
    clinicId?: string | undefined;
  }): Promise<string | null> {
    if (payload.appointment?.clinicId) {
      return payload.appointment.clinicId;
    }
    if (payload.clinicId) {
      return payload.clinicId;
    }
    if (!payload.appointmentId) {
      return null;
    }
    const appointment = await this.databaseService.findAppointmentByIdSafe(payload.appointmentId);
    return appointment?.clinicId ?? null;
  }

  private async notifyAdminPaymentReceived(details: {
    patientName: string;
    doctorName: string;
    clinicName: string;
    appointmentType: string;
    appointmentDate: string;
    appointmentTime: string;
    locationName: string;
    paymentId: string;
    phonePePaymentId?: string;
    amount?: number;
    phoneNumber?: string;
    appointmentLink?: string;
    appointmentId: string;
    clinicId: string;
  }): Promise<void> {
    try {
      const subject = `Payment Received — ${details.patientName} / ${details.clinicName}`;
      const formattedAmount = formatCurrencyFromMinorUnits(details.amount ?? 0);
      const body = `
        <h2>New Payment Received</h2>
        <p>A patient payment has been confirmed. Details below:</p>
        <table style="border-collapse: collapse; width: 100%; max-width: 600px;">
          <tr style="background: #f5f5f5;"><td style="padding: 8px 12px; font-weight: bold;">Patient</td><td style="padding: 8px 12px;">${details.patientName}</td></tr>
          <tr><td style="padding: 8px 12px; font-weight: bold;">Doctor</td><td style="padding: 8px 12px;">${details.doctorName}</td></tr>
          <tr style="background: #f5f5f5;"><td style="padding: 8px 12px; font-weight: bold;">Clinic</td><td style="padding: 8px 12px;">${details.clinicName}</td></tr>
          <tr><td style="padding: 8px 12px; font-weight: bold;">Phone No.</td><td style="padding: 8px 12px;">${details.phoneNumber || 'N/A'}</td></tr>
          <tr><td style="padding: 8px 12px; font-weight: bold;">Appointment Type</td><td style="padding: 8px 12px;">${details.appointmentType}</td></tr>
          <tr style="background: #f5f5f5;"><td style="padding: 8px 12px; font-weight: bold;">Date</td><td style="padding: 8px 12px;">${details.appointmentDate}</td></tr>
          <tr><td style="padding: 8px 12px; font-weight: bold;">Time</td><td style="padding: 8px 12px;">${details.appointmentTime}</td></tr>
          <tr style="background: #f5f5f5;"><td style="padding: 8px 12px; font-weight: bold;">Location</td><td style="padding: 8px 12px;">${details.locationName}</td></tr>
          <tr><td style="padding: 8px 12px; font-weight: bold;">Amount</td><td style="padding: 8px 12px;">${formattedAmount}</td></tr>
          <tr><td style="padding: 8px 12px; font-weight: bold;">Payment ID</td><td style="padding: 8px 12px;">${details.paymentId}</td></tr>
          <tr style="background: #f5f5f5;"><td style="padding: 8px 12px; font-weight: bold;">PhonePe Payment ID</td><td style="padding: 8px 12px;">${details.phonePePaymentId || details.paymentId}</td></tr>
          <tr><td style="padding: 8px 12px; font-weight: bold;">Appointment Link</td><td style="padding: 8px 12px;"><a href="${details.appointmentLink || '#'}" target="_blank" rel="noreferrer noopener">${details.appointmentLink || 'Open appointment'}</a></td></tr>
          <tr style="background: #f5f5f5;"><td style="padding: 8px 12px; font-weight: bold;">Appointment ID</td><td style="padding: 8px 12px;">${details.appointmentId}</td></tr>
        </table>
      `;

      const result = await this.emailService.sendSimpleEmail(
        {
          to: ADMIN_NOTIFICATION_EMAIL,
          subject,
          body,
          isHtml: true,
        },
        details.clinicId
      );

      if (result.success) {
        void this.loggingService.log(
          LogType.EMAIL,
          LogLevel.INFO,
          'Admin payment notification email sent',
          'BillingEventsListener',
          {
            to: ADMIN_NOTIFICATION_EMAIL,
            paymentId: details.paymentId,
            phonePePaymentId: details.phonePePaymentId,
            amount: details.amount,
            phoneNumber: details.phoneNumber,
            appointmentLink: details.appointmentLink,
            appointmentId: details.appointmentId,
            clinicId: details.clinicId,
          }
        );
      } else {
        void this.loggingService.log(
          LogType.EMAIL,
          LogLevel.WARN,
          `Admin payment notification email failed: ${result.error ?? 'unknown'}`,
          'BillingEventsListener',
          {
            to: ADMIN_NOTIFICATION_EMAIL,
            paymentId: details.paymentId,
            phonePePaymentId: details.phonePePaymentId,
            amount: details.amount,
            phoneNumber: details.phoneNumber,
            appointmentLink: details.appointmentLink,
            error: result.error,
          }
        );
      }
    } catch (error) {
      void this.loggingService.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        `Failed to send admin payment notification email: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'BillingEventsListener',
        {
          paymentId: details.paymentId,
          phonePePaymentId: details.phonePePaymentId,
          amount: details.amount,
          phoneNumber: details.phoneNumber,
          appointmentLink: details.appointmentLink,
          appointmentId: details.appointmentId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }

  /**
   * EventService wraps every emit in an envelope (`{ eventId, clinicId?, payload: <data> }`), so
   * the ids sit in `payload.payload` (and `clinicId` is top level for enterprise emits only). The
   * flat shape is still accepted. Marking a payout ready is idempotent (a payout that is already
   * READY or SUCCESS is left alone), so a repeated event - both completion routes firing, or the
   * enterprise and plain emits - is harmless.
   */
  @OnEvent('appointment.completed')
  async handleAppointmentCompleted(payload: {
    appointmentId?: string;
    clinicId?: string;
    payload?: { appointmentId?: string; clinicId?: string };
  }) {
    const appointmentId = payload?.appointmentId ?? payload?.payload?.appointmentId;
    const clinicId = payload?.clinicId ?? payload?.payload?.clinicId;
    try {
      if (!appointmentId || !clinicId) {
        return;
      }
      await this.billingService.markPayoutReadyForCompletedAppointment(appointmentId, clinicId);
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to mark payout ready after appointment completion: ${error instanceof Error ? error.message : String(error)}`,
        'BillingEventsListener',
        {
          appointmentId,
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }

  /**
   * An appointment moving to EXPIRED (payment window lapsed, video slot never
   * confirmed, or a stale video call auto-closed) never touches its Payment
   * record on its own — without this, a Payment left PENDING stays PENDING
   * forever since nothing else can pay for an appointment that no longer exists.
   */
  @OnEvent('appointment.updated')
  async handleAppointmentUpdatedForBilling(payload: {
    status?: string;
    appointmentId?: string;
    payload?: { status?: string; appointmentId?: string };
  }) {
    const status = payload?.status ?? payload?.payload?.status;
    if (status !== AppointmentStatus.EXPIRED) {
      return;
    }

    const appointmentId = payload?.appointmentId ?? payload?.payload?.appointmentId;
    if (!appointmentId) {
      return;
    }

    await this.expirePendingPaymentsForAppointment(appointmentId, PaymentStatus.EXPIRED);
  }

  /**
   * Mirror of the above for explicit cancellations. triggerAppointmentRefund
   * only refunds payments already COMPLETED — a payment still PENDING on a
   * cancelled appointment was never charged, so it needs its own transition
   * to CANCELLED instead of being left PENDING.
   */
  @OnEvent('appointment.cancelled')
  async handleAppointmentCancelledForBilling(payload: {
    appointmentId?: string;
    payload?: { appointmentId?: string };
  }) {
    const appointmentId = payload?.appointmentId ?? payload?.payload?.appointmentId;
    if (!appointmentId) {
      return;
    }

    await this.expirePendingPaymentsForAppointment(appointmentId, PaymentStatus.CANCELLED);
    await this.voidPendingInvoicesForAppointment(appointmentId);
  }

  @OnEvent('appointment.expired')
  async handleAppointmentExpiredForBilling(payload: {
    appointmentId?: string;
    payload?: { appointmentId?: string };
  }) {
    const appointmentId = payload?.appointmentId ?? payload?.payload?.appointmentId;
    if (!appointmentId) {
      return;
    }

    // Expire PENDING payments — user didn't complete payment in time
    await this.expirePendingPaymentsForAppointment(appointmentId, PaymentStatus.EXPIRED);
    // VOID PENDING invoices — appointment expired, invoice is no longer valid
    await this.voidPendingInvoicesForAppointment(appointmentId);
  }

  private async voidPendingInvoicesForAppointment(appointmentId: string): Promise<void> {
    try {
      // Find PENDING invoices linked to this appointment via metadata
      const draftInvoices = await this.databaseService.executeHealthcareRead<Array<{ id: string }>>(
        async client => {
          return (
            client as unknown as {
              invoice: {
                findMany: (args: {
                  where: {
                    status: string;
                    metadata: { path: string[]; equals: string };
                  };
                  select: { id: true };
                }) => Promise<Array<{ id: string }>>;
              };
            }
          ).invoice.findMany({
            where: {
              status: 'PENDING',
              metadata: { path: ['appointmentId'], equals: appointmentId },
            },
            select: { id: true },
          });
        }
      );

      for (const invoice of draftInvoices) {
        try {
          await this.billingService.updateInvoice(invoice.id, { status: 'VOID' } as never);
        } catch (error) {
          await this.loggingService.log(
            LogType.ERROR,
            LogLevel.ERROR,
            `Failed to void invoice ${invoice.id} for expired appointment ${appointmentId}: ${error instanceof Error ? error.message : String(error)}`,
            'BillingEventsListener',
            {
              appointmentId,
              invoiceId: invoice.id,
              error: error instanceof Error ? error.stack : undefined,
            }
          );
        }
      }
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to find draft invoices for appointment ${appointmentId}: ${error instanceof Error ? error.message : String(error)}`,
        'BillingEventsListener',
        { appointmentId, error: error instanceof Error ? error.stack : undefined }
      );
    }
  }

  private async expirePendingPaymentsForAppointment(
    appointmentId: string,
    terminalStatus: PaymentStatus.EXPIRED | PaymentStatus.CANCELLED
  ): Promise<void> {
    try {
      const pendingPayments = await this.databaseService.findPaymentsSafe({
        appointmentId,
        status: PaymentStatus.PENDING,
      });

      for (const payment of pendingPayments) {
        try {
          await this.billingService.updatePayment(payment.id, { status: terminalStatus });
        } catch (error) {
          await this.loggingService.log(
            LogType.ERROR,
            LogLevel.ERROR,
            `Failed to move pending payment ${payment.id} to ${terminalStatus}: ${error instanceof Error ? error.message : String(error)}`,
            'BillingEventsListener',
            {
              appointmentId,
              paymentId: payment.id,
              terminalStatus,
              error: error instanceof Error ? error.stack : undefined,
            }
          );
        }
      }
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to look up pending payments for appointment ${appointmentId}: ${error instanceof Error ? error.message : String(error)}`,
        'BillingEventsListener',
        { appointmentId, terminalStatus, error: error instanceof Error ? error.stack : undefined }
      );
    }
  }
}
