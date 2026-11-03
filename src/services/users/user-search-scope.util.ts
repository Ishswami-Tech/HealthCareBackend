/**
 * Who may search users through GET /user/search, and what a caller sees by default.
 *
 * - Admins (SUPER_ADMIN, CLINIC_ADMIN, CLINIC_LOCATION_HEAD) keep the original behaviour: any
 *   role, scoped only by the clinic context they pass.
 * - Clinic staff doing a patient lookup (reception, doctors, pharmacy, nursing, billing) are
 *   always scoped to their own clinic and get PATIENT rows unless they ask for roles
 *   explicitly (e.g. a staff picker passing `roles=DOCTOR`).
 */
import { Role } from '@core/types/enums.types';

export const USER_SEARCH_ADMIN_ROLES: readonly Role[] = [
  Role.SUPER_ADMIN,
  Role.CLINIC_ADMIN,
  Role.CLINIC_LOCATION_HEAD,
];

export const USER_SEARCH_STAFF_ROLES: readonly Role[] = [
  Role.RECEPTIONIST,
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.PHARMACIST,
  Role.NURSE,
  Role.FINANCE_BILLING,
];

export const USER_SEARCH_ALLOWED_ROLES: readonly Role[] = [
  ...USER_SEARCH_ADMIN_ROLES,
  ...USER_SEARCH_STAFF_ROLES,
];

const KNOWN_ROLES: ReadonlySet<string> = new Set(Object.values(Role));

export class UserSearchScopeError extends Error {
  constructor(
    message: string,
    readonly kind: 'BAD_REQUEST' | 'FORBIDDEN'
  ) {
    super(message);
    this.name = 'UserSearchScopeError';
  }
}

/** `roles` as sent by clients: absent, "PATIENT", "DOCTOR,NURSE" or a repeated query param. */
export function parseRolesFilter(raw: string | readonly string[] | null | undefined): Role[] {
  const values = (Array.isArray(raw) ? raw : [raw ?? ''])
    .flatMap(value => String(value).split(','))
    .map(value => value.trim().toUpperCase())
    .filter(Boolean);
  const unknown = values.filter(value => !KNOWN_ROLES.has(value));
  if (unknown.length > 0) {
    throw new UserSearchScopeError(`Unknown role filter: ${unknown.join(', ')}`, 'BAD_REQUEST');
  }
  return [...new Set(values)] as Role[];
}

export interface UserSearchScopeInput {
  callerRole: string | null | undefined;
  clinicId: string | null | undefined;
  roles: string | readonly string[] | null | undefined;
}

export interface UserSearchScope {
  clinicId: string | undefined;
  roles: Role[] | undefined;
}

export function resolveUserSearchScope(input: UserSearchScopeInput): UserSearchScope {
  const roles = parseRolesFilter(input.roles);
  const callerRole = String(input.callerRole ?? '').toUpperCase();
  const clinicId = input.clinicId?.trim() || undefined;

  if ((USER_SEARCH_ADMIN_ROLES as readonly string[]).includes(callerRole)) {
    return { clinicId, roles: roles.length > 0 ? roles : undefined };
  }
  if (!(USER_SEARCH_STAFF_ROLES as readonly string[]).includes(callerRole)) {
    throw new UserSearchScopeError('You do not have access to user search', 'FORBIDDEN');
  }
  if (!clinicId) {
    throw new UserSearchScopeError('Select a clinic to search its patients', 'FORBIDDEN');
  }
  return { clinicId, roles: roles.length > 0 ? roles : [Role.PATIENT] };
}
