/**
 * Appointment Type Guards and Utilities
 * @module @core/types/appointment-guards.types
 * @description Type guards and utilities for strict TypeScript enum comparisons
 *
 * Enterprise-level type guards that provide:
 * - Runtime validation at boundaries (database/API)
 * - Compile-time type narrowing for business logic
 * - Zero runtime overhead in type-narrowed code paths
 */

import { AppointmentType } from './enums.types';
import type { AppointmentBase } from './database.types';
import type {
  VideoCallAppointment,
  InPersonAppointment,
  HomeVisitAppointment,
  TypedAppointment,
} from './appointment.types';

/**
 * Type-safe appointment type value
 * Ensures the value is one of the valid AppointmentType enum values
 */
export type AppointmentTypeValue = AppointmentType;

/**
 * Type guard to check if a value is a valid AppointmentType
 * @param value - The value to check
 * @returns True if value is a valid AppointmentType
 */
export function isAppointmentType(value: unknown): value is AppointmentType {
  return (
    typeof value === 'string' && Object.values(AppointmentType).includes(value as AppointmentType)
  );
}

/**
 * Type guard to check if appointment type is VIDEO_CALL
 * @param type - The appointment type to check
 * @returns True if type is VIDEO_CALL
 */
export function isVideoCallAppointmentType(type: unknown): type is AppointmentType.VIDEO_CALL {
  return isAppointmentType(type) && type === AppointmentType.VIDEO_CALL;
}

/**
 * Type guard to check if appointment type is IN_PERSON
 * @param type - The appointment type to check
 * @returns True if type is IN_PERSON
 */
export function isInPersonAppointmentType(type: unknown): type is AppointmentType.IN_PERSON {
  return isAppointmentType(type) && type === AppointmentType.IN_PERSON;
}

/**
 * Type guard to check if appointment type is HOME_VISIT
 * @param type - The appointment type to check
 * @returns True if type is HOME_VISIT
 */
export function isHomeVisitAppointmentType(type: unknown): type is AppointmentType.HOME_VISIT {
  return isAppointmentType(type) && type === AppointmentType.HOME_VISIT;
}

/**
 * ============================================================================
 * ENTERPRISE-LEVEL TYPE GUARDS FOR FULL APPOINTMENT OBJECTS
 * ============================================================================
 * These guards validate and narrow full appointment objects, ensuring
 * type safety throughout the application.
 */

/**
 * ============================================================================
 * ENTERPRISE-LEVEL TYPE GUARDS FOR FULL APPOINTMENT OBJECTS
 * ============================================================================
 * These guards validate and narrow full appointment objects, ensuring
 * type safety throughout the application.
 */

/**
 * Type guard that narrows AppointmentBase to VideoCallAppointment
 * @param appointment - The appointment to check (can be AppointmentBase, VideoCallAppointment, or any object with type property)
 * @returns True if appointment is a VIDEO_CALL appointment
 *
 * @example
 * ```typescript
 * if (isVideoCallAppointment(appointment)) {
 *   // TypeScript knows appointment is VideoCallAppointment
 *   // appointment.locationId is string | null
 * }
 * ```
 */
export function isVideoCallAppointment(
  appointment: AppointmentBase | VideoCallAppointment | { type: string }
): appointment is VideoCallAppointment {
  // Use type guard to ensure type safety before enum comparison
  return isAppointmentType(appointment.type) && appointment.type === AppointmentType.VIDEO_CALL;
}

/**
 * Type guard that narrows AppointmentBase to InPersonAppointment
 * Validates that locationId exists (required for IN_PERSON)
 * @param appointment - The appointment to check (can be AppointmentBase, InPersonAppointment, or any object with type and locationId properties)
 * @returns True if appointment is an IN_PERSON appointment with locationId
 *
 * @example
 * ```typescript
 * if (isInPersonAppointment(appointment)) {
 *   // TypeScript knows appointment is InPersonAppointment
 *   // appointment.locationId is string (guaranteed non-null)
 * }
 * ```
 */
export function isInPersonAppointment(
  appointment: AppointmentBase | InPersonAppointment | { type: string; locationId?: string | null }
): appointment is InPersonAppointment {
  // Use type guard to ensure type safety before enum comparison
  return (
    isAppointmentType(appointment.type) &&
    appointment.type === AppointmentType.IN_PERSON &&
    appointment.locationId !== null &&
    appointment.locationId !== undefined &&
    appointment.locationId !== ''
  );
}

/**
 * Type guard that narrows AppointmentBase to HomeVisitAppointment
 * @param appointment - The appointment to check (can be AppointmentBase, HomeVisitAppointment, or any object with type property)
 * @returns True if appointment is a HOME_VISIT appointment
 *
 * @example
 * ```typescript
 * if (isHomeVisitAppointment(appointment)) {
 *   // TypeScript knows appointment is HomeVisitAppointment
 * }
 * ```
 */
export function isHomeVisitAppointment(
  appointment: AppointmentBase | HomeVisitAppointment | { type: string }
): appointment is HomeVisitAppointment {
  // Use type guard to ensure type safety before enum comparison
  return isAppointmentType(appointment.type) && appointment.type === AppointmentType.HOME_VISIT;
}

/**
 * Type guard that validates and narrows to TypedAppointment
 * @param appointment - The appointment to validate
 * @returns True if appointment is a valid typed appointment
 */
export function isTypedAppointment(
  appointment: AppointmentBase | TypedAppointment
): appointment is TypedAppointment {
  // Use type guard to ensure type safety before enum comparison
  if (!isAppointmentType(appointment.type)) {
    return false;
  }
  // Now TypeScript knows appointment.type is AppointmentType, safe to compare
  if (appointment.type === AppointmentType.VIDEO_CALL) {
    return isVideoCallAppointment(appointment);
  }
  if (appointment.type === AppointmentType.IN_PERSON) {
    return isInPersonAppointment(appointment);
  }
  if (appointment.type === AppointmentType.HOME_VISIT) {
    return isHomeVisitAppointment(appointment);
  }
  return false;
}

/**
 * Normalize appointment type to ensure it's a valid enum value
 * @param type - The type value to normalize
 * @returns Normalized AppointmentType or null if invalid
 */
export function normalizeAppointmentType(type: unknown): AppointmentType | null {
  if (isAppointmentType(type)) {
    return type;
  }
  return null;
}

/**
 * Strict comparison function for AppointmentType
 * Ensures both values are valid enum values before comparison
 * @param a - First value to compare
 * @param b - Second value to compare
 * @returns True if both are valid enum values and equal
 */
export function compareAppointmentType(a: unknown, b: AppointmentType): boolean {
  const normalizedA = normalizeAppointmentType(a);
  return normalizedA !== null && normalizedA === b;
}

/**
 * Helper to safely extract AppointmentType from an object
 * @param obj - Object that may contain a type property
 * @param key - Key to extract (default: 'type')
 * @returns AppointmentType or null if invalid
 */
export function extractAppointmentType(
  obj: { [key: string]: unknown },
  key = 'type'
): AppointmentType | null {
  return normalizeAppointmentType(obj[key]);
}
