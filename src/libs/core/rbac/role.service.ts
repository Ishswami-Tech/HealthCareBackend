import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../infrastructure/database";
import { RedisService } from "../../infrastructure/cache/redis/redis.service";

/**
 * Represents a role in the RBAC system
 * @interface Role
 * @description Defines the structure of a role with associated permissions
 * @example
 * ```typescript
 * const role: Role = {
 *   id: "role-123",
 *   name: "DOCTOR",
 *   displayName: "Doctor",
 *   description: "Medical practitioner access",
 *   domain: "healthcare",
 *   clinicId: "clinic-456",
 *   isSystemRole: true,
 *   isActive: true,
 *   createdAt: new Date(),
 *   updatedAt: new Date(),
 *   permissions: []
 * };
 * ```
 */
export interface Role {
  readonly id: string;
  readonly name: string;
  readonly displayName: string;
  readonly description?: string;
  readonly domain: string;
  readonly clinicId?: string;
  readonly isSystemRole: boolean;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly permissions?: Permission[];
}

/**
 * Represents a permission associated with a role
 * @interface Permission
 * @description Defines the structure of a permission within a role context
 */
export interface Permission {
  readonly id: string;
  readonly name: string;
  readonly resource: string;
  readonly action: string;
  readonly description?: string;
  readonly isActive: boolean;
}

/**
 * Data transfer object for creating a new role
 * @interface CreateRoleDto
 * @description Required fields for creating a role
 */
export interface CreateRoleDto {
  readonly name: string;
  readonly displayName: string;
  readonly description?: string;
  readonly domain: string;
  readonly clinicId?: string;
  readonly permissions?: string[];
}

/**
 * Data transfer object for updating an existing role
 * @interface UpdateRoleDto
 * @description Optional fields for updating a role
 */
export interface UpdateRoleDto {
  readonly displayName?: string;
  readonly description?: string;
  readonly isActive?: boolean;
  readonly permissions?: string[];
}

/**
 * Service for managing roles in the RBAC system
 * @class RoleService
 * @description Handles CRUD operations for roles, system role initialization,
 * and role caching for performance optimization
 */
@Injectable()
export class RoleService {
  private readonly logger = new Logger(RoleService.name);
  private readonly CACHE_TTL = 3600; // 1 hour
  private readonly CACHE_PREFIX = "roles:";

  /**
   * Creates an instance of RoleService
   * @constructor
   * @param prisma - Prisma database service
   * @param redis - Redis caching service
   */
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Create a new role
   */
  async createRole(createRoleDto: CreateRoleDto): Promise<Role> {
    try {
      // Check if role with same name exists in the same domain/clinic
      const existingRole = (await this.databaseService
        .getPrismaClient()
        .findRoleByNameSafe(
          createRoleDto.name,
          createRoleDto.domain,
          createRoleDto.clinicId,
        )) as {
        id: string;
        name: string;
        displayName: string;
        description: string | null;
        domain: string;
        clinicId: string | null;
        isSystemRole: boolean;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
      } | null;

      if (existingRole) {
        throw new Error(
          `Role '${createRoleDto.name}' already exists in this domain`,
        );
      }

      const role = (await this.databaseService
        .getPrismaClient()
        .createRoleSafe({
          name: createRoleDto.name,
          displayName: createRoleDto.displayName,
          description: createRoleDto.description,
          domain: createRoleDto.domain,
          clinicId: createRoleDto.clinicId,
          isSystemRole: false,
          isActive: true,
        })) as {
        id: string;
        name: string;
        displayName: string;
        description: string | null;
        domain: string;
        clinicId: string | null;
        isSystemRole: boolean;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
      };

      // Assign permissions if provided
      if (createRoleDto.permissions && createRoleDto.permissions.length > 0) {
        await this.assignPermissionsToRole(role.id, createRoleDto.permissions);
      }

      // Clear cache
      await this.clearRoleCache();

      this.logger.log(`Role created: ${role.name} (${role.id})`);

      return this.mapToRole(role);
    } catch (_error) {
      this.logger.error(
        `Failed to create role: ${createRoleDto.name}`,
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      throw _error;
    }
  }

  /**
   * Get role by ID
   */
  async getRoleById(roleId: string): Promise<Role | null> {
    try {
      const cacheKey = `${this.CACHE_PREFIX}id:${roleId}`;
      const cached = await this.redis.get<Role>(cacheKey);

      if (cached) {
        return cached;
      }

      const role = (await this.databaseService
        .getPrismaClient()
        .findRoleByIdSafe(roleId)) as {
        id: string;
        name: string;
        displayName: string;
        description: string | null;
        domain: string;
        clinicId: string | null;
        isSystemRole: boolean;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
      } | null;

      if (!role) {
        return null;
      }

      const mappedRole = this.mapToRole(role);

      // Cache the result
      await this.redis.set(cacheKey, mappedRole, this.CACHE_TTL);

      return mappedRole;
    } catch (_error) {
      this.logger.error(
        `Failed to get role by ID: ${roleId}`,
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      return null;
    }
  }

  /**
   * Get role by name
   */
  async getRoleByName(
    name: string,
    domain?: string,
    clinicId?: string,
  ): Promise<Role | null> {
    try {
      const cacheKey = `${this.CACHE_PREFIX}name:${name}:${domain || "null"}:${clinicId || "null"}`;
      const cached = await this.redis.get<Role>(cacheKey);

      if (cached) {
        return cached;
      }

      const role = (await this.databaseService
        .getPrismaClient()
        .findRoleByNameSafe(name, domain, clinicId)) as {
        id: string;
        name: string;
        displayName: string;
        description: string | null;
        domain: string;
        clinicId: string | null;
        isSystemRole: boolean;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
      } | null;

      if (!role) {
        return null;
      }

      const mappedRole = this.mapToRole(role);

      // Cache the result
      await this.redis.set(cacheKey, mappedRole, this.CACHE_TTL);

      return mappedRole;
    } catch (_error) {
      this.logger.error(
        `Failed to get role by name: ${name}`,
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      return null;
    }
  }

  /**
   * Get all roles
   */
  async getRoles(domain?: string, clinicId?: string): Promise<Role[]> {
    try {
      const cacheKey = `${this.CACHE_PREFIX}list:${domain || "null"}:${clinicId || "null"}`;
      const cached = await this.redis.get<Role[]>(cacheKey);

      if (cached) {
        return cached;
      }

      const roles = (await this.databaseService
        .getPrismaClient()
        .findRolesByDomainSafe(domain, clinicId)) as Array<{
        id: string;
        name: string;
        displayName: string;
        description: string | null;
        domain: string;
        clinicId: string | null;
        isSystemRole: boolean;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
      }>;

      const mappedRoles: Role[] = Array.isArray(roles)
        ? roles.map((role) => this.mapToRole(role))
        : [];

      // Cache the result
      await this.redis.set(cacheKey, mappedRoles, this.CACHE_TTL);

      return mappedRoles;
    } catch (_error) {
      this.logger.error(
        "Failed to get roles",
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      return [];
    }
  }

  /**
   * Update role
   */
  async updateRole(
    roleId: string,
    updateRoleDto: UpdateRoleDto,
  ): Promise<Role> {
    try {
      const existingRole = (await this.databaseService
        .getPrismaClient()
        .findRoleByIdSafe(roleId)) as {
        id: string;
        name: string;
        displayName: string;
        description: string | null;
        domain: string;
        clinicId: string | null;
        isSystemRole: boolean;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
      } | null;

      if (!existingRole) {
        throw new NotFoundException(`Role with ID ${roleId} not found`);
      }

      if (existingRole && (existingRole as unknown as Role).isSystemRole) {
        throw new Error("Cannot modify system roles");
      }

      // Update role
      const role = (await this.databaseService
        .getPrismaClient()
        .updateRoleSafe(roleId, {
          displayName: updateRoleDto.displayName,
          description: updateRoleDto.description,
          isActive: updateRoleDto.isActive,
          updatedAt: new Date(),
        })) as {
        id: string;
        name: string;
        displayName: string;
        description: string | null;
        domain: string;
        clinicId: string | null;
        isSystemRole: boolean;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
      };

      // Update permissions if provided
      if (updateRoleDto.permissions) {
        await this.updateRolePermissions(roleId, updateRoleDto.permissions);
      }

      // Clear cache
      await this.clearRoleCache();

      this.logger.log(
        `Role updated: ${(role as unknown as Role).name} (${(role as unknown as Role).id})`,
      );

      return this.mapToRole(role);
    } catch (_error) {
      this.logger.error(
        `Failed to update role: ${roleId}`,
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      throw _error;
    }
  }

  /**
   * Delete role
   */
  async deleteRole(roleId: string): Promise<void> {
    try {
      const role = (await this.databaseService
        .getPrismaClient()
        .findRoleByIdSafe(roleId)) as {
        id: string;
        name: string;
        displayName: string;
        description: string | null;
        domain: string;
        clinicId: string | null;
        isSystemRole: boolean;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
      } | null;

      if (!role) {
        throw new NotFoundException(`Role with ID ${roleId} not found`);
      }

      if (role && (role as unknown as Role).isSystemRole) {
        throw new Error("Cannot delete system roles");
      }

      // Check if role is assigned to any users
      const userRoles = (await this.databaseService
        .getPrismaClient()
        .countUserRolesSafe(roleId)) as number;

      if (userRoles > 0) {
        throw new Error("Cannot delete role that is assigned to users");
      }

      // Soft delete role
      await this.databaseService.getPrismaClient().updateRoleSafe(roleId, {
        isActive: false,
        updatedAt: new Date(),
      });

      // Clear cache
      await this.clearRoleCache();

      this.logger.log(
        `Role deleted: ${(role as unknown as Role).name} (${(role as unknown as Role).id})`,
      );
    } catch (_error) {
      this.logger.error(
        `Failed to delete role: ${roleId}`,
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      throw _error;
    }
  }

  /**
   * Assign permissions to role
   */
  async assignPermissionsToRole(
    roleId: string,
    permissionIds: string[],
  ): Promise<void> {
    try {
      // Remove existing permissions
      await this.databaseService
        .getPrismaClient()
        .deleteRolePermissionsSafe(roleId);

      // Add new permissions
      if (permissionIds.length > 0) {
        await this.databaseService.getPrismaClient().createRolePermissionsSafe(
          permissionIds.map((permissionId) => ({
            roleId,
            permissionId,
          })),
        );
      }

      // Clear cache
      await this.clearRoleCache();

      this.logger.log(
        `Permissions assigned to role ${roleId}: ${permissionIds.length} permissions`,
      );
    } catch (_error) {
      this.logger.error(
        `Failed to assign permissions to role: ${roleId}`,
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      throw _error;
    }
  }

  /**
   * Remove permissions from role
   */
  async removePermissionsFromRole(
    roleId: string,
    permissionIds: string[],
  ): Promise<void> {
    try {
      await this.databaseService
        .getPrismaClient()
        .removeRolePermissionsSafe(roleId, permissionIds);

      // Clear cache
      await this.clearRoleCache();

      this.logger.log(
        `Permissions removed from role ${roleId}: ${permissionIds.length} permissions`,
      );
    } catch (_error) {
      this.logger.error(
        `Failed to remove permissions from role: ${roleId}`,
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      throw _error;
    }
  }

  /**
   * Update role permissions (replace all)
   */
  async updateRolePermissions(
    roleId: string,
    permissionIds: string[],
  ): Promise<void> {
    await this.assignPermissionsToRole(roleId, permissionIds);
  }

  /**
   * Get system roles
   */
  async getSystemRoles(): Promise<Role[]> {
    try {
      const roles = await this.getRoles();
      return roles.filter((role) => role.isSystemRole);
    } catch (_error) {
      this.logger.error(
        "Failed to get system roles",
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      return [];
    }
  }

  /**
   * Initialize system roles
   */
  async initializeSystemRoles(): Promise<void> {
    try {
      const systemRoles = [
        {
          name: "SUPER_ADMIN",
          displayName: "Super Administrator",
          description: "Full system access",
          domain: "healthcare",
        },
        {
          name: "CLINIC_ADMIN",
          displayName: "Clinic Administrator",
          description: "Full clinic management access",
          domain: "healthcare",
        },
        {
          name: "DOCTOR",
          displayName: "Doctor",
          description: "Medical practitioner access",
          domain: "healthcare",
        },
        {
          name: "NURSE",
          displayName: "Nurse",
          description: "Nursing staff access",
          domain: "healthcare",
        },
        {
          name: "RECEPTIONIST",
          displayName: "Receptionist",
          description: "Front desk staff access",
          domain: "healthcare",
        },
        {
          name: "PATIENT",
          displayName: "Patient",
          description: "Patient access to own records",
          domain: "healthcare",
        },
      ];

      for (const roleData of systemRoles) {
        const existingRole = await this.getRoleByName(
          roleData.name,
          roleData.domain,
        );

        if (!existingRole) {
          await this.databaseService.getPrismaClient().createSystemRoleSafe({
            ...roleData,
            isSystemRole: true,
            isActive: true,
          });

          this.logger.log(`System role created: ${roleData.name}`);
        }
      }

      await this.clearRoleCache();
    } catch (_error) {
      this.logger.error(
        "Failed to initialize system roles",
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      throw _error;
    }
  }

  /**
   * Map database role to Role interface
   */
  private mapToRole(role: unknown): Role {
    const roleData = role as Record<string, unknown>;
    return {
      id: roleData["id"] as string,
      name: roleData["name"] as string,
      displayName: roleData["displayName"] as string,
      ...(roleData["description"]
        ? { description: roleData["description"] as string }
        : {}),
      domain: roleData["domain"] as string,
      ...(roleData["clinicId"]
        ? { clinicId: roleData["clinicId"] as string }
        : {}),
      isSystemRole: roleData["isSystemRole"] as boolean,
      isActive: roleData["isActive"] as boolean,
      createdAt: roleData["createdAt"] as Date,
      updatedAt: roleData["updatedAt"] as Date,
      permissions: (roleData["permissions"] as unknown[])?.map(
        (rp: unknown) => {
          const rpData = rp as Record<string, unknown>;
          const permission = rpData["permission"] as Record<string, unknown>;
          return {
            id: permission["id"] as string,
            name: permission["name"] as string,
            resource: permission["resource"] as string,
            action: permission["action"] as string,
            ...(permission["description"]
              ? { description: permission["description"] as string }
              : {}),
            isActive: permission["isActive"] as boolean,
          };
        },
      ),
    };
  }

  /**
   * Clear role cache
   */
  private async clearRoleCache(): Promise<void> {
    try {
      const keys = await this.redis.keys(`${this.CACHE_PREFIX}*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (_error) {
      this.logger.error(
        "Failed to clear role cache",
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
    }
  }
}
