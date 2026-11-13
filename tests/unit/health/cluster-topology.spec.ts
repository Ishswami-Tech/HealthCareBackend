/// <reference types="jest" />
/**
 * The dashboard's Database and Cache cluster tables. In the 2026-11-12 failover drill the
 * Database table kept showing the dead node as "primary" (it printed the member's last
 * REPORTED state) and contabo-ds as a bare IP, and there was no Cache table at all.
 *
 * The health endpoints are public, so the tables name each server but never carry its internal
 * mesh address or port.
 */

jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));
jest.mock('@config/config.service', () => ({ ConfigService: class ConfigService {} }));
jest.mock('@infrastructure/database/prisma/monitor-client.util', () => ({
  ...jest.requireActual('@infrastructure/database/prisma/monitor-client.util'),
  queryMonitor: jest.fn(),
}));

const sentinelReplies: Record<string, unknown> = {};
const sentinelConnect = jest.fn();
jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    connect: sentinelConnect,
    call: jest.fn(async (_cmd: string, sub: string) => sentinelReplies[sub]),
    disconnect: jest.fn(),
  }))
);

import { queryMonitor } from '@infrastructure/database/prisma/monitor-client.util';
import { PostgresClusterTopologyService } from '@services/health/postgres-cluster-topology.service';
import { DragonflyClusterTopologyService } from '@services/health/dragonfly-cluster-topology.service';

const queryMonitorMock = queryMonitor as jest.MockedFunction<typeof queryMonitor>;

/** A ConfigService double backed by a plain map. */
function configWith(env: Record<string, string>) {
  return { getEnv: (key: string): string | undefined => env[key] } as never;
}

function postgresService(env: Record<string, string>): PostgresClusterTopologyService {
  return new PostgresClusterTopologyService(configWith(env));
}

function dragonflyService(env: Record<string, string>): DragonflyClusterTopologyService {
  return new DragonflyClusterTopologyService(configWith(env));
}

const MONITOR_ENV = { MONITOR_URI: 'postgres://autoctl_node@10.201.0.1:6260/pg_auto_failover' };
const SENTINEL_ENV = { CACHE_SENTINELS: '10.201.0.1:6579' };

afterEach(() => {
  jest.clearAllMocks();
  sentinelConnect.mockReset();
});

describe('Database cluster table', () => {
  it('shows the monitor decision, flags the dead member and names every server', async () => {
    queryMonitorMock.mockResolvedValue([
      // mid-failover: the isolated old primary still REPORTS primary, but is demoted and down
      {
        nodeid: '11',
        nodename: 'main-1',
        nodehost: '10.201.0.5',
        reportedstate: 'primary',
        goalstate: 'demoted',
        health: 0,
      },
      {
        nodeid: '12',
        nodename: 'main-2',
        nodehost: '10.201.0.7',
        reportedstate: 'wait_primary',
        goalstate: 'wait_primary',
        health: 1,
      },
    ] as never);

    const { nodes, source } = await postgresService(MONITOR_ENV).getTopology();

    expect(source).toBe('live');
    expect(nodes).toEqual([
      {
        nodeId: 11,
        nodeName: 'main-1',
        serverName: 'temps-worker-ubuntu',
        state: 'demoted',
        reportedState: 'primary',
        healthy: false,
      },
      {
        nodeId: 12,
        nodeName: 'main-2',
        serverName: 'contabo-ds',
        state: 'wait_primary',
        reportedState: 'wait_primary',
        healthy: true,
      },
    ]);
    expect(JSON.stringify(nodes)).not.toContain('10.201.');
  });

  it('shows a member the monitor has not checked yet (health -1) as unknown, not down', async () => {
    queryMonitorMock.mockResolvedValue([
      {
        nodeid: '11',
        nodename: 'main-1',
        nodehost: '10.201.0.5',
        reportedstate: 'primary',
        goalstate: 'primary',
        health: -1,
      },
    ] as never);

    const { nodes } = await postgresService(MONITOR_ENV).getTopology();

    expect(nodes[0]?.healthy).toBeNull();
  });

  it("reads only the app's own formation", async () => {
    queryMonitorMock.mockResolvedValue([] as never);

    await postgresService(MONITOR_ENV).getTopology();

    expect(queryMonitorMock.mock.calls[0]?.[1]).toContain(
      "WHERE formationid = 'default' AND groupid = 0"
    );
  });

  it('is unavailable without MONITOR_URI in config', async () => {
    await expect(postgresService({}).getTopology()).resolves.toEqual({
      nodes: [],
      source: 'unavailable',
    });
    expect(queryMonitorMock).not.toHaveBeenCalled();
  });
});

describe('Cache cluster table', () => {
  function sentinelSees(master: string[], replicas: string[][]): void {
    sentinelReplies['MASTER'] = master;
    sentinelReplies['REPLICAS'] = replicas;
  }

  it('lists the Sentinel primary and replicas with server names and health, no addresses', async () => {
    sentinelSees(
      ['name', 'dragonfly', 'ip', '10.201.0.5', 'port', '6512', 'flags', 'master'],
      [
        ['ip', '10.201.0.7', 'port', '6512', 'flags', 'slave', 'master-link-status', 'ok'],
        ['ip', '10.201.0.1', 'port', '6512', 'flags', 'slave', 'master-link-status', 'err'],
      ]
    );

    const topology = await dragonflyService(SENTINEL_ENV).getTopology();

    expect(topology).toEqual({
      masterName: 'dragonfly',
      source: 'live',
      nodes: [
        { role: 'primary', serverName: 'temps-worker-ubuntu', healthy: true },
        { role: 'replica', serverName: 'contabo-ds', healthy: true },
        { role: 'replica', serverName: 'contabo-healthcare', healthy: false },
      ],
    });
  });

  it('hides a stale down entry when the same host is also listed healthy', async () => {
    sentinelSees(
      ['ip', '10.201.0.5', 'port', '6512', 'flags', 'master'],
      [
        [
          'ip',
          '10.201.0.1',
          'port',
          '6379',
          'flags',
          's_down,slave,disconnected',
          'master-link-status',
          'err',
        ],
        ['ip', '10.201.0.1', 'port', '6512', 'flags', 'slave', 'master-link-status', 'ok'],
      ]
    );

    const { nodes } = await dragonflyService(SENTINEL_ENV).getTopology();

    expect(nodes.filter(node => node.serverName === 'contabo-healthcare')).toEqual([
      { role: 'replica', serverName: 'contabo-healthcare', healthy: true },
    ]);
  });

  it('is unavailable without Sentinel configured, and never connects', async () => {
    await expect(dragonflyService({}).getTopology()).resolves.toEqual({
      masterName: 'dragonfly',
      nodes: [],
      source: 'unavailable',
    });
    expect(sentinelConnect).not.toHaveBeenCalled();
  });

  it('does not retry an unreachable Sentinel (and wait out its timeout) on every request', async () => {
    sentinelConnect.mockRejectedValue(new Error('connect ETIMEDOUT'));
    const service = dragonflyService(SENTINEL_ENV);

    await expect(service.getTopology()).resolves.toMatchObject({ source: 'unavailable' });
    await expect(service.getTopology()).resolves.toMatchObject({ source: 'unavailable' });

    expect(sentinelConnect).toHaveBeenCalledTimes(1);
  });
});
