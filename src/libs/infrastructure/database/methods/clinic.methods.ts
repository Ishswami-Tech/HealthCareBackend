/**
 * Clinic-related database methods
 * Code splitting: Clinic convenience methods extracted from database.service.ts
 */

import { DatabaseMethodsBase } from './database-methods.base';

/**
 * Clinic methods implementation
 * All methods use executeRead/Write for full optimization layers
 */
export class ClinicMethods extends DatabaseMethodsBase {
  /**
   * Find clinic by ID
   */
  async findClinicByIdSafe(id: string): Promise<{
    name: string;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null> {
    return await this.executeRead<{
      name: string;
      address?: string | null;
      phone?: string | null;
      email?: string | null;
    } | null>(async prisma => {
      const clinic = await prisma.clinic.findUnique({
        where: { id },
        select: {
          name: true,
          address: true,
          phone: true,
          email: true,
        },
      });
      return clinic as {
        name: string;
        address?: string | null;
        phone?: string | null;
        email?: string | null;
      } | null;
    }, this.queryOptionsBuilder.useCache(true).cacheStrategy('long').priority('normal').hipaaCompliant(false).build());
  }
}
