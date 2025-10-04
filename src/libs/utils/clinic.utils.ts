import { PrismaClient } from "@prisma/client";
// Utility to resolve a clinic identifier (UUID or code) to the UUID
export async function resolveClinicUUID(
  prisma: PrismaClient,
  clinicIdOrUUID: string,
): Promise<string> {
  if (!clinicIdOrUUID) {
    throw new Error("Clinic ID is required");
  }

  try {
    // First try to find by clinicId (the unique identifier)
    let clinic = await prisma.clinic.findUnique({
      where: { clinicId: clinicIdOrUUID },
      select: { id: true, clinicId: true, name: true, isActive: true },
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
    clinic = await prisma.clinic.findUnique({
      where: { id: clinicIdOrUUID },
      select: { id: true, clinicId: true, name: true, isActive: true },
    });

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
