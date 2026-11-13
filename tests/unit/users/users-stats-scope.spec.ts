/// <reference types="jest" />
/**
 * GET /user/stats feeds the Super Admin dashboard. A Super Admin sees the whole system: the
 * X-Clinic-ID header (or the clinic in their token) only selects a working context, so it must
 * not narrow these totals. Every other role stays scoped to its clinic.
 */

jest.mock('@core/guards/jwt-auth.guard', () => ({ JwtAuthGuard: class {} }));
jest.mock('@core/guards/roles.guard', () => ({ RolesGuard: class {} }));
jest.mock('@core/guards/clinic.guard', () => ({ ClinicGuard: class {} }));
jest.mock('@core/rbac/rbac.guard', () => ({ RbacGuard: class {} }));
jest.mock('@core/rbac/rbac.service', () => ({ RbacService: class {} }));
jest.mock('@core/session/session-management.service', () => ({
  SessionManagementService: class {},
}));
jest.mock('@services/auth/auth.service', () => ({ AuthService: class {} }));
jest.mock('@services/users/users.service', () => ({ UsersService: class {} }));
jest.mock('@services/auth/core/jwt.service', () => ({ JwtAuthService: class {} }));
jest.mock('@infrastructure/logging/logging.service', () => ({ LoggingService: class {} }));
jest.mock('@infrastructure/database', () => ({ DatabaseService: class {} }));
jest.mock('@core/errors', () => ({
  HealthcareErrorsService: class {},
  HealthcareError: class HealthcareError extends Error {},
}));
jest.mock('@services/users/services/location-management.service', () => ({
  LocationManagementService: class {},
}));

import { UsersController } from '@services/users/controllers/users.controller';
import { Role } from '@core/types/enums.types';
import type { ClinicAuthenticatedRequest } from '@core/types/clinic.types';

const STATS = { total: 43968, active: 459, byRole: { PATIENT: 43963, DOCTOR: 1 } };

function build(): { controller: UsersController; getStats: jest.Mock } {
  const getStats = jest.fn().mockResolvedValue(STATS);
  const controller = new UsersController(
    { getStats } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );
  return { controller, getStats };
}

const requestAs = (role: Role): ClinicAuthenticatedRequest =>
  ({ user: { sub: 'u1', id: 'u1', role } }) as never;

describe('UsersController GET user/stats scope', () => {
  it('gives a Super Admin system-wide totals even with a clinic selected', async () => {
    const { controller, getStats } = build();
    await expect(controller.getStats(requestAs(Role.SUPER_ADMIN), 'clinic-1')).resolves.toBe(STATS);
    expect(getStats).toHaveBeenCalledWith(undefined);
  });

  it('keeps every other role scoped to its clinic', async () => {
    for (const role of [Role.CLINIC_ADMIN, Role.RECEPTIONIST, Role.DOCTOR]) {
      const { controller, getStats } = build();
      await controller.getStats(requestAs(role), 'clinic-1');
      expect(getStats).toHaveBeenCalledWith('clinic-1');
    }
  });

  it('stays global when no clinic is given', async () => {
    const { controller, getStats } = build();
    await controller.getStats(requestAs(Role.CLINIC_ADMIN), undefined);
    expect(getStats).toHaveBeenCalledWith(undefined);
  });
});
