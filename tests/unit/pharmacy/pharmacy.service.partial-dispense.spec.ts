/// <reference types="jest" />
/**
 * Partial dispensing (POST /pharmacy/prescriptions/:id/dispense). A doctor may prescribe more
 * than the pharmacy has on hand ("dispense partially and order the rest"), so the desk must be
 * able to dispense any quantity up to what is still prescribed, leave the remainder on the item
 * (PrescriptionItem.dispensedQuantity), keep the prescription PARTIAL while anything remains,
 * dispense the rest later and reach FILLED only when every item is complete. 'Insufficient stock'
 * is raised only when the pharmacist asks for more than is on hand.
 */

import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PharmacyService } from '@services/pharmacy/services/pharmacy.service';
import { DispensePrescriptionItemDto } from '@dtos/pharmacy.dto';

jest.mock('@infrastructure/database', () => ({ DatabaseService: class DatabaseService {} }));
jest.mock('@infrastructure/database/database.service', () => ({
  DatabaseService: class DatabaseService {},
}));
jest.mock('@infrastructure/events/event.service', () => ({ EventService: class EventService {} }));
jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));
jest.mock('@infrastructure/cache/cache.service', () => ({ CacheService: class CacheService {} }));
jest.mock('@infrastructure/queue', () => ({
  AppointmentQueueService: class AppointmentQueueService {},
}));
jest.mock('@payment/payment.service', () => ({ PaymentService: class PaymentService {} }));
jest.mock('@services/pharmacy-inventory/services/inventory.service', () => ({
  InventoryService: class InventoryService {},
}));
jest.mock('@services/pharmacy-inventory/services/expiry-alert.service', () => ({
  ExpiryAlertService: class ExpiryAlertService {},
}));

const CLINIC = 'clinic-1';
const RX = 'rx-1';
const ITEM = 'item-1';
const MED = 'med-1';
const PHARMACIST = { userId: 'pharm-user', role: 'PHARMACIST' };

type Row = Record<string, unknown>;

interface Scenario {
  prescribed: number;
  dispensed?: number;
  stock: number;
  status?: string;
}

function createHarness(scenario: Scenario) {
  const dispensed = scenario.dispensed ?? 0;
  const status = scenario.status ?? (dispensed > 0 ? 'PARTIAL' : 'PENDING');
  const medicine = { id: MED, name: 'Ashwagandha Churna', price: 0, stock: scenario.stock };
  const item: Row = {
    id: ITEM,
    prescriptionId: RX,
    medicineId: MED,
    quantity: scenario.prescribed,
    dispensedQuantity: dispensed,
    dispensedAt: null,
    dispenseBatchHistory: null,
    dispenseEventHistory: null,
    medicine,
  };
  const prescription: Row = {
    id: RX,
    clinicId: CLINIC,
    patientId: 'patient-1',
    doctorId: 'doctor-1',
    status,
    date: new Date('2026-10-01T04:30:00Z'),
    notes: null,
    diagnosis: null,
    items: [item],
    patient: {
      id: 'patient-1',
      user: { id: 'patient-user', name: 'Pat', phone: '1', email: null },
    },
    doctor: { id: 'doctor-1', user: { id: 'doc-user', name: 'Dr Doc', role: 'DOCTOR' } },
    location: null,
  };
  const client = {
    prescription: {
      findUnique: jest.fn().mockResolvedValue(prescription),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(async ({ data }: { data: Row }) => ({ ...prescription, ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    prescriptionItem: {
      // The guarded claim: applies the write to the in-memory line, like the row in the DB.
      updateMany: jest.fn(async ({ data }: { data: Row }) => {
        Object.assign(item, data);
        return { count: 1 };
      }),
      update: jest.fn().mockResolvedValue(item),
      findMany: jest.fn(async () => [item]),
    },
    medicine: { findMany: jest.fn().mockResolvedValue([medicine]) },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Pharma Cist' }) },
    patientVisit: { findMany: jest.fn().mockResolvedValue([]) },
    appointment: { findMany: jest.fn().mockResolvedValue([]) },
    payment: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const databaseService = {
    executeHealthcareRead: jest.fn(async (op: (c: unknown) => Promise<unknown>) => op(client)),
    executeHealthcareWrite: jest.fn(
      async (op: (c: unknown) => Promise<unknown>, _audit?: Record<string, unknown>) => op(client)
    ),
    executeInTransaction: jest.fn(async (op: (c: unknown) => Promise<unknown>) => op(client)),
    findPaymentsSafe: jest.fn().mockResolvedValue([]),
  };
  const inventoryService = {
    dispenseFefo: jest.fn(
      async (
        _prescriptionId: string,
        dto: { items: Array<{ prescriptionItemId: string; medicineId: string; quantity: number }> }
      ) =>
        dto.items.map(line => ({
          prescriptionItemId: line.prescriptionItemId,
          medicineId: line.medicineId,
          consumedBatches: [],
          unbatchedQuantity: line.quantity,
          totalDispensed: line.quantity,
        }))
    ),
    restoreDispense: jest.fn().mockResolvedValue([]),
  };
  const billing = {
    findPrescriptionInvoices: jest.fn().mockResolvedValue(new Map()),
    findPrescriptionInvoice: jest.fn().mockResolvedValue(null),
    ensurePrescriptionInvoice: jest.fn().mockResolvedValue({
      id: 'inv-1',
      invoiceNumber: 'PH-1',
      status: 'PAID',
      totalAmount: 0,
      prescriptionId: RX,
    }),
  };
  const appointmentQueueService = {
    getOperationalQueue: jest.fn().mockResolvedValue([]),
    removeOperationalQueueItem: jest.fn().mockResolvedValue(undefined),
    enqueueOperationalItem: jest.fn().mockResolvedValue(undefined),
  };
  const service = new PharmacyService(
    databaseService as never,
    {} as never,
    { emit: jest.fn().mockResolvedValue(undefined) } as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    appointmentQueueService as never,
    inventoryService as never,
    {} as never,
    { get: jest.fn().mockReturnValue(billing) } as never,
    { invalidateCacheByTag: jest.fn(), del: jest.fn() } as never
  );
  const itemUpdateData = (): Row =>
    (client.prescriptionItem.updateMany.mock.calls[0]?.[0] as { data: Row }).data;
  const statusWritten = (): unknown =>
    (client.prescription.update.mock.calls[0]?.[0] as { data: Row }).data['status'];
  return {
    service,
    client,
    databaseService,
    inventoryService,
    item,
    itemUpdateData,
    statusWritten,
  };
}

const request = (quantity: number) => ({
  items: [{ medicineId: MED, prescriptionItemId: ITEM, quantity }],
});

describe('DispensePrescriptionItemDto', () => {
  it('requires a positive whole quantity and leaves the upper bound to the prescription', async () => {
    const ok = await validate(
      plainToInstance(DispensePrescriptionItemDto, { medicineId: MED, quantity: 3 })
    );
    expect(ok).toEqual([]);
    for (const quantity of [0, -1, 1.5]) {
      const errors = await validate(
        plainToInstance(DispensePrescriptionItemDto, { medicineId: MED, quantity })
      );
      expect(errors.map(e => e.property)).toEqual(['quantity']);
    }
  });
});

describe('PharmacyService.dispensePrescription partial dispensing', () => {
  it('dispenses what the pharmacist has, leaves the rest on the item and marks the prescription PARTIAL', async () => {
    const h = createHarness({ prescribed: 10, stock: 4 });

    const result = await h.service.dispensePrescription(RX, request(4), CLINIC, PHARMACIST);

    expect(h.inventoryService.dispenseFefo).toHaveBeenCalledWith(
      RX,
      { items: [{ prescriptionItemId: ITEM, medicineId: MED, quantity: 4 }] },
      'pharm-user',
      CLINIC,
      expect.anything(),
      false
    );
    expect(h.itemUpdateData()).toMatchObject({ dispensedQuantity: 4 });
    expect(h.statusWritten()).toBe('PARTIAL');
    expect(result.dispenseSummary).toMatchObject({
      status: 'PARTIAL',
      totalRequestedQuantity: 4,
      totalDispensedQuantity: 4,
      remainingQuantity: 6,
    });
  });

  it('dispenses the remainder later and reaches FILLED only when every item is complete', async () => {
    const h = createHarness({ prescribed: 10, dispensed: 4, stock: 6 });

    const result = await h.service.dispensePrescription(RX, request(6), CLINIC, PHARMACIST);

    expect(h.itemUpdateData()).toMatchObject({ dispensedQuantity: 10 });
    expect(h.statusWritten()).toBe('FILLED');
    expect(result.dispenseSummary).toMatchObject({ status: 'FILLED', remainingQuantity: 0 });
  });

  it('a second partial dispense keeps the prescription PARTIAL while anything remains', async () => {
    const h = createHarness({ prescribed: 10, dispensed: 4, stock: 3 });

    const result = await h.service.dispensePrescription(RX, request(3), CLINIC, PHARMACIST);

    expect(h.itemUpdateData()).toMatchObject({ dispensedQuantity: 7 });
    expect(h.statusWritten()).toBe('PARTIAL');
    expect(result.dispenseSummary).toMatchObject({ status: 'PARTIAL', remainingQuantity: 3 });
  });

  it('without an item list it dispenses everything still remaining', async () => {
    const h = createHarness({ prescribed: 10, dispensed: 4, stock: 20 });

    const result = await h.service.dispensePrescription(RX, {}, CLINIC, PHARMACIST);

    expect(h.inventoryService.dispenseFefo).toHaveBeenCalledWith(
      RX,
      { items: [{ prescriptionItemId: ITEM, medicineId: MED, quantity: 6 }] },
      'pharm-user',
      CLINIC,
      expect.anything(),
      false
    );
    expect(result.dispenseSummary).toMatchObject({ status: 'FILLED', remainingQuantity: 0 });
  });

  it("raises 'Insufficient stock' only when more than is on hand is requested, and writes nothing", async () => {
    const h = createHarness({ prescribed: 10, stock: 4 });

    await expect(
      h.service.dispensePrescription(RX, request(5), CLINIC, PHARMACIST)
    ).rejects.toThrow('Insufficient stock');
    expect(h.inventoryService.dispenseFefo).not.toHaveBeenCalled();
    expect(h.client.prescriptionItem.updateMany).not.toHaveBeenCalled();
    expect(h.client.prescription.update).not.toHaveBeenCalled();
  });

  it('rejects a quantity above what is still prescribed, even when the stock would allow it', async () => {
    const h = createHarness({ prescribed: 10, dispensed: 4, stock: 100 });

    await expect(
      h.service.dispensePrescription(RX, request(7), CLINIC, PHARMACIST)
    ).rejects.toThrow('exceeds remaining quantity (6)');
    expect(h.client.prescriptionItem.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to dispense a prescription that is already FILLED', async () => {
    const h = createHarness({ prescribed: 10, dispensed: 10, stock: 100, status: 'FILLED' });

    await expect(
      h.service.dispensePrescription(RX, request(1), CLINIC, PHARMACIST)
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.client.prescriptionItem.updateMany).not.toHaveBeenCalled();
  });
});

describe('PharmacyService dispense / reversal atomicity (concurrent double submit)', () => {
  it('runs the dispense in one transaction and claims the line before any stock is decremented', async () => {
    const h = createHarness({ prescribed: 10, stock: 10 });

    await h.service.dispensePrescription(RX, request(10), CLINIC, PHARMACIST);

    expect(h.databaseService.executeInTransaction).toHaveBeenCalledTimes(1);
    const claimOrder = h.client.prescriptionItem.updateMany.mock.invocationCallOrder[0] ?? 0;
    const fefoOrder = h.inventoryService.dispenseFefo.mock.invocationCallOrder[0] ?? 0;
    expect(claimOrder).toBeGreaterThan(0);
    expect(claimOrder).toBeLessThan(fefoOrder);
    // The claim is guarded on the snapshot it was validated against.
    expect(h.client.prescriptionItem.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: ITEM, dispensedQuantity: 0, dispensedAt: null },
    });
  });

  it('the loser of a concurrent dispense gets a 409 and never touches stock', async () => {
    const h = createHarness({ prescribed: 10, stock: 10 });
    h.client.prescriptionItem.updateMany.mockResolvedValueOnce({ count: 0 });

    const attempt = h.service.dispensePrescription(RX, request(10), CLINIC, PHARMACIST);

    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toThrow('dispensed concurrently');
    expect(h.inventoryService.dispenseFefo).not.toHaveBeenCalled();
    expect(h.client.prescription.update).not.toHaveBeenCalled();
  });

  it('derives the status from the lines re-read after the prescription row is locked', async () => {
    const h = createHarness({ prescribed: 10, stock: 10 });

    await h.service.dispensePrescription(RX, request(4), CLINIC, PHARMACIST);

    const lockOrder = h.client.prescription.updateMany.mock.invocationCallOrder[0] ?? 0;
    const fefoOrder = h.inventoryService.dispenseFefo.mock.invocationCallOrder[0] ?? 0;
    const rereadOrder = h.client.prescriptionItem.findMany.mock.invocationCallOrder[0] ?? 0;
    expect(fefoOrder).toBeLessThan(lockOrder);
    expect(lockOrder).toBeLessThan(rereadOrder);
    expect(h.statusWritten()).toBe('PARTIAL');
  });

  it('a concurrent second reversal is refused (409) before any stock is restored', async () => {
    const h = createHarness({ prescribed: 5, dispensed: 5, stock: 0, status: 'FILLED' });
    h.item['dispensedAt'] = new Date('2026-10-02T05:00:00Z');
    h.item['dispenseEventHistory'] = [
      {
        quantity: 5,
        medicineId: MED,
        originalMedicineId: MED,
        eventType: 'DISPENSE',
        dispensedAt: '2026-10-02T05:00:00.000Z',
      },
    ];
    h.client.prescriptionItem.updateMany.mockResolvedValueOnce({ count: 0 });

    const attempt = h.service.reversePrescriptionDispense(
      RX,
      { reason: 'double tap' },
      CLINIC,
      PHARMACIST
    );

    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    expect(h.client.prescriptionItem.updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { id: ITEM, dispensedQuantity: 5, dispensedAt: new Date('2026-10-02T05:00:00Z') },
    });
    expect(h.inventoryService.restoreDispense).not.toHaveBeenCalled();
    expect(h.client.prescription.update).not.toHaveBeenCalled();
  });

  it('a reversal restores the stock once, after the line is claimed', async () => {
    const h = createHarness({ prescribed: 5, dispensed: 5, stock: 0, status: 'FILLED' });
    h.item['dispenseEventHistory'] = [
      {
        quantity: 5,
        medicineId: MED,
        originalMedicineId: MED,
        eventType: 'DISPENSE',
        dispensedAt: '2026-10-02T05:00:00.000Z',
      },
    ];

    await h.service.reversePrescriptionDispense(
      RX,
      { reason: 'wrong patient' },
      CLINIC,
      PHARMACIST
    );

    expect(h.databaseService.executeInTransaction).toHaveBeenCalledTimes(1);
    expect(h.inventoryService.restoreDispense).toHaveBeenCalledTimes(1);
    expect(h.inventoryService.restoreDispense.mock.calls[0]?.[1]).toEqual([
      { medicineId: MED, quantity: 5 },
    ]);
    const claimOrder = h.client.prescriptionItem.updateMany.mock.invocationCallOrder[0] ?? 0;
    const restoreOrder = h.inventoryService.restoreDispense.mock.invocationCallOrder[0] ?? 0;
    expect(claimOrder).toBeLessThan(restoreOrder);
  });
});
