import { describe, it, expect } from '@jest/globals';
import {
  PrescriptionListSort,
  PrescriptionPharmacyStage,
  PrescriptionStatus,
} from '@dtos/pharmacy.dto';
import {
  buildPrescriptionListWhere,
  buildStatusCondition,
  foldStatusCounts,
  istDayRange,
  istTodayRange,
  pageWindow,
  prescriptionListOrderBy,
  PrescriptionListRangeError,
  stageNeedsPaymentLookup,
} from '@services/pharmacy/services/prescription-list.util';

const PUBLISHED = ['PENDING', 'PARTIAL', 'FILLED', 'CANCELLED'];
const NOTHING = { id: { in: [] } };

describe('buildStatusCondition', () => {
  it('keeps the legacy rule (no drafts) when neither status nor stage is given', () => {
    expect(buildStatusCondition({}, true)).toEqual({ status: { in: PUBLISHED } });
    expect(buildStatusCondition({}, false)).toEqual({ status: { in: PUBLISHED } });
  });

  it('maps ACTIVE to PENDING + PARTIAL and COMPLETED (FILLED) / CANCELLED to themselves', () => {
    expect(buildStatusCondition({ status: 'ACTIVE' }, false)).toEqual({
      status: { in: ['PENDING', 'PARTIAL'] },
    });
    expect(buildStatusCondition({ status: PrescriptionStatus.FILLED }, false)).toEqual({
      status: { in: ['FILLED'] },
    });
    expect(buildStatusCondition({ status: PrescriptionStatus.CANCELLED }, false)).toEqual({
      status: { in: ['CANCELLED'] },
    });
  });

  it('lists DRAFT / RETURNED only for roles that may see drafts', () => {
    expect(buildStatusCondition({ status: PrescriptionStatus.DRAFT }, true)).toEqual({
      status: { in: ['DRAFT'] },
    });
    expect(buildStatusCondition({ status: PrescriptionStatus.RETURNED }, false)).toEqual(NOTHING);
    expect(
      buildStatusCondition({ pharmacyStage: PrescriptionPharmacyStage.NOT_SENT }, true)
    ).toEqual({ status: { in: ['DRAFT', 'RETURNED'] } });
    expect(
      buildStatusCondition({ pharmacyStage: PrescriptionPharmacyStage.NOT_SENT }, false)
    ).toEqual(NOTHING);
  });

  it('DISPENSED stage = FILLED', () => {
    expect(
      buildStatusCondition({ pharmacyStage: PrescriptionPharmacyStage.DISPENSED }, false)
    ).toEqual({ status: { in: ['FILLED'] } });
  });

  it('READY_TO_DISPENSE = PARTIAL or a PENDING prescription whose payments cover the total', () => {
    expect(
      buildStatusCondition({ pharmacyStage: PrescriptionPharmacyStage.READY_TO_DISPENSE }, false, [
        'rx-1',
      ])
    ).toEqual({
      OR: [{ status: 'PARTIAL' }, { status: 'PENDING', id: { in: ['rx-1'] } }],
    });
  });

  it('PAYMENT_PENDING = PENDING minus the ready ones', () => {
    expect(
      buildStatusCondition({ pharmacyStage: PrescriptionPharmacyStage.PAYMENT_PENDING }, false, [
        'rx-1',
      ])
    ).toEqual({ OR: [{ status: 'PENDING', id: { notIn: ['rx-1'] } }] });
    expect(
      buildStatusCondition({ pharmacyStage: PrescriptionPharmacyStage.PAYMENT_PENDING }, false)
    ).toEqual({ status: { in: ['PENDING'] } });
  });

  it('intersects status and stage (contradictions match nothing)', () => {
    expect(
      buildStatusCondition(
        { status: 'ACTIVE', pharmacyStage: PrescriptionPharmacyStage.READY_TO_DISPENSE },
        false,
        []
      )
    ).toEqual({ OR: [{ status: 'PARTIAL' }, { status: 'PENDING', id: { in: [] } }] });
    expect(
      buildStatusCondition(
        {
          status: PrescriptionStatus.CANCELLED,
          pharmacyStage: PrescriptionPharmacyStage.DISPENSED,
        },
        false
      )
    ).toEqual(NOTHING);
  });

  it('only the payment-based stages need the readiness lookup', () => {
    expect(stageNeedsPaymentLookup(PrescriptionPharmacyStage.PAYMENT_PENDING)).toBe(true);
    expect(stageNeedsPaymentLookup(PrescriptionPharmacyStage.READY_TO_DISPENSE)).toBe(true);
    expect(stageNeedsPaymentLookup(PrescriptionPharmacyStage.DISPENSED)).toBe(false);
    expect(stageNeedsPaymentLookup(undefined)).toBe(false);
  });
});

describe('istDayRange', () => {
  it('uses IST midnight boundaries, dateTo inclusive', () => {
    expect(istDayRange('2026-10-21', '2026-10-21')).toEqual({
      from: new Date('2026-10-20T18:30:00.000Z'),
      to: new Date('2026-10-21T18:30:00.000Z'),
    });
    expect(istDayRange(undefined, '2026-10-01')).toEqual({
      to: new Date('2026-10-01T18:30:00.000Z'),
    });
    expect(istDayRange()).toEqual({});
  });

  it('rejects impossible days and reversed ranges', () => {
    expect(() => istDayRange('2026-02-31')).toThrow(PrescriptionListRangeError);
    expect(() => istDayRange('2026-10-22', '2026-10-21')).toThrow(PrescriptionListRangeError);
  });

  it('today is the IST day of now, even just after IST midnight', () => {
    expect(istTodayRange(new Date('2026-10-20T19:00:00.000Z'))).toEqual({
      from: new Date('2026-10-20T18:30:00.000Z'),
      to: new Date('2026-10-21T18:30:00.000Z'),
    });
  });
});

describe('buildPrescriptionListWhere', () => {
  it('scopes to clinic + doctor + patient + IST window and adds the search', () => {
    const where = buildPrescriptionListWhere(
      {
        page: 1,
        limit: 25,
        q: ' para ',
        dateFrom: '2026-10-21',
        dateTo: '2026-10-21',
        patientId: 'p-1',
      },
      { clinicId: 'c-1', doctorId: 'd-1', allowDrafts: true },
      { searchPatientIds: ['p-9'] }
    );
    expect(where).toMatchObject({
      clinicId: 'c-1',
      doctorId: 'd-1',
      patientId: 'p-1',
      date: {
        gte: new Date('2026-10-20T18:30:00.000Z'),
        lt: new Date('2026-10-21T18:30:00.000Z'),
      },
    });
    const and = where['AND'] as Array<Record<string, unknown>>;
    expect(and[0]).toEqual({ status: { in: PUBLISHED } });
    const search = and[1]?.['OR'] as unknown[];
    expect(search).toContainEqual({
      items: { some: { medicine: { name: { contains: 'para', mode: 'insensitive' } } } },
    });
    expect(search).toContainEqual({ patientId: { in: ['p-9'] } });
  });

  it('has no doctor filter for the clinic-wide roles and no search without q', () => {
    const where = buildPrescriptionListWhere(
      { page: 2, limit: 10 },
      { clinicId: 'c-1', allowDrafts: false }
    );
    expect(where).toEqual({ clinicId: 'c-1', AND: [{ status: { in: PUBLISHED } }] });
  });
});

describe('ordering, paging and summary folding', () => {
  it('sorts newest by default with a stable id tie-break', () => {
    expect(prescriptionListOrderBy()).toEqual([{ date: 'desc' }, { id: 'desc' }]);
    expect(prescriptionListOrderBy(PrescriptionListSort.OLDEST)).toEqual([
      { date: 'asc' },
      { id: 'asc' },
    ]);
    expect(prescriptionListOrderBy(PrescriptionListSort.PATIENT)[0]).toEqual({
      patient: { user: { name: 'asc' } },
    });
  });

  it('computes skip / take of a 1-based page', () => {
    expect(pageWindow(1, 25)).toEqual({ skip: 0, take: 25 });
    expect(pageWindow(3, 10)).toEqual({ skip: 20, take: 10 });
    expect(pageWindow(0, 10)).toEqual({ skip: 0, take: 10 });
  });

  it('folds groupBy rows into the summary counters', () => {
    const rows = [
      { status: 'PENDING', _count: { _all: 3 } },
      { status: 'PARTIAL', _count: { _all: 1 } },
      { status: 'FILLED', _count: { _all: 5 } },
      { status: 'CANCELLED', _count: { _all: 2 } },
      { status: 'DRAFT', _count: { _all: 4 } },
      { status: 'RETURNED', _count: { _all: 1 } },
    ];
    expect(foldStatusCounts(rows, true)).toEqual({
      total: 11,
      active: 4,
      completed: 5,
      cancelled: 2,
      drafts: 5,
    });
    expect(foldStatusCounts(rows, false).drafts).toBe(0);
  });
});
