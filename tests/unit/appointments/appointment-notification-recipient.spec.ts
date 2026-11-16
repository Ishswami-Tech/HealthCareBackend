/// <reference types="jest" />
/**
 * Appointment notifications took their recipient from the event's userId first, which is whoever
 * acted. On 2026-11-16 a cron expired a booking with userId 'system': "Patient notification
 * recipient could not be resolved" and the patient was never told. A doctor confirming or
 * completing a visit made the doctor the "patient". The appointment row now decides.
 */

import {
  AppointmentNotificationService,
  appointmentPatientId,
} from '@services/appointments/plugins/notifications/appointment-notification.service';
import type { NotificationData } from '@core/types';

type Deps = ConstructorParameters<typeof AppointmentNotificationService>;

function serviceWithAppointment(row: unknown, fail = false): AppointmentNotificationService {
  const databaseService = {
    findAppointmentByIdSafe: jest.fn(async () => {
      if (fail) throw new Error('db down');
      return row;
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
  it('notifies the appointment patient when a cron acted as "system"', async () => {
    const service = serviceWithAppointment({ id: 'appt-1', patientId: 'patient-42' });

    await expect(withFacts(service, event('system'))).resolves.toEqual(
      expect.objectContaining({ patientId: 'patient-42' })
    );
  });

  it('notifies the patient, not the doctor who confirmed the visit', async () => {
    const service = serviceWithAppointment({ id: 'appt-1', patientId: 'patient-42' });

    await expect(withFacts(service, event('doctor-user-7'))).resolves.toEqual(
      expect.objectContaining({ patientId: 'patient-42' })
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

  it('reads only a real patientId from the row', () => {
    expect(appointmentPatientId({ patientId: 'p-1' })).toBe('p-1');
    expect(appointmentPatientId({ patientId: '  ' })).toBeUndefined();
    expect(appointmentPatientId({ patientId: 7 })).toBeUndefined();
    expect(appointmentPatientId(null)).toBeUndefined();
  });
});
