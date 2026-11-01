import { describe, expect, it } from '@jest/globals';
import {
  buildDeskFeesDue,
  type DeskFeeInvoiceRow,
  type DeskFeeVisitRef,
} from '../../../src/services/appointments/in-person/desk-fees.util';

const visit = (overrides: Partial<DeskFeeVisitRef> = {}): DeskFeeVisitRef => ({
  appointmentId: 'apt-1',
  patientId: 'pat-1',
  patientUserId: 'user-1',
  patientName: 'Asha Patil',
  doctorName: 'Dr. Deshmukh',
  time: '10:30',
  appointmentStatus: 'COMPLETED',
  ...overrides,
});

const invoice = (overrides: Partial<DeskFeeInvoiceRow> = {}): DeskFeeInvoiceRow => ({
  id: 'inv-1',
  invoiceNumber: 'INV-0001',
  appointmentId: 'apt-1',
  patientId: 'pat-1',
  userId: 'user-1',
  totalAmount: 300,
  status: 'PENDING',
  description: 'Walk-in desk fee',
  metadata: { paymentFor: 'WALK_IN_DESK_FEE' },
  createdAt: new Date('2026-11-01T04:00:00.000Z'),
  payments: [],
  ...overrides,
});

const META = { locationId: 'loc-1', date: '2026-11-01' };

describe('buildDeskFeesDue', () => {
  it('lists an unpaid desk fee of a visit of the day with its balance', () => {
    const result = buildDeskFeesDue([invoice()], [visit()], META);
    expect(result.fees).toHaveLength(1);
    expect(result.fees[0]).toMatchObject({
      invoiceId: 'inv-1',
      appointmentId: 'apt-1',
      patientUserId: 'user-1',
      patientName: 'Asha Patil',
      paymentFor: 'WALK_IN_DESK_FEE',
      totalAmount: 300,
      paidAmount: 0,
      balance: 300,
    });
    expect(result.totalDue).toBe(300);
    expect(result.locationId).toBe('loc-1');
  });

  it('subtracts completed payments only (a partial payment leaves the rest due)', () => {
    const result = buildDeskFeesDue(
      [
        invoice({
          payments: [
            { amount: 100, status: 'COMPLETED' },
            { amount: 200, status: 'FAILED' },
          ],
        }),
      ],
      [visit()],
      META
    );
    expect(result.fees[0]?.paidAmount).toBe(100);
    expect(result.fees[0]?.balance).toBe(200);
    expect(result.totalDue).toBe(200);
  });

  it('drops settled, PAID, VOID and other-visit invoices', () => {
    const result = buildDeskFeesDue(
      [
        invoice({ id: 'settled', payments: [{ amount: 300, status: 'COMPLETED' }] }),
        invoice({ id: 'paid', status: 'PAID' }),
        invoice({ id: 'void', status: 'VOID' }),
        invoice({ id: 'other', appointmentId: 'apt-elsewhere' }),
        invoice({ id: 'none', appointmentId: null }),
      ],
      [visit()],
      META
    );
    expect(result.fees).toEqual([]);
    expect(result.totalDue).toBe(0);
  });

  it('keeps rupee amounts exact in paise and orders oldest first', () => {
    const result = buildDeskFeesDue(
      [
        invoice({
          id: 'late',
          appointmentId: 'apt-2',
          totalAmount: '250.10',
          createdAt: new Date('2026-11-01T05:00:00.000Z'),
        }),
        invoice({ id: 'early', totalAmount: 0.2, createdAt: new Date('2026-11-01T03:00:00.000Z') }),
      ],
      [visit(), visit({ appointmentId: 'apt-2', patientUserId: '' })],
      META
    );
    expect(result.fees.map(fee => fee.invoiceId)).toEqual(['early', 'late']);
    expect(result.totalDue).toBe(250.3);
    // Falls back to the invoice's own user id when the visit row has none.
    expect(result.fees[1]?.patientUserId).toBe('user-1');
  });
});
