/**
 * The shared "world" of the invalidation safety suites: a fake Redis/Dragonfly server reached
 * through the real BaseCacheClientService -> DragonflyCacheProvider -> CacheRepository ->
 * CacheService -> HealthcareCacheInterceptor chain, seeded with the keys of two tenants, unowned
 * global keys and every kind of security state.
 *
 * The spec files that import this module must mock the config modules (see their headers).
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Reflector } from '@nestjs/core';

import { HealthcareCacheInterceptor } from '@core/interceptors/healthcare-cache.interceptor';
import { CacheService } from '@infrastructure/cache/cache.service';
import { CacheRepository } from '@infrastructure/cache/repositories/cache.repository';
import { CacheVersioningService } from '@infrastructure/cache/services/cache-versioning.service';
import { CacheKeyFactory } from '@infrastructure/cache/factories/cache-key.factory';
import { DragonflyCacheProvider } from '@infrastructure/cache/providers/dragonfly-cache.provider';
import type { DragonflyService } from '@cache/dragonfly/dragonfly.service';
import type { LoggingService } from '@infrastructure/logging';
import { PREFIX, TestCacheClient, createFakeCacheServer } from './fake-cache-server';
import type { FakeCacheServer } from './fake-cache-server';

export const SRC = join(__dirname, '..', '..', '..', '..', 'src');

export const CLINIC_A = '11111111-1111-4111-8111-111111111111';
export const CLINIC_B = '22222222-2222-4222-8222-222222222222';
export const USER_A = 'user-aaaa-0001';
export const USER_B = 'user-bbbb-0002';
export const DOCTOR_A = 'doctor-aaaa-0001';
export const DOCTOR_B = 'doctor-bbbb-0002';
export const APPOINTMENT_A = 'appointment-aaaa-0001';
export const APPOINTMENT_B = 'appointment-bbbb-0002';
export const RESOURCE_A = 'resource-aaaa-0001';

// ---------------------------------------------------------------------------------------------
// The world: every kind of key a tenant, a user and the platform own
// ---------------------------------------------------------------------------------------------

/** Security / integrity state of EVERY identity. None of it may ever be deleted by invalidation. */
export const SECURITY_KEYS: readonly string[] = [
  `auth:lockout:${USER_A}:v1`,
  `auth:attempts:${USER_A}:v1`,
  `auth:lockout:${USER_B}:v1`,
  `auth:attempts:${USER_B}:v1`,
  'auth:lockout:victim@example.com:v1',
  'auth:login_attempt:someone:v1',
  'auth:refresh_token:' + USER_B + ':v1',
  `user_sessions:${USER_A}:v1`,
  `user_sessions:${USER_B}:v1`,
  'session:sess-b-1:v1',
  'sessions:sess-b-2:v1',
  'blacklist:jti-1:v1',
  'jwt:blacklist:jti-2:v1',
  'jwt:user_tokens:' + USER_B + ':v1',
  'otp:+910000000000:v1',
  'otp_attempts:+910000000000:v1',
  'account_lock:victim@example.com:v1',
  `security:events:${USER_B}`,
  'phi:access:audit',
  'rate_limit:auth:victim@example.com',
  'lock:booking:doctor-1:clinic-1:slot',
  'payment-handoff:jti:abc',
  'webhook:processed:cashfree:evt-1',
  'cache:tag:appointments',
  'cache:tag:users',
  'cache:stats',
];

/** Tenant B and user B own these; a write by tenant A must leave them alone. */
export const TENANT_B_KEYS: readonly string[] = [
  `clinic:${CLINIC_B}:appointments:list:getList:r-DOCTOR:q-aaaa:v1`,
  `clinic:${CLINIC_B}:appointments:detail:${APPOINTMENT_B}:getOne:u-${USER_B}:q-aaaa:v1`,
  `clinic:${CLINIC_B}:users:all:getAll:r-CLINIC_ADMIN:q-aaaa:v1`,
  `clinic:${CLINIC_B}:user:${USER_B}:sessions:getSessions:u-${USER_B}:q-aaaa:v1`,
  `clinic:${CLINIC_B}:patient:${USER_B}:records:v1`,
  `clinic_locations:${CLINIC_B}:false:x:getAll:r-DOCTOR:q-aaaa:v1`,
  `clinic_location:${CLINIC_B}:loc-b:getOne:r-DOCTOR:q-aaaa:v1`,
  `user:${USER_B}:profile:v1`,
  `users:one:${USER_B}:v1`,
  `healthcare:clinic:${CLINIC_B}:appointments:list:v1`,
  `healthcare:patient:${USER_B}:clinic:${CLINIC_B}:records:v1`,
  `healthcare:doctor:${DOCTOR_B}:clinic:${CLINIC_B}:availability:v1`,
  `healthcare:appointment:${APPOINTMENT_B}:detail:v1`,
  `patient_followups:${USER_B}:${CLINIC_B}:x:v1`,
  `therapy-queues:clinic:${CLINIC_B}:x:v1`,
  `ipd:bedboard:${CLINIC_B}:loc-b:x:v1`,
  `queue:doctor:${DOCTOR_B}:${CLINIC_B}`,
];

/** Not owned by any tenant (shared shapes a global pattern would flush). */
export const UNOWNED_GLOBAL_KEYS: readonly string[] = [
  'appointments:x:v1',
  'appointment:x:v1',
  'appointments:detail:shared:v1',
  'users:all:shared:v1',
  'patient:shared:v1',
  'doctor:shared:appointments:v1',
  'shared:appointments:v1',
  'clinic:shared:v1',
  'clinic_locations:shared:v1',
];

/** The caller's own entries; the helpers and clinic-scoped declarations are meant to reach them. */
export const TENANT_A_KEYS: readonly string[] = [
  `clinic:${CLINIC_A}:appointments:list:getList:r-DOCTOR:q-aaaa:v1`,
  `clinic:${CLINIC_A}:appointment:${APPOINTMENT_A}:getOne:q-aaaa:v1`,
  `clinic:${CLINIC_A}:users:all:getAll:r-CLINIC_ADMIN:q-aaaa:v1`,
  `clinic:${CLINIC_A}:user:${USER_A}:sessions:getSessions:u-${USER_A}:q-aaaa:v1`,
  `clinic:${CLINIC_A}:patient:${USER_A}:records:v1`,
  `user:${USER_A}:profile:v1`,
];

export interface World {
  readonly server: FakeCacheServer;
  readonly cacheService: CacheService;
  readonly interceptor: HealthcareCacheInterceptor;
  readonly reflector: { get: jest.Mock };
  readonly logger: { log: jest.Mock };
}

export function createWorld(): World {
  const server = createFakeCacheServer();
  const logger = { log: jest.fn().mockResolvedValue(undefined) };
  const client = new TestCacheClient(PREFIX, server.client, logger);
  const provider = new DragonflyCacheProvider(
    client as unknown as DragonflyService,
    { isDevelopment: (): boolean => false } as never,
    logger as never
  );
  const keyFactory = new CacheKeyFactory();
  const repository = new CacheRepository(
    { getBasicProvider: () => provider, getProvider: () => provider } as never,
    {} as never,
    {} as never,
    new CacheVersioningService(keyFactory),
    keyFactory,
    logger as never
  );
  const cacheService = Object.create(CacheService.prototype) as CacheService;
  Object.assign(cacheService, {
    cacheRepository: repository,
    keyFactory,
    loggingService: logger,
    advancedProvider: provider,
    config: {},
    enableL1: false,
    l1CacheService: null,
  });
  const reflector = { get: jest.fn() };
  const interceptor = new HealthcareCacheInterceptor(
    cacheService,
    reflector as unknown as Reflector,
    logger as unknown as LoggingService
  );

  [...SECURITY_KEYS, ...TENANT_B_KEYS, ...UNOWNED_GLOBAL_KEYS, ...TENANT_A_KEYS].forEach(key =>
    server.seed(key)
  );
  return { server, cacheService, interceptor, reflector, logger };
}

export async function settle(): Promise<void> {
  // Background pattern scans are chains of resolved promises; a macrotask boundary drains them.
  for (let round = 0; round < 3; round += 1) {
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}

export function survivors(world: World, keys: readonly string[]): string[] {
  return keys.filter(key => world.server.has(key));
}

export function deleted(world: World, keys: readonly string[]): string[] {
  return keys.filter(key => !world.server.has(key));
}

export function sourceFiles(dir: string, suffix: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'generated' || entry.name === 'node_modules'
        ? []
        : sourceFiles(full, suffix);
    }
    return entry.name.endsWith(suffix) ? [full] : [];
  });
}
