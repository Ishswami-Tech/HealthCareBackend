/**
 * Type definitions for Prisma operations in RBAC module
 * @fileoverview Provides proper TypeScript types for Prisma database operations
 * to ensure type safety without relying on `any` types
 */

/**
 * Permission model type from Prisma
 */
export interface PrismaPermission {
  readonly id: string;
  readonly name: string;
  readonly resource: string;
  readonly action: string;
  readonly description: string | null;
  readonly domain: string;
  readonly isSystemPermission: boolean;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Role model type from Prisma
 */
export interface PrismaRole {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly domain: string;
  readonly clinicId: string | null;
  readonly isSystemRole: boolean;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * UserRole model type from Prisma
 */
export interface PrismaUserRole {
  readonly id: string;
  readonly userId: string;
  readonly roleId: string;
  readonly clinicId: string | null;
  readonly assignedBy: string;
  readonly assignedAt: Date;
  readonly expiresAt: Date | null;
  readonly isActive: boolean;
  readonly revokedAt: Date | null;
  readonly revokedBy: string | null;
}

/**
 * RolePermission model type from Prisma
 */
export interface PrismaRolePermission {
  readonly id: string;
  readonly roleId: string;
  readonly permissionId: string;
  readonly isActive: boolean;
  readonly assignedAt: Date;
}

/**
 * Appointment model type from Prisma (for ownership checks)
 */
export interface PrismaAppointment {
  readonly id: string;
  readonly patientId: string;
  readonly doctorId: string;
  readonly clinicId: string | null;
}

/**
 * Role with permissions included
 */
export interface PrismaRoleWithPermissions extends PrismaRole {
  readonly permissions: Array<{
    readonly permission: PrismaPermission;
  }>;
}

/**
 * UserRole with role included
 */
export interface PrismaUserRoleWithRole extends PrismaUserRole {
  readonly role: {
    readonly name: string;
  };
}

/**
 * RolePermission with permission included
 */
export interface PrismaRolePermissionWithPermission
  extends PrismaRolePermission {
  readonly permission: {
    readonly resource: string;
    readonly action: string;
  };
}

/**
 * Type guard to check if a value is a PrismaPermission
 */
export function isPrismaPermission(value: unknown): value is PrismaPermission {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PrismaPermission).id === "string" &&
    typeof (value as PrismaPermission).name === "string" &&
    typeof (value as PrismaPermission).resource === "string" &&
    typeof (value as PrismaPermission).action === "string"
  );
}

/**
 * Type guard to check if a value is a PrismaRole
 */
export function isPrismaRole(value: unknown): value is PrismaRole {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PrismaRole).id === "string" &&
    typeof (value as PrismaRole).name === "string" &&
    typeof (value as PrismaRole).displayName === "string"
  );
}

/**
 * Type guard to check if a value is a PrismaUserRole
 */
export function isPrismaUserRole(value: unknown): value is PrismaUserRole {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PrismaUserRole).id === "string" &&
    typeof (value as PrismaUserRole).userId === "string" &&
    typeof (value as PrismaUserRole).roleId === "string"
  );
}

/**
 * Type guard to check if a value is a PrismaAppointment
 */
export function isPrismaAppointment(
  value: unknown,
): value is PrismaAppointment {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PrismaAppointment).id === "string" &&
    typeof (value as PrismaAppointment).patientId === "string" &&
    typeof (value as PrismaAppointment).doctorId === "string"
  );
}
