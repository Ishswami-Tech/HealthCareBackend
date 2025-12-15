/**
 * User Role-related database methods
 * Code splitting: User Role convenience methods extracted from database.service.ts
 */

import { DatabaseMethodsBase } from './database-methods.base';
import type { UserRoleEntity, RolePermissionEntity } from '@core/types/database.types';

/**
 * User Role methods implementation
 * All methods use executeRead/Write for full optimization layers
 */
export class UserRoleMethods extends DatabaseMethodsBase {
  /**
   * Find user role assignment
   */
  async findUserRoleAssignmentSafe(
    userId: string,
    roleId: string,
    clinicId?: string
  ): Promise<UserRoleEntity | null> {
    return await this.executeRead<UserRoleEntity | null>(
      async prisma => {
        return await prisma.userRole.findFirst({
          where: {
            userId,
            roleId,
            ...(clinicId && { clinicId }),
          },
        });
      },
      this.queryOptionsBuilder
        .where({ userId, roleId, ...(clinicId && { clinicId }) })
        .clinicId(clinicId || '')
        .useCache(true)
        .cacheStrategy('short')
        .priority('normal')
        .hipaaCompliant(false)
        .rowLevelSecurity(clinicId ? true : false)
        .build()
    );
  }

  /**
   * Create user role
   */
  async createUserRoleSafe(data: {
    userId: string;
    roleId: string;
    clinicId?: string | null;
    assignedBy?: string;
    expiresAt?: Date | null;
    isActive?: boolean;
    isPrimary?: boolean;
    permissions?: Record<string, never>;
    schedule?: Record<string, never>;
  }): Promise<UserRoleEntity> {
    const result = await this.executeWrite<UserRoleEntity>(
      async prisma => {
        return await prisma.userRole.create({
          data,
        });
      },
      {
        userId: data.assignedBy ?? 'system',
        userRole: 'system',
        clinicId: data.clinicId ?? '',
        operation: 'CREATE_USER_ROLE',
        resourceType: 'USER_ROLE',
        resourceId: 'pending',
        timestamp: new Date(),
      },
      this.queryOptionsBuilder
        .where({
          userId: data.userId,
          roleId: data.roleId,
          ...(data.clinicId && { clinicId: data.clinicId }),
        })
        .clinicId(data.clinicId || '')
        .useCache(false)
        .priority('normal')
        .hipaaCompliant(false)
        .rowLevelSecurity(data.clinicId ? true : false)
        .retries(2)
        .build()
    );

    if (result?.id) {
      await this.invalidateCache([
        `user:${data.userId}:roles`,
        `role:${data.roleId}:users`,
        'userRoles',
      ]);
    }

    return result;
  }

  /**
   * Find user role for revocation
   */
  async findUserRoleForRevocationSafe(
    userId: string,
    roleId: string,
    clinicId?: string
  ): Promise<UserRoleEntity | null> {
    return await this.executeRead<UserRoleEntity | null>(
      async prisma => {
        return await prisma.userRole.findFirst({
          where: {
            userId,
            roleId,
            isActive: true,
            ...(clinicId && { clinicId }),
          },
        });
      },
      this.queryOptionsBuilder
        .where({ userId, roleId, isActive: true, ...(clinicId && { clinicId }) })
        .clinicId(clinicId || '')
        .useCache(true)
        .cacheStrategy('short')
        .priority('normal')
        .hipaaCompliant(false)
        .rowLevelSecurity(clinicId ? true : false)
        .build()
    );
  }

  /**
   * Update user role
   */
  async updateUserRoleSafe(
    id: string,
    data: {
      isActive?: boolean;
      revokedAt?: Date | null;
      revokedBy?: string | null;
      expiresAt?: Date | null;
      updatedAt: Date;
    }
  ): Promise<UserRoleEntity> {
    const result = await this.executeWrite<UserRoleEntity>(
      async prisma => {
        return await prisma.userRole.update({
          where: { id },
          data,
        });
      },
      {
        userId: data.revokedBy ?? 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'UPDATE_USER_ROLE',
        resourceType: 'USER_ROLE',
        resourceId: id,
        timestamp: new Date(),
      },
      this.queryOptionsBuilder
        .where({ id })
        .useCache(false)
        .priority('normal')
        .hipaaCompliant(false)
        .rowLevelSecurity(false)
        .retries(2)
        .build()
    );

    await this.invalidateCache([`userRole:${id}`, 'userRoles']);

    return result;
  }

  /**
   * Find user roles
   * Includes role relation for RBAC service compatibility
   */
  async findUserRolesSafe(userId: string, clinicId?: string): Promise<UserRoleEntity[]> {
    return await this.executeRead<UserRoleEntity[]>(
      async prisma => {
        return await prisma.userRole.findMany({
          where: {
            userId,
            ...(clinicId && { clinicId }),
            isActive: true, // Only return active role assignments
          },
          include: {
            role: {
              select: {
                name: true, // Include role name for RBAC service
              },
            },
          },
        });
      },
      this.queryOptionsBuilder
        .where({ userId, isActive: true, ...(clinicId && { clinicId }) })
        .include({ role: { select: { name: true } } })
        .clinicId(clinicId || '')
        .useCache(true)
        .cacheStrategy('short')
        .priority('normal')
        .hipaaCompliant(false)
        .rowLevelSecurity(clinicId ? true : false)
        .build()
    );
  }

  /**
   * Find role permissions
   */
  async findRolePermissionsSafe(
    roleIds: string[]
  ): Promise<Array<RolePermissionEntity & { permission: { resource: string; action: string } }>> {
    return await this.executeRead<
      Array<RolePermissionEntity & { permission: { resource: string; action: string } }>
    >(
      async prisma => {
        const results = await prisma.rolePermission.findMany({
          where: {
            roleId: { in: roleIds },
          },
          include: {
            permission: {
              select: {
                resource: true,
                action: true,
              },
            },
          },
        });
        return results as Array<
          RolePermissionEntity & { permission: { resource: string; action: string } }
        >;
      },
      this.queryOptionsBuilder
        .where({ roleId: { in: roleIds } })
        .include({ permission: { select: { resource: true, action: true } } })
        .useCache(true)
        .cacheStrategy('short')
        .priority('normal')
        .hipaaCompliant(false)
        .rowLevelSecurity(false)
        .build()
    );
  }
}
