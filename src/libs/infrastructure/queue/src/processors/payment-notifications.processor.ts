// NOTE: This processor is not currently registered in QueueModule
// BullMQ processors in NestJS use @Processor() and @Process() decorators
// However, @nestjs/bullmq doesn't export Process decorator in all versions
// This file is kept for reference but is not actively used
// To use processors, register them in QueueModule and ensure decorators are available

// import { Processor, Process } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

// Internal imports - Infrastructure
import { LoggingService } from '@infrastructure/logging';

// Internal imports - Types
import type { PaymentData } from '@core/types';

// Internal imports - Core
import { LogType, LogLevel } from '@core/types';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';

// @Processor('payment-notifications')
export class PaymentNotificationsProcessor {
  constructor(private readonly loggingService: LoggingService) {}

  // @Process('payment-notification')
  handlePaymentNotification(
    job: Job<{
      payment: PaymentData;
      status: string;
      timestamp: Date;
    }>
  ) {
    const { payment, status } = job.data;

    try {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Sending payment notification: ${payment.id} - ${status}`,
        'PaymentNotificationsProcessor'
      );

      // Notification processing logic will integrate with existing communication service
      this.processPaymentNotification(payment, status);

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Payment notification sent successfully: ${payment.id}`,
        'PaymentNotificationsProcessor'
      );
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Payment notification failed for ${payment.id}: ${_error instanceof Error ? _error.message : String(_error)}`,
        'PaymentNotificationsProcessor',
        {
          paymentId: payment.id,
          status,
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      throw _error;
    }
  }

  // @Process('webhook-notification')
  async handleWebhookNotification(
    job: Job<{
      payment: PaymentData;
      status: string;
      webhookUrl: string;
      attempts: number;
    }>
  ) {
    const { payment, status, webhookUrl, attempts = 0 } = job.data;

    try {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Sending webhook notification: ${payment.id} to ${webhookUrl}, attempt ${attempts + 1}`,
        'PaymentNotificationsProcessor'
      );

      await this.sendWebhookNotification(payment, status, webhookUrl);

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Webhook notification sent successfully: ${payment.id}`,
        'PaymentNotificationsProcessor'
      );
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Webhook notification failed for ${payment.id}: ${_error instanceof Error ? _error.message : String(_error)}`,
        'PaymentNotificationsProcessor',
        {
          paymentId: payment.id,
          webhookUrl,
          attempts,
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );

      if (attempts < 3) {
        const delay = Math.pow(2, attempts) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        throw _error;
      } else {
        void this.loggingService.log(
          LogType.QUEUE,
          LogLevel.ERROR,
          `Webhook notification failed permanently for ${payment.id} after ${attempts + 1} attempts`,
          'PaymentNotificationsProcessor',
          {
            paymentId: payment.id,
            attempts: attempts + 1,
          }
        );
      }
    }
  }

  // @Process('alert-notification')
  handleAlertNotification(
    job: Job<{
      alertType: 'security' | 'performance' | 'system' | 'compliance';
      severity: 'low' | 'medium' | 'high' | 'critical';
      message: string;
      details: unknown;
    }>
  ) {
    const { alertType, severity, message, details } = job.data;

    try {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Sending alert notification: ${alertType} - ${severity}`,
        'PaymentNotificationsProcessor'
      );

      // Alert processing logic
      this.processAlert(alertType, severity, message, details);

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Alert notification sent successfully: ${alertType}`,
        'PaymentNotificationsProcessor'
      );
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Alert notification failed: ${_error instanceof Error ? _error.message : String(_error)}`,
        'PaymentNotificationsProcessor',
        {
          alertType,
          severity,
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      throw _error;
    }
  }

  private processPaymentNotification(payment: PaymentData, status: string): void {
    // Integrate with existing communication service
    void this.loggingService.log(
      LogType.QUEUE,
      LogLevel.DEBUG,
      `Processing payment notification for ${payment.id} with status ${status}`,
      'PaymentNotificationsProcessor',
      {
        paymentId: payment.id,
        status,
      }
    );
  }

  private async sendWebhookNotification(
    payment: PaymentData,
    status: string,
    webhookUrl: string
  ): Promise<void> {
    const payload = {
      event: 'payment.status.updated',
      payment: {
        id: payment.id,
        status,
        amount: payment.amount,
        currency: payment.currency,
        gateway: payment.gateway,
        transactionId: payment.transactionId,
        userId: payment.userId,
        updatedAt: new Date(),
      },
      timestamp: new Date(),
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'HealthCare-Payment-Webhook/1.0',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new HealthcareError(
        ErrorCode.EXTERNAL_SERVICE_INVALID_RESPONSE,
        `Webhook failed with status ${response.status}: ${response.statusText}`,
        undefined,
        {
          webhookUrl,
          status: response.status,
          statusText: response.statusText,
        },
        'PaymentNotificationsProcessor.sendWebhookNotification'
      );
    }
  }

  private processAlert(
    alertType: string,
    severity: string,
    message: string,
    _details: unknown
  ): void {
    // Integrate with existing alerting infrastructure
    void this.loggingService.log(
      LogType.QUEUE,
      LogLevel.DEBUG,
      `Processing alert: ${alertType} - ${severity}: ${message}`,
      'PaymentNotificationsProcessor',
      {
        alertType,
        severity,
        message,
      }
    );
  }
}
