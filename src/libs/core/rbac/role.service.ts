import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { RedisService } from '../../infrastructure/cache/redis/redis.service';

export interface Role {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  domain: string;
  clinicId?: string;
  isSystemRole: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  permissions?: Permission[];
}

export interface Permission {
  id: string;
  name: string;
  resource: string;
  action: string;
  description?: string;
  isActive: boolean;
}

export interface CreateRoleDto {
  name: string;
  displayName: string;
  description?: string;
  domain: string;
  clinicId?: string;
  permissions?: string[];
}

export interface UpdateRoleDto {
  displayName?: string;
  description?: string;
  isActive?: boolean;
  permissions?: string[];
}

@Injectable()
export class RoleService {
  private readonly logger = new Logger(RoleService.name);
  private readonly CACHE_TTL = 3600; // 1 hour
  private readonly CACHE_PREFIX = 'roles:';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Create a new role
   */
  async createRole(createRoleDto: CreateRoleDto): Promise<Role> {
    try {
      // Check if role with same name exists in the same domain/clinic
      const existingRole = await this.prisma.rbacRole.findFirst({
        where: {
          name: createRoleDto.name,
          domain: createRoleDto.domain,
          clinicId: createRoleDto.clinicId,
        },
      });

      if (existingRole) {
        throw new Error(`Role '${createRoleDto.name}' already exists in this domain`);
      }

      const role = await this.prisma.rbacRole.create({
        data: {
          name: createRoleDto.name,
          displayName: createRoleDto.displayName,
          description: createRoleDto.description,
          domain: createRoleDto.domain,
          clinicId: createRoleDto.clinicId,
          isSystemRole: false,
          isActive: true,
        },
        include: {
          permissions: {
            include: {
              permission: true,
            },
          },
        },
      });

      // Assign permissions if provided
      if (createRoleDto.permissions && createRoleDto.permissions.length > 0) {
        await this.assignPermissionsToRole(role.id, createRoleDto.permissions);
      }

      // Clear cache
      await this.clearRoleCache();

      this.logger.log(`Role created: ${role.name} (${role.id})`);

      return this.mapToRole(role);
    } catch (error) {
      this.logger.error(`Failed to create role: ${createRoleDto.name}`, error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
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

      const role = await this.prisma.rbacRole.findUnique({
        where: { id: roleId },
        include: {
          permissions: {
            include: {
              permission: true,
            },
          },
        },
      });

      if (!role) {
        return null;
      }

      const mappedRole = this.mapToRole(role);
      
      // Cache the result
      await this.redis.set(cacheKey, mappedRole, this.CACHE_TTL);

      return mappedRole;
    } catch (error) {
      this.logger.error(`Failed to get role by ID: ${roleId}`, error instanceof Error ? (error as Error).stack : 'No stack trace available');
      return null;
    }
  }

  /**
   * Get role by name
   */
  async getRoleByName(name: string, domain?: string, clinicId?: string): Promise<Role | null> {
    try {
      const cacheKey = `${this.CACHE_PREFIX}name:${name}:${domain || 'null'}:${clinicId || 'null'}`;
      const cached = await this.redis.get<Role>(cacheKey);
      
      if (cached) {
        return cached;
      }

      const role = await this.prisma.rbacRole.findFirst({
        where: {
          name,
          domain,
          clinicId,
        },
        include: {
          permissions: {
            include: {
              permission: true,
            },
          },
        },
      });

      if (!role) {
        return null;
      }

      const mappedRole = this.mapToRole(role);
      
      // Cache the result
      await this.redis.set(cacheKey, mappedRole, this.CACHE_TTL);

      return mappedRole;
    } catch (error) {
      this.logger.error(`Failed to get role by name: ${name}`, error instanceof Error ? (error as Error).stack : 'No stack trace available');
      return null;
    }
  }

  /**
   * Get all roles
   */
  async getRoles(domain?: string, clinicId?: string): Promise<Role[]> {
    try {
      const cacheKey = `${this.CACHE_PREFIX}list:${domain || 'null'}:${clinicId || 'null'}`;
      const cached = await this.redis.get<Role[]>(cacheKey);
      
      if (cached) {
        return cached;
      }

      const roles = await this.prisma.rbacRole.findMany({
        where: {
          domain,
          clinicId,
          isActive: true,
        },
        include: {
          permissions: {
            include: {
              permission: true,
            },
          },
        },
        orderBy: [
          { isSystemRole: 'desc' },
          { name: 'asc' },
        ],
      });

      const mappedRoles = roles.map((role: any) => this.mapToRole(role));
      
      // Cache the result
      await this.redis.set(cacheKey, mappedRoles, this.CACHE_TTL);

      return mappedRoles;
    } catch (error) {
      this.logger.error('Failed to get roles', error instanceof Error ? (error as Error).stack : 'No stack trace available');
      return [];
    }
  }

  /**
   * Update role
   */
  async updateRole(roleId: string, updateRoleDto: UpdateRoleDto): Promise<Role> {
    try {
      const existingRole = await this.prisma.rbacRole.findUnique({
        where: { id: roleId },
      });

      if (!existingRole) {
        throw new NotFoundException(`Role with ID ${roleId} not found`);
      }

      if (existingRole.isSystemRole) {
        throw new Error('Cannot modify system roles');
      }

      // Update role
      const role = await this.prisma.rbacRole.update({
        where: { id: roleId },
        data: {
          displayName: updateRoleDto.displayName,
          description: updateRoleDto.description,
          isActive: updateRoleDto.isActive,
          updatedAt: new Date(),
        },
        include: {
          permissions: {
            include: {
              permission: true,
            },
          },
        },
      });

      // Update permissions if provided
      if (updateRoleDto.permissions) {
        await this.updateRolePermissions(roleId, updateRoleDto.permissions);
      }

      // Clear cache
      await this.clearRoleCache();

      this.logger.log(`Role updated: ${role.name} (${role.id})`);

      return this.mapToRole(role);
    } catch (error) {
      this.logger.error(`Failed to update role: ${roleId}`, error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
    }
  }

  /**
   * Delete role
   */
  async deleteRole(roleId: string): Promise<void> {
    try {
      const role = await this.prisma.rbacRole.findUnique({
        where: { id: roleId },
      });

      if (!role) {
        throw new NotFoundException(`Role with ID ${roleId} not found`);
      }

      if (role.isSystemRole) {
        throw new Error('Cannot delete system roles');
      }

      // Check if role is assigned to any users
      const userRoles = await this.prisma.userRole.count({
        where: {
          roleId,
          isActive: true,
        },
      });

      if (userRoles > 0) {
        throw new Error('Cannot delete role that is assigned to users');
      }

      // Soft delete role
      await this.prisma.rbacRole.update({
        where: { id: roleId },
        data: {
          isActive: false,
          updatedAt: new Date(),
        },
      });

      // Clear cache
      await this.clearRoleCache();

      this.logger.log(`Role deleted: ${role.name} (${role.id})`);
    } catch (error) {
      this.logger.error(`Failed to delete role: ${roleId}`, error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
    }
  }

  /**
   * Assign permissions to role
   */
  async assignPermissionsToRole(roleId: string, permissionIds: string[]): Promise<void> {
    try {
      // Remove existing permissions
      await this.prisma.rolePermission.deleteMany({
        where: { roleId },
      });

      // Add new permissions
      if (permissionIds.length > 0) {
        await this.prisma.rolePermission.createMany({
          data: permissionIds.map(permissionId => ({
            roleId,
            permissionId,
            isActive: true,
            assignedAt: new Date(),
          })),
        });
      }

      // Clear cache
      await this.clearRoleCache();

      this.logger.log(`Permissions assigned to role ${roleId}: ${permissionIds.length} permissions`);
    } catch (error) {
      this.logger.error(`Failed to assign permissions to role: ${roleId}`, error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
    }
  }

  /**
   * Remove permissions from role
   */
  async removePermissionsFromRole(roleId: string, permissionIds: string[]): Promise<void> {
    try {
      await this.prisma.rolePermission.deleteMany({
        where: {
          roleId,
          permissionId: { in: permissionIds },
        },
      });

      // Clear cache
      await this.clearRoleCache();

      this.logger.log(`Permissions removed from role ${roleId}: ${permissionIds.length} permissions`);
    } catch (error) {
      this.logger.error(`Failed to remove permissions from role: ${roleId}`, error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
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
  async getSystemRoles(): Promise<Role[]> {
    try {
      const roles = await this.getRoles();
      return roles.filter(role => role.isSystemRole);
    } catch (error) {
      this.logger.error('Failed to get system roles', error instanceof Error ? (error as Error).stack : 'No stack trace available');
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
          domain: 'healthcare',
        },
        {
          name: 'CLINIC_ADMIN',
          displayName: 'Clinic Administrator',
          description: 'Full clinic management access',
          domain: 'healthcare',
        },
        {
          name: 'DOCTOR',
          displayName: 'Doctor',
          description: 'Medical practitioner access',
          domain: 'healthcare',
        },
        {
          name: 'NURSE',
          displayName: 'Nurse',
          description: 'Nursing staff access',
          domain: 'healthcare',
        },
        {
          name: 'RECEPTIONIST',
          displayName: 'Receptionist',
          description: 'Front desk staff access',
          domain: 'healthcare',
        },
        {
          name: 'PATIENT',
          displayName: 'Patient',
          description: 'Patient access to own records',
          domain: 'healthcare',
        },
      ];

      for (const roleData of systemRoles) {
        const existingRole = await this.getRoleByName(roleData.name, roleData.domain);
        
        if (!existingRole) {
          await this.prisma.rbacRole.create({
            data: {
              ...roleData,
              isSystemRole: true,
              isActive: true,
            },
          });
          
          this.logger.log(`System role created: ${roleData.name}`);
        }
      }

      await this.clearRoleCache();
    } catch (error) {
      this.logger.error('Failed to initialize system roles', error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
    }
  }

  /**
   * Map database role to Role interface
   */
  private mapToRole(role: any): Role {
    return {
      id: role.id,
      name: role.name,
      displayName: role.displayName,
      description: role.description || undefined,
      domain: role.domain,
      clinicId: role.clinicId,
      isSystemRole: role.isSystemRole,
      isActive: role.isActive,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
      permissions: role.permissions?.map((rp: any) => ({
        id: rp.permission.id,
        name: rp.permission.name,
        resource: rp.permission.resource,
        action: rp.permission.action,
        description: rp.permission.description || undefined,
        isActive: rp.permission.isActive,
      })),
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
    } catch (error) {
      this.logger.error('Failed to clear role cache', error instanceof Error ? (error as Error).stack : 'No stack trace available');
    }
  }
}