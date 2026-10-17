/// <reference types="jest" />
/**
 * GET /pharmacy/inventory filters + pagination and GET /pharmacy/inventory/low-stock: the
 * filtering happens in the database (one Prisma query, low stock through a field reference).
 */

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { HealthcareError } from '@core/errors';
import { PharmacyService } from '@services/pharmacy/services/pharmacy.service';
import {
  INVENTORY_DEFAULT_PAGE_SIZE,
  INVENTORY_MAX_PAGE_SIZE,
  InventoryQueryDto,
  LOW_STOCK_DEFAULT_LIMIT,
  LOW_STOCK_MAX_LIMIT,
  LowStockQueryDto,
  toInventoryFilters,
} from '@dtos/pharmacy.dto';

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
const MIN_STOCK_REF = { modelName: 'Medicine', name: 'minStockThreshold', typeName: 'Int' };

type Row = Record<string, unknown>;
type Args = { where: Row; orderBy?: unknown; skip?: number; take?: number };

function createHarness(withFieldRefs = true) {
  const rows: Row[] = [{ id: 'med-1', name: 'Ashwagandha Churna', stock: 2 }];
  const medicine = {
    findMany: jest.fn().mockResolvedValue(rows),
    count: jest.fn().mockResolvedValue(42),
    ...(withFieldRefs ? { fields: { minStockThreshold: MIN_STOCK_REF } } : {}),
  };
  const client = { medicine };
  const databaseService = {
    executeHealthcareRead: jest.fn(async (op: (c: unknown) => Promise<unknown>) => op(client)),
    executeHealthcareWrite: jest.fn(async (op: (c: unknown) => Promise<unknown>) => op(client)),
  };
  const service = new PharmacyService(
    databaseService as never,
    {} as never,
    { emit: jest.fn() } as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    {} as never,
    {} as never,
    {} as never,
    { get: jest.fn() } as never,
    { invalidateCacheByTag: jest.fn(), del: jest.fn() } as never
  );
  const findManyArgs = (): Args => medicine.findMany.mock.calls[0]![0] as Args;
  const countArgs = (): Args => medicine.count.mock.calls[0]![0] as Args;
  return { service, medicine, rows, findManyArgs, countArgs };
}

describe('InventoryQueryDto', () => {
  const parse = (query: Record<string, unknown>) => plainToInstance(InventoryQueryDto, query);
  const errorsOf = async (query: Record<string, unknown>) =>
    (await validate(parse(query))).map(e => e.property).sort();

  it('accepts the documented params, converting numbers and normalising tokens', async () => {
    const dto = parse({
      search: '  ashwa ',
      category: 'churna',
      type: 'classical',
      inStock: 'true',
      lowStock: 'false',
      expiringSoon: 'true',
      expiringDays: '30',
      page: '2',
      limit: '20',
    });
    expect(await validate(dto)).toEqual([]);
    expect(dto).toMatchObject({
      search: 'ashwa',
      category: 'CHURNA',
      type: 'CLASSICAL',
      inStock: 'true',
      expiringDays: 30,
      page: 2,
      limit: 20,
    });
    expect(await errorsOf({})).toEqual([]);
    expect(await errorsOf({ limit: '100' })).toEqual([]);
  });

  it('keeps the legacy offset param accepted (ignored) so older web builds are not rejected', async () => {
    expect(await errorsOf({ limit: '100', offset: '0' })).toEqual([]);
    expect(toInventoryFilters(parse({ limit: '100', offset: '50' }))).toEqual({});
  });

  it('rejects out-of-range pagination, unknown tokens and non-boolean flags', async () => {
    expect(await errorsOf({ page: '0' })).toEqual(['page']);
    expect(await errorsOf({ limit: String(INVENTORY_MAX_PAGE_SIZE + 1) })).toEqual(['limit']);
    expect(await errorsOf({ limit: '0' })).toEqual(['limit']);
    expect(await errorsOf({ inStock: 'yes' })).toEqual(['inStock']);
    expect(await errorsOf({ type: 'TABLET' })).toEqual(['type']);
    expect(await errorsOf({ category: 'BOGUS' })).toEqual(['category']);
    expect(await errorsOf({ expiringDays: '0' })).toEqual(['expiringDays']);
    expect(await errorsOf({ search: 'x'.repeat(121) })).toEqual(['search']);
  });

  it('low-stock limit is bounded', async () => {
    const ok = plainToInstance(LowStockQueryDto, { limit: '250' });
    expect(await validate(ok)).toEqual([]);
    expect(ok.limit).toBe(250);
    const tooBig = plainToInstance(LowStockQueryDto, { limit: String(LOW_STOCK_MAX_LIMIT + 1) });
    expect((await validate(tooBig)).map(e => e.property)).toEqual(['limit']);
  });
});

describe('toInventoryFilters', () => {
  it('turns the string flags into booleans and drops what was not sent', () => {
    expect(
      toInventoryFilters(
        plainToInstance(InventoryQueryDto, {
          search: 'para',
          category: 'TABLET',
          type: 'PROPRIETARY',
          inStock: 'true',
          lowStock: 'true',
          expiringSoon: 'true',
          expiringDays: '45',
        })
      )
    ).toEqual({
      search: 'para',
      category: 'TABLET',
      type: 'PROPRIETARY',
      inStock: true,
      lowStock: true,
      expiringSoon: true,
      expiringDays: 45,
    });
    expect(
      toInventoryFilters(plainToInstance(InventoryQueryDto, { inStock: 'false', search: '  ' }))
    ).toEqual({});
  });
});

describe('PharmacyService.findAllMedicines (legacy bare array)', () => {
  it('returns every matching row, filtered and ordered in the database', async () => {
    const h = createHarness();
    const before = Date.now();
    const result = await h.service.findAllMedicines(CLINIC, {
      search: 'ashwa',
      category: 'CHURNA',
      type: 'CLASSICAL',
      inStock: true,
      lowStock: true,
      expiringSoon: true,
      expiringDays: 30,
    });

    expect(result).toBe(h.rows);
    const args = h.findManyArgs();
    expect(args.skip).toBeUndefined();
    expect(args.take).toBeUndefined();
    expect(args.orderBy).toEqual({ name: 'asc' });
    const contains = { contains: 'ashwa', mode: 'insensitive' };
    expect(args.where).toMatchObject({
      isActive: true,
      clinicId: CLINIC,
      OR: [{ name: contains }, { manufacturer: contains }, { category: contains }],
      category: 'CHURNA',
      type: 'CLASSICAL',
      stock: { gt: 0, lte: MIN_STOCK_REF },
    });
    const expiry = args.where['expiryDate'] as { not: null; lte: Date };
    expect(expiry.not).toBeNull();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(expiry.lte.getTime()).toBeGreaterThanOrEqual(before + thirtyDays);
    expect(expiry.lte.getTime()).toBeLessThanOrEqual(Date.now() + thirtyDays);
    expect(h.medicine.count).not.toHaveBeenCalled();
  });

  it('without filters only scopes to the clinic and active rows', async () => {
    const h = createHarness();
    await h.service.findAllMedicines(CLINIC);
    expect(h.findManyArgs().where).toEqual({ isActive: true, clinicId: CLINIC });
    const noClinic = createHarness();
    await noClinic.service.findAllMedicines(undefined, { expiringSoon: true });
    const where = noClinic.findManyArgs().where;
    expect(where['clinicId']).toBeUndefined();
    expect((where['expiryDate'] as { lte: Date }).lte.getTime()).toBeGreaterThan(
      Date.now() + 89 * 24 * 60 * 60 * 1000
    );
  });

  it('fails loudly instead of silently returning everything when field references are missing', async () => {
    const h = createHarness(false);
    await expect(h.service.findAllMedicines(CLINIC, { lowStock: true })).rejects.toBeInstanceOf(
      HealthcareError
    );
    expect(h.medicine.findMany).not.toHaveBeenCalled();
  });
});

describe('PharmacyService.findInventoryPage', () => {
  it('returns one page plus the total of the same where clause', async () => {
    const h = createHarness();
    const page = await h.service.findInventoryPage(CLINIC, { search: 'para' }, 3, 20);
    expect(page).toEqual({ data: h.rows, total: 42, page: 3, limit: 20 });
    const args = h.findManyArgs();
    expect(args).toMatchObject({ skip: 40, take: 20, orderBy: { name: 'asc' } });
    expect(h.countArgs().where).toEqual(args.where);
    expect(args.where).toMatchObject({ isActive: true, clinicId: CLINIC });
  });

  it('clamps the page size to the maximum and the page to at least 1', async () => {
    const h = createHarness();
    const page = await h.service.findInventoryPage(CLINIC, undefined, 0, 9999);
    expect(page).toMatchObject({ page: 1, limit: INVENTORY_MAX_PAGE_SIZE });
    expect(h.findManyArgs()).toMatchObject({ skip: 0, take: INVENTORY_MAX_PAGE_SIZE });
    expect(INVENTORY_DEFAULT_PAGE_SIZE).toBe(50);
  });
});

describe('PharmacyService.findLowStock', () => {
  it('is one query: stock <= minStockThreshold via a field reference, lowest stock first', async () => {
    const h = createHarness();
    const result = await h.service.findLowStock(CLINIC);
    expect(result).toBe(h.rows);
    expect(h.medicine.findMany).toHaveBeenCalledTimes(1);
    expect(h.findManyArgs()).toEqual({
      where: { isActive: true, clinicId: CLINIC, stock: { lte: MIN_STOCK_REF } },
      orderBy: [{ stock: 'asc' }, { name: 'asc' }],
      take: LOW_STOCK_DEFAULT_LIMIT,
    });
  });

  it('honours and caps the limit', async () => {
    const h = createHarness();
    await h.service.findLowStock(CLINIC, 25);
    expect(h.findManyArgs().take).toBe(25);
    const capped = createHarness();
    await capped.service.findLowStock(CLINIC, LOW_STOCK_MAX_LIMIT + 1);
    expect(capped.findManyArgs().take).toBe(LOW_STOCK_MAX_LIMIT);
  });
});
