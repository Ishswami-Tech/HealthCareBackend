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
 * re-resolve for the lifetime of a running process; primary-tracker.ts does
 * that, starting from the primary found here.
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
import {
  CURRENT_PRIMARY_QUERY,
  setCurrentPrimary,
} from '@infrastructure/database/prisma/primary-tracker';

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
    const rows = await queryMonitor(monitorUri, CURRENT_PRIMARY_QUERY);

    const primary = rows[0];
    if (!primary) {
      logger?.warn(
        'resolvePrimaryAtBoot: monitor reported no primary, keeping configured DATABASE_URL/DIRECT_URL unchanged'
      );
      return;
    }

    // Seeds primary-tracker.ts, which keeps following the primary after boot.
    setCurrentPrimary({ host: primary.nodehost, port: Number(primary.nodeport) });
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
