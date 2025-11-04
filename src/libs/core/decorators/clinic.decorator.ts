import { SetMetadata } from '@nestjs/common';
import { createParamDecorator, ExecutionContext, BadRequestException } from '@nestjs/common';

/**
 * NestJS request interface with clinic-specific properties
 * @interface NestJSRequest
 */
interface NestJSRequest {
  /** Request headers */
  readonly headers: {
    /** Authorization header */
    readonly authorization?: string;
    /** Clinic ID header */
    readonly 'x-clinic-id'?: string;
    /** Additional headers */
    readonly [key: string]: string | undefined;
  };
  /** Request body */
  readonly body?: {
    /** Clinic ID in body */
    readonly clinicId?: string;
    /** Additional body properties */
    readonly [key: string]: unknown;
  };
  /** Query parameters */
  readonly query?: {
    /** Clinic ID in query */
    readonly clinicId?: string;
    /** Additional query parameters */
    readonly [key: string]: string | string[] | undefined;
  };
}

/**
 * JWT payload interface with clinic information
 * @interface JWTPayload
 */
interface JWTPayload {
  /** Clinic ID from JWT */
  readonly clinicId?: string;
  /** Additional JWT payload properties */
  readonly [key: string]: unknown;
}

/**
 * Clinic decorator metadata key
 */
export const CLINIC_KEY = 'clinic' as const;

/**
 * Clinic decorator for marking routes that require clinic context
 *
 * This decorator marks a route handler as requiring clinic context.
 * It should be used in conjunction with clinic guards to ensure
 * proper clinic-based access control.
 *
 * @returns Decorator function that sets clinic metadata
 *
 * @example
 * ```typescript
 * @Controller('appointments')
 * @Clinic()
 * export class AppointmentsController {
 *   @Get()
 *   async getAppointments(@ClinicId() clinicId: string) {
 *     // clinicId is automatically extracted from request
 *   }
 * }
 * ```
 */
export const Clinic = (): MethodDecorator & ClassDecorator => SetMetadata(CLINIC_KEY, true);

/**
 * Clinic ID parameter decorator
 *
 * Extracts clinic ID from various sources in the request with the following priority:
 * 1. JWT token payload (from Authorization header)
 * 2. X-Clinic-ID header
 * 3. Request body clinicId field
 * 4. Query parameter clinicId
 *
 * @param data - Optional decorator data (unused)
 * @param ctx - Execution context
 * @returns Clinic ID string
 * @throws BadRequestException if clinic ID is not found in any source
 *
 * @example
 * ```typescript
 * @Get('appointments')
 * async getAppointments(@ClinicId() clinicId: string) {
 *   // clinicId is automatically extracted from request
 *   return this.appointmentsService.findByClinic(clinicId);
 * }
 * ```
 */
export const ClinicId = createParamDecorator((data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<NestJSRequest>();

  // Priority 1: Check Authorization header for clinic context
  const authHeader = request.headers?.authorization;
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.substring(7);
      const tokenParts = token.split('.');
      if (tokenParts.length === 3) {
        const payload = JSON.parse(
          Buffer.from(tokenParts[1] as string, 'base64').toString()
        ) as JWTPayload;
        if (payload.clinicId && typeof payload.clinicId === 'string') {
          return payload.clinicId;
        }
      }
    } catch {
      // Continue to other methods if JWT parsing fails
    }
  }

  // Priority 2: Check X-Clinic-ID header
  const clinicIdHeader = request.headers?.['x-clinic-id'];
  if (clinicIdHeader && typeof clinicIdHeader === 'string') {
    return clinicIdHeader;
  }

  // Priority 3: Check request body
  const clinicIdBody = request.body?.clinicId;
  if (clinicIdBody && typeof clinicIdBody === 'string') {
    return clinicIdBody;
  }

  // Priority 4: Check query parameters
  const clinicIdQuery = request.query?.clinicId;
  if (clinicIdQuery && typeof clinicIdQuery === 'string') {
    return clinicIdQuery;
  }

  throw new BadRequestException(
    'Clinic ID is required. Provide it via X-Clinic-ID header, request body, or query parameter.'
  );
});

/**
 * Optional clinic ID parameter decorator
 *
 * Extracts clinic ID from various sources in the request with the same priority
 * as ClinicId, but returns undefined instead of throwing an exception if not found.
 *
 * @param data - Optional decorator data (unused)
 * @param ctx - Execution context
 * @returns Clinic ID string or undefined if not found
 *
 * @example
 * ```typescript
 * @Get('appointments')
 * async getAppointments(@OptionalClinicId() clinicId?: string) {
 *   if (clinicId) {
 *     return this.appointmentsService.findByClinic(clinicId);
 *   }
 *   return this.appointmentsService.findAll();
 * }
 * ```
 */
export const OptionalClinicId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<NestJSRequest>();

    // Priority 1: Check Authorization header for clinic context
    const authHeader = request.headers?.authorization;
    if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const tokenParts = token.split('.');
        if (tokenParts.length === 3) {
          const payload = JSON.parse(
            Buffer.from(tokenParts[1] as string, 'base64').toString()
          ) as JWTPayload;
          if (payload.clinicId && typeof payload.clinicId === 'string') {
            return payload.clinicId;
          }
        }
      } catch {
        // Continue to other methods if JWT parsing fails
      }
    }

    // Priority 2: Check X-Clinic-ID header
    const clinicIdHeader = request.headers?.['x-clinic-id'];
    if (clinicIdHeader && typeof clinicIdHeader === 'string') {
      return clinicIdHeader;
    }

    // Priority 3: Check request body
    const clinicIdBody = request.body?.clinicId;
    if (clinicIdBody && typeof clinicIdBody === 'string') {
      return clinicIdBody;
    }

    // Priority 4: Check query parameters
    const clinicIdQuery = request.query?.clinicId;
    if (clinicIdQuery && typeof clinicIdQuery === 'string') {
      return clinicIdQuery;
    }

    return undefined;
  }
);
