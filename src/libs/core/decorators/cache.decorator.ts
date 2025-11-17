/**
 * Unified Cache Decorators for Enterprise Healthcare Applications
 *
 * This module provides comprehensive decorators for implementing caching strategies
 * on route handlers to improve performance and reduce database load.
 * Combines Redis caching with healthcare-specific features:
 * - SWR (Stale-While-Revalidate) support
 * - HIPAA compliance and PHI protection
 * - Healthcare-specific cache patterns
 * - Performance optimization for 10M+ users
 *
 * @module CacheDecorators
 */

// External imports
import {
  SetMetadata,
  applyDecorators,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';

// Internal imports - Types
import type {
  UnifiedCacheOptions,
  CacheInvalidationOptions,
  CustomFastifyRequest,
} from '@core/types';

/**
 * Cache metadata keys
 */
export const CACHE_KEY = 'cache' as const;
export const CACHE_INVALIDATE_KEY = 'cache_invalidate' as const;
export const PHI_CACHE_KEY = 'phi_cache' as const; // Protected Health Information

/**
 * Legacy cache options interface (for backward compatibility)
 * @deprecated Use UnifiedCacheOptions instead
 */
export interface CacheOptions {
  /** Cache TTL in seconds */
  readonly ttl?: number;
  /** Custom cache key */
  readonly key?: string;
  /** Whether to cache the response */
  readonly enabled?: boolean;
  /** Cache invalidation tags */
  readonly tags?: readonly string[];
  /** Custom key generator function */
  readonly keyGenerator?: (req: unknown) => string;
  /** Whether to skip caching for certain conditions */
  readonly skipIf?: (req: unknown, res: unknown) => boolean;
  /** Cache version for invalidation */
  readonly version?: string;
}

/**
 * Unified cache decorator with healthcare and enterprise features
 *
 * @param options - Unified cache options
 * @returns Decorator function that sets cache metadata
 *
 * @example
 * ```typescript
 * @Controller('appointments')
 * export class AppointmentsController {
 *   @Get()
 *   @Cache({ ttl: 300 }) // Cache for 5 minutes
 *   async getAppointments() {
 *     return this.appointmentsService.findAll();
 *   }
 *
 *   @Get(':id')
 *   @Cache({ ttl: 600, key: 'appointment' }) // Cache for 10 minutes with custom key
 *   async getAppointment(@Param('id') id: string) {
 *     return this.appointmentsService.findOne(id);
 *   }
 * }
 * ```
 */
export const Cache = (options: UnifiedCacheOptions | CacheOptions = {}) => {
  return applyDecorators(
    SetMetadata(CACHE_KEY, {
      ...options,
      timestamp: Date.now(),
      type: 'unified_cache',
    })
  );
};

/**
 * PHI (Protected Health Information) cache decorator with enhanced security
 *
 * @param options - Cache options (containsPHI and complianceLevel are automatically set)
 * @returns Decorator function that sets PHI cache metadata
 *
 * @example
 * ```typescript
 * @Controller('patients')
 * export class PatientsController {
 *   @Get(':id/records')
 *   @PHICache({ ttl: 1800 }) // PHI cache for 30 minutes
 *   async getPatientRecords(@Param('id') id: string) {
 *     return this.patientsService.getRecords(id);
 *   }
 * }
 * ```
 */
export const PHICache = (options: Omit<UnifiedCacheOptions, 'containsPHI' | 'complianceLevel'>) => {
  return Cache({
    ...options,
    containsPHI: true,
    complianceLevel: 'sensitive',
    ttl: options.ttl || 1800, // Default 30 minutes for PHI
    priority: 'high',
  });
};

/**
 * Patient-specific cache decorator
 *
 * @param options - Cache options (patientSpecific and containsPHI are automatically set)
 * @returns Decorator function that sets patient-specific cache metadata
 */
export const PatientCache = (options: Omit<UnifiedCacheOptions, 'patientSpecific'>) => {
  return Cache({
    ...options,
    patientSpecific: true,
    containsPHI: true,
    tags: [...(options.tags ?? []), 'patient_data'],
  });
};

/**
 * Doctor-specific cache decorator
 *
 * @param options - Cache options (doctorSpecific is automatically set)
 * @returns Decorator function that sets doctor-specific cache metadata
 */
export const DoctorCache = (options: Omit<UnifiedCacheOptions, 'doctorSpecific'>) => {
  return Cache({
    ...options,
    doctorSpecific: true,
    tags: [...(options.tags ?? []), 'doctor_data'],
  });
};

/**
 * Appointment-specific cache decorator
 *
 * @param options - Cache options
 * @returns Decorator function that sets appointment-specific cache metadata
 */
export const AppointmentCache = (options: UnifiedCacheOptions) => {
  return Cache({
    ...options,
    tags: [...(options.tags ?? []), 'appointment_data'],
    ttl: options.ttl ?? 1800, // 30 minutes default for appointments
    enableSWR: true,
  });
};

/**
 * Emergency data cache decorator with minimal TTL
 *
 * @param options - Cache options (emergencyData and priority are automatically set)
 * @returns Decorator function that sets emergency cache metadata
 */
export const EmergencyCache = (
  options: Omit<UnifiedCacheOptions, 'emergencyData' | 'priority'>
) => {
  return Cache({
    ...options,
    emergencyData: true,
    priority: 'critical',
    ttl: options.ttl ?? 300, // 5 minutes for emergency data
    enableSWR: false, // No SWR for emergency data
    tags: [...(options.tags ?? []), 'emergency_data'],
  });
};

/**
 * Medical history cache decorator with compression
 *
 * @param options - Cache options
 * @returns Decorator function that sets medical history cache metadata
 */
export const MedicalHistoryCache = (options: UnifiedCacheOptions) => {
  return Cache({
    ...options,
    compress: true, // Medical history can be large
    containsPHI: true,
    complianceLevel: 'sensitive',
    ttl: options.ttl ?? 7200, // 2 hours default
    tags: [...(options.tags ?? []), 'medical_history'],
  });
};

/**
 * Prescription cache decorator
 *
 * @param options - Cache options
 * @returns Decorator function that sets prescription cache metadata
 */
export const PrescriptionCache = (options: UnifiedCacheOptions) => {
  return Cache({
    ...options,
    containsPHI: true,
    complianceLevel: 'sensitive',
    ttl: options.ttl ?? 1800, // 30 minutes default
    tags: [...(options.tags ?? []), 'prescription_data'],
    enableSWR: true,
  });
};

/**
 * Lab results cache decorator
 *
 * @param options - Cache options
 * @returns Decorator function that sets lab results cache metadata
 */
export const LabResultsCache = (options: UnifiedCacheOptions) => {
  return Cache({
    ...options,
    containsPHI: true,
    complianceLevel: 'sensitive',
    compress: true, // Lab results might include images
    ttl: options.ttl ?? 7200, // 2 hours default
    tags: [...(options.tags ?? []), 'lab_results'],
  });
};

/**
 * Short cache decorator for frequently accessed data
 *
 * This decorator applies short-term caching suitable for
 * frequently accessed data that changes moderately.
 *
 * @param ttl - Cache TTL in seconds (default: 60)
 * @returns Decorator function that sets short cache metadata
 *
 * @example
 * ```typescript
 * @Controller('users')
 * export class UsersController {
 *   @Get('profile')
 *   @ShortCache() // Cache for 1 minute
 *   async getProfile(@Req() req: Request) {
 *     return this.usersService.getProfile(req.user.id);
 *   }
 * }
 * ```
 */
export const ShortCache = (ttl: number = 60): MethodDecorator =>
  SetMetadata(CACHE_KEY, {
    enabled: true,
    ttl,
    tags: ['short-cache'],
  });

/**
 * Long cache decorator for stable data
 *
 * This decorator applies long-term caching suitable for
 * stable data that doesn't change frequently.
 *
 * @param ttl - Cache TTL in seconds (default: 3600)
 * @returns Decorator function that sets long cache metadata
 *
 * @example
 * ```typescript
 * @Controller('settings')
 * export class SettingsController {
 *   @Get('config')
 *   @LongCache() // Cache for 1 hour
 *   async getConfig() {
 *     return this.settingsService.getConfig();
 *   }
 * }
 * ```
 */
export const LongCache = (ttl: number = 3600): MethodDecorator =>
  SetMetadata(CACHE_KEY, {
    enabled: true,
    ttl,
    tags: ['long-cache'],
  });

/**
 * User-specific cache decorator
 *
 * This decorator applies user-specific caching, useful for
 * personalized data that should be cached per user.
 *
 * @param ttl - Cache TTL in seconds (default: 300)
 * @returns Decorator function that sets user-specific cache metadata
 *
 * @example
 * ```typescript
 * @Controller('dashboard')
 * export class DashboardController {
 *   @Get('stats')
 *   @UserCache() // User-specific cache for 5 minutes
 *   async getStats(@Req() req: Request) {
 *     return this.dashboardService.getUserStats(req.user.id);
 *   }
 * }
 * ```
 */
export const UserCache = (ttl: number = 300): MethodDecorator =>
  SetMetadata(CACHE_KEY, {
    enabled: true,
    ttl,
    keyGenerator: (req: unknown) => {
      const request = req as { user?: { id?: string } };
      return `user:${request.user?.id || 'anonymous'}`;
    },
    tags: ['user-cache'],
  });

/**
 * No cache decorator to disable caching
 *
 * This decorator explicitly disables caching for a route handler,
 * useful for dynamic or sensitive data that should never be cached.
 *
 * @returns Decorator function that disables cache metadata
 *
 * @example
 * ```typescript
 * @Controller('auth')
 * export class AuthController {
 *   @Post('login')
 *   @NoCache() // Never cache login responses
 *   async login(@Body() loginDto: LoginDto) {
 *     return this.authService.login(loginDto);
 *   }
 * }
 * ```
 */
export const NoCache = (): MethodDecorator =>
  SetMetadata(CACHE_KEY, {
    enabled: false,
  });

/**
 * Cache invalidation decorator for healthcare operations
 *
 * @param options - Cache invalidation options
 * @returns Decorator function that sets cache invalidation metadata
 */
export const InvalidateCache = (options: CacheInvalidationOptions) => {
  return applyDecorators(
    SetMetadata(CACHE_INVALIDATE_KEY, {
      ...options,
      timestamp: Date.now(),
      type: 'cache_invalidation',
    })
  );
};

/**
 * Invalidate patient cache decorator
 *
 * @param options - Cache invalidation options (invalidatePatient is automatically set)
 * @returns Decorator function that sets patient cache invalidation metadata
 */
export const InvalidatePatientCache = (
  options: Omit<CacheInvalidationOptions, 'invalidatePatient'>
) => {
  return InvalidateCache({
    ...options,
    invalidatePatient: true,
    patterns: [...options.patterns, 'patient:*'],
  });
};

/**
 * Invalidate appointment cache decorator
 *
 * @param options - Cache invalidation options
 * @returns Decorator function that sets appointment cache invalidation metadata
 */
export const InvalidateAppointmentCache = (options: CacheInvalidationOptions) => {
  return InvalidateCache({
    ...options,
    patterns: [...options.patterns, 'appointment:*', '*:appointments'],
    tags: options.tags ? [...options.tags, 'appointment_data'] : ['appointment_data'],
  });
};

/**
 * Invalidate clinic cache decorator
 *
 * @param options - Cache invalidation options (invalidateClinic is automatically set)
 * @returns Decorator function that sets clinic cache invalidation metadata
 */
export const InvalidateClinicCache = (
  options: Omit<CacheInvalidationOptions, 'invalidateClinic'>
) => {
  return InvalidateCache({
    ...options,
    invalidateClinic: true,
    patterns: [...options.patterns, 'clinic:*', '*:clinic:*'],
  });
};

/**
 * Parameter decorator to extract clinic ID for caching
 *
 * @returns Clinic ID from request params, body, query, user, or headers
 */
export const ClinicId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<CustomFastifyRequest>();

    // Try to get clinic ID from various sources with proper type checking
    const params = request.params;
    const body = request.body as Record<string, unknown> | undefined;
    const query = request.query;
    const user = request.user;
    const headers = request.headers;

    return (
      (params && typeof params === 'object' && 'clinicId' in params
        ? String(params['clinicId'])
        : undefined) ||
      (body && typeof body === 'object' && 'clinicId' in body
        ? String(body['clinicId'])
        : undefined) ||
      (query && typeof query === 'object' && 'clinicId' in query
        ? String(query['clinicId'])
        : undefined) ||
      (user && 'clinicId' in user ? String(user['clinicId']) : undefined) ||
      (headers && 'x-clinic-id' in headers && typeof headers['x-clinic-id'] === 'string'
        ? headers['x-clinic-id']
        : undefined)
    );
  }
);

/**
 * Parameter decorator to extract patient ID for caching
 *
 * @returns Patient ID from request params, body, or query
 */
export const PatientId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<CustomFastifyRequest>();

    const params = request.params;
    const body = request.body as Record<string, unknown> | undefined;
    const query = request.query;

    return (
      (params && typeof params === 'object' && 'patientId' in params
        ? String(params['patientId'])
        : undefined) ||
      (body && typeof body === 'object' && 'patientId' in body
        ? String(body['patientId'])
        : undefined) ||
      (query && typeof query === 'object' && 'patientId' in query
        ? String(query['patientId'])
        : undefined) ||
      (params && typeof params === 'object' && 'id' in params ? String(params['id']) : undefined)
    );
  }
);

/**
 * Parameter decorator to extract doctor ID for caching
 *
 * @returns Doctor ID from request params, body, query, or user
 */
export const DoctorId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<CustomFastifyRequest>();

    const params = request.params;
    const body = request.body as Record<string, unknown> | undefined;
    const query = request.query;
    const user = request.user;

    return (
      (params && typeof params === 'object' && 'doctorId' in params
        ? String(params['doctorId'])
        : undefined) ||
      (body && typeof body === 'object' && 'doctorId' in body
        ? String(body['doctorId'])
        : undefined) ||
      (query && typeof query === 'object' && 'doctorId' in query
        ? String(query['doctorId'])
        : undefined) ||
      (user && user.role === 'DOCTOR' && 'id' in user ? String(user['id']) : undefined)
    );
  }
);

/**
 * Parameter decorator to extract appointment ID for caching
 *
 * @returns Appointment ID from request params, body, or query
 */
export const AppointmentId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<CustomFastifyRequest>();

    const params = request.params;
    const body = request.body as Record<string, unknown> | undefined;
    const query = request.query;

    return (
      (params && typeof params === 'object' && 'appointmentId' in params
        ? String(params['appointmentId'])
        : undefined) ||
      (body && typeof body === 'object' && 'appointmentId' in body
        ? String(body['appointmentId'])
        : undefined) ||
      (query && typeof query === 'object' && 'appointmentId' in query
        ? String(query['appointmentId'])
        : undefined)
    );
  }
);

/**
 * Combined healthcare entity IDs decorator
 *
 * @returns Object containing clinicId, patientId, doctorId, appointmentId, and userId
 */
export const HealthcareIds = createParamDecorator(
  (
    _data: unknown,
    ctx: ExecutionContext
  ): {
    clinicId?: string;
    patientId?: string;
    doctorId?: string;
    appointmentId?: string;
    userId?: string;
  } => {
    const request = ctx.switchToHttp().getRequest<CustomFastifyRequest>();

    const params = request.params;
    const body = request.body as Record<string, unknown> | undefined;
    const query = request.query;
    const user = request.user;

    const extractId = (
      source: Record<string, unknown> | undefined,
      key: string
    ): string | undefined => {
      return source && typeof source === 'object' && key in source
        ? String(source[key])
        : undefined;
    };

    const clinicId =
      extractId(params, 'clinicId') || extractId(body, 'clinicId') || extractId(query, 'clinicId');
    const patientId =
      extractId(params, 'patientId') ||
      extractId(body, 'patientId') ||
      extractId(query, 'patientId');
    const doctorId =
      extractId(params, 'doctorId') || extractId(body, 'doctorId') || extractId(query, 'doctorId');
    const appointmentId =
      extractId(params, 'appointmentId') ||
      extractId(body, 'appointmentId') ||
      extractId(query, 'appointmentId');
    const userId = user && 'id' in user ? String(user['id']) : undefined;

    const result: {
      clinicId?: string;
      patientId?: string;
      doctorId?: string;
      appointmentId?: string;
      userId?: string;
    } = {};

    if (clinicId !== undefined) result.clinicId = clinicId;
    if (patientId !== undefined) result.patientId = patientId;
    if (doctorId !== undefined) result.doctorId = doctorId;
    if (appointmentId !== undefined) result.appointmentId = appointmentId;
    if (userId !== undefined) result.userId = userId;

    return result;
  }
);

/**
 * Cache condition helpers
 */
export const CacheConditions = {
  /**
   * Only cache successful responses (2xx status codes)
   */
  onSuccess: (context: ExecutionContext, _result: unknown) => {
    const response = context.switchToHttp().getResponse<{ statusCode?: number }>();
    const statusCode = response.statusCode ?? 200;
    return statusCode >= 200 && statusCode < 300;
  },

  /**
   * Only cache non-empty results
   */
  nonEmpty: (_context: ExecutionContext, result: unknown) => {
    return (
      result !== null && result !== undefined && (Array.isArray(result) ? result.length > 0 : true)
    );
  },

  /**
   * Only cache during business hours (to prevent stale emergency data)
   */
  businessHours: (_context: ExecutionContext, _result: unknown) => {
    const now = new Date();
    const hour = now.getHours();
    return hour >= 8 && hour <= 18; // 8 AM to 6 PM
  },

  /**
   * Don't cache if user has emergency role
   */
  nonEmergencyUser: (context: ExecutionContext, _result: unknown): boolean => {
    const request = context.switchToHttp().getRequest<CustomFastifyRequest>();
    return request.user?.role !== 'EMERGENCY_RESPONDER';
  },

  /**
   * Combine multiple conditions with AND logic
   */
  and: (...conditions: ((context: ExecutionContext, result: unknown) => boolean)[]) => {
    return (context: ExecutionContext, result: unknown) => {
      return conditions.every(condition => condition(context, result));
    };
  },

  /**
   * Combine multiple conditions with OR logic
   */
  or: (...conditions: ((context: ExecutionContext, result: unknown) => boolean)[]) => {
    return (context: ExecutionContext, result: unknown) => {
      return conditions.some(condition => condition(context, result));
    };
  },
};

/**
 * Healthcare-specific key generators
 */
export const HealthcareKeyGenerators = {
  /**
   * Generate patient-specific cache key
   */
  patient: (context: ExecutionContext, ..._args: unknown[]): string => {
    const request = context.switchToHttp().getRequest<CustomFastifyRequest>();
    const params = request.params;
    const body = request.body as Record<string, unknown> | undefined;
    const patientId =
      (params && typeof params === 'object' && 'patientId' in params
        ? String(params['patientId'])
        : undefined) ||
      (body && typeof body === 'object' && 'patientId' in body
        ? String(body['patientId'])
        : undefined) ||
      'unknown';
    const clinicId =
      (params && typeof params === 'object' && 'clinicId' in params
        ? String(params['clinicId'])
        : undefined) ||
      (body && typeof body === 'object' && 'clinicId' in body
        ? String(body['clinicId'])
        : undefined) ||
      'unknown';
    const method = context.getHandler().name;

    return `patient:${patientId}:clinic:${clinicId}:${method}`;
  },

  /**
   * Generate doctor-specific cache key
   */
  doctor: (context: ExecutionContext, ..._args: unknown[]): string => {
    const request = context.switchToHttp().getRequest<CustomFastifyRequest>();
    const params = request.params;
    const body = request.body as Record<string, unknown> | undefined;
    const user = request.user;
    const doctorId =
      (params && typeof params === 'object' && 'doctorId' in params
        ? String(params['doctorId'])
        : undefined) ||
      (user && 'id' in user ? String(user['id']) : undefined) ||
      'unknown';
    const clinicId =
      (params && typeof params === 'object' && 'clinicId' in params
        ? String(params['clinicId'])
        : undefined) ||
      (body && typeof body === 'object' && 'clinicId' in body
        ? String(body['clinicId'])
        : undefined) ||
      'unknown';
    const method = context.getHandler().name;

    return `doctor:${doctorId}:clinic:${clinicId}:${method}`;
  },

  /**
   * Generate appointment-specific cache key
   */
  appointment: (context: ExecutionContext, ..._args: unknown[]): string => {
    const request = context.switchToHttp().getRequest<CustomFastifyRequest>();
    const params = request.params;
    const body = request.body as Record<string, unknown> | undefined;
    const appointmentId =
      (params && typeof params === 'object' && 'appointmentId' in params
        ? String(params['appointmentId'])
        : undefined) ||
      (body && typeof body === 'object' && 'appointmentId' in body
        ? String(body['appointmentId'])
        : undefined) ||
      'unknown';
    const method = context.getHandler().name;

    return `appointment:${appointmentId}:${method}`;
  },

  /**
   * Generate clinic-specific cache key
   */
  clinic: (context: ExecutionContext, ..._args: unknown[]): string => {
    const request = context.switchToHttp().getRequest<CustomFastifyRequest>();
    const params = request.params;
    const body = request.body as Record<string, unknown> | undefined;
    const clinicId =
      (params && typeof params === 'object' && 'clinicId' in params
        ? String(params['clinicId'])
        : undefined) ||
      (body && typeof body === 'object' && 'clinicId' in body
        ? String(body['clinicId'])
        : undefined) ||
      'unknown';
    const method = context.getHandler().name;

    return `clinic:${clinicId}:${method}`;
  },

  /**
   * Generate time-based cache key for daily data
   */
  daily: (context: ExecutionContext, ..._args: unknown[]): string => {
    const request = context.switchToHttp().getRequest<CustomFastifyRequest>();
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const params = request.params;
    const entityId =
      (params && typeof params === 'object' && 'id' in params ? String(params['id']) : undefined) ||
      (params && typeof params === 'object' && 'patientId' in params
        ? String(params['patientId'])
        : undefined) ||
      (params && typeof params === 'object' && 'doctorId' in params
        ? String(params['doctorId'])
        : undefined) ||
      'unknown';
    const method = context.getHandler().name;

    return `daily:${date}:${entityId}:${method}`;
  },
};

// Legacy exports for backward compatibility
export const RedisCache = Cache;
export const HealthcareCache = Cache;
export const InvalidateHealthcareCache = InvalidateCache;
