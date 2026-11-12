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
 * PrismaPg's pool config) points every NEW pooled connection at it. Existing
 * connections to a demoted primary are not touched here: pg_auto_failover
 * restarts a demoted node as a standby (or the node is gone), which closes
 * them, and the pool replaces them with new, correctly-routed connections.
 *
 * Fail-safe like the boot resolver: a monitor that is unreachable or reports
 * no primary (the brief window mid-failover) leaves the last known primary in
 * place instead of guessing.
 */

import { Client, type ClientConfig } from 'pg';

import {
  queryMonitor,
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
export const CURRENT_PRIMARY_QUERY =
  "SELECT nodehost, nodeport FROM pgautofailover.node WHERE goalstate IN ('primary', 'wait_primary', 'single', 'apply_settings') ORDER BY nodeid LIMIT 1";

export const PRIMARY_POLL_INTERVAL_MS = 3000;

export interface PrimaryEndpoint {
  readonly host: string;
  readonly port: number;
}

let currentPrimary: PrimaryEndpoint | null = null;
let pollTimer: NodeJS.Timeout | null = null;

export function getCurrentPrimary(): PrimaryEndpoint | null {
  return currentPrimary;
}

/** Records the primary found at boot, so tracking starts from it rather than from nothing. */
export function setCurrentPrimary(primary: PrimaryEndpoint): void {
  currentPrimary = primary;
}

/** Asks the monitor once; returns the new primary when it changed, otherwise null. */
export async function refreshCurrentPrimary(monitorUri: string): Promise<PrimaryEndpoint | null> {
  const rows = await queryMonitor(monitorUri, CURRENT_PRIMARY_QUERY);
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

/** Starts polling the monitor (idempotent). The timer never keeps the process alive. */
export function startPrimaryTracking(
  monitorUri: string,
  onChange: (primary: PrimaryEndpoint) => void,
  onError: (error: unknown) => void
): void {
  if (pollTimer) {
    return;
  }
  pollTimer = setInterval(() => {
    refreshCurrentPrimary(monitorUri)
      .then(changed => {
        if (changed) {
          onChange(changed);
        }
      })
      .catch(onError);
  }, PRIMARY_POLL_INTERVAL_MS);
  pollTimer.unref();
}

export function stopPrimaryTracking(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
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
  }
}
