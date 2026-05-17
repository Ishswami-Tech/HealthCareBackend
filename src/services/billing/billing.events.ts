import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BillingService } from './billing.service';
import { DatabaseService } from '@infrastructure/database';
import { EventService } from '@infrastructure/events/event.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel, AppointmentStatus } from '@core/types';

function resolveRecordValue(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return fallback;
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
    private readonly eventService: EventService
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
    payload?: { receiptId?: string; invoice?: { id?: string } };
  }) {
    const receiptId = payload?.receiptId ?? payload?.payload?.receiptId;
    const invoiceSnapshot = payload?.invoice ?? payload?.payload?.invoice;

    if (!receiptId) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.WARN,
        'Skipping receipt.paid event with missing receiptId',
        'BillingEventsListener'
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
        | { clinicId?: string; patientId?: string; doctorId?: string }
        | undefined,
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
        await this.billingService.preparePayoutForAppointmentPayment(
          payload.paymentId,
          resolvedClinicId
        );

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

          await this.databaseService.executeHealthcareWrite(
            async client => {
              const appointmentClient = client as unknown as {
                appointment: {
                  update: (args: {
                    where: { id: string };
                    data: { status: string };
                  }) => Promise<unknown>;
                };
              };
              return await appointmentClient.appointment.update({
                where: { id: appointmentId },
                data: {
                  status: AppointmentStatus.CONFIRMED,
                },
              });
            },
            {
              userId: 'system',
              clinicId: resolvedClinicId,
              resourceType: 'APPOINTMENT',
              operation: 'UPDATE',
              resourceId: appointmentId,
              userRole: 'system',
              details: {
                reason: 'Payment completed',
                paymentId: payload.paymentId,
              },
            }
          );

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
            | { user?: { name?: string; firstName?: string; lastName?: string } }
            | undefined;
          const doctorRelation = confirmedAppointment.doctor as
            | { user?: { name?: string; firstName?: string; lastName?: string } }
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

  @OnEvent('appointment.completed')
  async handleAppointmentCompleted(payload: { appointmentId: string; clinicId: string }) {
    try {
      if (!payload?.appointmentId || !payload?.clinicId) {
        return;
      }
      await this.billingService.markPayoutReadyForCompletedAppointment(
        payload.appointmentId,
        payload.clinicId
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to mark payout ready after appointment completion: ${error instanceof Error ? error.message : String(error)}`,
        'BillingEventsListener',
        {
          appointmentId: payload?.appointmentId,
          clinicId: payload?.clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }
}
