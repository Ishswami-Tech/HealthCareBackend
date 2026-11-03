/// <reference types="jest" />
/**
 * Patient-facing invoice text must read like a bill, never carry internal ids.
 */
import {
  buildAppointmentInvoiceDescription,
  buildPharmacyInvoiceDescription,
  buildPlanInvoiceDescription,
  formatDoctorName,
  prescriptionReference,
  stripInternalIds,
} from '@services/billing/invoice-description.util';

const UUID = '3f2b8c1a-9d4e-4f6a-8b2c-1e5d7a9c0b3f';
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
// 22 Oct 2026 IST day key, stored as IST midnight in UTC.
const IST_DAY = new Date('2026-10-21T18:30:00.000Z');

describe('invoice-description.util', () => {
  it('builds a video consultation line with doctor and IST date/time', () => {
    expect(
      buildAppointmentInvoiceDescription({
        appointmentType: 'VIDEO_CALL',
        doctorName: 'Asha Rao',
        date: IST_DAY,
        time: '10:30',
        treatmentLabel: 'General Consultation',
      })
    ).toBe('Video consultation with Dr. Asha Rao — 22 Oct 2026, 10:30 AM');
  });

  it('keeps a specific treatment label, does not double "Dr." and works without a doctor', () => {
    expect(
      buildAppointmentInvoiceDescription({
        appointmentType: 'IN_PERSON',
        doctorName: 'Dr. Mehta',
        date: '2026-10-22',
        time: '14:00',
        treatmentLabel: 'Panchakarma',
      })
    ).toBe('In-clinic consultation (Panchakarma) with Dr. Mehta — 22 Oct 2026, 2:00 PM');
    expect(buildAppointmentInvoiceDescription({ appointmentType: 'VIDEO_CALL' })).toBe(
      'Video consultation'
    );
  });

  it('never leaks a uuid', () => {
    const text = buildAppointmentInvoiceDescription({
      appointmentType: 'VIDEO_CALL',
      doctorName: UUID,
      treatmentLabel: `Appointment ${UUID}`,
      date: IST_DAY,
      time: '09:00',
    });
    expect(text).not.toMatch(UUID_RE);
    expect(stripInternalIds(`Pharmacy bill for prescription ${UUID}`)).toBe(
      'Pharmacy bill for prescription'
    );
    expect(formatDoctorName(UUID)).toBe('');
  });

  it('describes plans with their cadence', () => {
    expect(buildPlanInvoiceDescription('Ayurveda Care Plan', 'MONTHLY', 1)).toBe(
      'Ayurveda Care Plan — monthly'
    );
    expect(buildPlanInvoiceDescription('Ayurveda Care Plan', 'MONTHLY', 3)).toBe(
      'Ayurveda Care Plan — every 3 months'
    );
    expect(buildPlanInvoiceDescription('Ayurveda Care Plan', null)).toBe('Ayurveda Care Plan');
    expect(buildPlanInvoiceDescription(undefined, 'YEARLY')).toBe('Care plan — yearly');
  });

  it('describes medicines with the Rx number, derived when not stored', () => {
    expect(buildPharmacyInvoiceDescription('RX-20261022-A1B2C3D4')).toBe(
      'Medicines — Rx #RX-20261022-A1B2C3D4'
    );
    expect(buildPharmacyInvoiceDescription(null)).toBe('Medicines');
    expect(prescriptionReference({ id: UUID, date: IST_DAY })).toBe('RX-20261022-3F2B8C1A');
    expect(prescriptionReference({ id: UUID, prescriptionNumber: 'RX-STORED-1' })).toBe(
      'RX-STORED-1'
    );
  });
});
