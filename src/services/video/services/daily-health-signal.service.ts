import { Injectable, Inject, Optional, forwardRef } from '@nestjs/common';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging';
import { ConfigService } from '@config/config.service';
import { LogType, LogLevel } from '@core/types';

type DailyHealthState = 'healthy' | 'unhealthy' | 'unknown';

export type DailyHealthSignal = {
  state: DailyHealthState;
  source: 'token' | 'webhook' | 'status-page' | 'manual';
  lastUpdatedAt: string;
  lastEventType?: string;
  lastRoom?: string;
  lastMeetingId?: string;
  details?: Record<string, unknown>;
};

@Injectable()
export class DailyHealthSignalService {
  private readonly CACHE_KEY = 'video:daily:health-signal';
  private readonly SIGNAL_TTL_MS = 30 * 60 * 1000;
  private memorySignal: DailyHealthSignal | null = null;
  private memorySignalAt = 0;

  constructor(
    @Optional()
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService?: CacheService,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService,
    @Optional()
    @Inject(forwardRef(() => ConfigService))
    private readonly configService?: ConfigService
  ) {}

  private async persistSignal(signal: DailyHealthSignal): Promise<void> {
    this.memorySignal = signal;
    this.memorySignalAt = Date.now();

    if (this.cacheService) {
      await this.cacheService.set(this.CACHE_KEY, signal, 60 * 30);
    }
  }

  private async loadSignal(): Promise<DailyHealthSignal | null> {
    if (this.memorySignal && Date.now() - this.memorySignalAt < this.SIGNAL_TTL_MS) {
      return this.memorySignal;
    }

    if (this.cacheService) {
      const cached = await this.cacheService.get<DailyHealthSignal>(this.CACHE_KEY);
      if (cached) {
        this.memorySignal = cached;
        this.memorySignalAt = Date.now();
        return cached;
      }
    }

    return null;
  }

  private makeSignal(
    state: DailyHealthState,
    source: DailyHealthSignal['source'],
    details?: Record<string, unknown>
  ): DailyHealthSignal {
    return {
      state,
      source,
      lastUpdatedAt: new Date().toISOString(),
      ...(details ? { details } : {}),
    };
  }

  async recordTokenSuccess(details: {
    roomName: string;
    meetingUrl?: string;
    meetingId?: string;
  }): Promise<void> {
    await this.persistSignal(
      this.makeSignal('healthy', 'token', {
        ...details,
      })
    );
  }

  async recordWebhookEvent(eventType: string, payload: Record<string, unknown>): Promise<void> {
    const room = typeof payload['room'] === 'string' ? payload['room'] : undefined;
    const meetingId = typeof payload['meeting_id'] === 'string' ? payload['meeting_id'] : undefined;
    const signal = this.makeSignal('healthy', 'webhook', {
      eventType,
      room,
      meetingId,
    });
    signal.lastEventType = eventType;
    if (room) {
      signal.lastRoom = room;
    }
    if (meetingId) {
      signal.lastMeetingId = meetingId;
    }
    await this.persistSignal(signal);
  }

  async recordWebhookHealth(state: string, details: Record<string, unknown>): Promise<void> {
    const normalizedState: DailyHealthState =
      state === 'ACTIVE' ? 'healthy' : state === 'FAILED' ? 'unhealthy' : 'unknown';

    await this.persistSignal(
      this.makeSignal(normalizedState, 'webhook', {
        ...details,
        webhookState: state,
      })
    );
  }

  async recordManualSignal(healthy: boolean, details?: Record<string, unknown>): Promise<void> {
    await this.persistSignal(this.makeSignal(healthy ? 'healthy' : 'unhealthy', 'manual', details));
  }

  async refreshFromStatusPage(): Promise<DailyHealthSignal | null> {
    const statusUrl =
      this.configService?.get<{
        daily?: { statusUrl?: string };
      }>('video')?.daily?.statusUrl || 'https://status.daily.co/';

    try {
      const response = await fetch(statusUrl, { headers: { accept: 'text/html' } });
      if (!response.ok) {
        return null;
      }

      const html = await response.text();
      const healthy = html.includes('All Systems Operational');
      const degraded =
        html.includes('Degraded Performance') ||
        html.includes('Partial Outage') ||
        html.includes('Major Outage') ||
        html.includes('Maintenance');

      const signal = this.makeSignal(
        healthy ? 'healthy' : degraded ? 'unhealthy' : 'unknown',
        'status-page',
        {
          statusUrl,
          source: 'status-page',
        }
      );
      await this.persistSignal(signal);
      return signal;
    } catch (error) {
      void this.loggingService?.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Daily status page refresh failed: ${error instanceof Error ? error.message : String(error)}`,
        'DailyHealthSignalService.refreshFromStatusPage',
        { error: error instanceof Error ? error.message : String(error) }
      );
      return null;
    }
  }

  async isHealthy(): Promise<boolean | null> {
    const signal = await this.loadSignal();
    if (signal) {
      if (signal.state === 'healthy') {
        return true;
      }
      if (signal.state === 'unhealthy') {
        return false;
      }
    }

    const statusSignal = await this.refreshFromStatusPage();
    if (statusSignal) {
      if (statusSignal.state === 'healthy') {
        return true;
      }
      if (statusSignal.state === 'unhealthy') {
        return false;
      }
    }

    return null;
  }

  async getSignal(): Promise<DailyHealthSignal | null> {
    return await this.loadSignal();
  }
}
