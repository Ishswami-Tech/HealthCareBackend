/**
 * How long pooled Postgres connections stay open between requests.
 *
 * pg.Pool's defaults (idleTimeoutMillis 10 s, min 0) were in effect. At this traffic level the
 * requests are often more than 10 s apart, so the pool had closed everything and nearly every
 * request opened fresh connections to the primary across the WireGuard mesh. Traces, 2026-11-24:
 * `pg.connect` was the largest time sink of all spans: p50 39 ms, p95 0.9 s, max 10 s, 562 s
 * total in the sampled traces alone, behind the slow dashboard, profile and appointment reads.
 *
 * Connections now stay warm for minutes, a few per pool are never reaped, and TCP keepalive
 * finds a connection that died across a mesh blip or failover before a request trips over it
 * (primary moves still close the old ones at once: see primary-tracker.ts).
 */
export interface PoolIdleSettings {
  readonly idleTimeoutMillis: number;
  readonly min: number;
  readonly keepAlive: true;
  readonly keepAliveInitialDelayMillis: number;
}

export const DEFAULT_POOL_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
export const DEFAULT_POOL_MIN = 2;
const KEEPALIVE_INITIAL_DELAY_MS = 10_000;

/**
 * `readNumber(name, fallback)` is the env reader (getEnvNumber); `max` is the pool size, which
 * `min` never exceeds. DB_POOL_IDLE_TIMEOUT_MS=0 means "never reap idle connections".
 */
export function resolvePoolIdleSettings(
  max: number,
  readNumber: (name: string, fallback: number) => number
): PoolIdleSettings {
  const idle = readNumber('DB_POOL_IDLE_TIMEOUT_MS', DEFAULT_POOL_IDLE_TIMEOUT_MS);
  const min = readNumber('DB_POOL_MIN', DEFAULT_POOL_MIN);
  return {
    idleTimeoutMillis: Number.isFinite(idle) && idle >= 0 ? idle : DEFAULT_POOL_IDLE_TIMEOUT_MS,
    min: Math.max(0, Math.min(Number.isFinite(min) ? Math.floor(min) : DEFAULT_POOL_MIN, max)),
    keepAlive: true,
    keepAliveInitialDelayMillis: KEEPALIVE_INITIAL_DELAY_MS,
  };
}
