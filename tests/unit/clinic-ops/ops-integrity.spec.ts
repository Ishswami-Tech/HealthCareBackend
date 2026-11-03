/**
 * Pure clinic-ops guards: clinic scope checks on foreign ids, hand-over hashing, the leave ->
 * holiday link, the direct-dispense duplicate signature and the lab package test list.
 */
import { describe, it, expect, jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  assertLocationsInClinic,
  assertPatientInClinic,
  assertStaffInClinic,
  assertSupplierInClinic,
  patientInClinicWhere,
} from '@services/clinic-ops/services/clinic-scope.util';
import {
  dispenseLinesSignature,
  handoverHashesMatch,
  hashHandoverCode,
  leaveHolidayId,
  resolvePackageTests,
} from '@services/clinic-ops/services/ops-integrity.util';

type Row = Record<string, unknown>;

function fakeClient(found: {
  patient?: Row | null;
  user?: Row | null;
  supplier?: Row | null;
  locations?: Row[];
}) {
  const calls: Record<string, Row> = {};
  const delegate = (name: string, value: unknown) => ({
    findFirst: jest.fn(async (args: Row) => {
      calls[name] = args;
      return value;
    }),
    findMany: jest.fn(async (args: Row) => {
      calls[name] = args;
      return value;
    }),
  });
  return {
    calls,
    client: {
      patient: delegate('patient', found.patient ?? null),
      user: delegate('user', found.user ?? null),
      supplier: delegate('supplier', found.supplier ?? null),
      clinicLocation: delegate('clinicLocation', found.locations ?? []),
    } as never,
  };
}

describe('clinic scope checks', () => {
  it('patient: same predicate as the walk-in path, 404 when outside the clinic', async () => {
    expect(patientInClinicWhere('c1')).toEqual({
      user: { OR: [{ primaryClinicId: 'c1' }, { clinics: { some: { id: 'c1' } } }] },
    });
    const ok = fakeClient({ patient: { id: 'p1' } });
    await expect(assertPatientInClinic(ok.client, 'p1', 'c1')).resolves.toEqual({ id: 'p1' });
    expect((ok.calls['patient'] as { where: Row }).where).toMatchObject({ id: 'p1' });
    const none = fakeClient({ patient: null });
    await expect(assertPatientInClinic(none.client, 'p9', 'c1')).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('locations: every id must be an active location of the clinic', async () => {
    const partial = fakeClient({ locations: [{ id: 'l1' }] });
    await expect(
      assertLocationsInClinic(partial.client, ['l1', 'l2', 'l1'], 'c1')
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((partial.calls['clinicLocation'] as { where: Row }).where).toMatchObject({
      id: { in: ['l1', 'l2'] },
      clinicId: 'c1',
      deletedAt: null,
    });
    const all = fakeClient({ locations: [{ id: 'l1' }, { id: 'l2' }] });
    await expect(assertLocationsInClinic(all.client, ['l1', 'l2'], 'c1')).resolves.toBeUndefined();
    const empty = fakeClient({});
    await expect(assertLocationsInClinic(empty.client, [], 'c1')).resolves.toBeUndefined();
    expect(empty.calls['clinicLocation']).toBeUndefined();
  });

  it('cover staff and suppliers must belong to the clinic', async () => {
    const staff = fakeClient({ user: { id: 'u1' } });
    await expect(assertStaffInClinic(staff.client, 'u1', 'c1')).resolves.toBeUndefined();
    expect((staff.calls['user'] as { where: Row }).where).toMatchObject({
      id: 'u1',
      role: { not: 'PATIENT' },
    });
    await expect(
      assertStaffInClinic(fakeClient({ user: null }).client, 'u9', 'c1')
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      assertSupplierInClinic(fakeClient({ supplier: null }).client, 's9', 'c1')
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('hand-over code hashing', () => {
  it('keys the hash with the server secret and compares in constant time', () => {
    const plain = hashHandoverCode('h1', '123456');
    const keyed = hashHandoverCode('h1', '123456', 'secret');
    expect(keyed).not.toBe(plain);
    expect(keyed).toBe(hashHandoverCode('h1', '123456', 'secret'));
    expect(handoverHashesMatch(keyed, hashHandoverCode('h1', '123456', 'secret'))).toBe(true);
    expect(handoverHashesMatch(keyed, hashHandoverCode('h1', '654321', 'secret'))).toBe(false);
    expect(handoverHashesMatch('short', keyed)).toBe(false);
  });
});

describe('leave -> holiday link', () => {
  it('derives a stable, UUID-shaped id per leave request', () => {
    const id = leaveHolidayId('leave-1');
    expect(id).toBe(leaveHolidayId('leave-1'));
    expect(id).not.toBe(leaveHolidayId('leave-2'));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('direct dispense duplicate signature', () => {
  it('ignores line order and merges repeated medicines', () => {
    expect(
      dispenseLinesSignature([
        { medicineId: 'm2', quantity: 1 },
        { medicineId: 'm1', quantity: 2 },
        { medicineId: 'm2', quantity: 1 },
      ])
    ).toBe(
      dispenseLinesSignature([
        { medicineId: 'm1', quantity: 2 },
        { medicineId: 'm2', quantity: 2 },
      ])
    );
    expect(dispenseLinesSignature([{ medicineId: 'm1', quantity: 1 }])).not.toBe(
      dispenseLinesSignature([{ medicineId: 'm1', quantity: 2 }])
    );
  });
});

describe('lab package tests', () => {
  const pkg = ['CBC', 'HbA1c', 'Lipid profile'];
  it('uses the package list, allows a subset, rejects free-text tests', () => {
    expect(resolvePackageTests(pkg)).toEqual(pkg);
    expect(resolvePackageTests(pkg, [])).toEqual(pkg);
    expect(resolvePackageTests(pkg, ['Lipid profile', 'CBC'])).toEqual(['CBC', 'Lipid profile']);
    expect(() => resolvePackageTests(pkg, ['CBC', 'Whole genome'])).toThrow(BadRequestException);
  });
});
