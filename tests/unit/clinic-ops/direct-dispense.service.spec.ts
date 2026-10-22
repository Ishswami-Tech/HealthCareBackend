import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('@logging', () => jest.requireActual('@infrastructure/logging'), { virtual: true });
jest.mock('@services/pharmacy-inventory/services/inventory.service', () => ({
  InventoryService: class InventoryService {},
}));

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DirectDispenseService } from '@services/clinic-ops/services/direct-dispense.service';

type Row = Record<string, unknown>;

function dispenseRow(overrides: Row = {}): Row {
  return {
    id: 'dd-1',
    clinicId: 'clinic-1',
    locationId: null,
    patientId: null,
    walkInName: 'Ramesh',
    walkInPhone: null,
    prescriptionId: null,
    dispensedByUserId: 'assistant-1',
    dispensedByRole: 'ASSISTANT_DOCTOR',
    note: null,
    status: 'DISPENSED',
    undoUntil: new Date(Date.now() + 5 * 60 * 1000),
    reversedAt: null,
    reversedByUserId: null,
    reverseReason: null,
    invoiceId: null,
    totalAmount: 120,
    settledAt: null,
    settledMethod: null,
    settledById: null,
    createdAt: new Date('2026-10-20T05:00:00Z'),
    updatedAt: new Date('2026-10-20T05:00:00Z'),
    items: [
      {
        id: 'it-1',
        directDispenseId: 'dd-1',
        medicineId: 'm1',
        medicineName: 'Triphala',
        quantity: 2,
        unitPrice: 60,
        lineAmount: 120,
        batchAllocations: [{ lotNumber: 'L1', quantity: 2, expiryDate: '2027-01-01' }],
      },
    ],
    ...overrides,
  };
}

describe('DirectDispenseService', () => {
  let row: Row;
  let updateMany: jest.Mock<(args: Row) => Promise<{ count: number }>>;
  let restore: jest.Mock<(...args: unknown[]) => Promise<unknown[]>>;
  let medicineFindMany: jest.Mock<(args: Row) => Promise<Row[]>>;
  let patientFindFirst: jest.Mock<(args: Row) => Promise<Row | null>>;
  let prescriptionFindFirst: jest.Mock<(args: Row) => Promise<Row | null>>;
  let recent: Row[];
  let record: jest.Mock<(...args: unknown[]) => Promise<void>>;
  let service: DirectDispenseService;

  beforeEach(() => {
    row = dispenseRow();
    updateMany = jest.fn(async () => ({ count: 1 }));
    restore = jest.fn(async () => []);
    recent = [];
    record = jest.fn(async () => undefined);
    patientFindFirst = jest.fn(async () => ({ id: 'pat-1' }));
    prescriptionFindFirst = jest.fn(async () => ({ id: 'rx-1', status: 'PENDING' }));
    medicineFindMany = jest.fn(async () => [
      {
        id: 'm1',
        name: 'Triphala',
        category: null,
        unit: null,
        manufacturer: null,
        stock: 5,
        price: 60,
        minStockThreshold: 10,
      },
      {
        id: 'm2',
        name: 'Dashmool',
        category: null,
        unit: null,
        manufacturer: null,
        stock: 0,
        price: 90,
        minStockThreshold: 10,
      },
    ]);
    const client = {
      directDispense: {
        findFirst: jest.fn(async () => row),
        // list() reads [row]; the duplicate guard reads `recent` (it filters on createdAt).
        findMany: jest.fn(async (args: { where?: Row }) =>
          args.where && 'createdAt' in args.where ? recent : [row]
        ),
        updateMany,
        create: jest.fn(async () => row),
      },
      directDispenseItem: { update: jest.fn(async () => ({})) },
      user: { findMany: jest.fn(async () => [{ id: 'assistant-1', name: 'Dr. Meera' }]) },
      patient: { findMany: jest.fn(async () => []), findFirst: patientFindFirst },
      prescription: { findFirst: prescriptionFindFirst },
      clinicLocation: { findMany: jest.fn(async () => []) },
      medicine: {
        findMany: medicineFindMany,
        count: jest.fn(async () => 2),
        fields: { minStockThreshold: { name: 'minStockThreshold' } },
      },
      stockBatch: {
        findMany: jest.fn(async () => [
          { productId: 'm1', expiryDate: new Date('2030-01-01'), quantityOnHand: 5 },
        ]),
      },
    };
    const ops = {
      read: (fn: (c: unknown) => unknown) => fn(client),
      write: (fn: (c: unknown) => unknown) => fn(client),
      transaction: (fn: (c: unknown) => unknown) => fn(client),
    };
    service = new DirectDispenseService(
      ops as never,
      {
        restoreDispense: restore,
        dispenseFefo: jest.fn(async () => []),
      } as never,
      { emit: jest.fn(async () => undefined) } as never,
      { log: jest.fn(async () => undefined) } as never,
      { record } as never
    );
  });

  it('stock view filters LOW / OUT in the query and counts the total there', async () => {
    await service.stockView(
      'clinic-1',
      { userId: 'a', role: 'ASSISTANT_DOCTOR' },
      { status: 'out' }
    );
    expect((medicineFindMany.mock.calls[0]?.[0] as { where: Row }).where['stock']).toEqual({
      lte: 0,
    });
    medicineFindMany.mockClear();
    const low = await service.stockView(
      'clinic-1',
      { userId: 'a', role: 'ASSISTANT_DOCTOR' },
      { status: 'LOW' }
    );
    expect((medicineFindMany.mock.calls[0]?.[0] as { where: Row }).where['stock']).toEqual({
      gt: 0,
      lte: { name: 'minStockThreshold' },
    });
    expect(low.total).toBe(2);
    await expect(
      service.stockView('clinic-1', { userId: 'a', role: 'ASSISTANT_DOCTOR' }, { status: 'x' })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a patient, or a prescription, from outside the clinic', async () => {
    const actor = { userId: 'assistant-1', role: 'ASSISTANT_DOCTOR' };
    const items = [
      { medicineId: 'm1', quantity: 1 },
      { medicineId: 'm2', quantity: 1 },
    ];
    patientFindFirst.mockResolvedValueOnce(null);
    await expect(
      service.create({ patientId: 'pat-x', items }, 'clinic-1', actor)
    ).rejects.toBeInstanceOf(NotFoundException);
    const patientWhere = (patientFindFirst.mock.calls[0]?.[0] as { where: Row }).where;
    expect(patientWhere).toMatchObject({ id: 'pat-x', user: expect.anything() });

    prescriptionFindFirst.mockResolvedValueOnce(null);
    await expect(
      service.create({ patientId: 'pat-1', prescriptionId: 'rx-9', items }, 'clinic-1', actor)
    ).rejects.toBeInstanceOf(NotFoundException);
    expect((prescriptionFindFirst.mock.calls[0]?.[0] as { where: Row }).where).toEqual({
      id: 'rx-9',
      clinicId: 'clinic-1',
      patientId: 'pat-1',
    });

    prescriptionFindFirst.mockResolvedValueOnce({ id: 'rx-1', status: 'DRAFT' });
    await expect(
      service.create({ patientId: 'pat-1', prescriptionId: 'rx-1', items }, 'clinic-1', actor)
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a double submit returns the first hand-over; another dispenser gets a 409', async () => {
    const items = [
      { medicineId: 'm2', quantity: 2 },
      { medicineId: 'm1', quantity: 2 },
    ];
    recent = [
      dispenseRow({
        items: [
          { medicineId: 'm1', quantity: 2 },
          { medicineId: 'm2', quantity: 2 },
        ],
      }),
    ];
    const again = await service.create({ walkInName: 'ramesh', items }, 'clinic-1', {
      userId: 'assistant-1',
      role: 'ASSISTANT_DOCTOR',
    });
    expect(again.id).toBe('dd-1');
    expect(record).not.toHaveBeenCalled();
    await expect(
      service.create({ walkInName: 'Ramesh', items }, 'clinic-1', {
        userId: 'pharm-1',
        role: 'PHARMACIST',
      })
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('writes a DISPENSE_CREATED audit event', async () => {
    await service.create(
      {
        walkInName: 'Ramesh',
        items: [
          { medicineId: 'm1', quantity: 1 },
          { medicineId: 'm2', quantity: 1 },
        ],
      },
      'clinic-1',
      { userId: 'assistant-1', role: 'ASSISTANT_DOCTOR' }
    );
    expect(record).toHaveBeenCalledWith(
      'clinic-1',
      { type: 'DIRECT_DISPENSE', id: 'dd-1' },
      'DISPENSE_CREATED',
      { userId: 'assistant-1', role: 'ASSISTANT_DOCTOR' },
      expect.objectContaining({ walkIn: true })
    );
  });

  it('never returns amounts to the assistant or the doctor, but does to the clinic admin', async () => {
    const asAssistant = await service.get('dd-1', 'clinic-1', {
      userId: 'assistant-1',
      role: 'ASSISTANT_DOCTOR',
    });
    expect(JSON.stringify(asAssistant)).not.toMatch(/price|amount|settled/i);
    expect(asAssistant.items[0]).toMatchObject({ medicineName: 'Triphala', quantity: 2 });

    const asAdmin = await service.get('dd-1', 'clinic-1', {
      userId: 'admin-1',
      role: 'CLINIC_ADMIN',
    });
    expect(asAdmin.totalAmount).toBe(120);
    expect(asAdmin.items[0]?.unitPrice).toBe(60);
  });

  it("hides other people's hand-overs from the clinical roles", async () => {
    await expect(
      service.get('dd-1', 'clinic-1', { userId: 'assistant-2', role: 'ASSISTANT_DOCTOR' })
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stock view shows levels for the assistant without prices', async () => {
    const asAssistant = await service.stockView(
      'clinic-1',
      { userId: 'a', role: 'ASSISTANT_DOCTOR' },
      {}
    );
    expect(asAssistant.items.map(i => i.status)).toEqual(['LOW', 'OUT']);
    expect(JSON.stringify(asAssistant)).not.toMatch(/price/i);
    const asPharmacist = await service.stockView(
      'clinic-1',
      { userId: 'p', role: 'PHARMACIST' },
      {}
    );
    expect(asPharmacist.items[0]?.price).toBe(60);
  });

  it('undo: only the dispenser inside the window; restores stock', async () => {
    await expect(
      service.undo('dd-1', 'clinic-1', { userId: 'assistant-2', role: 'ASSISTANT_DOCTOR' })
    ).rejects.toBeInstanceOf(ForbiddenException);

    row = dispenseRow({ undoUntil: new Date(Date.now() - 1000) });
    await expect(
      service.undo('dd-1', 'clinic-1', { userId: 'assistant-1', role: 'ASSISTANT_DOCTOR' })
    ).rejects.toBeInstanceOf(BadRequestException);

    row = dispenseRow();
    await service.undo('dd-1', 'clinic-1', { userId: 'assistant-1', role: 'ASSISTANT_DOCTOR' });
    expect((updateMany.mock.calls[0]?.[0] as { data: Row }).data).toMatchObject({
      status: 'REVERSED',
    });
    expect(restore).toHaveBeenCalledWith(
      'dd-1',
      [{ medicineId: 'm1', quantity: 2 }],
      'assistant-1',
      'clinic-1',
      expect.anything(),
      'DIRECT_DISPENSE'
    );
  });

  it('refuses to undo a settled or already reversed hand-over', async () => {
    row = dispenseRow({ settledAt: new Date() });
    await expect(
      service.undo('dd-1', 'clinic-1', { userId: 'assistant-1', role: 'ASSISTANT_DOCTOR' })
    ).rejects.toBeInstanceOf(BadRequestException);
    row = dispenseRow({ status: 'REVERSED' });
    await expect(
      service.reverse('dd-1', { reason: 'wrong patient' }, 'clinic-1', {
        userId: 'admin-1',
        role: 'CLINIC_ADMIN',
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(restore).not.toHaveBeenCalled();
  });

  it('requires a patient or a walk-in name', async () => {
    await expect(
      service.create({ items: [{ medicineId: 'm1', quantity: 1 }] }, 'clinic-1', {
        userId: 'assistant-1',
        role: 'ASSISTANT_DOCTOR',
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
