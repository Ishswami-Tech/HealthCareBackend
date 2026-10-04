/// <reference types="jest" />
/**
 * Service-level pattern deletes (`invalidateCacheByPattern`, `invalidateByPattern`, `delPattern`,
 * `invalidatePattern`) called directly from the services, outside the HTTP interceptor. Each
 * pattern of the hand-audited table runs for real against the in-memory server and must never
 * delete security state, and must be bound to the calling tenant unless it is listed as known-broad.
 */

import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { isProtectedKey } from '@infrastructure/cache/utils/protected-keys.util';
import {
  APPOINTMENT_A,
  APPOINTMENT_B,
  CLINIC_A,
  CLINIC_B,
  DOCTOR_A,
  DOCTOR_B,
  SECURITY_KEYS,
  SRC,
  USER_A,
  USER_B,
  createWorld,
  deleted,
  sourceFiles,
} from './support/invalidation-world';

jest.mock('@config/config.service', () => ({ ConfigService: class ConfigService {} }));
jest.mock('@config/cache.config', () => ({
  isCacheEnabled: (): boolean => true,
  getCacheProvider: (): string => 'dragonfly',
}));
jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));

// ---------------------------------------------------------------------------------------------
// Service-level pattern deletes (called directly, outside the HTTP interceptor)
// ---------------------------------------------------------------------------------------------

interface ServicePattern {
  /** Source file that contains the template (also checked to still contain it). */
  readonly file: string;
  /** The template literal as written, `${...}` included. */
  readonly template: string;
}

/**
 * Hand-audited list of every service-level pattern delete in `src/` (the call-site count below is
 * checked against the sources, so a new call site fails this suite until it is added here).
 */
const SERVICE_PATTERNS: readonly ServicePattern[] = [
  { file: 'services/users/users.service.ts', template: '*users:one:*${userId}*' },
  { file: 'services/users/users.service.ts', template: '*${userId}*' },
  { file: 'services/users/users.service.ts', template: '*availability*${userId}*' },
  { file: 'services/users/users.service.ts', template: '*doctor*${userId}*availability*' },
  { file: 'services/auth/auth.service.ts', template: '*user:${userId}:*' },
  {
    file: 'services/appointments/core/core-appointment.service.ts',
    template: '*clinic:${clinicId}:appointments:*',
  },
  {
    file: 'services/appointments/core/core-appointment.service.ts',
    template: 'healthcare:appointment:*',
  },
  {
    file: 'services/appointments/core/core-appointment.service.ts',
    template: 'metrics:${clinicId}:*',
  },
  {
    file: 'services/appointments/core/core-appointment.service.ts',
    template: 'doctor:*:clinic:${clinicId}:*availability*',
  },
  {
    file: 'services/appointments/core/core-appointment.service.ts',
    template: 'availability:${clinicId}:*',
  },
  {
    file: 'services/appointments/plugins/therapy/therapy-queue.service.ts',
    template: 'therapy-queues:clinic:${clinicId}*',
  },
  {
    file: 'services/appointments/plugins/therapy/therapy-queue.service.ts',
    template: 'therapy-queue:*:${queueId}*',
  },
  {
    file: 'services/appointments/plugins/checkin/check-in.service.ts',
    template: 'queue:doctor:*:${clinicId}',
  },
  {
    file: 'services/appointments/plugins/followup/appointment-followup.service.ts',
    template: 'patient_followups:${patientId}:${clinicId}:*',
  },
  {
    file: 'services/appointments/plugins/confirmation/appointment-confirmation.service.ts',
    template: 'qr:checkin:${appointmentId}:*',
  },
  {
    file: 'services/appointments/plugins/location/appointment-location.service.ts',
    template: 'locations:${domain}',
  },
  {
    file: 'services/appointments/plugins/location/appointment-location.service.ts',
    template: 'location:*:${domain}',
  },
  {
    file: 'services/appointments/plugins/location/appointment-location.service.ts',
    template: 'doctors:location:*:${domain}',
  },
  {
    file: 'services/appointments/plugins/location/appointment-location.service.ts',
    template: 'stats:location:*:${domain}',
  },
  {
    file: 'services/appointments/plugins/location/appointment-location.service.ts',
    template: 'doctors:location:${locationId}:${domain}',
  },
  {
    file: 'services/ipd/services/ward.service.ts',
    template: '${WARD_CACHE_PREFIX}:*:${clinicId}:${clinicLocationId}:*',
  },
  {
    file: 'services/ipd/services/ward.service.ts',
    template: 'ipd:bedboard:bed:${clinicId}:${clinicLocationId}:*',
  },
  {
    file: 'services/ipd/services/nurse-station-clinical.service.ts',
    template:
      '${NURSE_STATION_CACHE_PREFIX}:notes:${clinicId}:${clinicLocationId}:${admissionId}:*',
  },
  {
    file: 'services/ipd/services/bed-management.service.ts',
    template: '${BED_BOARD_CACHE_PREFIX}:${clinicId}:${clinicLocationId}:*',
  },
  {
    file: 'services/ipd/services/admission.service.ts',
    template: 'ipd:ward:*:${clinicId}:${clinicLocationId}:*',
  },
  {
    file: 'services/diet/services/diet-plan.service.ts',
    template: '${DIET_PLAN_CACHE_PREFIX}:patient:${clinicId}:${patientId}:*',
  },
  {
    file: 'services/ayurveda/services/prakriti-assessment.service.ts',
    template: '${PRAKRITI_CACHE_PREFIX}:history:${clinicId}:${patientId}:*',
  },
  {
    file: 'services/ayurveda/services/nadi-pariksha.service.ts',
    template: '${NADI_CACHE_PREFIX}:history:${clinicId}:${patientId}:*',
  },
  {
    file: 'services/ayurveda/services/dosha-imbalance.service.ts',
    template: '${DOSHA_IMBALANCE_CACHE_PREFIX}:*:${clinicId}:${patientId}:*',
  },
  {
    file: 'services/ayurveda/services/ayurvedic-timeline.service.ts',
    template: '${TIMELINE_CACHE_PREFIX}:${clinicId}:${patientId}:*',
  },
  {
    file: 'services/ayurveda/services/ayurvedic-diagnosis.service.ts',
    template: '${DIAGNOSIS_CACHE_PREFIX}:patient:${clinicId}:${patientId}:*',
  },
  { file: 'libs/security/rate-limit/rate-limit.service.ts', template: 'rate_limit:${key}*' },
  { file: 'libs/core/rbac/rbac.service.ts', template: '${this.CACHE_PREFIX}user_roles:${userId}*' },
  { file: 'libs/core/rbac/rbac.service.ts', template: '${this.CACHE_PREFIX}role_permissions:*' },
  { file: 'libs/core/rbac/role.service.ts', template: '${this.CACHE_PREFIX}*' },
  { file: 'libs/core/rbac/permission.service.ts', template: '${this.CACHE_PREFIX}*' },
];

/**
 * Service-level patterns that are broad ON PURPOSE or still need a follow-up in a file that is not
 * part of this change. They are listed so the suite documents them (and fails when a NEW broad
 * pattern appears), not because they are acceptable:
 *
 * - global by design: RBAC role/permission definitions are shared by all clinics.
 * - core-appointment.service.ts `healthcare:appointment:*`: flushes every clinic's appointment
 *   entries; use `healthcare:appointment:*` scoped by the appointment ids of the clinic instead.
 * - appointment-location.service.ts `locations:${domain}`, `location:*:${domain}`,
 *   `doctors:location:*:${domain}`, `stats:location:*:${domain}`: keyed by `domain` only, so one
 *   clinic's location change flushes every clinic; add the clinic id to the key and the pattern.
 */
const KNOWN_BROAD_SERVICE_PATTERNS: ReadonlySet<string> = new Set([
  'healthcare:appointment:*',
  'locations:${domain}',
  'location:*:${domain}',
  'doctors:location:*:${domain}',
  'stats:location:*:${domain}',
  '${this.CACHE_PREFIX}role_permissions:*',
  '${this.CACHE_PREFIX}*',
]);

const TENANT_IDS = {
  A: { user: USER_A, clinic: CLINIC_A, doctor: DOCTOR_A, appointment: APPOINTMENT_A },
  B: { user: USER_B, clinic: CLINIC_B, doctor: DOCTOR_B, appointment: APPOINTMENT_B },
} as const;
/** Placeholders that carry no tenant: every tenant fills them with the same value. */
const TENANT_NEUTRAL_NAMES: ReadonlySet<string> = new Set(['domain', 'key']);

/**
 * Fills `${...}` with the tenant's real ids: a constant (ALL_CAPS, e.g. a cache prefix) and a
 * tenant-neutral name (`domain`) get the same value for both tenants, ids differ per tenant.
 */
function instantiate(template: string, tenant: 'A' | 'B'): string {
  const ids = TENANT_IDS[tenant];
  return template.replace(/\$\{([^}]+)\}/g, (_match, expression: string) => {
    const name = expression.trim().split('.').pop() ?? expression;
    if (/^[A-Z0-9_]+$/.test(name)) return 'const';
    if (TENANT_NEUTRAL_NAMES.has(name)) return name;
    if (/clinic/i.test(name)) return ids.clinic;
    if (/user|patient/i.test(name)) return ids.user;
    if (/doctor/i.test(name)) return ids.doctor;
    if (/appointment/i.test(name)) return ids.appointment;
    return `${name}-${tenant}`;
  });
}

/** A key the glob matches: wildcards become a fixed filler, plus the version suffix. */
function keyMatching(pattern: string): string {
  return `${pattern.replace(/\*/g, 'x')}:v1`;
}

describe('service-level pattern deletes', () => {
  it('lists every pattern-delete call site of the code base (drift guard)', () => {
    const callSites = sourceFiles(SRC, '.ts').flatMap(file => {
      const relativePath = relative(SRC, file).replace(/\\/g, '/');
      if (relativePath.startsWith('libs/infrastructure/cache/')) return [];
      if (relativePath.startsWith('libs/core/interceptors/')) return [];
      if (relativePath.startsWith('libs/core/types/')) return [];
      const lines = readFileSync(file, 'utf8').split('\n');
      return lines.flatMap((line, index) =>
        /\b(invalidateCacheByPattern|invalidateByPattern|invalidatePattern|delPattern)\(/.test(
          line
        ) && !/^\s*(async|\*|\/\/)/.test(line)
          ? [`${relativePath}:${index + 1}`]
          : []
      );
    });
    const filesWithCallSites = new Set(callSites.map(site => site.split(':')[0]));
    const filesInTable = new Set(SERVICE_PATTERNS.map(entry => entry.file));
    const unlisted = [...filesWithCallSites].filter(
      file =>
        !filesInTable.has(file ?? '') &&
        file !== 'libs/infrastructure/database/internal/query-cache.service.ts' &&
        file !== 'libs/infrastructure/cache/layers/multi-layer-cache.service.ts'
    );

    expect(unlisted).toEqual([]);
  });

  it.each(SERVICE_PATTERNS.map(entry => [`${entry.file}  ${entry.template}`, entry] as const))(
    '%s still exists in the source',
    (_label, entry) => {
      expect(readFileSync(join(SRC, entry.file), 'utf8')).toContain(entry.template);
    }
  );

  it.each(SERVICE_PATTERNS.map(entry => [`${entry.file}  ${entry.template}`, entry] as const))(
    '%s never deletes security state, and is tenant-bound unless listed as known-broad',
    async (_label, entry) => {
      const world = createWorld();
      const patternA = instantiate(entry.template, 'A');
      const patternB = instantiate(entry.template, 'B');
      const keyA = keyMatching(patternA);
      const keyB = keyMatching(patternB);
      world.server.seed(keyA);
      world.server.seed(keyB);
      if (!entry.template.startsWith('rate_limit:')) {
        // Keys of tenant A that the pattern is allowed to match must not be security keys.
        expect(isProtectedKey(keyA)).toBe(false);
      }

      await world.cacheService.invalidateCacheByPattern(patternA);

      expect(deleted(world, SECURITY_KEYS)).toEqual([]);
      const reachedOtherTenant = keyB !== keyA && !world.server.has(keyB);
      const sameKeyForBothTenants = keyA === keyB;
      const broad = reachedOtherTenant || sameKeyForBothTenants;
      if (KNOWN_BROAD_SERVICE_PATTERNS.has(entry.template)) {
        expect(broad || entry.template.startsWith('${this.CACHE_PREFIX}')).toBe(true);
      } else if (entry.template.startsWith('rate_limit:')) {
        // refused as a protected namespace: nothing is deleted, for any tenant
        expect(world.server.has(keyB)).toBe(true);
      } else {
        expect(reachedOtherTenant).toBe(false);
        expect(sameKeyForBothTenants).toBe(false);
      }
    }
  );
});
