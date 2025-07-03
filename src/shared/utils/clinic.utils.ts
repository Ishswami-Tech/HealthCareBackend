// Utility to resolve a clinic identifier (UUID or code) to the UUID
export async function resolveClinicUUID(prisma, clinicIdOrUUID: string): Promise<string> {
  let clinic = await prisma.clinic.findUnique({ where: { clinicId: clinicIdOrUUID } });
  if (!clinic) {
    clinic = await prisma.clinic.findUnique({ where: { id: clinicIdOrUUID } });
  }
  if (!clinic) {
    throw new Error('Clinic not found');
  }
  return clinic.id;
} 