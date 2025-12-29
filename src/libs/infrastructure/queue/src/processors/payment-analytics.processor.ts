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
import type { PaymentData, PaymentDto, QueuePerformanceMetrics, FraudData } from '@core/types';

// Internal imports - Core
import { LogType, LogLevel } from '@core/types';

// @Processor('payment-analytics')
export class PaymentAnalyticsProcessor {
  constructor(private readonly loggingService: LoggingService) {}

  // @Process('payment-analytics')
  handlePaymentAnalytics(
    job: Job<{
      payment: PaymentData;
      paymentDto: PaymentDto;
      timestamp: Date;
    }>
  ) {
    const { payment, paymentDto, timestamp } = job.data;

    try {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing analytics for payment: ${payment.id}`,
        'PaymentAnalyticsProcessor'
      );

      // Analytics processing logic will integrate with existing analytics service
      this.processPaymentAnalytics(payment, paymentDto, timestamp);

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Analytics processing completed for payment: ${payment.id}`,
        'PaymentAnalyticsProcessor'
      );
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Analytics processing failed for payment ${payment.id}: ${_error instanceof Error ? _error.message : String(_error)}`,
        'PaymentAnalyticsProcessor',
        {
          paymentId: payment.id,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  // @Process('error-analysis')
  handleErrorAnalysis(
    job: Job<{
      _error: Error;
      paymentDto: PaymentDto;
      timestamp: Date;
    }>
  ) {
    const { _error, paymentDto, timestamp } = job.data;

    try {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing error analysis for user: ${paymentDto.userId}`,
        'PaymentAnalyticsProcessor'
      );

      // Error analysis logic
      this.processErrorAnalysis(_error, paymentDto, timestamp);

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Error analysis completed for user: ${paymentDto.userId}`,
        'PaymentAnalyticsProcessor'
      );
    } catch (analysisError) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Error analysis failed: ${analysisError instanceof Error ? analysisError.message : String(analysisError)}`,
        'PaymentAnalyticsProcessor',
        {
          userId: paymentDto.userId,
          error: analysisError instanceof Error ? analysisError.message : String(analysisError),
        }
      );
      // Don't re-throw to avoid cascade failures
    }
  }

  // @Process('performance-metrics')
  handlePerformanceMetrics(
    job: Job<{
      metrics: QueuePerformanceMetrics;
      timestamp: Date;
      domain: string;
    }>
  ) {
    const { metrics, timestamp, domain } = job.data;

    try {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing performance metrics for domain: ${domain}`,
        'PaymentAnalyticsProcessor'
      );

      // Performance metrics processing
      this.processPerformanceMetrics(metrics, timestamp, domain);

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Performance metrics processed for domain: ${domain}`,
        'PaymentAnalyticsProcessor'
      );
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Performance metrics processing failed: ${_error instanceof Error ? _error.message : String(_error)}`,
        'PaymentAnalyticsProcessor',
        {
          domain,
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );
    }
  }

  // @Process('fraud-analytics')
  handleFraudAnalytics(
    job: Job<{
      fraudData: FraudData;
      timestamp: Date;
      riskScore: number;
    }>
  ) {
    const { fraudData, timestamp, riskScore } = job.data;

    try {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing fraud analytics with risk score: ${riskScore}`,
        'PaymentAnalyticsProcessor'
      );

      // Fraud analytics processing
      this.processFraudAnalytics(fraudData, timestamp, riskScore);

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        'Fraud analytics processed successfully',
        'PaymentAnalyticsProcessor'
      );
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Fraud analytics processing failed: ${_error instanceof Error ? _error.message : String(_error)}`,
        'PaymentAnalyticsProcessor',
        {
          riskScore,
          error: _error instanceof Error ? _error.message : String(_error),
        }
      );
    }
  }

  private processPaymentAnalytics(
    payment: PaymentData,
    paymentDto: PaymentDto,
    timestamp: Date
  ): void {
    // Record payment event for analytics
    const analyticsData = {
      paymentId: payment.id,
      userId: payment.userId,
      amount: payment.amount,
      currency: payment.currency,
      gateway: payment.gateway,
      status: payment.status,
      timestamp,
      processingTime: payment.metadata?.['processingTime'],
      fraudScore: payment.metadata?.['fraudScore'],
    };

    // Store in analytics database or send to analytics service
    void this.loggingService.log(
      LogType.QUEUE,
      LogLevel.DEBUG,
      `Analytics data recorded for payment: ${payment.id}`,
      'PaymentAnalyticsProcessor',
      analyticsData as Record<string, unknown>
    );
  }

  private processErrorAnalysis(_error: Error, paymentDto: PaymentDto, timestamp: Date): void {
    // Analyze error patterns and trends
    const errorData = {
      errorType: _error.name || 'UnknownError',
      errorMessage: _error.message,
      userId: paymentDto.userId,
      amount: paymentDto.amount,
      gateway: paymentDto.gateway,
      timestamp,
    };

    // Store error data for pattern analysis
    void this.loggingService.log(
      LogType.QUEUE,
      LogLevel.DEBUG,
      'Error analysis data recorded',
      'PaymentAnalyticsProcessor',
      errorData as Record<string, unknown>
    );
  }

  private processPerformanceMetrics(
    metrics: QueuePerformanceMetrics,
    timestamp: Date,
    domain: string
  ): void {
    // Process performance metrics for monitoring dashboards
    const performanceData = {
      domain,
      timestamp,
      throughput: metrics.throughput,
      latency: metrics.averageLatency,
      errorRate: metrics.errorRate,
      queueSize: metrics.queueSize,
      activeConnections: metrics.activeConnections,
    };

    // Store performance data
    void this.loggingService.log(
      LogType.QUEUE,
      LogLevel.DEBUG,
      `Performance metrics recorded for domain: ${domain}`,
      'PaymentAnalyticsProcessor',
      performanceData as Record<string, unknown>
    );
  }

  private processFraudAnalytics(fraudData: FraudData, timestamp: Date, riskScore: number): void {
    // Process fraud detection analytics
    const fraudAnalytics = {
      timestamp,
      riskScore,
      riskFactors: fraudData.riskFactors,
      userId: fraudData.userId,
      amount: fraudData.amount,
      gateway: fraudData.gateway,
      blocked: riskScore > 80,
    };

    // Store fraud analytics for ML model training and pattern detection
    void this.loggingService.log(
      LogType.QUEUE,
      LogLevel.DEBUG,
      `Fraud analytics recorded with risk score: ${riskScore}`,
      'PaymentAnalyticsProcessor',
      fraudAnalytics as Record<string, unknown>
    );
  }
}
