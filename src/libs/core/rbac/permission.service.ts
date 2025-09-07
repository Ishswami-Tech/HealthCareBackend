import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { RedisService } from '../../infrastructure/cache/redis/redis.service';

export interface Permission {
  id: string;
  name: string;
  resource: string;
  action: string;
  description?: string;
  domain: string;
  isSystemPermission: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePermissionDto {
  name: string;
  resource: string;
  action: string;
  description?: string;
  domain: string;
}

export interface UpdatePermissionDto {
  name?: string;
  description?: string;
  isActive?: boolean;
}

@Injectable()
export class PermissionService {
  private readonly logger = new Logger(PermissionService.name);
  private readonly CACHE_TTL = 3600; // 1 hour
  private readonly CACHE_PREFIX = 'permissions:';

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Create a new permission
   */
  async createPermission(createPermissionDto: CreatePermissionDto): Promise<Permission> {
    try {
      // Check if permission already exists
      const existing = await this.getPermissionByResourceAction(
        createPermissionDto.resource,
        createPermissionDto.action,
        createPermissionDto.domain
      );

      if (existing) {
        throw new Error(`Permission '${createPermissionDto.resource}:${createPermissionDto.action}' already exists`);
      }

      const permission = await this.prisma.permission.create({
        data: {
          name: createPermissionDto.name,
          resource: createPermissionDto.resource,
          action: createPermissionDto.action,
          description: createPermissionDto.description,
          domain: createPermissionDto.domain,
          isSystemPermission: false,
          isActive: true,
        },
      });

      await this.clearPermissionCache();

      this.logger.log(`Permission created: ${permission.name} (${permission.id})`);

      return this.mapToPermission(permission);
    } catch (error) {
      this.logger.error(`Failed to create permission: ${createPermissionDto.name}`, (error as Error).stack);
      throw error;
    }
  }

  /**
   * Get permission by ID
   */
  async getPermissionById(permissionId: string): Promise<Permission | null> {
    try {
      const cacheKey = `${this.CACHE_PREFIX}id:${permissionId}`;
      const cached = await this.redis.get<Permission>(cacheKey);
      
      if (cached) {
        return cached;
      }

      const permission = await this.prisma.permission.findUnique({
        where: { id: permissionId },
      });

      if (!permission) {
        return null;
      }

      const mappedPermission = this.mapToPermission(permission);
      
      await this.redis.set(cacheKey, mappedPermission, this.CACHE_TTL);

      return mappedPermission;
    } catch (error) {
      this.logger.error(`Failed to get permission by ID: ${permissionId}`, (error as Error).stack);
      return null;
    }
  }

  /**
   * Get permission by resource and action
   */
  async getPermissionByResourceAction(
    resource: string,
    action: string,
    domain?: string
  ): Promise<Permission | null> {
    try {
      const cacheKey = `${this.CACHE_PREFIX}resource:${resource}:${action}:${domain || 'null'}`;
      const cached = await this.redis.get<Permission>(cacheKey);
      
      if (cached) {
        return cached;
      }

      const permission = await this.prisma.permission.findFirst({
        where: {
          resource,
          action,
          domain,
        },
      });

      if (!permission) {
        return null;
      }

      const mappedPermission = this.mapToPermission(permission);
      
      await this.redis.set(cacheKey, mappedPermission, this.CACHE_TTL);

      return mappedPermission;
    } catch (error) {
      this.logger.error(`Failed to get permission: ${resource}:${action}`, (error as Error).stack);
      return null;
    }
  }

  /**
   * Get all permissions
   */
  async getPermissions(domain?: string, resource?: string): Promise<Permission[]> {
    try {
      const cacheKey = `${this.CACHE_PREFIX}list:${domain || 'null'}:${resource || 'null'}`;
      const cached = await this.redis.get<Permission[]>(cacheKey);
      
      if (cached) {
        return cached;
      }

      const permissions = await this.prisma.permission.findMany({
        where: {
          domain,
          resource,
          isActive: true,
        },
        orderBy: [
          { resource: 'asc' },
          { action: 'asc' },
        ],
      });

      const mappedPermissions = permissions.map(permission => this.mapToPermission(permission));
      
      await this.redis.set(cacheKey, mappedPermissions, this.CACHE_TTL);

      return mappedPermissions;
    } catch (error) {
      this.logger.error('Failed to get permissions', (error as Error).stack);
      return [];
    }
  }

  /**
   * Update permission
   */
  async updatePermission(permissionId: string, updatePermissionDto: UpdatePermissionDto): Promise<Permission> {
    try {
      const existingPermission = await this.prisma.permission.findUnique({
        where: { id: permissionId },
      });

      if (!existingPermission) {
        throw new NotFoundException(`Permission with ID ${permissionId} not found`);
      }

      if (existingPermission.isSystemPermission) {
        throw new Error('Cannot modify system permissions');
      }

      const permission = await this.prisma.permission.update({
        where: { id: permissionId },
        data: {
          name: updatePermissionDto.name,
          description: updatePermissionDto.description,
          isActive: updatePermissionDto.isActive,
          updatedAt: new Date(),
        },
      });

      await this.clearPermissionCache();

      this.logger.log(`Permission updated: ${permission.name} (${permission.id})`);

      return this.mapToPermission(permission);
    } catch (error) {
      this.logger.error(`Failed to update permission: ${permissionId}`, (error as Error).stack);
      throw error;
    }
  }

  /**
   * Delete permission
   */
  async deletePermission(permissionId: string): Promise<void> {
    try {
      const permission = await this.prisma.permission.findUnique({
        where: { id: permissionId },
      });

      if (!permission) {
        throw new NotFoundException(`Permission with ID ${permissionId} not found`);
      }

      if (permission.isSystemPermission) {
        throw new Error('Cannot delete system permissions');
      }

      // Check if permission is assigned to any roles
      const rolePermissions = await this.prisma.rolePermission.count({
        where: {
          permissionId,
          isActive: true,
        },
      });

      if (rolePermissions > 0) {
        throw new Error('Cannot delete permission that is assigned to roles');
      }

      // Soft delete permission
      await this.prisma.permission.update({
        where: { id: permissionId },
        data: {
          isActive: false,
          updatedAt: new Date(),
        },
      });

      await this.clearPermissionCache();

      this.logger.log(`Permission deleted: ${permission.name} (${permission.id})`);
    } catch (error) {
      this.logger.error(`Failed to delete permission: ${permissionId}`, (error as Error).stack);
      throw error;
    }
  }

  /**
   * Get permissions by resource
   */
  async getPermissionsByResource(resource: string, domain?: string): Promise<Permission[]> {
    return this.getPermissions(domain, resource);
  }

  /**
   * Get system permissions
   */
  async getSystemPermissions(): Promise<Permission[]> {
    try {
      const permissions = await this.prisma.permission.findMany({
        where: {
          isSystemPermission: true,
          isActive: true,
        },
        orderBy: [
          { resource: 'asc' },
          { action: 'asc' },
        ],
      });

      return permissions.map(permission => this.mapToPermission(permission));
    } catch (error) {
      this.logger.error('Failed to get system permissions', (error as Error).stack);
      return [];
    }
  }

  /**
   * Initialize system permissions
   */
  async initializeSystemPermissions(): Promise<void> {
    try {
      const systemPermissions = [
        // User management
        { name: 'Read Users', resource: 'users', action: 'read', description: 'View user information' },
        { name: 'Create Users', resource: 'users', action: 'create', description: 'Create new users' },
        { name: 'Update Users', resource: 'users', action: 'update', description: 'Update user information' },
        { name: 'Delete Users', resource: 'users', action: 'delete', description: 'Delete users' },
        { name: 'Manage Users', resource: 'users', action: '*', description: 'Full user management access' },

        // Appointment management
        { name: 'Read Appointments', resource: 'appointments', action: 'read', description: 'View appointments' },
        { name: 'Create Appointments', resource: 'appointments', action: 'create', description: 'Create new appointments' },
        { name: 'Update Appointments', resource: 'appointments', action: 'update', description: 'Update appointments' },
        { name: 'Delete Appointments', resource: 'appointments', action: 'delete', description: 'Delete appointments' },
        { name: 'Manage Appointments', resource: 'appointments', action: '*', description: 'Full appointment management' },

        // Patient management
        { name: 'Read Patients', resource: 'patients', action: 'read', description: 'View patient information' },
        { name: 'Create Patients', resource: 'patients', action: 'create', description: 'Create new patients' },
        { name: 'Update Patients', resource: 'patients', action: 'update', description: 'Update patient information' },
        { name: 'Delete Patients', resource: 'patients', action: 'delete', description: 'Delete patients' },
        { name: 'Manage Patients', resource: 'patients', action: '*', description: 'Full patient management' },

        // Medical records
        { name: 'Read Medical Records', resource: 'medical-records', action: 'read', description: 'View medical records' },
        { name: 'Create Medical Records', resource: 'medical-records', action: 'create', description: 'Create medical records' },
        { name: 'Update Medical Records', resource: 'medical-records', action: 'update', description: 'Update medical records' },
        { name: 'Delete Medical Records', resource: 'medical-records', action: 'delete', description: 'Delete medical records' },
        { name: 'Manage Medical Records', resource: 'medical-records', action: '*', description: 'Full medical records access' },

        // Prescriptions
        { name: 'Read Prescriptions', resource: 'prescriptions', action: 'read', description: 'View prescriptions' },
        { name: 'Create Prescriptions', resource: 'prescriptions', action: 'create', description: 'Create prescriptions' },
        { name: 'Update Prescriptions', resource: 'prescriptions', action: 'update', description: 'Update prescriptions' },
        { name: 'Delete Prescriptions', resource: 'prescriptions', action: 'delete', description: 'Delete prescriptions' },
        { name: 'Manage Prescriptions', resource: 'prescriptions', action: '*', description: 'Full prescription management' },

        // Clinic management
        { name: 'Read Clinics', resource: 'clinics', action: 'read', description: 'View clinic information' },
        { name: 'Update Clinics', resource: 'clinics', action: 'update', description: 'Update clinic settings' },
        { name: 'Manage Clinics', resource: 'clinics', action: '*', description: 'Full clinic management' },

        // Reports
        { name: 'Read Reports', resource: 'reports', action: 'read', description: 'View reports' },
        { name: 'Create Reports', resource: 'reports', action: 'create', description: 'Generate reports' },
        { name: 'Manage Reports', resource: 'reports', action: '*', description: 'Full report management' },

        // Settings
        { name: 'Read Settings', resource: 'settings', action: 'read', description: 'View system settings' },
        { name: 'Update Settings', resource: 'settings', action: 'update', description: 'Update system settings' },
        { name: 'Manage Settings', resource: 'settings', action: '*', description: 'Full settings management' },

        // Billing
        { name: 'Read Billing', resource: 'billing', action: 'read', description: 'View billing information' },
        { name: 'Create Billing', resource: 'billing', action: 'create', description: 'Create billing records' },
        { name: 'Update Billing', resource: 'billing', action: 'update', description: 'Update billing information' },
        { name: 'Manage Billing', resource: 'billing', action: '*', description: 'Full billing management' },

        // Vitals
        { name: 'Read Vitals', resource: 'vitals', action: 'read', description: 'View vital signs' },
        { name: 'Create Vitals', resource: 'vitals', action: 'create', description: 'Record vital signs' },
        { name: 'Update Vitals', resource: 'vitals', action: 'update', description: 'Update vital signs' },
        { name: 'Manage Vitals', resource: 'vitals', action: '*', description: 'Full vitals management' },

        // Profile
        { name: 'Read Profile', resource: 'profile', action: 'read', description: 'View own profile' },
        { name: 'Update Profile', resource: 'profile', action: 'update', description: 'Update own profile' },

        // System administration
        { name: 'System Administration', resource: '*', action: '*', description: 'Full system access' },
      ];

      for (const permissionData of systemPermissions) {
        const existing = await this.getPermissionByResourceAction(
          permissionData.resource,
          permissionData.action,
          'healthcare'
        );

        if (!existing) {
          await this.prisma.permission.create({
            data: {
              ...permissionData,
              domain: 'healthcare',
              isSystemPermission: true,
              isActive: true,
            },
          });

          this.logger.log(`System permission created: ${permissionData.name}`);
        }
      }

      await this.clearPermissionCache();
    } catch (error) {
      this.logger.error('Failed to initialize system permissions', (error as Error).stack);
      throw error;
    }
  }

  /**
   * Bulk create permissions
   */
  async bulkCreatePermissions(permissions: CreatePermissionDto[]): Promise<Permission[]> {
    try {
      const results: Permission[] = [];

      for (const permissionData of permissions) {
        try {
          const permission = await this.createPermission(permissionData);
          results.push(permission);
        } catch (error) {
          this.logger.warn(`Failed to create permission: ${permissionData.name}`, (error as Error).message);
        }
      }

      return results;
    } catch (error) {
      this.logger.error('Bulk permission creation failed', (error as Error).stack);
      throw error;
    }
  }

  /**
   * Get permissions summary
   */
  async getPermissionsSummary(domain?: string): Promise<{
    totalPermissions: number;
    systemPermissions: number;
    customPermissions: number;
    resourceBreakdown: Record<string, number>;
    actionBreakdown: Record<string, number>;
  }> {
    try {
      const permissions = await this.getPermissions(domain);

      const summary = {
        totalPermissions: permissions.length,
        systemPermissions: permissions.filter(p => p.isSystemPermission).length,
        customPermissions: permissions.filter(p => !p.isSystemPermission).length,
        resourceBreakdown: {} as Record<string, number>,
        actionBreakdown: {} as Record<string, number>,
      };

      permissions.forEach(permission => {
        // Resource breakdown
        summary.resourceBreakdown[permission.resource] = 
          (summary.resourceBreakdown[permission.resource] || 0) + 1;

        // Action breakdown
        summary.actionBreakdown[permission.action] = 
          (summary.actionBreakdown[permission.action] || 0) + 1;
      });

      return summary;
    } catch (error) {
      this.logger.error('Failed to get permissions summary', (error as Error).stack);
      throw error;
    }
  }

  /**
   * Map database permission to Permission interface
   */
  private mapToPermission(permission: any): Permission {
    return {
      id: permission.id,
      name: permission.name,
      resource: permission.resource,
      action: permission.action,
      description: permission.description,
      domain: permission.domain,
      isSystemPermission: permission.isSystemPermission,
      isActive: permission.isActive,
      createdAt: permission.createdAt,
      updatedAt: permission.updatedAt,
    };
  }

  /**
   * Clear permission cache
   */
  private async clearPermissionCache(): Promise<void> {
    try {
      const keys = await this.redis.keys(`${this.CACHE_PREFIX}*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      this.logger.error('Failed to clear permission cache', (error as Error).stack);
    }
  }
}