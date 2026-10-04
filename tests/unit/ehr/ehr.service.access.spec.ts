/**
 * Unit tests for the ownership / tenant checks added to EHRService:
 *  - GET /ehr/medical-records/:id (PATIENT must own the record; self or ACTIVE dependent)
 *  - GET /ehr/:patientId/summary (clinic scoped)
 *  - clinic scoping of lab-report delete and medical-record file upload
 */

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EHRService } from '@services/ehr/ehr.service';

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

const CLINIC = 'clinic-1';

// Shaped like the real `HealthRecord` table: there is NO `updatedAt` column.
const RECORD_ROW = {
  id: 'record-1',
  patientId: 'patient-owner',
  clinicId: CLINIC,
  recordType: 'GENERAL_DOCUMENT',
  title: 'Blood test',
  doctorId: 'doctor-1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

function createService(
  options: { recordRow?: typeof RECORD_ROW | null; dependents?: boolean } = {}
) {
  const recordRow = options.recordRow === undefined ? RECORD_ROW : options.recordRow;
  const client = {
    healthRecord: {
      findFirst: jest.fn().mockResolvedValue(recordRow),
      update: jest.fn().mockResolvedValue({}),
    },
    labReport: {
      findUnique: jest.fn().mockResolvedValue({ userId: 'user-owner', clinicId: 'clinic-other' }),
      delete: jest.fn().mockResolvedValue({}),
    },
    // Scope resolution for the calling PATIENT (user-caller -> patient-caller)
    patient: {
      findFirst: jest.fn().mockResolvedValue({ id: 'patient-caller' }),
      findMany: jest
        .fn()
        .mockResolvedValue(
          options.dependents ? [{ id: 'patient-owner', userId: 'user-child' }] : []
        ),
    },
    familyMember: {
      findMany: jest.fn().mockResolvedValue(options.dependents ? [{ userId: 'user-child' }] : []),
    },
  };
  const databaseService = {
    executeHealthcareRead: jest.fn(async (operation: (c: unknown) => Promise<unknown>) =>
      operation(client)
    ),
    executeHealthcareWrite: jest.fn(async (operation: (c: unknown) => Promise<unknown>) =>
      operation(client)
    ),
  };
  const cacheService = {
    cache: jest.fn(async (_key: string, load: () => Promise<unknown>) => load()),
    invalidateCacheByTag: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  };
  const loggingService = { log: jest.fn().mockResolvedValue(undefined) };
  const staticAssetService = {
    uploadFile: jest.fn().mockResolvedValue({ success: true, url: '/storage/x', key: 'k' }),
  };
  const eventService = {
    emit: jest.fn().mockResolvedValue(undefined),
    emitAsync: jest.fn(),
    emitEnterprise: jest.fn(),
    on: jest.fn(),
    onAny: jest.fn(),
  };

  const service = new EHRService(
    databaseService as never,
    cacheService as never,
    loggingService as never,
    staticAssetService as never,
    eventService,
    undefined
  );
  return { service, client, databaseService, staticAssetService };
}

describe('EHRService.getMedicalRecordById ownership', () => {
  it('returns the record to staff without any ownership lookup', async () => {
    const { service, client } = createService();

    const result = await service.getMedicalRecordById('record-1', CLINIC, {
      userId: 'doctor-user',
      role: 'DOCTOR',
    });

    expect(result?.id).toBe('record-1');
    expect(client.patient.findFirst).not.toHaveBeenCalled();
  });

  it('returns the record when no viewer is supplied (internal update/delete callers)', async () => {
    const { service } = createService();
    await expect(service.getMedicalRecordById('record-1', CLINIC)).resolves.toMatchObject({
      id: 'record-1',
    });
  });

  it('rejects a PATIENT reading another patient record with 403', async () => {
    const { service } = createService();

    await expect(
      service.getMedicalRecordById('record-1', CLINIC, { userId: 'user-caller', role: 'PATIENT' })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows a PATIENT to read a record that belongs to their own Patient row', async () => {
    const { service, client } = createService({
      recordRow: { ...RECORD_ROW, patientId: 'patient-caller' },
    });

    const result = await service.getMedicalRecordById('record-1', CLINIC, {
      userId: 'user-caller',
      role: 'PATIENT',
    });

    expect(result?.userId).toBe('patient-caller');
    expect(client.patient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-caller' } })
    );
  });

  it('allows a PATIENT to read the record of an ACTIVE dependent', async () => {
    const { service } = createService({ dependents: true });

    await expect(
      service.getMedicalRecordById('record-1', CLINIC, { userId: 'user-caller', role: 'PATIENT' })
    ).resolves.toMatchObject({ id: 'record-1' });
  });

  it('maps a row WITHOUT an updatedAt column (the real table shape): updatedAt falls back to createdAt', async () => {
    const { service } = createService();

    const result = await service.getMedicalRecordById('record-1', CLINIC, {
      userId: 'doctor-user',
      role: 'DOCTOR',
    });

    expect(result).toMatchObject({
      id: 'record-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('uses updatedAt when a row does carry one', async () => {
    const { service } = createService({
      recordRow: {
        ...RECORD_ROW,
        updatedAt: new Date('2026-02-02T00:00:00Z'),
      } as typeof RECORD_ROW,
    });

    await expect(
      service.getMedicalRecordById('record-1', CLINIC, { userId: 'doctor-user', role: 'DOCTOR' })
    ).resolves.toMatchObject({ updatedAt: '2026-02-02T00:00:00.000Z' });
  });

  it('the OWNER (PATIENT) reads their own record: 200 with a mapped body', async () => {
    const { service } = createService({
      recordRow: { ...RECORD_ROW, patientId: 'patient-caller' },
    });

    await expect(
      service.getMedicalRecordById('record-1', CLINIC, { userId: 'user-caller', role: 'PATIENT' })
    ).resolves.toMatchObject({
      id: 'record-1',
      userId: 'patient-caller',
      type: 'GENERAL_DOCUMENT',
      title: 'Blood test',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('a non-owner PATIENT gets 403 even when the stored row could not be mapped (access is decided before mapping)', async () => {
    const { service } = createService({
      recordRow: { ...RECORD_ROW, createdAt: undefined } as unknown as typeof RECORD_ROW,
    });

    await expect(
      service.getMedicalRecordById('record-1', CLINIC, { userId: 'user-caller', role: 'PATIENT' })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('still returns null for an unknown record without an ownership error', async () => {
    const { service } = createService({ recordRow: null });

    await expect(
      service.getMedicalRecordById('missing', CLINIC, { userId: 'user-caller', role: 'PATIENT' })
    ).resolves.toBeNull();
  });

  it('scopes the lookup by clinic when a clinic is supplied', async () => {
    const { service, client } = createService();

    await service.getMedicalRecordById('record-1', CLINIC, {
      userId: 'doctor-user',
      role: 'DOCTOR',
    });

    expect(client.healthRecord.findFirst).toHaveBeenCalledWith({
      where: { id: 'record-1', clinicId: CLINIC },
    });
  });
});

describe('EHRService.getEHRAISummary clinic scoping', () => {
  it('passes the caller clinic into the comprehensive record read', async () => {
    const { service } = createService();
    const comprehensive = jest.spyOn(service, 'getComprehensiveHealthRecord').mockResolvedValue({
      medicalHistory: [],
      labReports: [],
      radiologyReports: [],
      surgicalRecords: [],
      vitals: [],
      allergies: [],
      medications: [],
      immunizations: [],
      familyHistory: [],
      prescriptions: [],
    } as never);

    const summary = await service.getEHRAISummary('user-1', CLINIC);

    expect(comprehensive).toHaveBeenCalledWith('user-1', CLINIC);
    expect(summary.patientId).toBe('user-1');
  });
});

describe('EHRService tenant isolation of writes', () => {
  it('deleteLabReport reports a lab report of another clinic as not found and deletes nothing', async () => {
    const { service, client } = createService();

    await expect(service.deleteLabReport('lab-1', CLINIC)).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(client.labReport.delete).not.toHaveBeenCalled();
  });

  it('uploadMedicalRecordFile only finds records of the caller clinic', async () => {
    const { service, client, staticAssetService } = createService({ recordRow: null });

    const result = await service.uploadMedicalRecordFile(
      'record-1',
      Buffer.from('%PDF-1.4 test'),
      'a.pdf',
      'application/pdf',
      CLINIC
    );

    expect(result).toBeNull();
    expect(client.healthRecord.findFirst).toHaveBeenCalledWith({
      where: { id: 'record-1', clinicId: CLINIC },
    });
    expect(staticAssetService.uploadFile).not.toHaveBeenCalled();
  });
});
