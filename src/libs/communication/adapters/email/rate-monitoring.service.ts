/**
 * Email Rate Monitoring Service
 * =============================
 * Monitors bounce and complaint rates per clinic and provider
 * Provides alerting when rates exceed thresholds
 *
 * @module EmailRateMonitoringService
 * @description Email bounce/complaint rate monitoring and alerting
 */

import { Injectable, Inject, forwardRef, OnModuleInit, Optional } from '@nestjs/common';
import { COMMUNICATION_SERVICE_TOKEN } from '@communication/communication.constants';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';

export interface RateMetrics {
  clinicId?: string;
  provider: string;
  period: '1h' | '24h' | '7d' | '30d';
  sent: number;
  bounced: number;
  complained: number;
  delivered: number;
  bounceRate: number; // Percentage
  complaintRate: number; // Percentage
  deliveryRate: number; // Percentage
  timestamp: Date;
}

export interface RateAlert {
  clinicId?: string;
  provider: string;
  metric: 'bounce' | 'complaint';
  rate: number;
  threshold: number;
  period: string;
  timestamp: Date;
  severity: 'warning' | 'critical';
}

@Injectable()
export class EmailRateMonitoringService implements OnModuleInit {
  private readonly BOUNCE_RATE_THRESHOLD_WARNING = 3.0; // 3%
  private readonly BOUNCE_RATE_THRESHOLD_CRITICAL = 5.0; // 5%
  private readonly COMPLAINT_RATE_THRESHOLD_WARNING = 0.05; // 0.05%
  private readonly COMPLAINT_RATE_THRESHOLD_CRITICAL = 0.1; // 0.1%
  private readonly cacheTTL = 300; // 5 minutes
  private readonly cachePrefix = 'email:rate:';
  private monitoringInterval?: NodeJS.Timeout;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Optional()
    @Inject(COMMUNICATION_SERVICE_TOKEN)
    private readonly communicationService?: {
      sendEmail: (options: {
        to: string;
        subject: string;
        html: string;
        category: string;
        priority: string;
      }) => Promise<unknown>;
    }
  ) {}

  onModuleInit(): void {
    // Start monitoring every 5 minutes
    this.monitoringInterval = setInterval(
      () => {
        void this.checkRatesAndAlert();
      },
      5 * 60 * 1000
    );
  }

  onModuleDestroy(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
  }

  /**
   * Get bounce/complaint rates for a clinic and provider
   */
  async getRateMetrics(
    clinicId: string | undefined,
    provider: string,
    period: '1h' | '24h' | '7d' | '30d' = '24h'
  ): Promise<RateMetrics> {
    const cacheKey = `${this.cachePrefix}${clinicId || 'global'}:${provider}:${period}`;

    // Check cache first
    const cached = await this.cacheService.get<RateMetrics>(cacheKey);
    if (cached) {
      return cached;
    }

    // Calculate period
    const now = new Date();
    const periodStart = this.getPeriodStart(now, period);

    // Query database for metrics
    const metrics = await this.calculateMetrics(clinicId, provider, periodStart, now);

    // Cache result
    await this.cacheService.set(cacheKey, metrics, this.cacheTTL);

    return metrics;
  }

  /**
   * Calculate metrics from database
   */
  private async calculateMetrics(
    clinicId: string | undefined,
    provider: string,
    periodStart: Date,
    periodEnd: Date
  ): Promise<RateMetrics> {
    try {
      // Get sent emails count
      const sent = await this.databaseService.executeHealthcareRead(async client => {
        const logClient = client as unknown as {
          notificationDeliveryLog: {
            count: (args: {
              where: {
                channel: string;
                sentAt: { gte: Date; lte: Date };
                providerResponse?: { path: string[]; equals: string };
                clinicId?: string | null;
              };
            }) => Promise<number>;
          };
        };
        return await logClient.notificationDeliveryLog.count({
          where: {
            channel: 'email',
            sentAt: { gte: periodStart, lte: periodEnd },
            ...(clinicId && { clinicId }),
            // Filter by provider if possible (requires provider info in response)
          },
        });
      });

      // Get bounced emails count
      const bounced = await this.databaseService.executeHealthcareRead(async client => {
        const suppressionClient = client as unknown as {
          emailSuppressionList: {
            count: (args: {
              where: {
                reason: string;
                source: string;
                suppressedAt: { gte: Date; lte: Date };
                clinicId?: string | null;
              };
            }) => Promise<number>;
          };
        };
        return await suppressionClient.emailSuppressionList.count({
          where: {
            reason: 'BOUNCE',
            source: provider === 'aws_ses' ? 'SES' : 'ZEPTOMAIL',
            suppressedAt: { gte: periodStart, lte: periodEnd },
            ...(clinicId && { clinicId }),
          },
        });
      });

      // Get complained emails count
      const complained = await this.databaseService.executeHealthcareRead(async client => {
        const suppressionClient = client as unknown as {
          emailSuppressionList: {
            count: (args: {
              where: {
                reason: string;
                source: string;
                suppressedAt: { gte: Date; lte: Date };
                clinicId?: string | null;
              };
            }) => Promise<number>;
          };
        };
        return await suppressionClient.emailSuppressionList.count({
          where: {
            reason: 'COMPLAINT',
            source: provider === 'aws_ses' ? 'SES' : 'ZEPTOMAIL',
            suppressedAt: { gte: periodStart, lte: periodEnd },
            ...(clinicId && { clinicId }),
          },
        });
      });

      // Get delivered emails count
      const delivered = await this.databaseService.executeHealthcareRead(async client => {
        const logClient = client as unknown as {
          notificationDeliveryLog: {
            count: (args: {
              where: {
                channel: string;
                status: string;
                deliveredAt?: { gte: Date; lte: Date } | null;
                clinicId?: string | null;
              };
            }) => Promise<number>;
          };
        };
        return await logClient.notificationDeliveryLog.count({
          where: {
            channel: 'email',
            status: 'DELIVERED',
            deliveredAt: { gte: periodStart, lte: periodEnd },
            ...(clinicId && { clinicId }),
          },
        });
      });

      const bounceRate = sent > 0 ? (bounced / sent) * 100 : 0;
      const complaintRate = sent > 0 ? (complained / sent) * 100 : 0;
      const deliveryRate = sent > 0 ? (delivered / sent) * 100 : 0;

      const period: '1h' | '24h' | '7d' | '30d' = this.getPeriodFromDates(periodStart, periodEnd);

      return {
        ...(clinicId && { clinicId }),
        provider,
        period,
        sent,
        bounced,
        complained,
        delivered,
        bounceRate: Math.round(bounceRate * 100) / 100,
        complaintRate: Math.round(complaintRate * 10000) / 100, // Round to 2 decimal places for small percentages
        deliveryRate: Math.round(deliveryRate * 100) / 100,
        timestamp: new Date(),
      };
    } catch (error) {
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        'Failed to calculate rate metrics',
        'EmailRateMonitoringService',
        {
          error: error instanceof Error ? error.message : String(error),
          clinicId,
          provider,
        }
      );

      // Return zero metrics on error
      return {
        ...(clinicId && { clinicId }),
        provider,
        period: '24h',
        sent: 0,
        bounced: 0,
        complained: 0,
        delivered: 0,
        bounceRate: 0,
        complaintRate: 0,
        deliveryRate: 0,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Check rates and send alerts if thresholds exceeded
   */
  private async checkRatesAndAlert(): Promise<void> {
    try {
      // Get all active clinics (simplified - in production, query from database)
      // For now, check global rates and clinic-specific rates if needed

      const providers = ['zeptomail', 'aws_ses', 'smtp']; // ZeptoMail is primary

      for (const provider of providers) {
        // Check global rates
        const globalMetrics = await this.getRateMetrics(undefined, provider, '24h');

        // Check bounce rate
        if (globalMetrics.bounceRate >= this.BOUNCE_RATE_THRESHOLD_CRITICAL) {
          await this.sendAlert({
            provider,
            metric: 'bounce',
            rate: globalMetrics.bounceRate,
            threshold: this.BOUNCE_RATE_THRESHOLD_CRITICAL,
            period: '24h',
            timestamp: new Date(),
            severity: 'critical',
          });
        } else if (globalMetrics.bounceRate >= this.BOUNCE_RATE_THRESHOLD_WARNING) {
          await this.sendAlert({
            provider,
            metric: 'bounce',
            rate: globalMetrics.bounceRate,
            threshold: this.BOUNCE_RATE_THRESHOLD_WARNING,
            period: '24h',
            timestamp: new Date(),
            severity: 'warning',
          });
        }

        // Check complaint rate
        if (globalMetrics.complaintRate >= this.COMPLAINT_RATE_THRESHOLD_CRITICAL) {
          await this.sendAlert({
            provider,
            metric: 'complaint',
            rate: globalMetrics.complaintRate,
            threshold: this.COMPLAINT_RATE_THRESHOLD_CRITICAL,
            period: '24h',
            timestamp: new Date(),
            severity: 'critical',
          });
        } else if (globalMetrics.complaintRate >= this.COMPLAINT_RATE_THRESHOLD_WARNING) {
          await this.sendAlert({
            provider,
            metric: 'complaint',
            rate: globalMetrics.complaintRate,
            threshold: this.COMPLAINT_RATE_THRESHOLD_WARNING,
            period: '24h',
            timestamp: new Date(),
            severity: 'warning',
          });
        }
      }
    } catch (error) {
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        'Failed to check rates and alert',
        'EmailRateMonitoringService',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  /**
   * Send alert for rate threshold exceeded
   */
  private async sendAlert(alert: RateAlert): Promise<void> {
    const message = `${alert.severity.toUpperCase()}: ${alert.provider} ${alert.metric} rate (${alert.rate.toFixed(2)}%) exceeds threshold (${alert.threshold}%) for period ${alert.period}${alert.clinicId ? ` for clinic ${alert.clinicId}` : ''}`;

    await this.loggingService.log(
      LogType.EMAIL,
      alert.severity === 'critical' ? LogLevel.ERROR : LogLevel.WARN,
      message,
      'EmailRateMonitoringService',
      {
        ...alert,
        rate: alert.rate,
        threshold: alert.threshold,
      }
    );

    // Send notification to admins via CommunicationService if available
    if (this.communicationService) {
      try {
        // Get admin email from environment or use default
        const adminEmail = process.env['ADMIN_EMAIL'] || process.env['ALERT_EMAIL'];
        if (adminEmail) {
          await this.communicationService.sendEmail({
            to: adminEmail,
            subject: `[${alert.severity.toUpperCase()}] Email Rate Alert: ${alert.provider} ${alert.metric} rate exceeded`,
            html: `
              <h2>Email Rate Alert</h2>
              <p><strong>Severity:</strong> ${alert.severity.toUpperCase()}</p>
              <p><strong>Provider:</strong> ${alert.provider}</p>
              <p><strong>Metric:</strong> ${alert.metric}</p>
              <p><strong>Current Rate:</strong> ${alert.rate.toFixed(2)}%</p>
              <p><strong>Threshold:</strong> ${alert.threshold}%</p>
              <p><strong>Period:</strong> ${alert.period}</p>
              ${alert.clinicId ? `<p><strong>Clinic ID:</strong> ${alert.clinicId}</p>` : ''}
              <p><strong>Timestamp:</strong> ${alert.timestamp.toISOString()}</p>
              <p>Please investigate and take appropriate action.</p>
            `,
            category: 'SYSTEM',
            priority: alert.severity === 'critical' ? 'HIGH' : 'NORMAL',
          });
        }
      } catch (error) {
        // Log error but don't fail - alert logging is primary
        await this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          'Failed to send admin notification for rate alert',
          'EmailRateMonitoringService',
          {
            error: error instanceof Error ? error.message : String(error),
            alert: alert,
          }
        );
      }
    }
  }

  /**
   * Get period start date
   */
  private getPeriodStart(now: Date, period: '1h' | '24h' | '7d' | '30d'): Date {
    const start = new Date(now);
    switch (period) {
      case '1h':
        start.setHours(start.getHours() - 1);
        break;
      case '24h':
        start.setHours(start.getHours() - 24);
        break;
      case '7d':
        start.setDate(start.getDate() - 7);
        break;
      case '30d':
        start.setDate(start.getDate() - 30);
        break;
    }
    return start;
  }

  /**
   * Get period from dates
   */
  private getPeriodFromDates(start: Date, end: Date): '1h' | '24h' | '7d' | '30d' {
    const diffMs = end.getTime() - start.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffHours <= 1) {
      return '1h';
    } else if (diffHours <= 24) {
      return '24h';
    } else if (diffHours <= 24 * 7) {
      return '7d';
    } else {
      return '30d';
    }
  }
}
