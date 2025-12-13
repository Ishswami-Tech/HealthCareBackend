import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { RbacService } from './rbac.service';
import type { RbacContext, RbacRequirement } from '@core/types/rbac.types';
import { RBAC_METADATA_KEY } from './rbac.decorators';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type { RequestWithAuth } from '@core/types/guard.types';
import { DatabaseService } from '@infrastructure/database';

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private readonly rbacService: RbacService,
    private readonly reflector: Reflector,
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService
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
   * Verifies if user owns the appointment (as patient or doctor) or has clinic staff access
   */
  private async checkAppointmentOwnership(appointmentId: string, userId: string): Promise<boolean> {
    try {
      const appointment = await this.databaseService.executeHealthcareRead<{
        userId: string;
        clinicId: string;
        patient: { userId: string } | null;
        doctor: { userId: string } | null;
      } | null>(async client => {
        const result = await client.appointment.findUnique({
          where: { id: appointmentId },
          select: {
            userId: true,
            clinicId: true,
            patient: { select: { userId: true } },
            doctor: { select: { userId: true } },
          },
        });
        return result as
          | { userId: string; clinicId: string; patient: { userId: string } | null; doctor: { userId: string } | null }
          | null;
      });

      if (!appointment) {
        void this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'Appointment not found for ownership check',
          'RbacGuard',
          { appointmentId, userId }
        );
        return false;
      }

      // Appointment ownership is based on authenticated User.id (not Patient.id / Doctor.id)
      if (appointment.userId === userId) {
        return true;
      }

      if (appointment.patient?.userId === userId) {
        return true;
      }

      if (appointment.doctor?.userId === userId) {
        return true;
      }

      // Check if user is clinic staff with access
      const hasClinicAccess = await this.checkClinicStaffAccess(userId, appointment.clinicId);
      if (hasClinicAccess) {
        return true;
      }

      return false;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Appointment ownership check failed',
        'RbacGuard',
        {
          appointmentId,
          userId,
          error: error instanceof Error ? error.message : 'Unknown',
        }
      );
      return false; // Fail secure
    }
  }

  /**
   * Check medical record ownership
   * Verifies if user owns the medical record (as patient) or has clinic staff access
   */
  private async checkMedicalRecordOwnership(recordId: string, userId: string): Promise<boolean> {
    try {
      const record = await this.databaseService.executeHealthcareRead<{
        patientId: string;
        clinicId: string;
      } | null>(async client => {
        const result = await client.healthRecord.findUnique({
          where: { id: recordId },
          select: {
            patientId: true,
            clinicId: true,
          },
        });
        return result as { patientId: string; clinicId: string } | null;
      });

      if (!record) {
        void this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'Medical record not found for ownership check',
          'RbacGuard',
          { recordId, userId }
        );
        return false;
      }

      // Patient owns their medical records
      if (record.patientId === userId) {
        return true;
      }

      // Check if user is clinic staff with access
      return await this.checkClinicStaffAccess(userId, record.clinicId);
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Medical record ownership check failed',
        'RbacGuard',
        {
          recordId,
          userId,
          error: error instanceof Error ? error.message : 'Unknown',
        }
      );
      return false; // Fail secure
    }
  }

  /**
   * Check patient ownership
   * Verifies if user is the patient or has clinic staff access
   */
  private async checkPatientOwnership(patientId: string, userId: string): Promise<boolean> {
    try {
      // If user is the patient themselves
      if (patientId === userId) {
        return true;
      }

      // Check if user has clinic staff access to this patient
      const user = await this.databaseService.findUserByIdSafe(userId);
      if (!user) {
        return false;
      }

      // Get patient's clinic
      const patient = await this.databaseService.executeHealthcareRead<{
        primaryClinicId: string | null;
      } | null>(async client => {
        const result = await client.user.findUnique({
          where: { id: patientId },
          select: { primaryClinicId: true },
        });
        return result as { primaryClinicId: string | null } | null;
      });

      if (!patient || !patient.primaryClinicId) {
        return false;
      }

      return await this.checkClinicStaffAccess(userId, patient.primaryClinicId);
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Patient ownership check failed',
        'RbacGuard',
        {
          patientId,
          userId,
          error: error instanceof Error ? error.message : 'Unknown',
        }
      );
      return false; // Fail secure
    }
  }

  /**
   * Check if user is clinic staff with access to the clinic
   */
  private async checkClinicStaffAccess(userId: string, clinicId: string): Promise<boolean> {
    try {
      const user = await this.databaseService.findUserByIdSafe(userId);
      if (!user) {
        return false;
      }

      const role = user.role;
      const clinicAccessRoles = ['RECEPTIONIST', 'CLINIC_ADMIN', 'DOCTOR', 'NURSE', 'SUPER_ADMIN'];

      if (!clinicAccessRoles.includes(role)) {
        return false;
      }

      // Super Admin has access to all clinics
      if (role === 'SUPER_ADMIN') {
        return true;
      }

      // Clinic Admin has access to their clinic
      if (role === 'CLINIC_ADMIN') {
        const userClinicId = user.primaryClinicId;
        return userClinicId === clinicId;
      }

      // For clinic-scoped roles, verify clinic membership
      if (role === 'DOCTOR' || role === 'RECEPTIONIST' || role === 'NURSE') {
        const userClinicId = user.primaryClinicId;
        return userClinicId === clinicId;
      }

      return false;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Clinic staff access check failed',
        'RbacGuard',
        {
          userId,
          clinicId,
          error: error instanceof Error ? error.message : 'Unknown',
        }
      );
      return false; // Fail secure
    }
  }
}
