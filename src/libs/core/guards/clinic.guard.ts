import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
// Use direct imports to avoid TDZ issues with barrel exports
import { DatabaseService } from '@infrastructure/database/database.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';
import { ClinicIsolationService } from '@infrastructure/database/internal/clinic-isolation.service';
import type { ClinicRequest, ClinicValidationResult } from '@core/types/guard.types';

/**
 * Clinic Guard for Healthcare Applications
 *
 * @class ClinicGuard
 * @implements CanActivate
 * @description Guards clinic-specific routes to ensure proper clinic context and access control.
 * Validates clinic access and sets clinic context for downstream use.
 *
 * @example
 * ```typescript
 * // Use with @UseGuards decorator
 * @Controller('appointments')
 * @UseGuards(ClinicGuard)
 * export class AppointmentsController {
 *   @Get()
 *   async getAppointments() {
 *     // Clinic context is automatically available
 *   }
 * }
 * ```
 */
@Injectable()
export class ClinicGuard implements CanActivate {
  /**
   * Creates a new ClinicGuard instance
   *
   * @param reflector - NestJS reflector for metadata access
   * @param prisma - Prisma service for database operations
   * @param loggingService - Logging service for audit trails
   * @param clinicIsolationService - Service for clinic access validation
   */
  constructor(
    private readonly reflector: Reflector,
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => ClinicIsolationService))
    private readonly clinicIsolationService: ClinicIsolationService
  ) {}

  /**
   * Determines if the current request can proceed with clinic access
   *
   * @param context - The execution context containing request information
   * @returns Promise<boolean> - True if access is allowed, false otherwise
   * @throws ForbiddenException - When clinic access is denied
   * @description Validates clinic access for clinic-specific routes and sets clinic context
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ClinicRequest>();
    const user = request.user;

    // Log the request details for debugging
    void this.loggingService.log(
      LogType.AUTH,
      LogLevel.DEBUG,
      `ClinicGuard processing request`,
      'ClinicGuard',
      {
        path: request.url,
        method: request.method,
        userId: user?.id,
        userRole: user?.role,
      }
    );

    // Check if this route is accessing clinic-specific resources
    const isClinicRoute = this.isClinicRoute(context);

    // If not a clinic route, allow access
    if (!isClinicRoute) {
      void this.loggingService.log(
        LogType.AUTH,
        LogLevel.DEBUG,
        `Not a clinic route, allowing access`,
        'ClinicGuard',
        { path: request.url }
      );
      return true;
    }

    // For clinic routes, extract clinic ID from request
    const clinicId = this.extractClinicId(request);

    if (!clinicId) {
      void this.loggingService.log(
        LogType.AUTH,
        LogLevel.WARN,
        `Clinic ID required for clinic route`,
        'ClinicGuard',
        { path: request.url }
      );
      throw new ForbiddenException(
        'Clinic ID is required. Please provide clinic ID in header, query, or JWT token.'
      );
    }

    // Validate clinic access using ClinicIsolationService
    const clinicResult: ClinicValidationResult =
      await this.clinicIsolationService.validateClinicAccess(
        user?.sub || user?.id || 'anonymous',
        clinicId
      );

    if (!clinicResult.success) {
      void this.loggingService.log(
        LogType.AUTH,
        LogLevel.WARN,
        `Invalid clinic access`,
        'ClinicGuard',
        {
          path: request.url,
          clinicId,
          error: clinicResult.error,
        }
      );
      throw new ForbiddenException(`Clinic access denied: ${clinicResult.error}`);
    }

    // Set clinic context in request for downstream use
    request.clinicId = clinicId;
    request.clinicContext = clinicResult.clinicContext as unknown as {
      [key: string]: unknown;
      clinicName?: string;
    };

    void this.loggingService.log(
      LogType.AUTH,
      LogLevel.DEBUG,
      `Clinic access validated`,
      'ClinicGuard',
      {
        userId: user?.sub || user?.id,
        userRole: user?.role,
        clinicId,
        clinicName: clinicResult.clinicContext?.clinicName,
      }
    );

    return true;
  }

  /**
   * Determines if the current route requires clinic context
   *
   * @param context - The execution context containing route information
   * @returns True if the route requires clinic context
   * @private
   */
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
    const request = context.switchToHttp().getRequest<ClinicRequest>();
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

  /**
   * Extracts clinic ID from various sources in the request
   *
   * @param request - The clinic request object
   * @returns The clinic ID if found, null otherwise
   * @private
   */
  private extractClinicId(request: ClinicRequest): string | null {
    // Try to get clinic ID from various sources

    // 1. From headers
    const headerClinicId = request.headers['x-clinic-id'] || request.headers['clinic-id'];
    if (headerClinicId) {
      return headerClinicId;
    }

    // 2. From query parameters
    const queryClinicId = request.query?.clinicId || request.query?.clinic_id;
    if (queryClinicId) {
      return queryClinicId;
    }

    // 3. From JWT token (if user is authenticated)
    if (request.user?.clinicId) {
      return request.user.clinicId;
    }

    // 4. From route parameters
    const routeClinicId = request.params?.clinicId || request.params?.clinic_id;
    if (routeClinicId) {
      return routeClinicId;
    }

    // 5. From body (for POST/PUT requests)
    if (request.body?.clinicId) {
      return request.body.clinicId;
    }

    return null;
  }
}
