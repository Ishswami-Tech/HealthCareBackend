/// <reference types="jest" />
/**
 * Staff upload of a medical-record file (POST /ehr/medical-records/:id/upload):
 * validation, private storage, failure handling and presigned URLs on read.
 */

import {
  BadRequestException,
  InternalServerErrorException,
  PayloadTooLargeException,
} from '@nestjs/common';
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
const SIGNED = 'https://signed.example/medical-records/x.pdf?X-Amz-Signature=sig';
const STORED_URL = 'https://cdn.example.com/medical-records/uuid-doc-record-1-1.pdf';

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 0x01),
]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

function recordRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'record-1',
    patientId: 'patient-owner',
    clinicId: CLINIC,
    recordType: 'GENERAL_DOCUMENT',
    title: 'Blood test',
    doctorId: 'doctor-1',
    // The HealthRecord model has no `updatedAt` column.
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

interface HarnessOptions {
  rows?: Array<ReturnType<typeof recordRow>>;
  uploaded?: { success: boolean; url?: string; key?: string; localPath?: string; error?: string };
  writeError?: Error;
  deleteResult?: boolean | Error;
}

function createHarness(options: HarnessOptions = {}) {
  const rows = options.rows ?? [recordRow()];
  const client = {
    healthRecord: {
      findFirst: jest.fn().mockResolvedValue(rows[0] ?? null),
      findMany: jest.fn().mockResolvedValue(rows),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    // `:userId` / `:patientId` may be either id: the list resolves the Patient row first.
    patient: {
      findFirst: jest.fn().mockResolvedValue({ id: 'patient-owner', userId: 'user-owner' }),
    },
  };
  const databaseService = {
    executeHealthcareRead: jest.fn(async (operation: (c: unknown) => Promise<unknown>) =>
      operation(client)
    ),
    executeHealthcareWrite: jest.fn(async (operation: (c: unknown) => Promise<unknown>) => {
      if (options.writeError) throw options.writeError;
      return operation(client);
    }),
  };
  const cacheService = { cache: jest.fn(), invalidateCacheByTag: jest.fn(), del: jest.fn() };
  const loggingService = { log: jest.fn().mockResolvedValue(undefined) };
  const staticAssetService = {
    uploadFile: jest
      .fn()
      .mockResolvedValue(
        options.uploaded ?? { success: true, url: STORED_URL, key: 'medical-records/uuid-doc.pdf' }
      ),
    deleteAsset:
      options.deleteResult instanceof Error
        ? jest.fn().mockRejectedValue(options.deleteResult)
        : jest.fn().mockResolvedValue(options.deleteResult ?? true),
    resolveSignedUrl: jest.fn(async (url: string) => (url === STORED_URL ? SIGNED : url)),
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
  return { service, client, databaseService, loggingService, staticAssetService, eventService };
}

function upload(
  h: ReturnType<typeof createHarness>,
  buffer: Buffer,
  mimeType = 'application/pdf',
  fileName = 'report.pdf'
) {
  return h.service.uploadMedicalRecordFile('record-1', buffer, fileName, mimeType, CLINIC);
}

describe('EHRService.uploadMedicalRecordFile validation', () => {
  it('rejects an empty file with 400 before anything is looked up or stored', async () => {
    const h = createHarness();

    await expect(upload(h, Buffer.alloc(0))).rejects.toBeInstanceOf(BadRequestException);

    expect(h.client.healthRecord.findFirst).not.toHaveBeenCalled();
    expect(h.staticAssetService.uploadFile).not.toHaveBeenCalled();
  });

  it('rejects a file over 10 MB with 413 and stores nothing', async () => {
    const h = createHarness();
    const big = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024, 0x20)]);

    await expect(upload(h, big)).rejects.toBeInstanceOf(PayloadTooLargeException);

    expect(h.staticAssetService.uploadFile).not.toHaveBeenCalled();
  });

  it('accepts exactly 10 MB', async () => {
    const h = createHarness();
    const exact = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024 - PDF.length, 0x20)]);
    expect(exact.length).toBe(10 * 1024 * 1024);

    await expect(upload(h, exact)).resolves.toMatchObject({ fileUrl: SIGNED });
  });

  it.each([
    ['declared text/html', HTML, 'text/html'],
    [
      'declared image/svg+xml',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      'image/svg+xml',
    ],
    ['declared application/dicom (not supported)', PDF, 'application/dicom'],
    ['declared executable', PDF, 'application/x-msdownload'],
    ['declared PDF but HTML bytes (signature check)', HTML, 'application/pdf'],
    [
      'declared image/png but script bytes',
      Buffer.from('#!/bin/sh\nrm -rf / --no-preserve-root\n'),
      'image/png',
    ],
    [
      'no declared type and unknown bytes',
      Buffer.from('just some plain text here'),
      'application/octet-stream',
    ],
  ])('rejects %s with 400 and stores nothing', async (_label, buffer, mimeType) => {
    const h = createHarness();

    await expect(upload(h, buffer, mimeType)).rejects.toBeInstanceOf(BadRequestException);

    expect(h.staticAssetService.uploadFile).not.toHaveBeenCalled();
    expect(h.databaseService.executeHealthcareWrite).not.toHaveBeenCalled();
  });

  it.each([
    ['application/pdf', PDF, 'application/pdf'],
    ['image/png', PNG, 'image/png'],
    [
      'image/jpg',
      Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]),
      'image/jpeg',
    ],
  ])('accepts a declared %s', async (declared, buffer, canonical) => {
    const h = createHarness();

    await upload(h, buffer, declared);

    expect(h.staticAssetService.uploadFile).toHaveBeenCalledWith(
      buffer,
      expect.any(String),
      'medical-records',
      canonical,
      false
    );
  });
});

describe('EHRService.uploadMedicalRecordFile storage', () => {
  it('stores PRIVATE under medical-records/ with a flat sanitised name and the canonical mime type', async () => {
    const h = createHarness();

    const result = await upload(h, PDF, 'application/octet-stream', '../../etc/passwd; rm -rf.pdf');

    const [buffer, storageName, folder, mimeType, isPublic] = h.staticAssetService.uploadFile.mock
      .calls[0] as [Buffer, string, string, string, boolean];
    expect(buffer).toBe(PDF);
    expect(storageName).toMatch(/^doc-record-1-\d+\.pdf$/);
    expect(storageName).not.toMatch(/[\\/]/);
    expect(folder).toBe('medical-records');
    expect(mimeType).toBe('application/pdf');
    expect(isPublic).toBe(false);
    expect(result?.record.mimeType).toBe('application/pdf');
  });

  it('persists the STORED url (never the presigned one) with size and canonical type', async () => {
    const h = createHarness();

    await upload(h, PDF);

    expect(h.client.healthRecord.update).toHaveBeenCalledWith({
      where: { id: 'record-1' },
      data: { fileUrl: STORED_URL, fileSize: PDF.length, mimeType: 'application/pdf' },
    });
  });

  it('returns the presigned URL in the response, in both the record and fileUrl', async () => {
    const h = createHarness();

    const result = await upload(h, PDF);

    // the signature is bound to the row: the key must carry the record or patient id
    expect(h.staticAssetService.resolveSignedUrl).toHaveBeenCalledWith(STORED_URL, undefined, {
      boundTo: ['record-1', 'patient-owner'],
    });
    expect(result).toMatchObject({
      fileUrl: SIGNED,
      fileKey: 'medical-records/uuid-doc.pdf',
      record: {
        id: 'record-1',
        userId: 'patient-owner',
        clinicId: CLINIC,
        fileUrl: SIGNED,
        fileSize: PDF.length,
      },
    });
    expect(h.eventService.emit).toHaveBeenCalledWith('ehr.medical_record.file_uploaded', {
      recordId: 'record-1',
      userId: 'patient-owner',
      fileKey: 'medical-records/uuid-doc.pdf',
    });
  });

  it.each([
    ['storage reports failure', { success: false, error: 'disk full' }],
    ['storage returns no url', { success: true, key: 'medical-records/x' }],
  ])('%s -> 500 and no record is touched', async (_label, uploaded) => {
    const h = createHarness({ uploaded });

    await expect(upload(h, PDF)).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(h.databaseService.executeHealthcareWrite).not.toHaveBeenCalled();
    expect(h.client.healthRecord.update).not.toHaveBeenCalled();
    expect(h.eventService.emit).not.toHaveBeenCalled();
    expect(h.staticAssetService.deleteAsset).not.toHaveBeenCalled();
  });

  it('removes the stored object when the DB write fails, and rethrows the original error', async () => {
    const h = createHarness({ writeError: new Error('update failed') });

    await expect(upload(h, PDF)).rejects.toThrow('update failed');

    expect(h.staticAssetService.deleteAsset).toHaveBeenCalledWith('medical-records/uuid-doc.pdf');
    expect(h.eventService.emit).not.toHaveBeenCalled();
  });

  it('cleans up a local-disk upload through its relative /storage reference, never the absolute disk path', async () => {
    const h = createHarness({
      uploaded: {
        success: true,
        url: '/storage/assets/medical-records/x.pdf',
        localPath: 'C:/s/x.pdf',
      },
      writeError: new Error('update failed'),
    });

    await expect(upload(h, PDF)).rejects.toThrow('update failed');

    expect(h.staticAssetService.deleteAsset).toHaveBeenCalledTimes(1);
    expect(h.staticAssetService.deleteAsset).toHaveBeenCalledWith(
      '/storage/assets/medical-records/x.pdf'
    );
  });

  it('a failing cleanup never masks the original error; the orphan is logged', async () => {
    const h = createHarness({
      writeError: new Error('update failed'),
      deleteResult: new Error('s3 down'),
    });

    await expect(upload(h, PDF)).rejects.toThrow('update failed');

    expect(h.loggingService.log).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringContaining('Orphaned medical record file'),
      'EHRService',
      expect.objectContaining({ recordId: 'record-1', storageRef: 'medical-records/uuid-doc.pdf' })
    );
  });

  it('still returns null for a record of another clinic and stores nothing', async () => {
    const h = createHarness({ rows: [] });

    await expect(upload(h, PDF)).resolves.toBeNull();

    expect(h.client.healthRecord.findFirst).toHaveBeenCalledWith({
      where: { id: 'record-1', clinicId: CLINIC },
    });
    expect(h.staticAssetService.uploadFile).not.toHaveBeenCalled();
  });
});

describe('EHRService medical-record reads return presigned file URLs', () => {
  it('getMedicalRecords signs each record with a stored file and leaves the others alone', async () => {
    const h = createHarness({
      rows: [
        recordRow({
          id: 'with-file',
          fileUrl: STORED_URL,
          fileSize: 10,
          mimeType: 'application/pdf',
        }),
        recordRow({ id: 'no-file', fileUrl: '' }),
        recordRow({ id: 'local', fileUrl: '/storage/assets/medical-records/y.pdf' }),
      ],
    });

    const records = await h.service.getMedicalRecords('patient-owner', CLINIC);

    expect(records.map(r => [r.id, r.fileUrl])).toEqual([
      ['with-file', SIGNED],
      ['no-file', undefined],
      ['local', '/storage/assets/medical-records/y.pdf'],
    ]);
    expect(h.staticAssetService.resolveSignedUrl).toHaveBeenCalledTimes(2);
  });

  it('getMedicalRecordById signs the file URL', async () => {
    const h = createHarness({ rows: [recordRow({ fileUrl: STORED_URL })] });

    const record = await h.service.getMedicalRecordById('record-1', CLINIC, {
      userId: 'doctor-user',
      role: 'DOCTOR',
    });

    expect(record?.fileUrl).toBe(SIGNED);
  });

  it('never writes the presigned URL back to the database on an update', async () => {
    const h = createHarness({ rows: [recordRow({ fileUrl: STORED_URL })] });

    await h.service.updateMedicalRecord('record-1', { title: 'Renamed' }, CLINIC);

    const updateCall = h.client.healthRecord.update.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(updateCall.data).toEqual({ title: 'Renamed' });
  });

  it('lists records of a patient addressed by either id, scoped to the resolved Patient.id', async () => {
    const h = createHarness({ rows: [recordRow()] });

    await h.service.getMedicalRecords('user-owner', CLINIC);

    // no clinic condition on the identity lookup: the record query itself is clinic scoped
    expect(h.client.patient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ OR: [{ id: 'user-owner' }, { userId: 'user-owner' }] }, {}] },
      })
    );
    expect(h.client.healthRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { patientId: 'patient-owner', clinicId: CLINIC } })
    );
  });

  it('an unknown patient lists nothing and queries no records', async () => {
    const h = createHarness();
    h.client.patient.findFirst.mockResolvedValue(null);

    await expect(h.service.getMedicalRecords('nobody', CLINIC)).resolves.toEqual([]);
    expect(h.client.healthRecord.findMany).not.toHaveBeenCalled();
  });
});

describe('EHRService PHI objects are not orphaned', () => {
  const OLD_STORED = 'https://cdn.example.com/medical-records/old-uuid-doc-record-1-1.pdf';
  const OLD_SIGNED = `${OLD_STORED}?X-Amz-Signature=old`;

  function replaceHarness(options: HarnessOptions = {}) {
    // The record already has a file: it is read back as a presigned URL.
    const h = createHarness({ rows: [recordRow({ fileUrl: OLD_STORED })], ...options });
    h.staticAssetService.resolveSignedUrl.mockImplementation(async (url: string) =>
      url === OLD_STORED ? OLD_SIGNED : url === STORED_URL ? SIGNED : url
    );
    return h;
  }

  it('re-uploading removes the PREVIOUS object after the new one is stored and the row updated', async () => {
    const h = replaceHarness();

    await upload(h, PDF);

    expect(h.client.healthRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ fileUrl: STORED_URL }) })
    );
    expect(h.staticAssetService.deleteAsset).toHaveBeenCalledTimes(1);
    // the previous object, by key (derived from the presigned URL), never the new one
    expect(h.staticAssetService.deleteAsset).toHaveBeenCalledWith(
      'medical-records/old-uuid-doc-record-1-1.pdf'
    );
    expect(h.staticAssetService.deleteAsset).not.toHaveBeenCalledWith(
      'medical-records/uuid-doc.pdf'
    );
    // ordering: the old object is removed only after the DB write
    const writeOrder = h.databaseService.executeHealthcareWrite.mock.invocationCallOrder[0] ?? 0;
    const deleteOrder = h.staticAssetService.deleteAsset.mock.invocationCallOrder[0] ?? 0;
    expect(deleteOrder).toBeGreaterThan(writeOrder);
  });

  it('a failed DB write keeps the previous object and removes only the new one', async () => {
    const h = replaceHarness({ writeError: new Error('update failed') });

    await expect(upload(h, PDF)).rejects.toThrow('update failed');

    expect(h.staticAssetService.deleteAsset).toHaveBeenCalledTimes(1);
    expect(h.staticAssetService.deleteAsset).toHaveBeenCalledWith('medical-records/uuid-doc.pdf');
  });

  it('removing the previous object is best effort: a storage failure is logged, the upload still succeeds', async () => {
    const h = replaceHarness({ deleteResult: new Error('s3 down') });

    await expect(upload(h, PDF)).resolves.toMatchObject({ fileUrl: SIGNED });

    expect(h.loggingService.log).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringContaining('Orphaned medical record file'),
      'EHRService',
      expect.objectContaining({
        recordId: 'record-1',
        storageRef: 'medical-records/old-uuid-doc-record-1-1.pdf',
        reason: 'file replaced',
      })
    );
  });

  it('the first upload (no previous file) deletes nothing', async () => {
    const h = createHarness();

    await upload(h, PDF);

    expect(h.staticAssetService.deleteAsset).not.toHaveBeenCalled();
  });

  it('deleting a record removes its stored file (best effort)', async () => {
    const h = replaceHarness();

    await expect(h.service.deleteMedicalRecord('record-1', CLINIC)).resolves.toBe(true);

    expect(h.client.healthRecord.delete).toHaveBeenCalledWith({ where: { id: 'record-1' } });
    expect(h.staticAssetService.deleteAsset).toHaveBeenCalledWith(
      'medical-records/old-uuid-doc-record-1-1.pdf'
    );
  });

  it('deleting a record whose file cannot be removed still succeeds and logs the orphan', async () => {
    const h = replaceHarness({ deleteResult: false });

    await expect(h.service.deleteMedicalRecord('record-1', CLINIC)).resolves.toBe(true);

    expect(h.loggingService.log).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringContaining('Orphaned medical record file'),
      'EHRService',
      expect.objectContaining({ reason: 'record deleted' })
    );
  });

  it('deleting a record without a file, or with a foreign file URL, deletes no object', async () => {
    const noFile = createHarness();
    await noFile.service.deleteMedicalRecord('record-1', CLINIC);
    expect(noFile.staticAssetService.deleteAsset).not.toHaveBeenCalled();

    const foreign = createHarness({
      rows: [recordRow({ fileUrl: 'https://evil.example/other/x.pdf' })],
    });
    await foreign.service.deleteMedicalRecord('record-1', CLINIC);
    expect(foreign.staticAssetService.deleteAsset).not.toHaveBeenCalled();
  });

  it('a record of another clinic is not deleted and its file is untouched', async () => {
    const h = replaceHarness({ rows: [recordRow({ clinicId: 'clinic-2', fileUrl: OLD_STORED })] });

    await expect(h.service.deleteMedicalRecord('record-1', CLINIC)).rejects.toThrow(
      'Medical record with ID record-1 not found'
    );
    expect(h.client.healthRecord.delete).not.toHaveBeenCalled();
    expect(h.staticAssetService.deleteAsset).not.toHaveBeenCalled();
  });
});
