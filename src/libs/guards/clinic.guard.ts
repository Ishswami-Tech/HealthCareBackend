import { Injectable, CanActivate, ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../shared/database/prisma/prisma.service';
import { LoggingService } from '../../shared/logging/logging.service';
import { LogType, LogLevel } from '../../shared/logging/types/logging.types';
import { ClinicContext } from '../../shared/middleware/clinic-context.middleware';

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
    const clinicContext: ClinicContext = request.clinicContext;

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
          isValid: clinicContext?.isValid
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
    
    // For clinic routes, we need a valid clinic context
    if (!clinicContext || !clinicContext.isValid) {
      this.loggingService.log(
        LogType.AUTH,
        LogLevel.WARN,
        `Invalid clinic context for route`,
        'ClinicGuard',
        { path: request.url, clinicContext }
      );
      
      if (!clinicContext) {
        throw new ForbiddenException('Clinic context is required. Please provide X-Clinic-ID header or clinicId in JWT token.');
      } else if (!clinicContext.identifier) {
        throw new ForbiddenException('Clinic identifier is required. Please provide X-Clinic-ID header or clinicId in JWT token.');
      } else if (!clinicContext.clinicId) {
        throw new ForbiddenException(`Clinic not found with identifier: ${clinicContext.identifier}`);
      } else {
        throw new ForbiddenException('Clinic is not active or accessible');
      }
    }

    // If user authentication is required, check if they belong to this clinic
    if (user) {
      // Use user.sub (JWT subject) as userId, fallback to user.id
      const userId = user.sub || user.id;
      if (!userId || userId === 'undefined') {
        throw new UnauthorizedException('User ID is required');
      }
      
      // For basic clinic access, if the user has a valid JWT and the clinic context is valid,
      // allow access. More specific permission checks can be done in individual services.
      // This allows for more flexible access patterns while still maintaining security.
      
      this.loggingService.log(
        LogType.AUTH,
        LogLevel.DEBUG,
        `User authenticated, allowing clinic access`,
        'ClinicGuard',
        { 
          userId: userId,
          userRole: user.role,
          clinicId: clinicContext.clinicId
        }
      );
      
      // Store clinic information in request for later use
      request.clinic = {
        id: clinicContext.clinicId,
        subdomain: clinicContext.subdomain,
        appName: clinicContext.appName
      };
      
      return true;
    }

    // If no user is provided but we have a valid clinic context,
    // we'll let other guards handle the authentication if needed
    this.loggingService.log(
      LogType.AUTH,
      LogLevel.DEBUG,
      `No user but valid clinic context, allowing access`,
      'ClinicGuard',
      { clinicId: clinicContext.clinicId }
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