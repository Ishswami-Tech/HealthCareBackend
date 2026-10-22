import { describe, expect, it } from '@jest/globals';
import { toSlimPrescriptionListRow } from '@services/pharmacy/services/prescription-list-slim.util';

const fullRow = {
  id: 'rx-1',
  status: 'ACTIVE',
  patientName: 'Asha Rao',
  patientPhone: '+91******1111',
  totalAmount: 120,
  canDispense: true,
  draftSnapshot: { items: new Array(20).fill({ big: 'x'.repeat(50) }) },
  patient: {
    id: 'p-1',
    userId: 'u-1',
    prakriti: 'VATA',
    createdAt: '2026-10-01',
    user: { id: 'u-1', name: 'Asha Rao', phone: '+911111111111', email: 'a@x.in', gender: 'F' },
  },
  doctor: {
    id: 'd-1',
    specialization: 'Ayurveda',
    qualification: 'BAMS',
    user: { id: 'du-1', name: 'Dr Rao', role: 'DOCTOR' },
  },
  location: { id: 'loc-1', name: 'Main', address: 'long address', qrCode: 'qr' },
  items: [
    {
      id: 'it-1',
      medicineId: 'm-1',
      quantity: 2,
      dispensedQuantity: 1,
      dosage: '1-0-1',
      dispenseEventHistory: [{ quantity: 1, eventType: 'DISPENSE' }],
      createdAt: '2026-10-01',
      medicine: {
        id: 'm-1',
        name: 'Ashwagandha',
        price: 60,
        stock: 9,
        description: 'long text',
        manufacturer: 'X',
      },
    },
  ],
  payments: [
    {
      id: 'pay-1',
      amount: 60,
      status: 'COMPLETED',
      method: 'CASH',
      createdAt: '2026-10-02',
      gatewayResponse: { huge: true },
      metadata: { paymentMethod: 'CASH', collectedAt: '2026-10-02', raw: { huge: true } },
    },
  ],
};

describe('toSlimPrescriptionListRow', () => {
  it('keeps top-level fields, reduces nested records to what the paged clients read', () => {
    const slim = toSlimPrescriptionListRow(fullRow) as Record<string, unknown>;

    expect(slim).toMatchObject({
      id: 'rx-1',
      status: 'ACTIVE',
      patientName: 'Asha Rao',
      patientPhone: '+91******1111',
      totalAmount: 120,
      canDispense: true,
    });
    expect(slim).not.toHaveProperty('draftSnapshot');
    expect(slim['patient']).toEqual({
      id: 'p-1',
      userId: 'u-1',
      user: { id: 'u-1', name: 'Asha Rao', phone: '+911111111111' },
    });
    expect(slim['doctor']).toEqual({ id: 'd-1', user: { id: 'du-1', name: 'Dr Rao' } });
    expect(slim['location']).toEqual({ id: 'loc-1', name: 'Main' });
    expect(slim['items']).toEqual([
      {
        id: 'it-1',
        medicineId: 'm-1',
        quantity: 2,
        dispensedQuantity: 1,
        dosage: '1-0-1',
        dispenseEventHistory: [{ quantity: 1, eventType: 'DISPENSE' }],
        medicine: { id: 'm-1', name: 'Ashwagandha', price: 60, stock: 9 },
      },
    ]);
    expect(slim['payments']).toEqual([
      {
        id: 'pay-1',
        amount: 60,
        status: 'COMPLETED',
        method: 'CASH',
        createdAt: '2026-10-02',
        metadata: { paymentMethod: 'CASH', collectedAt: '2026-10-02' },
      },
    ]);
    expect(JSON.stringify(slim).length).toBeLessThan(JSON.stringify(fullRow).length / 2);
  });

  it('leaves null relations and missing lists alone, never mutates the input', () => {
    const row = { id: 'rx-2', patient: null, doctor: null, location: null };
    const copy = JSON.parse(JSON.stringify(fullRow));
    expect(toSlimPrescriptionListRow(row)).toEqual(row);
    toSlimPrescriptionListRow(fullRow);
    expect(fullRow).toEqual(copy);
  });
});
