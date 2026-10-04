/// <reference types="jest" />
/**
 * Lab reports and medical history carry a `status` in their responses, and a new lab
 * report keeps the clinic / doctor / notes the controller sends (they used to be dropped,
 * which hid the report from the clinic-scoped list and made it un-editable).
 */

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EHRService } from '@services/ehr/ehr.service';
import { CreateLabReportDto, CreateMedicalHistoryDto, UpdateLabReportDto } from '@dtos/ehr.dto';

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

const NOW = new Date('2026-03-01T00:00:00Z');

function createHarness() {
  const client = {
    labReport: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'lab-1',
        createdAt: NOW,
        updatedAt: NOW,
        ...data,
      })),
      findMany: jest.fn(),
    },
    medicalHistory: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'history-1',
        createdAt: NOW,
        updatedAt: NOW,
        ...data,
      })),
    },
    userRole: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const databaseService = {
    executeHealthcareRead: jest.fn(async (op: (c: unknown) => Promise<unknown>) => op(client)),
    executeHealthcareWrite: jest.fn(async (op: (c: unknown) => Promise<unknown>) => op(client)),
  };
  const cacheService = {
    invalidateCacheByTag: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  };
  const service = new EHRService(
    databaseService as never,
    cacheService as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    {} as never,
    {
      emit: jest.fn().mockResolvedValue(undefined),
      emitAsync: jest.fn(),
      emitEnterprise: jest.fn(),
      on: jest.fn(),
      onAny: jest.fn(),
    },
    undefined
  );
  return { service, client };
}

describe('lab report status + clinic', () => {
  it('stores clinicId, doctorId, notes and status and returns the status', async () => {
    const h = createHarness();

    const report = await h.service.createLabReport({
      userId: 'user-1',
      clinicId: 'clinic-1',
      testName: 'CBC',
      result: '12',
      date: '2026-03-01',
      doctorId: 'doc-1',
      notes: 'fasting',
      status: 'PENDING',
    });

    expect(h.client.labReport.create.mock.calls[0]?.[0]).toMatchObject({
      data: {
        userId: 'user-1',
        clinicId: 'clinic-1',
        doctorId: 'doc-1',
        notes: 'fasting',
        status: 'PENDING',
      },
    });
    expect(report).toMatchObject({ status: 'PENDING', clinicId: 'clinic-1', notes: 'fasting' });
  });

  it('a report without a stored status is returned as COMPLETED (old rows)', async () => {
    const h = createHarness();

    const report = await h.service.createLabReport({
      userId: 'user-1',
      clinicId: 'clinic-1',
      testName: 'CBC',
      result: '12',
      date: '2026-03-01',
    });

    expect(h.client.labReport.create.mock.calls[0]?.[0]).not.toHaveProperty('data.status');
    expect(report.status).toBe('COMPLETED');
  });
});

describe('medical history status', () => {
  it('stores and returns the status; an old row without one reads as ACTIVE', async () => {
    const h = createHarness();

    const chronic = await h.service.createMedicalHistory({
      userId: 'user-1',
      clinicId: 'clinic-1',
      condition: 'Asthma',
      date: '2026-03-01',
      status: 'CHRONIC',
    });
    const plain = await h.service.createMedicalHistory({
      userId: 'user-1',
      clinicId: 'clinic-1',
      condition: 'Cold',
      date: '2026-03-01',
    });

    expect(chronic.status).toBe('CHRONIC');
    expect(plain.status).toBe('ACTIVE');
  });
});

describe('status validation', () => {
  it('accepts the documented values and rejects anything else with a validation error', async () => {
    const lab = plainToInstance(CreateLabReportDto, {
      userId: 'u',
      testName: 't',
      result: 'r',
      date: '2026-03-01',
      status: 'DONE',
    });
    expect((await validate(lab)).map(e => e.property)).toContain('status');

    const ok = plainToInstance(UpdateLabReportDto, { status: 'REVIEWED' });
    expect(await validate(ok)).toHaveLength(0);

    const history = plainToInstance(CreateMedicalHistoryDto, {
      userId: 'u',
      condition: 'c',
      date: '2026-03-01',
      status: 'ACTIVE',
    });
    expect(await validate(history)).toHaveLength(0);
    history.status = 'GONE' as never;
    expect((await validate(history)).map(e => e.property)).toContain('status');
  });
});
