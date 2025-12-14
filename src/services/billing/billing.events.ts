import { Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(BillingEventsListener.name);

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
    this.logger.log(
      `Handling subscription.created event for subscription ${payload.subscriptionId}`
    );

    try {
      // Send subscription confirmation and invoice via WhatsApp
      await this.billingService.sendSubscriptionConfirmation(payload.subscriptionId);

      this.logger.log(`Subscription confirmation sent successfully for ${payload.subscriptionId}`);
    } catch (error) {
      this.logger.error(
        `Failed to send subscription confirmation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined
      );
    }
  }

  /**
   * Auto-generate PDF when invoice is created
   */
  @OnEvent('billing.invoice.created')
  async handleInvoiceCreated(payload: { invoiceId: string }) {
    this.logger.log(`Handling invoice.created event for invoice ${payload.invoiceId}`);

    try {
      // Generate PDF for the invoice
      await this.billingService.generateInvoicePDF(payload.invoiceId);

      this.logger.log(`Invoice PDF generated successfully for ${payload.invoiceId}`);
    } catch (error) {
      this.logger.error(
        `Failed to generate invoice PDF: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined
      );
    }
  }

  /**
   * Auto-send invoice via WhatsApp when payment is completed
   */
  @OnEvent('billing.payment.updated')
  async handlePaymentUpdated(payload: { paymentId: string }) {
    this.logger.log(`Handling payment.updated event for payment ${payload.paymentId}`);

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

        this.logger.log(`Invoice sent via WhatsApp for payment ${payload.paymentId}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to send invoice via WhatsApp: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined
      );
    }
  }

  /**
   * Auto-send invoice via WhatsApp when invoice is marked as paid
   */
  @OnEvent('billing.invoice.paid')
  async handleInvoicePaid(payload: { invoiceId: string }) {
    this.logger.log(`Handling invoice.paid event for invoice ${payload.invoiceId}`);

    try {
      // Send invoice via WhatsApp
      await this.billingService.sendInvoiceViaWhatsApp(payload.invoiceId);

      this.logger.log(`Invoice sent via WhatsApp for ${payload.invoiceId}`);
    } catch (error) {
      this.logger.error(
        `Failed to send invoice via WhatsApp: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined
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
    this.logger.log(`Handling payment.completed event for payment ${payload.paymentId}`);

    try {
      // Only process if payment is for an appointment and status is completed
      if (payload.appointmentId && payload.status === 'completed' && payload.clinicId) {
        const appointmentId = payload.appointmentId;
        // Update appointment status to CONFIRMED after successful payment
        await this.databaseService.executeHealthcareWrite(
          async client => {
            return await client.appointment.update({
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
          }
        );

        this.logger.log(
          `Appointment ${payload.appointmentId} confirmed after payment ${payload.paymentId}`
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to confirm appointment after payment: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error.stack : undefined
      );

      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to confirm appointment after payment: ${error instanceof Error ? error.message : String(error)}`,
        'BillingEventsListener',
        {
          appointmentId: payload.appointmentId,
          paymentId: payload.paymentId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }
}
