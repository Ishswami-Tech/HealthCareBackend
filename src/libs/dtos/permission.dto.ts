/**
 * Permission DTOs for RBAC system
 * @module PermissionDTOs
 * @description Data Transfer Objects for permission management operations
 */

/**
 * Data transfer object for creating a new permission
 * @interface CreatePermissionDto
 * @description Required fields for creating a permission
 */
export interface CreatePermissionDto {
  /** Permission name */
  readonly name: string;
  /** Resource the permission applies to */
  readonly resource: string;
  /** Action allowed by this permission */
  readonly action: string;
  /** Optional description of the permission */
  readonly description?: string;
  /** Domain/namespace for the permission */
  readonly domain: string;
}

/**
 * Data transfer object for updating an existing permission
 * @interface UpdatePermissionDto
 * @description Optional fields for updating a permission
 */
export interface UpdatePermissionDto {
  /** Optional permission name */
  readonly name?: string;
  /** Optional description */
  readonly description?: string;
  /** Optional active status */
  readonly isActive?: boolean;
}
