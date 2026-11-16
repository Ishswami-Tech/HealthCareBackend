/// <reference types="jest" />
/**
 * Appointment notifications took their recipient from the event's userId first, which is whoever
 * acted. On 2026-11-16 a cron expired a booking with userId 'system': "Patient notification
 * recipient could not be resolved" and the patient was never told. A doctor confirming or
 * completing a visit made the doctor the "patient". The appointment row now decides, as the
 * patient's USER id: the socket channel addresses `user:<id>` rooms directly.
 */

import {
  AppointmentNotificationService,
  appointmentPatientUserId,
} from '@services/appointments/plugins/notifications/appointment-notification.service';
import type { NotificationData } from '@core/types';

type Deps = ConstructorParameters<typeof AppointmentNotificationService>;

type Row = { id: string; patientId: string; patient?: { userId?: string; user?: { id: string } } };

const row = (patient?: Row['patient']): Row => ({
  id: 'appt-1',
  patientId: 'patient-42',
  ...(patient && { patient }),
});

function serviceWithAppointment(
  appointment: Row | null,
  fail = false
): AppointmentNotificationService {
  const databaseService = {
    findAppointmentByIdSafe: jest.fn(async () => {
      if (fail) throw new Error('db down');
      return appointment;
    }),
  };
  const loggingService = { log: jest.fn(async () => undefined) };
  return new AppointmentNotificationService(
    {} as unknown as Deps[0],
    loggingService as unknown as Deps[1],
    {} as unknown as Deps[2],
    {} as unknown as Deps[3],
    {} as unknown as Deps[4],
    {} as unknown as Deps[5],
    {} as unknown as Deps[6],
    {} as unknown as Deps[7],
    databaseService as unknown as Deps[8],
    {} as unknown as Deps[9]
  );
}

function withFacts(service: AppointmentNotificationService, data: NotificationData) {
  return (
    service as unknown as {
      withAppointmentFacts(d: NotificationData): Promise<NotificationData>;
    }
  ).withAppointmentFacts(data);
}

const event = (patientId: string): NotificationData =>
  ({
    appointmentId: 'appt-1',
    patientId,
    doctorId: 'doctor-1',
    clinicId: 'clinic-1',
    type: 'expired',
    templateData: { patientName: 'Patient', doctorName: 'Doctor' },
  }) as unknown as NotificationData;

describe('appointment notification recipient', () => {
  it("notifies the patient's user when a cron acted as 'system'", async () => {
    const service = serviceWithAppointment(row({ userId: 'patient-user-42' }));

    await expect(withFacts(service, event('system'))).resolves.toEqual(
      expect.objectContaining({ patientId: 'patient-user-42' })
    );
  });

  it("notifies the patient's user, not the doctor who confirmed the visit", async () => {
    const service = serviceWithAppointment(row({ user: { id: 'patient-user-42' } }));

    await expect(withFacts(service, event('doctor-user-7'))).resolves.toEqual(
      expect.objectContaining({ patientId: 'patient-user-42' })
    );
  });

  it('never swaps in the Patient.id, which no socket room is named after', async () => {
    const service = serviceWithAppointment(row());

    await expect(withFacts(service, event('patient-user-1'))).resolves.toEqual(
      expect.objectContaining({ patientId: 'patient-user-1' })
    );
  });

  it("keeps the producer's patientId when the appointment cannot be read", async () => {
    const missing = serviceWithAppointment(null);
    const failing = serviceWithAppointment(null, true);

    await expect(withFacts(missing, event('patient-1'))).resolves.toEqual(
      expect.objectContaining({ patientId: 'patient-1' })
    );
    await expect(withFacts(failing, event('patient-1'))).resolves.toEqual(
      expect.objectContaining({ patientId: 'patient-1' })
    );
  });

  it("reads the patient's user id from the row, or nothing", () => {
    type Arg = Parameters<typeof appointmentPatientUserId>[0];
    expect(appointmentPatientUserId({ patient: { userId: 'u-1' } } as Arg)).toBe('u-1');
    expect(appointmentPatientUserId({ patient: { user: { id: 'u-2' } } } as Arg)).toBe('u-2');
    expect(appointmentPatientUserId({ patient: { userId: '  ' } } as Arg)).toBeUndefined();
    expect(appointmentPatientUserId({ patient: null } as Arg)).toBeUndefined();
    expect(appointmentPatientUserId(null)).toBeUndefined();
  });
});
