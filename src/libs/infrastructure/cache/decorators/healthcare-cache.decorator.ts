import { SetMetadata, applyDecorators } from '@nestjs/common';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const HEALTHCARE_CACHE_KEY = 'healthcare_cache';
export const HEALTHCARE_CACHE_INVALIDATE_KEY = 'healthcare_cache_invalidate';
export const PHI_CACHE_KEY = 'phi_cache'; // Protected Health Information

export interface HealthcareCacheOptions {
  /**
   * Cache key template with placeholders for dynamic values
   * Example: 'patient:{patientId}:records' 
   */
  keyTemplate: string;
  
  /**
   * Cache TTL in seconds
   */
  ttl?: number;
  
  /**
   * Cache tags for grouped invalidation
   */
  tags?: string[];
  
  /**
   * Whether this contains PHI (Protected Health Information)
   * PHI data has stricter caching rules
   */
  containsPHI?: boolean;
  
  /**
   * Cache priority for load balancing
   */
  priority?: 'critical' | 'high' | 'normal' | 'low';
  
  /**
   * Enable compression for large data
   */
  compress?: boolean;
  
  /**
   * Enable stale-while-revalidate pattern
   */
  enableSWR?: boolean;
  
  /**
   * Stale time in seconds (for SWR)
   */
  staleTime?: number;
  
  /**
   * Condition function to determine if caching should be applied
   */
  condition?: (context: ExecutionContext, result: any) => boolean;
  
  /**
   * Custom key generator function
   */
  keyGenerator?: (context: ExecutionContext, ...args: any[]) => string;
  
  /**
   * Clinic-specific caching (multi-tenant support)
   */
  clinicSpecific?: boolean;
  
  /**
   * Patient-specific caching
   */
  patientSpecific?: boolean;
  
  /**
   * Doctor-specific caching
   */
  doctorSpecific?: boolean;
  
  /**
   * Emergency data flag - affects caching strategy
   */
  emergencyData?: boolean;
  
  /**
   * Compliance level for healthcare data
   */
  complianceLevel?: 'standard' | 'sensitive' | 'restricted';
  
  /**
   * Auto-invalidation patterns
   */
  invalidateOn?: string[];
}

export interface CacheInvalidationOptions {
  /**
   * Patterns to invalidate
   */
  patterns: string[];
  
  /**
   * Tags to invalidate
   */
  tags?: string[];
  
  /**
   * Whether to invalidate patient-specific cache
   */
  invalidatePatient?: boolean;
  
  /**
   * Whether to invalidate doctor-specific cache
   */
  invalidateDoctor?: boolean;
  
  /**
   * Whether to invalidate clinic-specific cache
   */
  invalidateClinic?: boolean;
  
  /**
   * Custom invalidation function
   */
  customInvalidation?: (context: ExecutionContext, result: any, ...args: any[]) => Promise<void>;
  
  /**
   * Condition to determine if invalidation should occur
   */
  condition?: (context: ExecutionContext, result: any, ...args: any[]) => boolean;
}

/**
 * Healthcare-specific cache decorator with HIPAA compliance features
 */
export const HealthcareCache = (options: HealthcareCacheOptions) => {
  return applyDecorators(
    SetMetadata(HEALTHCARE_CACHE_KEY, {
      ...options,
      timestamp: Date.now(),
      type: 'healthcare'
    })
  );
};

/**
 * PHI (Protected Health Information) cache decorator with enhanced security
 */
export const PHICache = (options: Omit<HealthcareCacheOptions, 'containsPHI' | 'complianceLevel'>) => {
  return HealthcareCache({
    ...options,
    containsPHI: true,
    complianceLevel: 'sensitive',
    ttl: options.ttl || 1800, // Default 30 minutes for PHI
    priority: 'high'
  });
};

/**
 * Patient-specific cache decorator
 */
export const PatientCache = (options: Omit<HealthcareCacheOptions, 'patientSpecific'>) => {
  return HealthcareCache({
    ...options,
    patientSpecific: true,
    containsPHI: true,
    tags: [...(options.tags || []), 'patient_data']
  });
};

/**
 * Doctor-specific cache decorator
 */
export const DoctorCache = (options: Omit<HealthcareCacheOptions, 'doctorSpecific'>) => {
  return HealthcareCache({
    ...options,
    doctorSpecific: true,
    tags: [...(options.tags || []), 'doctor_data']
  });
};

/**
 * Appointment-specific cache decorator
 */
export const AppointmentCache = (options: HealthcareCacheOptions) => {
  return HealthcareCache({
    ...options,
    tags: [...(options.tags || []), 'appointment_data'],
    ttl: options.ttl || 1800, // 30 minutes default for appointments
    enableSWR: true
  });
};

/**
 * Emergency data cache decorator with minimal TTL
 */
export const EmergencyCache = (options: Omit<HealthcareCacheOptions, 'emergencyData' | 'priority'>) => {
  return HealthcareCache({
    ...options,
    emergencyData: true,
    priority: 'critical',
    ttl: options.ttl || 300, // 5 minutes for emergency data
    enableSWR: false, // No SWR for emergency data
    tags: [...(options.tags || []), 'emergency_data']
  });
};

/**
 * Medical history cache decorator with compression
 */
export const MedicalHistoryCache = (options: HealthcareCacheOptions) => {
  return HealthcareCache({
    ...options,
    compress: true, // Medical history can be large
    containsPHI: true,
    complianceLevel: 'sensitive',
    ttl: options.ttl || 7200, // 2 hours default
    tags: [...(options.tags || []), 'medical_history']
  });
};

/**
 * Prescription cache decorator
 */
export const PrescriptionCache = (options: HealthcareCacheOptions) => {
  return HealthcareCache({
    ...options,
    containsPHI: true,
    complianceLevel: 'sensitive',
    ttl: options.ttl || 1800, // 30 minutes default
    tags: [...(options.tags || []), 'prescription_data'],
    enableSWR: true
  });
};

/**
 * Lab results cache decorator
 */
export const LabResultsCache = (options: HealthcareCacheOptions) => {
  return HealthcareCache({
    ...options,
    containsPHI: true,
    complianceLevel: 'sensitive',
    compress: true, // Lab results might include images
    ttl: options.ttl || 7200, // 2 hours default
    tags: [...(options.tags || []), 'lab_results']
  });
};

/**
 * Cache invalidation decorator for healthcare operations
 */
export const InvalidateHealthcareCache = (options: CacheInvalidationOptions) => {
  return applyDecorators(
    SetMetadata(HEALTHCARE_CACHE_INVALIDATE_KEY, {
      ...options,
      timestamp: Date.now(),
      type: 'healthcare_invalidation'
    })
  );
};

/**
 * Invalidate patient cache decorator
 */
export const InvalidatePatientCache = (options: Omit<CacheInvalidationOptions, 'invalidatePatient'>) => {
  return InvalidateHealthcareCache({
    ...options,
    invalidatePatient: true,
    patterns: [...(options.patterns || []), 'patient:*']
  });
};

/**
 * Invalidate appointment cache decorator
 */
export const InvalidateAppointmentCache = (options: CacheInvalidationOptions) => {
  return InvalidateHealthcareCache({
    ...options,
    patterns: [...(options.patterns || []), 'appointment:*', '*:appointments'],
    tags: [...(options.tags || []), 'appointment_data']
  });
};

/**
 * Invalidate clinic cache decorator
 */
export const InvalidateClinicCache = (options: Omit<CacheInvalidationOptions, 'invalidateClinic'>) => {
  return InvalidateHealthcareCache({
    ...options,
    invalidateClinic: true,
    patterns: [...(options.patterns || []), 'clinic:*', '*:clinic:*']
  });
};

/**
 * Parameter decorator to extract clinic ID for caching
 */
export const ClinicId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    
    // Try to get clinic ID from various sources
    return (
      request.params?.clinicId ||
      request.body?.clinicId ||
      request.query?.clinicId ||
      request.user?.clinicId ||
      request.headers['x-clinic-id']
    );
  }
);

/**
 * Parameter decorator to extract patient ID for caching
 */
export const PatientId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    
    return (
      request.params?.patientId ||
      request.body?.patientId ||
      request.query?.patientId ||
      request.params?.id // Generic ID that might be patient ID
    );
  }
);

/**
 * Parameter decorator to extract doctor ID for caching
 */
export const DoctorId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    
    return (
      request.params?.doctorId ||
      request.body?.doctorId ||
      request.query?.doctorId ||
      (request.user?.role === 'DOCTOR' ? request.user?.id : undefined)
    );
  }
);

/**
 * Parameter decorator to extract appointment ID for caching
 */
export const AppointmentId = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    
    return (
      request.params?.appointmentId ||
      request.body?.appointmentId ||
      request.query?.appointmentId
    );
  }
);

/**
 * Combined healthcare entity IDs decorator
 */
export const HealthcareIds = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    
    return {
      clinicId: request.params?.clinicId || request.body?.clinicId || request.query?.clinicId,
      patientId: request.params?.patientId || request.body?.patientId || request.query?.patientId,
      doctorId: request.params?.doctorId || request.body?.doctorId || request.query?.doctorId,
      appointmentId: request.params?.appointmentId || request.body?.appointmentId || request.query?.appointmentId,
      userId: request.user?.id
    };
  }
);

/**
 * Cache condition helpers
 */
export const CacheConditions = {
  /**
   * Only cache successful responses (2xx status codes)
   */
  onSuccess: (context: ExecutionContext, result: any) => {
    const response = context.switchToHttp().getResponse();
    return response.statusCode >= 200 && response.statusCode < 300;
  },

  /**
   * Only cache non-empty results
   */
  nonEmpty: (context: ExecutionContext, result: any) => {
    return result !== null && result !== undefined && 
           (Array.isArray(result) ? result.length > 0 : true);
  },

  /**
   * Only cache during business hours (to prevent stale emergency data)
   */
  businessHours: (context: ExecutionContext, result: any) => {
    const now = new Date();
    const hour = now.getHours();
    return hour >= 8 && hour <= 18; // 8 AM to 6 PM
  },

  /**
   * Don't cache if user has emergency role
   */
  nonEmergencyUser: (context: ExecutionContext, result: any) => {
    const request = context.switchToHttp().getRequest();
    return request.user?.role !== 'EMERGENCY_RESPONDER';
  },

  /**
   * Combine multiple conditions with AND logic
   */
  and: (...conditions: Function[]) => {
    return (context: ExecutionContext, result: any) => {
      return conditions.every(condition => condition(context, result));
    };
  },

  /**
   * Combine multiple conditions with OR logic
   */
  or: (...conditions: Function[]) => {
    return (context: ExecutionContext, result: any) => {
      return conditions.some(condition => condition(context, result));
    };
  }
};

/**
 * Healthcare-specific key generators
 */
export const HealthcareKeyGenerators = {
  /**
   * Generate patient-specific cache key
   */
  patient: (context: ExecutionContext, ...args: any[]) => {
    const request = context.switchToHttp().getRequest();
    const patientId = request.params?.patientId || request.body?.patientId;
    const clinicId = request.params?.clinicId || request.body?.clinicId;
    const method = context.getHandler().name;
    
    return `patient:${patientId}:clinic:${clinicId}:${method}`;
  },

  /**
   * Generate doctor-specific cache key
   */
  doctor: (context: ExecutionContext, ...args: any[]) => {
    const request = context.switchToHttp().getRequest();
    const doctorId = request.params?.doctorId || request.user?.id;
    const clinicId = request.params?.clinicId || request.body?.clinicId;
    const method = context.getHandler().name;
    
    return `doctor:${doctorId}:clinic:${clinicId}:${method}`;
  },

  /**
   * Generate appointment-specific cache key
   */
  appointment: (context: ExecutionContext, ...args: any[]) => {
    const request = context.switchToHttp().getRequest();
    const appointmentId = request.params?.appointmentId || request.body?.appointmentId;
    const method = context.getHandler().name;
    
    return `appointment:${appointmentId}:${method}`;
  },

  /**
   * Generate clinic-specific cache key
   */
  clinic: (context: ExecutionContext, ...args: any[]) => {
    const request = context.switchToHttp().getRequest();
    const clinicId = request.params?.clinicId || request.body?.clinicId;
    const method = context.getHandler().name;
    
    return `clinic:${clinicId}:${method}`;
  },

  /**
   * Generate time-based cache key for daily data
   */
  daily: (context: ExecutionContext, ...args: any[]) => {
    const request = context.switchToHttp().getRequest();
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const entityId = request.params?.id || request.params?.patientId || request.params?.doctorId;
    const method = context.getHandler().name;
    
    return `daily:${date}:${entityId}:${method}`;
  }
};