/// <reference types="jest" />
/**
 * The dashboard's Database and Cache cluster tables. In the 2026-11-12 failover drill the
 * Database table kept showing the dead node as "primary" (it printed the member's last
 * REPORTED state) and contabo-ds as a bare IP, and there was no Cache table at all.
 */

jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));
jest.mock('@infrastructure/database/prisma/monitor-client.util', () => ({
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
const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
  jest.clearAllMocks();
});

describe('Database cluster table', () => {
  it('shows the monitor decision, flags the dead member and names every server', async () => {
    process.env['MONITOR_URI'] = 'postgres://autoctl_node@10.201.0.1:6260/pg_auto_failover';
    queryMonitorMock.mockResolvedValue([
      // mid-failover: the isolated old primary still REPORTS primary, but is demoted and down
      {
        nodeid: '11',
        nodename: 'main-1',
        nodehost: '10.201.0.5',
        nodeport: 6261,
        reportedstate: 'primary',
        goalstate: 'demoted',
        health: 0,
      },
      {
        nodeid: '12',
        nodename: 'main-2',
        nodehost: '10.201.0.7',
        nodeport: 6262,
        reportedstate: 'wait_primary',
        goalstate: 'wait_primary',
        health: 1,
      },
    ] as never);

    const { nodes, source } = await new PostgresClusterTopologyService().getTopology();

    expect(source).toBe('live');
    expect(nodes).toEqual([
      expect.objectContaining({
        serverName: 'temps-worker',
        state: 'demoted',
        reportedState: 'primary',
        healthy: false,
      }),
      expect.objectContaining({ serverName: 'contabo-ds', state: 'wait_primary', healthy: true }),
    ]);
  });
});

describe('Cache cluster table', () => {
  function sentinelSees(master: string[], replicas: string[][]): void {
    sentinelReplies['MASTER'] = master;
    sentinelReplies['REPLICAS'] = replicas;
  }

  it('lists the Sentinel primary and replicas with server names and health', async () => {
    process.env['CACHE_SENTINELS'] = '10.201.0.1:6579';
    sentinelSees(
      ['name', 'dragonfly', 'ip', '10.201.0.5', 'port', '6512', 'flags', 'master'],
      [
        ['ip', '10.201.0.7', 'port', '6512', 'flags', 'slave', 'master-link-status', 'ok'],
        ['ip', '10.201.0.1', 'port', '6512', 'flags', 'slave', 'master-link-status', 'err'],
      ]
    );

    const topology = await new DragonflyClusterTopologyService().getTopology();

    expect(topology).toEqual({
      masterName: 'dragonfly',
      source: 'live',
      nodes: [
        {
          role: 'primary',
          serverName: 'temps-worker',
          host: '10.201.0.5',
          port: 6512,
          healthy: true,
        },
        {
          role: 'replica',
          serverName: 'contabo-ds',
          host: '10.201.0.7',
          port: 6512,
          healthy: true,
        },
        {
          role: 'replica',
          serverName: 'contabo-healthcare',
          host: '10.201.0.1',
          port: 6512,
          healthy: false,
        },
      ],
    });
  });

  it('hides a stale down entry when the same host is also listed healthy', async () => {
    process.env['CACHE_SENTINELS'] = '10.201.0.1:6579';
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

    const { nodes } = await new DragonflyClusterTopologyService().getTopology();

    expect(nodes.filter(node => node.host === '10.201.0.1')).toEqual([
      expect.objectContaining({ port: 6512, healthy: true }),
    ]);
  });

  it('is unavailable without Sentinel configured, and never connects', async () => {
    delete process.env['CACHE_SENTINELS'];

    await expect(new DragonflyClusterTopologyService().getTopology()).resolves.toEqual({
      masterName: 'dragonfly',
      nodes: [],
      source: 'unavailable',
    });
    expect(sentinelConnect).not.toHaveBeenCalled();
  });
});
