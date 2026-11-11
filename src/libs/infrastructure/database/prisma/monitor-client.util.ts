/**
 * Shared pg_auto_failover monitor query helper.
 *
 * Connects to the monitor at the given URI, runs one query, and disconnects —
 * used by both resolve-primary-at-boot.ts (find the current primary) and
 * local-replica-resolver.ts (find this host's own cluster member). This is
 * the only place that knows how to talk to the monitor; it owns none of the
 * fallback policy. It throws on any connection or query failure rather than
 * swallowing it, so each caller's own try/catch decides what "couldn't
 * resolve" means for it — see the two resolvers' module docs.
 */

import { Client, type QueryResultRow } from 'pg';

// Matches local-replica-resolver.ts's pre-refactor CONNECT_TIMEOUT_MS exactly —
// this extraction must not change that resolver's existing timeout behavior.
export const MONITOR_QUERY_TIMEOUT_MS = 2000;

/** The one row shape every current caller selects: a cluster member's host and port. */
export interface MonitorNodeRow extends QueryResultRow {
  nodehost: string;
  nodeport: number;
}

export async function queryMonitor<T extends QueryResultRow = MonitorNodeRow>(
  monitorUri: string,
  sql: string
): Promise<T[]> {
  const client = new Client({
    connectionString: monitorUri,
    connectionTimeoutMillis: MONITOR_QUERY_TIMEOUT_MS,
    query_timeout: MONITOR_QUERY_TIMEOUT_MS,
    // The monitor uses pg_autoctl's self-signed cert (--ssl-self-signed) - there's no CA to
    // verify it against, same as the HA cluster nodes themselves; sslmode=require without
    // verification is what pg_autoctl's own tooling expects here too.
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    const result = await client.query<T>(sql);
    return result.rows;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Rewrites a connection string's host/port, keeping everything else (user,
 * password, database, query params) unchanged.
 */
export function withResolvedHost(databaseUrl: string, host: string, port: number): string {
  const url = new URL(databaseUrl);
  url.hostname = host;
  url.port = String(port);
  return url.toString();
}
