/**
 * Staff location allotment: one place that reads where a staff member works (server side).
 */
import { ForbiddenException } from '@nestjs/common';
import {
  isUsableReceptionistLocation,
  pickStaffLocation,
  readStaffLocation,
  resolveReceptionistLocationOrThrow,
  staffLocationSelect,
} from '@utils/staff-location.util';

function db(
  user: Record<string, unknown> | null,
  activeLocations: Array<{ id: string; name: string }>
) {
  const client = {
    user: { findUnique: jest.fn(async () => user) },
    receptionist: {
      findFirst: jest.fn(
        async () => (user?.['receptionists'] as { locationId: string } | null | undefined) ?? null
      ),
    },
    clinicLocation: { findMany: jest.fn(async () => activeLocations) },
  };
  return {
    client,
    database: { executeHealthcareRead: jest.fn(async (op: (c: unknown) => unknown) => op(client)) },
  };
}

describe('staff location util', () => {
  it('selects every staff profile link and the doctor clinic link in one query', () => {
    const select = staffLocationSelect('clinic-1');
    for (const key of [
      'receptionists',
      'clinicAdmins',
      'pharmacist',
      'nurse',
      'locationHead',
      'doctor',
    ]) {
      expect(select).toHaveProperty(key);
    }
    expect(JSON.stringify(select['doctor'])).toContain('clinic-1');
  });

  it('picks the location of the row for the role', () => {
    const row = {
      receptionists: { locationId: 'loc-a', location: { name: 'Kothrud' } },
      pharmacist: null,
      doctor: { clinics: [{ locationId: 'loc-b', location: { name: 'Baner' } }] },
    };
    expect(pickStaffLocation(row, 'RECEPTIONIST')).toEqual({
      locationId: 'loc-a',
      locationName: 'Kothrud',
    });
    expect(pickStaffLocation(row, 'assistant_doctor')).toEqual({
      locationId: 'loc-b',
      locationName: 'Baner',
    });
    expect(pickStaffLocation(row, 'PHARMACIST')).toEqual({ locationId: null, locationName: null });
    expect(pickStaffLocation(row, 'PATIENT')).toEqual({ locationId: null, locationName: null });
  });

  it('never queries for a patient', async () => {
    const w = db(null, []);
    expect(await readStaffLocation(w.database as never, 'u1', 'PATIENT')).toEqual({
      locationId: null,
      locationName: null,
    });
    expect(w.client.user.findUnique).not.toHaveBeenCalled();
  });

  it('receptionist: the allotted location', async () => {
    const w = db(
      {
        receptionists: {
          locationId: 'loc-a',
          location: { name: 'K', clinicId: 'c1', isActive: true, deletedAt: null },
        },
      },
      []
    );
    await expect(resolveReceptionistLocationOrThrow(w.database as never, 'r1', 'c1')).resolves.toBe(
      'loc-a'
    );
  });

  it('receptionist allotted to a location of ANOTHER clinic: single-active-location fallback', async () => {
    const elsewhere = {
      receptionists: {
        locationId: 'loc-other',
        location: { clinicId: 'c2', isActive: true, deletedAt: null },
      },
    };
    const single = db(elsewhere, [{ id: 'only', name: 'Main' }]);
    await expect(
      resolveReceptionistLocationOrThrow(single.database as never, 'r1', 'c1')
    ).resolves.toBe('only');
    const many = db(elsewhere, [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]);
    await expect(
      resolveReceptionistLocationOrThrow(many.database as never, 'r1', 'c1')
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('an inactive or deleted allotted location is not used', () => {
    const base = { locationId: 'loc-a' };
    expect(
      isUsableReceptionistLocation(
        { ...base, location: { clinicId: 'c1', isActive: false, deletedAt: null } },
        'c1'
      )
    ).toBe(false);
    expect(
      isUsableReceptionistLocation(
        { ...base, location: { clinicId: 'c1', isActive: true, deletedAt: new Date() } },
        'c1'
      )
    ).toBe(false);
    expect(isUsableReceptionistLocation({ ...base, location: null }, 'c1')).toBe(false);
    expect(
      isUsableReceptionistLocation(
        { ...base, location: { clinicId: 'c1', isActive: true, deletedAt: null } },
        'c1'
      )
    ).toBe(true);
  });

  it('unallotted receptionist: only accepted when the clinic has one active location', async () => {
    const single = db({ receptionists: null }, [{ id: 'only', name: 'Main' }]);
    await expect(
      resolveReceptionistLocationOrThrow(single.database as never, 'r1', 'c1')
    ).resolves.toBe('only');
    const many = db({ receptionists: null }, [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]);
    await expect(
      resolveReceptionistLocationOrThrow(many.database as never, 'r1', 'c1')
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
