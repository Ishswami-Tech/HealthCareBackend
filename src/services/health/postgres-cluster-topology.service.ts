import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { LoggingService } from '@infrastructure/logging';
import {
  LogType,
  LogLevel,
  type DatabaseClusterNode,
  type DatabaseClusterTopology,
} from '@core/types';
import {
  MONITOR_NODE_FILTER,
  queryMonitor,
} from '@infrastructure/database/prisma/monitor-client.util';
import { resolveServerName } from '@services/health/cluster-server-names';

/** pg_auto_failover's node health: -1 not checked yet, 0 bad, 1 good. */
function toHealthy(health: number): boolean | null {
  const value = Number(health);
  return value === 1 ? true : value === 0 ? false : null;
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
    @Inject(forwardRef(() => ConfigService))
    private readonly configService?: ConfigService,
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

    const monitorUri = this.configService?.getEnv('MONITOR_URI');
    if (!monitorUri) {
      return { nodes: this.cached?.nodes ?? [], source: 'unavailable' };
    }

    try {
      // nodeid is bigint in Postgres - node-postgres returns bigint columns as strings by
      // default (to avoid silent precision loss), not numbers.
      const rows = await queryMonitor<ClusterTopologyRow>(
        monitorUri,
        `SELECT nodeid, nodename, nodehost, reportedstate, goalstate, health FROM pgautofailover.node WHERE ${MONITOR_NODE_FILTER} ORDER BY nodeid`
      );

      const nodes: DatabaseClusterNode[] = rows.map(row => ({
        nodeId: Number(row.nodeid),
        nodeName: row.nodename,
        serverName: resolveServerName(row.nodehost),
        // The goal state, not the reported one: a member that has died keeps reporting its
        // last state ('primary') while the monitor has already demoted it.
        state: row.goalstate,
        reportedState: row.reportedstate,
        healthy: toHealthy(row.health),
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
