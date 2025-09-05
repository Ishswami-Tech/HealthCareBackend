import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';

@Processor('payment-analytics')
export class PaymentAnalyticsProcessor {
  private readonly logger = new Logger(PaymentAnalyticsProcessor.name);

  @Process('payment-analytics')
  async handlePaymentAnalytics(job: Job<{
    payment: any;
    paymentDto: any;
    timestamp: Date;
  }>) {
    const { payment, paymentDto, timestamp } = job.data;
    
    try {
      this.logger.log(`Processing analytics for payment: ${payment.id}`);

      // Analytics processing logic will integrate with existing analytics service
      await this.processPaymentAnalytics(payment, paymentDto, timestamp);

      this.logger.log(`Analytics processing completed for payment: ${payment.id}`);
    } catch (error) {
      this.logger.error(`Analytics processing failed for payment ${payment.id}: ${(error as Error).message}`);
      throw error;
    }
  }

  @Process('error-analysis')
  async handleErrorAnalysis(job: Job<{
    error: any;
    paymentDto: any;
    timestamp: Date;
  }>) {
    const { error, paymentDto, timestamp } = job.data;
    
    try {
      this.logger.log(`Processing error analysis for user: ${paymentDto.userId}`);

      // Error analysis logic
      await this.processErrorAnalysis(error, paymentDto, timestamp);

      this.logger.log(`Error analysis completed for user: ${paymentDto.userId}`);
    } catch (analysisError) {
      this.logger.error(`Error analysis failed: ${(analysisError as Error).message}`);
      // Don't re-throw to avoid cascade failures
    }
  }

  @Process('performance-metrics')
  async handlePerformanceMetrics(job: Job<{
    metrics: any;
    timestamp: Date;
    domain: string;
  }>) {
    const { metrics, timestamp, domain } = job.data;
    
    try {
      this.logger.log(`Processing performance metrics for domain: ${domain}`);

      // Performance metrics processing
      await this.processPerformanceMetrics(metrics, timestamp, domain);

      this.logger.log(`Performance metrics processed for domain: ${domain}`);
    } catch (error) {
      this.logger.error(`Performance metrics processing failed: ${(error as Error).message}`);
    }
  }

  @Process('fraud-analytics')
  async handleFraudAnalytics(job: Job<{
    fraudData: any;
    timestamp: Date;
    riskScore: number;
  }>) {
    const { fraudData, timestamp, riskScore } = job.data;
    
    try {
      this.logger.log(`Processing fraud analytics with risk score: ${riskScore}`);

      // Fraud analytics processing
      await this.processFraudAnalytics(fraudData, timestamp, riskScore);

      this.logger.log(`Fraud analytics processed successfully`);
    } catch (error) {
      this.logger.error(`Fraud analytics processing failed: ${(error as Error).message}`);
    }
  }

  private async processPaymentAnalytics(payment: any, paymentDto: any, timestamp: Date): Promise<void> {
    // Record payment event for analytics
    const analyticsData = {
      paymentId: payment.id,
      userId: payment.userId,
      amount: payment.amount,
      currency: payment.currency,
      gateway: payment.gateway,
      method: payment.method,
      domain: payment.domain,
      status: payment.status,
      timestamp,
      processingTime: payment.metadata?.processingTime,
      fraudScore: payment.metadata?.fraudScore,
    };

    // Store in analytics database or send to analytics service
    this.logger.debug(`Analytics data recorded for payment: ${payment.id}`, analyticsData);
  }

  private async processErrorAnalysis(error: any, paymentDto: any, timestamp: Date): Promise<void> {
    // Analyze error patterns and trends
    const errorData = {
      errorType: error.name || 'UnknownError',
      errorMessage: error.message,
      userId: paymentDto.userId,
      amount: paymentDto.amount,
      gateway: paymentDto.gateway,
      method: paymentDto.method,
      domain: paymentDto.domain,
      timestamp,
    };

    // Store error data for pattern analysis
    this.logger.debug(`Error analysis data recorded`, errorData);
  }

  private async processPerformanceMetrics(metrics: any, timestamp: Date, domain: string): Promise<void> {
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
    this.logger.debug(`Performance metrics recorded for domain: ${domain}`, performanceData);
  }

  private async processFraudAnalytics(fraudData: any, timestamp: Date, riskScore: number): Promise<void> {
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
    this.logger.debug(`Fraud analytics recorded with risk score: ${riskScore}`, fraudAnalytics);
  }
}