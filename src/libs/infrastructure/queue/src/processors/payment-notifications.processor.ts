import { Processor, Process } from "@nestjs/bull";
import { Logger } from "@nestjs/common";
import { Job } from "bull";
import { PaymentData } from "../types/queue-job.types";

@Processor("payment-notifications")
export class PaymentNotificationsProcessor {
  private readonly logger = new Logger(PaymentNotificationsProcessor.name);

  @Process("payment-notification")
  async handlePaymentNotification(
    job: Job<{
      payment: PaymentData;
      status: string;
      timestamp: Date;
    }>,
  ) {
    const { payment, status } = job.data;

    try {
      this.logger.log(
        `Sending payment notification: ${payment.id} - ${status}`,
      );

      // Notification processing logic will integrate with existing communication service
      await this.processPaymentNotification(payment, status);

      this.logger.log(`Payment notification sent successfully: ${payment.id}`);
    } catch (_error) {
      this.logger.error(
        `Payment notification failed for ${payment.id}: ${(_error as Error).message}`,
      );
      throw _error;
    }
  }

  @Process("webhook-notification")
  async handleWebhookNotification(
    job: Job<{
      payment: PaymentData;
      status: string;
      webhookUrl: string;
      attempts: number;
    }>,
  ) {
    const { payment, status, webhookUrl, attempts = 0 } = job.data;

    try {
      this.logger.log(
        `Sending webhook notification: ${payment.id} to ${webhookUrl}, attempt ${attempts + 1}`,
      );

      await this.sendWebhookNotification(payment, status, webhookUrl);

      this.logger.log(`Webhook notification sent successfully: ${payment.id}`);
    } catch (_error) {
      this.logger.error(
        `Webhook notification failed for ${payment.id}: ${(_error as Error).message}`,
      );

      if (attempts < 3) {
        const delay = Math.pow(2, attempts) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        throw _error;
      } else {
        this.logger.error(
          `Webhook notification failed permanently for ${payment.id} after ${attempts + 1} attempts`,
        );
      }
    }
  }

  @Process("alert-notification")
  async handleAlertNotification(
    job: Job<{
      alertType: "security" | "performance" | "system" | "compliance";
      severity: "low" | "medium" | "high" | "critical";
      message: string;
      details: unknown;
    }>,
  ) {
    const { alertType, severity, message, details } = job.data;

    try {
      this.logger.log(`Sending alert notification: ${alertType} - ${severity}`);

      // Alert processing logic
      await this.processAlert(alertType, severity, message, details);

      this.logger.log(`Alert notification sent successfully: ${alertType}`);
    } catch (_error) {
      this.logger.error(
        `Alert notification failed: ${(_error as Error).message}`,
      );
      throw _error;
    }
  }

  private async processPaymentNotification(
    payment: PaymentData,
    status: string,
  ): Promise<void> {
    // Integrate with existing communication service
    this.logger.debug(
      `Processing payment notification for ${payment.id} with status ${status}`,
    );
  }

  private async sendWebhookNotification(
    payment: PaymentData,
    status: string,
    webhookUrl: string,
  ): Promise<void> {
    const payload = {
      event: "payment.status.updated",
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
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "HealthCare-Payment-Webhook/1.0",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(
        `Webhook failed with status ${response.status}: ${response.statusText}`,
      );
    }
  }

  private async processAlert(
    alertType: string,
    severity: string,
    message: string,
    details: unknown,
  ): Promise<void> {
    // Integrate with existing alerting infrastructure
    this.logger.debug(
      `Processing alert: ${alertType} - ${severity}: ${message}`,
    );
  }
}
