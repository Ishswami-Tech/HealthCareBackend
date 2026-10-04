/// <reference types="jest" />
/**
 * Every cache invalidation that exists in the code base, run for real against an in-memory
 * Dragonfly/Redis stand-in (fake server -> BaseCacheClientService -> DragonflyCacheProvider ->
 * CacheRepository -> CacheService -> HealthcareCacheInterceptor).
 *
 * A pattern delete is global, so a bare `clinic:*` or `auth:*` in an `@InvalidateCache` would let
 * one clinic's write flush every tenant, or let any user's logout wipe every identity's
 * brute-force lockout counters. These tests enumerate the real declarations and assert, for each:
 *
 *  - no security key (lockout, attempts, sessions, JWT blacklist, OTP, audit trail, rate limit,
 *    locks, tag indexes) is ever deleted,
 *  - no other tenant's key (and no un-owned global key) is deleted,
 *  - the caller's own keys are still reached.
 *
 * Declarations are read from the sources (decorators) so a new broad pattern fails here.
 */

import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { lastValueFrom, of } from 'rxjs';
import type { ExecutionContext } from '@nestjs/common';

import {
  CACHE_INVALIDATE_KEY,
  InvalidateAppointmentCache,
  InvalidateCache,
  InvalidateClinicCache,
  InvalidatePatientCache,
} from '@core/decorators/cache.decorator';
import type { CacheRepository } from '@infrastructure/cache/repositories/cache.repository';
import type { CacheService } from '@infrastructure/cache/cache.service';
import { isProtectedKey } from '@infrastructure/cache/utils/protected-keys.util';
import { LogLevel } from '@core/types';
import type { CacheInvalidationOptions } from '@core/types';
import {
  APPOINTMENT_A,
  CLINIC_A,
  CLINIC_B,
  DOCTOR_A,
  RESOURCE_A,
  SECURITY_KEYS,
  SRC,
  TENANT_A_KEYS,
  TENANT_B_KEYS,
  UNOWNED_GLOBAL_KEYS,
  USER_A,
  USER_B,
  createWorld,
  deleted,
  settle,
  sourceFiles,
  survivors,
} from './support/invalidation-world';
import type { World } from './support/invalidation-world';

jest.mock('@config/config.service', () => ({ ConfigService: class ConfigService {} }));
jest.mock('@config/cache.config', () => ({
  isCacheEnabled: (): boolean => true,
  getCacheProvider: (): string => 'dragonfly',
}));
jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));

// ---------------------------------------------------------------------------------------------
// Enumerating the real @Invalidate* declarations
// ---------------------------------------------------------------------------------------------

type DecoratorFactory = (options?: CacheInvalidationOptions) => MethodDecorator;

const DECORATORS: Readonly<Record<string, DecoratorFactory>> = {
  InvalidateCache: InvalidateCache as unknown as DecoratorFactory,
  InvalidateHealthcareCache: InvalidateCache as unknown as DecoratorFactory,
  InvalidateAppointmentCache: InvalidateAppointmentCache as unknown as DecoratorFactory,
  InvalidatePatientCache: InvalidatePatientCache as unknown as DecoratorFactory,
  InvalidateClinicCache: InvalidateClinicCache as unknown as DecoratorFactory,
};

interface Declaration {
  readonly file: string;
  readonly line: number;
  readonly decorator: string;
  readonly patterns: readonly string[];
  readonly tags: readonly string[];
}

/** Text between the parentheses that open at `openIndex`. */
function balanced(source: string, openIndex: number): string {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source.charAt(index);
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex + 1, index);
    }
  }
  return '';
}

function stringList(options: string, property: string): string[] {
  const block = new RegExp(`${property}:\\s*\\[([\\s\\S]*?)\\]`).exec(options)?.[1] ?? '';
  return Array.from(block.matchAll(/'([^']*)'/g), match => match[1] ?? '');
}

function enumerateDeclarations(): Declaration[] {
  const declarations: Declaration[] = [];
  for (const file of sourceFiles(SRC, '.controller.ts')) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/@(Invalidate\w+)\(/g)) {
      const name = match[1] ?? '';
      const index = match.index ?? 0;
      const options = balanced(source, index + match[0].length - 1);
      declarations.push({
        file: relative(SRC, file).replace(/\\/g, '/'),
        line: source.slice(0, index).split('\n').length,
        decorator: name,
        patterns: stringList(options, 'patterns'),
        tags: stringList(options, 'tags'),
      });
    }
  }
  return declarations;
}

/** The metadata the REAL decorator (including its helper-added patterns) puts on a handler. */
function metadataOf(declaration: Declaration): CacheInvalidationOptions {
  const factory = DECORATORS[declaration.decorator];
  if (!factory) throw new Error(`Unknown decorator @${declaration.decorator}`);
  class Handlers {
    handler(): void {}
  }
  const descriptor = Object.getOwnPropertyDescriptor(Handlers.prototype, 'handler');
  if (!descriptor) throw new Error('missing descriptor');
  factory({ patterns: declaration.patterns, tags: declaration.tags })(
    Handlers.prototype,
    'handler',
    descriptor
  );
  return Reflect.getMetadata(
    CACHE_INVALIDATE_KEY,
    descriptor.value as object
  ) as CacheInvalidationOptions;
}

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

interface TestRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  params: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  user: { sub: string; role: string };
  clinicContext?: { clinicId: string };
}

const REQUEST_CONTEXTS: ReadonlyArray<readonly [string, TestRequest]> = [
  [
    'a clinic user (validated clinic, route id)',
    {
      method: 'PATCH',
      url: '/x',
      headers: {},
      params: { id: RESOURCE_A, clinicId: CLINIC_A, userId: USER_A, patientId: USER_A },
      user: { sub: USER_A, role: 'CLINIC_ADMIN' },
      clinicContext: { clinicId: CLINIC_A },
    },
  ],
  [
    'a patient of tenant A',
    {
      method: 'POST',
      url: '/x',
      headers: {},
      params: { id: APPOINTMENT_A },
      user: { sub: USER_A, role: 'PATIENT' },
      clinicContext: { clinicId: CLINIC_A },
      body: { contact: 'a@example.com' },
    },
  ],
  [
    'a super admin with no clinic context',
    {
      method: 'PUT',
      url: '/x',
      headers: {},
      params: { id: RESOURCE_A },
      user: { sub: USER_A, role: 'SUPER_ADMIN' },
    },
  ],
  [
    'a hostile caller: wildcard ids, another clinic in the route and spoofed body/query',
    {
      method: 'DELETE',
      url: '/x',
      headers: {},
      params: { id: '*', clinicId: CLINIC_B, userId: '*', patientId: '*', doctorId: '*' },
      query: { userId: USER_B, clinicId: CLINIC_B },
      body: { userId: USER_B, clinicId: CLINIC_B, contact: '*' },
      user: { sub: USER_A, role: 'CLINIC_ADMIN' },
      clinicContext: { clinicId: CLINIC_A },
    },
  ],
];

function makeContext(request: TestRequest): ExecutionContext {
  const handler = (): void => undefined;
  Object.defineProperty(handler, 'name', { value: 'handler' });
  return {
    getHandler: () => handler,
    getClass: () => class TestController {},
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ statusCode: 200 }) }),
  } as unknown as ExecutionContext;
}

async function runWrite(
  world: World,
  request: TestRequest,
  invalidate: CacheInvalidationOptions
): Promise<void> {
  world.reflector.get.mockImplementation((metaKey: string) =>
    metaKey === CACHE_INVALIDATE_KEY ? invalidate : undefined
  );
  const next = { handle: () => of({ ok: true }) };
  await lastValueFrom(await world.interceptor.intercept(makeContext(request), next));
  await settle();
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

describe('every @InvalidateCache declaration in the controllers', () => {
  const declarations = enumerateDeclarations();

  it('finds the real declarations this suite is meant to cover', () => {
    expect(declarations.length).toBeGreaterThanOrEqual(35);
    const names = new Set(declarations.map(declaration => declaration.decorator));
    for (const name of [
      'InvalidateCache',
      'InvalidateAppointmentCache',
      'InvalidatePatientCache',
      'InvalidateClinicCache',
    ]) {
      expect(names.has(name)).toBe(true);
    }
    names.forEach(name => expect(Object.keys(DECORATORS)).toContain(name));
    expect(declarations.some(declaration => declaration.patterns.includes('auth:*'))).toBe(false);
  });

  it('keeps the logout declaration free of the global security patterns', () => {
    const logout = declarations.find(
      declaration =>
        declaration.file === 'services/auth/auth.controller.ts' &&
        declaration.tags.join() === 'user_sessions,auth'
    );

    expect(logout?.patterns).toEqual(['user:{userId}:*']);
  });

  describe.each(
    declarations.map(
      declaration =>
        [`${declaration.file}:${declaration.line} @${declaration.decorator}`, declaration] as const
    )
  )('%s', (_label, declaration) => {
    const options = metadataOf(declaration);

    it.each(REQUEST_CONTEXTS)(
      'never deletes security state, another tenant or unowned keys for %s',
      async (_name, request) => {
        const world = createWorld();

        await runWrite(world, request, options);

        expect(deleted(world, SECURITY_KEYS)).toEqual([]);
        expect(deleted(world, TENANT_B_KEYS)).toEqual([]);
        expect(deleted(world, UNOWNED_GLOBAL_KEYS)).toEqual([]);
      }
    );
  });
});

describe('the decorator helpers emit clinic-scoped patterns', () => {
  const clinicUser = (REQUEST_CONTEXTS[0] as readonly [string, TestRequest])[1];

  it.each([
    [
      'InvalidateAppointmentCache',
      (): CacheInvalidationOptions => metadataOfHelper('InvalidateAppointmentCache'),
    ],
    [
      'InvalidatePatientCache',
      (): CacheInvalidationOptions => metadataOfHelper('InvalidatePatientCache'),
    ],
    [
      'InvalidateClinicCache',
      (): CacheInvalidationOptions => metadataOfHelper('InvalidateClinicCache', { patterns: [] }),
    ],
  ])('%s declares no global pattern', (_name, build) => {
    const patterns = build().patterns;

    expect(patterns.length).toBeGreaterThan(0);
    patterns.forEach(pattern => expect(pattern.startsWith('clinic:{clinicId}:')).toBe(true));
  });

  it('InvalidateAppointmentCache reaches the caller clinic appointments and nothing else', async () => {
    const world = createWorld();

    await runWrite(world, clinicUser, metadataOfHelper('InvalidateAppointmentCache'));

    expect(world.server.has(TENANT_A_KEYS[0] ?? '')).toBe(false);
    expect(world.server.has(TENANT_A_KEYS[1] ?? '')).toBe(false);
    expect(deleted(world, [...SECURITY_KEYS, ...TENANT_B_KEYS, ...UNOWNED_GLOBAL_KEYS])).toEqual(
      []
    );
  });

  it('InvalidateClinicCache reaches every key of the caller clinic and none of another clinic', async () => {
    const world = createWorld();

    await runWrite(world, clinicUser, metadataOfHelper('InvalidateClinicCache', { patterns: [] }));

    const callerClinicKeys = TENANT_A_KEYS.filter(key => key.startsWith(`clinic:${CLINIC_A}:`));
    expect(survivors(world, callerClinicKeys)).toEqual([]);
    expect(deleted(world, [...SECURITY_KEYS, ...TENANT_B_KEYS, ...UNOWNED_GLOBAL_KEYS])).toEqual(
      []
    );
  });

  it('InvalidatePatientCache reaches the caller clinic patients only', async () => {
    const world = createWorld();

    await runWrite(world, clinicUser, metadataOfHelper('InvalidatePatientCache'));

    expect(world.server.has(`clinic:${CLINIC_A}:patient:${USER_A}:records:v1`)).toBe(false);
    expect(deleted(world, [...SECURITY_KEYS, ...TENANT_B_KEYS, ...UNOWNED_GLOBAL_KEYS])).toEqual(
      []
    );
  });
});

function metadataOfHelper(
  decorator: string,
  options?: CacheInvalidationOptions
): CacheInvalidationOptions {
  return metadataOf({
    file: 'helper',
    line: 0,
    decorator,
    patterns: options?.patterns ?? [],
    tags: options?.tags ?? [],
  });
}

describe('POST /auth/logout', () => {
  const logoutRequest: TestRequest = {
    method: 'POST',
    url: '/auth/logout',
    headers: {},
    params: {},
    user: { sub: USER_A, role: 'PATIENT' },
    clinicContext: { clinicId: CLINIC_A },
  };

  it("cannot delete another user's lockout, attempt counters or sessions", async () => {
    const world = createWorld();
    const logout = enumerateDeclarations().find(
      declaration =>
        declaration.file === 'services/auth/auth.controller.ts' &&
        declaration.tags.join() === 'user_sessions,auth'
    );
    expect(logout).toBeDefined();

    await runWrite(world, logoutRequest, metadataOf(logout as Declaration));

    for (const key of [
      `auth:lockout:${USER_B}:v1`,
      `auth:attempts:${USER_B}:v1`,
      `user_sessions:${USER_B}:v1`,
      'auth:lockout:victim@example.com:v1',
    ]) {
      expect(world.server.has(key)).toBe(true);
    }
    expect(deleted(world, SECURITY_KEYS)).toEqual([]);
  });

  it("removes only the caller's own user keys", async () => {
    const world = createWorld();
    world.server.seed(`user:${USER_A}:sessions:v1`);

    await runWrite(world, logoutRequest, { patterns: ['user:{userId}:*'], tags: [] });

    expect(world.server.has(`user:${USER_A}:profile:v1`)).toBe(false);
    expect(world.server.has(`user:${USER_A}:sessions:v1`)).toBe(false);
    expect(
      world.server.has(
        `clinic:${CLINIC_A}:user:${USER_A}:sessions:getSessions:u-${USER_A}:q-aaaa:v1`
      )
    ).toBe(false);
    expect(world.server.has(`user:${USER_B}:profile:v1`)).toBe(true);
    expect(
      world.server.has(
        `clinic:${CLINIC_B}:user:${USER_B}:sessions:getSessions:u-${USER_B}:q-aaaa:v1`
      )
    ).toBe(true);
  });

  it('would still be harmless if the old global patterns were declared again (defense in depth)', async () => {
    const world = createWorld();

    await runWrite(world, logoutRequest, {
      patterns: ['user:{userId}:*', 'user_sessions:*', 'auth:*'],
      tags: [],
    });

    expect(deleted(world, SECURITY_KEYS)).toEqual([]);
    expect(world.logger.log).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringContaining('protected-namespace'),
      'HealthcareCacheInterceptor',
      expect.objectContaining({ pattern: 'auth:*' })
    );
  });
});

describe('the cache layer refuses protected namespaces whoever asks', () => {
  it.each([
    'auth:*',
    'auth:lockout:*',
    'auth:attempts:*',
    'user_sessions:*',
    'session*',
    'jwt:*',
    'otp*',
    'phi:access:audit',
    'security:*',
    'rate_limit:*',
    'lock:*',
    'cache:tag:*',
  ])('invalidateCacheByPattern(%s) deletes nothing', async pattern => {
    const world = createWorld();

    const count = await world.cacheService.invalidateCacheByPattern(pattern);

    expect(count).toBe(0);
    expect(deleted(world, SECURITY_KEYS)).toEqual([]);
  });

  it.each(['*', '*:v1', '*user-bbbb-0002*', '*lockout*', '*attempts*', '*sessions*', '*audit*'])(
    'a broad glob (%s) spares every protected key',
    async pattern => {
      const world = createWorld();

      await world.cacheService.invalidateCacheByPattern(pattern);

      expect(deleted(world, SECURITY_KEYS)).toEqual([]);
    }
  );

  it('the admin clear is the only way to delete them, and only with the explicit flag', async () => {
    const plain = createWorld();
    await plain.cacheService.clearCache('*');
    expect(deleted(plain, SECURITY_KEYS)).toEqual([]);
    expect(
      deleted(plain, [...TENANT_B_KEYS, ...UNOWNED_GLOBAL_KEYS, ...TENANT_A_KEYS]).length
    ).toBeGreaterThan(0);

    const everything = createWorld();
    await everything.cacheService.clearAllCache();
    expect(deleted(everything, SECURITY_KEYS)).toEqual([]);

    const explicit = createWorld();
    await explicit.cacheService.clearCache('*', { includeProtected: true });
    expect(survivors(explicit, SECURITY_KEYS)).toEqual([]);
  });

  it('every protected key in the world really is classified as protected', () => {
    SECURITY_KEYS.forEach(key => expect(isProtectedKey(key)).toBe(true));
    [...TENANT_B_KEYS, ...UNOWNED_GLOBAL_KEYS, ...TENANT_A_KEYS].forEach(key =>
      expect(isProtectedKey(key)).toBe(false)
    );
  });
});

describe('CacheService targeted invalidations', () => {
  async function run(action: (service: CacheService) => Promise<unknown>): Promise<World> {
    const world = createWorld();
    await action(world.cacheService);
    return world;
  }

  it.each([
    ['invalidateClinicCache', (service: CacheService) => service.invalidateClinicCache(CLINIC_A)],
    [
      'invalidatePatientCache',
      (service: CacheService) => service.invalidatePatientCache(USER_A, CLINIC_A),
    ],
    [
      'invalidateDoctorCache',
      (service: CacheService) => service.invalidateDoctorCache(DOCTOR_A, CLINIC_A),
    ],
    [
      'invalidateAppointmentCache',
      (service: CacheService) =>
        service.invalidateAppointmentCache(APPOINTMENT_A, USER_A, DOCTOR_A, CLINIC_A),
    ],
    [
      'invalidateVideoCacheForAppointment',
      (service: CacheService) => service.invalidateVideoCacheForAppointment(APPOINTMENT_A),
    ],
    [
      'invalidateMyAppointmentsCache',
      (service: CacheService) => service.invalidateMyAppointmentsCache(USER_A),
    ],
    [
      'invalidateUpcomingAppointmentsCache',
      (service: CacheService) => service.invalidateUpcomingAppointmentsCache(USER_A),
    ],
  ])('%s touches neither security state nor another tenant', async (_name, action) => {
    const world = await run(action);

    expect(deleted(world, SECURITY_KEYS)).toEqual([]);
    expect(deleted(world, TENANT_B_KEYS)).toEqual([]);
    expect(deleted(world, UNOWNED_GLOBAL_KEYS)).toEqual([]);
  });

  it('escapes glob characters in ids, so an id of * cannot flush a clinic or a patient', async () => {
    const world = await run(async service => {
      await service.invalidateClinicCache('*');
      await service.invalidatePatientCache('*', '*');
      await service.invalidateDoctorCache('*', '*');
      await service.invalidateAppointmentCache('*', '*', '*', '*');
    });

    expect(
      deleted(world, [...SECURITY_KEYS, ...TENANT_B_KEYS, ...TENANT_A_KEYS, ...UNOWNED_GLOBAL_KEYS])
    ).toEqual([]);
  });

  it('invalidateClinicCache removes the clinic keys', async () => {
    const world = await run(service => service.invalidateClinicCache(CLINIC_A));

    expect(
      world.server.has(`clinic:${CLINIC_A}:appointments:list:getList:r-DOCTOR:q-aaaa:v1`)
    ).toBe(false);
    expect(
      world.server.has(`clinic:${CLINIC_B}:appointments:list:getList:r-DOCTOR:q-aaaa:v1`)
    ).toBe(true);
  });
});

describe('CacheService failure handling', () => {
  it('invalidateCacheByPattern never throws: a failed delete is logged at ERROR and reported as 0', async () => {
    const world = createWorld();
    world.server.failNext('scan', new Error('Command timed out'));

    const count = await world.cacheService.invalidateCacheByPattern('clinic:*');

    expect(count).toBe(0);
    expect(world.logger.log).toHaveBeenCalledWith(
      expect.anything(),
      LogLevel.ERROR,
      expect.stringContaining('Cache pattern invalidation failed'),
      'CacheService.invalidateCacheByPattern',
      expect.objectContaining({
        pattern: 'clinic:*',
        error: expect.stringContaining('Failed to delete cache keys'),
      })
    );
  });

  it('invalidateCacheByTag never throws and keeps the undeleted keys indexed', async () => {
    const world = createWorld();
    const repository = (world.cacheService as unknown as { cacheRepository: CacheRepository })
      .cacheRepository;
    await repository.set('entry:a', 'x', { ttl: 300, tags: ['appointments'] });
    world.server.failNext('unlink', new Error('OOM'));

    const count = await world.cacheService.invalidateCacheByTag('appointments');

    expect(count).toBe(0);
    expect(world.server.has('entry:a:v1')).toBe(true);
    expect(await world.server.client.smembers('cache:tag:appointments')).toEqual(['entry:a:v1']);
    expect(world.logger.log).toHaveBeenCalledWith(
      expect.anything(),
      LogLevel.ERROR,
      expect.stringContaining('Cache tag invalidation failed'),
      'CacheService.invalidateCacheByTag',
      expect.objectContaining({ tag: 'appointments' })
    );

    // the next invalidation retries the key that was left behind
    expect(await world.cacheService.invalidateCacheByTag('appointments')).toBe(1);
    expect(world.server.has('entry:a:v1')).toBe(false);
  });

  it('the admin clear surfaces a failure instead of hiding it', async () => {
    const world = createWorld();
    world.server.failNext('scan', new Error('Command timed out'));

    await expect(world.cacheService.clearCache('clinic:*')).rejects.toThrow(
      'Failed to delete cache keys'
    );
  });
});
