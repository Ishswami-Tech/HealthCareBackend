/**
 * Comprehensive RBAC Types - Consolidated
 * This file consolidates all Role-Based Access Control related types including:
 * - Role types and definitions
 * - Permission types and entities
 * - RBAC context and validation types
 * All RBAC-related types are defined here for better organization and maintainability.
 */

// ============================================================================
// ROLE TYPES
// ============================================================================

/**
 * Role types for RBAC (domain-level, decoupled from DB enum)
 */
export const RolesList = [
  'SUPER_ADMIN',
  'CLINIC_ADMIN',
  'DOCTOR',
  'PATIENT',
  'RECEPTIONIST',
  'PHARMACIST',
  'THERAPIST',
  'LAB_TECHNICIAN',
  'FINANCE_BILLING',
  'SUPPORT_STAFF',
  'NURSE',
  'COUNSELOR',
] as const;

export type Role = (typeof RolesList)[number];

/**
 * Represents a role entity from the database
 * @interface RoleEntity
 * @description Complete role record structure from the database
 */
export interface RoleEntity {
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
 * Represents a role record in the RBAC system
 * @type RoleRecord
 * @description Domain type for role entities (mapped from database)
 */
export type RoleRecord = Omit<RoleEntity, 'description' | 'clinicId'> & {
  readonly description?: string;
  readonly clinicId?: string;
  readonly permissions?: RolePermission[];
};

// ============================================================================
// PERMISSION TYPES
// ============================================================================

/**
 * Permission types for the healthcare application
 * @type Permission
 * @description Defines all available permissions in the system (permission name literals)
 * @example
 * ```typescript
 * const permission: Permission = "manage_appointments";
 * ```
 */
export type Permission =
  | 'manage_users'
  | 'manage_clinics'
  | 'manage_roles'
  | 'view_analytics'
  | 'manage_system'
  | 'manage_clinic_staff'
  | 'view_clinic_analytics'
  | 'manage_appointments'
  | 'manage_inventory'
  | 'manage_patients'
  | 'view_medical_records'
  | 'create_prescriptions'
  | 'view_appointments'
  | 'book_appointments'
  | 'view_prescriptions'
  | 'view_medical_history'
  | 'register_patients'
  | 'manage_queue'
  | 'basic_patient_info'
  | 'view_profile'
  | 'edit_profile'
  | 'view_clinic_details'
  | 'view_own_appointments';

/**
 * Represents a permission entity from the database (Prisma result type)
 * @interface PrismaPermissionEntity
 * @description Complete permission record structure returned by PrismaService methods
 * This interface matches the exact structure from Prisma-generated Permission type
 * and is used to type the results from PrismaService permission methods
 */
export interface PrismaPermissionEntity {
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
 * Represents a permission entity from the database (domain type)
 * @interface PermissionEntity
 * @description Complete permission record structure from the database
 */
export interface PermissionEntity {
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
 * Represents a permission record in the RBAC system
 * @type PermissionRecord
 * @description Domain type for permission entities (mapped from database)
 */
export type PermissionRecord = Omit<PermissionEntity, 'description'> & {
  readonly description?: string;
};

/**
 * Represents a permission associated with a role
 * @interface RolePermission
 * @description Defines the structure of a permission within a role context
 */
export interface RolePermission {
  readonly id: string;
  readonly name: string;
  readonly resource: string;
  readonly action: string;
  readonly description?: string;
  readonly isActive: boolean;
}

/**
 * Resource types for permission checks
 * @type ResourceType
 * @description Defines the types of resources that can be accessed
 * @example
 * ```typescript
 * const resourceType: ResourceType = "appointment";
 * ```
 */
export type ResourceType = 'clinic' | 'appointment' | 'user' | 'patient' | 'doctor' | 'inventory';

/**
 * Parameters for permission checks
 * @interface PermissionCheckParams
 * @description Contains all parameters needed to check user permissions
 * @example
 * ```typescript
 * const params: PermissionCheckParams = {
 *   userId: "user-123",
 *   action: "view_appointments",
 *   resourceType: "appointment",
 *   resourceId: "appointment-456",
 *   context: { clinicId: "clinic-789" }
 * };
 * ```
 */
export interface PermissionCheckParams {
  /** User ID to check permissions for */
  readonly userId: string;
  /** Permission action to check */
  readonly action: Permission;
  /** Optional resource type */
  readonly resourceType?: ResourceType;
  /** Optional specific resource ID */
  readonly resourceId?: string;
  /** Optional context for extensibility (e.g., ownership, tenant, etc.) */
  readonly context?: unknown;
}

/**
 * User permissions and roles
 * @interface UserPermissions
 * @description Contains a user's roles and permissions
 * @example
 * ```typescript
 * const userPermissions: UserPermissions = {
 *   userId: "user-123",
 *   roles: [Role.DOCTOR],
 *   permissions: ["view_appointments", "create_prescriptions"]
 * };
 * ```
 */
export interface UserPermissions {
  /** User ID */
  readonly userId: string;
  /** User's roles */
  readonly roles: Role[];
  /** User's permissions */
  readonly permissions: Permission[];
}

// ============================================================================
// RBAC CONTEXT AND VALIDATION TYPES
// ============================================================================

/**
 * Context for RBAC permission checks
 * @interface RbacContext
 * @description Contains all necessary information for permission validation
 */
export interface RbacContext {
  readonly userId: string;
  readonly clinicId?: string;
  readonly resource: string;
  readonly action: string;
  readonly resourceId?: string; // For ownership checks
  readonly metadata?: Record<string, unknown>;
}

/**
 * Represents a role assignment to a user
 * @interface RoleAssignment
 * @description Defines the structure of a user-role assignment
 */
export interface RoleAssignment {
  readonly userId: string;
  readonly roleId: string;
  readonly roleName: string;
  readonly clinicId?: string;
  readonly assignedBy: string;
  readonly assignedAt: Date;
  readonly expiresAt?: Date;
  readonly isActive: boolean;
}

/**
 * Result of a permission check
 * @interface PermissionCheck
 * @description Contains the result and details of a permission validation
 */
export interface PermissionCheck {
  readonly hasPermission: boolean;
  readonly roles: string[];
  readonly permissions: string[];
  readonly reason?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * RBAC requirement for guard validation
 * @interface RbacRequirement
 * @description Defines the requirements for RBAC guard validation
 */
export interface RbacRequirement {
  readonly resource: string;
  readonly action: string;
  readonly clinicId?: string;
  readonly requireOwnership?: boolean;
  readonly allowSuperAdmin?: boolean;
}
