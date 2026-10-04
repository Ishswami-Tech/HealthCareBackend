/**
 * Unit tests for PatientSelfAccessGuard and its ownership helpers.
 *
 * RbacGuard lets a PATIENT through on any route whose permission their role holds,
 * so ownership of `:userId` / `:patientId` has to be enforced separately.
 */

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import {
  PatientSelfAccessGuard,
  assertPatientMayAccess,
  buildPatientAccessScope,
  isPatientRole,
  isPatientTargetAllowed,
  resolvePatientAccessScope,
} from '@core/guards/patient-self-access.guard';
import type { DatabaseService } from '@infrastructure/database/database.service';

jest.mock('@infrastructure/database/database.service', () => ({
  DatabaseService: class DatabaseService {},
}));

interface FakeData {
  /** Patient row of the caller (null = caller has no Patient row). */
  own: { id: string } | null;
  /** FamilyMember rows returned by the (already filtered) query. */
  links: Array<{ userId: string | null }>;
  /** Patient rows of the dependents. */
  dependentPatients: Array<{ id: string; userId: string }>;
}

function createDb(data: FakeData) {
  const client = {
    patient: {
      findFirst: jest.fn().mockResolvedValue(data.own),
      findMany: jest.fn().mockResolvedValue(data.dependentPatients),
    },
    familyMember: {
      findMany: jest.fn().mockResolvedValue(data.links),
    },
  };
  const databaseService = {
    executeHealthcareRead: jest.fn(async (operation: (c: unknown) => Promise<unknown>) =>
      operation(client)
    ),
  };
  return {
    client,
    databaseService: databaseService as unknown as DatabaseService,
    databaseMock: databaseService,
  };
}

const FAMILY: FakeData = {
  own: { id: 'patient-self' },
  links: [{ userId: 'user-child' }],
  dependentPatients: [{ id: 'patient-child', userId: 'user-child' }],
};

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('patient access helpers', () => {
  it('isPatientRole only matches the PATIENT role string', () => {
    expect(isPatientRole('PATIENT')).toBe(true);
    expect(isPatientRole('DOCTOR')).toBe(false);
    expect(isPatientRole(undefined)).toBe(false);
    expect(isPatientRole({ toString: () => 'PATIENT' })).toBe(false);
  });

  it('buildPatientAccessScope includes self and dependents in both id spaces', () => {
    const scope = buildPatientAccessScope({
      callerUserId: 'user-self',
      callerPatientId: 'patient-self',
      dependents: [
        { userId: 'user-child', patientId: 'patient-child' },
        { userId: 'user-orphan', patientId: null },
      ],
    });
    expect([...scope].sort()).toEqual(
      ['patient-child', 'patient-self', 'user-child', 'user-orphan', 'user-self'].sort()
    );
  });

  it('isPatientTargetAllowed rejects ids outside the scope and empty ids', () => {
    const scope = buildPatientAccessScope({ callerUserId: 'user-self', dependents: [] });
    expect(isPatientTargetAllowed(scope, 'user-self')).toBe(true);
    expect(isPatientTargetAllowed(scope, 'user-other')).toBe(false);
    expect(isPatientTargetAllowed(scope, '')).toBe(false);
  });
});

describe('resolvePatientAccessScope', () => {
  it('returns only the caller when they have no Patient row (no dependents queried)', async () => {
    const { client, databaseService } = createDb({ own: null, links: [], dependentPatients: [] });

    const scope = await resolvePatientAccessScope(databaseService, 'user-self');

    expect([...scope]).toEqual(['user-self']);
    expect(client.familyMember.findMany).not.toHaveBeenCalled();
  });

  it('adds ACTIVE dependents (user id and patient id) and queries only active, non-deleted links', async () => {
    const { client, databaseService } = createDb(FAMILY);

    const scope = await resolvePatientAccessScope(databaseService, 'user-self');

    expect(isPatientTargetAllowed(scope, 'user-child')).toBe(true);
    expect(isPatientTargetAllowed(scope, 'patient-child')).toBe(true);
    expect(isPatientTargetAllowed(scope, 'patient-self')).toBe(true);
    expect(client.familyMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { patientId: 'patient-self', isActive: true, deletedAt: null },
      })
    );
  });

  it('ignores links without a dependent user id', async () => {
    const { client, databaseService } = createDb({
      own: { id: 'patient-self' },
      links: [{ userId: null }],
      dependentPatients: [],
    });

    const scope = await resolvePatientAccessScope(databaseService, 'user-self');

    expect([...scope].sort()).toEqual(['patient-self', 'user-self']);
    expect(client.patient.findMany).not.toHaveBeenCalled();
  });
});

describe('assertPatientMayAccess', () => {
  it('is a no-op for staff and for a missing actor', async () => {
    const { databaseService, databaseMock } = createDb(FAMILY);

    await expect(
      assertPatientMayAccess(databaseService, { userId: 'doc-1', role: 'DOCTOR' }, 'patient-x')
    ).resolves.toBeUndefined();
    await expect(
      assertPatientMayAccess(databaseService, undefined, 'patient-x')
    ).resolves.toBeUndefined();
    expect(databaseMock.executeHealthcareRead).not.toHaveBeenCalled();
  });

  it('allows a PATIENT their own patient id, a dependent, and rejects everyone else with 403', async () => {
    const { databaseService } = createDb(FAMILY);
    const actor = { userId: 'user-self', role: 'PATIENT' };

    await expect(
      assertPatientMayAccess(databaseService, actor, 'patient-self')
    ).resolves.toBeUndefined();
    await expect(
      assertPatientMayAccess(databaseService, actor, 'patient-child')
    ).resolves.toBeUndefined();
    await expect(
      assertPatientMayAccess(databaseService, actor, 'patient-stranger')
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not touch the database when the target is the PATIENT own user id', async () => {
    const { databaseService, databaseMock } = createDb(FAMILY);

    await assertPatientMayAccess(
      databaseService,
      { userId: 'user-self', role: 'PATIENT' },
      'user-self'
    );

    expect(databaseMock.executeHealthcareRead).not.toHaveBeenCalled();
  });
});

describe('PatientSelfAccessGuard', () => {
  function guardFor(data: FakeData = FAMILY) {
    const db = createDb(data);
    return { guard: new PatientSelfAccessGuard(db.databaseService), ...db };
  }

  it('lets staff roles through without any lookup', async () => {
    const { guard, databaseMock } = guardFor();
    const allowed = await guard.canActivate(
      contextFor({ user: { id: 'doc-1', role: 'DOCTOR' }, params: { userId: 'anyone' } })
    );

    expect(allowed).toBe(true);
    expect(databaseMock.executeHealthcareRead).not.toHaveBeenCalled();
  });

  it('lets a PATIENT read their own :userId without a lookup', async () => {
    const { guard, databaseMock } = guardFor();
    const allowed = await guard.canActivate(
      contextFor({ user: { id: 'user-self', role: 'PATIENT' }, params: { userId: 'user-self' } })
    );

    expect(allowed).toBe(true);
    expect(databaseMock.executeHealthcareRead).not.toHaveBeenCalled();
  });

  it('accepts the JWT sub as the caller identity', async () => {
    const { guard } = guardFor();
    await expect(
      guard.canActivate(
        contextFor({ user: { sub: 'user-self', role: 'PATIENT' }, params: { userId: 'user-self' } })
      )
    ).resolves.toBe(true);
  });

  it('rejects a PATIENT reading another user via :userId (403)', async () => {
    const { guard } = guardFor();
    await expect(
      guard.canActivate(
        contextFor({
          user: { id: 'user-self', role: 'PATIENT' },
          params: { userId: 'user-victim' },
        })
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a PATIENT reading another patient via :patientId (GET /ehr/:patientId/summary, medical-records/patient/:patientId)', async () => {
    const { guard } = guardFor();
    await expect(
      guard.canActivate(
        contextFor({
          user: { id: 'user-self', role: 'PATIENT' },
          params: { patientId: 'patient-victim' },
        })
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a PATIENT to use their own Patient.id or an ACTIVE dependent on :patientId / :userId', async () => {
    const { guard } = guardFor();
    const user = { id: 'user-self', role: 'PATIENT' };

    await expect(
      guard.canActivate(contextFor({ user, params: { patientId: 'patient-self' } }))
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(contextFor({ user, params: { patientId: 'patient-child' } }))
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(contextFor({ user, params: { userId: 'user-child' } }))
    ).resolves.toBe(true);
  });

  it('denies a removed dependent: soft-deleted links are not returned by the scope query', async () => {
    const { guard } = guardFor({ ...FAMILY, links: [], dependentPatients: [] });
    await expect(
      guard.canActivate(
        contextFor({ user: { id: 'user-self', role: 'PATIENT' }, params: { userId: 'user-child' } })
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires every id param present to be in scope', async () => {
    const { guard } = guardFor();
    await expect(
      guard.canActivate(
        contextFor({
          user: { id: 'user-self', role: 'PATIENT' },
          params: { userId: 'user-self', patientId: 'patient-victim' },
        })
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('passes through routes with no patient id param (the :id routes are checked in the service)', async () => {
    const { guard, databaseMock } = guardFor();
    const allowed = await guard.canActivate(
      contextFor({ user: { id: 'user-self', role: 'PATIENT' }, params: { id: 'record-1' } })
    );

    expect(allowed).toBe(true);
    expect(databaseMock.executeHealthcareRead).not.toHaveBeenCalled();
  });

  it('fails closed for a PATIENT token without any user id', async () => {
    const { guard } = guardFor();
    await expect(
      guard.canActivate(
        contextFor({ user: { role: 'PATIENT' }, params: { userId: 'user-victim' } })
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe('fails closed when the access-scope lookup itself throws', () => {
    const lookupError = new Error('database unavailable');

    function guardWithBrokenDb(failing: 'patient' | 'familyMember') {
      const client = {
        patient: {
          findFirst:
            failing === 'patient'
              ? jest.fn().mockRejectedValue(lookupError)
              : jest.fn().mockResolvedValue({ id: 'patient-self' }),
          findMany: jest.fn().mockResolvedValue([]),
        },
        familyMember: {
          findMany:
            failing === 'familyMember'
              ? jest.fn().mockRejectedValue(lookupError)
              : jest.fn().mockResolvedValue([]),
        },
      };
      const databaseService = {
        executeHealthcareRead: jest.fn(async (operation: (c: unknown) => Promise<unknown>) =>
          operation(client)
        ),
      };
      return new PatientSelfAccessGuard(databaseService as unknown as DatabaseService);
    }

    it.each(['patient', 'familyMember'] as const)(
      'rejects (never returns true) when the %s lookup throws',
      async failing => {
        const guard = guardWithBrokenDb(failing);

        await expect(
          guard.canActivate(
            contextFor({
              user: { id: 'user-self', role: 'PATIENT' },
              params: { userId: 'user-child' },
            })
          )
        ).rejects.toBe(lookupError);
      }
    );

    it('assertPatientMayAccess propagates a lookup failure instead of allowing access', async () => {
      const guardDb = {
        executeHealthcareRead: jest.fn().mockRejectedValue(lookupError),
      } as unknown as DatabaseService;

      await expect(
        assertPatientMayAccess(guardDb, { userId: 'user-self', role: 'PATIENT' }, 'patient-child')
      ).rejects.toBe(lookupError);
    });
  });
});
