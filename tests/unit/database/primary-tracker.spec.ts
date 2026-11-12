/// <reference types="jest" />
/**
 * The app used to resolve the pg_auto_failover primary only at boot, so after a failover a
 * running process kept sending writes to the demoted node until something restarted it (the
 * Nov 11 silent write outage). primary-tracker.ts keeps polling the monitor and points every
 * new pooled connection at the current primary.
 */

jest.mock('@infrastructure/database/prisma/monitor-client.util', () => {
  const actual = jest.requireActual('@infrastructure/database/prisma/monitor-client.util');
  return { ...actual, queryMonitor: jest.fn() };
});

import { queryMonitor } from '@infrastructure/database/prisma/monitor-client.util';
import {
  CURRENT_PRIMARY_QUERY,
  PRIMARY_POLL_INTERVAL_MS,
  PrimaryFollowingClient,
  getCurrentPrimary,
  refreshCurrentPrimary,
  setCurrentPrimary,
  startPrimaryTracking,
  stopPrimaryTracking,
} from '@infrastructure/database/prisma/primary-tracker';
import { resolvePrimaryAtBoot } from '@infrastructure/database/prisma/resolve-primary-at-boot';

const MONITOR = 'postgres://autoctl_node@10.201.0.1:6260/pg_auto_failover';
const URL_AT_OLD = 'postgresql://app:secret@10.201.0.1:6263/userdb?application_name=api';
const queryMonitorMock = queryMonitor as jest.MockedFunction<typeof queryMonitor>;

function monitorReports(host: string | null, port = 6261): void {
  queryMonitorMock.mockResolvedValue(host ? [{ nodehost: host, nodeport: port }] : []);
}

/** The connection string pg will actually use for this client. */
function connectionTargetOf(client: PrimaryFollowingClient): string {
  return `${client.host}:${client.port}`;
}

beforeEach(() => {
  queryMonitorMock.mockReset();
  stopPrimaryTracking();
  setCurrentPrimary({ host: '10.201.0.1', port: 6263 });
});

afterAll(() => stopPrimaryTracking());

describe('primary tracking', () => {
  it('asks the monitor with the shared writable-state query', async () => {
    monitorReports('10.201.0.1', 6263);

    await refreshCurrentPrimary(MONITOR);

    expect(queryMonitorMock).toHaveBeenCalledWith(MONITOR, CURRENT_PRIMARY_QUERY);
    expect(CURRENT_PRIMARY_QUERY).toContain("'wait_primary'");
  });

  it('reports a change only when the primary actually moved', async () => {
    monitorReports('10.201.0.1', 6263);
    await expect(refreshCurrentPrimary(MONITOR)).resolves.toBeNull();

    monitorReports('10.201.0.5', 6261);
    await expect(refreshCurrentPrimary(MONITOR)).resolves.toEqual({
      host: '10.201.0.5',
      port: 6261,
    });
    expect(getCurrentPrimary()).toEqual({ host: '10.201.0.5', port: 6261 });
  });

  it('keeps the last known primary while the monitor reports none (mid-failover)', async () => {
    monitorReports(null);

    await expect(refreshCurrentPrimary(MONITOR)).resolves.toBeNull();
    expect(getCurrentPrimary()).toEqual({ host: '10.201.0.1', port: 6263 });
  });

  it('polls on an interval, reports a move once, and passes monitor errors to onError', async () => {
    jest.useFakeTimers();
    try {
      const onChange = jest.fn();
      const onError = jest.fn();
      startPrimaryTracking(MONITOR, onChange, onError);
      startPrimaryTracking(MONITOR, onChange, onError); // idempotent: still one timer

      monitorReports('10.201.0.5', 6261);
      await jest.advanceTimersByTimeAsync(PRIMARY_POLL_INTERVAL_MS);
      await jest.advanceTimersByTimeAsync(PRIMARY_POLL_INTERVAL_MS);
      expect(queryMonitorMock).toHaveBeenCalledTimes(2);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({ host: '10.201.0.5', port: 6261 });

      queryMonitorMock.mockRejectedValue(new Error('monitor unreachable'));
      await jest.advanceTimersByTimeAsync(PRIMARY_POLL_INTERVAL_MS);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'monitor unreachable' })
      );
      expect(getCurrentPrimary()).toEqual({ host: '10.201.0.5', port: 6261 });
    } finally {
      stopPrimaryTracking();
      jest.useRealTimers();
    }
  });
});

describe('PrimaryFollowingClient', () => {
  it('connects new pooled connections to the current primary, keeping credentials and params', () => {
    setCurrentPrimary({ host: '10.201.0.5', port: 6261 });

    const client = new PrimaryFollowingClient({ connectionString: URL_AT_OLD, max: 5 } as never);

    expect(connectionTargetOf(client)).toBe('10.201.0.5:6261');
    expect(client.user).toBe('app');
    expect(client.database).toBe('userdb');
  });

  it('follows a primary that moved after earlier clients were created', () => {
    const before = new PrimaryFollowingClient({ connectionString: URL_AT_OLD });
    setCurrentPrimary({ host: '10.201.0.7', port: 6262 });
    const after = new PrimaryFollowingClient({ connectionString: URL_AT_OLD });

    expect(connectionTargetOf(before)).toBe('10.201.0.1:6263');
    expect(connectionTargetOf(after)).toBe('10.201.0.7:6262');
  });
});

describe('resolvePrimaryAtBoot seeds the tracker', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('records the boot-time primary so new connections start there', async () => {
    process.env['MONITOR_URI'] = MONITOR;
    process.env['DATABASE_URL'] = URL_AT_OLD;
    monitorReports('10.201.0.5', 6261);

    await resolvePrimaryAtBoot();

    expect(getCurrentPrimary()).toEqual({ host: '10.201.0.5', port: 6261 });
    expect(process.env['DATABASE_URL']).toContain('@10.201.0.5:6261/');
  });
});
