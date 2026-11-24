import { describe, expect, it } from '@jest/globals';
import {
  DEFAULT_POOL_IDLE_TIMEOUT_MS,
  DEFAULT_POOL_MIN,
  resolvePoolIdleSettings,
} from '@infrastructure/database/prisma/pool-idle.util';

const env =
  (values: Record<string, number>) =>
  (name: string, fallback: number): number =>
    values[name] ?? fallback;

describe('resolvePoolIdleSettings', () => {
  it('keeps connections warm instead of pg.Pool reaping them after 10 s', () => {
    const settings = resolvePoolIdleSettings(25, env({}));
    expect(settings.idleTimeoutMillis).toBe(DEFAULT_POOL_IDLE_TIMEOUT_MS);
    expect(settings.idleTimeoutMillis).toBeGreaterThan(10_000);
    expect(settings.min).toBe(DEFAULT_POOL_MIN);
    expect(settings.keepAlive).toBe(true);
    expect(settings.keepAliveInitialDelayMillis).toBeGreaterThan(0);
  });

  it('honours DB_POOL_IDLE_TIMEOUT_MS and DB_POOL_MIN', () => {
    const settings = resolvePoolIdleSettings(
      25,
      env({ DB_POOL_IDLE_TIMEOUT_MS: 60_000, DB_POOL_MIN: 4 })
    );
    expect(settings).toMatchObject({ idleTimeoutMillis: 60_000, min: 4 });
    expect(resolvePoolIdleSettings(25, env({ DB_POOL_IDLE_TIMEOUT_MS: 0 })).idleTimeoutMillis).toBe(
      0
    );
  });

  it('never keeps more idle connections than the pool may hold, nor a negative count', () => {
    expect(resolvePoolIdleSettings(1, env({ DB_POOL_MIN: 5 })).min).toBe(1);
    expect(resolvePoolIdleSettings(10, env({ DB_POOL_MIN: -3 })).min).toBe(0);
    expect(resolvePoolIdleSettings(10, env({ DB_POOL_MIN: 2.7 })).min).toBe(2);
    expect(
      resolvePoolIdleSettings(10, env({ DB_POOL_IDLE_TIMEOUT_MS: -1 })).idleTimeoutMillis
    ).toBe(DEFAULT_POOL_IDLE_TIMEOUT_MS);
  });
});
