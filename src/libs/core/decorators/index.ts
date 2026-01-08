/**
 * Core decorators module exports
 *
 * This module provides comprehensive decorators for the healthcare backend application:
 * - Authentication and authorization decorators
 * - Clinic-specific route decorators
 * - Role-based access control decorators
 * - Permission-based access control decorators
 * - Public route decorators
 * - Validation decorators
 * - Rate limiting decorators
 * - Caching decorators
 *
 * @module CoreDecorators
 */

// Authentication and authorization decorators
export * from './public.decorator';
export * from './roles.decorator';
export * from './permissions.decorator';

// Clinic-specific decorators
export * from './clinic.decorator';
export * from './clinic-route.decorator';

// Validation decorators
export * from './validation.decorator';
export * from './clinic-id.validator';

// Performance and security decorators
export * from './rate-limit.decorator';
// Export cache decorators but exclude ClinicId to avoid conflict with clinic.decorator
export {
  Cache,
  PHICache,
  PatientCache,
  DoctorCache,
  AppointmentCache,
  EmergencyCache,
  MedicalHistoryCache,
  PrescriptionCache,
  LabResultsCache,
  ShortCache,
  LongCache,
  UserCache,
  NoCache,
  InvalidateCache,
  InvalidatePatientCache,
  InvalidateAppointmentCache,
  InvalidateClinicCache,
  PatientId,
  DoctorId,
  AppointmentId,
  HealthcareIds,
  CacheConditions,
  HealthcareKeyGenerators,
  RedisCache,
  HealthcareCache,
  InvalidateHealthcareCache,
  // Export ClinicId from cache.decorator as CacheClinicId to avoid conflict
  ClinicId as CacheClinicId,
  // Export cache metadata keys
  CACHE_KEY,
  CACHE_INVALIDATE_KEY,
  PHI_CACHE_KEY,
} from './cache.decorator';
