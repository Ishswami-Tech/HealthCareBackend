/// <reference types="jest" />
/**
 * POST /ehr/medical-records: HealthRecord.patientId is a FK to Patient.id, but clients
 * send the patient's User.id or Patient.id. The service resolves the patient entity,
 * requires it to belong to the request clinic and attributes a real doctor.
 *
 * The patient table is a stateful fake that honours the lookup, so the tests fail if the
 * service stops resolving the id or drops the clinic condition.
 */

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
const OTHER_CLINIC = 'clinic-2';

interface PatientRow {
  id: string;
  userId: string;
  clinicIds: string[];
}

const PATIENTS: PatientRow[] = [
  { id: 'patient-1', userId: 'user-1', clinicIds: [CLINIC] },
  { id: 'patient-elsewhere', userId: 'user-elsewhere', clinicIds: [OTHER_CLINIC] },
];

interface LookupWhere {
  AND: Array<{
    OR?: Array<{ id?: string; userId?: string }>;
    // the clinic-membership condition ({} when no clinic is given)
    [key: string]: unknown;
  }>;
}

/** Evaluates the identifier + clinic-membership lookup the service sends. */
function lookup(where: LookupWhere): PatientRow | null {
  const [identity, clinic] = where.AND;
  const clinicOr = (clinic?.['OR'] ?? []) as Array<{
    user?: { primaryClinicId?: string };
    appointments?: { some: { clinicId: string } };
  }>;
  const clinicIds = clinicOr
    .map(condition => condition.user?.primaryClinicId ?? condition.appointments?.some.clinicId)
    .filter((id): id is string => typeof id === 'string');
  return (
    PATIENTS.find(
      row =>
        (identity?.OR ?? []).some(c => c.id === row.id || c.userId === row.userId) &&
        (clinicIds.length === 0 || clinicIds.some(id => row.clinicIds.includes(id)))
    ) ?? null
  );
}

function createHarness(
  options: { uploaderIsDoctor?: boolean; lastAppointmentDoctorId?: string | null } = {}
) {
  const client = {
    patient: {
      findFirst: jest.fn(async ({ where }: { where: LookupWhere }) => {
        const row = lookup(where);
        return row ? { id: row.id, userId: row.userId } : null;
      }),
    },
    doctor: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          options.uploaderIsDoctor === false ? null : { id: 'doctor-of-uploader' }
        ),
    },
    appointment: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          options.lastAppointmentDoctorId ? { doctorId: options.lastAppointmentDoctorId } : null
        ),
    },
    doctorClinic: { findFirst: jest.fn().mockResolvedValue(null) },
    healthRecord: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'record-new',
        createdAt: new Date('2026-03-01T00:00:00Z'),
        // NO updatedAt: the HealthRecord table does not have the column
        ...data,
      })),
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
    invalidateCacheByTag: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
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
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    {} as never,
    eventService,
    undefined
  );
  return { service, client, databaseService, cacheService, eventService };
}

const BASE_INPUT = {
  clinicId: CLINIC,
  type: 'GENERAL_DOCUMENT' as const,
  title: 'Discharge note',
  uploadedBy: 'staff-user',
};

function createdData(h: ReturnType<typeof createHarness>): Record<string, unknown> {
  const call = h.client.healthRecord.create.mock.calls[0]?.[0] as {
    data: Record<string, unknown>;
  };
  return call.data;
}

describe('EHRService.createMedicalRecord resolves the patient entity', () => {
  it('a User.id is resolved to the Patient.id and stored as patientId (the FK)', async () => {
    const h = createHarness();

    const record = await h.service.createMedicalRecord({
      ...BASE_INPUT,
      userId: 'user-1',
      doctorId: 'doctor-1',
    });

    expect(createdData(h)).toMatchObject({
      patientId: 'patient-1',
      clinicId: CLINIC,
      doctorId: 'doctor-1',
    });
    expect(record).toMatchObject({ id: 'record-new', userId: 'patient-1', clinicId: CLINIC });
  });

  it('a Patient.id is accepted as well and stored unchanged', async () => {
    const h = createHarness();

    await h.service.createMedicalRecord({
      ...BASE_INPUT,
      userId: 'patient-1',
      doctorId: 'doctor-1',
    });

    expect(createdData(h)).toMatchObject({ patientId: 'patient-1' });
  });

  it('looks the patient up by either id AND restricts it to the request clinic', async () => {
    const h = createHarness();

    await h.service.createMedicalRecord({ ...BASE_INPUT, userId: 'user-1', doctorId: 'doctor-1' });

    expect(h.client.patient.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { OR: [{ id: 'user-1' }, { userId: 'user-1' }] },
            {
              OR: [
                { user: { primaryClinicId: CLINIC } },
                { user: { clinics: { some: { id: CLINIC } } } },
                { user: { userRoles: { some: { clinicId: CLINIC, isActive: true } } } },
                { appointments: { some: { clinicId: CLINIC } } },
              ],
            },
          ],
        },
      })
    );
  });

  it('maps the created row although the table has no updatedAt (no 500 after the insert)', async () => {
    const h = createHarness();

    const record = await h.service.createMedicalRecord({
      ...BASE_INPUT,
      userId: 'user-1',
      doctorId: 'doctor-1',
    });

    expect(record.createdAt).toBe('2026-03-01T00:00:00.000Z');
    expect(record.updatedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('a patient of ANOTHER clinic is a 404 and nothing is inserted, audited or emitted', async () => {
    const h = createHarness();

    await expect(
      h.service.createMedicalRecord({
        ...BASE_INPUT,
        userId: 'user-elsewhere',
        doctorId: 'doctor-1',
      })
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      h.service.createMedicalRecord({
        ...BASE_INPUT,
        userId: 'patient-elsewhere',
        doctorId: 'doctor-1',
      })
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(h.client.healthRecord.create).not.toHaveBeenCalled();
    expect(h.databaseService.executeHealthcareWrite).not.toHaveBeenCalled();
    expect(h.eventService.emit).not.toHaveBeenCalled();
  });

  it('an unknown patient id is a 404 as well', async () => {
    const h = createHarness();

    await expect(
      h.service.createMedicalRecord({ ...BASE_INPUT, userId: 'nobody', doctorId: 'doctor-1' })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.client.healthRecord.create).not.toHaveBeenCalled();
  });

  it('invalidates the read caches under BOTH ids the client may use', async () => {
    const h = createHarness();

    await h.service.createMedicalRecord({ ...BASE_INPUT, userId: 'user-1', doctorId: 'doctor-1' });

    const tags = h.cacheService.invalidateCacheByTag.mock.calls.map(call => call[0] as string);
    expect(tags).toEqual(
      expect.arrayContaining(['ehr:user-1', 'user:user-1', 'ehr:patient-1', 'user:patient-1'])
    );
    expect(h.eventService.emit).toHaveBeenCalledWith('ehr.medical_record.created', {
      recordId: 'record-new',
      userId: 'user-1',
      type: 'GENERAL_DOCUMENT',
    });
  });
});

describe('EHRService.createMedicalRecord doctor attribution', () => {
  it('uses the uploader own doctor profile when no doctorId is sent (never a "system" doctor)', async () => {
    const h = createHarness();

    await h.service.createMedicalRecord({ ...BASE_INPUT, userId: 'user-1' });

    expect(h.client.doctor.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'staff-user' } })
    );
    expect(createdData(h)).toMatchObject({ doctorId: 'doctor-of-uploader' });
  });

  it('an explicit doctorId wins and no doctor lookup runs', async () => {
    const h = createHarness();

    await h.service.createMedicalRecord({ ...BASE_INPUT, userId: 'user-1', doctorId: 'doctor-9' });

    expect(h.client.doctor.findUnique).not.toHaveBeenCalled();
    expect(createdData(h)).toMatchObject({ doctorId: 'doctor-9' });
  });

  it('is a 400 (not an FK 500) when there is no doctorId and the uploader is no doctor', async () => {
    const h = createHarness({ uploaderIsDoctor: false });

    await expect(
      h.service.createMedicalRecord({ ...BASE_INPUT, userId: 'user-1' })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.client.healthRecord.create).not.toHaveBeenCalled();
  });
});

describe('EHRService.createMedicalRecord by a PATIENT (own chart only)', () => {
  const patientActor = { userId: 'user-1', role: 'PATIENT' } as const;
  const patientInput = {
    clinicId: CLINIC,
    type: 'LAB_TEST' as const,
    title: 'My CBC',
    uploadedBy: 'user-1',
    userId: 'user-1',
  };

  it('creates the record for themselves, attributed to the doctor of their last visit', async () => {
    const h = createHarness({ uploaderIsDoctor: false, lastAppointmentDoctorId: 'doctor-last' });

    const record = await h.service.createMedicalRecord(patientInput, patientActor);

    expect(createdData(h)).toMatchObject({
      patientId: 'patient-1',
      doctorId: 'doctor-last',
      uploadedBy: 'user-1',
      recordType: 'LAB_TEST',
    });
    expect(record).toMatchObject({ id: 'record-new' });
  });

  it('ignores a doctorId the patient names (the doctor is resolved server-side)', async () => {
    const h = createHarness({ uploaderIsDoctor: false, lastAppointmentDoctorId: 'doctor-last' });

    await h.service.createMedicalRecord(
      { ...patientInput, doctorId: 'doctor-chosen' },
      patientActor
    );

    expect(createdData(h)).toMatchObject({ doctorId: 'doctor-last' });
  });

  it('is a 403 for another patient chart, even one of the same clinic', async () => {
    const h = createHarness({ uploaderIsDoctor: false, lastAppointmentDoctorId: 'doctor-last' });

    await expect(
      h.service.createMedicalRecord(
        { ...patientInput, userId: 'patient-1' },
        { userId: 'someone-else', role: 'PATIENT' }
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.client.healthRecord.create).not.toHaveBeenCalled();
  });

  it('is a 404 for a patient of another clinic (no oracle)', async () => {
    const h = createHarness({ uploaderIsDoctor: false, lastAppointmentDoctorId: 'doctor-last' });

    await expect(
      h.service.createMedicalRecord(
        { ...patientInput, userId: 'user-elsewhere' },
        { userId: 'user-elsewhere', role: 'PATIENT' }
      )
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each(['XRAY', 'MRI', 'PRESCRIPTION', 'DIAGNOSIS_REPORT', 'PULSE_DIAGNOSIS'] as const)(
    'refuses the clinical type %s (403)',
    async type => {
      const h = createHarness({ uploaderIsDoctor: false, lastAppointmentDoctorId: 'doctor-last' });

      await expect(
        h.service.createMedicalRecord({ ...patientInput, type }, patientActor)
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(h.client.healthRecord.create).not.toHaveBeenCalled();
    }
  );

  it('is a 400 (not an FK 500) when no doctor is linked to the patient or the clinic', async () => {
    const h = createHarness({ uploaderIsDoctor: false, lastAppointmentDoctorId: null });

    await expect(h.service.createMedicalRecord(patientInput, patientActor)).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(h.client.healthRecord.create).not.toHaveBeenCalled();
  });

  it('staff behaviour is unchanged when no patient actor is given', async () => {
    const h = createHarness();

    await h.service.createMedicalRecord({ ...BASE_INPUT, userId: 'user-1', doctorId: 'doctor-9' });

    expect(createdData(h)).toMatchObject({ doctorId: 'doctor-9' });
  });
});
