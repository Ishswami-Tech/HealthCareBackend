import { describe, expect, it } from '@jest/globals';
import {
  buildEarningsSplitReport,
  type SplitPaymentRow,
} from '../../../src/services/analytics/earnings-split.util';

const row = (overrides: Partial<SplitPaymentRow>): SplitPaymentRow => ({
  paymentId: 'pay-1',
  appointmentId: 'apt-1',
  appointmentDate: new Date('2026-10-05T10:00:00+05:30'),
  appointmentStatus: 'COMPLETED',
  doctorId: 'doc-1',
  doctorName: 'Dr. Deshmukh',
  grossAmount: 1251,
  doctorShareAmount: 1000,
  platformFeeAmount: 251,
  ...overrides,
});

describe('buildEarningsSplitReport', () => {
  const window = { from: '2026-10-01', to: '2026-10-09' };

  it('splits completed visits into doctor share and convenience fee', () => {
    const report = buildEarningsSplitReport(window, [
      row({}),
      row({
        paymentId: 'pay-2',
        appointmentId: 'apt-2',
        grossAmount: 1350,
        platformFeeAmount: 350,
      }),
    ]);
    expect(report.totals).toEqual({
      consultations: 2,
      grossAmount: 2601,
      doctorShareAmount: 2000,
      convenienceFeeAmount: 601,
    });
    expect(report.doctors).toHaveLength(1);
    expect(report.doctors[0]?.daily).toHaveLength(1);
  });

  it('keeps paid-but-not-completed payments out of earnings and lists them for an admin', () => {
    const report = buildEarningsSplitReport(window, [
      row({}),
      row({ paymentId: 'pay-3', appointmentId: 'apt-3', appointmentStatus: 'EXPIRED' }),
      row({ paymentId: 'pay-4', appointmentId: 'apt-4', appointmentStatus: 'NO_SHOW' }),
    ]);
    expect(report.totals.consultations).toBe(1);
    expect(report.totals.doctorShareAmount).toBe(1000);
    expect(report.paidNotCompleted.map(item => item.appointmentStatus).sort()).toEqual([
      'EXPIRED',
      'NO_SHOW',
    ]);
    expect(report.paidNotCompleted[0]?.amount).toBe(1251);
  });

  it('reports each doctor separately', () => {
    const report = buildEarningsSplitReport(window, [
      row({}),
      row({
        paymentId: 'pay-5',
        appointmentId: 'apt-5',
        doctorId: 'doc-2',
        doctorName: 'Dr. Patil',
      }),
    ]);
    expect(report.doctors.map(d => d.doctorName)).toEqual(['Dr. Deshmukh', 'Dr. Patil']);
  });
});
