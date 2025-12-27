import { Module, forwardRef, OnModuleInit } from '@nestjs/common';
import { RbacService } from './rbac.service';
import { RoleService } from './role.service';
import { PermissionService } from './permission.service';
import { RbacGuard } from './rbac.guard';
import { RbacDecorators } from './rbac.decorators';
// Use direct imports to avoid TDZ issues with barrel exports
import { DatabaseModule } from '@infrastructure/database/database.module';
// CacheModule is @Global() - no need to import it explicitly
// LoggingModule is @Global() - LoggingService is available without explicit import
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';

@Module({
  imports: [forwardRef(() => DatabaseModule)],
  providers: [RbacService, RoleService, PermissionService, RbacGuard, RbacDecorators],
  exports: [
    RbacService,
    RoleService,
    PermissionService,
    RbacGuard,
    RbacDecorators,
    // Export all types and interfaces for easy importing
  ],
})
export class RbacModule implements OnModuleInit {
  constructor(
    private readonly permissionService: PermissionService,
    private readonly roleService: RoleService,
    private readonly rbacService: RbacService,
    private readonly loggingService: LoggingService
  ) {}

  async onModuleInit(): Promise<void> {
    // Initialize RBAC system on startup
    // This ensures all system permissions and roles are created, and default permissions are assigned
    try {
      // Step 1: Initialize system permissions
      await this.permissionService.initializeSystemPermissions();

      // Step 2: Initialize system roles
      await this.roleService.initializeSystemRoles();

      // Step 3: Assign default permissions to system roles
      await this.assignDefaultPermissionsToRoles();
    } catch (error) {
      // Log error but don't fail module initialization
      // RBAC will still work, but some permissions may need manual assignment
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'Failed to initialize RBAC system',
        'RbacModule',
        {
          error: errorMessage,
          stack: errorStack,
        }
      );
    }
  }

  /**
   * Assign default permissions to system roles based on role-based permission mapping
   */
  private async assignDefaultPermissionsToRoles(): Promise<void> {
    try {
      // Get all system permissions (pass '*' to get all permissions)
      const allPermissions = await this.permissionService.getPermissions('*');
      const permissionMap = new Map<string, string>();
      for (const perm of allPermissions) {
        const key = `${perm.resource}:${perm.action}`;
        permissionMap.set(key, perm.id);
      }

      // Define default permissions for each system role
      const rolePermissionMapping: Record<string, string[]> = {
        SUPER_ADMIN: ['*:*'], // All permissions
        CLINIC_ADMIN: [
          'users:*',
          'appointments:*',
          'clinics:read',
          'clinics:update',
          'reports:*',
          'settings:*',
          'billing:*',
          'patients:*',
        ],
        DOCTOR: [
          'appointments:read',
          'appointments:create',
          'appointments:update',
          'patients:read',
          'patients:update',
          'medical-records:*',
          'prescriptions:*',
          'lab-reports:read',
          'radiology-reports:read',
        ],
        NURSE: [
          'appointments:read',
          'patients:read',
          'patients:update',
          'medical-records:read',
          'vitals:*',
          'lab-reports:read',
        ],
        RECEPTIONIST: [
          'appointments:*',
          'patients:read',
          'patients:create',
          'billing:read',
          'billing:create',
          'scheduling:*',
        ],
        PATIENT: [
          'appointments:read',
          'appointments:create',
          'appointments:update',
          'profile:read',
          'profile:update',
          'medical-records:read',
          'billing:read',
          'subscriptions:read',
          'invoices:read',
          'payments:read',
          'payments:create',
        ],
      };

      // Assign permissions to each role
      for (const [roleName, permissionKeys] of Object.entries(rolePermissionMapping)) {
        try {
          const role = await this.roleService.getRoleByName(roleName);
          if (!role) {
            continue; // Role doesn't exist yet, skip
          }

          // Get permission IDs for this role
          const permissionIds: string[] = [];
          for (const permKey of permissionKeys) {
            if (permKey === '*:*') {
              // SUPER_ADMIN gets all permissions
              permissionIds.push(...Array.from(permissionMap.values()));
            } else {
              const permId = permissionMap.get(permKey);
              if (permId) {
                permissionIds.push(permId);
              }
            }
          }

          // Check if role already has permissions assigned
          const existingPermissions = await this.rbacService.getRolePermissions([role.id]);
          if (existingPermissions.length === 0 && permissionIds.length > 0) {
            // Only assign if no permissions exist yet
            await this.roleService.assignPermissionsToRole(role.id, permissionIds);
            void this.loggingService.log(
              LogType.AUDIT,
              LogLevel.INFO,
              `Assigned ${permissionIds.length} default permissions to role ${roleName}`,
              'RbacModule',
              {
                roleName,
                roleId: role.id,
                permissionCount: permissionIds.length,
              }
            );
          }
        } catch (roleError) {
          // Log but continue with other roles
          const errorMessage = roleError instanceof Error ? roleError.message : String(roleError);
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Failed to assign permissions to role ${roleName}`,
            'RbacModule',
            {
              roleName,
              error: errorMessage,
            }
          );
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'Failed to assign default permissions',
        'RbacModule',
        {
          error: errorMessage,
          stack: errorStack,
        }
      );
      throw error;
    }
  }
}
