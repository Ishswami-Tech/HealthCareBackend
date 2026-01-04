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
      findUnique: (args: {
        where: { clinicId: string } | { id: string };
        select: { id: boolean; clinicId: boolean; name: boolean; isActive: boolean };
      }) => Promise<ClinicData | null>;
    };
    return (await clinic.findUnique({
      where: where as { clinicId: string } | { id: string },
      select: { id: true, clinicId: true, name: true, isActive: true },
    })) as unknown as ClinicData | null;
  })) as unknown as ClinicData | null;
}

/**
 * Utility to resolve a clinic identifier (UUID or code) to the UUID
 *
 * @param databaseService - DatabaseService instance (from @infrastructure/database)
 * @param clinicIdOrUUID - Clinic identifier (either clinicId or UUID)
 * @returns Promise resolving to the clinic's UUID
 *
 * @description Resolves a clinic identifier to its UUID by first trying to find
 * by clinicId, then by UUID. Validates that the clinic is active before returning.
 * Uses DatabaseService for proper connection pooling, caching, and query optimization.
 *
 * @example
 * ```typescript
 * // In a service constructor:
 * constructor(private readonly databaseService: DatabaseService) {}
 *
 * // Usage:
 * const clinicUUID = await resolveClinicUUID(this.databaseService, 'clinic-123');
 * // Returns: 'uuid-of-clinic-123'
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

  try {
    // First try to find by clinicId (the unique identifier)
    let clinic: ClinicData | null = await findClinicById(databaseService, {
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

    // Then try to find by UUID
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

    // If still not found, provide detailed error
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
