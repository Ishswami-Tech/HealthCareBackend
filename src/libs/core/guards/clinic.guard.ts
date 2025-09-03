import { Injectable, CanActivate, ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../infrastructure/database/prisma/prisma.service';
import { LoggingService } from '../../infrastructure/logging/logging.service';
import { LogType, LogLevel } from '../../infrastructure/logging/types/logging.types';
import { ExtendedClinicContext } from '../../utils/middleware/clinic-context.middleware';

@Injectable()
export class ClinicGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
    private loggingService: LoggingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const clinicContext: ExtendedClinicContext = request.clinicContext;

    // Log the request details for debugging
    this.loggingService.log(
      LogType.AUTH,
      LogLevel.DEBUG,
      `ClinicGuard processing request`,
      'ClinicGuard',
      { 
        path: request.url,
        method: request.method,
        userId: user?.id,
        userRole: user?.role,
        clinicContext: {
          identifier: clinicContext?.identifier,
          clinicId: clinicContext?.clinicId,
          isValid: clinicContext?.isValid,
          accessMethod: clinicContext?.accessMethod
        }
      }
    );

    // Check if this route is accessing clinic-specific resources
    const isClinicRoute = this.isClinicRoute(context);
    
    // If not a clinic route, allow access
    if (!isClinicRoute) {
      this.loggingService.log(
        LogType.AUTH,
        LogLevel.DEBUG,
        `Not a clinic route, allowing access`,
        'ClinicGuard',
        { path: request.url }
      );
      return true;
    }
    
    // For clinic routes, we need valid clinic context for data isolation
    if (!clinicContext || !clinicContext.isValid) {
      this.loggingService.log(
        LogType.AUTH,
        LogLevel.WARN,
        `Invalid clinic context for clinic route`,
        'ClinicGuard',
        { 
          path: request.url, 
          clinicIdentifier: clinicContext?.identifier,
          isValid: clinicContext?.isValid
        }
      );
      
      if (!clinicContext) {
        throw new ForbiddenException('Clinic context is required. Please provide clinic ID in header, query, or JWT token.');
      } else if (!clinicContext.identifier) {
        throw new ForbiddenException('Clinic identifier is required.');
      } else if (!clinicContext.clinicId) {
        throw new ForbiddenException(`Clinic not found: ${clinicContext.identifier}`);
      } else {
        throw new ForbiddenException('Clinic is not active or accessible');
      }
    }

    // If user is authenticated, ensure they have access to this clinic
    if (user) {
      const userId = user.sub || user.id;
      if (!userId || userId === 'undefined') {
        throw new UnauthorizedException('User ID is required');
      }
      
      this.loggingService.log(
        LogType.AUTH,
        LogLevel.DEBUG,
        `User authenticated with valid clinic context`,
        'ClinicGuard',
        { 
          userId: userId,
          userRole: user.role,
          clinicId: clinicContext.clinicId,
          clinicName: clinicContext.clinicName,
          accessMethod: clinicContext.accessMethod
        }
      );
      
      return true;
    }

    // For routes that don't require authentication but need clinic context
    this.loggingService.log(
      LogType.AUTH,
      LogLevel.DEBUG,
      `Allowing access with valid clinic context (no auth required)`,
      'ClinicGuard',
      {
        clinicId: clinicContext.clinicId,
        accessMethod: clinicContext.accessMethod
      }
    );
    return true;
  }

  private isClinicRoute(context: ExecutionContext): boolean {
    // Get the controller and handler metadata to determine if this is a clinic route
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);

    // If marked as public, it's not a clinic route
    if (isPublic) {
      return false;
    }

    // Get controller metadata to check if it's a clinic route
    const isClinicRoute = this.reflector.getAllAndOverride<boolean>('isClinicRoute', [
      context.getHandler(),
      context.getClass(),
    ]);

    // If explicitly marked as a clinic route, return true
    if (isClinicRoute) {
      return true;
    }

    // Otherwise, check the route path to determine if it's a clinic route
    const request = context.switchToHttp().getRequest();
    const path = request.url;
    
    // Clinic routes typically include /clinics/ or /appointments/ or similar
    const clinicRoutePatterns = [
      /\/appointments\//,
      /\/clinics\//,
      /\/doctors\//,
      /\/locations\//,
      /\/patients\//,
      /\/queue\//,
      /\/prescriptions\//,
    ];

    return clinicRoutePatterns.some(pattern => pattern.test(path));
  }
} 