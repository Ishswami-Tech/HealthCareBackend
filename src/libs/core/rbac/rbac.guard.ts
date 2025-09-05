import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { RbacService, RbacContext } from './rbac.service';
import { RBAC_METADATA_KEY } from './rbac.decorators';

export interface RbacRequirement {
  resource: string;
  action: string;
  clinicId?: string;
  requireOwnership?: boolean;
  allowSuperAdmin?: boolean;
}

@Injectable()
export class RbacGuard implements CanActivate {
  private readonly logger = new Logger(RbacGuard.name);

  constructor(
    private readonly rbacService: RbacService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    return this.validateRequest(context);
  }

  private async validateRequest(context: ExecutionContext): Promise<boolean> {
    try {
      // Get RBAC requirements from decorator
      const rbacRequirements = this.reflector.getAllAndOverride<RbacRequirement[]>(
        RBAC_METADATA_KEY,
        [context.getHandler(), context.getClass()],
      );

      if (!rbacRequirements || rbacRequirements.length === 0) {
        // No RBAC requirements specified, allow access
        return true;
      }

      const request = context.switchToHttp().getRequest();
      const user = request.user;
      
      if (!user || !user.id) {
        this.logger.warn('No user found in request for RBAC check');
        throw new ForbiddenException('Authentication required');
      }

      // Extract context information
      const clinicId = this.extractClinicId(request, rbacRequirements);
      const userId = user.id;

      // Check each requirement
      for (const requirement of rbacRequirements) {
        const rbacContext: RbacContext = {
          userId,
          clinicId: requirement.clinicId || clinicId,
          resource: requirement.resource,
          action: requirement.action,
          metadata: {
            requestUrl: request.url,
            requestMethod: request.method,
            userAgent: request.headers['user-agent'],
            ipAddress: this.extractClientIp(request),
          },
        };

        const permissionCheck = await this.rbacService.checkPermission(rbacContext);
        
        if (!permissionCheck.hasPermission) {
          // Check if super admin bypass is allowed
          if (requirement.allowSuperAdmin !== false && this.isSuperAdmin(permissionCheck.roles)) {
            this.logger.log(`Super admin bypass granted for user ${userId}`);
            continue;
          }

          // Check ownership requirement
          if (requirement.requireOwnership && await this.checkOwnership(request, userId, requirement)) {
            this.logger.log(`Ownership check passed for user ${userId}`);
            continue;
          }

          this.logger.warn(`Permission denied for user ${userId}`, {
            resource: requirement.resource,
            action: requirement.action,
            clinicId: rbacContext.clinicId,
            reason: permissionCheck.reason,
            roles: permissionCheck.roles,
          });

          throw new ForbiddenException(
            `Insufficient permissions for ${requirement.resource}:${requirement.action}`
          );
        }

        this.logger.debug(`Permission granted for user ${userId}`, {
          resource: requirement.resource,
          action: requirement.action,
          clinicId: rbacContext.clinicId,
          roles: permissionCheck.roles,
        });
      }

      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }

      this.logger.error('RBAC guard validation failed', error.stack);
      throw new ForbiddenException('Permission validation failed');
    }
  }

  /**
   * Extract clinic ID from request
   */
  private extractClinicId(request: any, requirements: RbacRequirement[]): string | undefined {
    // Try to get clinic ID from various sources
    const sources = [
      request.params?.clinicId,
      request.body?.clinicId,
      request.query?.clinicId,
      request.headers['x-clinic-id'],
      request.user?.clinicId,
    ];

    // Check if any requirement specifies a clinic ID
    const requirementClinicId = requirements.find(req => req.clinicId)?.clinicId;
    if (requirementClinicId) {
      return requirementClinicId;
    }

    return sources.find(id => id && typeof id === 'string');
  }

  /**
   * Extract client IP address
   */
  private extractClientIp(request: any): string {
    return (
      request.headers['x-forwarded-for'] ||
      request.headers['x-real-ip'] ||
      request.connection?.remoteAddress ||
      request.socket?.remoteAddress ||
      request.ip ||
      '127.0.0.1'
    );
  }

  /**
   * Check if user has super admin role
   */
  private isSuperAdmin(roles: string[]): boolean {
    return roles.some(role => 
      role === 'SUPER_ADMIN' || 
      role === 'SYSTEM_ADMIN' || 
      role.toLowerCase().includes('super')
    );
  }

  /**
   * Check resource ownership
   */
  private async checkOwnership(
    request: any,
    userId: string,
    requirement: RbacRequirement,
  ): Promise<boolean> {
    try {
      // Extract resource ID from request
      const resourceId = this.extractResourceId(request, requirement.resource);
      
      if (!resourceId) {
        return false;
      }

      // Check ownership based on resource type
      switch (requirement.resource) {
        case 'profile':
        case 'user':
          return resourceId === userId;

        case 'appointments':
          return await this.checkAppointmentOwnership(resourceId, userId);

        case 'medical-records':
          return await this.checkMedicalRecordOwnership(resourceId, userId);

        case 'patients':
          return await this.checkPatientOwnership(resourceId, userId);

        default:
          // Default ownership check - assume resource belongs to user if IDs match
          return resourceId === userId;
      }
    } catch (error) {
      this.logger.error(`Ownership check failed for ${requirement.resource}`, error.stack);
      return false;
    }
  }

  /**
   * Extract resource ID from request
   */
  private extractResourceId(request: any, resource: string): string | undefined {
    const paramKeys = [
      'id',
      `${resource}Id`,
      `${resource.slice(0, -1)}Id`, // Remove 's' from plural
    ];

    for (const key of paramKeys) {
      if (request.params?.[key]) {
        return request.params[key];
      }
    }

    return request.body?.id || request.query?.id;
  }

  /**
   * Check appointment ownership
   */
  private async checkAppointmentOwnership(appointmentId: string, userId: string): Promise<boolean> {
    try {
      // This would typically query the database to check if the user owns the appointment
      // For now, we'll implement a basic check
      // In a real implementation, you would inject the appointment service
      return true; // Placeholder implementation
    } catch (error) {
      this.logger.error(`Failed to check appointment ownership`, error.stack);
      return false;
    }
  }

  /**
   * Check medical record ownership
   */
  private async checkMedicalRecordOwnership(recordId: string, userId: string): Promise<boolean> {
    try {
      // This would typically query the database to check if the user owns the medical record
      return true; // Placeholder implementation
    } catch (error) {
      this.logger.error(`Failed to check medical record ownership`, error.stack);
      return false;
    }
  }

  /**
   * Check patient ownership
   */
  private async checkPatientOwnership(patientId: string, userId: string): Promise<boolean> {
    try {
      // Check if the user is the patient or has access to the patient
      return patientId === userId; // Simplified check
    } catch (error) {
      this.logger.error(`Failed to check patient ownership`, error.stack);
      return false;
    }
  }
}