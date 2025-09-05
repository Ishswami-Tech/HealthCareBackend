import { Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

export enum Role {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  DOCTOR = 'DOCTOR',
  NURSE = 'NURSE',
  PATIENT = 'PATIENT',
  RECEPTIONIST = 'RECEPTIONIST'
}

export enum Permission {
  // User Management
  CREATE_USER = 'CREATE_USER',
  READ_USER = 'READ_USER',
  UPDATE_USER = 'UPDATE_USER',
  DELETE_USER = 'DELETE_USER',
  MANAGE_ROLES = 'MANAGE_ROLES',

  // Patient Management
  CREATE_PATIENT = 'CREATE_PATIENT',
  READ_PATIENT = 'READ_PATIENT',
  UPDATE_PATIENT = 'UPDATE_PATIENT',
  DELETE_PATIENT = 'DELETE_PATIENT',
  READ_MEDICAL_RECORDS = 'READ_MEDICAL_RECORDS',
  UPDATE_MEDICAL_RECORDS = 'UPDATE_MEDICAL_RECORDS',

  // Appointment Management
  CREATE_APPOINTMENT = 'CREATE_APPOINTMENT',
  READ_APPOINTMENT = 'READ_APPOINTMENT',
  UPDATE_APPOINTMENT = 'UPDATE_APPOINTMENT',
  DELETE_APPOINTMENT = 'DELETE_APPOINTMENT',
  SCHEDULE_APPOINTMENT = 'SCHEDULE_APPOINTMENT',
  CANCEL_APPOINTMENT = 'CANCEL_APPOINTMENT',

  // Clinic Management
  CREATE_CLINIC = 'CREATE_CLINIC',
  READ_CLINIC = 'READ_CLINIC',
  UPDATE_CLINIC = 'UPDATE_CLINIC',
  DELETE_CLINIC = 'DELETE_CLINIC',
  MANAGE_CLINIC_SETTINGS = 'MANAGE_CLINIC_SETTINGS',

  // Financial Management
  READ_BILLING = 'READ_BILLING',
  CREATE_BILLING = 'CREATE_BILLING',
  UPDATE_BILLING = 'UPDATE_BILLING',
  PROCESS_PAYMENT = 'PROCESS_PAYMENT',
  REFUND_PAYMENT = 'REFUND_PAYMENT',

  // System Management
  READ_AUDIT_LOGS = 'READ_AUDIT_LOGS',
  MANAGE_SYSTEM_SETTINGS = 'MANAGE_SYSTEM_SETTINGS',
  ACCESS_REPORTS = 'ACCESS_REPORTS',
  MANAGE_INTEGRATIONS = 'MANAGE_INTEGRATIONS',

  // Emergency Permissions
  EMERGENCY_ACCESS = 'EMERGENCY_ACCESS',
  OVERRIDE_RESTRICTIONS = 'OVERRIDE_RESTRICTIONS',

  // Queue Management
  MANAGE_QUEUES = 'MANAGE_QUEUES',
  VIEW_QUEUE_METRICS = 'VIEW_QUEUE_METRICS'
}

export interface RoleDefinition {
  role: Role;
  name: string;
  description: string;
  permissions: Permission[];
  hierarchy: number; // Lower number = higher authority
  inheritFrom?: Role;
  restrictions: {
    clinicScope: boolean; // Whether role is restricted to specific clinics
    patientScope: boolean; // Whether role can only access own patients
    timeRestrictions: boolean; // Whether role has time-based access restrictions
  };
}

export interface PermissionContext {
  userId: string;
  userRole: Role;
  clinicId?: string;
  targetClinicId?: string;
  targetUserId?: string;
  targetPatientId?: string;
  action: string;
  resource: string;
  metadata: {
    timestamp: Date;
    ipAddress?: string;
    userAgent?: string;
    sessionId?: string;
  };
}

export interface PermissionResult {
  granted: boolean;
  reason: string;
  conditions?: string[];
  expiration?: Date;
  requiresApproval?: boolean;
  auditLevel: 'low' | 'medium' | 'high' | 'critical';
}

@Injectable()
export class RBACService {
  private readonly logger = new Logger(RBACService.name);
  private roleDefinitions: Map<Role, RoleDefinition> = new Map();
  private permissionCache: Map<string, { result: PermissionResult; expiration: Date }> = new Map();

  constructor(private eventEmitter: EventEmitter2) {
    this.initializeRoleDefinitions();
    this.startCacheCleanup();
  }

  private initializeRoleDefinitions(): void {
    this.logger.log('🔐 Initializing RBAC System with Healthcare Roles...');

    // Super Admin - Full system access
    this.roleDefinitions.set(Role.SUPER_ADMIN, {
      role: Role.SUPER_ADMIN,
      name: 'Super Administrator',
      description: 'Full system access across all clinics',
      hierarchy: 1,
      permissions: Object.values(Permission),
      restrictions: {
        clinicScope: false,
        patientScope: false,
        timeRestrictions: false
      }
    });

    // Admin - Clinic-level management
    this.roleDefinitions.set(Role.ADMIN, {
      role: Role.ADMIN,
      name: 'Clinic Administrator',
      description: 'Full access within assigned clinic(s)',
      hierarchy: 2,
      permissions: [
        Permission.CREATE_USER,
        Permission.READ_USER,
        Permission.UPDATE_USER,
        Permission.MANAGE_ROLES,
        Permission.CREATE_PATIENT,
        Permission.READ_PATIENT,
        Permission.UPDATE_PATIENT,
        Permission.DELETE_PATIENT,
        Permission.READ_MEDICAL_RECORDS,
        Permission.UPDATE_MEDICAL_RECORDS,
        Permission.CREATE_APPOINTMENT,
        Permission.READ_APPOINTMENT,
        Permission.UPDATE_APPOINTMENT,
        Permission.DELETE_APPOINTMENT,
        Permission.SCHEDULE_APPOINTMENT,
        Permission.CANCEL_APPOINTMENT,
        Permission.READ_CLINIC,
        Permission.UPDATE_CLINIC,
        Permission.MANAGE_CLINIC_SETTINGS,
        Permission.READ_BILLING,
        Permission.CREATE_BILLING,
        Permission.UPDATE_BILLING,
        Permission.PROCESS_PAYMENT,
        Permission.ACCESS_REPORTS,
        Permission.VIEW_QUEUE_METRICS
      ],
      restrictions: {
        clinicScope: true,
        patientScope: false,
        timeRestrictions: false
      }
    });

    // Doctor - Medical professional access
    this.roleDefinitions.set(Role.DOCTOR, {
      role: Role.DOCTOR,
      name: 'Doctor',
      description: 'Medical professional with patient care access',
      hierarchy: 3,
      permissions: [
        Permission.READ_USER,
        Permission.CREATE_PATIENT,
        Permission.READ_PATIENT,
        Permission.UPDATE_PATIENT,
        Permission.READ_MEDICAL_RECORDS,
        Permission.UPDATE_MEDICAL_RECORDS,
        Permission.READ_APPOINTMENT,
        Permission.UPDATE_APPOINTMENT,
        Permission.SCHEDULE_APPOINTMENT,
        Permission.READ_BILLING,
        Permission.CREATE_BILLING,
        Permission.EMERGENCY_ACCESS
      ],
      restrictions: {
        clinicScope: true,
        patientScope: true, // Can only access assigned patients
        timeRestrictions: true
      }
    });

    // Nurse - Patient care support
    this.roleDefinitions.set(Role.NURSE, {
      role: Role.NURSE,
      name: 'Nurse',
      description: 'Patient care support with limited medical record access',
      hierarchy: 4,
      permissions: [
        Permission.READ_USER,
        Permission.READ_PATIENT,
        Permission.UPDATE_PATIENT,
        Permission.READ_MEDICAL_RECORDS,
        Permission.READ_APPOINTMENT,
        Permission.UPDATE_APPOINTMENT,
        Permission.EMERGENCY_ACCESS
      ],
      restrictions: {
        clinicScope: true,
        patientScope: true,
        timeRestrictions: true
      }
    });

    // Receptionist - Front desk operations
    this.roleDefinitions.set(Role.RECEPTIONIST, {
      role: Role.RECEPTIONIST,
      name: 'Receptionist',
      description: 'Front desk operations and appointment management',
      hierarchy: 5,
      permissions: [
        Permission.READ_USER,
        Permission.CREATE_PATIENT,
        Permission.READ_PATIENT,
        Permission.UPDATE_PATIENT,
        Permission.CREATE_APPOINTMENT,
        Permission.READ_APPOINTMENT,
        Permission.UPDATE_APPOINTMENT,
        Permission.SCHEDULE_APPOINTMENT,
        Permission.CANCEL_APPOINTMENT,
        Permission.READ_BILLING,
        Permission.PROCESS_PAYMENT
      ],
      restrictions: {
        clinicScope: true,
        patientScope: false,
        timeRestrictions: true
      }
    });

    // Patient - Self-service access
    this.roleDefinitions.set(Role.PATIENT, {
      role: Role.PATIENT,
      name: 'Patient',
      description: 'Self-service access to own records and appointments',
      hierarchy: 10,
      permissions: [
        Permission.READ_USER, // Own profile only
        Permission.UPDATE_USER, // Own profile only
        Permission.READ_PATIENT, // Own records only
        Permission.READ_APPOINTMENT, // Own appointments only
        Permission.SCHEDULE_APPOINTMENT, // Own appointments only
        Permission.CANCEL_APPOINTMENT, // Own appointments only
        Permission.READ_BILLING // Own billing only
      ],
      restrictions: {
        clinicScope: true,
        patientScope: true, // Own records only
        timeRestrictions: false
      }
    });

    this.logger.log(`✅ Initialized ${this.roleDefinitions.size} healthcare roles`);
  }

  // Core Permission Checking

  async checkPermission(
    context: PermissionContext,
    requiredPermission: Permission
  ): Promise<PermissionResult> {
    const startTime = Date.now();
    
    try {
      // Check cache first
      const cacheKey = this.generateCacheKey(context, requiredPermission);
      const cachedResult = this.permissionCache.get(cacheKey);
      
      if (cachedResult && cachedResult.expiration > new Date()) {
        this.logger.debug(`🔍 Permission check cached: ${requiredPermission} for ${context.userRole}`);
        return cachedResult.result;
      }

      // Get role definition
      const roleDefinition = this.roleDefinitions.get(context.userRole);
      if (!roleDefinition) {
        const result: PermissionResult = {
          granted: false,
          reason: `Invalid role: ${context.userRole}`,
          auditLevel: 'critical'
        };
        await this.logPermissionCheck(context, requiredPermission, result, Date.now() - startTime);
        return result;
      }

      // Check if role has the required permission
      if (!roleDefinition.permissions.includes(requiredPermission)) {
        const result: PermissionResult = {
          granted: false,
          reason: `Role ${context.userRole} does not have permission ${requiredPermission}`,
          auditLevel: 'medium'
        };
        await this.logPermissionCheck(context, requiredPermission, result, Date.now() - startTime);
        return result;
      }

      // Apply context-specific restrictions
      const restrictionResult = await this.applyRestrictions(context, roleDefinition, requiredPermission);
      if (!restrictionResult.granted) {
        await this.logPermissionCheck(context, requiredPermission, restrictionResult, Date.now() - startTime);
        return restrictionResult;
      }

      // Permission granted
      const result: PermissionResult = {
        granted: true,
        reason: `Permission ${requiredPermission} granted for role ${context.userRole}`,
        auditLevel: this.getAuditLevel(requiredPermission),
        conditions: restrictionResult.conditions,
        expiration: restrictionResult.expiration,
        requiresApproval: restrictionResult.requiresApproval
      };

      // Cache successful result
      this.cachePermissionResult(cacheKey, result, 300); // 5 minutes cache

      await this.logPermissionCheck(context, requiredPermission, result, Date.now() - startTime);
      
      return result;

    } catch (error) {
      this.logger.error(`❌ Permission check failed: ${error.message}`);
      const result: PermissionResult = {
        granted: false,
        reason: `Permission check error: ${error.message}`,
        auditLevel: 'critical'
      };
      await this.logPermissionCheck(context, requiredPermission, result, Date.now() - startTime);
      return result;
    }
  }

  async enforcePermission(
    context: PermissionContext,
    requiredPermission: Permission
  ): Promise<void> {
    const result = await this.checkPermission(context, requiredPermission);
    
    if (!result.granted) {
      this.logger.warn(`🚫 Permission denied: ${result.reason}`);
      
      // Emit security event
      await this.eventEmitter.emitAsync('security.permission-denied', {
        context,
        permission: requiredPermission,
        result
      });

      throw new ForbiddenException(result.reason);
    }

    // Log successful access for high-level permissions
    if (result.auditLevel === 'high' || result.auditLevel === 'critical') {
      await this.eventEmitter.emitAsync('security.high-privilege-access', {
        context,
        permission: requiredPermission,
        result
      });
    }
  }

  private async applyRestrictions(
    context: PermissionContext,
    roleDefinition: RoleDefinition,
    permission: Permission
  ): Promise<PermissionResult> {
    const restrictions: string[] = [];

    // Clinic scope restrictions
    if (roleDefinition.restrictions.clinicScope) {
      if (!context.clinicId) {
        return {
          granted: false,
          reason: 'Clinic context required but not provided',
          auditLevel: 'high'
        };
      }

      if (context.targetClinicId && context.targetClinicId !== context.clinicId) {
        return {
          granted: false,
          reason: 'Cross-clinic access not permitted',
          auditLevel: 'high'
        };
      }
    }

    // Patient scope restrictions
    if (roleDefinition.restrictions.patientScope) {
      const isOwnRecord = context.targetUserId === context.userId || 
                         context.targetPatientId === context.userId;
      
      if (context.targetPatientId && !isOwnRecord && context.userRole === Role.PATIENT) {
        return {
          granted: false,
          reason: 'Can only access own patient records',
          auditLevel: 'high'
        };
      }
      
      restrictions.push('Patient scope limited to assigned/own patients');
    }

    // Time-based restrictions
    if (roleDefinition.restrictions.timeRestrictions) {
      const currentHour = new Date().getHours();
      
      // Business hours check (8 AM to 6 PM)
      if (currentHour < 8 || currentHour > 18) {
        // Emergency access allowed
        if (permission === Permission.EMERGENCY_ACCESS || context.userRole === Role.SUPER_ADMIN) {
          restrictions.push('After-hours emergency access');
        } else {
          return {
            granted: false,
            reason: 'Access restricted outside business hours (8 AM - 6 PM)',
            auditLevel: 'medium'
          };
        }
      }
    }

    // Emergency override check
    if (permission === Permission.EMERGENCY_ACCESS) {
      restrictions.push('Emergency access granted with full audit trail');
      return {
        granted: true,
        reason: 'Emergency access granted with full audit trail',
        conditions: restrictions,
        auditLevel: 'critical',
        requiresApproval: context.userRole !== Role.DOCTOR && context.userRole !== Role.SUPER_ADMIN
      };
    }

    return {
      granted: true,
      reason: 'Permission granted with restrictions applied',
      conditions: restrictions.length > 0 ? restrictions : undefined,
      auditLevel: 'low'
    };
  }

  // Role Management

  getRoleDefinition(role: Role): RoleDefinition | undefined {
    return this.roleDefinitions.get(role);
  }

  getAllRoles(): RoleDefinition[] {
    return Array.from(this.roleDefinitions.values());
  }

  getRoleHierarchy(): { role: Role; hierarchy: number; name: string }[] {
    return Array.from(this.roleDefinitions.values())
      .map(def => ({ role: def.role, hierarchy: def.hierarchy, name: def.name }))
      .sort((a, b) => a.hierarchy - b.hierarchy);
  }

  hasHigherAuthority(role1: Role, role2: Role): boolean {
    const def1 = this.roleDefinitions.get(role1);
    const def2 = this.roleDefinitions.get(role2);
    
    if (!def1 || !def2) return false;
    
    return def1.hierarchy < def2.hierarchy; // Lower number = higher authority
  }

  async canAssignRole(assignerRole: Role, targetRole: Role): Promise<boolean> {
    // Super admin can assign any role
    if (assignerRole === Role.SUPER_ADMIN) return true;
    
    // Admin can assign roles lower than their own (except super admin)
    if (assignerRole === Role.ADMIN && targetRole !== Role.SUPER_ADMIN) {
      return this.hasHigherAuthority(assignerRole, targetRole);
    }
    
    return false;
  }

  // Permission Analysis

  getRolePermissions(role: Role): Permission[] {
    const roleDefinition = this.roleDefinitions.get(role);
    return roleDefinition ? [...roleDefinition.permissions] : [];
  }

  getPermissionsByCategory(): Record<string, Permission[]> {
    const categories = {
      'User Management': [
        Permission.CREATE_USER,
        Permission.READ_USER,
        Permission.UPDATE_USER,
        Permission.DELETE_USER,
        Permission.MANAGE_ROLES
      ],
      'Patient Management': [
        Permission.CREATE_PATIENT,
        Permission.READ_PATIENT,
        Permission.UPDATE_PATIENT,
        Permission.DELETE_PATIENT,
        Permission.READ_MEDICAL_RECORDS,
        Permission.UPDATE_MEDICAL_RECORDS
      ],
      'Appointment Management': [
        Permission.CREATE_APPOINTMENT,
        Permission.READ_APPOINTMENT,
        Permission.UPDATE_APPOINTMENT,
        Permission.DELETE_APPOINTMENT,
        Permission.SCHEDULE_APPOINTMENT,
        Permission.CANCEL_APPOINTMENT
      ],
      'Financial Management': [
        Permission.READ_BILLING,
        Permission.CREATE_BILLING,
        Permission.UPDATE_BILLING,
        Permission.PROCESS_PAYMENT,
        Permission.REFUND_PAYMENT
      ],
      'System Management': [
        Permission.READ_AUDIT_LOGS,
        Permission.MANAGE_SYSTEM_SETTINGS,
        Permission.ACCESS_REPORTS,
        Permission.MANAGE_INTEGRATIONS,
        Permission.MANAGE_QUEUES,
        Permission.VIEW_QUEUE_METRICS
      ],
      'Emergency Access': [
        Permission.EMERGENCY_ACCESS,
        Permission.OVERRIDE_RESTRICTIONS
      ]
    };

    return categories;
  }

  // Utility Methods

  private generateCacheKey(context: PermissionContext, permission: Permission): string {
    return `${context.userId}-${context.userRole}-${permission}-${context.clinicId || 'global'}`;
  }

  private cachePermissionResult(key: string, result: PermissionResult, ttlSeconds: number): void {
    const expiration = new Date(Date.now() + ttlSeconds * 1000);
    this.permissionCache.set(key, { result, expiration });
  }

  private getAuditLevel(permission: Permission): 'low' | 'medium' | 'high' | 'critical' {
    const criticalPermissions = [
      Permission.DELETE_USER,
      Permission.DELETE_PATIENT,
      Permission.MANAGE_SYSTEM_SETTINGS,
      Permission.EMERGENCY_ACCESS,
      Permission.OVERRIDE_RESTRICTIONS
    ];

    const highPermissions = [
      Permission.CREATE_USER,
      Permission.MANAGE_ROLES,
      Permission.UPDATE_MEDICAL_RECORDS,
      Permission.REFUND_PAYMENT,
      Permission.READ_AUDIT_LOGS
    ];

    if (criticalPermissions.includes(permission)) return 'critical';
    if (highPermissions.includes(permission)) return 'high';
    if (permission.toString().includes('CREATE') || permission.toString().includes('UPDATE')) return 'medium';
    return 'low';
  }

  private async logPermissionCheck(
    context: PermissionContext,
    permission: Permission,
    result: PermissionResult,
    processingTimeMs: number
  ): Promise<void> {
    // Emit permission check event for audit logging
    await this.eventEmitter.emitAsync('rbac.permission-checked', {
      context,
      permission,
      result,
      processingTimeMs,
      timestamp: new Date()
    });
  }

  private startCacheCleanup(): void {
    // Clean expired cache entries every 5 minutes
    setInterval(() => {
      const now = new Date();
      const expiredKeys: string[] = [];
      
      for (const [key, cached] of this.permissionCache.entries()) {
        if (cached.expiration < now) {
          expiredKeys.push(key);
        }
      }
      
      expiredKeys.forEach(key => this.permissionCache.delete(key));
      
      if (expiredKeys.length > 0) {
        this.logger.debug(`🧹 Cleaned ${expiredKeys.length} expired permission cache entries`);
      }
    }, 5 * 60 * 1000);
  }

  // Statistics and Monitoring

  async getPermissionStats(): Promise<{
    totalRoles: number;
    totalPermissions: number;
    cacheHitRate: number;
    recentChecks: number;
  }> {
    return {
      totalRoles: this.roleDefinitions.size,
      totalPermissions: Object.values(Permission).length,
      cacheHitRate: 0, // Would be calculated from actual metrics
      recentChecks: 0 // Would be calculated from actual metrics
    };
  }

  clearPermissionCache(userId?: string): void {
    if (userId) {
      // Clear cache for specific user
      const keysToDelete = Array.from(this.permissionCache.keys())
        .filter(key => key.startsWith(userId));
      keysToDelete.forEach(key => this.permissionCache.delete(key));
      this.logger.log(`🧹 Cleared permission cache for user ${userId}`);
    } else {
      // Clear entire cache
      this.permissionCache.clear();
      this.logger.log('🧹 Cleared entire permission cache');
    }
  }
}