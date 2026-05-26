import { HttpStatus } from '@nestjs/common';

// Internal imports - Core
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';

// Internal imports - Infrastructure (using path alias @infrastructure/database)
import { DatabaseService } from '@infrastructure/database';

/**
 * Clinic Utility Functions
 *
 * Provides utility functions for clinic-related operations including
 * UUID resolution and validation for healthcare applications.
 *
 * @fileoverview Clinic utility functions for healthcare applications
 * @description Utility functions for clinic identification and validation
 * @version 1.0.0
 * @author Healthcare Backend Team
 * @since 2024
 */

/**
 * Interface for clinic data returned from database queries
 */
interface ClinicData {
  id: string;
  clinicId: string;
  name: string;
  isActive: boolean;
}

/**
 * Helper function to safely query clinic by ID using DatabaseService
 * Uses DatabaseService for proper connection pooling, caching, and query optimization
 */
async function findClinicById(
  databaseService: DatabaseService,
  where: { clinicId: string } | { id: string }
): Promise<ClinicData | null> {
  // Use DatabaseService for proper connection pooling, caching, and optimization
  return (await databaseService.executeHealthcareRead(async client => {
    const clinic = client['clinic'] as {
      findFirst: (args: {
        where: Record<string, unknown>;
        select: Record<string, boolean>;
      }) => Promise<ClinicData | null>;
    };

    // Case-insensitive lookup for clinicId (handles CL0002, cl0002, CLINIC001, etc.)
    if ('clinicId' in where) {
      const searchTerm = where.clinicId;
      return (await clinic.findFirst({
        where: {
          OR: [
            { clinicId: searchTerm },
            { clinicId: searchTerm.toLowerCase() },
            { clinicId: searchTerm.toUpperCase() },
          ],
        },
        select: { id: true, clinicId: true, name: true, isActive: true },
      })) as unknown as ClinicData | null;
    }

    // UUID lookup (case-insensitive by nature)
    return (await clinic.findFirst({
      where: { id: where.id },
      select: { id: true, clinicId: true, name: true, isActive: true },
    })) as unknown as ClinicData | null;
  })) as unknown as ClinicData | null;
}

/**
 * Utility to resolve a clinic identifier (UUID or code) to the UUID
 *
 * @param databaseService - DatabaseService instance (from @infrastructure/database)
 * @param clinicIdOrUUID - Clinic identifier (either clinicId code like "CL0002" or UUID)
 * @returns Promise resolving to the clinic's UUID
 *
 * @description Resolves a clinic identifier to its UUID by trying multiple lookup strategies:
 * 1. If valid UUID format: look up by UUID first
 * 2. Look up by clinicId field (e.g., "CL0002") with case-insensitive search
 * 3. If still not found and it's a UUID-like string, throw not found
 * Validates that the clinic is active before returning.
 * Uses DatabaseService for proper connection pooling, caching, and query optimization.
 *
 * @example
 * ```typescript
 * // In a service constructor:
 * constructor(private readonly databaseService: DatabaseService) {}
 *
 * // Usage:
 * const clinicUUID = await resolveClinicUUID(this.databaseService, 'cl0002');
 * // Returns: 'uuid-of-clinic' (looks up by clinicId field)
 *
 * const clinicUUID2 = await resolveClinicUUID(this.databaseService, 'existing-uuid');
 * // Returns: 'existing-uuid' if clinic exists and is active
 * ```
 *
 * @throws {HealthcareError} When clinic ID is not provided, clinic is not found, or clinic is inactive
 */
export async function resolveClinicUUID(
  databaseService: DatabaseService,
  clinicIdOrUUID: string
): Promise<string> {
  if (!clinicIdOrUUID) {
    throw new HealthcareError(
      ErrorCode.VALIDATION_REQUIRED_FIELD,
      'Clinic ID is required',
      HttpStatus.BAD_REQUEST,
      {}
    );
  }

  const isUuidFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    clinicIdOrUUID
  );

  try {
    let clinic: ClinicData | null = null;

    // Strategy 1: If it looks like a UUID, try UUID lookup first
    if (isUuidFormat) {
      clinic = await findClinicById(databaseService, { id: clinicIdOrUUID });
      if (clinic) {
        if (!clinic.isActive) {
          throw new HealthcareError(
            ErrorCode.CLINIC_ACCESS_DENIED,
            `Clinic ${clinic.name} (${clinic.clinicId}) is inactive`,
            HttpStatus.FORBIDDEN,
            { clinicId: clinic.clinicId, clinicName: clinic.name }
          );
        }
        return clinic.id;
      }
    }

    // Strategy 2: Try looking up by clinicId field (e.g., "CL0002", "cl0002")
    clinic = await findClinicById(databaseService, {
      clinicId: clinicIdOrUUID,
    });

    if (clinic) {
      if (!clinic.isActive) {
        throw new HealthcareError(
          ErrorCode.CLINIC_ACCESS_DENIED,
          `Clinic ${clinic.name} (${clinic.clinicId}) is inactive`,
          HttpStatus.FORBIDDEN,
          { clinicId: clinic.clinicId, clinicName: clinic.name }
        );
      }
      return clinic.id;
    }

    // Strategy 3: If we already tried UUID and didn't find it, throw not found
    // Otherwise, this string isn't a UUID and wasn't found by clinicId, so not found
    if (isUuidFormat) {
      throw new HealthcareError(
        ErrorCode.CLINIC_NOT_FOUND,
        `Clinic not found with UUID: ${clinicIdOrUUID}. Please check if the clinic exists and is active.`,
        HttpStatus.NOT_FOUND,
        { clinicIdOrUUID }
      );
    }

    // Not found by clinicId field either
    throw new HealthcareError(
      ErrorCode.CLINIC_NOT_FOUND,
      `Clinic not found with identifier: ${clinicIdOrUUID}. Please check if the clinic exists and is active.`,
      HttpStatus.NOT_FOUND,
      { clinicIdOrUUID }
    );
  } catch (_error) {
    if (_error instanceof HealthcareError) {
      throw _error;
    }
    throw new HealthcareError(
      ErrorCode.DATABASE_QUERY_FAILED,
      `Failed to resolve clinic UUID: ${_error instanceof Error ? _error.message : String(_error)}`,
      HttpStatus.INTERNAL_SERVER_ERROR,
      { clinicIdOrUUID }
    );
  }
}
