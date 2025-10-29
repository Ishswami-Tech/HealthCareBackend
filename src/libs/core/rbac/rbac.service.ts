import { Injectable, Logger } from "@nestjs/common";
import { RoleService } from "./role.service";
import { PermissionService } from "./permission.service";
import { DatabaseService } from "../../infrastructure/database";
import { RedisService } from "../../infrastructure/cache/redis/redis.service";
import {
  LoggingService,
  LogType,
  LogLevel,
} from "../../infrastructure/logging/logging.service";

/**
 * Context for RBAC permission checks
 * @interface RbacContext
 * @description Contains all necessary information for permission validation
 */
export interface RbacContext {
  readonly userId: string;
  readonly clinicId?: string;
  readonly resource: string;
  readonly action: string;
  readonly resourceId?: string; // For ownership checks
  readonly metadata?: Record<string, unknown>;
}

/**
 * Represents a role assignment to a user
 * @interface RoleAssignment
 * @description Defines the structure of a user-role assignment
 */
export interface RoleAssignment {
  readonly userId: string;
  readonly roleId: string;
  readonly roleName: string;
  readonly clinicId?: string;
  readonly assignedBy: string;
  readonly assignedAt: Date;
  readonly expiresAt?: Date;
  readonly isActive: boolean;
}

/**
 * Result of a permission check
 * @interface PermissionCheck
 * @description Contains the result and details of a permission validation
 */
export interface PermissionCheck {
  readonly hasPermission: boolean;
  readonly roles: string[];
  readonly permissions: string[];
  readonly reason?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Core RBAC service for permission management and validation
 * @class RbacService
 * @description Handles permission checks, role assignments, and RBAC operations
 */
@Injectable()
export class RbacService {
  private readonly logger = new Logger(RbacService.name);
  private readonly CACHE_TTL = 3600; // 1 hour
  private readonly CACHE_PREFIX = "rbac:";

  /**
   * Creates an instance of RbacService
   * @constructor
   * @param roleService - Service for role management
   * @param permissionService - Service for permission management
   * @param prisma - Prisma database service
   * @param redis - Redis caching service
   * @param loggingService - Service for logging security events
   */
  constructor(
    private readonly roleService: RoleService,
    private readonly permissionService: PermissionService,
    private readonly databaseService: DatabaseService,
    private readonly redis: RedisService,
    private readonly loggingService: LoggingService,
  ) {}

  /**
   * Check if user has permission for a specific action on a resource
   * Enhanced with ownership checks and better caching
   */
  async checkPermission(context: RbacContext): Promise<PermissionCheck> {
    try {
      const cacheKey = this.getCacheKey(
        "permission",
        context.userId,
        context.clinicId,
        context.resource,
        context.action,
      );
      const cached = await this.redis.get<PermissionCheck>(cacheKey);

      if (cached) {
        return cached;
      }

      const userRoles = await this.getUserRoles(
        context.userId,
        context.clinicId,
      );
      const userPermissions = await this.getRolePermissions(
        userRoles.map((r) => r.roleId),
      );

      const requiredPermission = `${context.resource}:${context.action}`;
      const hasDirectPermission = userPermissions.some(
        (permission) =>
          permission === requiredPermission ||
          permission === `${context.resource}:*` ||
          permission === "*",
      );

      // Check for role-based permissions
      const hasRolePermission = userRoles.some((role) =>
        this.checkRolePermission(
          role.roleName,
          context.resource,
          context.action,
        ),
      );

      // Check ownership-based access
      const hasOwnershipAccess = await this.checkOwnershipAccess(context);

      const hasPermission =
        hasDirectPermission || hasRolePermission || hasOwnershipAccess;

      const result: PermissionCheck = {
        hasPermission,
        roles: userRoles.map((r) => r.roleName),
        permissions: userPermissions,
        reason: hasPermission
          ? "Permission granted"
          : "Insufficient permissions",
        metadata: {
          directPermission: hasDirectPermission,
          rolePermission: hasRolePermission,
          ownershipAccess: hasOwnershipAccess,
          checkedAt: new Date().toISOString(),
        },
      };

      // Cache the result
      await this.redis.set(cacheKey, result, this.CACHE_TTL);

      // Log permission check
      await this.loggingService.log(
        LogType.SECURITY,
        hasPermission ? LogLevel.INFO : LogLevel.WARN,
        `Permission check: ${hasPermission ? "GRANTED" : "DENIED"}`,
        "RbacService",
        {
          userId: context.userId,
          clinicId: context.clinicId,
          resource: context.resource,
          action: context.action,
          hasPermission,
          roles: result.roles,
        },
      );

      return result;
    } catch (_error) {
      this.logger.error(
        `Permission check failed for user ${context.userId}`,
        _error instanceof Error ? _error.stack : "No stack trace available",
      );

      return {
        hasPermission: false,
        roles: [],
        permissions: [],
        reason: "Permission check failed due to internal _error",
        metadata: {
          _error: _error instanceof Error ? _error.message : "Unknown _error",
        },
      };
    }
  }

  /**
   * Assign role to user
   */
  async assignRole(
    userId: string,
    roleId: string,
    clinicId?: string,
    assignedBy?: string,
    expiresAt?: Date,
  ): Promise<RoleAssignment> {
    try {
      const role = await this.roleService.getRoleById(roleId);
      if (!role) {
        throw new Error(`Role with ID ${roleId} not found`);
      }

      // Check if assignment already exists
      const existingAssignment = (await this.databaseService
        .getPrismaClient()
        .findUserRoleAssignmentSafe(userId, roleId, clinicId)) as {
        id: string;
        userId: string;
        roleId: string;
        clinicId: string | null;
        assignedBy: string;
        assignedAt: Date;
        expiresAt: Date | null;
        isActive: boolean;
        revokedAt: Date | null;
        revokedBy: string | null;
        createdAt: Date;
        updatedAt: Date;
      } | null;

      if (existingAssignment) {
        throw new Error("Role already assigned to user");
      }

      const assignment = (await this.databaseService
        .getPrismaClient()
        .createUserRoleSafe({
          userId,
          roleId,
          clinicId,
          assignedBy: assignedBy || "SYSTEM",
          assignedAt: new Date(),
          expiresAt,
          isActive: true,
        })) as {
        id: string;
        userId: string;
        roleId: string;
        clinicId: string | null;
        assignedBy: string;
        assignedAt: Date;
        expiresAt: Date | null;
        isActive: boolean;
        revokedAt: Date | null;
        revokedBy: string | null;
        createdAt: Date;
        updatedAt: Date;
      };

      const roleAssignment: RoleAssignment = {
        userId: assignment.userId,
        roleId: assignment.roleId,
        roleName: role.name,
        ...(assignment.clinicId && { clinicId: assignment.clinicId }),
        assignedBy: assignment.assignedBy,
        assignedAt: assignment.assignedAt,
        ...(assignment.expiresAt && { expiresAt: assignment.expiresAt }),
        isActive: assignment.isActive,
      };

      // Clear cache
      await this.clearUserCache(userId, clinicId);

      // Log role assignment
      await this.loggingService.log(
        LogType.SECURITY,
        LogLevel.INFO,
        "Role assigned to user",
        "RbacService",
        {
          userId,
          roleId,
          roleName: role.name,
          clinicId,
          assignedBy,
        },
      );

      return roleAssignment;
    } catch (_error) {
      this.logger.error(
        `Role assignment failed for user ${userId}`,
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      throw _error;
    }
  }

  /**
   * Remove role from user
   */
  async revokeRole(
    userId: string,
    roleId: string,
    clinicId?: string,
    revokedBy?: string,
  ): Promise<void> {
    try {
      const assignment = (await this.databaseService
        .getPrismaClient()
        .findUserRoleForRevocationSafe(userId, roleId, clinicId)) as {
        id: string;
        userId: string;
        roleId: string;
        clinicId: string | null;
        assignedBy: string;
        assignedAt: Date;
        expiresAt: Date | null;
        isActive: boolean;
        revokedAt: Date | null;
        revokedBy: string | null;
        createdAt: Date;
        updatedAt: Date;
      } | null;

      if (!assignment) {
        throw new Error("Role assignment not found");
      }

      await this.databaseService
        .getPrismaClient()
        .updateUserRoleSafe(assignment.id, {
          isActive: false,
          revokedAt: new Date(),
          revokedBy: revokedBy || "SYSTEM",
          updatedAt: new Date(),
        });

      // Clear cache
      await this.clearUserCache(userId, clinicId);

      // Log role revocation
      await this.loggingService.log(
        LogType.SECURITY,
        LogLevel.INFO,
        "Role revoked from user",
        "RbacService",
        {
          userId,
          roleId,
          clinicId,
          revokedBy,
        },
      );
    } catch (_error) {
      this.logger.error(
        `Role revocation failed for user ${userId}`,
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      throw _error;
    }
  }

  /**
   * Get user's roles
   */
  async getUserRoles(
    userId: string,
    clinicId?: string,
  ): Promise<RoleAssignment[]> {
    try {
      const cacheKey = this.getCacheKey("user_roles", userId, clinicId);
      const cached = await this.redis.get<RoleAssignment[]>(cacheKey);

      if (cached) {
        return cached;
      }

      const assignments = (await this.databaseService
        .getPrismaClient()
        .findUserRolesSafe(userId, clinicId)) as Array<{
        id: string;
        userId: string;
        roleId: string;
        clinicId: string | null;
        assignedBy: string;
        assignedAt: Date;
        expiresAt: Date | null;
        isActive: boolean;
        revokedAt: Date | null;
        revokedBy: string | null;
        createdAt: Date;
        updatedAt: Date;
        role: { name: string };
      }>;

      const roles: RoleAssignment[] = assignments.map((assignment) => ({
        userId: assignment.userId,
        roleId: assignment.roleId,
        roleName: assignment.role.name,
        ...(assignment.clinicId && { clinicId: assignment.clinicId }),
        assignedBy: assignment.assignedBy,
        assignedAt: assignment.assignedAt,
        ...(assignment.expiresAt && { expiresAt: assignment.expiresAt }),
        isActive: assignment.isActive,
      }));

      // Cache the result
      await this.redis.set(cacheKey, roles, this.CACHE_TTL);

      return roles;
    } catch (error) {
      this.logger.error(
        `Failed to get roles for user ${userId}`,
        error instanceof Error ? error.stack : "No stack trace available",
      );
      return [];
    }
  }

  /**
   * Get permissions for roles
   */
  async getRolePermissions(roleIds: string[]): Promise<string[]> {
    try {
      if (roleIds.length === 0) {
        return [];
      }

      const cacheKey = this.getCacheKey("role_permissions", ...roleIds);
      const cached = await this.redis.get<string[]>(cacheKey);

      if (cached) {
        return cached;
      }

      const rolePermissions = (await this.databaseService
        .getPrismaClient()
        .findRolePermissionsSafe(roleIds)) as Array<{
        id: string;
        roleId: string;
        permissionId: string;
        isActive: boolean;
        assignedAt: Date;
        createdAt: Date;
        updatedAt: Date;
        permission: { resource: string; action: string };
      }>;

      const permissions = rolePermissions.map((rp): string => {
        const resource = rp.permission.resource;
        const action = rp.permission.action;
        return `${resource}:${action}`;
      });

      // Remove duplicates
      const uniquePermissions: string[] = Array.from(new Set(permissions));

      // Cache the result
      await this.redis.set(cacheKey, uniquePermissions, this.CACHE_TTL);

      return uniquePermissions;
    } catch (_error) {
      this.logger.error(
        "Failed to get role permissions",
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      return [];
    }
  }

  /**
   * Check role-based permission
   */
  private checkRolePermission(
    roleName: string,
    resource: string,
    action: string,
  ): boolean {
    // Define role-based permissions
    const rolePermissions: Record<string, string[]> = {
      SUPER_ADMIN: ["*"],
      CLINIC_ADMIN: [
        "users:*",
        "appointments:*",
        "clinics:read",
        "clinics:update",
        "reports:*",
        "settings:*",
      ],
      DOCTOR: [
        "appointments:read",
        "appointments:update",
        "patients:read",
        "patients:update",
        "medical-records:*",
        "prescriptions:*",
      ],
      NURSE: [
        "appointments:read",
        "patients:read",
        "patients:update",
        "medical-records:read",
        "vitals:*",
      ],
      RECEPTIONIST: [
        "appointments:*",
        "patients:read",
        "patients:create",
        "billing:read",
        "scheduling:*",
      ],
      PATIENT: [
        "appointments:read",
        "appointments:create",
        "profile:read",
        "profile:update",
        "medical-records:read",
      ],
    };

    const permissions = rolePermissions[roleName] || [];
    const requiredPermission = `${resource}:${action}`;

    return permissions.some(
      (permission) =>
        permission === requiredPermission ||
        permission === `${resource}:*` ||
        permission === "*",
    );
  }

  /**
   * Clear user cache
   */
  private async clearUserCache(
    userId: string,
    _clinicId?: string,
  ): Promise<void> {
    try {
      const patterns = [
        `${this.CACHE_PREFIX}user_roles:${userId}*`,
        `${this.CACHE_PREFIX}permission:${userId}*`,
        `${this.CACHE_PREFIX}role_permissions:*`,
      ];

      for (const pattern of patterns) {
        const keys = await this.redis.keys(pattern);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      }
    } catch (_error) {
      this.logger.error(
        `Failed to clear cache for user ${userId}`,
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
    }
  }

  /**
   * Generate cache key
   */
  private getCacheKey(...parts: (string | undefined)[]): string {
    const validParts = parts.filter(
      (part) => part !== undefined && part !== null,
    );
    return `${this.CACHE_PREFIX}${validParts.join(":")}`;
  }

  /**
   * Bulk assign roles
   */
  async bulkAssignRoles(
    assignments: Array<{
      userId: string;
      roleId: string;
      clinicId?: string;
      expiresAt?: Date;
    }>,
    assignedBy?: string,
  ): Promise<RoleAssignment[]> {
    try {
      const results: RoleAssignment[] = [];

      for (const assignment of assignments) {
        try {
          const result = await this.assignRole(
            assignment.userId,
            assignment.roleId,
            assignment.clinicId,
            assignedBy,
            assignment.expiresAt,
          );
          results.push(result);
        } catch (_error) {
          this.logger.warn(
            `Failed to assign role ${assignment.roleId} to user ${assignment.userId}`,
            _error instanceof Error ? _error.message : "Unknown _error",
          );
        }
      }

      return results;
    } catch (_error) {
      this.logger.error(
        "Bulk role assignment failed",
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      throw _error;
    }
  }

  /**
   * Get user permissions summary
   */
  async getUserPermissionsSummary(
    userId: string,
    clinicId?: string,
  ): Promise<{
    roles: RoleAssignment[];
    permissions: string[];
    effectivePermissions: string[];
    metadata: Record<string, unknown>;
  }> {
    try {
      const roles = await this.getUserRoles(userId, clinicId);
      const rolePermissions = await this.getRolePermissions(
        roles.map((r) => r.roleId),
      );

      // Get effective permissions (including role-based)
      const effectivePermissions = new Set(rolePermissions);

      roles.forEach((role) => {
        const roleBasedPermissions = this.getRoleBasedPermissions(
          role.roleName,
        );
        roleBasedPermissions.forEach((permission) =>
          effectivePermissions.add(permission),
        );
      });

      return {
        roles,
        permissions: rolePermissions,
        effectivePermissions: Array.from(effectivePermissions),
        metadata: {
          totalRoles: roles.length,
          totalPermissions: rolePermissions.length,
          totalEffectivePermissions: effectivePermissions.size,
          generatedAt: new Date().toISOString(),
        },
      };
    } catch (_error) {
      this.logger.error(
        `Failed to get permissions summary for user ${userId}`,
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      throw _error;
    }
  }

  /**
   * Check ownership-based access
   */
  private async checkOwnershipAccess(context: RbacContext): Promise<boolean> {
    if (!context.resourceId) {
      return false;
    }

    try {
      // Check if user owns the resource
      switch (context.resource) {
        case "profile":
        case "user":
          return context.resourceId === context.userId;

        case "appointments":
          return await this.checkAppointmentOwnership(
            context.resourceId,
            context.userId,
          );

        case "medical-records":
          return await this.checkMedicalRecordOwnership(
            context.resourceId,
            context.userId,
          );

        case "patients":
          return context.resourceId === context.userId;

        default:
          return false;
      }
    } catch (_error) {
      this.logger.error(
        `Ownership check failed for ${context.resource}`,
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      return false;
    }
  }

  /**
   * Check appointment ownership
   */
  private async checkAppointmentOwnership(
    appointmentId: string,
    userId: string,
  ): Promise<boolean> {
    try {
      const appointment = (await this.databaseService
        .getPrismaClient()
        .findAppointmentByIdSafe(appointmentId)) as {
        id: string;
        patientId: string;
        doctorId: string;
        clinicId: string;
        appointmentDate: Date;
        status: string;
        createdAt: Date;
        updatedAt: Date;
      } | null;

      return appointment
        ? appointment.patientId === userId || appointment.doctorId === userId
        : false;
    } catch (_error) {
      this.logger.error(
        `Failed to check appointment ownership`,
        _error instanceof Error ? _error.stack : "No stack trace available",
      );
      return false;
    }
  }

  /**
   * Check medical record ownership
   * MedicalRecord model integration - currently using placeholder implementation
   */
  private checkMedicalRecordOwnership(
    _recordId: string,
    _userId: string,
  ): Promise<boolean> {
    // Commented out until MedicalRecord model is added to Prisma schema
    // try {
    //   const record = await this.databaseService.getPrismaClient().medicalRecord.findUnique({
    //     where: { id: recordId },
    //     select: { patientId: true },
    //   });

    //   return record ? record.patientId === userId : false;
    // } catch (_error) {
    //   this.logger.error(`Failed to check medical record ownership`, _error instanceof Error ? (_error as Error).stack : 'No stack trace available');
    //   return false;
    // }

    // For now, return false as medical records are not implemented
    return Promise.resolve(false);
  }

  /**
   * Get role-based permissions
   */
  private getRoleBasedPermissions(roleName: string): string[] {
    const rolePermissions: Record<string, string[]> = {
      SUPER_ADMIN: ["*"],
      CLINIC_ADMIN: [
        "users:*",
        "appointments:*",
        "clinics:read",
        "clinics:update",
        "reports:*",
        "settings:*",
      ],
      DOCTOR: [
        "appointments:read",
        "appointments:update",
        "patients:read",
        "patients:update",
        "medical-records:*",
        "prescriptions:*",
      ],
      NURSE: [
        "appointments:read",
        "patients:read",
        "patients:update",
        "medical-records:read",
        "vitals:*",
      ],
      RECEPTIONIST: [
        "appointments:*",
        "patients:read",
        "patients:create",
        "billing:read",
        "scheduling:*",
      ],
      PATIENT: [
        "appointments:read",
        "appointments:create",
        "profile:read",
        "profile:update",
        "medical-records:read",
      ],
    };

    return rolePermissions[roleName] || [];
  }
}
