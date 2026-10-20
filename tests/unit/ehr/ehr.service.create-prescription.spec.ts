/// <reference types="jest" />
/**
 * POST /ehr/prescriptions: a note-only prescription (diagnosis / advice, no medications) must
 * still create the Prescription row, because GET /ehr/comprehensive `prescriptions` (the
 * Prescriptions tab on web and mobile, readable by the patient) lists Prescription rows, not
 * HealthRecords. With nothing to dispense it is FILLED on creation so it never waits in the
 * pharmacy queue; a prescription with medications stays PENDING with its items.
 */

import { BadRequestException } from '@nestjs/common';
import { EHRService, hasTreatmentPlanContent } from '@services/ehr/ehr.service';

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
const PATIENT = { id: 'patient-1', userId: 'user-1' };

type Row = Record<string, unknown>;

function createHarness(patient: typeof PATIENT | null = PATIENT) {
  const client = {
    patient: { findFirst: jest.fn().mockResolvedValue(patient) },
    prescription: {
      create: jest.fn(async ({ data }: { data: Row }) => ({ id: 'rx-new', ...data })),
    },
    prescriptionItem: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
    healthRecord: {
      create: jest.fn(async ({ data }: { data: Row }) => ({ id: 'record-new', ...data })),
    },
    userRole: { findMany: jest.fn().mockResolvedValue([{ clinicId: CLINIC }]) },
    doctor: {
      findUnique: jest.fn().mockResolvedValue({ id: 'doctor-of-caller' }),
      count: jest.fn().mockResolvedValue(1),
    },
    doctorClinic: { count: jest.fn().mockResolvedValue(1) },
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
  const prescriptionData = (): Row =>
    (client.prescription.create.mock.calls[0]?.[0] as { data: Row }).data;
  return { service, client, cacheService, eventService, prescriptionData };
}

const NOTE_ONLY = {
  userId: 'user-1',
  clinicId: CLINIC,
  doctorId: 'doctor-1',
  diagnosis: ' Vata imbalance ',
  notes: 'Warm water, early dinner, follow up in two weeks',
};

describe('EHRService.createPrescription', () => {
  it('creates a FILLED, item-less Prescription row for a note-only prescription', async () => {
    const h = createHarness();

    await h.service.createPrescription(NOTE_ONLY);

    expect(h.prescriptionData()).toMatchObject({
      patientId: 'patient-1',
      doctorId: 'doctor-1',
      clinicId: CLINIC,
      status: 'FILLED',
      diagnosis: 'Vata imbalance',
      notes: NOTE_ONLY.notes,
    });
    expect(h.client.prescriptionItem.createMany).not.toHaveBeenCalled();
    // The EHR note is still written next to it.
    expect(h.client.healthRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ patientId: 'patient-1', recordType: 'PRESCRIPTION' }),
      })
    );
    expect(h.eventService.emit).toHaveBeenCalledWith(
      'ehr.prescription.created',
      expect.objectContaining({ prescriptionId: 'rx-new', medicationsCount: 0 })
    );
    // The patient's cached history (comprehensive record) is dropped.
    expect(h.cacheService.invalidateCacheByTag).toHaveBeenCalledWith('ehr:user-1');
    expect(h.cacheService.invalidateCacheByTag).toHaveBeenCalledWith('user:user-1');
  });

  it('keeps a prescription with medications PENDING and writes its items', async () => {
    const h = createHarness();

    await h.service.createPrescription({
      ...NOTE_ONLY,
      medications: [
        { name: 'Triphala', dosage: '1 tsp', frequency: 'HS', startDate: '2026-10-17' },
        { name: 'Ashwagandha', dosage: '500mg', frequency: 'BD', startDate: '2026-10-17' },
      ],
    });

    expect(h.prescriptionData()).toMatchObject({ status: 'PENDING', diagnosis: 'Vata imbalance' });
    const items = (h.client.prescriptionItem.createMany.mock.calls[0]?.[0] as { data: Row[] }).data;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ prescriptionId: 'rx-new', clinicId: CLINIC, dosage: '1 tsp' });
    expect(h.eventService.emit).toHaveBeenCalledWith(
      'ehr.prescription.created',
      expect.objectContaining({ prescriptionId: 'rx-new', medicationsCount: 2 })
    );
  });

  it('rejects a prescription with neither medications nor a diagnosis / notes before writing', async () => {
    const h = createHarness();

    await expect(
      h.service.createPrescription({ userId: 'user-1', clinicId: CLINIC, notes: '   ' })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.client.prescription.create).not.toHaveBeenCalled();
    expect(h.client.healthRecord.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown patient without writing anything', async () => {
    const h = createHarness(null);

    await expect(h.service.createPrescription(NOTE_ONLY)).rejects.toBeInstanceOf(
      BadRequestException
    );
    expect(h.client.prescription.create).not.toHaveBeenCalled();
  });

  it('a treatment plan alone still writes the EHR record (no Prescription row, no 400)', async () => {
    const h = createHarness();

    await h.service.createPrescription({
      userId: 'user-1',
      clinicId: CLINIC,
      doctorId: 'doctor-1',
      notes: '',
      treatmentPlan: { requirements: [{ label: 'Abhyanga', sessions: 7 }] } as never,
    });

    expect(h.client.prescription.create).not.toHaveBeenCalled();
    const record = (h.client.healthRecord.create.mock.calls[0]?.[0] as { data: Row }).data;
    expect(record).toMatchObject({ patientId: 'patient-1', doctorId: 'doctor-1' });
    expect(JSON.parse(String(record['report']))).toMatchObject({
      treatmentPlan: { requirements: [{ label: 'Abhyanga', sessions: 7 }] },
    });
    expect(hasTreatmentPlanContent({ diagnosis: '  ', recommendations: [] } as never)).toBe(false);
    expect(hasTreatmentPlanContent(undefined)).toBe(false);
  });

  it('a DOCTOR prescribes as themselves: the body doctorId is ignored', async () => {
    const h = createHarness();

    await h.service.createPrescription(
      { ...NOTE_ONLY, doctorId: 'doctor-someone-else' },
      { userId: 'doc-user', role: 'DOCTOR' }
    );

    expect(h.client.doctor.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'doc-user' } })
    );
    expect(h.prescriptionData()).toMatchObject({ doctorId: 'doctor-of-caller' });
    const record = (h.client.healthRecord.create.mock.calls[0]?.[0] as { data: Row }).data;
    expect(record['doctorId']).toBe('doctor-of-caller');
  });

  it('a DOCTOR or ASSISTANT_DOCTOR without a doctor profile gets 400, nothing is written', async () => {
    for (const role of ['DOCTOR', 'ASSISTANT_DOCTOR']) {
      const h = createHarness();
      h.client.doctor.findUnique.mockResolvedValue(null);
      h.client.doctorClinic.count.mockResolvedValue(0);

      await expect(
        h.service.createPrescription(NOTE_ONLY, { userId: 'doc-user', role })
      ).rejects.toThrow('has no doctor profile');
      expect(h.client.prescription.create).not.toHaveBeenCalled();
      expect(h.client.healthRecord.create).not.toHaveBeenCalled();
    }
  });

  it('an admin must name the doctor explicitly and never falls back to a "system" doctor', async () => {
    const h = createHarness();

    await expect(
      h.service.createPrescription(
        { ...NOTE_ONLY, doctorId: undefined },
        { userId: 'admin-user', role: 'CLINIC_ADMIN' }
      )
    ).rejects.toThrow('doctorId is required');
    expect(h.client.prescription.create).not.toHaveBeenCalled();

    await h.service.createPrescription(NOTE_ONLY, { userId: 'admin-user', role: 'CLINIC_ADMIN' });
    expect(h.client.doctor.findUnique).not.toHaveBeenCalled();
    expect(h.prescriptionData()).toMatchObject({ doctorId: 'doctor-1' });
  });

  it('a covering ASSISTANT_DOCTOR keeps the treating doctor when they practise in the clinic', async () => {
    const h = createHarness();
    h.client.doctor.findUnique.mockResolvedValue(null);

    await h.service.createPrescription(NOTE_ONLY, {
      userId: 'assistant-user',
      role: 'ASSISTANT_DOCTOR',
    });

    expect(h.client.doctorClinic.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: { doctorId: 'doctor-1', clinicId: CLINIC } })
    );
    expect(h.prescriptionData()).toMatchObject({ doctorId: 'doctor-1' });
  });

  it('an admin cannot attach a doctor from another clinic', async () => {
    const h = createHarness();
    h.client.doctorClinic.count.mockResolvedValue(0);

    await expect(
      h.service.createPrescription(NOTE_ONLY, { userId: 'admin-user', role: 'CLINIC_ADMIN' })
    ).rejects.toThrow('does not practise in this clinic');
    expect(h.client.prescription.create).not.toHaveBeenCalled();
  });

  it('drops the caches of the resolved patient user even when a Patient.id was posted', async () => {
    const h = createHarness();

    await h.service.createPrescription({ ...NOTE_ONLY, userId: 'patient-1' });

    expect(h.cacheService.invalidateCacheByTag).toHaveBeenCalledWith('ehr:user-1');
    expect(h.cacheService.invalidateCacheByTag).toHaveBeenCalledWith('user:user-1');
    expect(h.cacheService.invalidateCacheByTag).not.toHaveBeenCalledWith('ehr:patient-1');
    expect(h.cacheService.invalidateCacheByTag).toHaveBeenCalledWith(`clinic:${CLINIC}`);
  });
});
