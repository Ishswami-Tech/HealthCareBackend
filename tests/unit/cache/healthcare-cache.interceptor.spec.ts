/// <reference types="jest" />
/**
 * Multi-tenant cache-key isolation for HealthcareCacheInterceptor.
 *
 * Guards run BEFORE interceptors, so a cache HIT replays a stored response without the handler (and
 * its ownership checks) ever running. The key therefore has to be derived from the authenticated
 * principal and the guard-validated clinic, never from caller-controlled input:
 *
 *  - `?userId=<victim>` must not become the `{userId}` of the key (it used to),
 *  - `{clinicId}` must resolve to the validated clinic (it used to stay a literal "{clinicId}" that
 *    every clinic shared),
 *  - every templated key is clinic-scoped, and filters in the query still produce distinct keys.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lastValueFrom, of, throwError } from 'rxjs';
import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import { HealthcareCacheInterceptor } from '@core/interceptors/healthcare-cache.interceptor';
import { CACHE_KEY, CACHE_INVALIDATE_KEY } from '@core/decorators';
import type { CacheService } from '@infrastructure/cache/cache.service';
import type { LoggingService } from '@infrastructure/logging';
import { LogLevel } from '@core/types';

jest.mock('@infrastructure/cache/cache.service', () => ({ CacheService: class CacheService {} }));
jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));

const CLINIC_A = '11111111-1111-4111-8111-111111111111';
const CLINIC_B = '22222222-2222-4222-8222-222222222222';
const PATIENT = 'patient-0000-aaaa';
const VICTIM = 'victim-0000-bbbb';
const DOCTOR = 'doctor-0000-cccc';
const HANDLER = 'getThing';
const QUERY_DIGEST_SEGMENT = /:q-[0-9a-f]{32}$/;

interface TestUser {
  sub?: string;
  id?: string;
  role?: string;
}

interface TestRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  user?: TestUser;
  clinicContext?: { clinicId?: string };
  ip?: string;
}

type OptionsFixture = Record<string, unknown>;

function request(overrides: Partial<TestRequest> = {}): TestRequest {
  return { method: 'GET', url: '/thing', headers: {}, ...overrides };
}

function makeContext(
  req: TestRequest,
  handlerName: string,
  statusCode: number = 200
): ExecutionContext {
  const handler = (): void => undefined;
  Object.defineProperty(handler, 'name', { value: handlerName });
  return {
    getHandler: () => handler,
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({ statusCode }),
    }),
  } as unknown as ExecutionContext;
}

/** Lets fire-and-forget `void this.setCacheValue(...)` / `void this.performCacheInvalidation(...)` finish. */
async function flushAsyncWork(): Promise<void> {
  await new Promise<void>(resolve => setImmediate(resolve));
}

function createHarness() {
  const cacheService = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    cache: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(0),
    rPush: jest.fn().mockResolvedValue(1),
    invalidateCacheByTag: jest.fn().mockResolvedValue(0),
    invalidateCacheByPattern: jest.fn().mockResolvedValue(0),
    invalidatePatientCache: jest.fn().mockResolvedValue(0),
    invalidateDoctorCache: jest.fn().mockResolvedValue(0),
    invalidateClinicCache: jest.fn().mockResolvedValue(0),
  };
  const loggingService = { log: jest.fn().mockResolvedValue(undefined) };
  const reflector = { get: jest.fn() };
  const interceptor = new HealthcareCacheInterceptor(
    cacheService as unknown as CacheService,
    reflector as unknown as Reflector,
    loggingService as unknown as LoggingService
  );

  async function run(
    req: TestRequest,
    metadata: { cache?: OptionsFixture; invalidate?: OptionsFixture },
    handlerName: string = HANDLER,
    statusCode: number = 200
  ): Promise<{ result: unknown; handlerCalls: number }> {
    reflector.get.mockImplementation((metaKey: string) => {
      if (metaKey === CACHE_KEY) return metadata.cache;
      if (metaKey === CACHE_INVALIDATE_KEY) return metadata.invalidate;
      return undefined;
    });
    let handlerCalls = 0;
    const next = {
      handle: () => {
        handlerCalls += 1;
        return of({ ok: true });
      },
    };
    const observable = await interceptor.intercept(makeContext(req, handlerName, statusCode), next);
    const result = await lastValueFrom(observable);
    await flushAsyncWork();
    return { result, handlerCalls };
  }

  /** Runs a request whose handler throws `failure`; resolves/rejects like the HTTP pipeline. */
  async function runFailing(
    req: TestRequest,
    metadata: { cache?: OptionsFixture; invalidate?: OptionsFixture },
    failure: Error
  ): Promise<unknown> {
    reflector.get.mockImplementation((metaKey: string) => {
      if (metaKey === CACHE_KEY) return metadata.cache;
      if (metaKey === CACHE_INVALIDATE_KEY) return metadata.invalidate;
      return undefined;
    });
    const next = { handle: () => throwError(() => failure) };
    try {
      return await lastValueFrom(await interceptor.intercept(makeContext(req, HANDLER), next));
    } finally {
      await flushAsyncWork();
    }
  }

  /** Calls to the logger at ERROR level. */
  function errorLogs(): unknown[][] {
    return (loggingService.log.mock.calls as unknown[][]).filter(
      call => call[1] === LogLevel.ERROR
    );
  }

  /** The key the interceptor looked up for a cached GET. */
  async function readKey(
    req: TestRequest,
    cache: OptionsFixture,
    handlerName: string = HANDLER
  ): Promise<string> {
    cacheService.get.mockClear();
    await run(req, { cache }, handlerName);
    const key: unknown = cacheService.get.mock.calls[0]?.[0];
    if (typeof key !== 'string') {
      throw new Error('interceptor did not look up a cache key');
    }
    return key;
  }

  /** Tags registered with the entry written after a cache miss (standard SWR branch). */
  async function readTags(req: TestRequest, cache: OptionsFixture): Promise<string[]> {
    cacheService.cache.mockClear();
    await run(req, { cache });
    const options: unknown = cacheService.cache.mock.calls[0]?.[2];
    const tags = (options as { tags?: string[] } | undefined)?.tags;
    return tags ?? [];
  }

  /** Tags invalidated by a mutating request. */
  async function writeTags(req: TestRequest, invalidate: OptionsFixture): Promise<string[]> {
    cacheService.invalidateCacheByTag.mockClear();
    await run(req, { invalidate });
    return cacheService.invalidateCacheByTag.mock.calls.map(call => String(call[0]));
  }

  async function writePatterns(
    req: TestRequest,
    invalidate: OptionsFixture,
    statusCode: number = 200
  ): Promise<string[]> {
    cacheService.invalidateCacheByPattern.mockClear();
    await run(req, { invalidate }, HANDLER, statusCode);
    return cacheService.invalidateCacheByPattern.mock.calls.map(call => String(call[0]));
  }

  return {
    cacheService,
    loggingService,
    run,
    runFailing,
    errorLogs,
    readKey,
    readTags,
    writeTags,
    writePatterns,
  };
}

const actor = (sub: string, role: string = 'PATIENT'): TestUser => ({ sub, role });
const inClinic = (clinicId: string): { clinicId: string } => ({ clinicId });

describe('HealthcareCacheInterceptor key isolation', () => {
  describe('identity comes from the authenticated principal, never from the query', () => {
    const cache: OptionsFixture = { keyTemplate: 'appointments:upcoming:{userId}', ttl: 60 };

    it('a patient sending ?userId=<victim> resolves {userId} to the patient, not the victim', async () => {
      const harness = createHarness();

      const victimKey = await harness.readKey(
        request({ user: actor(VICTIM), clinicContext: inClinic(CLINIC_A) }),
        cache
      );
      const spoofedKey = await harness.readKey(
        request({
          user: actor(PATIENT),
          query: { userId: VICTIM },
          clinicContext: inClinic(CLINIC_A),
        }),
        cache
      );

      expect(spoofedKey).not.toBe(victimKey);
      expect(spoofedKey).toContain(`appointments:upcoming:${PATIENT}:`);
      expect(spoofedKey).not.toContain(VICTIM);
    });

    it.each([VICTIM, '*', '{userId}', 'a:b:c', '../../x', ''])(
      'no query userId value (%p) can make the key address another user',
      async spoof => {
        const harness = createHarness();
        const victimKey = await harness.readKey(
          request({ user: actor(VICTIM), clinicContext: inClinic(CLINIC_A) }),
          cache
        );

        const spoofedKey = await harness.readKey(
          request({
            user: actor(PATIENT),
            query: { userId: spoof },
            clinicContext: inClinic(CLINIC_A),
          }),
          cache
        );

        expect(spoofedKey).not.toBe(victimKey);
        expect(spoofedKey).toContain(`appointments:upcoming:${PATIENT}:`);
      }
    );

    it('a victim keeps a stable key regardless of what other users put in their query', async () => {
      const harness = createHarness();
      const baseline = await harness.readKey(
        request({ user: actor(VICTIM), clinicContext: inClinic(CLINIC_A) }),
        cache
      );

      for (const query of [{}, { userId: PATIENT }, { userId: VICTIM }, { status: 'X' }]) {
        const attackerKey = await harness.readKey(
          request({ user: actor(PATIENT), query, clinicContext: inClinic(CLINIC_A) }),
          cache
        );
        expect(attackerKey).not.toBe(baseline);
      }
    });

    it('falls back to user.id when the token has no sub', async () => {
      const harness = createHarness();

      const key = await harness.readKey(
        request({ user: { id: PATIENT, role: 'PATIENT' }, clinicContext: inClinic(CLINIC_A) }),
        cache
      );

      expect(key).toContain(`appointments:upcoming:${PATIENT}:`);
    });

    it('resolves {userRole} from the token, not from ?userRole=', async () => {
      const harness = createHarness();

      const key = await harness.readKey(
        request({
          user: actor(PATIENT, 'PATIENT'),
          query: { userRole: 'SUPER_ADMIN' },
          clinicContext: inClinic(CLINIC_A),
        }),
        { keyTemplate: 'scope:{userRole}' }
      );

      expect(key).toContain('scope:PATIENT:');
      expect(key).not.toContain('SUPER_ADMIN');
    });

    it('does not let the query fill {userId} for an unauthenticated request either', async () => {
      const harness = createHarness();

      const key = await harness.readKey(request({ query: { userId: VICTIM } }), cache);

      expect(key).not.toContain(VICTIM);
      expect(key).not.toContain('{');
    });
  });

  describe('a route param that declares the resource is preserved', () => {
    const cache: OptionsFixture = { keyTemplate: 'ehr:comprehensive:{userId}', ttl: 60 };

    it('GET /ehr/comprehensive/:userId keys on the route param (the patient), not on the caller', async () => {
      const harness = createHarness();

      const keyForPatientP = await harness.readKey(
        request({
          user: actor(DOCTOR, 'DOCTOR'),
          params: { userId: PATIENT },
          clinicContext: inClinic(CLINIC_A),
        }),
        cache
      );
      const keyForPatientV = await harness.readKey(
        request({
          user: actor(DOCTOR, 'DOCTOR'),
          params: { userId: VICTIM },
          clinicContext: inClinic(CLINIC_A),
        }),
        cache
      );

      expect(keyForPatientP).toContain(`ehr:comprehensive:${PATIENT}:`);
      expect(keyForPatientV).toContain(`ehr:comprehensive:${VICTIM}:`);
      expect(keyForPatientP).not.toBe(keyForPatientV);
      expect(keyForPatientP).not.toContain(DOCTOR);
    });

    it('route params win over a query value of the same name', async () => {
      const harness = createHarness();

      const key = await harness.readKey(
        request({
          user: actor(DOCTOR, 'DOCTOR'),
          params: { userId: PATIENT },
          query: { userId: VICTIM },
          clinicContext: inClinic(CLINIC_A),
        }),
        cache
      );

      expect(key).toContain(`ehr:comprehensive:${PATIENT}:`);
      expect(key).not.toContain(VICTIM);
    });

    it('a route :id can not be overridden by ?id=', async () => {
      const harness = createHarness();

      const key = await harness.readKey(
        request({
          user: actor(DOCTOR, 'DOCTOR'),
          params: { id: 'clinic-mine' },
          query: { id: 'clinic-theirs' },
          clinicContext: inClinic(CLINIC_A),
        }),
        { keyTemplate: 'clinic:{id}:doctors' }
      );

      expect(key).toContain(':clinic:clinic-mine:doctors:');
      expect(key).not.toContain('clinic-theirs');
    });
  });

  describe('clinic isolation', () => {
    it('two clinics with an identical URL and query get different keys even when the template lacks {clinicId}', async () => {
      const harness = createHarness();
      const cache: OptionsFixture = { keyTemplate: 'plugins:info', ttl: 60 };
      const shared = { url: '/appointments/plugins/info', query: { page: '1' } };

      const keyA = await harness.readKey(
        request({ ...shared, user: actor(DOCTOR, 'DOCTOR'), clinicContext: inClinic(CLINIC_A) }),
        cache
      );
      const keyB = await harness.readKey(
        request({ ...shared, user: actor(DOCTOR, 'DOCTOR'), clinicContext: inClinic(CLINIC_B) }),
        cache
      );

      expect(keyA).not.toBe(keyB);
      expect(keyA.startsWith(`clinic:${CLINIC_A}:`)).toBe(true);
      expect(keyB.startsWith(`clinic:${CLINIC_B}:`)).toBe(true);
    });

    it('resolves {clinicId} to the validated clinic when the route has no clinicId param', async () => {
      const harness = createHarness();

      const key = await harness.readKey(
        request({ user: actor(DOCTOR, 'DOCTOR'), clinicContext: inClinic(CLINIC_A) }),
        { keyTemplate: 'users:role:doctors:{clinicId}' }
      );

      expect(key).toBe(
        `clinic:${CLINIC_A}:users:role:doctors:${CLINIC_A}:${HANDLER}:r-DOCTOR:q-${key.slice(-32)}`
      );
      expect(key).not.toContain('{');
    });

    it('never takes {clinicId} from the query', async () => {
      const harness = createHarness();

      const key = await harness.readKey(
        request({
          user: actor(DOCTOR, 'DOCTOR'),
          query: { clinicId: CLINIC_B },
          clinicContext: inClinic(CLINIC_A),
        }),
        { keyTemplate: 'users:role:doctors:{clinicId}' }
      );

      expect(key).not.toContain(CLINIC_B);
      expect(key).toContain(`users:role:doctors:${CLINIC_A}:`);
    });

    it('keeps a route :clinicId as the resource clinic but still scopes the key by the validated clinic', async () => {
      const harness = createHarness();
      const cache: OptionsFixture = { keyTemplate: 'ehr:clinic:{clinicId}:analytics' };

      // A user of clinic A asking for clinic B's analytics must not read clinic B's own entry.
      const crossTenantKey = await harness.readKey(
        request({
          user: actor(DOCTOR, 'DOCTOR'),
          params: { clinicId: CLINIC_B },
          clinicContext: inClinic(CLINIC_A),
        }),
        cache
      );
      const ownKey = await harness.readKey(
        request({
          user: actor(DOCTOR, 'DOCTOR'),
          params: { clinicId: CLINIC_B },
          clinicContext: inClinic(CLINIC_B),
        }),
        cache
      );

      expect(crossTenantKey).not.toBe(ownKey);
      expect(crossTenantKey.startsWith(`clinic:${CLINIC_A}:`)).toBe(true);
      expect(ownKey.startsWith(`clinic:${CLINIC_B}:`)).toBe(true);
    });

    it('still honours clinicSpecific + route clinicId when the request has no clinic context', async () => {
      const harness = createHarness();

      const key = await harness.readKey(
        request({ user: actor(DOCTOR, 'DOCTOR'), params: { clinicId: CLINIC_B } }),
        { keyTemplate: 'plugins:info', clinicSpecific: true }
      );

      expect(key.startsWith(`clinic:${CLINIC_B}:plugins:info:`)).toBe(true);
    });

    it('keeps a key without any clinic prefix when neither a clinic context nor clinicSpecific applies', async () => {
      const harness = createHarness();

      const key = await harness.readKey(request({ user: actor(DOCTOR, 'DOCTOR') }), {
        keyTemplate: 'plugins:info',
      });

      expect(key.startsWith('plugins:info:')).toBe(true);
    });
  });

  describe('every templated key resolves completely', () => {
    interface TemplateFixture {
      readonly file: string;
      readonly template: string;
      readonly routeParams: readonly string[];
    }

    function collectControllerFiles(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) return collectControllerFiles(fullPath);
        return entry.name.endsWith('controller.ts') ? [fullPath] : [];
      });
    }

    function routeParamsFor(lines: readonly string[], index: number, prefix: string): string[] {
      for (let cursor = index; cursor >= Math.max(0, index - 40); cursor -= 1) {
        const decorator = /@(?:Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)')?/.exec(
          lines[cursor] ?? ''
        );
        if (decorator) {
          const path = `${prefix}/${decorator[1] ?? ''}`;
          return Array.from(path.matchAll(/:(\w+)/g), match => match[1] ?? '');
        }
      }
      return [];
    }

    function routeParamValues(names: readonly string[]): Record<string, string> {
      return Object.fromEntries(names.map((name): [string, string] => [name, `route-${name}`]));
    }

    /** Every `keyTemplate` literal used by a controller, with the route params its handler declares. */
    function enumerateKeyTemplates(): TemplateFixture[] {
      const srcRoot = join(__dirname, '..', '..', '..', 'src');
      const fixtures: TemplateFixture[] = [];
      for (const file of collectControllerFiles(srcRoot)) {
        const lines = readFileSync(file, 'utf8').split('\n');
        const source = lines.join('\n');
        const prefix = /@Controller\(\s*(?:\{[^}]*path:\s*)?'([^']*)'/.exec(source)?.[1] ?? '';
        lines.forEach((line, index) => {
          if (!line.includes('keyTemplate:')) return;
          const literal = /'([^']*)'/.exec(line) ?? /'([^']*)'/.exec(lines[index + 1] ?? '');
          if (!literal?.[1]) return;
          fixtures.push({
            file,
            template: literal[1],
            routeParams: routeParamsFor(lines, index, prefix),
          });
        });
      }
      return fixtures;
    }

    const templates = enumerateKeyTemplates();

    it('finds the controller key templates this test is meant to cover', () => {
      expect(templates.length).toBeGreaterThanOrEqual(40);
      const clinicIdTemplates = templates.filter(item => item.template.includes('{clinicId}'));
      expect(clinicIdTemplates.length).toBeGreaterThanOrEqual(10);
    });

    it('leaves no literal {placeholder} in the key of any controller keyTemplate', async () => {
      const harness = createHarness();
      const offenders: string[] = [];

      for (const { file, template, routeParams } of templates) {
        const params = routeParamValues(routeParams);
        const variants: TestRequest[] = [
          // authenticated, validated clinic, only the route params present
          request({ user: actor(DOCTOR, 'DOCTOR'), params, clinicContext: inClinic(CLINIC_A) }),
          // unauthenticated, no clinic, no params at all
          request(),
          // authenticated but no clinic context (e.g. SUPER_ADMIN without a clinic header)
          request({ user: actor(DOCTOR, 'SUPER_ADMIN') }),
        ];
        for (const variant of variants) {
          const key = await harness.readKey(variant, { keyTemplate: template }, 'handler');
          if (key.includes('{') || key.includes('}'))
            offenders.push(`${file}: ${template} -> ${key}`);
        }
      }

      expect(offenders).toEqual([]);
    });

    it('resolves {clinicId} to the validated clinic for every template whose route has no clinicId param', async () => {
      const harness = createHarness();
      const subjects = templates.filter(
        item => item.template.includes('{clinicId}') && !item.routeParams.includes('clinicId')
      );
      expect(subjects.length).toBeGreaterThanOrEqual(10);

      for (const { template, routeParams } of subjects) {
        const params = routeParamValues(routeParams);
        const key = await harness.readKey(
          request({ user: actor(DOCTOR, 'DOCTOR'), params, clinicContext: inClinic(CLINIC_A) }),
          { keyTemplate: template },
          'handler'
        );
        const withoutScope = key.slice(`clinic:${CLINIC_A}:`.length);

        expect(key.startsWith(`clinic:${CLINIC_A}:`)).toBe(true);
        expect(withoutScope).toContain(CLINIC_A);
        expect(key).not.toContain('{clinicId}');
      }
    });

    it('scopes every controller keyTemplate by the validated clinic, with or without {clinicId}', async () => {
      const harness = createHarness();

      for (const { template, routeParams } of templates) {
        const params = routeParamValues(routeParams);
        const keyA = await harness.readKey(
          request({ user: actor(DOCTOR, 'DOCTOR'), params, clinicContext: inClinic(CLINIC_A) }),
          { keyTemplate: template },
          'handler'
        );
        const keyB = await harness.readKey(
          request({ user: actor(DOCTOR, 'DOCTOR'), params, clinicContext: inClinic(CLINIC_B) }),
          { keyTemplate: template },
          'handler'
        );

        expect(keyA).not.toBe(keyB);
        expect(keyA.startsWith(`clinic:${CLINIC_A}:`)).toBe(true);
        expect(keyB.startsWith(`clinic:${CLINIC_B}:`)).toBe(true);
      }
    });

    it('resolves every tag placeholder used by the controllers on the read path', async () => {
      const harness = createHarness();
      const tagLiterals = new Set<string>();
      for (const file of collectControllerFiles(join(__dirname, '..', '..', '..', 'src'))) {
        for (const line of readFileSync(file, 'utf8').split('\n')) {
          if (!/\btags:\s*\[/.test(line)) continue;
          for (const literal of line.matchAll(/'([^']*\{\w+\}[^']*)'/g)) {
            if (literal[1]) tagLiterals.add(literal[1]);
          }
        }
      }
      expect(tagLiterals.size).toBeGreaterThan(5);

      const tags = await harness.readTags(
        request({ user: actor(DOCTOR, 'DOCTOR'), clinicContext: inClinic(CLINIC_A) }),
        { keyTemplate: 'any', tags: [...tagLiterals] }
      );

      expect(tags).toHaveLength(tagLiterals.size);
      expect(tags.filter(tag => tag.includes('{'))).toEqual([]);
    });
  });

  describe('query filters', () => {
    const cache: OptionsFixture = { keyTemplate: 'appointments:upcoming:{userId}' };
    const caller = (query?: Record<string, unknown>): TestRequest =>
      request({
        user: actor(DOCTOR, 'DOCTOR'),
        clinicContext: inClinic(CLINIC_A),
        ...(query ? { query } : {}),
      });

    it('different query strings produce different keys', async () => {
      const harness = createHarness();

      const none = await harness.readKey(caller(), cache);
      const open = await harness.readKey(caller({ status: 'OPEN' }), cache);
      const closed = await harness.readKey(caller({ status: 'CLOSED' }), cache);
      const paged = await harness.readKey(caller({ status: 'OPEN', page: '2' }), cache);

      expect(new Set([none, open, closed, paged]).size).toBe(4);
    });

    it('a staff filter on another user is a distinct entry that still resolves {userId} to the caller', async () => {
      const harness = createHarness();

      const own = await harness.readKey(caller(), cache);
      const filtered = await harness.readKey(caller({ userId: PATIENT, status: 'OPEN' }), cache);

      expect(filtered).not.toBe(own);
      expect(filtered).toContain(`appointments:upcoming:${DOCTOR}:`);
      expect(filtered).not.toContain(PATIENT);
    });

    it('the same query in a different order yields the same key', async () => {
      const harness = createHarness();

      const first = await harness.readKey(
        caller({ status: 'OPEN', page: '2', limit: '10' }),
        cache
      );
      const second = await harness.readKey(
        caller({ limit: '10', page: '2', status: 'OPEN' }),
        cache
      );

      expect(first).toBe(second);
    });

    it('canonicalises nested query objects and keeps array order significant', async () => {
      const harness = createHarness();

      const nestedA = await harness.readKey(caller({ f: { b: '1', a: '2' } }), cache);
      const nestedB = await harness.readKey(caller({ f: { a: '2', b: '1' } }), cache);
      const arrayAsc = await harness.readKey(caller({ ids: ['1', '2'] }), cache);
      const arrayDesc = await harness.readKey(caller({ ids: ['2', '1'] }), cache);

      expect(nestedA).toBe(nestedB);
      expect(arrayAsc).not.toBe(arrayDesc);
    });

    it('ends every templated key with the handler name and a short query digest', async () => {
      const harness = createHarness();

      const key = await harness.readKey(caller({ status: 'OPEN' }), cache);

      expect(key).toMatch(QUERY_DIGEST_SEGMENT);
      expect(key).toContain(`:${HANDLER}:`);
    });

    it('keeps placeholder values from re-introducing a placeholder', async () => {
      const harness = createHarness();

      const key = await harness.readKey(caller({ type: '{clinicId}', other: '}{' }), {
        keyTemplate: 'ehr:vitals:{userId}:{type}',
      });

      expect(key).not.toContain('{');
      expect(key).not.toContain('}');
      expect(key).toContain(`ehr:vitals:${DOCTOR}:%7BclinicId%7D:`);
    });
  });

  describe('repeated placeholders', () => {
    it('replaces every occurrence in a key template', async () => {
      const harness = createHarness();

      const key = await harness.readKey(
        request({ user: actor(PATIENT), clinicContext: inClinic(CLINIC_A) }),
        { keyTemplate: 'x:{userId}:{userId}/{clinicId}:{clinicId}' }
      );

      expect(key).toContain(`x:${PATIENT}:${PATIENT}/${CLINIC_A}:${CLINIC_A}:`);
      expect(key).not.toContain('{');
    });

    it('replaces every occurrence in a tag template', async () => {
      const harness = createHarness();

      const tags = await harness.readTags(
        request({ user: actor(PATIENT), clinicContext: inClinic(CLINIC_A) }),
        { keyTemplate: 'k', tags: ['pair:{userId}:{userId}'] }
      );

      expect(tags).toEqual([`pair:${PATIENT}:${PATIENT}`]);
    });

    it('replaces every occurrence in an invalidation pattern', async () => {
      const harness = createHarness();

      const patterns = await harness.writePatterns(
        request({
          method: 'PATCH',
          user: actor(DOCTOR, 'DOCTOR'),
          params: { id: 'u1' },
          clinicContext: inClinic(CLINIC_A),
        }),
        { patterns: ['users:{id}:{id}:*'] }
      );

      expect(patterns).toEqual([`clinic:${CLINIC_A}:users:u1:u1:*`]);
    });
  });

  describe('unauthenticated requests', () => {
    it('still get a usable key and a normal cache lookup', async () => {
      const harness = createHarness();

      const { result, handlerCalls } = await harness.run(request(), {
        cache: { keyTemplate: 'plugins:info' },
      });
      const key: unknown = harness.cacheService.get.mock.calls[0]?.[0];

      expect(result).toEqual({ ok: true });
      expect(handlerCalls).toBe(1);
      expect(typeof key).toBe('string');
      expect(key).toMatch(/^plugins:info:getThing:q-[0-9a-f]{32}$/);
    });

    it('serves a hit without invoking the handler, as before', async () => {
      const harness = createHarness();
      harness.cacheService.get.mockResolvedValue({ cached: true });

      const { result, handlerCalls } = await harness.run(request(), {
        cache: { keyTemplate: 'plugins:info' },
      });

      expect(result).toEqual({ cached: true });
      expect(handlerCalls).toBe(0);
    });

    it('does not cache or invalidate for routes without cache metadata', async () => {
      const harness = createHarness();

      const { handlerCalls } = await harness.run(request(), {});

      expect(handlerCalls).toBe(1);
      expect(harness.cacheService.get).not.toHaveBeenCalled();
    });
  });

  describe('keys without a template', () => {
    const noTemplate: OptionsFixture = { ttl: 60 };

    it('keeps the legacy shape when nobody is authenticated and there is no clinic', async () => {
      const harness = createHarness();

      const key = await harness.readKey(
        request({ url: '/doctors/1?x=1', params: { id: '1' }, query: { x: '1' } }),
        noTemplate
      );

      expect(key).toBe('healthcare:/doctors/1?x=1:{"id":"1"}:{"x":"1"}');
    });

    it('separates callers on the same URL (personal endpoints such as /me)', async () => {
      const harness = createHarness();

      const mine = await harness.readKey(
        request({ url: '/user/profile', user: actor(PATIENT), clinicContext: inClinic(CLINIC_A) }),
        noTemplate
      );
      const theirs = await harness.readKey(
        request({ url: '/user/profile', user: actor(VICTIM), clinicContext: inClinic(CLINIC_A) }),
        noTemplate
      );

      expect(mine).not.toBe(theirs);
      expect(mine).toBe(`healthcare:clinic:${CLINIC_A}:user:${PATIENT}:/user/profile::`);
    });

    it('separates clinics on the same URL for the same user', async () => {
      const harness = createHarness();

      const inA = await harness.readKey(
        request({
          url: '/doctors',
          user: actor(DOCTOR, 'DOCTOR'),
          clinicContext: inClinic(CLINIC_A),
        }),
        noTemplate
      );
      const inB = await harness.readKey(
        request({
          url: '/doctors',
          user: actor(DOCTOR, 'DOCTOR'),
          clinicContext: inClinic(CLINIC_B),
        }),
        noTemplate
      );

      expect(inA).not.toBe(inB);
    });
  });

  describe('custom key generators are left alone', () => {
    it('uses the generator output verbatim', async () => {
      const harness = createHarness();

      const key = await harness.readKey(
        request({ user: actor(PATIENT), clinicContext: inClinic(CLINIC_A) }),
        { customKeyGenerator: () => 'billing:custom:key' }
      );

      expect(key).toBe('billing:custom:key');
    });
  });

  describe('read and write paths resolve tags identically', () => {
    const tagTemplates = ['ehr', 'user:{userId}', 'clinic:{clinicId}', 'patient:{userId}:{userId}'];
    const patientRecord = (overrides: Partial<TestRequest> = {}): TestRequest =>
      request({
        user: actor(DOCTOR, 'DOCTOR'),
        params: { userId: PATIENT },
        clinicContext: inClinic(CLINIC_A),
        ...overrides,
      });

    it('registers on a GET exactly the tags a mutation of the same resource invalidates', async () => {
      const harness = createHarness();

      const registered = await harness.readTags(patientRecord(), {
        keyTemplate: 'ehr:comprehensive:{userId}',
        tags: tagTemplates,
      });
      const invalidated = await harness.writeTags(patientRecord({ method: 'PATCH' }), {
        patterns: [],
        tags: tagTemplates,
      });

      expect(registered).toEqual([
        'ehr',
        `user:${PATIENT}`,
        `clinic:${CLINIC_A}`,
        `patient:${PATIENT}:${PATIENT}`,
      ]);
      expect(invalidated).toEqual(registered);
    });

    it('matches what services invalidate (user:<id>, clinic:<id>) for the PHI set() branch too', async () => {
      const harness = createHarness();

      await harness.run(patientRecord(), {
        cache: { keyTemplate: 'ehr:comprehensive:{userId}', containsPHI: true, tags: tagTemplates },
      });
      const options: unknown = harness.cacheService.set.mock.calls[0]?.[2];

      expect((options as { tags: string[] }).tags).toEqual(
        expect.arrayContaining([`user:${PATIENT}`, `clinic:${CLINIC_A}`])
      );
    });

    it('never puts the query digest into a tag, on either path', async () => {
      const harness = createHarness();
      const query = { status: 'OPEN', page: '3' };

      const registered = await harness.readTags(patientRecord({ query }), {
        keyTemplate: 'k',
        tags: tagTemplates,
      });
      const invalidated = await harness.writeTags(patientRecord({ method: 'POST', query }), {
        patterns: [],
        tags: tagTemplates,
      });

      for (const tag of [...registered, ...invalidated]) {
        expect(tag).not.toMatch(/q-[0-9a-f]{32}/);
      }
      expect(invalidated).toEqual(registered);
    });

    it('uses the principal, not a spoofed query or body, on both paths', async () => {
      const harness = createHarness();
      const spoof = {
        query: { userId: VICTIM, clinicId: CLINIC_B },
        body: { userId: VICTIM, clinicId: CLINIC_B },
      };
      const principalOnly = (): TestRequest =>
        request({ user: actor(PATIENT), clinicContext: inClinic(CLINIC_A) });

      const registered = await harness.readTags(
        { ...principalOnly(), query: spoof.query },
        { keyTemplate: 'k', tags: tagTemplates }
      );
      const invalidated = await harness.writeTags(
        { ...principalOnly(), method: 'POST', ...spoof },
        { patterns: [], tags: tagTemplates }
      );

      expect(registered).toContain(`user:${PATIENT}`);
      expect(registered).toContain(`clinic:${CLINIC_A}`);
      expect(invalidated).toEqual(registered);
      expect([...registered, ...invalidated].join()).not.toMatch(
        new RegExp(`${VICTIM}|${CLINIC_B}`)
      );
    });

    it('lets a write fill a non-identity placeholder from the body', async () => {
      const harness = createHarness();

      const invalidated = await harness.writeTags(
        request({
          method: 'POST',
          user: actor(DOCTOR, 'DOCTOR'),
          clinicContext: inClinic(CLINIC_A),
          body: { contact: 'a@b.c' },
        }),
        { patterns: [], tags: ['otp:{contact}'] }
      );

      expect(invalidated).toEqual(['otp:a@b.c']);
    });
  });

  describe('invalidation patterns', () => {
    const mutation = (overrides: Partial<TestRequest> = {}): TestRequest =>
      request({
        method: 'PATCH',
        user: actor(DOCTOR, 'DOCTOR'),
        clinicContext: inClinic(CLINIC_A),
        ...overrides,
      });

    it('runs unscoped patterns inside the caller clinic only, never globally', async () => {
      const harness = createHarness();

      const patterns = await harness.writePatterns(mutation({ params: { id: 'u1' } }), {
        patterns: ['users:one:{id}', 'users:all:*'],
      });

      expect(patterns).toEqual([
        `clinic:${CLINIC_A}:users:one:u1`,
        `clinic:${CLINIC_A}:users:all:*`,
      ]);
    });

    it('rewrites a wildcard clinic slot into the caller clinic and prefixes leading wildcards', async () => {
      const harness = createHarness();

      const patterns = await harness.writePatterns(mutation(), {
        patterns: ['clinic:*', '*:clinic:*', 'clinic:*:appointments'],
      });

      expect(patterns).toEqual([
        `clinic:${CLINIC_A}:*`,
        `clinic:${CLINIC_A}:*:clinic:*`,
        `clinic:${CLINIC_A}:appointments`,
      ]);
    });

    it('does not duplicate a pattern that is already clinic-scoped', async () => {
      const harness = createHarness();

      const patterns = await harness.writePatterns(mutation(), {
        patterns: [`clinic:${CLINIC_A}:appointments:*`, `clinic:${CLINIC_A}:appointments:*`],
      });

      expect(patterns).toEqual([`clinic:${CLINIC_A}:appointments:*`]);
    });

    it('refuses a pattern naming another clinic and logs it', async () => {
      const harness = createHarness();

      const patterns = await harness.writePatterns(mutation(), {
        patterns: [`clinic:${CLINIC_B}:appointments:*`],
      });

      expect(patterns).toEqual([]);
      expect(harness.loggingService.log).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.stringContaining('foreign-clinic'),
        'HealthcareCacheInterceptor',
        expect.objectContaining({ pattern: `clinic:${CLINIC_B}:appointments:*` })
      );
    });

    it('refuses patterns that are not clinic- or user-scoped when the request has no clinic context', async () => {
      const harness = createHarness();

      const patterns = await harness.writePatterns(
        request({ method: 'PATCH', user: actor(DOCTOR, 'SUPER_ADMIN') }),
        { patterns: ['users:all:*', 'clinic:*', '*'] }
      );

      expect(patterns).toEqual([]);
    });

    it('still runs user-scoped patterns without a clinic context', async () => {
      const harness = createHarness();

      const patterns = await harness.writePatterns(
        request({ method: 'PATCH', user: actor(DOCTOR, 'SUPER_ADMIN') }),
        { patterns: ['user:{userId}:*'] }
      );

      expect(patterns).toEqual([`user:${DOCTOR}:*`]);
    });

    it('applies user-scoped patterns plain and inside the caller clinic', async () => {
      const harness = createHarness();

      const patterns = await harness.writePatterns(mutation(), { patterns: ['user:{userId}:*'] });

      expect(patterns).toEqual([`user:${DOCTOR}:*`, `clinic:${CLINIC_A}:user:${DOCTOR}:*`]);
    });

    it('uses the route clinic as the tenant on controllers without ClinicGuard', async () => {
      const harness = createHarness();

      const patterns = await harness.writePatterns(
        request({
          method: 'PUT',
          user: actor(DOCTOR, 'CLINIC_ADMIN'),
          params: { clinicId: CLINIC_A },
        }),
        { patterns: ['clinic_locations:{clinicId}:*', 'clinic_location:*'] }
      );

      expect(patterns).toEqual([
        `clinic_locations:${CLINIC_A}:*`,
        `clinic:${CLINIC_A}:clinic_location:*`,
      ]);
    });

    it('never runs security namespaces, even when declared', async () => {
      const harness = createHarness();

      const patterns = await harness.writePatterns(mutation(), {
        patterns: [
          'auth:*',
          'user_sessions:*',
          'session*',
          'auth:lockout:{userId}',
          'phi:access:audit',
        ],
      });

      expect(patterns).toEqual([]);
    });

    it('resolves {userId} from the principal and ignores a spoofed body userId', async () => {
      const harness = createHarness();

      const patterns = await harness.writePatterns(mutation({ body: { userId: VICTIM } }), {
        patterns: ['user:{userId}:*'],
      });

      expect(patterns).toContain(`user:${DOCTOR}:*`);
      expect(patterns.join()).not.toContain(VICTIM);
    });

    it('escapes glob characters so a crafted id cannot widen the pattern', async () => {
      const harness = createHarness();

      const patterns = await harness.writePatterns(mutation({ params: { id: '*' } }), {
        patterns: ['users:one:{id}'],
      });

      expect(patterns[0]).toBe(`clinic:${CLINIC_A}:users:one:\\*`);
    });

    it('encodes ":" in substituted values so a value cannot add a key segment', async () => {
      const harness = createHarness();

      const patterns = await harness.writePatterns(mutation({ params: { id: 'a:b' } }), {
        patterns: ['users:one:{id}'],
      });

      expect(patterns).toEqual([`clinic:${CLINIC_A}:users:one:a%3Ab`]);
    });

    it('does not invalidate anything when the handler fails (4xx or 5xx)', async () => {
      const harness = createHarness();

      for (const failure of [
        new ForbiddenException(),
        new NotFoundException(),
        new Error('boom'),
      ]) {
        await expect(
          harness.runFailing(
            mutation({ params: { id: 'u1' } }),
            { invalidate: { patterns: ['users:one:{id}'], tags: ['users'] } },
            failure
          )
        ).rejects.toBe(failure);
      }

      expect(harness.cacheService.invalidateCacheByTag).not.toHaveBeenCalled();
      expect(harness.cacheService.invalidateCacheByPattern).not.toHaveBeenCalled();
    });

    it('does not invalidate when the response status already says the write failed', async () => {
      const harness = createHarness();

      const patterns = await harness.writePatterns(mutation(), { patterns: ['users:all:*'] }, 409);

      expect(patterns).toEqual([]);
    });

    it('deduplicates tags and runs them before the patterns', async () => {
      const harness = createHarness();
      const order: string[] = [];
      harness.cacheService.invalidateCacheByTag.mockImplementation((tag: string) => {
        order.push(`tag:${tag}`);
        return Promise.resolve(1);
      });
      harness.cacheService.invalidateCacheByPattern.mockImplementation((pattern: string) => {
        order.push(`pattern:${pattern}`);
        return Promise.resolve(1);
      });

      await harness.run(mutation(), {
        invalidate: { patterns: ['users:all:*'], tags: ['users', 'users', 'user_lists'] },
      });

      expect(order).toEqual([
        'tag:users',
        'tag:user_lists',
        `pattern:clinic:${CLINIC_A}:users:all:*`,
      ]);
    });

    it('waits for the tag invalidation before the response completes', async () => {
      const harness = createHarness();
      let tagFinished = false;
      harness.cacheService.invalidateCacheByTag.mockImplementation(async () => {
        await new Promise<void>(resolve => setTimeout(resolve, 20));
        tagFinished = true;
        return 1;
      });

      await harness.run(mutation(), { invalidate: { patterns: [], tags: ['users'] } });

      expect(tagFinished).toBe(true);
    });

    it('coalesces a burst of writes into one running scan per pattern plus one trailing run', async () => {
      const harness = createHarness();
      const releases: Array<() => void> = [];
      let running = 0;
      let maxRunning = 0;
      harness.cacheService.invalidateCacheByPattern.mockImplementation(async () => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await new Promise<void>(resolve => releases.push(resolve));
        running -= 1;
        return 1;
      });

      for (let write = 0; write < 5; write += 1) {
        await harness.run(mutation(), { invalidate: { patterns: ['appointments:*'] } });
      }
      expect(harness.cacheService.invalidateCacheByPattern).toHaveBeenCalledTimes(1);

      releases.shift()?.();
      await flushAsyncWork();
      expect(harness.cacheService.invalidateCacheByPattern).toHaveBeenCalledTimes(2);
      releases.shift()?.();
      await flushAsyncWork();

      expect(harness.cacheService.invalidateCacheByPattern).toHaveBeenCalledTimes(2);
      expect(maxRunning).toBe(1);
    });

    it('logs a failed pattern invalidation instead of failing the request', async () => {
      const harness = createHarness();
      harness.cacheService.invalidateCacheByPattern.mockRejectedValue(new Error('scan timeout'));

      const { result } = await harness.run(mutation(), {
        invalidate: { patterns: ['users:all:*'] },
      });

      expect(result).toEqual({ ok: true });
      expect(harness.loggingService.log).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'Background cache invalidation failed',
        'HealthcareCacheInterceptor',
        expect.objectContaining({ error: 'scan timeout' })
      );
    });
  });

  describe('handler errors on cached reads', () => {
    const readRequest = (): TestRequest =>
      request({ user: actor(DOCTOR, 'DOCTOR'), clinicContext: inClinic(CLINIC_A) });

    it.each([
      ['403', new ForbiddenException()],
      ['404', new NotFoundException()],
    ])('a handler %s is rethrown without an ERROR log', async (_label, failure) => {
      const harness = createHarness();

      await expect(
        harness.runFailing(readRequest(), { cache: { keyTemplate: 'things:{id}' } }, failure)
      ).rejects.toBe(failure);

      expect(harness.errorLogs()).toEqual([]);
    });

    it('a handler 500 is still logged at ERROR', async () => {
      const harness = createHarness();
      const failure = new InternalServerErrorException();

      await expect(
        harness.runFailing(readRequest(), { cache: { keyTemplate: 'things:{id}' } }, failure)
      ).rejects.toBe(failure);

      expect(harness.errorLogs()).toHaveLength(1);
    });

    it('an unexpected non-HTTP error is still logged at ERROR', async () => {
      const harness = createHarness();
      const failure = new Error('database exploded');

      await expect(
        harness.runFailing(readRequest(), { cache: { keyTemplate: 'things:{id}' } }, failure)
      ).rejects.toBe(failure);

      expect(harness.errorLogs()).toHaveLength(1);
    });
  });

  describe('query digest limits', () => {
    const caller = (query: Record<string, unknown>): TestRequest =>
      request({ user: actor(DOCTOR, 'DOCTOR'), clinicContext: inClinic(CLINIC_A), query });
    const cache: OptionsFixture = { keyTemplate: 'appointments:upcoming:{userId}' };

    it('ignores cache-buster params so a client appending ?_t=<now> keeps its hit rate', async () => {
      const harness = createHarness();

      const plain = await harness.readKey(caller({ status: 'OPEN' }), cache);
      for (const buster of ['_t', '_', 't', 'ts', 'timestamp', 'nocache', 'cb', 'TS']) {
        const busted = await harness.readKey(
          caller({ status: 'OPEN', [buster]: '1700000000' }),
          cache
        );
        expect(busted).toBe(plain);
      }
    });

    it('uses a 32-hex digest', async () => {
      const harness = createHarness();

      const key = await harness.readKey(caller({ status: 'OPEN' }), cache);

      expect(key).toMatch(/:q-[0-9a-f]{32}$/);
    });

    it('caches exactly 20 query values and does not cache 21', async () => {
      const harness = createHarness();
      const values = (count: number): Record<string, string> =>
        Object.fromEntries(Array.from({ length: count }, (_v, index) => [`p${index}`, 'x']));

      await harness.run(caller(values(20)), { cache });
      expect(harness.cacheService.get).toHaveBeenCalledTimes(1);

      harness.cacheService.get.mockClear();
      const tooMany = await harness.run(caller(values(21)), { cache });
      expect(harness.cacheService.get).not.toHaveBeenCalled();
      expect(tooMany.handlerCalls).toBe(1);
    });

    it('does not cache a request whose array, name or value exceeds the limits', async () => {
      const harness = createHarness();

      const longValue = await harness.run(caller({ q: 'x'.repeat(201) }), { cache });
      const longName = await harness.run(caller({ ['n'.repeat(201)]: '1' }), { cache });
      const bigArray = await harness.run(caller({ id: Array.from({ length: 25 }, () => 'a') }), {
        cache,
      });

      expect(harness.cacheService.get).not.toHaveBeenCalled();
      expect([longValue, longName, bigArray].map(outcome => outcome.handlerCalls)).toEqual([
        1, 1, 1,
      ]);
    });

    it('caches a value of exactly 200 characters and keeps long different values distinct', async () => {
      const harness = createHarness();

      const first = await harness.readKey(caller({ q: 'a'.repeat(200) }), cache);
      const second = await harness.readKey(caller({ q: `${'a'.repeat(199)}b` }), cache);

      expect(first).not.toBe(second);
    });

    it('applies the same limits to keys without a template', async () => {
      const harness = createHarness();

      await harness.run(
        request({ url: '/x?q=1', query: { q: 'x'.repeat(201) }, user: actor(DOCTOR, 'DOCTOR') }),
        { cache: { ttl: 60 } }
      );

      expect(harness.cacheService.get).not.toHaveBeenCalled();
    });

    it('ignores cache-busters in the default key too, without changing a buster-free key', async () => {
      const harness = createHarness();

      const plain = await harness.readKey(
        request({ url: '/doctors/1?x=1', params: { id: '1' }, query: { x: '1' } }),
        { ttl: 60 }
      );
      const busted = await harness.readKey(
        request({
          url: '/doctors/1?x=1&_t=1700000000',
          params: { id: '1' },
          query: { x: '1', _t: '1700000000' },
        }),
        { ttl: 60 }
      );

      expect(plain).toBe('healthcare:/doctors/1?x=1:{"id":"1"}:{"x":"1"}');
      expect(busted).toBe(plain);
    });
  });

  describe('key value encoding', () => {
    const base = (query: Record<string, unknown>): TestRequest =>
      request({ user: actor(DOCTOR, 'DOCTOR'), clinicContext: inClinic(CLINIC_A), query });

    it('encodes ":" in substituted key values so a value cannot alias another key', async () => {
      const harness = createHarness();

      const colon = await harness.readKey(base({ type: 'a:b' }), {
        keyTemplate: 'ehr:vitals:{type}',
      });
      const split = await harness.readKey(base({ type: 'a' }), {
        keyTemplate: 'ehr:vitals:{type}:b',
      });

      expect(colon).toContain(`clinic:${CLINIC_A}:ehr:vitals:a%3Ab:${HANDLER}:`);
      expect(colon).not.toBe(split);
    });

    it('keeps the encoding injective: a literal %3A never equals an encoded colon', async () => {
      const harness = createHarness();

      const literal = await harness.readKey(base({ type: 'a%3Ab' }), {
        keyTemplate: 'ehr:vitals:{type}',
      });
      const encoded = await harness.readKey(base({ type: 'a:b' }), {
        keyTemplate: 'ehr:vitals:{type}',
      });

      expect(literal).not.toBe(encoded);
    });
  });
});
