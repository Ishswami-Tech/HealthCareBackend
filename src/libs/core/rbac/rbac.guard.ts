import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { RbacService } from './rbac.service';
import type { RbacContext, RbacRequirement } from '@core/types/rbac.types';
import { RBAC_METADATA_KEY } from './rbac.decorators';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type { RequestWithAuth } from '@core/types/guard.types';

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private readonly rbacService: RbacService,
    private readonly reflector: Reflector,
    private readonly loggingService: LoggingService
  ) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    return this.validateRequest(context);
  }

  private async validateRequest(context: ExecutionContext): Promise<boolean> {
    try {
      // Get RBAC requirements from decorator
      const rbacRequirements = this.reflector.getAllAndOverride<RbacRequirement[]>(
        RBAC_METADATA_KEY,
        [context.getHandler(), context.getClass()]
      );

      if (!rbacRequirements || rbacRequirements.length === 0) {
        // No RBAC requirements specified, allow access
        return true;
      }

      const request = context.switchToHttp().getRequest<RequestWithAuth>();
      const user = request.user;

      if (!user || !user.id) {
        void this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'No user found in request for RBAC check',
          'RbacGuard'
        );
        throw new ForbiddenException('Authentication required');
      }

      // Extract context information
      const clinicId = this.extractClinicId(request, rbacRequirements);
      const userId = user.id;

      // Check each requirement
      for (const requirement of rbacRequirements) {
        const rbacContext: RbacContext = {
          userId,
          ...(requirement.clinicId ? { clinicId: requirement.clinicId } : {}),
          ...(clinicId && !requirement.clinicId ? { clinicId } : {}),
          resource: requirement.resource,
          action: requirement.action,
          metadata: {
            requestUrl: request.url,
            requestMethod: request.method,
            ...(request.headers['user-agent'] && {
              userAgent: request.headers['user-agent'],
            }),
            ipAddress: this.extractClientIp(request),
          },
        };

        const permissionCheck = await this.rbacService.checkPermission(rbacContext);

        if (!permissionCheck.hasPermission) {
          // Check if super admin bypass is allowed
          if (requirement.allowSuperAdmin !== false && this.isSuperAdmin(permissionCheck.roles)) {
            void this.loggingService.log(
              LogType.SECURITY,
              LogLevel.INFO,
              'Super admin bypass granted',
              'RbacGuard',
              { userId }
            );
            continue;
          }

          // Check ownership requirement
          if (
            requirement.requireOwnership &&
            (await this.checkOwnership(request, userId, requirement))
          ) {
            void this.loggingService.log(
              LogType.SECURITY,
              LogLevel.INFO,
              'Ownership check passed',
              'RbacGuard',
              { userId }
            );
            continue;
          }

          void this.loggingService.log(
            LogType.SECURITY,
            LogLevel.WARN,
            'Permission denied',
            'RbacGuard',
            {
              userId,
              resource: requirement.resource,
              action: requirement.action,
              clinicId: rbacContext.clinicId,
              reason: permissionCheck.reason,
              roles: permissionCheck.roles,
            }
          );

          throw new ForbiddenException(
            `Insufficient permissions for ${requirement.resource}:${requirement.action}`
          );
        }

        void this.loggingService.log(
          LogType.SECURITY,
          LogLevel.DEBUG,
          'Permission granted',
          'RbacGuard',
          {
            userId,
            resource: requirement.resource,
            action: requirement.action,
            clinicId: rbacContext.clinicId,
            roles: permissionCheck.roles,
          }
        );
      }

      return true;
    } catch (_error) {
      if (_error instanceof ForbiddenException) {
        throw _error;
      }

      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'RBAC guard validation failed',
        'RbacGuard',
        { error: _error instanceof Error ? _error.message : 'Unknown' }
      );
      throw new ForbiddenException('Permission validation failed');
    }
  }

  /**
   * Extract clinic ID from request
   */
  private extractClinicId(
    request: RequestWithAuth,
    requirements: RbacRequirement[]
  ): string | undefined {
    // Try to get clinic ID from various sources
    const sources = [
      request.params?.['clinicId'] as string | undefined,
      request.body?.['clinicId'] as string | undefined,
      request.query?.['clinicId'] as string | undefined,
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
  private extractClientIp(request: RequestWithAuth): string {
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
    return roles.some(
      role =>
        role === 'SUPER_ADMIN' || role === 'SYSTEM_ADMIN' || role.toLowerCase().includes('super')
    );
  }

  /**
   * Check resource ownership
   */
  private async checkOwnership(
    request: RequestWithAuth,
    userId: string,
    requirement: RbacRequirement
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
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Ownership check failed',
        'RbacGuard',
        {
          resource: requirement.resource,
          error: _error instanceof Error ? _error.message : 'Unknown',
        }
      );
      return false;
    }
  }

  /**
   * Extract resource ID from request
   */
  private extractResourceId(request: RequestWithAuth, resource: string): string | undefined {
    const paramKeys = [
      'id',
      `${resource}Id`,
      `${resource.slice(0, -1)}Id`, // Remove 's' from plural
    ];

    for (const key of paramKeys) {
      const paramValue = request.params?.[key];
      if (paramValue && typeof paramValue === 'string') {
        return paramValue;
      }
    }

    const bodyId = request.body?.['id'];
    const queryId = request.query?.['id'];

    if (bodyId && typeof bodyId === 'string') return bodyId;
    if (queryId && typeof queryId === 'string') return queryId;

    return undefined;
  }

  /**
   * Check appointment ownership
   */
  private checkAppointmentOwnership(_appointmentId: string, _userId: string): Promise<boolean> {
    // This would typically query the database to check if the user owns the appointment
    // For now, we'll implement a basic check
    // In a real implementation, you would inject the appointment service
    return Promise.resolve(true); // Placeholder implementation
  }

  /**
   * Check medical record ownership
   */
  private checkMedicalRecordOwnership(_recordId: string, _userId: string): Promise<boolean> {
    // This would typically query the database to check if the user owns the medical record
    return Promise.resolve(true); // Placeholder implementation
  }

  /**
   * Check patient ownership
   */
  private checkPatientOwnership(patientId: string, userId: string): Promise<boolean> {
    // Check if the user is the patient or has access to the patient
    return Promise.resolve(patientId === userId); // Simplified check
  }
}
