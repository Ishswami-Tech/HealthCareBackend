/**
 * Structural audit of the EHR controllers: every route a PATIENT can reach must be
 * covered by an ownership check.
 *
 *  - routes with a `:userId` / `:patientId` param -> PatientSelfAccessGuard (class level)
 *  - `GET medical-records/:id` (record id) -> ownership enforced in EHRService
 *    (see ehr.service.access.spec.ts)
 *
 * A new PATIENT-reachable route that fits neither pattern fails this test, so it
 * cannot silently reintroduce the "patient reads anyone's data" hole.
 */

import 'reflect-metadata';
import { EHRController } from '@services/ehr/controllers/ehr.controller';
import { EHRClinicController } from '@services/ehr/controllers/ehr-clinic.controller';
import { PatientSelfAccessGuard } from '@core/guards/patient-self-access.guard';
import { Role } from '@core/types/enums.types';

jest.mock('@services/ehr/ehr.service', () => ({ EHRService: class EHRService {} }));
jest.mock('@infrastructure/database/database.service', () => ({
  DatabaseService: class DatabaseService {},
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
jest.mock('@core/decorators', () => ({
  PatientCache: () => () => undefined,
  Cache: () => () => undefined,
}));
jest.mock('@security/rate-limit/rate-limit.decorator', () => ({
  RateLimitAPI: () => () => undefined,
}));

const GUARDS_METADATA = '__guards__';

/**
 * Routes whose ownership is enforced in the service: `:id` routes after the record is
 * loaded (medical record, medication dose -> assertPatientMayAccess) and the body-addressed
 * POST medical-records (own chart only, see EHRService.createMedicalRecord).
 */
const SERVICE_ENFORCED_ID_ROUTES: readonly string[] = [
  'medical-records/:id',
  'medications/:id/doses',
  'medical-records',
];

interface RouteInfo {
  readonly name: string;
  readonly path: string;
  readonly roles: readonly string[];
}

function routesOf(controller: { prototype: object }): RouteInfo[] {
  const proto = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter(name => name !== 'constructor' && typeof proto[name] === 'function')
    .map(name => {
      const handler = proto[name] as object;
      const path = Reflect.getMetadata('path', handler) as string | undefined;
      const roles = (Reflect.getMetadata('roles', handler) as string[] | undefined) ?? [];
      return { name, path: path ?? '', roles };
    })
    .filter(route => route.path.length > 0 && route.roles.length > 0);
}

function guardsOf(controller: object): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[] | undefined) ?? [];
}

describe('EHR controllers: PATIENT-reachable routes are ownership-checked', () => {
  it.each([
    ['EHRController', EHRController],
    ['EHRClinicController', EHRClinicController],
  ])('%s applies PatientSelfAccessGuard', (_name, controller) => {
    expect(guardsOf(controller)).toContain(PatientSelfAccessGuard);
  });

  it.each([
    ['EHRController', EHRController],
    ['EHRClinicController', EHRClinicController],
  ])(
    '%s: each PATIENT route addresses a patient (:userId/:patientId) or is a known service-enforced :id route',
    (_name, controller) => {
      const patientRoutes = routesOf(controller).filter(route =>
        route.roles.includes(Role.PATIENT)
      );
      expect(patientRoutes.length).toBeGreaterThan(0);

      const unprotected = patientRoutes.filter(
        route =>
          !/:(userId|patientId)\b/.test(route.path) &&
          !SERVICE_ENFORCED_ID_ROUTES.includes(route.path)
      );
      expect(unprotected.map(route => `${route.name} (${route.path})`)).toEqual([]);
    }
  );

  it('covers the routes that were exploitable: summary and medical-records by patient', () => {
    const paths = routesOf(EHRController)
      .filter(route => route.roles.includes(Role.PATIENT))
      .map(route => route.path);

    expect(paths).toEqual(
      expect.arrayContaining([':patientId/summary', 'medical-records/patient/:patientId'])
    );
  });

  it('PATIENT is never allowed on write routes', () => {
    const writeRoutes = [
      'createPrescription',
      'updateMedicalRecord',
      'deleteMedicalRecord',
      'uploadMedicalRecordFile',
    ];
    const byName = new Map(routesOf(EHRController).map(route => [route.name, route]));
    for (const name of writeRoutes) {
      expect(byName.get(name)?.roles ?? []).not.toContain(Role.PATIENT);
    }
  });
});
