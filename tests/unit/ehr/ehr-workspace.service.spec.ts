/// <reference types="jest" />
/**
 * EHR workspace: single patient, the patient's appointments and the care plan.
 *
 * Patient resolution is delegated to EHRService.resolvePatient(identifier, clinicId),
 * which is clinic-scoped; the fake returns null for other clinics' patients, so the
 * tests fail if the service stops going through it (cross-tenant leak) or queries
 * appointments / care plans without the clinic.
 */

import { NotFoundException } from '@nestjs/common';
import { EHRWorkspaceService } from '@services/ehr/ehr-workspace.service';

jest.mock('@infrastructure/database', () => ({ DatabaseService: class DatabaseService {} }));
jest.mock('@infrastructure/storage/static-asset.service', () => ({
  StaticAssetService: class StaticAssetService {},
}));
jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));
jest.mock('@services/ehr/ehr.service', () => ({ EHRService: class EHRService {} }));

const CLINIC = 'clinic-1';
const ACTOR = { userId: 'doctor-user-1', role: 'DOCTOR' };

interface CarePlanFake {
  id: string;
  clinicId: string;
  patientId: string;
  title: string;
  status: string;
  summary: string | null;
  goals: unknown;
  interventions: unknown;
  dietNotes: string | null;
  lifestyleNotes: string | null;
  nextReviewDate: Date | null;
  createdById: string;
  updatedById: string;
  createdAt: Date;
  updatedAt: Date;
}

function createHarness() {
  const plans = new Map<string, CarePlanFake>();
  const planKey = (clinicId: string, patientId: string): string => `${clinicId}|${patientId}`;
  const client = {
    patient: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'patient-1',
        userId: 'user-1',
        prakriti: 'VATA',
        dosha: null,
        registeredByDoctorId: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        user: {
          name: 'Asha Rao',
          firstName: 'Asha',
          lastName: 'Rao',
          email: 'asha@example.com',
          phone: '+911234567890',
          gender: 'FEMALE',
          age: 34,
          dateOfBirth: new Date('1992-02-02T00:00:00Z'),
          bloodGroup: 'O+',
          maritalStatus: 'MARRIED',
          occupation: 'Teacher',
          address: 'Kothrud',
          city: 'Pune',
          state: 'MH',
          profilePicture: 'https://cdn.example.com/documents/avatar-user-1-1.jpg',
          emergencyContacts: [{ name: 'Ravi', relationship: 'Spouse', phone: '+910000000000' }],
        },
      }),
    },
    patientVisit: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'visit-1', opdNumber: 'OPD-001', appointmentId: 'apt-1' }]),
    },
    appointment: {
      count: jest.fn().mockResolvedValue(45),
      findFirst: jest.fn().mockResolvedValue({ date: new Date('2026-03-01T00:00:00Z') }),
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'apt-1',
          type: 'IN_PERSON',
          status: 'COMPLETED',
          date: new Date('2026-03-01T00:00:00Z'),
          time: '10:00',
          doctor: { id: 'doc-1', specialization: 'Ayurveda', user: { name: 'Dr Mehta' } },
        },
      ]),
    },
    allergy: { findMany: jest.fn().mockResolvedValue([{ allergen: 'Peanuts' }]) },
    medication: { count: jest.fn().mockResolvedValue(2) },
    carePlan: {
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: { clinicId_patientId: { clinicId: string; patientId: string } };
        }) => {
          const key = where.clinicId_patientId;
          return plans.get(planKey(key.clinicId, key.patientId)) ?? null;
        }
      ),
      upsert: jest.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { clinicId_patientId: { clinicId: string; patientId: string } };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const key = planKey(
            where.clinicId_patientId.clinicId,
            where.clinicId_patientId.patientId
          );
          const existing = plans.get(key);
          const row: CarePlanFake = existing
            ? { ...existing, ...update, updatedAt: new Date('2026-04-02T00:00:00Z') }
            : ({
                id: 'plan-1',
                title: 'Care plan',
                status: 'ACTIVE',
                summary: null,
                goals: [],
                interventions: [],
                dietNotes: null,
                lifestyleNotes: null,
                nextReviewDate: null,
                createdAt: new Date('2026-04-01T00:00:00Z'),
                updatedAt: new Date('2026-04-01T00:00:00Z'),
                ...create,
              } as CarePlanFake);
          plans.set(key, row);
          return row;
        }
      ),
    },
  };
  const databaseService = {
    executeHealthcareRead: jest.fn(async (op: (c: unknown) => Promise<unknown>) => op(client)),
    executeHealthcareWrite: jest.fn(async (op: (c: unknown) => Promise<unknown>) => op(client)),
  };
  const ehrService = {
    resolvePatient: jest.fn(async (identifier: string, clinicId?: string) =>
      (identifier === 'patient-1' || identifier === 'user-1') && clinicId === CLINIC
        ? { id: 'patient-1', userId: 'user-1' }
        : null
    ),
  };
  const staticAsset = {
    resolveSignedUrl: jest.fn(async (url: string) => `${url}?signed=1`),
  };
  const logging = { log: jest.fn().mockResolvedValue(undefined) };
  const service = new EHRWorkspaceService(
    databaseService as never,
    logging as never,
    staticAsset as never,
    ehrService as never
  );
  return { service, client, ehrService, staticAsset, databaseService, plans };
}

describe('EHRWorkspaceService.getWorkspacePatient', () => {
  it('returns the patient card with emergency contact, signed photo and summary counts', async () => {
    const h = createHarness();

    const result = await h.service.getWorkspacePatient('user-1', CLINIC, ACTOR);

    expect(h.ehrService.resolvePatient).toHaveBeenCalledWith('user-1', CLINIC);
    expect(result).toMatchObject({
      id: 'patient-1',
      userId: 'user-1',
      name: 'Asha Rao',
      bloodGroup: 'O+',
      maritalStatus: 'MARRIED',
      occupation: 'Teacher',
      emergencyContact: { name: 'Ravi', relationship: 'Spouse', phone: '+910000000000' },
      profilePicture: 'https://cdn.example.com/documents/avatar-user-1-1.jpg?signed=1',
      summary: {
        appointmentCount: 45,
        lastVisitDate: '2026-03-01T00:00:00.000Z',
        allergies: ['Peanuts'],
        activeMedications: 2,
      },
    });
    expect(h.staticAsset.resolveSignedUrl).toHaveBeenCalledWith(
      'https://cdn.example.com/documents/avatar-user-1-1.jpg',
      undefined,
      { boundTo: ['user-1'] }
    );
  });

  it('never returns credentials (the patient select does not ask for them)', async () => {
    const h = createHarness();

    const result = await h.service.getWorkspacePatient('patient-1', CLINIC, ACTOR);

    expect(JSON.stringify(result)).not.toMatch(/password/i);
    const select = (h.client.patient.findUnique.mock.calls[0]?.[0] as { select: object }).select;
    expect(JSON.stringify(select)).not.toMatch(/password/i);
  });

  it('is a 404 for a patient of another clinic and runs no data query', async () => {
    const h = createHarness();

    await expect(
      h.service.getWorkspacePatient('patient-1', 'clinic-2', ACTOR)
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.client.patient.findUnique).not.toHaveBeenCalled();
    expect(h.client.appointment.count).not.toHaveBeenCalled();
  });

  it('scopes the summary queries to the clinic', async () => {
    const h = createHarness();

    await h.service.getWorkspacePatient('patient-1', CLINIC, ACTOR);

    expect(h.client.appointment.count).toHaveBeenCalledWith({
      where: { patientId: 'patient-1', clinicId: CLINIC },
    });
    expect(h.client.medication.count).toHaveBeenCalledWith({
      where: { userId: 'user-1', clinicId: CLINIC, isActive: true },
    });
  });
});

describe('EHRWorkspaceService.listPatientAppointments', () => {
  it('paginates the clinic appointments of the patient, newest first', async () => {
    const h = createHarness();

    const result = await h.service.listPatientAppointments('patient-1', CLINIC, ACTOR, {
      page: 2,
      limit: 10,
    });

    const args = h.client.appointment.findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      skip: number;
      take: number;
      orderBy: unknown;
    };
    expect(args.where).toEqual({ patientId: 'patient-1', clinicId: CLINIC });
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
    expect(args.orderBy).toEqual([{ date: 'desc' }, { time: 'desc' }, { id: 'asc' }]);
    expect(result.meta).toMatchObject({ page: 2, limit: 10, total: 45, totalPages: 5 });
    expect(result.data[0]).toMatchObject({
      id: 'apt-1',
      doctor: { id: 'doc-1', name: 'Dr Mehta', specialization: 'Ayurveda' },
    });
  });

  it('attaches the OPD visit of each appointment, or null when there is none', async () => {
    const h = createHarness();

    const result = await h.service.listPatientAppointments('patient-1', CLINIC, ACTOR, {});

    expect(result.data[0]).toMatchObject({
      id: 'apt-1',
      visit: { id: 'visit-1', opdNumber: 'OPD-001' },
    });
    expect(h.client.patientVisit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { clinicId: CLINIC, appointmentId: { in: ['apt-1'] } } })
    );

    h.client.patientVisit.findMany.mockResolvedValueOnce([]);
    const without = await h.service.listPatientAppointments('patient-1', CLINIC, ACTOR, {});
    expect(without.data[0]).toMatchObject({ visit: null });
  });

  it('defaults to page 1 / 20 and filters by an upper-cased status', async () => {
    const h = createHarness();

    await h.service.listPatientAppointments('patient-1', CLINIC, ACTOR, { status: 'completed' });

    const args = h.client.appointment.findMany.mock.calls[0]?.[0] as {
      where: Record<string, unknown>;
      skip: number;
      take: number;
    };
    expect(args.where).toEqual({ patientId: 'patient-1', clinicId: CLINIC, status: 'COMPLETED' });
    expect(args.skip).toBe(0);
    expect(args.take).toBe(20);
  });

  it('is a 404 for another clinic patient', async () => {
    const h = createHarness();

    await expect(
      h.service.listPatientAppointments('patient-1', 'clinic-2', ACTOR, {})
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.client.appointment.findMany).not.toHaveBeenCalled();
  });
});

describe('EHRWorkspaceService care plan', () => {
  it('returns an empty skeleton (exists: false) when the patient has no plan yet', async () => {
    const h = createHarness();

    const plan = await h.service.getCarePlan('patient-1', CLINIC, ACTOR);

    expect(plan).toMatchObject({
      exists: false,
      id: null,
      patientId: 'patient-1',
      clinicId: CLINIC,
      status: 'ACTIVE',
      goals: [],
      interventions: [],
    });
  });

  it('creates the plan and a second PUT only changes the supplied fields', async () => {
    const h = createHarness();

    const created = await h.service.upsertCarePlan(
      'user-1',
      CLINIC,
      {
        title: ' Back pain plan ',
        summary: 'Reduce pain',
        goals: [{ text: 'Walk 20 min', done: true }, { text: 'Sleep by 10pm' }],
        nextReviewDate: '2026-06-01',
      },
      ACTOR
    );

    expect(created).toMatchObject({
      exists: true,
      patientId: 'patient-1',
      title: 'Back pain plan',
      summary: 'Reduce pain',
      goals: [
        { text: 'Walk 20 min', done: true },
        { text: 'Sleep by 10pm', done: false },
      ],
      updatedById: ACTOR.userId,
    });
    expect(created.nextReviewDate).toBe('2026-06-01T00:00:00.000Z');

    const updated = await h.service.upsertCarePlan(
      'patient-1',
      CLINIC,
      { status: 'COMPLETED' },
      { userId: 'doctor-user-2', role: 'DOCTOR' }
    );

    expect(updated).toMatchObject({
      status: 'COMPLETED',
      title: 'Back pain plan',
      summary: 'Reduce pain',
      updatedById: 'doctor-user-2',
    });
    expect(updated.goals).toHaveLength(2);
    // the creator stays the first author
    expect(h.plans.get(`${CLINIC}|patient-1`)?.createdById).toBe(ACTOR.userId);
  });

  it('writes with an audit entry carrying the clinic and the changed fields', async () => {
    const h = createHarness();

    await h.service.upsertCarePlan('patient-1', CLINIC, { dietNotes: 'Less salt' }, ACTOR);

    expect(h.databaseService.executeHealthcareWrite).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        userId: ACTOR.userId,
        clinicId: CLINIC,
        resourceType: 'CARE_PLAN',
        operation: 'UPSERT',
        details: expect.objectContaining({ updateFields: ['dietNotes'] }),
      })
    );
  });

  it('a patient of another clinic is a 404 for read and write, nothing is stored', async () => {
    const h = createHarness();

    await expect(h.service.getCarePlan('patient-1', 'clinic-2', ACTOR)).rejects.toBeInstanceOf(
      NotFoundException
    );
    await expect(
      h.service.upsertCarePlan('patient-1', 'clinic-2', { summary: 'x' }, ACTOR)
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(h.client.carePlan.upsert).not.toHaveBeenCalled();
    expect(h.plans.size).toBe(0);
  });

  it('keys the plan by (clinic, patient): another clinic never sees this plan', async () => {
    const h = createHarness();
    await h.service.upsertCarePlan('patient-1', CLINIC, { summary: 'private' }, ACTOR);

    await h.service.getCarePlan('patient-1', CLINIC, ACTOR);

    expect(h.client.carePlan.findUnique).toHaveBeenCalledWith({
      where: { clinicId_patientId: { clinicId: CLINIC, patientId: 'patient-1' } },
    });
  });
});
