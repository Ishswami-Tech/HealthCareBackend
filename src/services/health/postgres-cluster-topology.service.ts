import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { Client } from 'pg';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

export interface DatabaseClusterNode {
  nodeId: number;
  nodeName: string;
  serverName: string;
  host: string;
  port: number;
  state: string;
}

export interface DatabaseClusterTopology {
  nodes: DatabaseClusterNode[];
  source: 'live' | 'unavailable';
}

/**
 * Maps the pg_auto_failover mesh IPs (10.201.0.0/16) to the human-readable server names
 * they run on. There is no live discovery for this - these are internal WireGuard mesh
 * addresses the app has no other way to resolve to a friendly name - so it's a short,
 * hand-maintained table. Update it if a node moves to a different physical host.
 */
const SERVER_NAME_BY_HOST: Readonly<Record<string, string>> = {
  '10.201.0.1': 'contabo-healthcare',
  '10.201.0.2': 'oracle-main',
  '10.201.0.5': 'temps-worker',
  '10.201.0.6': 'temps-control-plane',
};

function resolveServerName(host: string): string {
  return SERVER_NAME_BY_HOST[host] ?? host;
}

/**
 * Live primary/secondary topology of the Postgres HA cluster (pg_auto_failover), read
 * on-demand for the dashboard - not a background poller, so it adds no steady-state load
 * or noise. A short in-memory cache keeps repeated dashboard refreshes from re-querying the
 * monitor every time; MONITOR_URI being unset (most replicas don't have it) degrades to
 * 'unavailable' rather than breaking the rest of the dashboard.
 */
@Injectable()
export class PostgresClusterTopologyService {
  private static readonly CACHE_TTL_MS = 20000;
  private static readonly CONNECT_TIMEOUT_MS = 3000;
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

    const client = new Client({
      connectionString: monitorUri,
      connectionTimeoutMillis: PostgresClusterTopologyService.CONNECT_TIMEOUT_MS,
      query_timeout: PostgresClusterTopologyService.CONNECT_TIMEOUT_MS,
      // The monitor uses pg_autoctl's self-signed cert (--ssl-self-signed) - there's no CA to
      // verify it against, same as the HA cluster nodes themselves; sslmode=require without
      // verification is what pg_autoctl's own tooling expects here too.
      ssl: { rejectUnauthorized: false },
    });

    try {
      await client.connect();
      // nodeid is bigint in Postgres - node-postgres returns bigint columns as strings by
      // default (to avoid silent precision loss), not numbers.
      const result = await client.query<{
        nodeid: string;
        nodename: string;
        nodehost: string;
        nodeport: number;
        reportedstate: string;
      }>(
        'SELECT nodeid, nodename, nodehost, nodeport, reportedstate FROM pgautofailover.node ORDER BY nodeid'
      );

      const nodes: DatabaseClusterNode[] = result.rows.map(row => ({
        nodeId: Number(row.nodeid),
        nodeName: row.nodename,
        serverName: resolveServerName(row.nodehost),
        host: row.nodehost,
        port: row.nodeport,
        state: row.reportedstate,
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
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}
