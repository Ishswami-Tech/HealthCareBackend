/// <reference types="jest" />
/**
 * One OPD visit per appointment: asking again returns the same visit, a draft is created when the
 * consultation starts (no consultation invoice), and a mismatching clinic/patient is refused.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PatientVisitsService } from '../../../src/services/patient-visits/patient-visits.service';
import { PatientVisitEventsListener } from '../../../src/services/patient-visits/patient-visit-events.listener';

type Fn = jest.Mock;

function visitRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'visit-1',
    opdNumber: 'OPD-001',
    registrationDate: new Date('2026-10-09T10:00:00Z'),
    patientId: 'patient-1',
    clinicId: 'clinic-1',
    doctorId: 'doctor-1',
    appointmentId: 'apt-1',
    specialCaseFlags: [],
    createdAt: new Date('2026-10-09T10:00:00Z'),
    updatedAt: new Date('2026-10-09T10:00:00Z'),
    ...overrides,
  };
}

function build(options: { appointment?: Record<string, unknown> | null; existing?: unknown } = {}) {
  const appointment =
    options.appointment === undefined
      ? { id: 'apt-1', clinicId: 'clinic-1', patientId: 'patient-1', doctorId: 'doctor-1' }
      : options.appointment;
  const tx = {
    appointment: { findUnique: jest.fn().mockResolvedValue(appointment) as Fn },
    patient: {
      findUnique: jest.fn().mockResolvedValue({ id: 'patient-1' }) as Fn,
      findFirst: jest.fn() as Fn,
    },
    clinic: { findUnique: jest.fn().mockResolvedValue({ clinicId: 'CL1' }) as Fn },
    doctor: { findUnique: jest.fn() as Fn },
    patientVisit: {
      findFirst: jest.fn().mockResolvedValue(options.existing ?? null) as Fn,
      create: jest.fn().mockResolvedValue(visitRow()) as Fn,
    },
    $queryRaw: jest.fn().mockResolvedValue([{ lastValue: 1 }]) as Fn,
  };
  const db = {
    executeHealthcareRead: jest.fn((fn: (c: unknown) => unknown) => fn(tx)),
    executeHealthcareWrite: jest.fn((fn: (c: unknown) => unknown) => fn(tx)),
  };
  const logging = { log: jest.fn().mockResolvedValue(undefined) };
  const events = { emit: jest.fn().mockResolvedValue(undefined) };
  const moduleRef = { get: jest.fn().mockReturnValue(null) };
  const service = new PatientVisitsService(
    db as never,
    logging as never,
    events as never,
    {} as never,
    {} as never,
    moduleRef as never
  );
  return { service, tx, logging };
}

describe('PatientVisitsService appointment link', () => {
  it('returns the existing visit instead of creating a second one', async () => {
    const { service, tx } = build({ existing: visitRow() });

    const result = await service.createVisit({ appointmentId: 'apt-1' }, 'clinic-1', {});

    expect(result.id).toBe('visit-1');
    expect(result.appointmentId).toBe('apt-1');
    expect(tx.patientVisit.create).not.toHaveBeenCalled();
  });

  it('creates the visit for the appointment patient and doctor, linked to the appointment', async () => {
    const { service, tx } = build();

    await service.createVisit(
      { appointmentId: 'apt-1', skipConsultationInvoice: true },
      'clinic-1',
      {
        userId: 'user-1',
        role: 'DOCTOR',
      }
    );

    expect(tx.patientVisit.create).toHaveBeenCalledTimes(1);
    const data = (tx.patientVisit.create.mock.calls[0]?.[0] as { data: Record<string, unknown> })
      .data;
    expect(data).toMatchObject({
      patientId: 'patient-1',
      doctorId: 'doctor-1',
      clinicId: 'clinic-1',
      appointmentId: 'apt-1',
    });
  });

  it('refuses an appointment of another clinic', async () => {
    const { service } = build({
      appointment: { id: 'apt-1', clinicId: 'other', patientId: 'patient-1', doctorId: 'doctor-1' },
    });
    await expect(
      service.createVisit({ appointmentId: 'apt-1' }, 'clinic-1', {})
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a patient that is not the appointment patient', async () => {
    const { service } = build();
    await expect(
      service.createVisit({ appointmentId: 'apt-1', patientId: 'someone-else' }, 'clinic-1', {})
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns the winner when a concurrent request already created the visit', async () => {
    const { service, tx } = build();
    tx.patientVisit.findFirst.mockResolvedValueOnce(null).mockResolvedValue(visitRow());
    tx.patientVisit.create.mockRejectedValue(new Error('Unique constraint failed'));

    const result = await service.createVisit({ appointmentId: 'apt-1' }, 'clinic-1', {});

    expect(result.id).toBe('visit-1');
  });
});

describe('PatientVisitEventsListener', () => {
  function listener() {
    const visits = { ensureDraftVisitForAppointment: jest.fn().mockResolvedValue({}) as Fn };
    const logging = { log: jest.fn().mockResolvedValue(undefined) };
    return {
      visits,
      logging,
      instance: new PatientVisitEventsListener(visits as never, logging as never),
    };
  }

  it('creates a draft visit when an in-person consultation starts', async () => {
    const { instance, visits } = listener();
    await instance.onConsultationStarted({
      clinicId: 'clinic-1',
      payload: { appointmentId: 'apt-1' },
    });
    expect(visits.ensureDraftVisitForAppointment).toHaveBeenCalledWith(
      'apt-1',
      'clinic-1',
      expect.objectContaining({ role: 'system' })
    );
  });

  it('creates a draft visit only when the doctor starts a video consultation', async () => {
    const { instance, visits } = listener();
    await instance.onVideoConsultationStarted({
      clinicId: 'clinic-1',
      payload: { appointmentId: 'apt-1', userRole: 'patient' },
    });
    expect(visits.ensureDraftVisitForAppointment).not.toHaveBeenCalled();

    await instance.onVideoConsultationStarted({
      clinicId: 'clinic-1',
      payload: { appointmentId: 'apt-1', userRole: 'doctor' },
    });
    expect(visits.ensureDraftVisitForAppointment).toHaveBeenCalledTimes(1);
  });

  it('never throws when the draft cannot be created', async () => {
    const { instance, visits, logging } = listener();
    visits.ensureDraftVisitForAppointment.mockRejectedValue(new Error('db down'));
    await expect(
      instance.onConsultationStarted({ clinicId: 'clinic-1', payload: { appointmentId: 'apt-1' } })
    ).resolves.toBeUndefined();
    expect(logging.log).toHaveBeenCalled();
  });

  it('ignores an event without an appointment or clinic', async () => {
    const { instance, visits } = listener();
    await instance.onConsultationStarted({ payload: {} });
    expect(visits.ensureDraftVisitForAppointment).not.toHaveBeenCalled();
  });
});
