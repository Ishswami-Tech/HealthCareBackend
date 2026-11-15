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

/**
 * Restricts a pgautofailover.node query to the app's own cluster: pg_autoctl's default formation,
 * group 0. A monitor can host more than one formation; without this a query could pick another
 * formation's primary and send healthcare writes to the wrong database.
 */
export const MONITOR_NODE_FILTER = "formationid = 'default' AND groupid = 0";

/** The one row shape every current caller selects: a cluster member's host and port. */
export interface MonitorNodeRow extends QueryResultRow {
  nodehost: string;
  nodeport: number;
}

function newMonitorClient(monitorUri: string): Client {
  return new Client({
    connectionString: monitorUri,
    connectionTimeoutMillis: MONITOR_QUERY_TIMEOUT_MS,
    query_timeout: MONITOR_QUERY_TIMEOUT_MS,
    // The monitor uses pg_autoctl's self-signed cert (--ssl-self-signed) - there's no CA to
    // verify it against, same as the HA cluster nodes themselves; sslmode=require without
    // verification is what pg_autoctl's own tooling expects here too.
    ssl: { rejectUnauthorized: false },
  });
}

export async function queryMonitor<T extends QueryResultRow = MonitorNodeRow>(
  monitorUri: string,
  sql: string
): Promise<T[]> {
  const client = newMonitorClient(monitorUri);

  try {
    await client.connect();
    const result = await client.query<T>(sql);
    return result.rows;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * One open monitor connection per URI, for callers that ask every few seconds (the primary
 * tracker). Opening a fresh TLS + SCRAM connection costs several round trips: ~0.8 s of a 2 s
 * budget from India to a monitor in Europe, every 3 s from every container, so any lost packet
 * timed the check out. A reused connection answers in one round trip.
 *
 * Any failure (connect, query, timeout, or the socket dying while idle) drops the connection, and
 * the next call opens a new one; the failure itself still reaches the caller.
 */
const monitorSessions = new Map<string, Client>();

function dropMonitorSession(monitorUri: string, client: Client): void {
  if (monitorSessions.get(monitorUri) === client) monitorSessions.delete(monitorUri);
  client.end().catch(() => undefined);
}

export async function queryMonitorReusingConnection<T extends QueryResultRow = MonitorNodeRow>(
  monitorUri: string,
  sql: string
): Promise<T[]> {
  let client = monitorSessions.get(monitorUri);
  if (!client) {
    const fresh = newMonitorClient(monitorUri);
    // An idle connection that dies emits 'error'; unhandled, it would crash the process.
    fresh.on('error', () => dropMonitorSession(monitorUri, fresh));
    fresh.on('end', () => {
      if (monitorSessions.get(monitorUri) === fresh) monitorSessions.delete(monitorUri);
    });
    try {
      await fresh.connect();
    } catch (error) {
      dropMonitorSession(monitorUri, fresh);
      throw error;
    }
    monitorSessions.set(monitorUri, fresh);
    client = fresh;
  }
  try {
    const result = await client.query<T>(sql);
    return result.rows;
  } catch (error) {
    dropMonitorSession(monitorUri, client);
    throw error;
  }
}

/** Closes every reused monitor connection (tracking stopped, or tests). */
export function closeMonitorSessions(): void {
  for (const [uri, client] of monitorSessions) dropMonitorSession(uri, client);
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
