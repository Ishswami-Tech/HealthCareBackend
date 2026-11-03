/// <reference types="jest" />
import {
  parseRolesFilter,
  resolveUserSearchScope,
  UserSearchScopeError,
} from '@services/users/user-search-scope.util';

describe('user-search-scope.util', () => {
  it('parses single, comma-separated and repeated role filters', () => {
    expect(parseRolesFilter(undefined)).toEqual([]);
    expect(parseRolesFilter('patient')).toEqual(['PATIENT']);
    expect(parseRolesFilter('DOCTOR, NURSE')).toEqual(['DOCTOR', 'NURSE']);
    expect(parseRolesFilter(['DOCTOR', 'DOCTOR,RECEPTIONIST'])).toEqual(['DOCTOR', 'RECEPTIONIST']);
  });

  it('rejects unknown roles', () => {
    expect(() => parseRolesFilter('WIZARD')).toThrow(UserSearchScopeError);
  });

  it('keeps admin behaviour (any role, optional clinic)', () => {
    expect(
      resolveUserSearchScope({ callerRole: 'SUPER_ADMIN', clinicId: undefined, roles: undefined })
    ).toEqual({
      clinicId: undefined,
      roles: undefined,
    });
    expect(
      resolveUserSearchScope({ callerRole: 'CLINIC_ADMIN', clinicId: 'c1', roles: 'DOCTOR' })
    ).toEqual({ clinicId: 'c1', roles: ['DOCTOR'] });
  });

  it.each(['RECEPTIONIST', 'DOCTOR', 'ASSISTANT_DOCTOR', 'PHARMACIST'])(
    '%s defaults to PATIENT results of their clinic',
    role => {
      expect(
        resolveUserSearchScope({ callerRole: role, clinicId: 'c1', roles: undefined })
      ).toEqual({
        clinicId: 'c1',
        roles: ['PATIENT'],
      });
    }
  );

  it('lets staff search staff only when roles are passed explicitly', () => {
    expect(
      resolveUserSearchScope({ callerRole: 'RECEPTIONIST', clinicId: 'c1', roles: 'DOCTOR' })
    ).toEqual({ clinicId: 'c1', roles: ['DOCTOR'] });
  });

  it('refuses staff without a clinic and roles outside the list', () => {
    expect(() =>
      resolveUserSearchScope({ callerRole: 'DOCTOR', clinicId: '', roles: undefined })
    ).toThrow(UserSearchScopeError);
    expect(() =>
      resolveUserSearchScope({ callerRole: 'PATIENT', clinicId: 'c1', roles: undefined })
    ).toThrow(UserSearchScopeError);
  });
});
