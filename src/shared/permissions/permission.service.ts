import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma/prisma.service';
import { Permission, ResourceType, PermissionCheckParams, UserPermissions } from '../../libs/types/permission.types';
import { Role } from '../../shared/database/prisma/prisma.types';

interface AuditLog {
  userId: string;
  action: Permission;
  resourceType?: ResourceType;
  resourceId?: string;
  allowed: boolean;
  reason?: string;
  timestamp: Date;
}

@Injectable()
export class PermissionService {
  private readonly logger = new Logger(PermissionService.name);

  // In-memory role-permission mapping (can be moved to DB later)
  private readonly rolePermissions: Record<Role, Permission[]> = {
    SUPER_ADMIN: [
      'manage_users',
      'manage_clinics',
      'manage_roles',
      'view_analytics',
      'manage_system',
      'view_profile',
      'edit_profile',
      // Add all permissions here for super admin
    ],
    CLINIC_ADMIN: [
      'manage_clinics',
      'manage_clinic_staff',
      'view_clinic_analytics',
      'manage_appointments',
      'manage_inventory',
      'view_profile',
      'edit_profile',
    ],
    DOCTOR: [
      'manage_patients',
      'view_medical_records',
      'create_prescriptions',
      'manage_appointments',
      'view_profile',
      'edit_profile',
    ],
    PATIENT: [
      'view_appointments',
      'book_appointments',
      'view_prescriptions',
      'view_medical_history',
      'view_profile',
      'edit_profile',
      'view_clinic_details',
      'view_own_appointments',
    ],
    RECEPTIONIST: [
      'manage_appointments',
      'register_patients',
      'manage_queue',
      'basic_patient_info',
      'view_profile',
      'edit_profile',
    ],
  };

  // In-memory direct user permission overrides (userId -> Permission[])
  // In production, move this to DB and cache
  private readonly userOverrides: Map<string, Permission[]> = new Map();

  // In-memory cache for permission checks (userId+action+resourceType+resourceId -> boolean)
  private readonly permissionCache: Map<string, boolean> = new Map();

  // In-memory audit log (for demonstration; in production, log to DB or external system)
  private readonly auditLogs: AuditLog[] = [];

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Main method to check if a user has permission for an action (optionally on a resource)
   */
  async hasPermission(params: PermissionCheckParams): Promise<boolean> {
    const { userId, action, resourceType, resourceId, context } = params;
    const cacheKey = `${userId}:${action}:${resourceType || ''}:${resourceId || ''}`;
    if (this.permissionCache.has(cacheKey)) {
      return this.permissionCache.get(cacheKey)!;
    }
    if (!userId || userId === 'undefined') {
      this.logger.warn(`Permission check failed: userId is missing or undefined`);
      this.logAudit({ ...params, allowed: false, reason: 'User ID missing', timestamp: new Date() });
      return false;
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      this.logAudit({ ...params, allowed: false, reason: 'User not found', timestamp: new Date() });
      return false;
    }

    // Super admin always has all permissions
    if (user.role === 'SUPER_ADMIN') {
      this.logAudit({ ...params, allowed: true, reason: 'Super admin', timestamp: new Date() });
      this.permissionCache.set(cacheKey, true);
      return true;
    }

    // Check direct user overrides (future: fetch from DB)
    const userDirectPermissions = this.userOverrides.get(userId) || [];
    if (userDirectPermissions.includes(action)) {
      this.logAudit({ ...params, allowed: true, reason: 'User override', timestamp: new Date() });
      this.permissionCache.set(cacheKey, true);
      return true;
    }

    // Get permissions for user (from role, and optionally from DB in future)
    const permissions = this.rolePermissions[user.role as Role] || [];
    if (!permissions.includes(action)) {
      this.logAudit({ ...params, allowed: false, reason: 'Role missing permission', timestamp: new Date() });
      this.permissionCache.set(cacheKey, false);
      return false;
    }

    // Fine-grained/resource-level checks
    if (resourceType && resourceId) {
      const ownsResource = await this.checkResourceOwnership(user, resourceType, resourceId);
      if (!ownsResource) {
        this.logAudit({ ...params, allowed: false, reason: 'Resource ownership failed', timestamp: new Date() });
        this.permissionCache.set(cacheKey, false);
        return false;
      }
    }

    this.logAudit({ ...params, allowed: true, reason: 'Role-based permission', timestamp: new Date() });
    this.permissionCache.set(cacheKey, true);
    return true;
  }

  /**
   * Get all permissions for a user (from roles, and optionally direct assignments)
   */
  async getUserPermissions(userId: string): Promise<UserPermissions> {
    if (!userId || userId === 'undefined') throw new ForbiddenException('User ID is required');
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ForbiddenException('User not found');
    const role = user.role as Role;
    const permissions = [
      ...(this.rolePermissions[role] || []),
      ...(this.userOverrides.get(userId) || []),
    ];
    return {
      userId,
      roles: [role],
      permissions,
    };
  }

  /**
   * Assign a direct permission to a user (override)
   * In production, persist to DB and invalidate cache
   */
  assignPermissionToUser(userId: string, permission: Permission) {
    const perms = this.userOverrides.get(userId) || [];
    if (!perms.includes(permission)) {
      perms.push(permission);
      this.userOverrides.set(userId, perms);
      this.permissionCache.clear(); // Invalidate cache
    }
  }

  /**
   * Internal: Check if user owns the resource (for fine-grained checks)
   * Extend this for new resource types as needed
   */
  private async checkResourceOwnership(user: any, resourceType: ResourceType, resourceId: string): Promise<boolean> {
    switch (resourceType) {
      case 'clinic':
        if (user.role === 'CLINIC_ADMIN') {
          const clinicAdmin = await this.prisma.clinicAdmin.findFirst({
            where: { userId: user.id, clinicId: resourceId },
          });
          return !!clinicAdmin;
        }
        if (user.role === 'PATIENT') {
          // Patients can access their associated clinic through User model
          const userWithClinics = await this.prisma.user.findUnique({
            where: { id: user.id },
            include: { clinics: true }
          });
          
          if (!userWithClinics) return false;
          
          // Check if user is associated with this clinic
          return userWithClinics.clinics.some(clinic => clinic.id === resourceId) ||
                 userWithClinics.primaryClinicId === resourceId;
        }
        return false;
      case 'appointment':
        if (user.role === 'DOCTOR') {
          const appointment = await this.prisma.appointment.findFirst({
            where: { id: resourceId, doctorId: user.id },
          });
          return !!appointment;
        }
        if (user.role === 'PATIENT') {
          const appointment = await this.prisma.appointment.findFirst({
            where: { id: resourceId, patientId: user.id },
          });
          return !!appointment;
        }
        return false;
      case 'user':
        return user.id === resourceId;
      // Add more resource types as needed
      default:
        return false;
    }
  }

  /**
   * Log permission checks and denials for auditing
   * In production, log to DB or external system
   */
  private logAudit(log: AuditLog) {
    this.auditLogs.push(log);
    if (!log.allowed) {
      this.logger.warn(`Permission denied: user=${log.userId}, action=${log.action}, resourceType=${log.resourceType}, resourceId=${log.resourceId}, reason=${log.reason}`);
    } else {
      this.logger.debug(`Permission granted: user=${log.userId}, action=${log.action}, resourceType=${log.resourceType}, resourceId=${log.resourceId}, reason=${log.reason}`);
    }
  }

  /**
   * For testing/auditing: get recent audit logs
   */
  getAuditLogs(limit = 100): AuditLog[] {
    return this.auditLogs.slice(-limit);
  }
} 