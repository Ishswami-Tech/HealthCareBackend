import { describe, expect, it } from '@jest/globals';
import {
  formatAppointmentDateLabel,
  formatAppointmentTimeLabel,
  mergeAppointmentFacts,
} from '@services/appointments/plugins/notifications/notification-template-facts';

// 6 Oct 2026 00:00 IST, the way the DATE column comes back from Prisma.
const APPOINTMENT_DATE = new Date('2026-10-05T18:30:00.000Z');

const producerTemplate = {
  patientName: 'Patient',
  doctorName: 'Doctor',
  appointmentDate: '2026-10-06T09:00:00.000Z',
  appointmentTime: '10:00',
  location: 'Clinic',
  clinicName: 'Healthcare Clinic',
  appointmentType: 'VIDEO_CALL',
};

const appointmentRow = {
  date: APPOINTMENT_DATE,
  time: '14:30',
  type: 'VIDEO_CALL',
  patient: { user: { name: null, firstName: 'Aadesh', lastName: 'Bhujbal' } },
  doctor: { user: { name: 'Dr. Deshmukh', firstName: null, lastName: null } },
  clinic: { name: 'Viddhakarma Clinic' },
};

describe('notification template facts', () => {
  it('formats the visit date and time in IST for people, not machines', () => {
    expect(formatAppointmentDateLabel(APPOINTMENT_DATE)).toBe('Tue, 6 Oct 2026');
    expect(formatAppointmentTimeLabel(APPOINTMENT_DATE, '14:30')).toBe('2:30 PM');
    expect(formatAppointmentTimeLabel(APPOINTMENT_DATE, null)).toBe('');
  });

  it('replaces placeholder names, raw timestamps and the 10:00 default with row facts', () => {
    const merged = mergeAppointmentFacts(producerTemplate, appointmentRow);
    expect(merged.patientName).toBe('Aadesh Bhujbal');
    expect(merged.doctorName).toBe('Dr. Deshmukh');
    expect(merged.appointmentDate).toBe('Tue, 6 Oct 2026');
    expect(merged.appointmentTime).toBe('2:30 PM');
    expect(merged.location).toBe('Viddhakarma Clinic');
    expect(merged.clinicName).toBe('Viddhakarma Clinic');
  });

  it('keeps a real producer location and leaves the data untouched without a row', () => {
    const merged = mergeAppointmentFacts(
      { ...producerTemplate, location: 'Room 4' },
      appointmentRow
    );
    expect(merged.location).toBe('Room 4');
    expect(mergeAppointmentFacts(producerTemplate, null)).toEqual(producerTemplate);
  });

  it('falls back to the producer name when the row has no user name', () => {
    const merged = mergeAppointmentFacts(
      { ...producerTemplate, patientName: 'Walk-in guest' },
      { ...appointmentRow, patient: { user: { name: null, firstName: null, lastName: null } } }
    );
    expect(merged.patientName).toBe('Walk-in guest');
  });
});
