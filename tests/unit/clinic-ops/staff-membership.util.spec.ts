/**
 * Staff directory membership: staff linked through any clinic link are listed, once each.
 */
import { describe, it, expect } from '@jest/globals';
import {
  dedupeByUserId,
  phoneLookupVariants,
  staffDirectoryWhere,
  staffMembershipWhere,
} from '@services/clinic-ops/services/staff-membership.util';

const CLINIC = 'clinic-1';
const ROLES = ['DOCTOR', 'ASSISTANT_DOCTOR', 'PHARMACIST'];

describe('staffMembershipWhere', () => {
  const or = (staffMembershipWhere(CLINIC)['OR'] ?? []) as Array<Record<string, unknown>>;
  const keys = or.map(condition => Object.keys(condition)[0]);

  it('matches the join table, primary clinic and every role table', () => {
    expect(keys).toEqual(
      expect.arrayContaining([
        'clinics',
        'primaryClinicId',
        'doctor',
        'receptionists',
        'pharmacist',
        'clinicAdmins',
        'nurse',
        'therapist',
        'userRoles',
      ])
    );
  });

  it('links doctors through DoctorClinic and assistants through active coverage', () => {
    expect(or).toContainEqual({ doctor: { is: { clinics: { some: { clinicId: CLINIC } } } } });
    expect(or).toContainEqual({
      doctor: {
        is: { assistantCoverageAssignments: { some: { clinicId: CLINIC, isActive: true } } },
      },
    });
  });

  it('links pharmacists by their clinicId and RBAC roles only when active', () => {
    expect(or).toContainEqual({ pharmacist: { is: { clinicId: CLINIC } } });
    expect(or).toContainEqual({ userRoles: { some: { clinicId: CLINIC, isActive: true } } });
  });

  it('scopes every condition to the clinic', () => {
    expect(JSON.stringify(or).includes('other-clinic')).toBe(false);
    expect(JSON.stringify(staffMembershipWhere('other-clinic')).includes(CLINIC)).toBe(false);
  });
});

describe('staffDirectoryWhere', () => {
  it('ANDs membership with the role list so the OR never widens the role filter', () => {
    const where = staffDirectoryWhere(CLINIC, ROLES) as { AND: Array<Record<string, unknown>> };
    expect(where.AND).toHaveLength(2);
    expect(where.AND[0]).toEqual(staffMembershipWhere(CLINIC));
    expect(where.AND[1]).toEqual({ role: { in: ROLES } });
  });

  it('narrows to one role and a name search', () => {
    const where = staffDirectoryWhere(CLINIC, ROLES, { role: 'pharmacist', q: '  ram ' }) as {
      AND: Array<Record<string, unknown>>;
    };
    expect(where.AND).toContainEqual({ role: 'PHARMACIST' });
    expect(where.AND).toContainEqual({ name: { contains: 'ram', mode: 'insensitive' } });
  });
});

describe('dedupeByUserId', () => {
  it('keeps the first row of each user, in order', () => {
    const rows = [
      { id: 'u1', name: 'Doctor' },
      { id: 'u2', name: 'Pharmacist' },
      { id: 'u1', name: 'Doctor again' },
    ];
    expect(dedupeByUserId(rows)).toEqual([
      { id: 'u1', name: 'Doctor' },
      { id: 'u2', name: 'Pharmacist' },
    ]);
  });

  it('does not change the input', () => {
    const rows = [{ id: 'a' }, { id: 'a' }];
    dedupeByUserId(rows);
    expect(rows).toHaveLength(2);
  });
});

describe('phoneLookupVariants', () => {
  it('finds +91 / 91 / bare 10-digit spellings of one number', () => {
    expect(phoneLookupVariants('9003000001')).toEqual(
      expect.arrayContaining(['9003000001', '919003000001', '+919003000001'])
    );
    expect(phoneLookupVariants('+919003000001')).toEqual(
      expect.arrayContaining(['+919003000001', '919003000001', '9003000001'])
    );
  });

  it('returns nothing for a value without digits', () => {
    expect(phoneLookupVariants('  ')).toEqual([]);
  });
});
