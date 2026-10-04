/**
 * Route-level role checks for patient documents: RECEPTIONIST must not be able to
 * list or delete patient documents (it holds no medical-records permission).
 */

import 'reflect-metadata';
import { PatientsController } from '@services/patients/controllers/patients.controller';
import { Role } from '@core/types/enums.types';

jest.mock('@services/patients/patients.service', () => ({
  PatientsService: class PatientsService {},
}));
jest.mock('@core/guards/jwt-auth.guard', () => ({ JwtAuthGuard: class JwtAuthGuard {} }));
jest.mock('@core/guards/roles.guard', () => ({ RolesGuard: class RolesGuard {} }));
jest.mock('@core/guards/clinic.guard', () => ({ ClinicGuard: class ClinicGuard {} }));
jest.mock('@core/guards/profile-completion.guard', () => ({
  ProfileCompletionGuard: class ProfileCompletionGuard {},
}));
jest.mock('@core/rbac/rbac.guard', () => ({ RbacGuard: class RbacGuard {} }));
jest.mock('@core/rbac/rbac.decorators', () => ({
  RequireResourcePermission: () => () => undefined,
}));
jest.mock('@core/decorators/profile-completion.decorator', () => ({
  RequiresProfileCompletion: () => () => undefined,
}));

function rolesOf(method: keyof PatientsController): string[] {
  const handler = PatientsController.prototype[method] as unknown as object;
  return (Reflect.getMetadata('roles', handler) as string[] | undefined) ?? [];
}

describe('PatientsController document routes', () => {
  it('DELETE :id/documents/:documentId excludes RECEPTIONIST and keeps PATIENT, DOCTOR, CLINIC_ADMIN', () => {
    const roles = rolesOf('deleteDocument');
    expect(roles).not.toContain(Role.RECEPTIONIST);
    expect(roles).toEqual(expect.arrayContaining([Role.PATIENT, Role.DOCTOR, Role.CLINIC_ADMIN]));
  });

  it('GET :id/documents excludes RECEPTIONIST', () => {
    const roles = rolesOf('listDocuments');
    expect(roles).not.toContain(Role.RECEPTIONIST);
    expect(roles).toEqual(expect.arrayContaining([Role.PATIENT, Role.DOCTOR, Role.CLINIC_ADMIN]));
  });
});
