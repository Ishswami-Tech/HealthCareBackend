import { Processor, Process } from "@nestjs/bull";
import { Logger } from "@nestjs/common";
import { Job } from "bull";
import {
  PaymentData,
  PaymentDto,
  PaymentJobData,
} from "../types/queue-job.types";

@Processor("payment-processing")
export class PaymentProcessingProcessor {
  private readonly logger = new Logger(PaymentProcessingProcessor.name);

  @Process("domain-processing")
  async handleDomainProcessing(
    job: Job<{
      payment: PaymentData;
      paymentDto: PaymentDto;
      domain: string;
    }>,
  ) {
    const { payment, paymentDto, domain } = job.data;

    try {
      this.logger.log(
        `Processing domain-specific logic for payment: ${payment.id}, domain: ${domain}`,
      );

      // Domain-specific processing logic will be handled by the payment service
      // This processor just ensures the job is properly queued and tracked

      this.logger.log(`Domain processing completed for payment: ${payment.id}`);
    } catch (_error) {
      this.logger.error(
        `Domain processing failed for payment ${payment.id}: ${(_error as Error).message}`,
      );
      throw _error;
    }
  }

  @Process("subscription-processing")
  async handleSubscriptionProcessing(
    job: Job<{
      payment: PaymentData;
      timestamp: Date;
    }>,
  ) {
    const { payment } = job.data;

    try {
      this.logger.log(`Processing subscription for payment: ${payment.id}`);

      // Subscription processing logic will be handled by the subscription service

      this.logger.log(
        `Subscription processing completed for payment: ${payment.id}`,
      );
    } catch (_error) {
      this.logger.error(
        `Subscription processing failed for payment ${payment.id}: ${(_error as Error).message}`,
      );
      throw _error;
    }
  }

  @Process("manual-review")
  async handleManualReview(
    job: Job<{
      paymentDto: PaymentDto;
      fraudScore: number;
      timestamp: Date;
    }>,
  ) {
    const { paymentDto, fraudScore } = job.data;

    try {
      this.logger.log(
        `Queuing payment for manual review: userId=${paymentDto.userId}, fraudScore=${fraudScore}`,
      );

      // Manual review processing logic

      this.logger.log(
        `Manual review queued successfully for user: ${paymentDto.userId}`,
      );
    } catch (_error) {
      this.logger.error(
        `Failed to queue manual review: ${(_error as Error).message}`,
      );
      throw _error;
    }
  }

  @Process("payment-reconciliation")
  async handlePaymentReconciliation(
    job: Job<{
      paymentIds: string[];
      reconciliationType: "daily" | "weekly" | "monthly";
    }>,
  ) {
    const { paymentIds, reconciliationType } = job.data;

    try {
      this.logger.log(
        `Starting payment reconciliation: ${reconciliationType}, ${paymentIds.length} payments`,
      );

      // Payment reconciliation logic

      this.logger.log(
        `Payment reconciliation completed: ${reconciliationType}`,
      );
    } catch (_error) {
      this.logger.error(
        `Payment reconciliation failed: ${(_error as Error).message}`,
      );
      throw _error;
    }
  }
}
