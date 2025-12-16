import { Injectable, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache/cache.service';
// Use direct import to avoid TDZ issues with barrel exports
import { LoggingService } from '@infrastructure/logging/logging.service';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { LogType, LogLevel } from '@core/types';
import type {
  PermissionRecord,
  PermissionEntity as DomainPermissionEntity,
} from '@core/types/rbac.types';
import type { CreatePermissionDto, UpdatePermissionDto } from '@dtos/permission.dto';

/**
 * Permission entity structure interface for validation
 * Represents the structure returned by DatabaseService methods
 * (DatabaseService encapsulates PrismaService and applies all optimization layers)
 */
interface PermissionEntityStructure {
  readonly id: string;
  readonly name: string;
  readonly resource: string;
  readonly action: string;
  readonly description: string | null;
  readonly isSystemPermission: boolean;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Re-export PermissionRecord for backward compatibility
 * Use PermissionRecord from @core/types instead
 */
export type { PermissionRecord as Permission };

@Injectable()
export class PermissionService {
  private readonly CACHE_TTL = 3600; // 1 hour
  private readonly CACHE_PREFIX = 'permissions:';

  constructor(
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Type guard to validate permission entity structure
   */
  private isValidPermissionEntity(value: unknown): value is PermissionEntityStructure {
    if (!value || typeof value !== 'object') {
      return false;
    }
    const record = value as Record<string, unknown>;
    return (
      typeof record['id'] === 'string' &&
      typeof record['name'] === 'string' &&
      typeof record['resource'] === 'string' &&
      typeof record['action'] === 'string' &&
      (record['description'] === null ||
        record['description'] === undefined ||
        typeof record['description'] === 'string') &&
      typeof record['isSystemPermission'] === 'boolean' &&
      typeof record['isActive'] === 'boolean' &&
      record['createdAt'] instanceof Date &&
      record['updatedAt'] instanceof Date
    );
  }

  /**
   * Type-safe wrapper for DatabaseService permission methods (single result)
   * Validates structure and returns properly typed entity
   * Uses generic type to work around TypeScript strict mode limitations with Prisma types
   *
   * Note: DatabaseService encapsulates PrismaService - this method validates results from
   * DatabaseService's safe methods which already apply all optimization layers
   */
  private async getPrismaPermission<T>(
    promise: Promise<T | null>
  ): Promise<PermissionEntityStructure | null> {
    const result: T | null = await promise;
    if (result === null) {
      return null;
    }
    const resultUnknown = result as unknown;
    if (this.isValidPermissionEntity(resultUnknown)) {
      return resultUnknown;
    }
    throw new HealthcareError(
      ErrorCode.DATABASE_QUERY_FAILED,
      'Invalid permission entity structure from DatabaseService',
      undefined,
      {},
      'PermissionService.getPrismaPermission'
    );
  }

  /**
   * Type-safe wrapper for DatabaseService array methods
   * Uses generic type to work around TypeScript strict mode limitations with Prisma types
   *
   * Note: DatabaseService encapsulates PrismaService - this method validates results from
   * DatabaseService's safe methods which already apply all optimization layers
   */
  private async getPrismaPermissions<T>(
    promise: Promise<T[]>
  ): Promise<PermissionEntityStructure[]> {
    const results: T[] = await promise;
    return results.map(result => {
      const resultUnknown = result as unknown;
      if (this.isValidPermissionEntity(resultUnknown)) {
        return resultUnknown;
      }
      throw new HealthcareError(
        ErrorCode.DATABASE_QUERY_FAILED,
        'Invalid permission entity structure from DatabaseService',
        undefined,
        {},
        'PermissionService.getPrismaPermission'
      );
    });
  }

  /**
   * Type-safe helper to convert validated permission entity to DomainPermissionEntity
   * Input is already validated by getPrismaPermission/getPrismaPermissions
   */
  private toPermissionEntity(permission: PermissionEntityStructure): DomainPermissionEntity {
    // Direct mapping - structure is already validated
    const entity: DomainPermissionEntity = {
      id: permission.id,
      name: permission.name,
      resource: permission.resource,
      action: permission.action,
      description: permission.description,
      isSystemPermission: permission.isSystemPermission,
      isActive: permission.isActive,
      createdAt: permission.createdAt,
      updatedAt: permission.updatedAt,
    };
    return entity;
  }

  async createPermission(createPermissionDto: CreatePermissionDto): Promise<PermissionRecord> {
    try {
      const existingResult: PermissionRecord | null = await this.getPermissionByResourceAction(
        createPermissionDto.resource,
        createPermissionDto.action
      );
      const existing = existingResult;

      if (existing) {
        throw new HealthcareError(
          ErrorCode.DATABASE_DUPLICATE_ENTRY,
          `Permission '${createPermissionDto.resource}:${createPermissionDto.action}' already exists`,
          undefined,
          { resource: createPermissionDto.resource, action: createPermissionDto.action },
          'PermissionService.createPermission'
        );
      }

      // Use unified database client for optimized write operations with audit logging
      const permissionData = {
        name: createPermissionDto.name,
        resource: createPermissionDto.resource,
        action: createPermissionDto.action,
        description: createPermissionDto.description ?? null,
        isSystemPermission: false,
        isActive: true,
      };

      // Use DatabaseService's safe method - Prisma is fully encapsulated
      const permissionEntityInfraResult =
        await this.databaseService.createPermissionSafe(permissionData);

      const validatedResult = await this.getPrismaPermission(
        Promise.resolve(permissionEntityInfraResult)
      );
      // Convert Prisma entity to domain entity
      if (!validatedResult) {
        throw new HealthcareError(
          ErrorCode.DATABASE_QUERY_FAILED,
          'Failed to create permission: result is null',
          undefined,
          {},
          'PermissionService.createPermission'
        );
      }
      const permissionEntity = this.toPermissionEntity(validatedResult);

      await this.clearPermissionCache();

      const permission = this.mapToPermission(permissionEntity);
      void this.loggingService.log(
        LogType.AUDIT,
        LogLevel.INFO,
        'Permission created',
        'PermissionService',
        { permissionId: permission.id, name: permission.name }
      );

      return permission;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logError(`Failed to create permission: ${createPermissionDto.name}`, error);
      throw error instanceof Error ? error : new Error(errorMessage);
    }
  }

  async getPermissionById(permissionId: string): Promise<PermissionRecord | null> {
    try {
      const cacheKey = `${this.CACHE_PREFIX}id:${permissionId}`;
      const cached = await this.cacheService.get<PermissionRecord>(cacheKey);
      if (cached) {
        return cached;
      }

      // Use unified database client for optimized read operations with caching
      const permissionResultInfraResult =
        await this.databaseService.findPermissionByIdSafe(permissionId);

      const validatedResult = await this.getPrismaPermission(
        Promise.resolve(permissionResultInfraResult)
      );
      if (!validatedResult) {
        return null;
      }
      // Convert Prisma entity to domain entity (InfrastructurePermissionEntity from @infrastructure/database)
      const permissionResult = this.toPermissionEntity(validatedResult);
      const mappedPermission = this.mapToPermission(permissionResult);
      await this.cacheService.set(cacheKey, mappedPermission, this.CACHE_TTL);
      return mappedPermission;
    } catch (error: unknown) {
      this.logError(`Failed to get permission by ID: ${permissionId}`, error);
      return null;
    }
  }

  async getPermissionByResourceAction(
    resource: string,
    action: string
  ): Promise<PermissionRecord | null> {
    try {
      const cacheKey = `${this.CACHE_PREFIX}resource:${resource}:${action}`;
      const cached = await this.cacheService.get<PermissionRecord>(cacheKey);
      if (cached) {
        return cached;
      }

      // Use unified database client for optimized read operations with caching
      const permissionInfraResult = await this.databaseService.findPermissionByResourceActionSafe(
        resource,
        action
      );

      const validatedResult = await this.getPrismaPermission(
        Promise.resolve(permissionInfraResult)
      );
      if (!validatedResult) {
        return null;
      }
      // Convert Prisma entity to domain entity (InfrastructurePermissionEntity from @infrastructure/database)
      const permission = this.toPermissionEntity(validatedResult);
      const mappedPermission = this.mapToPermission(permission);
      await this.cacheService.set(cacheKey, mappedPermission, this.CACHE_TTL);
      return mappedPermission;
    } catch (error: unknown) {
      this.logError(`Failed to get permission: ${resource}:${action}`, error);
      return null;
    }
  }

  async getPermissions(resource?: string): Promise<PermissionRecord[]> {
    try {
      const cacheKey = `${this.CACHE_PREFIX}list:${resource || 'null'}`;
      const cached = await this.cacheService.get<PermissionRecord[]>(cacheKey);
      if (cached) {
        return cached;
      }

      // Use unified database client for optimized read operations with caching
      const permissionsInfraResult = await this.databaseService.findPermissionsByResourceSafe(
        resource || '*'
      );

      const validatedResults = await this.getPrismaPermissions(
        Promise.resolve(permissionsInfraResult)
      );
      // Convert Prisma entities to domain entities
      const mappedPermissions: PermissionRecord[] = validatedResults.map(pInfra => {
        const p = this.toPermissionEntity(pInfra);
        return this.mapToPermission(p);
      });

      await this.cacheService.set(cacheKey, mappedPermissions, this.CACHE_TTL);
      return mappedPermissions;
    } catch (error: unknown) {
      this.logError('Failed to get permissions', error);
      return [];
    }
  }

  async updatePermission(
    permissionId: string,
    updatePermissionDto: UpdatePermissionDto
  ): Promise<PermissionRecord> {
    try {
      // Use unified database client for optimized read operations
      const existingPermissionInfraResult =
        await this.databaseService.findPermissionByIdSafe(permissionId);

      const validatedResult = await this.getPrismaPermission(
        Promise.resolve(existingPermissionInfraResult)
      );
      if (!validatedResult) {
        throw new NotFoundException(`Permission with ID ${permissionId} not found`);
      }
      // Convert Prisma entity to domain entity (InfrastructurePermissionEntity from @infrastructure/database)
      const existingPerm = this.toPermissionEntity(validatedResult);
      if (existingPerm.isSystemPermission) {
        throw new HealthcareError(
          ErrorCode.OPERATION_NOT_ALLOWED,
          'Cannot modify system permissions',
          undefined,
          { permissionId },
          'PermissionService.updatePermission'
        );
      }

      // Use unified database client for optimized write operations with audit logging
      const updateData: {
        name?: string;
        description?: string | null;
        isActive?: boolean;
        updatedAt: Date;
      } = {
        updatedAt: new Date(),
      };
      if (updatePermissionDto.name !== undefined) {
        updateData.name = updatePermissionDto.name;
      }
      if (updatePermissionDto.description !== undefined) {
        updateData.description = updatePermissionDto.description ?? null;
      }
      if (updatePermissionDto.isActive !== undefined) {
        updateData.isActive = updatePermissionDto.isActive;
      }
      const permissionEntityInfraResult = await this.databaseService.updatePermissionSafe(
        permissionId,
        updateData
      );

      const validatedUpdateResult = await this.getPrismaPermission(
        Promise.resolve(permissionEntityInfraResult)
      );
      // Convert Prisma entity to domain entity
      if (!validatedUpdateResult) {
        throw new HealthcareError(
          ErrorCode.DATABASE_QUERY_FAILED,
          `Failed to update permission ${permissionId}: result is null`,
          undefined,
          { permissionId },
          'PermissionService.updatePermission'
        );
      }
      const permissionEntity = this.toPermissionEntity(validatedUpdateResult);

      await this.clearPermissionCache();

      const permission = this.mapToPermission(permissionEntity);
      void this.loggingService.log(
        LogType.AUDIT,
        LogLevel.INFO,
        'Permission updated',
        'PermissionService',
        { permissionId: permission.id, name: permission.name }
      );
      return permission;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logError(`Failed to update permission: ${permissionId}`, error);
      throw error instanceof Error ? error : new Error(errorMessage);
    }
  }

  async deletePermission(permissionId: string): Promise<void> {
    try {
      // Use unified database client for optimized read operations
      const permissionEntityInfraResult =
        await this.databaseService.findPermissionByIdSafe(permissionId);

      const validatedResult = await this.getPrismaPermission(
        Promise.resolve(permissionEntityInfraResult)
      );
      if (!validatedResult) {
        throw new NotFoundException(`Permission with ID ${permissionId} not found`);
      }
      // Convert Prisma entity to domain entity (InfrastructurePermissionEntity from @infrastructure/database)
      const permEntity = this.toPermissionEntity(validatedResult);
      if (permEntity.isSystemPermission) {
        throw new HealthcareError(
          ErrorCode.OPERATION_NOT_ALLOWED,
          'Cannot delete system permissions',
          undefined,
          { permissionId },
          'PermissionService.deletePermission'
        );
      }

      // Use unified database client for optimized read operations
      const rolePermissions = await this.databaseService.countRolePermissionsSafe(permissionId);
      if (rolePermissions > 0) {
        throw new HealthcareError(
          ErrorCode.OPERATION_NOT_ALLOWED,
          'Cannot delete permission that is assigned to roles',
          undefined,
          { permissionId },
          'PermissionService.deletePermission'
        );
      }

      // Use unified database client for optimized write operations with audit logging
      await this.databaseService.updatePermissionSafe(permissionId, {
        isActive: false,
        updatedAt: new Date(),
      });

      await this.clearPermissionCache();

      const mappedPermission = this.mapToPermission(permEntity);
      void this.loggingService.log(
        LogType.AUDIT,
        LogLevel.INFO,
        'Permission deleted',
        'PermissionService',
        { permissionId: mappedPermission.id, name: mappedPermission.name }
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logError(`Failed to delete permission: ${permissionId}`, error);
      throw error instanceof Error ? error : new Error(errorMessage);
    }
  }

  async getPermissionsByResource(resource: string): Promise<PermissionRecord[]> {
    return this.getPermissions(resource);
  }

  async getSystemPermissions(): Promise<PermissionRecord[]> {
    try {
      // Use unified database client for optimized read operations
      const permissionsInfraResult = await this.databaseService.findSystemPermissionsSafe();

      const validatedResults = await this.getPrismaPermissions(
        Promise.resolve(permissionsInfraResult)
      );
      // Convert Prisma entities to domain entities
      return validatedResults.map(pInfra => {
        const p = this.toPermissionEntity(pInfra);
        return this.mapToPermission(p);
      });
    } catch (error: unknown) {
      this.logError('Failed to get system permissions', error);
      return [];
    }
  }

  async initializeSystemPermissions(): Promise<void> {
    try {
      const systemPermissions = [
        {
          name: 'Read Users',
          resource: 'users',
          action: 'read',
          description: 'View user information',
        },
        {
          name: 'Create Users',
          resource: 'users',
          action: 'create',
          description: 'Create new users',
        },
        {
          name: 'Update Users',
          resource: 'users',
          action: 'update',
          description: 'Update user information',
        },
        { name: 'Delete Users', resource: 'users', action: 'delete', description: 'Delete users' },
        {
          name: 'Manage Users',
          resource: 'users',
          action: '*',
          description: 'Full user management access',
        },

        {
          name: 'Read Appointments',
          resource: 'appointments',
          action: 'read',
          description: 'View appointments',
        },
        {
          name: 'Create Appointments',
          resource: 'appointments',
          action: 'create',
          description: 'Create new appointments',
        },
        {
          name: 'Update Appointments',
          resource: 'appointments',
          action: 'update',
          description: 'Update appointments',
        },
        {
          name: 'Delete Appointments',
          resource: 'appointments',
          action: 'delete',
          description: 'Delete appointments',
        },
        {
          name: 'Manage Appointments',
          resource: 'appointments',
          action: '*',
          description: 'Full appointment management',
        },

        {
          name: 'Read Patients',
          resource: 'patients',
          action: 'read',
          description: 'View patient information',
        },
        {
          name: 'Create Patients',
          resource: 'patients',
          action: 'create',
          description: 'Create new patients',
        },
        {
          name: 'Update Patients',
          resource: 'patients',
          action: 'update',
          description: 'Update patient information',
        },
        {
          name: 'Delete Patients',
          resource: 'patients',
          action: 'delete',
          description: 'Delete patients',
        },
        {
          name: 'Manage Patients',
          resource: 'patients',
          action: '*',
          description: 'Full patient management',
        },

        {
          name: 'Read Medical Records',
          resource: 'medical-records',
          action: 'read',
          description: 'View medical records',
        },
        {
          name: 'Create Medical Records',
          resource: 'medical-records',
          action: 'create',
          description: 'Create medical records',
        },
        {
          name: 'Update Medical Records',
          resource: 'medical-records',
          action: 'update',
          description: 'Update medical records',
        },
        {
          name: 'Delete Medical Records',
          resource: 'medical-records',
          action: 'delete',
          description: 'Delete medical records',
        },
        {
          name: 'Manage Medical Records',
          resource: 'medical-records',
          action: '*',
          description: 'Full medical records access',
        },

        {
          name: 'Read Prescriptions',
          resource: 'prescriptions',
          action: 'read',
          description: 'View prescriptions',
        },
        {
          name: 'Create Prescriptions',
          resource: 'prescriptions',
          action: 'create',
          description: 'Create prescriptions',
        },
        {
          name: 'Update Prescriptions',
          resource: 'prescriptions',
          action: 'update',
          description: 'Update prescriptions',
        },
        {
          name: 'Delete Prescriptions',
          resource: 'prescriptions',
          action: 'delete',
          description: 'Delete prescriptions',
        },
        {
          name: 'Manage Prescriptions',
          resource: 'prescriptions',
          action: '*',
          description: 'Full prescription management',
        },

        {
          name: 'Read Clinics',
          resource: 'clinics',
          action: 'read',
          description: 'View clinic information',
        },
        {
          name: 'Update Clinics',
          resource: 'clinics',
          action: 'update',
          description: 'Update clinic settings',
        },
        {
          name: 'Delete Clinics',
          resource: 'clinics',
          action: 'delete',
          description: 'Delete clinics',
        },
        {
          name: 'Manage Clinics',
          resource: 'clinics',
          action: '*',
          description: 'Full clinic management',
        },

        { name: 'Read Reports', resource: 'reports', action: 'read', description: 'View reports' },
        {
          name: 'Create Reports',
          resource: 'reports',
          action: 'create',
          description: 'Generate reports',
        },
        {
          name: 'Manage Reports',
          resource: 'reports',
          action: '*',
          description: 'Full report management',
        },

        {
          name: 'Read Settings',
          resource: 'settings',
          action: 'read',
          description: 'View system settings',
        },
        {
          name: 'Update Settings',
          resource: 'settings',
          action: 'update',
          description: 'Update system settings',
        },
        {
          name: 'Manage Settings',
          resource: 'settings',
          action: '*',
          description: 'Full settings management',
        },

        {
          name: 'Read Billing',
          resource: 'billing',
          action: 'read',
          description: 'View billing information',
        },
        {
          name: 'Create Billing',
          resource: 'billing',
          action: 'create',
          description: 'Create billing records',
        },
        {
          name: 'Update Billing',
          resource: 'billing',
          action: 'update',
          description: 'Update billing information',
        },
        {
          name: 'Manage Billing',
          resource: 'billing',
          action: '*',
          description: 'Full billing management',
        },

        {
          name: 'Read Vitals',
          resource: 'vitals',
          action: 'read',
          description: 'View vital signs',
        },
        {
          name: 'Create Vitals',
          resource: 'vitals',
          action: 'create',
          description: 'Record vital signs',
        },
        {
          name: 'Update Vitals',
          resource: 'vitals',
          action: 'update',
          description: 'Update vital signs',
        },
        {
          name: 'Manage Vitals',
          resource: 'vitals',
          action: '*',
          description: 'Full vitals management',
        },

        {
          name: 'Read Profile',
          resource: 'profile',
          action: 'read',
          description: 'View own profile',
        },
        {
          name: 'Update Profile',
          resource: 'profile',
          action: 'update',
          description: 'Update own profile',
        },

        // EHR Permissions
        {
          name: 'Read EHR',
          resource: 'ehr',
          action: 'read',
          description: 'View electronic health records',
        },
        {
          name: 'Create EHR',
          resource: 'ehr',
          action: 'create',
          description: 'Create EHR entries',
        },
        {
          name: 'Update EHR',
          resource: 'ehr',
          action: 'update',
          description: 'Update EHR entries',
        },
        {
          name: 'Delete EHR',
          resource: 'ehr',
          action: 'delete',
          description: 'Delete EHR entries',
        },
        {
          name: 'Manage EHR',
          resource: 'ehr',
          action: '*',
          description: 'Full EHR access',
        },

        // Queue Permissions
        {
          name: 'Read Queue',
          resource: 'queue',
          action: 'read',
          description: 'View queue',
        },
        {
          name: 'Create Queue',
          resource: 'queue',
          action: 'create',
          description: 'Add to queue',
        },
        {
          name: 'Update Queue',
          resource: 'queue',
          action: 'update',
          description: 'Update queue',
        },
        {
          name: 'Manage Queue',
          resource: 'queue',
          action: '*',
          description: 'Full queue management',
        },

        // Plugin Permissions
        {
          name: 'Read Plugins',
          resource: 'plugins',
          action: 'read',
          description: 'View plugins',
        },
        {
          name: 'Execute Plugins',
          resource: 'plugins',
          action: 'execute',
          description: 'Execute plugins',
        },
        {
          name: 'Manage Plugins',
          resource: 'plugins',
          action: 'manage',
          description: 'Manage plugins',
        },

        // Video Permissions
        {
          name: 'Read Video',
          resource: 'video',
          action: 'read',
          description: 'View video sessions',
        },
        {
          name: 'Create Video',
          resource: 'video',
          action: 'create',
          description: 'Start video sessions',
        },
        {
          name: 'Update Video',
          resource: 'video',
          action: 'update',
          description: 'Update video sessions',
        },
        {
          name: 'Manage Video',
          resource: 'video',
          action: '*',
          description: 'Full video access',
        },

        // Check-in Permissions
        {
          name: 'Read Check-in',
          resource: 'check-in',
          action: 'read',
          description: 'View check-ins',
        },
        {
          name: 'Create Check-in',
          resource: 'check-in',
          action: 'create',
          description: 'Process check-ins',
        },
        {
          name: 'Update Check-in',
          resource: 'check-in',
          action: 'update',
          description: 'Update check-ins',
        },

        // Waitlist Permissions
        {
          name: 'Read Waitlist',
          resource: 'waitlist',
          action: 'read',
          description: 'View waitlist',
        },
        {
          name: 'Create Waitlist',
          resource: 'waitlist',
          action: 'create',
          description: 'Add to waitlist',
        },
        {
          name: 'Update Waitlist',
          resource: 'waitlist',
          action: 'update',
          description: 'Update waitlist',
        },
        {
          name: 'Delete Waitlist',
          resource: 'waitlist',
          action: 'delete',
          description: 'Remove from waitlist',
        },

        // Therapy Permissions
        {
          name: 'Read Therapy',
          resource: 'therapy',
          action: 'read',
          description: 'View therapy sessions',
        },
        {
          name: 'Create Therapy',
          resource: 'therapy',
          action: 'create',
          description: 'Create therapy sessions',
        },
        {
          name: 'Update Therapy',
          resource: 'therapy',
          action: 'update',
          description: 'Update therapy sessions',
        },
        {
          name: 'Manage Therapy',
          resource: 'therapy',
          action: '*',
          description: 'Full therapy access',
        },

        // Lab Reports Permissions
        {
          name: 'Read Lab Reports',
          resource: 'lab-reports',
          action: 'read',
          description: 'View lab reports',
        },
        {
          name: 'Create Lab Reports',
          resource: 'lab-reports',
          action: 'create',
          description: 'Create lab reports',
        },
        {
          name: 'Update Lab Reports',
          resource: 'lab-reports',
          action: 'update',
          description: 'Update lab reports',
        },
        {
          name: 'Manage Lab Reports',
          resource: 'lab-reports',
          action: '*',
          description: 'Full lab access',
        },

        // Inventory Permissions
        {
          name: 'Read Inventory',
          resource: 'inventory',
          action: 'read',
          description: 'View inventory',
        },
        {
          name: 'Create Inventory',
          resource: 'inventory',
          action: 'create',
          description: 'Add to inventory',
        },
        {
          name: 'Update Inventory',
          resource: 'inventory',
          action: 'update',
          description: 'Update inventory',
        },
        {
          name: 'Manage Inventory',
          resource: 'inventory',
          action: '*',
          description: 'Full inventory access',
        },

        // Medications Permissions
        {
          name: 'Read Medications',
          resource: 'medications',
          action: 'read',
          description: 'View medications',
        },
        {
          name: 'Create Medications',
          resource: 'medications',
          action: 'create',
          description: 'Prescribe medications',
        },
        {
          name: 'Update Medications',
          resource: 'medications',
          action: 'update',
          description: 'Update medications',
        },
        {
          name: 'Manage Medications',
          resource: 'medications',
          action: '*',
          description: 'Full medication access',
        },

        // Invoice Permissions
        {
          name: 'Read Invoices',
          resource: 'invoices',
          action: 'read',
          description: 'View invoices',
        },
        {
          name: 'Create Invoices',
          resource: 'invoices',
          action: 'create',
          description: 'Create invoices',
        },
        {
          name: 'Update Invoices',
          resource: 'invoices',
          action: 'update',
          description: 'Update invoices',
        },
        {
          name: 'Manage Invoices',
          resource: 'invoices',
          action: '*',
          description: 'Full invoice access',
        },

        // Payment Permissions
        {
          name: 'Read Payments',
          resource: 'payments',
          action: 'read',
          description: 'View payments',
        },
        {
          name: 'Create Payments',
          resource: 'payments',
          action: 'create',
          description: 'Process payments',
        },
        {
          name: 'Update Payments',
          resource: 'payments',
          action: 'update',
          description: 'Update payments',
        },
        {
          name: 'Manage Payments',
          resource: 'payments',
          action: '*',
          description: 'Full payment access',
        },

        // Counseling Permissions
        {
          name: 'Read Counseling',
          resource: 'counseling',
          action: 'read',
          description: 'View counseling sessions',
        },
        {
          name: 'Create Counseling',
          resource: 'counseling',
          action: 'create',
          description: 'Create counseling sessions',
        },
        {
          name: 'Update Counseling',
          resource: 'counseling',
          action: 'update',
          description: 'Update counseling sessions',
        },
        {
          name: 'Manage Counseling',
          resource: 'counseling',
          action: '*',
          description: 'Full counseling access',
        },

        // Scheduling Permissions
        {
          name: 'Read Scheduling',
          resource: 'scheduling',
          action: 'read',
          description: 'View schedules',
        },
        {
          name: 'Create Scheduling',
          resource: 'scheduling',
          action: 'create',
          description: 'Create schedules',
        },
        {
          name: 'Update Scheduling',
          resource: 'scheduling',
          action: 'update',
          description: 'Update schedules',
        },
        {
          name: 'Manage Scheduling',
          resource: 'scheduling',
          action: '*',
          description: 'Full scheduling access',
        },

        // Notification Permissions
        {
          name: 'Read Notifications',
          resource: 'notifications',
          action: 'read',
          description: 'View notifications',
        },
        {
          name: 'Create Notifications',
          resource: 'notifications',
          action: 'create',
          description: 'Send notifications',
        },
        {
          name: 'Manage Notifications',
          resource: 'notifications',
          action: '*',
          description: 'Full notification access',
        },

        // Subscription Permissions
        {
          name: 'Read Subscriptions',
          resource: 'subscriptions',
          action: 'read',
          description: 'View subscriptions',
        },
        {
          name: 'Create Subscriptions',
          resource: 'subscriptions',
          action: 'create',
          description: 'Create subscriptions',
        },
        {
          name: 'Update Subscriptions',
          resource: 'subscriptions',
          action: 'update',
          description: 'Update subscriptions',
        },
        {
          name: 'Delete Subscriptions',
          resource: 'subscriptions',
          action: 'delete',
          description: 'Cancel subscriptions',
        },

        {
          name: 'System Administration',
          resource: '*',
          action: '*',
          description: 'Full system access',
        },
      ];

      // Use unified database client for optimized write operations
      for (const permissionData of systemPermissions) {
        const existing = await this.getPermissionByResourceAction(
          permissionData.resource,
          permissionData.action
        );

        if (!existing) {
          await this.databaseService.createPermissionSafe({
            ...permissionData,
            isSystemPermission: true,
            isActive: true,
          });

          void this.loggingService.log(
            LogType.AUDIT,
            LogLevel.INFO,
            'System permission created',
            'PermissionService',
            { name: permissionData.name }
          );
        }
      }

      await this.clearPermissionCache();
    } catch (error: unknown) {
      this.logError('Failed to initialize system permissions', error);
      throw error;
    }
  }

  async bulkCreatePermissions(permissions: CreatePermissionDto[]): Promise<PermissionRecord[]> {
    try {
      const results: PermissionRecord[] = [];
      for (const permissionData of permissions) {
        try {
          const permission = await this.createPermission(permissionData);
          results.push(permission);
        } catch (error: unknown) {
          void this.loggingService.log(
            LogType.ERROR,
            LogLevel.WARN,
            'Failed to create permission in bulk',
            'PermissionService',
            { name: permissionData.name, error: this.getErrorMessage(error) }
          );
        }
      }
      return results;
    } catch (error: unknown) {
      this.logError('Bulk permission creation failed', error);
      throw error;
    }
  }

  async getPermissionsSummary(resource?: string): Promise<{
    totalPermissions: number;
    systemPermissions: number;
    customPermissions: number;
    resourceBreakdown: Record<string, number>;
    actionBreakdown: Record<string, number>;
  }> {
    try {
      const permissions = await this.getPermissions(resource);
      const summary = {
        totalPermissions: permissions.length,
        systemPermissions: permissions.filter((p: PermissionRecord) => p.isSystemPermission).length,
        customPermissions: permissions.filter(p => !p.isSystemPermission).length,
        resourceBreakdown: {} as Record<string, number>,
        actionBreakdown: {} as Record<string, number>,
      };

      permissions.forEach((permission: PermissionRecord) => {
        const resource = permission.resource;
        const action = permission.action;
        summary.resourceBreakdown[resource] = (summary.resourceBreakdown[resource] || 0) + 1;
        summary.actionBreakdown[action] = (summary.actionBreakdown[action] || 0) + 1;
      });
      return summary;
    } catch (error: unknown) {
      this.logError('Failed to get permissions summary', error);
      throw error;
    }
  }

  private mapToPermission(permission: DomainPermissionEntity): PermissionRecord {
    const { description, ...rest } = permission;
    return {
      ...(rest as Omit<DomainPermissionEntity, 'description'>),
      ...(description ? { description } : {}),
    } as PermissionRecord;
  }

  private async clearPermissionCache(): Promise<void> {
    try {
      await this.cacheService.invalidateByPattern(`${this.CACHE_PREFIX}*`);
    } catch (error: unknown) {
      this.logError('Failed to clear permission cache', error);
    }
  }

  private logError(message: string, error: unknown): void {
    const details =
      error instanceof Error ? { error: error.message, stack: error.stack } : { error };
    void this.loggingService.log(
      LogType.ERROR,
      LogLevel.ERROR,
      message,
      'PermissionService',
      details
    );
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
