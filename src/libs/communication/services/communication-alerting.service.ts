/**
 * Communication Alerting Service
 * ============================
 * Monitors delivery failures and triggers alerts when thresholds are exceeded
 *
 * @module CommunicationAlertingService
 * @description Automated alerting for communication delivery failures
 */

import { Injectable, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
// Use direct imports to avoid TDZ issues with barrel exports
import { LoggingService } from '@infrastructure/logging/logging.service';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { EventService } from '@infrastructure/events/event.service';
import { LogType, LogLevel, EventCategory, EventPriority } from '@core/types';
import type { CommunicationChannel } from '@core/types';

/**
 * Alert Configuration
 */
interface AlertConfig {
  failureRateThreshold: number; // Percentage (0-100)
  consecutiveFailuresThreshold: number;
  timeWindowMinutes: number;
  enabled: boolean;
}

/**
 * Alert Status
 */
interface AlertStatus {
  channel: CommunicationChannel;
  provider?: string;
  clinicId?: string;
  alertType: 'failure_rate' | 'consecutive_failures' | 'provider_down';
  severity: 'warning' | 'critical';
  message: string;
  metrics: {
    totalRequests: number;
    failedRequests: number;
    failureRate: number;
    consecutiveFailures: number;
  };
  timestamp: Date;
}

@Injectable()
export class CommunicationAlertingService implements OnModuleInit {
  private readonly alertConfig: Record<CommunicationChannel, AlertConfig> = {
    email: {
      failureRateThreshold: 10, // Alert if >10% failure rate
      consecutiveFailuresThreshold: 5,
      timeWindowMinutes: 15,
      enabled: true,
    },
    whatsapp: {
      failureRateThreshold: 15, // Alert if >15% failure rate
      consecutiveFailuresThreshold: 5,
      timeWindowMinutes: 15,
      enabled: true,
    },
    push: {
      failureRateThreshold: 20, // Alert if >20% failure rate
      consecutiveFailuresThreshold: 10,
      timeWindowMinutes: 15,
      enabled: true,
    },
    socket: {
      failureRateThreshold: 25, // Alert if >25% failure rate
      consecutiveFailuresThreshold: 10,
      timeWindowMinutes: 15,
      enabled: true,
    },
    sms: {
      failureRateThreshold: 15,
      consecutiveFailuresThreshold: 5,
      timeWindowMinutes: 15,
      enabled: true,
    },
  };

  private alertCooldown = new Map<string, number>(); // Track last alert time per key
  private readonly ALERT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown between alerts

  constructor(
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => EventService))
    private readonly eventService: EventService
  ) {}

  async onModuleInit(): Promise<void> {
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Communication alerting service initialized',
      'CommunicationAlertingService',
      {
        channels: Object.keys(this.alertConfig),
      }
    );
  }

  /**
   * Check for delivery failures and trigger alerts
   */
  async checkAndAlert(
    channel: CommunicationChannel,
    provider?: string,
    clinicId?: string
  ): Promise<AlertStatus[]> {
    const config = this.alertConfig[channel];
    if (!config.enabled) {
      return [];
    }

    const alerts: AlertStatus[] = [];

    // Get recent delivery metrics
    const metrics = await this.getRecentMetrics(
      channel,
      provider,
      clinicId,
      config.timeWindowMinutes
    );

    if (metrics.totalRequests === 0) {
      return alerts; // No requests to analyze
    }

    const failureRate = (metrics.failedRequests / metrics.totalRequests) * 100;

    // Check failure rate threshold
    if (failureRate > config.failureRateThreshold) {
      const alertKey = this.getAlertKey(channel, provider, clinicId, 'failure_rate');
      if (this.shouldAlert(alertKey)) {
        const severity = failureRate > config.failureRateThreshold * 2 ? 'critical' : 'warning';
        const alert: AlertStatus = {
          channel,
          ...(provider !== undefined && { provider }),
          ...(clinicId !== undefined && { clinicId }),
          alertType: 'failure_rate',
          severity,
          message: `High failure rate detected for ${channel}: ${failureRate.toFixed(2)}% (threshold: ${config.failureRateThreshold}%)`,
          metrics: {
            totalRequests: metrics.totalRequests,
            failedRequests: metrics.failedRequests,
            failureRate,
            consecutiveFailures: metrics.consecutiveFailures,
          },
          timestamp: new Date(),
        };
        alerts.push(alert);

        await this.triggerAlert(alert);
        this.recordAlert(alertKey);
      }
    }

    // Check consecutive failures threshold
    if (metrics.consecutiveFailures >= config.consecutiveFailuresThreshold) {
      const alertKey = this.getAlertKey(channel, provider, clinicId, 'consecutive_failures');
      if (this.shouldAlert(alertKey)) {
        const alert: AlertStatus = {
          channel,
          ...(provider !== undefined && { provider }),
          ...(clinicId !== undefined && { clinicId }),
          alertType: 'consecutive_failures',
          severity: 'critical',
          message: `Multiple consecutive failures for ${channel}: ${metrics.consecutiveFailures} failures (threshold: ${config.consecutiveFailuresThreshold})`,
          metrics: {
            totalRequests: metrics.totalRequests,
            failedRequests: metrics.failedRequests,
            failureRate,
            consecutiveFailures: metrics.consecutiveFailures,
          },
          timestamp: new Date(),
        };
        alerts.push(alert);

        await this.triggerAlert(alert);
        this.recordAlert(alertKey);
      }
    }

    return alerts;
  }

  /**
   * Get recent delivery metrics
   */
  private async getRecentMetrics(
    channel: CommunicationChannel,
    provider?: string,
    clinicId?: string,
    timeWindowMinutes: number = 15
  ): Promise<{
    totalRequests: number;
    failedRequests: number;
    consecutiveFailures: number;
  }> {
    const since = new Date(Date.now() - timeWindowMinutes * 60 * 1000);

    try {
      type DeliveryLogResult = { status: string; createdAt: Date };
      const results = await this.databaseService.executeHealthcareRead(async client => {
        const typedClient = client as unknown as {
          notificationDeliveryLog: {
            findMany: (args: {
              where: Record<string, unknown>;
              select: { status: boolean; createdAt: boolean };
              orderBy: { createdAt: 'desc' | 'asc' };
            }) => Promise<DeliveryLogResult[]>;
          };
        };
        return await typedClient.notificationDeliveryLog.findMany({
          where: {
            channel,
            createdAt: { gte: since },
            ...(provider && {
              providerResponse: {
                path: ['provider'],
                equals: provider,
              },
            }),
            ...(clinicId && { clinicId }),
          },
          select: {
            status: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        });
      });

      const totalRequests = results.length;
      const failedRequests = results.filter(
        (r: DeliveryLogResult) => r.status === 'FAILED' || r.status === 'BOUNCED'
      ).length;

      // Calculate consecutive failures
      let consecutiveFailures = 0;
      for (const result of results) {
        if (result.status === 'FAILED' || result.status === 'BOUNCED') {
          consecutiveFailures++;
        } else {
          break; // Stop counting when we hit a success
        }
      }

      return {
        totalRequests,
        failedRequests,
        consecutiveFailures,
      };
    } catch (error) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'Failed to get recent metrics for alerting',
        'CommunicationAlertingService',
        {
          error: error instanceof Error ? error.message : String(error),
          channel,
          provider,
          clinicId,
        }
      );
      return {
        totalRequests: 0,
        failedRequests: 0,
        consecutiveFailures: 0,
      };
    }
  }

  /**
   * Trigger alert (log and emit event)
   */
  private async triggerAlert(alert: AlertStatus): Promise<void> {
    // Log alert
    await this.loggingService.log(
      LogType.NOTIFICATION,
      alert.severity === 'critical' ? LogLevel.ERROR : LogLevel.WARN,
      `Communication alert: ${alert.message}`,
      'CommunicationAlertingService',
      {
        channel: alert.channel,
        provider: alert.provider,
        clinicId: alert.clinicId,
        alertType: alert.alertType,
        severity: alert.severity,
        metrics: alert.metrics,
      }
    );

    // Emit event for external alerting systems
    if (this.eventService && typeof this.eventService.emit === 'function') {
      await this.eventService.emit('communication.alert.triggered', {
        alert,
        timestamp: new Date(),
        category: EventCategory.SYSTEM,
        priority: alert.severity === 'critical' ? EventPriority.CRITICAL : EventPriority.HIGH,
      });
    }
  }

  /**
   * Check if alert should be triggered (cooldown check)
   */
  private shouldAlert(alertKey: string): boolean {
    const lastAlertTime = this.alertCooldown.get(alertKey) || 0;
    const now = Date.now();
    return now - lastAlertTime > this.ALERT_COOLDOWN_MS;
  }

  /**
   * Record alert time
   */
  private recordAlert(alertKey: string): void {
    this.alertCooldown.set(alertKey, Date.now());
  }

  /**
   * Get alert key for cooldown tracking
   */
  private getAlertKey(
    channel: CommunicationChannel,
    provider: string | undefined,
    clinicId: string | undefined,
    alertType: string
  ): string {
    return `${channel}:${provider || 'default'}:${clinicId || 'global'}:${alertType}`;
  }

  /**
   * Get all active alerts
   */
  async getActiveAlerts(): Promise<AlertStatus[]> {
    const alerts: AlertStatus[] = [];

    for (const channel of Object.keys(this.alertConfig) as CommunicationChannel[]) {
      const channelAlerts = await this.checkAndAlert(channel);
      alerts.push(...channelAlerts);
    }

    return alerts;
  }

  /**
   * Update alert configuration
   */
  updateAlertConfig(channel: CommunicationChannel, config: Partial<AlertConfig>): void {
    if (this.alertConfig[channel]) {
      this.alertConfig[channel] = { ...this.alertConfig[channel], ...config };
    }
  }

  /**
   * Get alert configuration
   */
  getAlertConfig(): Record<CommunicationChannel, AlertConfig> {
    return { ...this.alertConfig };
  }
}
