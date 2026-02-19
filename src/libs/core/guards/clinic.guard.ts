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
import type { ClinicRequest } from '@core/types/guard.types';

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
    const user = request.user; // From JWT (set by AuthGuard if authenticated)

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
        hasUser: !!user,
      }
    );

    // Skip clinic validation for specific public modules
    // These modules don't require clinic context
    const publicModules = [
      '/health',
      '/dashboard',
      '/logger',
      '/queue',
      '/socket-test',
      '/docs',
      '/api-docs',
    ];
    const isPublicModule = publicModules.some(module => request.url.startsWith(module));

    if (isPublicModule) {
      void this.loggingService.log(
        LogType.AUTH,
        LogLevel.DEBUG,
        `Public module, skipping clinic validation`,
        'ClinicGuard',
        { path: request.url }
      );
      return true;
    }

    // Check if this is a public endpoint
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Extract clinic ID from header
    const headerClinicId = this.extractClinicId(request);

    // BYPASS for SUPER_ADMIN when no clinic header is provided (allows global context access)
    if (!headerClinicId && user?.role === 'SUPER_ADMIN') {
      void this.loggingService.log(
        LogType.AUTH,
        LogLevel.DEBUG,
        `SUPER_ADMIN global context, skipping clinic validation`,
        'ClinicGuard',
        { userId: user?.id, path: request.url }
      );
      return true;
    }

    // For public endpoints WITHOUT clinic ID, skip validation entirely
    // This allows other public endpoints to work without clinic context
    if (isPublic && !headerClinicId && !user) {
      void this.loggingService.log(
        LogType.AUTH,
        LogLevel.DEBUG,
        `Public endpoint without clinic ID, skipping validation`,
        'ClinicGuard',
        { path: request.url }
      );
      return true;
    }

    // For all other cases, clinic ID is required
    if (!headerClinicId) {
      void this.loggingService.log(
        LogType.AUTH,
        LogLevel.WARN,
        `Clinic ID is required for this request`,
        'ClinicGuard',
        { path: request.url, method: request.method, isPublic, hasUser: !!user }
      );
      throw new ForbiddenException('Clinic ID is required. Please provide via X-Clinic-ID header.');
    }

    // STRATEGY 1: Public endpoints WITH clinic ID (register, login, OTP) - validate clinic exists
    if (isPublic || !user) {
      return await this.validatePublicEndpoint(request, headerClinicId);
    }

    // STRATEGY 2: Protected endpoints - validate header matches JWT
    return await this.validateProtectedEndpoint(request, user, headerClinicId);
  }

  /**
   * Validate public endpoints (register, login, OTP)
   * Only checks if clinic exists and is active
   */
  private async validatePublicEndpoint(
    request: ClinicRequest,
    headerClinicId: string
  ): Promise<boolean> {
    try {
      // Resolve clinic ID to UUID and validate it exists
      const { resolveClinicUUID } = await import('@utils/clinic.utils');
      const clinicUUID = await resolveClinicUUID(this.databaseService, headerClinicId);

      // Store in request for use by controllers
      request.clinicId = clinicUUID;
      request.clinicContext = { clinicId: clinicUUID } as unknown as {
        [key: string]: unknown;
        clinicName?: string;
      };

      void this.loggingService.log(
        LogType.AUTH,
        LogLevel.DEBUG,
        `Public endpoint clinic validated: ${headerClinicId}`,
        'ClinicGuard',
        { clinicId: headerClinicId, clinicUUID, path: request.url }
      );

      return true;
    } catch (error) {
      void this.loggingService.log(
        LogType.SECURITY,
        LogLevel.ERROR,
        `Invalid clinic for public endpoint: ${headerClinicId}`,
        'ClinicGuard',
        {
          clinicId: headerClinicId,
          path: request.url,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw new ForbiddenException(`Invalid or inactive clinic: ${headerClinicId}`);
    }
  }

  /**
   * Validate protected endpoints
   * Ensures header matches JWT payload (prevents spoofing)
   */
  private async validateProtectedEndpoint(
    request: ClinicRequest,
    user: { id?: string; sub?: string; clinicId?: string; primaryClinicId?: string; role?: string },
    headerClinicId: string
  ): Promise<boolean> {
    // Extract clinic ID from JWT payload
    const jwtClinicId = user.clinicId || user.primaryClinicId;

    if (!jwtClinicId) {
      void this.loggingService.log(
        LogType.SECURITY,
        LogLevel.ERROR,
        'User JWT missing clinic ID',
        'ClinicGuard',
        { userId: user.id || user.sub, path: request.url }
      );
      throw new ForbiddenException('User account missing clinic association. Please re-login.');
    }

    try {
      // Resolve both to UUIDs for comparison
      const { resolveClinicUUID } = await import('@utils/clinic.utils');
      const headerUUID = await resolveClinicUUID(this.databaseService, headerClinicId);
      const jwtUUID = await resolveClinicUUID(this.databaseService, jwtClinicId);

      // Validate they match (prevents clinic ID spoofing)
      if (headerUUID !== jwtUUID) {
        void this.loggingService.log(
          LogType.SECURITY,
          LogLevel.ERROR,
          'Clinic ID mismatch: header does not match JWT',
          'ClinicGuard',
          {
            headerClinicId,
            jwtClinicId,
            headerUUID,
            jwtUUID,
            userId: user.id || user.sub,
            path: request.url,
          }
        );
        throw new ForbiddenException('Clinic authentication mismatch. Please re-login.');
      }

      // Validate user has access to this clinic
      const userId = user.id || user.sub;
      if (!userId) {
        throw new ForbiddenException('User ID missing from token');
      }

      const accessResult = await this.clinicIsolationService.validateClinicAccess(
        userId,
        headerUUID
      );

      if (!accessResult.success) {
        void this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          `User does not have access to clinic: ${headerClinicId}`,
          'ClinicGuard',
          {
            userId: user.id || user.sub,
            clinicId: headerUUID,
            error: accessResult.error,
            path: request.url,
          }
        );
        throw new ForbiddenException(`Clinic access denied: ${accessResult.error}`);
      }

      // Extract locationId if provided
      const locationId = this.extractLocationId(request);

      // Store validated clinic info in request
      request.clinicId = headerUUID;
      if (locationId) {
        request.locationId = locationId;
      }
      request.clinicContext = accessResult.clinicContext as unknown as {
        [key: string]: unknown;
        clinicName?: string;
      };

      void this.loggingService.log(
        LogType.AUTH,
        LogLevel.DEBUG,
        `Protected endpoint clinic validated: ${headerClinicId}`,
        'ClinicGuard',
        {
          clinicId: headerClinicId,
          clinicUUID: headerUUID,
          userId: user.id || user.sub,
          clinicName: accessResult.clinicContext?.clinicName,
        }
      );

      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      void this.loggingService.log(
        LogType.SECURITY,
        LogLevel.ERROR,
        `Clinic validation error: ${error instanceof Error ? error.message : String(error)}`,
        'ClinicGuard',
        {
          headerClinicId,
          jwtClinicId,
          userId: user.id || user.sub,
          path: request.url,
        }
      );
      throw new ForbiddenException('Clinic validation failed');
    }
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
