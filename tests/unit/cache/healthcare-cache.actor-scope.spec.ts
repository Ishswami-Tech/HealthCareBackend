/// <reference types="jest" />
/**
 * Actor scoping of HealthcareCacheInterceptor keys.
 *
 * On a cache HIT the handler (and its ownership check) never runs and RbacGuard lets a PATIENT
 * through on role permission alone, so a template without `{userId}` (e.g. `appointments:detail:{id}`)
 * would serve patient A's cached response to patient B. The key therefore always names the caller
 * for a PATIENT (`u-<userId>`) and the role for staff (`r-<ROLE>`).
 */

import { lastValueFrom, of } from 'rxjs';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

import { HealthcareCacheInterceptor } from '@core/interceptors/healthcare-cache.interceptor';
import { resolveActorKeySegment } from '@core/interceptors/cache-key-scope.util';
import type { ActorScope } from '@core/interceptors/cache-key-scope.util';
import { CACHE_KEY } from '@core/decorators';
import type { CacheService } from '@infrastructure/cache/cache.service';
import type { LoggingService } from '@infrastructure/logging';

jest.mock('@infrastructure/cache/cache.service', () => ({ CacheService: class CacheService {} }));
jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));

const CLINIC_A = '11111111-1111-4111-8111-111111111111';
const CLINIC_B = '22222222-2222-4222-8222-222222222222';
const PATIENT_A = 'patient-aaaa-0001';
const PATIENT_B = 'patient-bbbb-0002';
const DOCTOR_1 = 'doctor-0000-0001';
const DOCTOR_2 = 'doctor-0000-0002';
const RECEPTIONIST = 'reception-0000-0003';
const APPOINTMENT = 'appointment-0000-0001';
const HANDLER = 'getAppointmentById';
const DETAIL: Record<string, unknown> = { keyTemplate: 'appointments:detail:{id}', ttl: 60 };

interface TestRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  user?: { sub?: string; id?: string; role?: string };
  clinicContext?: { clinicId?: string };
}

const caller = (sub: string, role: string, overrides: Partial<TestRequest> = {}): TestRequest => ({
  method: 'GET',
  url: `/appointments/${APPOINTMENT}`,
  headers: {},
  params: { id: APPOINTMENT },
  user: { sub, role },
  clinicContext: { clinicId: CLINIC_A },
  ...overrides,
});

function makeContext(req: TestRequest): ExecutionContext {
  const handler = (): void => undefined;
  Object.defineProperty(handler, 'name', { value: HANDLER });
  return {
    getHandler: () => handler,
    getClass: () => class TestController {},
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ statusCode: 200 }) }),
  } as unknown as ExecutionContext;
}

function createHarness() {
  const cacheService = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    cache: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(1),
    ttl: jest.fn().mockResolvedValue(0),
    rPush: jest.fn().mockResolvedValue(1),
  };
  const reflector = { get: jest.fn() };
  const interceptor = new HealthcareCacheInterceptor(
    cacheService as unknown as CacheService,
    reflector as unknown as Reflector,
    { log: jest.fn().mockResolvedValue(undefined) } as unknown as LoggingService
  );

  async function run(req: TestRequest, cache: Record<string, unknown>): Promise<number> {
    reflector.get.mockImplementation((metaKey: string) =>
      metaKey === CACHE_KEY ? cache : undefined
    );
    let handlerCalls = 0;
    const next = {
      handle: () => {
        handlerCalls += 1;
        return of({ ok: true });
      },
    };
    await lastValueFrom(await interceptor.intercept(makeContext(req), next));
    await new Promise<void>(resolve => setImmediate(resolve));
    return handlerCalls;
  }

  async function readKey(
    req: TestRequest,
    cache: Record<string, unknown> = DETAIL
  ): Promise<string> {
    cacheService.get.mockClear();
    await run(req, cache);
    const key: unknown = cacheService.get.mock.calls[0]?.[0];
    if (typeof key !== 'string') throw new Error('interceptor did not look up a cache key');
    return key;
  }

  async function readTags(req: TestRequest, cache: Record<string, unknown>): Promise<string[]> {
    cacheService.cache.mockClear();
    await run(req, cache);
    const options: unknown = cacheService.cache.mock.calls[0]?.[2];
    return (options as { tags?: string[] } | undefined)?.tags ?? [];
  }

  return { cacheService, run, readKey, readTags };
}

/** Redis-style glob (`*`, `?`) as a RegExp, enough to check which keys a pattern reaches. */
function globToRegExp(pattern: string): RegExp {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${source}$`);
}

describe('HealthcareCacheInterceptor actor scoping', () => {
  describe('PATIENT callers', () => {
    it('two patients asking for the same URL get different keys even though the template has no {userId}', async () => {
      const harness = createHarness();

      const keyA = await harness.readKey(caller(PATIENT_A, 'PATIENT'));
      const keyB = await harness.readKey(caller(PATIENT_B, 'PATIENT'));

      expect(keyA).not.toBe(keyB);
      expect(keyA).toContain(`:${HANDLER}:u-${PATIENT_A}:q-`);
      expect(keyB).toContain(`:${HANDLER}:u-${PATIENT_B}:q-`);
      expect(keyA).not.toContain(PATIENT_B);
    });

    it('a patient never shares a key with a staff member for the same URL', async () => {
      const harness = createHarness();

      const patient = await harness.readKey(caller(PATIENT_A, 'PATIENT'));
      for (const role of ['DOCTOR', 'RECEPTIONIST', 'CLINIC_ADMIN', 'SUPER_ADMIN']) {
        const staff = await harness.readKey(caller(DOCTOR_1, role));
        expect(staff).not.toBe(patient);
      }
    });

    it('treats the role claim case-insensitively', async () => {
      const harness = createHarness();

      const key = await harness.readKey(caller(PATIENT_A, 'patient'));

      expect(key).toContain(`:u-${PATIENT_A}:q-`);
    });

    it('falls back to user.id when the token has no sub', async () => {
      const harness = createHarness();

      const key = await harness.readKey(
        caller('', 'PATIENT', { user: { id: PATIENT_A, role: 'PATIENT' } })
      );

      expect(key).toContain(`:u-${PATIENT_A}:q-`);
    });

    it('a template with {userId} that resolves to the caller gets no duplicate segment', async () => {
      const harness = createHarness();
      const cache = { keyTemplate: 'appointments:upcoming:{userId}' };

      const key = await harness.readKey(caller(PATIENT_A, 'PATIENT', { params: {} }), cache);

      expect(key).toBe(
        `clinic:${CLINIC_A}:appointments:upcoming:${PATIENT_A}:${HANDLER}:q-${key.slice(-32)}`
      );
      expect(key.split(PATIENT_A)).toHaveLength(2);
    });

    it('a route :userId naming someone else keeps the resource in the key AND adds the caller', async () => {
      const harness = createHarness();
      const cache = { keyTemplate: 'ehr:comprehensive:{userId}' };

      const victimOwn = await harness.readKey(
        caller(PATIENT_B, 'PATIENT', { params: { userId: PATIENT_B } }),
        cache
      );
      const prying = await harness.readKey(
        caller(PATIENT_A, 'PATIENT', { params: { userId: PATIENT_B } }),
        cache
      );
      const clinician = await harness.readKey(
        caller(DOCTOR_1, 'DOCTOR', { params: { userId: PATIENT_B } }),
        cache
      );

      expect(prying).toContain(`ehr:comprehensive:${PATIENT_B}:`);
      expect(prying).toContain(`:u-${PATIENT_A}:q-`);
      expect(prying).not.toBe(victimOwn);
      expect(prying).not.toBe(clinician);
    });

    it('a {userRole} template does not remove the patient segment', async () => {
      const harness = createHarness();

      const key = await harness.readKey(caller(PATIENT_A, 'PATIENT'), {
        keyTemplate: 'scope:{userRole}:{id}',
      });

      expect(key).toContain(`scope:PATIENT:${APPOINTMENT}:${HANDLER}:u-${PATIENT_A}:q-`);
    });

    it('a patient with no user id at all is not cached', async () => {
      const harness = createHarness();

      const handlerCalls = await harness.run(
        caller('', 'PATIENT', { user: { role: 'PATIENT' } }),
        DETAIL
      );

      expect(handlerCalls).toBe(1);
      expect(harness.cacheService.get).not.toHaveBeenCalled();
    });

    it('an authenticated caller without a role claim is isolated like a patient (fail-closed)', async () => {
      const harness = createHarness();

      const first = await harness.readKey(caller(PATIENT_A, '', { user: { sub: PATIENT_A } }));
      const second = await harness.readKey(caller(PATIENT_B, '', { user: { sub: PATIENT_B } }));

      expect(first).toContain(`:u-${PATIENT_A}:q-`);
      expect(first).not.toBe(second);
    });
  });

  describe('staff callers', () => {
    it('two staff of the same role in the same clinic share an entry', async () => {
      const harness = createHarness();

      const first = await harness.readKey(caller(DOCTOR_1, 'DOCTOR'));
      const second = await harness.readKey(caller(DOCTOR_2, 'DOCTOR'));

      expect(first).toBe(second);
      expect(first).toContain(`:${HANDLER}:r-DOCTOR:q-`);
      expect(first).not.toContain(DOCTOR_1);
    });

    it('a receptionist and a doctor of the same clinic never share an entry', async () => {
      const harness = createHarness();

      const receptionist = await harness.readKey(caller(RECEPTIONIST, 'RECEPTIONIST'));
      const doctor = await harness.readKey(caller(DOCTOR_1, 'DOCTOR'));

      expect(receptionist).not.toBe(doctor);
    });

    it('staff of the same role in different clinics still get different keys', async () => {
      const harness = createHarness();

      const inA = await harness.readKey(caller(DOCTOR_1, 'DOCTOR'));
      const inB = await harness.readKey(
        caller(DOCTOR_1, 'DOCTOR', { clinicContext: { clinicId: CLINIC_B } })
      );

      expect(inA).not.toBe(inB);
    });

    it('a {userRole} template already names the role, so no second role segment is added', async () => {
      const harness = createHarness();

      const key = await harness.readKey(caller(DOCTOR_1, 'DOCTOR'), {
        keyTemplate: 'scope:{userRole}:{id}',
      });

      expect(key).toBe(
        `clinic:${CLINIC_A}:scope:DOCTOR:${APPOINTMENT}:${HANDLER}:q-${key.slice(-32)}`
      );
    });

    it('query filters still make staff keys distinct and the digest stays last', async () => {
      const harness = createHarness();

      const none = await harness.readKey(caller(DOCTOR_1, 'DOCTOR'));
      const filtered = await harness.readKey(
        caller(DOCTOR_1, 'DOCTOR', { query: { status: 'OPEN' } })
      );

      expect(none).not.toBe(filtered);
      expect(filtered).toMatch(/:r-DOCTOR:q-[0-9a-f]{32}$/);
    });
  });

  describe('unauthenticated callers', () => {
    it('get no actor segment', async () => {
      const harness = createHarness();

      const key = await harness.readKey(
        { method: 'GET', url: '/plugins', headers: {} },
        {
          keyTemplate: 'plugins:info',
        }
      );

      expect(key).toMatch(/^plugins:info:getAppointmentById:q-[0-9a-f]{32}$/);
    });
  });

  describe('keys without a template', () => {
    const noTemplate = { ttl: 60 };

    it('separate two patients and a patient from staff on the same URL', async () => {
      const harness = createHarness();

      const patientA = await harness.readKey(caller(PATIENT_A, 'PATIENT'), noTemplate);
      const patientB = await harness.readKey(caller(PATIENT_B, 'PATIENT'), noTemplate);
      const staff = await harness.readKey(caller(DOCTOR_1, 'DOCTOR'), noTemplate);

      expect(new Set([patientA, patientB, staff]).size).toBe(3);
      expect(patientA).toContain(`user:${PATIENT_A}:`);
    });
  });

  describe('tags and invalidation', () => {
    const tags = ['appointment_details', 'appointment:{id}', 'user:{userId}'];

    it('tags carry neither the actor segment nor the query digest, for patients and staff alike', async () => {
      const harness = createHarness();
      const cache = { ...DETAIL, tags };

      const patientTags = await harness.readTags(caller(PATIENT_A, 'PATIENT'), cache);
      const staffTags = await harness.readTags(caller(DOCTOR_1, 'DOCTOR'), cache);

      expect(patientTags).toEqual([
        'appointment_details',
        `appointment:${APPOINTMENT}`,
        `user:${PATIENT_A}`,
      ]);
      expect(staffTags).toEqual([
        'appointment_details',
        `appointment:${APPOINTMENT}`,
        `user:${DOCTOR_1}`,
      ]);
    });

    it('wildcard invalidation patterns still reach patient and staff keys', async () => {
      const harness = createHarness();
      const keys = [
        await harness.readKey(caller(PATIENT_A, 'PATIENT')),
        await harness.readKey(caller(DOCTOR_1, 'DOCTOR')),
      ];

      for (const key of keys) {
        // CacheRepository.invalidateByPattern appends `:v*` to the stored (versioned) key.
        expect(globToRegExp(`clinic:${CLINIC_A}:appointments:detail:*:v*`).test(`${key}:v1`)).toBe(
          true
        );
        expect(globToRegExp(`*appointments:detail:${APPOINTMENT}:*:v*`).test(`${key}:v1`)).toBe(
          true
        );
      }
    });
  });

  describe('resolveActorKeySegment', () => {
    const actor = (userId: string | undefined, userRole: string | undefined): ActorScope => ({
      userId,
      userRole,
      clinicId: CLINIC_A,
    });

    it('neutralises braces so a segment can never reintroduce a placeholder', () => {
      expect(resolveActorKeySegment('x:{id}', {}, actor('a{b}', 'PATIENT'))).toBe('u-a%7Bb%7D');
      expect(resolveActorKeySegment('x:{id}', {}, actor('s', 'ROLE{x}'))).toBe('r-ROLE%7Bx%7D');
    });

    it('does not segment an unauthenticated actor', () => {
      expect(resolveActorKeySegment('x:{id}', {}, actor(undefined, undefined))).toBeUndefined();
    });

    it('skips the patient segment only when {userId} resolved to the caller', () => {
      const params = { userId: PATIENT_A };

      expect(
        resolveActorKeySegment('x:{userId}', params, actor(PATIENT_A, 'PATIENT'))
      ).toBeUndefined();
      expect(
        resolveActorKeySegment('x:{userId}', { userId: PATIENT_B }, actor(PATIENT_A, 'PATIENT'))
      ).toBe(`u-${PATIENT_A}`);
      expect(resolveActorKeySegment('x:{id}', params, actor(PATIENT_A, 'PATIENT'))).toBe(
        `u-${PATIENT_A}`
      );
    });

    it('throws for a patient without a user id', () => {
      expect(() => resolveActorKeySegment('x', {}, actor(undefined, 'PATIENT'))).toThrow();
    });
  });
});
