/**
 * Role DTOs for RBAC system
 * @module RoleDTOs
 * @description Data Transfer Objects for role management operations
 */

/**
 * Data transfer object for creating a new role
 * @interface CreateRoleDto
 * @description Required fields for creating a role
 */
export interface CreateRoleDto {
  /** Role name (unique identifier) */
  readonly name: string;
  /** Display name for the role */
  readonly displayName: string;
  /** Optional description of the role */
  readonly description?: string;
  /** Optional clinic ID for clinic-specific roles */
  readonly clinicId?: string;
  /** Optional array of permission IDs to assign */
  readonly permissions?: string[];
}

/**
 * Data transfer object for updating an existing role
 * @interface UpdateRoleDto
 * @description Optional fields for updating a role
 */
export interface UpdateRoleDto {
  /** Optional display name */
  readonly displayName?: string;
  /** Optional description */
  readonly description?: string;
  /** Optional active status */
  readonly isActive?: boolean;
  /** Optional array of permission IDs to update */
  readonly permissions?: string[];
}
