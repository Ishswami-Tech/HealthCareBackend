import type { UserWithRelations } from './user.types';
import type { Role } from './enums.types';

/**
 * ActiveUser represents a user currently authenticated in the system.
 * It contains essential identity information and permissions context.
 * This decoupled type allows services to rely on a standard user object
 * without coupling to specific database or auth implementation details.
 */
export interface ActiveUser {
  id: string;
  email: string;
  role: Role;
  permissions: string[];
  clinicId?: string; // Current context clinic ID
  clinicIds: string[]; // All clinics the user has access to

  // Optional relations that might be populated based on context
  doctor?: UserWithRelations['doctor'];
  patient?: UserWithRelations['patient'];

  // Session metadata
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Factory function to create an ActiveUser from a UserWithRelations and context
 */
export const createActiveUser = (
  user: UserWithRelations,
  clinicId?: string,
  permissions: string[] = []
): ActiveUser => {
  const resolvedClinicId = clinicId || user.primaryClinicId;
  return {
    id: user.id,
    email: user.email,
    role: user.role as Role,
    permissions,
    ...(resolvedClinicId ? { clinicId: resolvedClinicId } : {}),
    clinicIds: user.clinicAdmins?.map(ca => ca.clinicId) || [],
    doctor: user.doctor,
    patient: user.patient,
  };
};
