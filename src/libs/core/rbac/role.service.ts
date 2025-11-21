import { Injectable, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { LogType, LogLevel } from '@core/types';
import type { RoleRecord, RoleEntity, RolePermission } from '@core/types/rbac.types';
import type { RbacRoleEntity } from '@infrastructure/database';
import type { CreateRoleDto, UpdateRoleDto } from '@dtos/role.dto';

/**
 * Re-export types for backward compatibility
 * @deprecated Use types from @core/types instead
 */
export type { RoleRecord };
export type { RolePermission as Permission };

/**
 * Service for managing roles in the RBAC system
 * @class RoleService
 * @description Handles CRUD operations for roles, system role initialization,
 * and role caching for performance optimization
 */
@Injectable()
export class RoleService {
  private readonly CACHE_TTL = 3600; // 1 hour
  private readonly CACHE_PREFIX = 'roles:';

  /**
   * Creates an instance of RoleService
   * @constructor
   * @param databaseService - Database service
   * @param redis - Redis caching service
   * @param loggingService - Logging service
   */
  constructor(
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Type-safe helper to convert Prisma RbacRoleEntity to domain RoleEntity
   */
  private toRoleEntity(prismaRole: RbacRoleEntity): RoleEntity {
    // Explicitly map Prisma entity to domain entity with proper type assertion
    const role = prismaRole as unknown as {
      id: string;
      name: string;
      displayName: string;
      description: string | null;
      clinicId: string | null;
      isSystemRole: boolean;
      isActive: boolean;
      createdAt: Date;
      updatedAt: Date;
    };
    const entity: RoleEntity = {
      id: String(role.id),
      name: String(role.name),
      displayName: String(role.displayName),
      description:
        role.description !== null && role.description !== undefined
          ? String(role.description)
          : null,
      clinicId:
        role.clinicId !== null && role.clinicId !== undefined ? String(role.clinicId) : null,
      isSystemRole: Boolean(role.isSystemRole),
      isActive: Boolean(role.isActive),
      createdAt: role.createdAt instanceof Date ? role.createdAt : new Date(role.createdAt),
      updatedAt: role.updatedAt instanceof Date ? role.updatedAt : new Date(role.updatedAt),
    };
    return entity;
  }

  /**
   * Create a new role
   */
  async createRole(createRoleDto: CreateRoleDto): Promise<RoleRecord> {
    try {
      // Check if role with same name exists in the same clinic
      const existingRolePrisma = await this.databaseService.findRoleByNameSafe(
        createRoleDto.name,
        createRoleDto.clinicId
      );

      if (existingRolePrisma) {
        throw new HealthcareError(
          ErrorCode.DATABASE_DUPLICATE_ENTRY,
          `Role '${createRoleDto.name}' already exists in this clinic`,
          undefined,
          { roleName: createRoleDto.name, clinicId: createRoleDto.clinicId },
          'RoleService.createRole'
        );
      }

      const createData: {
        name: string;
        displayName: string;
        description?: string | null;
        clinicId?: string | null;
        isSystemRole?: boolean;
        isActive?: boolean;
      } = {
        name: createRoleDto.name,
        displayName: createRoleDto.displayName,
        isSystemRole: false,
        isActive: true,
      };
      if (createRoleDto.description !== undefined) {
        createData.description = createRoleDto.description ?? null;
      }
      if (createRoleDto.clinicId !== undefined) {
        createData.clinicId = createRoleDto.clinicId ?? null;
      }
      const rolePrisma = await this.databaseService.createRoleSafe(createData);
      const role = this.toRoleEntity(rolePrisma);

      // Assign permissions if provided
      if (createRoleDto.permissions && createRoleDto.permissions.length > 0) {
        await this.assignPermissionsToRole(role.id, createRoleDto.permissions);
      }

      // Clear cache
      await this.clearRoleCache();

      void this.loggingService.log(LogType.AUDIT, LogLevel.INFO, 'Role created', 'RoleService', {
        roleId: role.id,
        name: role.name,
      });

      return this.mapToRole(role);
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to create role',
        'RoleService',
        { name: createRoleDto.name, _error }
      );
      throw _error;
    }
  }

  /**
   * Get role by ID
   */
  async getRoleById(roleId: string): Promise<RoleRecord | null> {
    try {
      const cacheKey = `${this.CACHE_PREFIX}id:${roleId}`;
      const cached = await this.cacheService.get<RoleRecord>(cacheKey);

      if (cached) {
        return cached;
      }

      const rolePrisma = await this.databaseService.findRoleByIdSafe(roleId);

      if (!rolePrisma) {
        return null;
      }

      const role = this.toRoleEntity(rolePrisma);
      const mappedRole = this.mapToRole(role);

      // Cache the result
      await this.cacheService.set(cacheKey, mappedRole, this.CACHE_TTL);

      return mappedRole;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to get role by ID',
        'RoleService',
        { roleId, _error }
      );
      return null;
    }
  }

  /**
   * Get role by name
   */
  async getRoleByName(name: string, clinicId?: string): Promise<RoleRecord | null> {
    try {
      const cacheKey = `${this.CACHE_PREFIX}name:${name}:${clinicId || 'null'}`;
      const cached = await this.cacheService.get<RoleRecord>(cacheKey);

      if (cached) {
        return cached;
      }

      const rolePrisma = await this.databaseService.findRoleByNameSafe(name, clinicId);

      if (!rolePrisma) {
        return null;
      }

      const role = this.toRoleEntity(rolePrisma);
      const mappedRole = this.mapToRole(role);

      // Cache the result
      await this.cacheService.set(cacheKey, mappedRole, this.CACHE_TTL);

      return mappedRole;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to get role by name',
        'RoleService',
        { name, clinicId, _error }
      );
      return null;
    }
  }

  /**
   * Get all roles
   */
  async getRoles(clinicId?: string): Promise<RoleRecord[]> {
    try {
      const cacheKey = `${this.CACHE_PREFIX}list:${clinicId || 'null'}`;
      const cached = await this.cacheService.get<RoleRecord[]>(cacheKey);

      if (cached) {
        return cached;
      }

      const rolesPrisma = await this.databaseService.findRolesByClinicSafe(clinicId);

      const mappedRoles: RoleRecord[] = rolesPrisma.map(rolePrisma => {
        const role = this.toRoleEntity(rolePrisma);
        return this.mapToRole(role);
      });

      // Cache the result
      await this.cacheService.set(cacheKey, mappedRoles, this.CACHE_TTL);

      return mappedRoles;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to get roles',
        'RoleService',
        { clinicId, _error }
      );
      return [];
    }
  }

  /**
   * Update role
   */
  async updateRole(roleId: string, updateRoleDto: UpdateRoleDto): Promise<RoleRecord> {
    try {
      const existingRolePrisma = await this.databaseService.findRoleByIdSafe(roleId);

      if (!existingRolePrisma) {
        throw new NotFoundException(`Role with ID ${roleId} not found`);
      }

      const existingRole = this.toRoleEntity(existingRolePrisma);
      if (existingRole.isSystemRole) {
        throw new HealthcareError(
          ErrorCode.OPERATION_NOT_ALLOWED,
          'Cannot modify system roles',
          undefined,
          { roleId },
          'RoleService.updateRole'
        );
      }

      // Update role
      const updateData: {
        displayName?: string;
        description?: string | null;
        isActive?: boolean;
        updatedAt: Date;
      } = {
        updatedAt: new Date(),
      };
      if (updateRoleDto.displayName !== undefined) {
        updateData.displayName = updateRoleDto.displayName;
      }
      if (updateRoleDto.description !== undefined) {
        updateData.description = updateRoleDto.description ?? null;
      }
      if (updateRoleDto.isActive !== undefined) {
        updateData.isActive = updateRoleDto.isActive;
      }
      const rolePrisma = await this.databaseService.updateRoleSafe(roleId, updateData);
      const role = this.toRoleEntity(rolePrisma);

      // Update permissions if provided
      if (updateRoleDto.permissions) {
        await this.updateRolePermissions(roleId, updateRoleDto.permissions);
      }

      // Clear cache
      await this.clearRoleCache();

      void this.loggingService.log(LogType.AUDIT, LogLevel.INFO, 'Role updated', 'RoleService', {
        roleId: role.id,
        name: role.name,
      });

      return this.mapToRole(role);
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to update role',
        'RoleService',
        { roleId, _error }
      );
      throw _error;
    }
  }

  /**
   * Delete role
   */
  async deleteRole(roleId: string): Promise<void> {
    try {
      const rolePrisma = await this.databaseService.findRoleByIdSafe(roleId);

      if (!rolePrisma) {
        throw new NotFoundException(`Role with ID ${roleId} not found`);
      }

      const roleEntity = this.toRoleEntity(rolePrisma);
      if (roleEntity.isSystemRole) {
        throw new HealthcareError(
          ErrorCode.OPERATION_NOT_ALLOWED,
          'Cannot delete system roles',
          undefined,
          { roleId },
          'RoleService.deleteRole'
        );
      }

      // Check if role is assigned to any users
      const userRoles = await this.databaseService.countUserRolesSafe(roleId);

      if (userRoles > 0) {
        throw new HealthcareError(
          ErrorCode.OPERATION_NOT_ALLOWED,
          'Cannot delete role that is assigned to users',
          undefined,
          { roleId },
          'RoleService.deleteRole'
        );
      }

      // Soft delete role
      await this.databaseService.updateRoleSafe(roleId, {
        isActive: false,
        updatedAt: new Date(),
      });

      // Clear cache
      await this.clearRoleCache();

      void this.loggingService.log(LogType.AUDIT, LogLevel.INFO, 'Role deleted', 'RoleService', {
        roleId: roleEntity.id,
        name: roleEntity.name,
      });
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to delete role',
        'RoleService',
        { roleId, _error }
      );
      throw _error;
    }
  }

  /**
   * Assign permissions to role
   */
  async assignPermissionsToRole(roleId: string, permissionIds: string[]): Promise<void> {
    try {
      // Remove existing permissions
      await this.databaseService.deleteRolePermissionsSafe(roleId);

      // Add new permissions
      if (permissionIds.length > 0) {
        await this.databaseService.createRolePermissionsSafe(
          permissionIds.map(permissionId => ({
            roleId,
            permissionId,
          }))
        );
      }

      // Clear cache
      await this.clearRoleCache();

      void this.loggingService.log(
        LogType.AUDIT,
        LogLevel.INFO,
        'Permissions assigned to role',
        'RoleService',
        { roleId, count: permissionIds.length }
      );
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to assign permissions to role',
        'RoleService',
        { roleId, _error }
      );
      throw _error;
    }
  }

  /**
   * Remove permissions from role
   */
  async removePermissionsFromRole(roleId: string, permissionIds: string[]): Promise<void> {
    try {
      await this.databaseService.removeRolePermissionsSafe(roleId, permissionIds);

      // Clear cache
      await this.clearRoleCache();

      void this.loggingService.log(
        LogType.AUDIT,
        LogLevel.INFO,
        'Permissions removed from role',
        'RoleService',
        { roleId, count: permissionIds.length }
      );
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to remove permissions from role',
        'RoleService',
        { roleId, _error }
      );
      throw _error;
    }
  }

  /**
   * Update role permissions (replace all)
   */
  async updateRolePermissions(roleId: string, permissionIds: string[]): Promise<void> {
    await this.assignPermissionsToRole(roleId, permissionIds);
  }

  /**
   * Get system roles
   */
  async getSystemRoles(): Promise<RoleRecord[]> {
    try {
      const roles = await this.getRoles();
      return roles.filter((role: RoleRecord) => role.isSystemRole);
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to get system roles',
        'RoleService',
        { _error }
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
          name: 'SUPER_ADMIN',
          displayName: 'Super Administrator',
          description: 'Full system access',
        },
        {
          name: 'CLINIC_ADMIN',
          displayName: 'Clinic Administrator',
          description: 'Full clinic management access',
        },
        {
          name: 'DOCTOR',
          displayName: 'Doctor',
          description: 'Medical practitioner access',
        },
        {
          name: 'NURSE',
          displayName: 'Nurse',
          description: 'Nursing staff access',
        },
        {
          name: 'RECEPTIONIST',
          displayName: 'Receptionist',
          description: 'Front desk staff access',
        },
        {
          name: 'PATIENT',
          displayName: 'Patient',
          description: 'Patient access to own records',
        },
      ];

      for (const roleData of systemRoles) {
        const existingRole = await this.getRoleByName(roleData.name);

        if (!existingRole) {
          await this.databaseService.createSystemRoleSafe({
            ...roleData,
            isSystemRole: true,
            isActive: true,
          });

          void this.loggingService.log(
            LogType.AUDIT,
            LogLevel.INFO,
            'System role created',
            'RoleService',
            { name: roleData.name }
          );
        }
      }

      await this.clearRoleCache();
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to initialize system roles',
        'RoleService',
        { _error }
      );
      throw _error;
    }
  }

  /**
   * Map database role entity to RoleRecord
   */
  private mapToRole(role: RoleEntity): RoleRecord {
    // Note: permissions are not included in RoleEntity from database queries by default
    // This is handled separately if permissions need to be included
    const mappedPermissions: RolePermission[] | undefined = undefined;

    // Build result object with all required properties
    const result: RoleRecord = {
      id: role.id,
      name: role.name,
      displayName: role.displayName,
      isSystemRole: role.isSystemRole,
      isActive: role.isActive,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
      ...(role.description !== null && { description: role.description }),
      ...(role.clinicId !== null && { clinicId: role.clinicId }),
      ...(mappedPermissions !== undefined && { permissions: mappedPermissions }),
    };

    return result;
  }

  /**
   * Clear role cache
   */
  private async clearRoleCache(): Promise<void> {
    try {
      await this.cacheService.invalidateByPattern(`${this.CACHE_PREFIX}*`);
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to clear role cache',
        'RoleService',
        { _error }
      );
    }
  }
}
