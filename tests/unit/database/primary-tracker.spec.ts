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
  closeConnectionsNotTo,
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

  it("selects by the monitor's goal state, not a dead node's last reported state", () => {
    // A node that loses its network keeps reportedstate 'primary' while the monitor sets its
    // goalstate to 'demoted' - the 2026-11-12 drill picked the dead node until this changed.
    expect(CURRENT_PRIMARY_QUERY).toMatch(/AND goalstate IN \(/);
    expect(CURRENT_PRIMARY_QUERY).not.toMatch(/reportedstate/);
  });

  it("only considers the app's own formation, so another formation's primary is never picked", () => {
    expect(CURRENT_PRIMARY_QUERY).toContain("WHERE formationid = 'default' AND groupid = 0");
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

  it('polls on an interval, reports a move once, and reports a monitor outage once', async () => {
    jest.useFakeTimers();
    try {
      const handlers = { onChange: jest.fn(), onError: jest.fn(), onRecovered: jest.fn() };
      startPrimaryTracking(MONITOR, handlers);
      startPrimaryTracking(MONITOR, handlers); // idempotent: still one timer

      monitorReports('10.201.0.5', 6261);
      await jest.advanceTimersByTimeAsync(PRIMARY_POLL_INTERVAL_MS);
      await jest.advanceTimersByTimeAsync(PRIMARY_POLL_INTERVAL_MS);
      expect(queryMonitorMock).toHaveBeenCalledTimes(2);
      expect(handlers.onChange).toHaveBeenCalledTimes(1);
      expect(handlers.onChange).toHaveBeenCalledWith(
        { host: '10.201.0.5', port: 6261 },
        expect.any(Number)
      );

      // Three failed polls in a row: one report, not one every 3s.
      queryMonitorMock.mockRejectedValue(new Error('monitor unreachable'));
      await jest.advanceTimersByTimeAsync(PRIMARY_POLL_INTERVAL_MS * 3);
      expect(handlers.onError).toHaveBeenCalledTimes(1);
      expect(handlers.onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'monitor unreachable' })
      );
      expect(getCurrentPrimary()).toEqual({ host: '10.201.0.5', port: 6261 });

      monitorReports('10.201.0.5', 6261);
      await jest.advanceTimersByTimeAsync(PRIMARY_POLL_INTERVAL_MS * 2);
      expect(handlers.onRecovered).toHaveBeenCalledTimes(1);

      // A second outage is reported again.
      queryMonitorMock.mockRejectedValue(new Error('monitor unreachable'));
      await jest.advanceTimersByTimeAsync(PRIMARY_POLL_INTERVAL_MS);
      expect(handlers.onError).toHaveBeenCalledTimes(2);
    } finally {
      stopPrimaryTracking();
      jest.useRealTimers();
    }
  });
});

describe('closing connections to a former primary', () => {
  it('destroys open connections to any other node and keeps those to the new primary', () => {
    setCurrentPrimary({ host: '10.201.0.5', port: 6261 });
    const toOldPrimary = new PrimaryFollowingClient({ connectionString: URL_AT_OLD });
    setCurrentPrimary({ host: '10.201.0.7', port: 6262 });
    const toNewPrimary = new PrimaryFollowingClient({ connectionString: URL_AT_OLD });
    const destroyOld = jest.spyOn(toOldPrimary.connection.stream, 'destroy');
    const destroyNew = jest.spyOn(toNewPrimary.connection.stream, 'destroy');

    const closed = closeConnectionsNotTo({ host: '10.201.0.7', port: 6262 });

    expect(closed).toBeGreaterThanOrEqual(1);
    expect(destroyOld).toHaveBeenCalled();
    expect(destroyNew).not.toHaveBeenCalled();
  });

  it('closes them as soon as the tracker sees the primary move', async () => {
    jest.useFakeTimers();
    try {
      setCurrentPrimary({ host: '10.201.0.5', port: 6261 });
      const stale = new PrimaryFollowingClient({ connectionString: URL_AT_OLD });
      const destroy = jest.spyOn(stale.connection.stream, 'destroy');
      const handlers = { onChange: jest.fn(), onError: jest.fn(), onRecovered: jest.fn() };
      startPrimaryTracking(MONITOR, handlers);

      monitorReports('10.201.0.7', 6262);
      await jest.advanceTimersByTimeAsync(PRIMARY_POLL_INTERVAL_MS);

      expect(destroy).toHaveBeenCalled();
      expect(handlers.onChange).toHaveBeenCalledWith(
        { host: '10.201.0.7', port: 6262 },
        expect.any(Number)
      );
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
