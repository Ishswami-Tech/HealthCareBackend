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
import type { PaymentData, PaymentDto } from '@core/types';

// Internal imports - Core
import { LogType, LogLevel } from '@core/types';

// @Processor('payment-processing')
export class PaymentProcessingProcessor {
  constructor(private readonly loggingService: LoggingService) {}

  // @Process('domain-processing')
  handleDomainProcessing(
    job: Job<{
      payment: PaymentData;
      paymentDto: PaymentDto;
      domain: string;
    }>
  ) {
    const { payment, domain } = job.data;

    try {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing domain-specific logic for payment: ${payment.id}, domain: ${domain}`,
        'PaymentProcessingProcessor'
      );

      // Domain-specific processing logic will be handled by the payment service
      // This processor just ensures the job is properly queued and tracked

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Domain processing completed for payment: ${payment.id}`,
        'PaymentProcessingProcessor'
      );
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Domain processing failed for payment ${payment.id}: ${_error instanceof Error ? _error.message : String(_error)}`,
        'PaymentProcessingProcessor',
        {
          paymentId: payment.id,
          domain,
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      throw _error;
    }
  }

  // @Process('subscription-processing')
  handleSubscriptionProcessing(
    job: Job<{
      payment: PaymentData;
      timestamp: Date;
    }>
  ) {
    const { payment } = job.data;

    try {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing subscription for payment: ${payment.id}`,
        'PaymentProcessingProcessor'
      );

      // Subscription processing logic will be handled by the subscription service

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Subscription processing completed for payment: ${payment.id}`,
        'PaymentProcessingProcessor'
      );
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Subscription processing failed for payment ${payment.id}: ${_error instanceof Error ? _error.message : String(_error)}`,
        'PaymentProcessingProcessor',
        {
          paymentId: payment.id,
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      throw _error;
    }
  }

  // @Process('manual-review')
  handleManualReview(
    job: Job<{
      paymentDto: PaymentDto;
      fraudScore: number;
      timestamp: Date;
    }>
  ) {
    const { paymentDto, fraudScore } = job.data;

    try {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Queuing payment for manual review: userId=${paymentDto.userId}, fraudScore=${fraudScore}`,
        'PaymentProcessingProcessor'
      );

      // Manual review processing logic

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Manual review queued successfully for user: ${paymentDto.userId}`,
        'PaymentProcessingProcessor'
      );
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Failed to queue manual review: ${_error instanceof Error ? _error.message : String(_error)}`,
        'PaymentProcessingProcessor',
        {
          userId: paymentDto.userId,
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      throw _error;
    }
  }

  // @Process('payment-reconciliation')
  handlePaymentReconciliation(
    job: Job<{
      paymentIds: string[];
      reconciliationType: 'daily' | 'weekly' | 'monthly';
    }>
  ) {
    const { paymentIds, reconciliationType } = job.data;

    try {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Starting payment reconciliation: ${reconciliationType}, ${paymentIds.length} payments`,
        'PaymentProcessingProcessor'
      );

      // Payment reconciliation logic

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Payment reconciliation completed: ${reconciliationType}`,
        'PaymentProcessingProcessor'
      );
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Payment reconciliation failed: ${_error instanceof Error ? _error.message : String(_error)}`,
        'PaymentProcessingProcessor',
        {
          reconciliationType,
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );
      throw _error;
    }
  }
}
