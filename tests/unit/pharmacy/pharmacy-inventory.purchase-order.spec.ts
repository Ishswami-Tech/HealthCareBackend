/// <reference types="jest" />
/**
 * PurchaseOrderService: clinic scoping, paise-safe totals, list/get routes.
 */

import { BadRequestException } from '@nestjs/common';
import { PurchaseOrderService } from '@services/pharmacy-inventory/services/purchase-order.service';
import { InventoryService } from '@services/pharmacy-inventory/services/inventory.service';
import { RbacService } from '@core/rbac/rbac.service';

jest.mock('@infrastructure/database/database.service', () => ({
  DatabaseService: class DatabaseService {},
}));
jest.mock('@infrastructure/cache/cache.service', () => ({ CacheService: class CacheService {} }));
jest.mock('@infrastructure/logging/logging.service', () => ({
  LoggingService: class LoggingService {},
}));
jest.mock('@infrastructure/events', () => ({ EventService: class EventService {} }));
jest.mock('@core/rbac/role.service', () => ({ RoleService: class RoleService {} }));
jest.mock('@core/rbac/permission.service', () => ({
  PermissionService: class PermissionService {},
}));

const CLINIC = 'clinic-1';
const SUPPLIER = '11111111-1111-4111-8111-111111111111';
const MED_A = '22222222-2222-4222-8222-222222222222';
const MED_B = '33333333-3333-4333-8333-333333333333';

function createHarness() {
  const loose = {
    supplier: { findFirst: jest.fn().mockResolvedValue({ id: SUPPLIER }) },
    medicine: {
      findMany: jest.fn().mockResolvedValue([
        { id: MED_A, name: 'Para' },
        { id: MED_B, name: 'Amox' },
      ]),
    },
  };
  const purchaseOrder = {
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const items = (data['items'] as { create: Array<Record<string, unknown>> }).create;
      return {
        id: 'po-1',
        createdAt: new Date('2026-10-04T00:00:00Z'),
        sentAt: null,
        receivedAt: null,
        ...data,
        items: items.map((item, index) => ({ id: `i-${index}`, receivedQuantity: 0, ...item })),
      };
    }),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
    findFirst: jest.fn(),
    update: jest.fn(),
  };
  const db = {
    prisma: { purchaseOrder },
    executeHealthcareRead: jest.fn(async (op: (c: unknown) => Promise<unknown>) => op(loose)),
  };
  const events = { emit: jest.fn() };
  const service = new PurchaseOrderService(
    db as never,
    {} as never,
    { info: jest.fn() } as never,
    events as never
  );
  return { service, loose, purchaseOrder, events };
}

describe('PurchaseOrderService.createPurchaseOrder', () => {
  it('computes the total in integer paise and stores a DRAFT with a clinic scoped number', async () => {
    const h = createHarness();
    const po = await h.service.createPurchaseOrder(
      {
        supplierId: SUPPLIER,
        items: [
          { productId: MED_A, quantity: 3, unitPrice: 19.99 },
          { productId: MED_B, quantity: 7, unitPrice: 0.1 },
          { productId: MED_A, quantity: 1 },
        ],
      },
      'user-1',
      CLINIC
    );

    // 3 * 19.99 + 7 * 0.10 = 59.97 + 0.70 (float math would give 60.669999...)
    expect(po.totalAmount).toBe(60.67);
    expect(po.status).toBe('DRAFT');
    expect(po.poNumber).toMatch(/^PO-\d{8}-[0-9A-F]{8}$/);
    expect(po.items.map(item => item.lineTotal)).toEqual([59.97, 0.7, 0]);
    expect(po.items[2]!.description).toBe('Para');
    const data = h.purchaseOrder.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).toMatchObject({ clinicId: CLINIC, createdById: 'user-1', status: 'DRAFT' });
    expect(h.events.emit).toHaveBeenCalledWith(
      'pharmacy.purchaseOrder.created',
      expect.objectContaining({ poId: 'po-1', clinicId: CLINIC })
    );
  });

  it('rejects a supplier or medicine that is not in the caller clinic', async () => {
    const noSupplier = createHarness();
    noSupplier.loose.supplier.findFirst.mockResolvedValue(null);
    await expect(
      noSupplier.service.createPurchaseOrder(
        { supplierId: SUPPLIER, items: [{ productId: MED_A, quantity: 1 }] },
        'u',
        CLINIC
      )
    ).rejects.toThrow('Supplier not found in this clinic');
    expect(noSupplier.purchaseOrder.create).not.toHaveBeenCalled();

    const foreignMedicine = createHarness();
    foreignMedicine.loose.medicine.findMany.mockResolvedValue([{ id: MED_A, name: 'Para' }]);
    await expect(
      foreignMedicine.service.createPurchaseOrder(
        {
          supplierId: SUPPLIER,
          items: [
            { productId: MED_A, quantity: 1 },
            { productId: MED_B, quantity: 1 },
          ],
        },
        'u',
        CLINIC
      )
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(foreignMedicine.purchaseOrder.create).not.toHaveBeenCalled();

    const supplierWhere = noSupplier.loose.supplier.findFirst.mock.calls[0]![0].where;
    expect(supplierWhere).toMatchObject({ clinicId: CLINIC, deletedAt: null });
  });

  it('fails closed without a clinic', async () => {
    const h = createHarness();
    await expect(
      h.service.createPurchaseOrder(
        { supplierId: SUPPLIER, items: [{ productId: MED_A, quantity: 1 }] },
        'u',
        ''
      )
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('PurchaseOrderService list / get', () => {
  it('lists only the caller clinic, filtered and paginated', async () => {
    const h = createHarness();
    h.purchaseOrder.count.mockResolvedValue(1);
    h.purchaseOrder.findMany.mockResolvedValue([
      {
        id: 'po-1',
        poNumber: 'PO-1',
        supplierId: SUPPLIER,
        clinicId: CLINIC,
        status: 'SENT',
        notes: null,
        expectedDeliveryDate: null,
        sentAt: null,
        totalAmount: 10,
        createdAt: new Date(),
        items: [],
      },
    ]);

    const page = await h.service.listPurchaseOrders(CLINIC, {
      status: 'SENT',
      limit: 500,
      offset: -4,
    });

    expect(h.purchaseOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clinicId: CLINIC, status: 'SENT' },
        take: 200,
        skip: 0,
        orderBy: { createdAt: 'desc' },
      })
    );
    expect(page).toMatchObject({ total: 1, limit: 200, offset: 0 });
    expect(page.data[0]!.status).toBe('SENT');
    await expect(h.service.listPurchaseOrders('')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reads one order within clinic scope and throws when it belongs elsewhere', async () => {
    const h = createHarness();
    h.purchaseOrder.findFirst.mockResolvedValue(null);
    await expect(h.service.getPurchaseOrderById('po-9', CLINIC)).rejects.toThrow(
      'not found in clinic'
    );
    expect(h.purchaseOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'po-9', clinicId: CLINIC } })
    );
  });

  it('only sends a DRAFT order', async () => {
    const h = createHarness();
    h.purchaseOrder.findFirst.mockResolvedValue({ id: 'po-1', status: 'SENT' });
    await expect(h.service.sendPurchaseOrder('po-1', CLINIC)).rejects.toThrow('Must be DRAFT');
  });
});

// ---------------------------------------------------------------------------
// InventoryService: FEFO dispense, guarded stock, reversal, clinic isolation
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if ('gte' in c) return (value as number) >= (c['gte'] as number);
      if ('gt' in c) return (value as number) > (c['gt'] as number);
      if ('in' in c) return (c['in'] as unknown[]).includes(value);
    }
    return value === cond;
  });
}

function applyData(row: Row, data: Row): void {
  for (const [key, val] of Object.entries(data)) {
    if (val && typeof val === 'object' && 'increment' in (val as Row)) {
      row[key] = (row[key] as number) + ((val as Row)['increment'] as number);
    } else if (val && typeof val === 'object' && 'decrement' in (val as Row)) {
      row[key] = (row[key] as number) - ((val as Row)['decrement'] as number);
    } else {
      row[key] = val;
    }
  }
}

function delegate(rows: Row[]) {
  return {
    findFirst: jest.fn(
      async ({ where }: { where: Row }) => rows.find(r => matches(r, where)) ?? null
    ),
    findMany: jest.fn(async ({ where, orderBy }: { where: Row; orderBy?: Row }) => {
      const found = rows.filter(r => matches(r, where));
      if (orderBy && 'expiryDate' in orderBy) {
        found.sort(
          (a, b) => (a['expiryDate'] as Date).getTime() - (b['expiryDate'] as Date).getTime()
        );
      }
      if (orderBy && 'createdAt' in orderBy) found.reverse();
      return found;
    }),
    updateMany: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const found = rows.filter(r => matches(r, where));
      found.forEach(r => applyData(r, data));
      return { count: found.length };
    }),
    create: jest.fn(async ({ data }: { data: Row }) => {
      const row = { id: `row-${rows.length + 1}`, createdAt: new Date(), ...data };
      rows.push(row);
      return row;
    }),
  };
}

function createInventoryHarness(opts: { stock: number; batches: Row[]; medicineClinic?: string }) {
  const medicines: Row[] = [
    { id: 'med-1', clinicId: opts.medicineClinic ?? CLINIC, stock: opts.stock },
  ];
  const batches: Row[] = opts.batches.map(b => ({ productId: 'med-1', clinicId: CLINIC, ...b }));
  const movements: Row[] = [];
  const tx = {
    medicine: delegate(medicines),
    stockBatch: delegate(batches),
    stockMovement: delegate(movements),
  };
  const db = { prisma: { $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) } };
  const cache = { del: jest.fn(), get: jest.fn(), set: jest.fn() };
  const service = new InventoryService(
    db as never,
    cache as never,
    { info: jest.fn() } as never,
    { emit: jest.fn() } as never
  );
  return { service, medicines, batches, movements, tx };
}

const FUTURE_NEAR = new Date(Date.now() + 30 * 86_400_000);
const FUTURE_FAR = new Date(Date.now() + 300 * 86_400_000);
const PAST = new Date(Date.now() - 86_400_000);
const line = (quantity: number) => ({
  items: [{ prescriptionItemId: 'pi-1', medicineId: 'med-1', quantity }],
});

describe('InventoryService.dispenseFefo', () => {
  it('consumes the earliest-expiring batch first and spills into the next', async () => {
    const h = createInventoryHarness({
      stock: 15,
      batches: [
        { id: 'late', lotNumber: 'L2', expiryDate: FUTURE_FAR, quantityOnHand: 10 },
        { id: 'soon', lotNumber: 'L1', expiryDate: FUTURE_NEAR, quantityOnHand: 5 },
      ],
    });
    const [result] = await h.service.dispenseFefo('rx-1', line(8), 'user-1', CLINIC);

    expect(result?.consumedBatches.map(b => [b.lotNumber, b.quantity])).toEqual([
      ['L1', 5],
      ['L2', 3],
    ]);
    expect(h.batches.map(b => b['quantityOnHand'])).toEqual([7, 0]);
    expect(h.medicines[0]?.['stock']).toBe(7);
    expect(h.movements.map(m => m['quantity'])).toEqual([-5, -3]);
    expect(h.movements.every(m => m['recordedById'] === 'user-1')).toBe(true);
  });

  it('never dispenses an expired batch and rejects when only expired stock remains', async () => {
    const h = createInventoryHarness({
      stock: 4,
      batches: [{ id: 'old', lotNumber: 'X', expiryDate: PAST, quantityOnHand: 4 }],
    });
    await expect(h.service.dispenseFefo('rx-1', line(1), 'u', CLINIC)).rejects.toMatchObject({
      code: 'PHARMACY_STOCK_INSUFFICIENT',
    });
  });

  it('takes legacy un-batched stock when no batches exist (inventory screen medicines)', async () => {
    const h = createInventoryHarness({ stock: 20, batches: [] });
    const [result] = await h.service.dispenseFefo('rx-1', line(7), 'u', CLINIC);
    expect(result?.unbatchedQuantity).toBe(7);
    expect(result?.consumedBatches).toEqual([]);
    expect(h.medicines[0]?.['stock']).toBe(13);
  });

  it('rejects insufficient stock without touching stock (cannot go negative)', async () => {
    const h = createInventoryHarness({ stock: 3, batches: [] });
    await expect(h.service.dispenseFefo('rx-1', line(5), 'u', CLINIC)).rejects.toMatchObject({
      code: 'PHARMACY_STOCK_INSUFFICIENT',
    });
    expect(h.medicines[0]?.['stock']).toBe(3);
  });

  it('is clinic scoped: another clinic cannot dispense this medicine', async () => {
    const h = createInventoryHarness({ stock: 10, batches: [], medicineClinic: 'clinic-2' });
    await expect(h.service.dispenseFefo('rx-1', line(1), 'u', CLINIC)).rejects.toThrow(
      /not found/i
    );
    expect(h.medicines[0]?.['stock']).toBe(10);
  });

  it('serialises concurrent dispenses: only one of two competing requests succeeds', async () => {
    const h = createInventoryHarness({
      stock: 10,
      batches: [{ id: 'b', lotNumber: 'L', expiryDate: FUTURE_NEAR, quantityOnHand: 10 }],
    });
    const outcomes = await Promise.allSettled([
      h.service.dispenseFefo('rx-1', line(8), 'u', CLINIC),
      h.service.dispenseFefo('rx-2', line(8), 'u', CLINIC),
    ]);
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
    expect(h.medicines[0]?.['stock']).toBe(2);
    expect(h.batches[0]?.['quantityOnHand']).toBe(2);
  });
});

describe('InventoryService.restoreDispense', () => {
  const restore = (
    h: ReturnType<typeof createInventoryHarness>,
    quantity: number,
    clinic = CLINIC
  ) =>
    h.service.restoreDispense(
      'rx-1',
      [{ medicineId: 'med-1', quantity }],
      'u',
      clinic,
      h.tx as never
    );

  it('restores exactly what was taken, batch by batch, and the medicine total', async () => {
    const h = createInventoryHarness({
      stock: 15,
      batches: [
        { id: 'late', lotNumber: 'L2', expiryDate: FUTURE_FAR, quantityOnHand: 10 },
        { id: 'soon', lotNumber: 'L1', expiryDate: FUTURE_NEAR, quantityOnHand: 5 },
      ],
    });
    await h.service.dispenseFefo('rx-1', line(8), 'u', CLINIC);
    const [restored] = await restore(h, 8);

    expect(restored?.unbatchedQuantity).toBe(0);
    expect(h.batches.map(b => b['quantityOnHand'])).toEqual([10, 5]);
    expect(h.medicines[0]?.['stock']).toBe(15);
  });

  it('does not restore more batch units than the dispense took', async () => {
    const h = createInventoryHarness({
      stock: 15,
      batches: [{ id: 'soon', lotNumber: 'L1', expiryDate: FUTURE_NEAR, quantityOnHand: 15 }],
    });
    await h.service.dispenseFefo('rx-1', line(5), 'u', CLINIC);
    await restore(h, 5);
    await restore(h, 5);
    expect(h.batches[0]?.['quantityOnHand']).toBe(15);
  });

  it('never touches batches of another clinic', async () => {
    const h = createInventoryHarness({
      stock: 10,
      batches: [{ id: 'b', lotNumber: 'L', expiryDate: FUTURE_NEAR, quantityOnHand: 10 }],
    });
    await h.service.dispenseFefo('rx-1', line(4), 'u', CLINIC);
    await restore(h, 4, 'clinic-2').catch(() => undefined);
    expect(h.batches[0]?.['quantityOnHand']).toBe(6);
  });
});

describe('pharmacy_inventory RBAC', () => {
  const check = (role: string, action: string): boolean =>
    (
      RbacService.prototype as unknown as {
        checkRolePermission: (r: string, res: string, a: string) => boolean;
      }
    ).checkRolePermission.call(
      Object.create(RbacService.prototype),
      role,
      'pharmacy_inventory',
      action
    );

  it.each(['PHARMACIST', 'CLINIC_ADMIN'])('%s may read, write and delete', role => {
    expect(check(role, 'read')).toBe(true);
    expect(check(role, 'write')).toBe(true);
    expect(check(role, 'delete')).toBe(true);
  });

  it.each(['PATIENT', 'RECEPTIONIST', 'DOCTOR'])('%s has no pharmacy_inventory access', role => {
    expect(check(role, 'read')).toBe(false);
  });
});
