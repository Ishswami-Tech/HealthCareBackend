import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { queryMonitor } from '@infrastructure/database/prisma/monitor-client.util';
import { resolveServerName } from './cluster-server-names';

export interface DatabaseClusterNode {
  nodeId: number;
  nodeName: string;
  serverName: string;
  host: string;
  port: number;
  /** The role the HA monitor has decided for this member (its goal state). */
  state: string;
  /** What the member itself last reported; differs from `state` mid-transition or when it is down. */
  reportedState: string;
  /** False when the monitor's health checks fail for this member (down or unreachable). */
  healthy: boolean;
}

export interface DatabaseClusterTopology {
  nodes: DatabaseClusterNode[];
  source: 'live' | 'unavailable';
}

/**
 * Live primary/secondary topology of the Postgres HA cluster (pg_auto_failover), read
 * on-demand for the dashboard - not a background poller, so it adds no steady-state load
 * or noise. A short in-memory cache keeps repeated dashboard refreshes from re-querying the
 * monitor every time; MONITOR_URI being unset (most replicas don't have it) degrades to
 * 'unavailable' rather than breaking the rest of the dashboard.
 */
interface ClusterTopologyRow {
  nodeid: string;
  nodename: string;
  nodehost: string;
  nodeport: number;
  reportedstate: string;
  goalstate: string;
  health: number;
}

@Injectable()
export class PostgresClusterTopologyService {
  private static readonly CACHE_TTL_MS = 20000;
  private cached: { nodes: DatabaseClusterNode[]; timestamp: number } | null = null;

  constructor(
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService
  ) {}

  async getTopology(): Promise<DatabaseClusterTopology> {
    if (
      this.cached &&
      Date.now() - this.cached.timestamp < PostgresClusterTopologyService.CACHE_TTL_MS
    ) {
      return { nodes: this.cached.nodes, source: 'live' };
    }

    const monitorUri = process.env['MONITOR_URI'];
    if (!monitorUri) {
      return { nodes: this.cached?.nodes ?? [], source: 'unavailable' };
    }

    try {
      // nodeid is bigint in Postgres - node-postgres returns bigint columns as strings by
      // default (to avoid silent precision loss), not numbers.
      const rows = await queryMonitor<ClusterTopologyRow>(
        monitorUri,
        'SELECT nodeid, nodename, nodehost, nodeport, reportedstate, goalstate, health FROM pgautofailover.node ORDER BY nodeid'
      );

      const nodes: DatabaseClusterNode[] = rows.map(row => ({
        nodeId: Number(row.nodeid),
        nodeName: row.nodename,
        serverName: resolveServerName(row.nodehost),
        host: row.nodehost,
        port: row.nodeport,
        // The goal state, not the reported one: a member that has died keeps reporting its
        // last state ('primary') while the monitor has already demoted it.
        state: row.goalstate,
        reportedState: row.reportedstate,
        healthy: Number(row.health) === 1,
      }));

      this.cached = { nodes, timestamp: Date.now() };
      return { nodes, source: 'live' };
    } catch (error) {
      void this.loggingService?.log(
        LogType.DATABASE,
        LogLevel.WARN,
        'Failed to read database cluster topology from the HA monitor',
        'PostgresClusterTopologyService',
        { error: error instanceof Error ? error.message : String(error) }
      );
      // Serve the last known-good snapshot rather than blanking the dashboard on one
      // transient monitor hiccup - same trade-off the app-replica topology view makes.
      return { nodes: this.cached?.nodes ?? [], source: this.cached ? 'live' : 'unavailable' };
    }
  }
}
