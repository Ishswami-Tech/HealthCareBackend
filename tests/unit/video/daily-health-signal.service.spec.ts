/// <reference types="jest" />
/**
 * Unit tests for DailyHealthSignalService's status-page check.
 *
 * Daily publishes a Statuspage.io summary. Only an outage of the components needed to join a call
 * ("API", "Core Call Experience") may mark the provider unhealthy: when it does, the video factory
 * fails over to another provider and `/health` reports video as unavailable. A recording-only
 * incident (as on 2026-11-25, "Issues starting recordings") must leave Daily healthy.
 *
 * fetch is mocked; nothing here touches the network, the cache or the real configuration.
 */

import {
  DailyHealthSignalService,
  evaluateDailyStatusSummary,
  resolveDailyStatusSummaryUrl,
} from '@services/video/services/daily-health-signal.service';

// Only needed as injection tokens; replacing them keeps heavy module graphs out of this test.
jest.mock('@infrastructure/cache/cache.service', () => ({ CacheService: class CacheService {} }));
jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));
jest.mock('@config/config.service', () => ({ ConfigService: class ConfigService {} }));

type ComponentStatus =
  'operational' | 'degraded_performance' | 'partial_outage' | 'major_outage' | 'under_maintenance';

function summary(overrides: Partial<Record<string, ComponentStatus>> = {}) {
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
      status,
      group: false,
    })),
  };
}

function mockFetchJson(body: unknown, ok = true): jest.Mock {
  const fetchMock = jest.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 503,
    json: () => Promise.resolve(body),
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('resolveDailyStatusSummaryUrl', () => {
  it('maps the status page root to its JSON summary', () => {
    expect(resolveDailyStatusSummaryUrl('https://status.daily.co/')).toBe(
      'https://status.daily.co/api/v2/summary.json'
    );
    expect(resolveDailyStatusSummaryUrl('https://status.daily.co')).toBe(
      'https://status.daily.co/api/v2/summary.json'
    );
  });

  it('keeps a URL that already points at a JSON file', () => {
    const url = 'https://status.example.com/api/v2/summary.json';
    expect(resolveDailyStatusSummaryUrl(url)).toBe(url);
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
  const originalFetch = global.fetch;
  let logging: { log: jest.Mock };

  function makeService(): DailyHealthSignalService {
    logging = { log: jest.fn().mockResolvedValue(undefined) };
    const config = { get: jest.fn().mockReturnValue({ daily: {} }) };
    return new DailyHealthSignalService(undefined, logging as never, config as never);
  }

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it('reads the JSON summary and treats a recording-only incident as healthy', async () => {
    const fetchMock = mockFetchJson(
      summary({ 'Recording/Live Streaming': 'degraded_performance' })
    );
    const service = makeService();

    await expect(service.isHealthy()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://status.daily.co/api/v2/summary.json',
      expect.objectContaining({ headers: { accept: 'application/json' } })
    );
    const signal = await service.getSignal();
    expect(signal?.source).toBe('status-page');
    expect(signal?.details?.['affectedComponents']).toEqual([
      { name: 'Recording/Live Streaming', status: 'degraded_performance' },
    ]);
  });

  it('reports unhealthy on a call outage, then notices the recovery after the short TTL', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-25T18:00:00Z'), doNotFake: ['nextTick'] });
    mockFetchJson(summary({ 'Core Call Experience': 'major_outage' }));
    const service = makeService();

    await expect(service.isHealthy()).resolves.toBe(false);

    const fetchMock = mockFetchJson(summary());
    // Still inside the 5-minute status-page window: the cached verdict is reused.
    jest.setSystemTime(new Date('2026-11-25T18:04:00Z'));
    await expect(service.isHealthy()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    jest.setSystemTime(new Date('2026-11-25T18:06:00Z'));
    await expect(service.isHealthy()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null when the status page cannot be read, without throwing', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout')) as unknown as typeof fetch;
    const service = makeService();

    await expect(service.isHealthy()).resolves.toBeNull();
    expect(logging.log).toHaveBeenCalled();
  });

  it('returns null on a non-OK response', async () => {
    mockFetchJson({}, false);
    await expect(makeService().isHealthy()).resolves.toBeNull();
  });

  it('does not refetch the page on every call while the reading is unknown', async () => {
    const fetchMock = mockFetchJson({ components: [] });
    const service = makeService();

    await expect(service.isHealthy()).resolves.toBeNull();
    await expect(service.isHealthy()).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
