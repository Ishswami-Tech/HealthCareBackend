/// <reference types="jest" />
/**
 * Unit tests for DailyHealthSignalService's status-page check.
 *
 * Daily publishes a Statuspage.io summary. Only an outage of the components needed to join a call
 * ("API", "Core Call Experience") may mark the provider unhealthy: when it does, the video factory
 * fails over to another provider and `/health` reports video as unavailable. A recording-only
 * incident (as on 2026-11-25, "Issues starting recordings") must leave Daily healthy.
 *
 * The centralized HttpService is replaced by a double; nothing here touches the network, the
 * cache or the real configuration.
 */

import {
  DailyHealthSignalService,
  evaluateDailyStatusSummary,
  resolveDailyStatusSummaryUrl,
  type DailyHealthSignal,
} from '@services/video/services/daily-health-signal.service';

// Only needed as injection tokens; replacing them keeps heavy module graphs out of this test.
jest.mock('@infrastructure/cache/cache.service', () => ({ CacheService: class CacheService {} }));
jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));
jest.mock('@config/config.service', () => ({ ConfigService: class ConfigService {} }));
jest.mock('@infrastructure/http', () => ({ HttpService: class HttpService {} }));

type ComponentStatus =
  'operational' | 'degraded_performance' | 'partial_outage' | 'major_outage' | 'under_maintenance';

interface StatusSummary {
  status: { indicator: string; description: string };
  components: Array<{ id: string; name: string; status: ComponentStatus; group: boolean }>;
}

function summary(overrides: Partial<Record<string, ComponentStatus>> = {}): StatusSummary {
  const base: Record<string, ComponentStatus> = {
    API: 'operational',
    Dashboard: 'operational',
    'Core Call Experience': 'operational',
    'Recording/Live Streaming': 'operational',
    'SIP/PSTN': 'operational',
    'Webhook Delivery': 'operational',
  };
  return {
    status: { indicator: 'none', description: 'All Systems Operational' },
    components: Object.entries({ ...base, ...overrides }).map(([name, status], index) => ({
      id: `c${index}`,
      name,
      status: status as ComponentStatus,
      group: false,
    })),
  };
}

/** An HttpService double whose GET resolves with `body` (HttpService throws on non-2xx). */
function httpReturning(body: unknown): { get: jest.Mock } {
  return { get: jest.fn().mockResolvedValue({ data: body, status: 200 }) };
}

function httpFailing(message: string): { get: jest.Mock } {
  return { get: jest.fn().mockRejectedValue(new Error(message)) };
}

interface ServiceDouble {
  readonly service: DailyHealthSignalService;
  readonly log: jest.Mock;
}

function makeService(
  http: { get: jest.Mock } | undefined,
  cache?: { get: jest.Mock; set: jest.Mock },
  statusUrl?: string
): ServiceDouble {
  const log = jest.fn().mockResolvedValue(undefined);
  const config = { get: jest.fn().mockReturnValue({ daily: statusUrl ? { statusUrl } : {} }) };
  const service = new DailyHealthSignalService(
    cache as never,
    { log } as never,
    config as never,
    http as never
  );
  return { service, log };
}

describe('resolveDailyStatusSummaryUrl', () => {
  it('maps the status page to its JSON summary at the site root', () => {
    expect(resolveDailyStatusSummaryUrl('https://status.daily.co/')).toBe(
      'https://status.daily.co/api/v2/summary.json'
    );
    expect(resolveDailyStatusSummaryUrl('https://status.daily.co')).toBe(
      'https://status.daily.co/api/v2/summary.json'
    );
    expect(resolveDailyStatusSummaryUrl('https://status.daily.co/history')).toBe(
      'https://status.daily.co/api/v2/summary.json'
    );
  });

  it('keeps a URL that already points at a JSON file', () => {
    const url = 'https://status.example.com/api/v2/summary.json';
    expect(resolveDailyStatusSummaryUrl(url)).toBe(url);
  });

  it('throws on a malformed URL', () => {
    expect(() => resolveDailyStatusSummaryUrl('not a url')).toThrow();
  });
});

describe('evaluateDailyStatusSummary', () => {
  it('is healthy when every component is operational', () => {
    const result = evaluateDailyStatusSummary(summary());
    expect(result.state).toBe('healthy');
    expect(result.details['affectedComponents']).toEqual([]);
  });

  it('stays healthy during a recording-only incident and reports it', () => {
    const result = evaluateDailyStatusSummary(
      summary({ 'Recording/Live Streaming': 'degraded_performance', 'SIP/PSTN': 'major_outage' })
    );
    expect(result.state).toBe('healthy');
    expect(result.details['affectedComponents']).toEqual([
      { name: 'Recording/Live Streaming', status: 'degraded_performance' },
      { name: 'SIP/PSTN', status: 'major_outage' },
    ]);
    expect(result.details['callOutages']).toBeUndefined();
  });

  it('stays healthy when a call component is only degraded', () => {
    expect(
      evaluateDailyStatusSummary(summary({ 'Core Call Experience': 'degraded_performance' })).state
    ).toBe('healthy');
  });

  it.each(['partial_outage', 'major_outage'] as const)(
    'is unhealthy when Core Call Experience has a %s',
    status => {
      const result = evaluateDailyStatusSummary(summary({ 'Core Call Experience': status }));
      expect(result.state).toBe('unhealthy');
      expect(result.details['callOutages']).toEqual([{ name: 'Core Call Experience', status }]);
    }
  );

  it('is unhealthy when the API has a major outage', () => {
    expect(evaluateDailyStatusSummary(summary({ API: 'major_outage' })).state).toBe('unhealthy');
  });

  it('is unknown when the summary is malformed or no longer lists the call components', () => {
    expect(evaluateDailyStatusSummary(null).state).toBe('unknown');
    expect(evaluateDailyStatusSummary({ components: 'nope' }).state).toBe('unknown');
    expect(
      evaluateDailyStatusSummary({
        components: [{ name: 'Something Else', status: 'major_outage', group: false }],
      }).state
    ).toBe('unknown');
  });
});

describe('DailyHealthSignalService.isHealthy (status page)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('reads the JSON summary through HttpService and treats a recording-only incident as healthy', async () => {
    const http = httpReturning(summary({ 'Recording/Live Streaming': 'degraded_performance' }));
    const { service } = makeService(http);

    await expect(service.isHealthy()).resolves.toBe(true);
    expect(http.get).toHaveBeenCalledWith(
      'https://status.daily.co/api/v2/summary.json',
      expect.objectContaining({
        headers: { accept: 'application/json' },
        timeout: 5000,
        retries: 0,
      })
    );
    const signal = await service.getSignal();
    expect(signal?.source).toBe('status-page');
    expect(signal?.details?.['affectedComponents']).toEqual([
      { name: 'Recording/Live Streaming', status: 'degraded_performance' },
    ]);
  });

  it('reports unhealthy on a call outage, then notices the recovery after the short TTL', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-25T18:00:00Z'), doNotFake: ['nextTick'] });
    const http = httpReturning(summary({ 'Core Call Experience': 'major_outage' }));
    const { service } = makeService(http);

    await expect(service.isHealthy()).resolves.toBe(false);

    http.get.mockResolvedValue({ data: summary(), status: 200 });
    // Still inside the 5-minute status-page window: the cached verdict is reused.
    jest.setSystemTime(new Date('2026-11-25T18:04:00Z'));
    await expect(service.isHealthy()).resolves.toBe(false);
    expect(http.get).toHaveBeenCalledTimes(1);

    jest.setSystemTime(new Date('2026-11-25T18:06:00Z'));
    await expect(service.isHealthy()).resolves.toBe(true);
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('returns null when the status page cannot be read, without throwing', async () => {
    const { service, log } = makeService(httpFailing('timeout of 5000ms exceeded'));

    await expect(service.isHealthy()).resolves.toBeNull();
    expect(log).toHaveBeenCalled();
  });

  it('remembers a failed read for a minute instead of refetching on every call', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-25T18:00:00Z'), doNotFake: ['nextTick'] });
    const http = httpFailing('503 Service Unavailable');
    const { service } = makeService(http);

    await expect(service.isHealthy()).resolves.toBeNull();
    jest.setSystemTime(new Date('2026-11-25T18:00:50Z'));
    await expect(service.isHealthy()).resolves.toBeNull();
    expect(http.get).toHaveBeenCalledTimes(1);

    http.get.mockResolvedValue({ data: summary(), status: 200 });
    jest.setSystemTime(new Date('2026-11-25T18:01:05Z'));
    await expect(service.isHealthy()).resolves.toBe(true);
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('returns null for a malformed configured URL instead of throwing', async () => {
    const http = httpReturning(summary());
    const { service } = makeService(http, undefined, 'not a url');

    await expect(service.isHealthy()).resolves.toBeNull();
    expect(http.get).not.toHaveBeenCalled();
  });

  it('does not refetch the page on every call while the reading is unknown', async () => {
    const http = httpReturning({ components: [] });
    const { service } = makeService(http);

    await expect(service.isHealthy()).resolves.toBeNull();
    await expect(service.isHealthy()).resolves.toBeNull();
    expect(http.get).toHaveBeenCalledTimes(1);
  });
});

describe('DailyHealthSignalService signal shared through the cache', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  function cacheHolding(signal: DailyHealthSignal): { get: jest.Mock; set: jest.Mock } {
    return { get: jest.fn().mockResolvedValue(signal), set: jest.fn().mockResolvedValue(true) };
  }

  it('expires a restored signal relative to when it was recorded, not when it was read', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-25T18:04:00Z'), doNotFake: ['nextTick'] });
    const recorded: DailyHealthSignal = {
      state: 'unhealthy',
      source: 'status-page',
      lastUpdatedAt: '2026-11-25T18:00:00.000Z',
    };
    const http = httpReturning(summary());
    const { service } = makeService(http, cacheHolding(recorded));

    // Recorded 4 minutes ago with a 5-minute TTL: still valid.
    await expect(service.isHealthy()).resolves.toBe(false);
    expect(http.get).not.toHaveBeenCalled();

    // 6 minutes after it was recorded it has expired, even though this replica read it at 4.
    jest.setSystemTime(new Date('2026-11-25T18:06:00Z'));
    await expect(service.isHealthy()).resolves.toBe(true);
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('ignores a restored signal that is already past its TTL', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-25T18:10:00Z'), doNotFake: ['nextTick'] });
    const stale: DailyHealthSignal = {
      state: 'unhealthy',
      source: 'status-page',
      lastUpdatedAt: '2026-11-25T18:00:00.000Z',
    };
    const http = httpReturning(summary());
    const { service } = makeService(http, cacheHolding(stale));

    await expect(service.isHealthy()).resolves.toBe(true);
    expect(http.get).toHaveBeenCalledTimes(1);
  });
});
