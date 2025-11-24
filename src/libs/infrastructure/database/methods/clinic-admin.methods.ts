/**
 * Clinic Admin-related database methods
 * Code splitting: Clinic Admin convenience methods extracted from database.service.ts
 */

import { DatabaseMethodsBase } from './database-methods.base';

/**
 * Clinic Admin methods implementation
 * All methods use executeRead/Write for full optimization layers
 */
export class ClinicAdminMethods extends DatabaseMethodsBase {
  /**
   * Delete clinic
   */
  async deleteClinicSafe(id: string): Promise<{ id: string; name: string }> {
    const result = await this.executeWrite<{ id: string; name: string }>(
      async prisma => {
        const clinic = await prisma.clinic.delete({
          where: { id },
          select: {
            id: true,
            name: true,
          },
        });
        return clinic;
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'DELETE_CLINIC',
        resourceType: 'CLINIC',
        resourceId: id,
        timestamp: new Date(),
      }
    );

    await this.invalidateCache([`clinic:${id}`, 'clinics']);

    return result;
  }

  /**
   * Create clinic admin
   */
  async createClinicAdminSafe(data: {
    userId: string;
    clinicId: string;
  }): Promise<{ id: string; userId: string; clinicId: string }> {
    const result = await this.executeWrite<{ id: string; userId: string; clinicId: string }>(
      async prisma => {
        return await prisma.clinicAdmin.create({
          data,
          select: {
            id: true,
            userId: true,
            clinicId: true,
          },
        });
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: data.clinicId,
        operation: 'CREATE_CLINIC_ADMIN',
        resourceType: 'CLINIC_ADMIN',
        resourceId: 'pending',
        timestamp: new Date(),
      }
    );

    if (result?.id) {
      await this.invalidateCache([
        `clinic:${data.clinicId}:admins`,
        `user:${data.userId}:clinicAdmins`,
        'clinicAdmins',
      ]);
    }

    return result;
  }

  /**
   * Find clinic admin by ID
   */
  async findClinicAdminByIdSafe(id: string): Promise<{
    id: string;
    userId: string;
    clinicId: string;
    user?: { id: string; email: string; name: string; role: string };
  } | null> {
    return await this.executeRead<{
      id: string;
      userId: string;
      clinicId: string;
      user?: { id: string; email: string; name: string; role: string };
    } | null>(async prisma => {
      return await prisma.clinicAdmin.findUnique({
        where: { id },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
            },
          },
        },
      });
    }, this.queryOptionsBuilder.useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(false).build());
  }

  /**
   * Find clinic admins
   */
  async findClinicAdminsSafe(where: { clinicId?: string; userId?: string }): Promise<
    Array<{
      id: string;
      userId: string;
      clinicId: string;
      user?: { id: string; email: string; name: string; role: string } | undefined;
    }>
  > {
    return await this.executeRead<
      Array<{
        id: string;
        userId: string;
        clinicId: string;
        user?: { id: string; email: string; name: string; role: string } | undefined;
      }>
    >(async prisma => {
      return await prisma.clinicAdmin.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
            },
          },
        },
      });
    }, this.queryOptionsBuilder.useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(false).build());
  }

  /**
   * Delete clinic admin
   */
  async deleteClinicAdminSafe(
    id: string
  ): Promise<{ id: string; userId: string; clinicId: string }> {
    const result = await this.executeWrite<{ id: string; userId: string; clinicId: string }>(
      async prisma => {
        return await prisma.clinicAdmin.delete({
          where: { id },
          select: {
            id: true,
            userId: true,
            clinicId: true,
          },
        });
      },
      {
        userId: 'system',
        userRole: 'system',
        clinicId: '',
        operation: 'DELETE_CLINIC_ADMIN',
        resourceType: 'CLINIC_ADMIN',
        resourceId: id,
        timestamp: new Date(),
      }
    );

    await this.invalidateCache([
      `clinicAdmin:${id}`,
      `clinic:${result.clinicId}:admins`,
      `user:${result.userId}:clinicAdmins`,
      'clinicAdmins',
    ]);

    return result;
  }
}

