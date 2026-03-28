import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BillingService } from './billing.service';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel, AppointmentStatus } from '@core/types';

/**
 * Billing event listeners for automatic invoice generation and delivery
 */
@Injectable()
export class BillingEventsListener {
  constructor(
    private readonly billingService: BillingService,
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService
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
      // Send subscription confirmation and invoice via WhatsApp
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
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Empty invoiceId in billing.invoice.created event',
          'BillingEventsListener',
          { payload }
        );
        return;
      }

      // Generate PDF for the invoice
      await this.billingService.generateInvoicePDF(invoiceId);

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Processed invoice creation event',
        'BillingEventsListener',
        { invoiceId }
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
   * Auto-send invoice via WhatsApp when payment is completed
   */
  @OnEvent('billing.payment.updated')
  async handlePaymentUpdated(payload: { paymentId: string }) {
    await this.loggingService.log(
      LogType.PAYMENT,
      LogLevel.INFO,
      `Handling payment.updated event for payment ${payload.paymentId}`,
      'BillingEventsListener',
      { paymentId: payload.paymentId }
    );

    try {
      // Get payment details to check if it's completed and has an invoice
      const payment = await this.billingService.getPayment(payload.paymentId);

      // Type-safe check for payment status and invoiceId
      if (
        'status' in payment &&
        payment.status === 'COMPLETED' &&
        'invoiceId' in payment &&
        payment.invoiceId
      ) {
        // Send invoice via WhatsApp
        await this.billingService.sendInvoiceViaWhatsApp(payment.invoiceId);

        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.INFO,
          `Invoice sent via WhatsApp for payment ${payload.paymentId}`,
          'BillingEventsListener',
          { paymentId: payload.paymentId, invoiceId: payment.invoiceId }
        );
      }
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to send invoice via WhatsApp: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'BillingEventsListener',
        {
          paymentId: payload.paymentId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }

  /**
   * Auto-send invoice via WhatsApp when invoice is marked as paid
   */
  @OnEvent('billing.invoice.paid')
  async handleInvoicePaid(payload: { invoiceId: string }) {
    await this.loggingService.log(
      LogType.PAYMENT,
      LogLevel.INFO,
      `Handling invoice.paid event for invoice ${payload.invoiceId}`,
      'BillingEventsListener',
      { invoiceId: payload.invoiceId }
    );

    try {
      // Send invoice via WhatsApp
      await this.billingService.sendInvoiceViaWhatsApp(payload.invoiceId);

      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        `Invoice sent via WhatsApp for ${payload.invoiceId}`,
        'BillingEventsListener',
        { invoiceId: payload.invoiceId }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to send invoice via WhatsApp: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'BillingEventsListener',
        {
          invoiceId: payload.invoiceId,
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
  async handlePaymentCompleted(payload: {
    appointmentId?: string;
    paymentId: string;
    status: string;
    clinicId: string;
  }) {
    await this.loggingService.log(
      LogType.PAYMENT,
      LogLevel.INFO,
      `Handling payment.completed event for payment ${payload.paymentId}`,
      'BillingEventsListener',
      {
        paymentId: payload.paymentId,
        appointmentId: payload.appointmentId,
        clinicId: payload.clinicId,
      }
    );

    try {
      // Only process if payment is for an appointment and status is completed
      if (payload.appointmentId && payload.status === 'completed' && payload.clinicId) {
        await this.billingService.preparePayoutForAppointmentPayment(
          payload.paymentId,
          payload.clinicId
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
            clinicId: payload.clinicId,
            appointmentType: appointment ? String(appointment.type) : 'NOT_FOUND',
            currentStatus: appointment ? String(appointment.status) : 'NOT_FOUND',
          }
        );

        if (appointment) {
          const isVideoCall = String(appointment.type) === 'VIDEO_CALL';
          const isAwaitingSlot = String(appointment.status) === 'AWAITING_SLOT_CONFIRMATION';

          // VIDEO_CALL in AWAITING_SLOT_CONFIRMATION: keep status unchanged - payment recorded,
          // doctor must confirm slot (appointments.service.confirmVideoSlot)
          if (isVideoCall && isAwaitingSlot) {
            await this.loggingService.log(
              LogType.APPOINTMENT,
              LogLevel.INFO,
              'Video appointment payment completed; awaiting doctor slot confirmation',
              'BillingEventsListener',
              {
                appointmentId,
                paymentId: payload.paymentId,
                clinicId: payload.clinicId,
              }
            );
            return;
          }
        }

        if (!appointment) {
          await this.loggingService.log(
            LogType.APPOINTMENT,
            LogLevel.WARN,
            'Payment completed event received but appointment was not found for status transition',
            'BillingEventsListener',
            {
              appointmentId,
              paymentId: payload.paymentId,
              clinicId: payload.clinicId,
            }
          );
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
            clinicId: payload.clinicId,
            previousStatus: String(appointment.status),
            nextStatus: String(AppointmentStatus.CONFIRMED),
            appointmentType: String(appointment.type),
          }
        );

        // For non-video or non-awaiting-slot: update appointment status to CONFIRMED
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
            clinicId: payload.clinicId,
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

        await this.loggingService.log(
          LogType.APPOINTMENT,
          LogLevel.INFO,
          'Appointment confirmed after payment completion',
          'BillingEventsListener',
          {
            appointmentId: payload.appointmentId,
            paymentId: payload.paymentId,
            clinicId: payload.clinicId,
            previousStatus: String(appointment.status),
            nextStatus: String(AppointmentStatus.CONFIRMED),
            appointmentType: String(appointment.type),
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
          clinicId: payload.clinicId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
    }
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
