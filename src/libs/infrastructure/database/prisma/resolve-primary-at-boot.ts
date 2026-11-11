/**
 * Primary Resolver (boot-time)
 * ==============================
 * Resolves DATABASE_URL (and DIRECT_URL) to whichever pg_auto_failover member is
 * CURRENTLY the primary at process startup, instead of trusting a value baked
 * into the deployment's env vars — which goes stale the moment pg_auto_failover
 * moves the primary to a different node (switchover or failover) and nobody
 * edits the env var by hand.
 *
 * This only runs once, at boot, before the Prisma connection pool is built —
 * that construction is synchronous and reads process.env.DATABASE_URL directly
 * (see prisma.service.ts), so this must run and finish before it. It does NOT
 * re-resolve for the lifetime of a running process: a failover that happens
 * while this process is already up still requires the process to restart
 * before it reconnects to the new primary. In practice that happens anyway —
 * writes against a demoted primary fail with "cannot execute ... in a
 * read-only transaction", the health check notices, and the container gets
 * restarted — so this removes the manual DATABASE_URL edit from the loop, it
 * just doesn't make every failover instantaneous for an already-running
 * process.
 *
 * No reachability probe here (unlike local-replica-resolver.ts): whatever this
 * resolves to is what PrismaService connects to immediately afterwards anyway,
 * so a redundant probe would just duplicate that same connection attempt.
 *
 * Fail-safe by design, matching local-replica-resolver.ts: any missing env
 * var, query failure, or no primary found leaves process.env.DATABASE_URL /
 * DIRECT_URL untouched, and startup continues with whatever was already
 * configured.
 */

import {
  queryMonitor,
  withResolvedHost,
} from '@infrastructure/database/prisma/monitor-client.util';

/**
 * Queries the pg_auto_failover monitor at MONITOR_URI for whichever cluster
 * member currently reports state 'primary', and rewrites
 * process.env.DATABASE_URL (and DIRECT_URL, if set) to point at it. No-op if
 * MONITOR_URI is unset, the monitor is unreachable, or no member is currently
 * primary.
 */
export async function resolvePrimaryAtBoot(logger?: {
  warn: (message: string) => void;
}): Promise<void> {
  const monitorUri = process.env['MONITOR_URI'];
  if (!monitorUri) {
    return;
  }

  try {
    // Matches every state pg_auto_failover (and Temps' own tooling) treats as
    // writable, not just the settled 'primary' — narrows the brief transition
    // window right after a failover where the new primary is still
    // 'wait_primary'/'apply_settings' and a strict '= primary' match would find
    // nothing and silently fall back to whatever DATABASE_URL already had
    // (possibly the just-demoted old primary).
    const rows = await queryMonitor(
      monitorUri,
      "SELECT nodehost, nodeport FROM pgautofailover.node WHERE reportedstate IN ('primary', 'wait_primary', 'single', 'apply_settings') ORDER BY nodeid LIMIT 1"
    );

    const primary = rows[0];
    if (!primary) {
      logger?.warn(
        'resolvePrimaryAtBoot: monitor reported no primary, keeping configured DATABASE_URL/DIRECT_URL unchanged'
      );
      return;
    }

    for (const envVar of ['DATABASE_URL', 'DIRECT_URL'] as const) {
      const value = process.env[envVar];
      if (value) {
        process.env[envVar] = withResolvedHost(value, primary.nodehost, primary.nodeport);
      }
    }
  } catch (error) {
    logger?.warn(
      `resolvePrimaryAtBoot: failed to resolve current primary from monitor, keeping configured DATABASE_URL/DIRECT_URL unchanged: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
