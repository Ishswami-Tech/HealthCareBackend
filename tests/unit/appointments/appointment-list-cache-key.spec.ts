/**
 * Cache keys of the appointment list routes must come from the authenticated caller and the
 * ClinicGuard-resolved clinic, never from query parameters.
 */
import { describe, it, expect } from '@jest/globals';
import {
  buildAppointmentDetailCacheKey,
  buildAppointmentListCacheKey,
  buildClinicScopedCacheKey,
  buildMyUpcomingCacheKey,
  buildUserUpcomingCacheKey,
} from '@services/appointments/appointment-list-cache-key';

interface FakeRequest {
  user?: { sub?: string; id?: string; role?: string };
  clinicContext?: { clinicId?: string };
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
}

function executionContext(request: FakeRequest): unknown {
  return { switchToHttp: () => ({ getRequest: () => request }) };
}

function keyFor(request: FakeRequest, variant: 'list' | 'my' = 'list'): string {
  return buildAppointmentListCacheKey(executionContext(request), variant);
}

const patient = { sub: 'patient-user', role: 'PATIENT' };
const clinicContext = { clinicId: 'clinic-1' };

describe('buildAppointmentListCacheKey', () => {
  it('a patient cannot choose whose list is cached with ?userId=<victim> (list route)', () => {
    const own = keyFor({ user: patient, clinicContext, query: {} });
    const attacker = keyFor({ user: patient, clinicContext, query: { userId: 'victim-user' } });

    expect(attacker).toBe(own);
    expect(own).toContain('patient-user');
    expect(own).not.toContain('victim-user');
  });

  it('a patient cannot choose whose list is cached with ?userId=<victim> (my-appointments route)', () => {
    const own = keyFor({ user: patient, clinicContext, query: {} }, 'my');
    const attacker = keyFor(
      { user: patient, clinicContext, query: { userId: 'victim-user' } },
      'my'
    );

    expect(attacker).toBe(own);
    expect(own.startsWith('appointments:my:patient-user:')).toBe(true);
  });

  it('the victim and the attacker never share a key', () => {
    const attacker = keyFor({ user: patient, clinicContext, query: { userId: 'victim-user' } });
    const victim = keyFor({
      user: { sub: 'victim-user', role: 'PATIENT' },
      clinicContext,
      query: {},
    });

    expect(attacker).not.toBe(victim);
  });

  it('the same user in two clinics gets two keys (the clinic header was never part of the old key)', () => {
    const clinicA = keyFor({ user: patient, clinicContext: { clinicId: 'clinic-A' }, query: {} });
    const clinicB = keyFor({ user: patient, clinicContext: { clinicId: 'clinic-B' }, query: {} });
    const myA = keyFor({ user: patient, clinicContext: { clinicId: 'clinic-A' }, query: {} }, 'my');
    const myB = keyFor({ user: patient, clinicContext: { clinicId: 'clinic-B' }, query: {} }, 'my');

    expect(clinicA).not.toBe(clinicB);
    expect(myA).not.toBe(myB);
  });

  it('staff results differ per patient filter, per caller and per role', () => {
    const base = { clinicContext };
    const reception = { sub: 'staff-1', role: 'RECEPTIONIST' };

    const noFilter = keyFor({ ...base, user: reception, query: {} });
    const filtered = keyFor({ ...base, user: reception, query: { userId: 'patient-user' } });
    const otherStaff = keyFor({
      ...base,
      user: { sub: 'staff-2', role: 'RECEPTIONIST' },
      query: {},
    });
    const otherRole = keyFor({ ...base, user: { sub: 'staff-1', role: 'DOCTOR' }, query: {} });

    expect(new Set([noFilter, filtered, otherStaff, otherRole]).size).toBe(4);
  });

  it('every query filter narrows the key, and unknown params do not fragment the cache', () => {
    const base = { user: patient, clinicContext };
    const plain = keyFor({ ...base, query: { status: 'CONFIRMED', page: '2' } });
    const withNoise = keyFor({
      ...base,
      query: { status: 'CONFIRMED', page: '2', _t: '1730000000' },
    });
    const otherStatus = keyFor({ ...base, query: { status: 'COMPLETED', page: '2' } });
    const otherPage = keyFor({ ...base, query: { status: 'CONFIRMED', page: '3' } });

    expect(withNoise).toBe(plain);
    expect(otherStatus).not.toBe(plain);
    expect(otherPage).not.toBe(plain);
  });

  it('array-valued and blank query values are normalized rather than breaking the key', () => {
    const base = { user: patient, clinicContext };

    const arrayStatus = keyFor({ ...base, query: { status: ['CONFIRMED', 'COMPLETED'] } });
    const joined = keyFor({ ...base, query: { status: 'CONFIRMED,COMPLETED' } });
    const blank = keyFor({ ...base, query: { status: '   ' } });
    const absent = keyFor({ ...base, query: {} });

    expect(arrayStatus).toBe(joined);
    expect(blank).toBe(absent);
  });

  it('refuses to build a key without a caller or a clinic (the interceptor then skips the cache)', () => {
    expect(() => keyFor({ clinicContext, query: {} })).toThrow();
    expect(() => keyFor({ user: patient, query: {} })).toThrow();
    expect(() => buildAppointmentListCacheKey({}, 'list')).toThrow();
  });

  it('keeps the legacy prefixes so pattern invalidation still reaches the keys', () => {
    expect(keyFor({ user: patient, clinicContext })).toMatch(/^appointments:list:patient-user:/);
    expect(keyFor({ user: patient, clinicContext }, 'my')).toMatch(
      /^appointments:my:patient-user:/
    );
  });
});

describe('upcoming and detail routes: a cache hit skips the handler, so the key must separate callers', () => {
  const clinicA = { clinicId: 'clinic-A' };
  const alice = { sub: 'alice', role: 'PATIENT' };
  const bob = { sub: 'bob', role: 'PATIENT' };

  it("GET /appointments/upcoming ignores ?userId= (cannot read the victim's cached list)", () => {
    const own = buildMyUpcomingCacheKey(
      executionContext({ user: bob, clinicContext: clinicA, query: {} })
    );
    const attack = buildMyUpcomingCacheKey(
      executionContext({ user: bob, clinicContext: clinicA, query: { userId: 'alice' } })
    );
    const victim = buildMyUpcomingCacheKey(
      executionContext({ user: alice, clinicContext: clinicA, query: {} })
    );

    expect(attack).toBe(own);
    expect(own).not.toBe(victim);
    expect(own.startsWith('appointments:upcoming:bob:')).toBe(true);
  });

  it("GET /appointments/user/:userId/upcoming: Bob asking for Alice never shares Alice's entry", () => {
    const alicesOwn = buildUserUpcomingCacheKey(
      executionContext({ user: alice, clinicContext: clinicA, params: { userId: 'alice' } })
    );
    const bobAsksForAlice = buildUserUpcomingCacheKey(
      executionContext({ user: bob, clinicContext: clinicA, params: { userId: 'alice' } })
    );

    expect(bobAsksForAlice).not.toBe(alicesOwn);
    // And Alice's own /upcoming entry is a different key from either.
    const alicesMine = buildMyUpcomingCacheKey(
      executionContext({ user: alice, clinicContext: clinicA, query: {} })
    );
    expect(alicesMine).not.toBe(bobAsksForAlice);
  });

  it('GET /appointments/:id is separated per caller, clinic and appointment', () => {
    const forAlice = buildAppointmentDetailCacheKey(
      executionContext({ user: alice, clinicContext: clinicA, params: { id: 'appt-1' } })
    );
    const forBob = buildAppointmentDetailCacheKey(
      executionContext({ user: bob, clinicContext: clinicA, params: { id: 'appt-1' } })
    );
    const otherClinic = buildAppointmentDetailCacheKey(
      executionContext({
        user: alice,
        clinicContext: { clinicId: 'clinic-B' },
        params: { id: 'appt-1' },
      })
    );
    const otherAppointment = buildAppointmentDetailCacheKey(
      executionContext({ user: alice, clinicContext: clinicA, params: { id: 'appt-2' } })
    );

    expect(new Set([forAlice, forBob, otherClinic, otherAppointment]).size).toBe(4);
    expect(forAlice.startsWith('appointments:detail:appt-1:')).toBe(true);
  });

  it('fails closed without a caller, a clinic or the route parameter', () => {
    expect(() => buildMyUpcomingCacheKey(executionContext({ clinicContext: clinicA }))).toThrow();
    expect(() =>
      buildAppointmentDetailCacheKey(
        executionContext({ user: alice, clinicContext: clinicA, params: {} })
      )
    ).toThrow();
    expect(() =>
      buildUserUpcomingCacheKey(executionContext({ user: alice, clinicContext: clinicA }))
    ).toThrow();
  });
});

describe('buildClinicScopedCacheKey (analytics)', () => {
  const filters = ['from', 'to', 'locationId', 'doctorId'];
  const key = (request: FakeRequest) =>
    buildClinicScopedCacheKey(
      executionContext(request),
      'appointments:analytics:wait-times',
      filters
    );

  it('never serves one clinic the numbers of another for the same dates', () => {
    const query = { from: '2026-01-01', to: '2026-01-31' };

    expect(key({ clinicContext: { clinicId: 'clinic-A' }, query })).not.toBe(
      key({ clinicContext: { clinicId: 'clinic-B' }, query })
    );
  });

  it('includes every filter, doctorId too, and ignores unrelated params', () => {
    const base = { clinicContext: { clinicId: 'clinic-A' } };
    const plain = key({ ...base, query: { from: 'a', to: 'b' } });

    expect(key({ ...base, query: { from: 'a', to: 'b', doctorId: 'doc-1' } })).not.toBe(plain);
    expect(key({ ...base, query: { from: 'a', to: 'b', locationId: 'loc-1' } })).not.toBe(plain);
    expect(key({ ...base, query: { from: 'a', to: 'b', _t: '1' } })).toBe(plain);
  });

  it('throws without a clinic', () => {
    expect(() => key({ query: { from: 'a', to: 'b' } })).toThrow();
  });
});
