/// <reference types="jest" />
/**
 * GET /pharmacy/prescriptions/patient/:userId: PATIENT callers are checked by
 * PatientSelfAccessGuard (own id or an ACTIVE dependent), which runs before the
 * response cache; the handler itself no longer hard-codes "own id only".
 */

import 'reflect-metadata';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PharmacyController } from '@services/pharmacy/controllers/pharmacy.controller';
import { PatientSelfAccessGuard } from '@core/guards/patient-self-access.guard';

jest.mock('@services/pharmacy/services/pharmacy.service', () => ({
  PharmacyService: class PharmacyService {},
}));
jest.mock('@infrastructure/database/database.service', () => ({
  DatabaseService: class DatabaseService {},
}));
jest.mock('@core/guards/jwt-auth.guard', () => ({ JwtAuthGuard: class JwtAuthGuard {} }));
jest.mock('@core/guards/roles.guard', () => ({ RolesGuard: class RolesGuard {} }));
jest.mock('@core/guards/clinic.guard', () => ({ ClinicGuard: class ClinicGuard {} }));
jest.mock('@core/rbac/rbac.guard', () => ({ RbacGuard: class RbacGuard {} }));
jest.mock('@core/rbac/rbac.decorators', () => ({
  RequireResourcePermission: () => () => undefined,
}));
jest.mock('@core/decorators', () => ({ Cache: () => () => undefined }));
jest.mock('@security/rate-limit/rate-limit.decorator', () => ({
  RateLimitAPI: () => () => undefined,
}));

const GUARDS_METADATA = '__guards__';

function routeGuards(method: keyof PharmacyController): unknown[] {
  const handler = PharmacyController.prototype[method] as unknown as object;
  return (Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[] | undefined) ?? [];
}

function contextFor(request: Record<string, unknown>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

function guardWithFamily(
  links: Array<{ userId: string }>,
  dependents: Array<{ id: string; userId: string }>
) {
  const client = {
    patient: {
      findFirst: jest.fn().mockResolvedValue({ id: 'patient-self' }),
      findMany: jest.fn().mockResolvedValue(dependents),
    },
    familyMember: { findMany: jest.fn().mockResolvedValue(links) },
  };
  const databaseService = {
    executeHealthcareRead: jest.fn(async (operation: (c: unknown) => Promise<unknown>) =>
      operation(client)
    ),
  };
  return new PatientSelfAccessGuard(databaseService as never);
}

describe('PharmacyController.getPatientPrescriptions', () => {
  it('is protected by PatientSelfAccessGuard at route level (so it also runs before the cache)', () => {
    expect(routeGuards('getPatientPrescriptions')).toContain(PatientSelfAccessGuard);
  });

  it('delegates to the service without a hard-coded own-id check (PATIENT: no clinic scope needed)', async () => {
    const pharmacyService = {
      findPrescriptionsByPatient: jest.fn().mockResolvedValue([{ id: 'rx' }]),
    };
    const controller = new PharmacyController(pharmacyService as never);

    await expect(
      controller.getPatientPrescriptions('user-child', {
        user: { sub: 'user-self', role: 'PATIENT' },
        clinicContext: { clinicId: 'clinic-a' },
      } as never)
    ).resolves.toEqual([{ id: 'rx' }]);
    expect(pharmacyService.findPrescriptionsByPatient).toHaveBeenCalledWith('user-child', {
      role: 'PATIENT',
      clinicId: 'clinic-a',
    });
  });

  it('passes the validated request clinic and the caller role for staff (clinic scoping happens in the service)', async () => {
    const pharmacyService = {
      findPrescriptionsByPatient: jest.fn().mockResolvedValue([]),
    };
    const controller = new PharmacyController(pharmacyService as never);

    await controller.getPatientPrescriptions('user-x', {
      user: { sub: 'doc-1', role: 'DOCTOR' },
      clinicContext: { clinicId: 'clinic-a' },
    } as never);

    expect(pharmacyService.findPrescriptionsByPatient).toHaveBeenCalledWith('user-x', {
      role: 'DOCTOR',
      clinicId: 'clinic-a',
    });
  });

  it('never invents a clinic: no clinic context means no clinicId is passed on', async () => {
    const pharmacyService = {
      findPrescriptionsByPatient: jest.fn().mockResolvedValue([]),
    };
    const controller = new PharmacyController(pharmacyService as never);

    await controller.getPatientPrescriptions('user-x', {
      user: { sub: 'doc-1', role: 'DOCTOR' },
    } as never);

    expect(pharmacyService.findPrescriptionsByPatient).toHaveBeenCalledWith('user-x', {
      role: 'DOCTOR',
    });
  });

  it('the guard lets a PATIENT through for self and for an ACTIVE dependent (User.id or Patient.id)', async () => {
    const guard = guardWithFamily(
      [{ userId: 'user-child' }],
      [{ id: 'patient-child', userId: 'user-child' }]
    );
    const caller = { id: 'user-self', role: 'PATIENT' };

    await expect(
      guard.canActivate(contextFor({ user: caller, params: { userId: 'user-self' } }))
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(contextFor({ user: caller, params: { userId: 'user-child' } }))
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(contextFor({ user: caller, params: { userId: 'patient-child' } }))
    ).resolves.toBe(true);
  });

  it('the guard rejects a stranger and an inactive / deleted dependent with 403', async () => {
    const caller = { id: 'user-self', role: 'PATIENT' };

    const withDependent = guardWithFamily(
      [{ userId: 'user-child' }],
      [{ id: 'patient-child', userId: 'user-child' }]
    );
    await expect(
      withDependent.canActivate(contextFor({ user: caller, params: { userId: 'user-other' } }))
    ).rejects.toBeInstanceOf(ForbiddenException);

    // inactive / deleted links are filtered out by the family query -> no dependents
    const noActiveDependents = guardWithFamily([], []);
    await expect(
      noActiveDependents.canActivate(contextFor({ user: caller, params: { userId: 'user-child' } }))
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the guard does not restrict staff', async () => {
    const guard = guardWithFamily([], []);

    await expect(
      guard.canActivate(
        contextFor({ user: { id: 'doc-1', role: 'DOCTOR' }, params: { userId: 'anyone' } })
      )
    ).resolves.toBe(true);
  });
});
