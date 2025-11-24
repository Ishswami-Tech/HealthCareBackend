/**
 * Role-related database methods
 * Code splitting: Role convenience methods extracted from database.service.ts
 */

import { DatabaseMethodsBase } from './database-methods.base';
import type { RbacRoleEntity } from '@core/types/database.types';

/**
 * Role methods implementation
 * All methods use executeRead/Write for full optimization layers
 */
export class RoleMethods extends DatabaseMethodsBase {
  /**
   * Find role by name
   */
  async findRoleByNameSafe(name: string, clinicId?: string): Promise<RbacRoleEntity | null> {
    return await this.executeRead<RbacRoleEntity | null>(async prisma => {
      return await prisma.rbacRole.findUnique({
        where: {
          name_domain_clinicId: {
            name,
            domain: 'healthcare',
            clinicId: clinicId || null,
          },
        },
      });
    }, this.queryOptionsBuilder.useCache(true).cacheStrategy('long').priority('normal').hipaaCompliant(false).build());
  }

  /**
   * Find role by ID
   */
  async findRoleByIdSafe(id: string): Promise<RbacRoleEntity | null> {
    return await this.executeRead<RbacRoleEntity | null>(async prisma => {
      return await prisma.rbacRole.findUnique({
        where: { id },
      });
    }, this.queryOptionsBuilder.useCache(true).cacheStrategy('long').priority('normal').hipaaCompliant(false).build());
  }

  /**
   * Create role
   */
  async createRoleSafe(data: {
    name: string;
    displayName: string;
    description?: string | null;
    clinicId?: string | null;
    isSystemRole?: boolean;
    isActive?: boolean;
  }): Promise<RbacRoleEntity> {
    const result = await this.executeWrite<RbacRoleEntity>(
      async prisma => {
        return await prisma.rbacRole.create({
          data: {
            ...data,
            domain: 'healthcare',
          },
        });
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: data.clinicId ?? '',
        operation: 'CREATE_ROLE',
        resourceType: 'ROLE',
        resourceId: 'pending',
        timestamp: new Date(),
      }
    );

    if (result?.id) {
      await this.invalidateCache([`role:${result.id}`, 'roles']);
    }

    return result;
  }

  /**
   * Find roles by clinic
   */
  async findRolesByClinicSafe(clinicId?: string): Promise<RbacRoleEntity[]> {
    return await this.executeRead<RbacRoleEntity[]>(async prisma => {
      return await prisma.rbacRole.findMany({
        where: {
          ...(clinicId && { clinicId }),
        },
      });
    }, this.queryOptionsBuilder.useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(false).build());
  }

  /**
   * Update role
   */
  async updateRoleSafe(
    id: string,
    data: {
      displayName?: string;
      description?: string | null;
      isActive?: boolean;
      updatedAt: Date;
    }
  ): Promise<RbacRoleEntity> {
    const result = await this.executeWrite<RbacRoleEntity>(
      async prisma => {
        return await prisma.rbacRole.update({
          where: { id },
          data,
        });
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'UPDATE_ROLE',
        resourceType: 'ROLE',
        resourceId: id,
        timestamp: new Date(),
      }
    );

    await this.invalidateCache([`role:${id}`, 'roles']);

    return result;
  }

  /**
   * Count user roles
   */
  async countUserRolesSafe(roleId: string): Promise<number> {
    return await this.executeRead<number>(async prisma => {
      return await prisma.userRole.count({
        where: { roleId },
      });
    }, this.queryOptionsBuilder.useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(false).build());
  }

  /**
   * Delete role permissions
   */
  async deleteRolePermissionsSafe(roleId: string): Promise<{ count: number }> {
    const result = await this.executeWrite<{ count: number }>(
      async prisma => {
        const deleted = await prisma.rolePermission.deleteMany({
          where: { roleId },
        });
        return { count: deleted.count };
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'DELETE_ROLE_PERMISSIONS',
        resourceType: 'ROLE_PERMISSION',
        resourceId: roleId,
        timestamp: new Date(),
      }
    );

    await this.invalidateCache([`role:${roleId}`, 'rolePermissions']);

    return result;
  }

  /**
   * Create role permissions
   */
  async createRolePermissionsSafe(
    permissions: Array<{ roleId: string; permissionId: string }>
  ): Promise<{ count: number }> {
    const result = await this.executeWrite<{ count: number }>(
      async prisma => {
        const created = await prisma.rolePermission.createMany({
          data: permissions,
          skipDuplicates: true,
        });
        return { count: created.count };
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'CREATE_ROLE_PERMISSIONS',
        resourceType: 'ROLE_PERMISSION',
        resourceId: permissions[0]?.roleId ?? 'unknown',
        timestamp: new Date(),
      }
    );

    if (permissions[0]?.roleId) {
      await this.invalidateCache([`role:${permissions[0].roleId}`, 'rolePermissions']);
    }

    return result;
  }

  /**
   * Remove role permissions
   */
  async removeRolePermissionsSafe(
    roleId: string,
    permissionIds: string[]
  ): Promise<{ count: number }> {
    const result = await this.executeWrite<{ count: number }>(
      async prisma => {
        const deleted = await prisma.rolePermission.deleteMany({
          where: {
            roleId,
            permissionId: { in: permissionIds },
          },
        });
        return { count: deleted.count };
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'REMOVE_ROLE_PERMISSIONS',
        resourceType: 'ROLE_PERMISSION',
        resourceId: roleId,
        timestamp: new Date(),
      }
    );

    await this.invalidateCache([`role:${roleId}`, 'rolePermissions']);

    return result;
  }

  /**
   * Create system role
   */
  async createSystemRoleSafe(data: {
    name: string;
    displayName: string;
    description?: string | null;
    clinicId?: string | null;
    isSystemRole?: boolean;
    isActive?: boolean;
  }): Promise<RbacRoleEntity> {
    const result = await this.executeWrite<RbacRoleEntity>(
      async prisma => {
        return await prisma.rbacRole.create({
          data: {
            ...data,
            domain: 'healthcare',
            isSystemRole: true,
          },
        });
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: data.clinicId ?? '',
        operation: 'CREATE_SYSTEM_ROLE',
        resourceType: 'ROLE',
        resourceId: 'pending',
        timestamp: new Date(),
      }
    );

    if (result?.id) {
      await this.invalidateCache([`role:${result.id}`, 'roles', 'systemRoles']);
    }

    return result;
  }
}
