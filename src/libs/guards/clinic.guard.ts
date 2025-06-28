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

    // Check if this route is accessing clinic-specific resources
    const isClinicRoute = this.isClinicRoute(context);
    
    // If not a clinic route, allow access
    if (!isClinicRoute) {
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
      throw new ForbiddenException('Invalid clinic context');
    }

    // If user authentication is required, check if they belong to this clinic
    if (user) {
      // Get user's clinic associations
      const userWithClinic = await this.prisma.user.findUnique({
        where: { id: user.id },
        include: {
          clinics: true,
          doctor: true,
          receptionists: true,
          clinicAdmins: true,
        },
      });

      if (!userWithClinic) {
        throw new UnauthorizedException('User not found');
      }

      // Determine if user has access to the requested clinic
      let hasAccess = false;
      
      // Check if user is directly linked to this clinic
      if ((userWithClinic as any).clinics && (userWithClinic as any).clinics.length > 0) {
        hasAccess = (userWithClinic as any).clinics.some((clinic: any) => clinic.id === clinicContext.clinicId);
      }
      
      // Check if user is a doctor in this clinic
      if (!hasAccess && (userWithClinic as any).doctor) {
        const doctorClinic = await this.prisma.doctorClinic.findFirst({
          where: {
            doctorId: (userWithClinic as any).doctor.id,
            clinicId: clinicContext.clinicId,
          },
        });
        hasAccess = !!doctorClinic;
      }
      
      // Check if user is a receptionist in this clinic
      if (!hasAccess && (userWithClinic as any).receptionists && (userWithClinic as any).receptionists.length > 0) {
        hasAccess = (userWithClinic as any).receptionists.some((rec: any) => rec.clinicId === clinicContext.clinicId);
      }
      
      // Check if user is an admin in this clinic
      if (!hasAccess && (userWithClinic as any).clinicAdmins && (userWithClinic as any).clinicAdmins.length > 0) {
        hasAccess = (userWithClinic as any).clinicAdmins.some((admin: any) => admin.clinicId === clinicContext.clinicId);
      }

      if (!hasAccess) {
        this.loggingService.log(
          LogType.AUTH,
          LogLevel.WARN,
          `User ${user.id} attempted to access clinic ${clinicContext.clinicId} without permission`,
          'ClinicGuard',
          { 
            userId: user.id,
            requestedClinic: clinicContext.clinicId,
            userClinics: (userWithClinic as any).clinics?.map((c: any) => c.id)
          }
        );
        throw new ForbiddenException('You do not have access to this clinic');
      }

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