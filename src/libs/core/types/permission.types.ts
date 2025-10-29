import { Role } from "../../infrastructure/database/prisma/prisma.types";

/**
 * Permission types for the healthcare application
 * @type Permission
 * @description Defines all available permissions in the system
 * @example
 * ```typescript
 * const permission: Permission = "manage_appointments";
 * ```
 */
export type Permission =
  | "manage_users"
  | "manage_clinics"
  | "manage_roles"
  | "view_analytics"
  | "manage_system"
  | "manage_clinic_staff"
  | "view_clinic_analytics"
  | "manage_appointments"
  | "manage_inventory"
  | "manage_patients"
  | "view_medical_records"
  | "create_prescriptions"
  | "view_appointments"
  | "book_appointments"
  | "view_prescriptions"
  | "view_medical_history"
  | "register_patients"
  | "manage_queue"
  | "basic_patient_info"
  | "view_profile"
  | "edit_profile"
  | "view_clinic_details"
  | "view_own_appointments";

/**
 * Resource types for permission checks
 * @type ResourceType
 * @description Defines the types of resources that can be accessed
 * @example
 * ```typescript
 * const resourceType: ResourceType = "appointment";
 * ```
 */
export type ResourceType =
  | "clinic"
  | "appointment"
  | "user"
  | "patient"
  | "doctor"
  | "inventory";

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
