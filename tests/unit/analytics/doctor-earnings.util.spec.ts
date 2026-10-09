import { describe, it, expect } from '@jest/globals';
import { summarizeDoctorEarnings } from '@services/analytics/doctor-earnings.util';

const window = { from: '2026-10-01', to: '2026-10-31' };

describe('summarizeDoctorEarnings', () => {
  it('is empty with no payments', () => {
    expect(summarizeDoctorEarnings(window, [])).toEqual({
      ...window,
      currency: 'INR',
      consultations: 0,
      total: 0,
      daily: [],
    });
  });

  it('groups by IST appointment day, ordered, net of refunds', () => {
    const summary = summarizeDoctorEarnings(window, [
      {
        appointmentId: 'a2',
        appointmentDate: new Date('2026-10-02T05:00:00Z'),
        amount: 500.1,
        refundAmount: null,
      },
      {
        appointmentId: 'a1',
        appointmentDate: new Date('2026-10-01T05:00:00Z'),
        amount: 300,
        refundAmount: 0,
      },
      {
        appointmentId: 'a3',
        appointmentDate: new Date('2026-10-01T09:00:00Z'),
        amount: 200.2,
        refundAmount: 50.1,
      },
    ]);
    expect(summary.daily).toEqual([
      { date: '2026-10-01', consultations: 2, total: 450.1 },
      { date: '2026-10-02', consultations: 1, total: 500.1 },
    ]);
    expect(summary.consultations).toBe(3);
    expect(summary.total).toBe(950.2);
  });

  it('counts a late-evening UTC time on the next IST day', () => {
    const summary = summarizeDoctorEarnings(window, [
      {
        appointmentId: 'a1',
        appointmentDate: new Date('2026-10-01T20:00:00Z'),
        amount: 100,
        refundAmount: null,
      },
    ]);
    expect(summary.daily[0]?.date).toBe('2026-10-02');
  });

  it('never goes below zero for an over-refunded payment', () => {
    const summary = summarizeDoctorEarnings(window, [
      {
        appointmentId: 'a1',
        appointmentDate: new Date('2026-10-01T05:00:00Z'),
        amount: 100,
        refundAmount: 150,
      },
    ]);
    expect(summary.total).toBe(0);
  });
});
