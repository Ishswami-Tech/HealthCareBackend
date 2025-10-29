import { PrismaClient } from "@prisma/client";

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
 * Interface for clinic data returned from Prisma queries
 */
interface ClinicData {
  id: string;
  clinicId: string;
  name: string;
  isActive: boolean;
}

/**
 * Type-safe Prisma client interface for clinic operations
 */
interface TypedPrismaClient {
  clinic: {
    findUnique: (args: {
      where: { clinicId: string } | { id: string };
      select: {
        id: true;
        clinicId: true;
        name: true;
        isActive: true;
      };
    }) => Promise<ClinicData | null>;
  };
}

/**
 * Utility to resolve a clinic identifier (UUID or code) to the UUID
 *
 * @param prisma - Prisma client instance
 * @param clinicIdOrUUID - Clinic identifier (either clinicId or UUID)
 * @returns Promise resolving to the clinic's UUID
 *
 * @description Resolves a clinic identifier to its UUID by first trying to find
 * by clinicId, then by UUID. Validates that the clinic is active before returning.
 *
 * @example
 * ```typescript
 * const clinicUUID = await resolveClinicUUID(prisma, 'clinic-123');
 * // Returns: 'uuid-of-clinic-123'
 *
 * const clinicUUID2 = await resolveClinicUUID(prisma, 'existing-uuid');
 * // Returns: 'existing-uuid' if clinic exists and is active
 * ```
 *
 * @throws {Error} When clinic ID is not provided, clinic is not found, or clinic is inactive
 */
/**
 * Helper function to safely call Prisma clinic.findUnique
 */
async function findClinicById(
  prisma: PrismaClient,
  where: { clinicId: string } | { id: string },
): Promise<ClinicData | null> {
  // Cast to our typed interface to ensure type safety
  const typedPrisma = prisma as TypedPrismaClient;

  return await typedPrisma.clinic.findUnique({
    where,
    select: { id: true, clinicId: true, name: true, isActive: true },
  });
}

export async function resolveClinicUUID(
  prisma: PrismaClient,
  clinicIdOrUUID: string,
): Promise<string> {
  if (!clinicIdOrUUID) {
    throw new Error("Clinic ID is required");
  }

  try {
    // First try to find by clinicId (the unique identifier)
    let clinic: ClinicData | null = await findClinicById(prisma, {
      clinicId: clinicIdOrUUID,
    });

    if (clinic) {
      if (!clinic.isActive) {
        throw new Error(
          `Clinic ${clinic.name} (${clinic.clinicId}) is inactive`,
        );
      }
      return clinic.id;
    }

    // Then try to find by UUID
    clinic = await findClinicById(prisma, { id: clinicIdOrUUID });

    if (clinic) {
      if (!clinic.isActive) {
        throw new Error(
          `Clinic ${clinic.name} (${clinic.clinicId}) is inactive`,
        );
      }
      return clinic.id;
    }

    // If still not found, provide detailed error
    throw new Error(
      `Clinic not found with identifier: ${clinicIdOrUUID}. Please check if the clinic exists and is active.`,
    );
  } catch (_error) {
    if (
      (_error as Error).message.includes("Clinic not found") ||
      (_error as Error).message.includes("is inactive")
    ) {
      throw _error;
    }
    throw new Error(
      `Failed to resolve clinic UUID: ${(_error as Error).message}`,
    );
  }
}
