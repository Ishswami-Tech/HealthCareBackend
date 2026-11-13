/**
 * Permission-related database methods
 * Code splitting: Permission convenience methods extracted from database.service.ts
 */

import { DatabaseMethodsBase } from './database-methods.base';
import type { PermissionEntity } from '@core/types/rbac.types';

/**
 * Permission methods implementation
 * All methods use executeRead/Write for full optimization layers
 *
 * Reads are cached 'short' (5 min), not 'long': writes through executeWrite clear the query
 * cache at once, but an authorization change made outside the app (seed, manual SQL) must not
 * keep granting or denying access for up to an hour.
 */
export class PermissionMethods extends DatabaseMethodsBase {
  /**
   * Create permission
   */
  async createPermissionSafe(data: {
    name: string;
    resource: string;
    action: string;
    description?: string | null;
    isSystemPermission?: boolean;
    isActive?: boolean;
  }): Promise<PermissionEntity> {
    const result = await this.executeWrite<PermissionEntity>(
      async prisma => {
        const createData = {
          ...data,
          domain: 'healthcare',
        };

        try {
          return await prisma.permission.create({
            data: createData,
          });
        } catch (error) {
          const errorCode = (error as { code?: string } | null | undefined)?.code;
          if (errorCode !== 'P2002') {
            throw error;
          }

          const existing = await prisma.permission.findUnique({
            where: {
              resource_action_domain: {
                resource: data.resource,
                action: data.action,
                domain: 'healthcare',
              },
            },
          });

          if (existing) {
            return existing;
          }

          throw error;
        }
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'CREATE_PERMISSION',
        resourceType: 'PERMISSION',
        resourceId: 'pending',
        timestamp: new Date(),
      }
    );

    if (result?.id) {
      await this.invalidateCache([`permission:${result.id}`, 'permissions']);
    }

    return result;
  }

  /**
   * Find permission by ID
   */
  async findPermissionByIdSafe(id: string): Promise<PermissionEntity | null> {
    return await this.executeRead<PermissionEntity | null>(async prisma => {
      return await prisma.permission.findUnique({
        where: { id },
      });
    }, this.queryOptionsBuilder.operation('findPermissionByIdSafe').where({ id }).useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(false).build());
  }

  /**
   * Find permission by resource and action
   */
  async findPermissionByResourceActionSafe(
    resource: string,
    action: string
  ): Promise<PermissionEntity | null> {
    return await this.executeRead<PermissionEntity | null>(async prisma => {
      return await prisma.permission.findUnique({
        where: {
          resource_action_domain: {
            resource,
            action,
            domain: 'healthcare',
          },
        },
      });
    }, this.queryOptionsBuilder.operation('findPermissionByResourceActionSafe').where({ resource, action }).useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(false).build());
  }

  /**
   * Find permissions by resource
   */
  async findPermissionsByResourceSafe(resource: string): Promise<PermissionEntity[]> {
    return await this.executeRead<PermissionEntity[]>(async prisma => {
      return await prisma.permission.findMany({
        where: {
          resource,
        },
      });
    }, this.queryOptionsBuilder.operation('findPermissionsByResourceSafe').where({ resource }).useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(false).build());
  }

  /**
   * Update permission
   */
  async updatePermissionSafe(
    id: string,
    data: Partial<{ name?: string; description?: string | null; isActive?: boolean }> & {
      updatedAt: Date;
    }
  ): Promise<PermissionEntity> {
    const result = await this.executeWrite<PermissionEntity>(
      async prisma => {
        return await prisma.permission.update({
          where: { id },
          data,
        });
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'UPDATE_PERMISSION',
        resourceType: 'PERMISSION',
        resourceId: id,
        timestamp: new Date(),
      }
    );

    await this.invalidateCache([`permission:${id}`, 'permissions']);

    return result;
  }

  /**
   * Count role permissions
   */
  async countRolePermissionsSafe(permissionId: string): Promise<number> {
    return await this.executeRead<number>(async prisma => {
      return await prisma.rolePermission.count({
        where: { permissionId },
      });
    }, this.queryOptionsBuilder.operation('countRolePermissionsSafe').where({ permissionId }).useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(false).build());
  }

  /**
   * Find system permissions
   */
  async findSystemPermissionsSafe(): Promise<PermissionEntity[]> {
    return await this.executeRead<PermissionEntity[]>(async prisma => {
      return await prisma.permission.findMany({
        where: { isSystemPermission: true },
      });
    }, this.queryOptionsBuilder.operation('findSystemPermissionsSafe').useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(false).build());
  }
}
