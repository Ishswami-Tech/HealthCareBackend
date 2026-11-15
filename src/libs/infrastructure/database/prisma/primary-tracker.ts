/**
 * Primary Tracker (runtime)
 * =========================
 * Keeps following whichever pg_auto_failover member is the writable primary
 * for the lifetime of the process, so a failover or a planned promotion no
 * longer needs a container restart before writes reach the new primary.
 *
 * resolve-primary-at-boot.ts picks the primary once, before the pool is built.
 * After that, this module polls the same monitor every few seconds and records
 * the current primary; `PrimaryFollowingClient` (handed to pg.Pool through
 * PrismaPg's pool config) points every NEW pooled connection at it. When the
 * primary moves, connections still open to any other node are closed: a
 * restarted node closes them itself, but a partitioned one does not, and each
 * would otherwise hang a request until the TCP timeout. pg.Pool drops a client
 * whose socket fails and replaces it with a correctly-routed one.
 *
 * Fail-safe like the boot resolver: a monitor that is unreachable or reports
 * no primary (the brief window mid-failover) leaves the last known primary in
 * place instead of guessing.
 */

import { Client, type ClientConfig } from 'pg';

import {
  MONITOR_NODE_FILTER,
  closeMonitorSessions,
  queryMonitorReusingConnection,
  withResolvedHost,
} from '@infrastructure/database/prisma/monitor-client.util';

/**
 * The member the monitor has DECIDED is the writable primary (its goal state), in every
 * writable state, not just the settled 'primary': right after a failover the new primary is
 * briefly 'wait_primary' or 'apply_settings'.
 *
 * Goal state, not reported state: a node that dies or loses its network keeps its last
 * reported state ('primary') forever, while the monitor moves its goal to 'demoted' and the
 * standby's goal to 'wait_primary'. Matching on reported state picked the dead node in the
 * 2026-11-12 failover drill. Mid-failover no row matches, and callers keep the last known
 * primary.
 */
export const CURRENT_PRIMARY_QUERY = `SELECT nodehost, nodeport FROM pgautofailover.node WHERE ${MONITOR_NODE_FILTER} AND goalstate IN ('primary', 'wait_primary', 'single', 'apply_settings') ORDER BY nodeid LIMIT 1`;

export const PRIMARY_POLL_INTERVAL_MS = 3000;

/**
 * Consecutive failed polls before the monitor counts as unreachable (~9 s). A single slow answer
 * from a monitor on another continent is not an outage, and the last known primary stays in use
 * either way.
 */
export const MONITOR_FAILURES_BEFORE_WARNING = 3;

export interface PrimaryEndpoint {
  readonly host: string;
  readonly port: number;
}

export interface PrimaryTrackingHandlers {
  /** The primary moved; `closedConnections` connections to other nodes were closed. */
  onChange: (primary: PrimaryEndpoint, closedConnections: number) => void;
  /**
   * The monitor could not be read for MONITOR_FAILURES_BEFORE_WARNING polls in a row. Called
   * once per outage, not on every poll.
   */
  onError: (error: Error) => void;
  /** The monitor answered again after onError. */
  onRecovered: () => void;
}

let currentPrimary: PrimaryEndpoint | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let monitorFailing = false;
let consecutiveFailures = 0;
let pollInFlight = false;
/** Every PrimaryFollowingClient that has not ended, so a primary move can close the stale ones. */
const liveClients = new Set<PrimaryFollowingClient>();

export function getCurrentPrimary(): PrimaryEndpoint | null {
  return currentPrimary;
}

/** Records the primary found at boot, so tracking starts from it rather than from nothing. */
export function setCurrentPrimary(primary: PrimaryEndpoint): void {
  currentPrimary = primary;
}

/** Asks the monitor once; returns the new primary when it changed, otherwise null. */
export async function refreshCurrentPrimary(monitorUri: string): Promise<PrimaryEndpoint | null> {
  const rows = await queryMonitorReusingConnection(monitorUri, CURRENT_PRIMARY_QUERY);
  const row = rows[0];
  if (!row) {
    return null;
  }
  const next = { host: row.nodehost, port: Number(row.nodeport) };
  if (currentPrimary && currentPrimary.host === next.host && currentPrimary.port === next.port) {
    return null;
  }
  currentPrimary = next;
  return next;
}

/**
 * Closes every open connection that is not to `primary`. Destroying the socket makes pg.Pool drop
 * an idle client, and fails an in-flight query at once instead of after the TCP timeout.
 */
export function closeConnectionsNotTo(primary: PrimaryEndpoint): number {
  let closed = 0;
  for (const client of liveClients) {
    if (client.host !== primary.host || client.port !== primary.port) {
      liveClients.delete(client);
      client.connection.stream.destroy();
      closed++;
    }
  }
  return closed;
}

/** Starts polling the monitor (idempotent). The timer never keeps the process alive. */
export function startPrimaryTracking(monitorUri: string, handlers: PrimaryTrackingHandlers): void {
  if (pollTimer) {
    return;
  }
  pollTimer = setInterval(() => {
    // A poll can take up to connect + query timeout (4 s) > the interval: never overlap them.
    if (pollInFlight) {
      return;
    }
    pollInFlight = true;
    refreshCurrentPrimary(monitorUri)
      .then(changed => {
        consecutiveFailures = 0;
        if (monitorFailing) {
          monitorFailing = false;
          handlers.onRecovered();
        }
        if (changed) {
          handlers.onChange(changed, closeConnectionsNotTo(changed));
        }
      })
      .catch((error: Error) => {
        consecutiveFailures++;
        if (!monitorFailing && consecutiveFailures >= MONITOR_FAILURES_BEFORE_WARNING) {
          monitorFailing = true;
          handlers.onError(error instanceof Error ? error : new Error(String(error)));
        }
      })
      .finally(() => {
        pollInFlight = false;
      });
  }, PRIMARY_POLL_INTERVAL_MS);
  pollTimer.unref();
}

export function stopPrimaryTracking(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  monitorFailing = false;
  consecutiveFailures = 0;
  pollInFlight = false;
  closeMonitorSessions();
}

/** A pg Client whose connection goes to the current primary (pg.Pool builds one per connection). */
export class PrimaryFollowingClient extends Client {
  constructor(config?: string | ClientConfig) {
    const primary = currentPrimary;
    if (primary && typeof config === 'object' && config.connectionString) {
      // pg lets the connection string override `host`/`port`, so rewrite the string itself.
      super({
        ...config,
        connectionString: withResolvedHost(config.connectionString, primary.host, primary.port),
      });
    } else {
      super(config);
    }
    liveClients.add(this);
    this.once('end', () => liveClients.delete(this));
  }
}
