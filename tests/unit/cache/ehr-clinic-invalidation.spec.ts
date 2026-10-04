/// <reference types="jest" />
/**
 * An EHR write must reach the clinic-wide EHR reads (patient list, summary, analytics, search,
 * critical alerts) of every clinic the patient belongs to, and ONLY those: the tags are per clinic
 * so one clinic's write never flushes another clinic's lists.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EHRService } from '@services/ehr/ehr.service';
import { CACHE_KEY, LongCache } from '@core/decorators/cache.decorator';
import { resolveTagTemplates } from '@core/interceptors/cache-key-scope.util';
import type { ScopedRequest } from '@core/interceptors/cache-key-scope.util';

jest.mock('@infrastructure/database', () => ({ DatabaseService: class DatabaseService {} }));
jest.mock('@infrastructure/database/database.service', () => ({
  DatabaseService: class DatabaseService {},
}));
jest.mock('@infrastructure/database/query', () => ({
  addDateRangeFilter: jest.fn(),
  addStringFilter: jest.fn(),
  USER_SELECT_FIELDS: {},
}));
jest.mock('@infrastructure/storage/static-asset.service', () => ({
  AssetType: { MEDICAL_RECORD: 'medical-records', DOCUMENT: 'documents' },
  StaticAssetService: class StaticAssetService {},
}));
jest.mock('@infrastructure/cache/cache.service', () => ({ CacheService: class CacheService {} }));
jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));
jest.mock('@infrastructure/events/event.service', () => ({
  EventService: class EventService {},
}));
jest.mock('@queue/src/queue.service', () => ({ QueueService: class QueueService {} }));

const PATIENT = 'patient-0001';
const CLINIC_A = 'clinic-a';
const CLINIC_B = 'clinic-b';

function createService(memberships: ReadonlyArray<{ clinicId: string | null }>) {
  const tags: string[] = [];
  const findMany = jest.fn().mockResolvedValue(memberships);
  const service = Object.create(EHRService.prototype) as EHRService;
  Object.assign(service, {
    databaseService: {
      executeHealthcareRead: jest.fn((operation: (client: unknown) => Promise<unknown>) =>
        operation({ userRole: { findMany } })
      ),
    },
    cacheService: {
      invalidateCacheByTag: jest.fn((tag: string) => {
        tags.push(tag);
        return Promise.resolve(1);
      }),
    },
    loggingService: { log: jest.fn() },
  });
  return { service, tags, findMany };
}

describe('EHRService.invalidateUserEHRCache', () => {
  it('invalidates the patient tags plus the clinic-wide tags of the clinic it is given', async () => {
    const { service, tags, findMany } = createService([]);

    await service.invalidateUserEHRCache(PATIENT, CLINIC_A);

    expect(tags.sort()).toEqual(
      [
        `ehr:${PATIENT}`,
        `user:${PATIENT}`,
        `clinic:${CLINIC_A}`,
        `clinic_ehr:${CLINIC_A}`,
        `patient_records:${CLINIC_A}`,
        `patient_summary:${CLINIC_A}`,
        `alerts:${CLINIC_A}`,
      ].sort()
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it('looks up the patient clinics when the caller only passes the user id', async () => {
    const { service, tags, findMany } = createService([
      { clinicId: CLINIC_A },
      { clinicId: CLINIC_B },
      { clinicId: CLINIC_A },
      { clinicId: null },
    ]);

    await service.invalidateUserEHRCache(PATIENT);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: PATIENT, isActive: true, clinicId: { not: null } },
      })
    );
    for (const clinic of [CLINIC_A, CLINIC_B]) {
      expect(tags).toEqual(
        expect.arrayContaining([
          `clinic:${clinic}`,
          `clinic_ehr:${clinic}`,
          `patient_records:${clinic}`,
          `patient_summary:${clinic}`,
          `alerts:${clinic}`,
        ])
      );
    }
    expect(tags.filter(tag => tag === `clinic:${CLINIC_A}`)).toHaveLength(1);
    expect(tags).not.toContain('clinic_ehr');
    expect(tags).not.toContain('alerts');
  });

  it('still invalidates the patient tags when the clinic lookup fails', async () => {
    const { service, tags, findMany } = createService([]);
    findMany.mockRejectedValue(new Error('replica unavailable'));

    await expect(service.invalidateUserEHRCache(PATIENT)).resolves.toBeUndefined();

    expect(tags.sort()).toEqual([`ehr:${PATIENT}`, `user:${PATIENT}`].sort());
  });
});

describe('the clinic-wide EHR reads register the tags that writes invalidate', () => {
  const source = readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      'src',
      'services',
      'ehr',
      'controllers',
      'ehr-clinic.controller.ts'
    ),
    'utf8'
  );
  const tagLists = Array.from(source.matchAll(/tags:\s*\[([^\]]*)\]/g), match =>
    Array.from((match[1] ?? '').matchAll(/'([^']*)'/g), tag => tag[1] ?? '')
  );
  const request = {
    clinicContext: { clinicId: CLINIC_A },
    user: { sub: 'doc', role: 'DOCTOR' },
  } as ScopedRequest;

  it('finds the six clinic reads', () => {
    expect(tagLists).toHaveLength(6);
  });

  it('every clinic read registers clinic:<id> and a per-clinic clinic_ehr tag, never the global one', () => {
    for (const tags of tagLists) {
      const resolved = resolveTagTemplates(tags, request, false);
      expect(resolved).toContain(`clinic:${CLINIC_A}`);
      expect(resolved).toContain(`clinic_ehr:${CLINIC_A}`);
      expect(resolved).not.toContain('clinic_ehr');
    }
  });

  it('the patient list, summary and alerts reads register the per-clinic tags the write invalidates', () => {
    const all = tagLists.flatMap(tags => resolveTagTemplates(tags, request, false));
    expect(all).toEqual(
      expect.arrayContaining([
        `patient_records:${CLINIC_A}`,
        `patient_summary:${CLINIC_A}`,
        `alerts:${CLINIC_A}`,
      ])
    );
  });
});

describe('GET /doctors/:id (LongCache)', () => {
  it('is tagged so the doctor update and user-profile invalidations reach it', () => {
    class Handlers {
      handler(): void {}
    }
    const descriptor = Object.getOwnPropertyDescriptor(Handlers.prototype, 'handler');
    if (!descriptor) throw new Error('missing descriptor');
    LongCache(86400, ['doctor:{id}', 'user:{id}'])(Handlers.prototype, 'handler', descriptor);

    const metadata = Reflect.getMetadata(CACHE_KEY, descriptor.value as object) as {
      ttl: number;
      tags: string[];
    };

    expect(metadata.ttl).toBe(86400);
    expect(
      resolveTagTemplates(
        metadata.tags,
        { params: { id: 'doctor-user-1' } } as unknown as ScopedRequest,
        false
      )
    ).toEqual(['long-cache', 'doctor:doctor-user-1', 'user:doctor-user-1']);
  });

  it('the controller really declares those tags', () => {
    const source = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        'src',
        'services',
        'doctors',
        'controllers',
        'doctors.controller.ts'
      ),
      'utf8'
    );

    expect(source).toContain("@LongCache(86400, ['doctor:{id}', 'user:{id}'])");
  });
});
