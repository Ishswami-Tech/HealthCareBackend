/**
 * Where every Dragonfly/Redis client connects: one fixed host, or the current master as
 * reported by Redis Sentinel.
 *
 * The cache client, both BullMQ connections, the rate limiter and the Socket.IO adapter all
 * build their ioredis options from this, so failover behaves the same for each of them. With
 * `CACHE_SENTINELS` unset nothing changes: the target is the client's configured host/port as
 * before. With it set (`host:port[,host:port...]`), ioredis asks Sentinel for the master of
 * `CACHE_SENTINEL_MASTER_NAME`, reconnects to the new master after a failover, and
 * `failoverDetector` makes it react to Sentinel's `+switch-master` instead of waiting for the
 * old connection to fail.
 */

import { HealthcareError } from '@core/errors/healthcare-error.class';
import { ErrorCode } from '@core/errors/error-codes.enum';

export interface SentinelAddress {
  readonly host: string;
  readonly port: number;
}

// Mutable on purpose: spread straight into ioredis options, whose `sentinels` is a mutable array.
export type CacheConnectionTarget =
  | { host: string; port: number }
  | {
      sentinels: SentinelAddress[];
      name: string;
      sentinelPassword?: string;
      failoverDetector: true;
    };

export const DEFAULT_SENTINEL_PORT = 26379;
export const DEFAULT_SENTINEL_MASTER_NAME = 'dragonfly';

/** Parses `host:port[,host:port...]`; a missing port means Sentinel's default 26379. */
export function parseSentinelAddresses(value: string): SentinelAddress[] {
  return value
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map(entry => {
      const separator = entry.lastIndexOf(':');
      const host = separator >= 0 ? entry.slice(0, separator) : entry;
      const port = separator >= 0 ? Number(entry.slice(separator + 1)) : DEFAULT_SENTINEL_PORT;
      if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
        throw new HealthcareError(
          ErrorCode.CACHE_CONFIGURATION_ERROR,
          `Invalid CACHE_SENTINELS entry "${entry}" (expected host:port)`,
          undefined,
          { entry },
          'CacheConnectionTarget'
        );
      }
      return { host, port };
    });
}

/** `direct` is the client's configured host/port, used whenever Sentinel is not configured. */
export function getCacheConnectionTarget(
  getEnv: (key: string) => string | undefined,
  direct: { host: string; port: number }
): CacheConnectionTarget {
  const sentinels = parseSentinelAddresses(getEnv('CACHE_SENTINELS') ?? '');
  if (sentinels.length === 0) {
    return { host: direct.host, port: direct.port };
  }
  const sentinelPassword = getEnv('CACHE_SENTINEL_PASSWORD')?.trim();
  return {
    sentinels,
    name: getEnv('CACHE_SENTINEL_MASTER_NAME')?.trim() || DEFAULT_SENTINEL_MASTER_NAME,
    ...(sentinelPassword ? { sentinelPassword } : {}),
    failoverDetector: true,
  };
}

/** Short human-readable form for logs (never includes a password). */
export function describeCacheTarget(target: CacheConnectionTarget): string {
  return 'sentinels' in target
    ? `sentinel master "${target.name}" via ${target.sentinels.map(s => `${s.host}:${s.port}`).join(',')}`
    : `${target.host}:${target.port}`;
}
