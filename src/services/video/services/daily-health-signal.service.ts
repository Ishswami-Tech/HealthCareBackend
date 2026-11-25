import { Injectable, Inject, Optional, forwardRef } from '@nestjs/common';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging';
import { ConfigService } from '@config/config.service';
import { LogType, LogLevel } from '@core/types';

type DailyHealthState = 'healthy' | 'unhealthy' | 'unknown';

/**
 * Daily status page components whose outage stops patients and doctors from joining a call.
 * Other components (Recording/Live Streaming, SIP/PSTN, Dashboard, Webhook Delivery) can be
 * degraded or down while calls still work, so they never mark the provider unhealthy.
 */
const CALL_CRITICAL_COMPONENTS = ['api', 'core call experience'];
/** Only an outage of a call-critical component counts; degraded performance does not. */
const CALL_OUTAGE_STATUSES = new Set(['partial_outage', 'major_outage']);
const STATUS_PAGE_TIMEOUT_MS = 5000;
/** Status-page verdicts expire sooner than token/webhook signals so a recovery is noticed quickly. */
const STATUS_PAGE_SIGNAL_TTL_SECONDS = 5 * 60;
const DEFAULT_SIGNAL_TTL_SECONDS = 30 * 60;

type StatusPageComponent = { name: string; status: string };

/**
 * Daily's status page is a Statuspage.io site. Its machine-readable summary lives at
 * `/api/v2/summary.json`; a configured URL that already points at a JSON file is used as is.
 */
export function resolveDailyStatusSummaryUrl(statusUrl: string): string {
  if (/\.json(\?|$)/i.test(statusUrl)) {
    return statusUrl;
  }
  const base = statusUrl.endsWith('/') ? statusUrl : `${statusUrl}/`;
  return new URL('api/v2/summary.json', base).toString();
}

/**
 * Turns a Statuspage summary into a Daily health state.
 * - `unhealthy`: a call-critical component reports a partial or major outage.
 * - `healthy`: the call-critical components are present and none is in an outage, even when
 *   other components (for example recording) are degraded; those are listed in the details.
 * - `unknown`: the summary is malformed or no longer lists the call-critical components.
 */
export function evaluateDailyStatusSummary(summary: unknown): {
  state: DailyHealthState;
  details: Record<string, unknown>;
} {
  const rawComponents = (summary as { components?: unknown } | null)?.components;
  if (!Array.isArray(rawComponents)) {
    return { state: 'unknown', details: { reason: 'Status summary has no components' } };
  }

  const components: StatusPageComponent[] = rawComponents
    .filter(
      (component): component is { name: string; status: string; group?: unknown } =>
        typeof component === 'object' &&
        component !== null &&
        typeof (component as { name?: unknown }).name === 'string' &&
        typeof (component as { status?: unknown }).status === 'string' &&
        (component as { group?: unknown }).group !== true
    )
    .map(component => ({ name: component.name, status: component.status }));

  const affectedComponents = components.filter(component => component.status !== 'operational');
  const callComponents = components.filter(component =>
    CALL_CRITICAL_COMPONENTS.includes(component.name.trim().toLowerCase())
  );

  if (callComponents.length === 0) {
    return {
      state: 'unknown',
      details: {
        reason: 'Status summary does not list the call components',
        affectedComponents,
      },
    };
  }

  const callOutages = callComponents.filter(component =>
    CALL_OUTAGE_STATUSES.has(component.status)
  );

  return {
    state: callOutages.length > 0 ? 'unhealthy' : 'healthy',
    details: {
      affectedComponents,
      ...(callOutages.length > 0 ? { callOutages } : {}),
    },
  };
}

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
  private memorySignal: DailyHealthSignal | null = null;
  private memorySignalExpiresAt = 0;

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

  private ttlSecondsFor(signal: DailyHealthSignal): number {
    return signal.source === 'status-page'
      ? STATUS_PAGE_SIGNAL_TTL_SECONDS
      : DEFAULT_SIGNAL_TTL_SECONDS;
  }

  private async persistSignal(signal: DailyHealthSignal): Promise<void> {
    const ttlSeconds = this.ttlSecondsFor(signal);
    this.memorySignal = signal;
    this.memorySignalExpiresAt = Date.now() + ttlSeconds * 1000;

    if (this.cacheService) {
      await this.cacheService.set(this.CACHE_KEY, signal, ttlSeconds);
    }
  }

  private async loadSignal(): Promise<DailyHealthSignal | null> {
    if (this.memorySignal && Date.now() < this.memorySignalExpiresAt) {
      return this.memorySignal;
    }

    if (this.cacheService) {
      const cached = await this.cacheService.get<DailyHealthSignal>(this.CACHE_KEY);
      if (cached) {
        this.memorySignal = cached;
        this.memorySignalExpiresAt = Date.now() + this.ttlSecondsFor(cached) * 1000;
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
    const summaryUrl = resolveDailyStatusSummaryUrl(statusUrl);

    try {
      const response = await fetch(summaryUrl, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(STATUS_PAGE_TIMEOUT_MS),
      });
      if (!response.ok) {
        return null;
      }

      const { state, details } = evaluateDailyStatusSummary(await response.json());
      const signal = this.makeSignal(state, 'status-page', {
        statusUrl: summaryUrl,
        source: 'status-page',
        ...details,
      });
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
      // A fresh "unknown" status-page reading: don't refetch the page on every call.
      if (signal.source === 'status-page') {
        return null;
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
