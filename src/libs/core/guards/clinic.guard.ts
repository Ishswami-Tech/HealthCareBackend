import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '@core/decorators/public.decorator';
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

    // Check if this is a public endpoint (no clinicId required)
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Public endpoints don't require clinicId
    if (isPublic) {
      void this.loggingService.log(
        LogType.AUTH,
        LogLevel.DEBUG,
        `Public endpoint, skipping clinic validation`,
        'ClinicGuard',
        { path: request.url }
      );
      return true;
    }

    // For ALL authenticated requests (non-public), clinicId is COMPULSORY
    const clinicId = this.extractClinicId(request);

    if (!clinicId) {
      void this.loggingService.log(
        LogType.AUTH,
        LogLevel.WARN,
        `Clinic ID is required for all authenticated requests`,
        'ClinicGuard',
        { path: request.url, method: request.method }
      );
      throw new ForbiddenException(
        'Clinic ID is COMPULSORY for all requests. Please provide clinic ID via:\n' +
          '  - X-Clinic-ID header (recommended)\n' +
          '  - clinicId query parameter\n' +
          '  - clinicId in request body\n' +
          '  - clinicId in JWT token payload'
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

    // Extract locationId if provided
    const locationId = this.extractLocationId(request);

    // Set clinic context in request for downstream use
    request.clinicId = clinicId;
    if (locationId) {
      request.locationId = locationId;
    }
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

  // Note: isClinicRoute method removed - ALL authenticated requests now require clinicId
  // Only public endpoints (marked with @Public()) are exempt

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

  /**
   * Extracts location ID from various sources in the request
   *
   * @param request - The clinic request object
   * @returns The location ID if found, null otherwise
   * @private
   */
  private extractLocationId(request: ClinicRequest): string | null {
    // Try to get location ID from various sources

    // 1. From headers
    const headerLocationId = request.headers['x-location-id'] || request.headers['location-id'];
    if (headerLocationId) {
      return headerLocationId;
    }

    // 2. From query parameters
    const queryLocationId = request.query?.locationId || request.query?.location_id;
    if (queryLocationId) {
      return queryLocationId;
    }

    // 3. From JWT token (if user is authenticated)
    const userLocationId = request.user?.['locationId'];
    if (typeof userLocationId === 'string') {
      return userLocationId;
    }

    // 4. From route parameters
    const routeLocationId = request.params?.locationId || request.params?.location_id;
    if (routeLocationId) {
      return routeLocationId;
    }

    // 5. From body (for POST/PUT requests)
    if (request.body?.['locationId']) {
      return request.body['locationId'] as string;
    }

    return null;
  }
}
