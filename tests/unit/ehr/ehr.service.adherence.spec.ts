/// <reference types="jest" />
/**
 * GET /ehr/analytics/medication-adherence (percentage + dose log) and
 * POST /ehr/medications/:id/doses (patient marks a dose taken).
 *
 * The database is a small stateful fake (medications + dose-log rows) so the tests fail
 * if the service stops reading the logged doses, stops enforcing ownership or the date
 * window, or stops being idempotent per dose slot.
 */

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EHRService } from '@services/ehr/ehr.service';
import { formatDateKeyInIST } from '@utils/date-time.util';

jest.mock('@infrastructure/database', () => ({ DatabaseService: class DatabaseService {} }));
jest.mock('@infrastructure/database/database.service', () => ({
  DatabaseService: class DatabaseService {},
}));
jest.mock('@infrastructure/database/query', () => ({
  addDateRangeFilter: jest.fn(),
  addStringFilter: jest.fn(),
  USER_SELECT_FIELDS: {},
}));
jest.mock('@infrastructure/storage/static-asset.service', () => ({
  AssetType: { MEDICAL_RECORD: 'medical-records', DOCUMENT: 'documents' },
  StaticAssetService: class StaticAssetService {},
}));
jest.mock('@infrastructure/cache/cache.service', () => ({ CacheService: class CacheService {} }));
jest.mock('@infrastructure/logging', () => ({ LoggingService: class LoggingService {} }));
jest.mock('@infrastructure/events/event.service', () => ({
  EventService: class EventService {},
}));
jest.mock('@queue/src/queue.service', () => ({ QueueService: class QueueService {} }));

const CLINIC = 'clinic-1';

function dayKey(offsetDays: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return formatDateKeyInIST(date);
}

interface MedRow {
  id: string;
  userId: string;
  clinicId: string | null;
  name: string;
  frequency: string;
  startDate: Date;
  endDate: Date | null;
  isActive: boolean;
}

interface DoseRow {
  medicationId: string;
  userId: string;
  doseDate: Date;
  doseIndex: number;
  takenAt: Date;
}

function createHarness(medications: MedRow[], doseRows: DoseRow[] = []) {
  const doses = [...doseRows];
  const client = {
    medication: {
      findMany: jest.fn(async ({ where }: { where: { userId: string; clinicId?: string } }) =>
        medications.filter(m => m.userId === where.userId)
      ),
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          medications.find(m => m.id === where.id) ?? null
      ),
    },
    medicationDoseLog: {
      findMany: jest.fn(async ({ where }: { where: { userId: string } }) =>
        doses.filter(d => d.userId === where.userId)
      ),
      upsert: jest.fn(
        async ({
          where,
          create,
        }: {
          where: { medicationId_doseDate_doseIndex: Omit<DoseRow, 'userId' | 'takenAt'> };
          create: Omit<DoseRow, 'takenAt'>;
        }) => {
          const key = where.medicationId_doseDate_doseIndex;
          const existing = doses.find(
            d =>
              d.medicationId === key.medicationId &&
              d.doseDate.getTime() === key.doseDate.getTime() &&
              d.doseIndex === key.doseIndex
          );
          if (!existing) doses.push({ ...create, takenAt: new Date() });
        }
      ),
      deleteMany: jest.fn(async ({ where }: { where: Omit<DoseRow, 'userId' | 'takenAt'> }) => {
        const keep = doses.filter(
          d =>
            !(
              d.medicationId === where.medicationId &&
              d.doseDate.getTime() === where.doseDate.getTime() &&
              d.doseIndex === where.doseIndex
            )
        );
        doses.length = 0;
        doses.push(...keep);
      }),
    },
    familyMember: { findMany: jest.fn().mockResolvedValue([]) },
    patient: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const databaseService = {
    executeHealthcareRead: jest.fn(async (op: (c: unknown) => Promise<unknown>) => op(client)),
    executeHealthcareWrite: jest.fn(async (op: (c: unknown) => Promise<unknown>) => op(client)),
  };
  const cacheService = {
    invalidateCacheByTag: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  };
  const service = new EHRService(
    databaseService as never,
    cacheService as never,
    { log: jest.fn().mockResolvedValue(undefined) } as never,
    {} as never,
    {
      emit: jest.fn().mockResolvedValue(undefined),
      emitAsync: jest.fn(),
      emitEnterprise: jest.fn(),
      on: jest.fn(),
      onAny: jest.fn(),
    },
    undefined
  );
  return { service, client, doses, databaseService };
}

function medication(over: Partial<MedRow> = {}): MedRow {
  return {
    id: 'med-1',
    userId: 'user-1',
    clinicId: CLINIC,
    name: 'Ashwagandha',
    frequency: '1-0-1',
    startDate: new Date(`${dayKey(-20)}T00:00:00Z`),
    endDate: null,
    isActive: true,
    ...over,
  };
}

describe('EHRService.getMedicationAdherence', () => {
  it('keeps the old fields and adds the percentage + a dose log for the last 7 days', async () => {
    const yesterday = dayKey(-1);
    const h = createHarness(
      [medication()],
      [
        {
          medicationId: 'med-1',
          userId: 'user-1',
          doseDate: new Date(`${yesterday}T00:00:00Z`),
          doseIndex: 0,
          takenAt: new Date(),
        },
      ]
    );

    const result = await h.service.getMedicationAdherence('user-1', CLINIC);

    expect(result.totalActive).toBe(1);
    expect(result.medications).toHaveLength(1);
    expect(result.range).toEqual({ startDate: dayKey(-6), endDate: dayKey(0) });
    // 7 days x 2 doses; 6 past days are due (12 doses), 1 taken, today is pending
    expect(result.scheduledDoses).toBe(14);
    expect(result.takenDoses).toBe(1);
    expect(result.missedDoses).toBe(11);
    expect(result.adherencePercentage).toBe(8);
    expect(result.doseLog).toHaveLength(14);
    expect(result.doseLog.find(d => d.date === yesterday && d.doseIndex === 0)).toMatchObject({
      status: 'TAKEN',
      medicationId: 'med-1',
      label: 'Dose 1 of 2',
    });
    expect(
      result.doseLog.filter(d => d.date === dayKey(0)).every(d => d.status === 'PENDING')
    ).toBe(true);
  });

  it('reads only the requested patient and clinic', async () => {
    const h = createHarness([medication(), medication({ id: 'med-other', userId: 'user-2' })]);

    const result = await h.service.getMedicationAdherence('user-1', CLINIC);

    expect(result.doseLog.every(d => d.medicationId === 'med-1')).toBe(true);
    const call = h.client.medication.findMany.mock.calls[0]?.[0];
    expect(call?.where.clinicId).toBe(CLINIC);
  });

  it('honours an explicit range and rejects a reversed or over-long one with 400', async () => {
    const h = createHarness([medication()]);

    const result = await h.service.getMedicationAdherence('user-1', CLINIC, {
      startDate: dayKey(-2),
      endDate: dayKey(-1),
    });
    expect(result.range).toEqual({ startDate: dayKey(-2), endDate: dayKey(-1) });
    expect(result.doseLog).toHaveLength(4);

    await expect(
      h.service.getMedicationAdherence('user-1', CLINIC, {
        startDate: dayKey(-1),
        endDate: dayKey(-3),
      })
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      h.service.getMedicationAdherence('user-1', CLINIC, {
        startDate: dayKey(-200),
        endDate: dayKey(0),
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns a null percentage and an empty log for a patient without medications', async () => {
    const h = createHarness([]);

    const result = await h.service.getMedicationAdherence('user-1', CLINIC);

    expect(result).toMatchObject({
      totalActive: 0,
      adherencePercentage: null,
      scheduledDoses: 0,
      doseLog: [],
    });
  });

  it('stops scheduling a switched-off medicine after its end date', async () => {
    const h = createHarness([
      medication({ isActive: false, endDate: new Date(`${dayKey(-4)}T00:00:00Z`) }),
    ]);

    const result = await h.service.getMedicationAdherence('user-1', CLINIC);

    expect(result.totalActive).toBe(0);
    expect(Math.max(...result.doseLog.map(d => Number(d.date.replaceAll('-', ''))))).toBe(
      Number(dayKey(-4).replaceAll('-', ''))
    );
  });
});

describe('EHRService.markMedicationDose', () => {
  const patient = { userId: 'user-1', role: 'PATIENT' } as const;

  it('stores the dose once and is idempotent for the same slot', async () => {
    const h = createHarness([medication()]);
    const yesterday = dayKey(-1);

    const first = await h.service.markMedicationDose(
      'med-1',
      { date: yesterday, doseIndex: 0 },
      patient,
      CLINIC
    );
    await h.service.markMedicationDose('med-1', { date: yesterday, doseIndex: 0 }, patient, CLINIC);

    expect(first).toEqual({ medicationId: 'med-1', date: yesterday, doseIndex: 0, taken: true });
    expect(h.doses).toHaveLength(1);
    expect(h.doses[0]).toMatchObject({ medicationId: 'med-1', userId: 'user-1', doseIndex: 0 });
  });

  it('defaults to today and can undo a mark with taken=false', async () => {
    const h = createHarness([medication()]);

    const marked = await h.service.markMedicationDose('med-1', { doseIndex: 1 }, patient, CLINIC);
    expect(marked.date).toBe(dayKey(0));
    expect(h.doses).toHaveLength(1);

    await h.service.markMedicationDose('med-1', { doseIndex: 1, taken: false }, patient, CLINIC);
    expect(h.doses).toHaveLength(0);
  });

  it('is a 403 for another patient medication and writes nothing', async () => {
    const h = createHarness([medication({ userId: 'user-2' })]);

    await expect(
      h.service.markMedicationDose('med-1', { doseIndex: 0 }, patient, CLINIC)
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.doses).toHaveLength(0);
    expect(h.databaseService.executeHealthcareWrite).not.toHaveBeenCalled();
  });

  it('is a 404 for an unknown medication and for one of another clinic', async () => {
    const h = createHarness([medication({ clinicId: 'clinic-2' })]);

    await expect(
      h.service.markMedicationDose('nope', { doseIndex: 0 }, patient, CLINIC)
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      h.service.markMedicationDose('med-1', { doseIndex: 0 }, patient, CLINIC)
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    ['a future day', () => ({ date: dayKey(2), doseIndex: 0 })],
    ['a day older than 14 days', () => ({ date: dayKey(-16), doseIndex: 0 })],
    ['a dose slot the frequency does not have', () => ({ doseIndex: 2 })],
  ])('rejects %s with 400', async (_label, dto) => {
    const h = createHarness([medication()]);

    await expect(
      h.service.markMedicationDose('med-1', dto(), patient, CLINIC)
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.doses).toHaveLength(0);
  });

  it('rejects a day before the medication started or after it ended', async () => {
    const h = createHarness([
      medication({
        startDate: new Date(`${dayKey(-3)}T00:00:00Z`),
        endDate: new Date(`${dayKey(-1)}T00:00:00Z`),
      }),
    ]);

    await expect(
      h.service.markMedicationDose('med-1', { date: dayKey(-5), doseIndex: 0 }, patient, CLINIC)
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      h.service.markMedicationDose('med-1', { doseIndex: 0 }, patient, CLINIC)
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
