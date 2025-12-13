/**
 * User-related database methods
 * Code splitting: User convenience methods extracted from database.service.ts
 */

import { DatabaseMethodsBase } from './database-methods.base';
import type { UserWithRelations } from '@core/types/user.types';
import type { UserCreateInput, UserUpdateInput, UserWhereInput } from '@core/types/input.types';

/**
 * User methods implementation
 * All methods use executeRead/Write for full optimization layers
 */
export class UserMethods extends DatabaseMethodsBase {
  private readonly userInclude = {
    doctor: true,
    patient: true,
    receptionists: true,
    clinicAdmins: true,
    superAdmin: true,
    pharmacist: true,
    therapist: true,
    labTechnician: true,
    financeBilling: true,
    supportStaff: true,
    nurse: true,
    counselor: true,
  } as const;

  /**
   * Find user by ID with full relations
   */
  async findUserByIdSafe(id: string): Promise<UserWithRelations | null> {
    return await this.executeRead<UserWithRelations | null>(async prisma => {
      return await prisma.user.findUnique({
        where: { id },
        include: this.userInclude,
      });
    }, this.queryOptionsBuilder.where({ id }).include(this.userInclude).useCache(true).cacheStrategy('long').priority('high').hipaaCompliant(true).build());
  }

  /**
   * Find user by email with full relations
   */
  async findUserByEmailSafe(email: string): Promise<UserWithRelations | null> {
    return await this.executeRead<UserWithRelations | null>(async prisma => {
      return await prisma.user.findUnique({
        where: { email },
        include: this.userInclude,
      });
    }, this.queryOptionsBuilder.where({ email }).include(this.userInclude).useCache(true).cacheStrategy('long').priority('high').hipaaCompliant(true).build());
  }

  /**
   * Find user by email for authentication - explicitly includes password field
   *
   * OPTIMIZED FOR AUTH: Uses optimized Prisma query with all database optimizations
   * - Uses Prisma's findUnique with include (all fields including password are included by default)
   * - Uses optimized Prisma query with eager loading for relations (with query optimization)
   * - Includes all optimization layers: query optimization, metrics, security checks
   * - Bypasses caching (sensitive auth data)
   * - Prisma includes password field automatically when not using select
   *
   * Performance: Optimized for 2-7ms target with single optimized query
   */
  async findUserByEmailForAuth(
    email: string
  ): Promise<(UserWithRelations & { password: string }) | null> {
    return await this.executeRead<(UserWithRelations & { password: string }) | null>(
      async prisma => {
        // OPTIMIZATION: Use Prisma's findUnique with include (all fields including password)
        // This uses all optimization layers (query optimizer, metrics, security checks)
        // Prisma includes all fields by default when using include, including password
        const user = await prisma.user.findUnique({
          where: { email },
          include: {
            doctor: true,
            patient: true,
            receptionists: true,
            clinicAdmins: true,
            superAdmin: true,
            pharmacist: true,
            therapist: true,
            labTechnician: true,
            financeBilling: true,
            supportStaff: true,
            nurse: true,
            counselor: true,
            clinics: true,
          },
        });

        // Early return if user not found
        if (!user) {
          return null;
        }

        // Early return if password not found (user exists but no password - invalid state)
        // Prisma includes password field automatically, but check for safety
        if (!user.password) {
          return null;
        }

        // Return user with password - Prisma includes password field automatically
        return user as UserWithRelations & { password: string };
      },
      this.queryOptionsBuilder
        .useCache(false) // Do not cache sensitive auth data
        .priority('high') // High priority for auth operations
        .hipaaCompliant(false) // Auth operations don't need HIPAA compliance checks (internal)
        .build()
    );
  }

  /**
   * Find users with filtering
   */
  async findUsersSafe(where: UserWhereInput): Promise<UserWithRelations[]> {
    return await this.executeRead<UserWithRelations[]>(async prisma => {
      return await prisma.user.findMany({
        where,
        include: {
          doctor: true,
          patient: true,
          receptionists: true,
          clinicAdmins: true,
          superAdmin: true,
          pharmacist: true,
          therapist: true,
          labTechnician: true,
          financeBilling: true,
          supportStaff: true,
          nurse: true,
          counselor: true,
        },
      });
    }, this.queryOptionsBuilder.useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(true).build());
  }

  /**
   * Create user
   */
  async createUserSafe(data: UserCreateInput): Promise<UserWithRelations> {
    return await this.executeWrite<UserWithRelations>(
      async prisma => {
        return await prisma.user.create({
          data,
          include: {
            doctor: true,
            patient: true,
            receptionists: true,
            clinicAdmins: true,
            superAdmin: true,
            pharmacist: true,
            therapist: true,
            labTechnician: true,
            financeBilling: true,
            supportStaff: true,
            nurse: true,
            counselor: true,
          },
        });
      },
      {
        userId: 'system',
        userRole: 'system',
        operation: 'CREATE',
        resourceType: 'User',
        resourceId: 'new',
        clinicId: '',
        details: {
          email:
            typeof data === 'object' && 'email' in data && typeof data.email === 'string'
              ? data.email
              : '',
        },
      },
      this.queryOptionsBuilder.useCache(false).build()
    );
  }

  /**
   * Update user
   */
  async updateUserSafe(id: string, data: UserUpdateInput): Promise<UserWithRelations> {
    return await this.executeWrite<UserWithRelations>(
      async prisma => {
        return await prisma.user.update({
          where: { id },
          data,
          include: {
            doctor: true,
            patient: true,
            receptionists: true,
            clinicAdmins: true,
            superAdmin: true,
            pharmacist: true,
            therapist: true,
            labTechnician: true,
            financeBilling: true,
            supportStaff: true,
            nurse: true,
            counselor: true,
          },
        });
      },
      {
        userId: 'system',
        userRole: 'system',
        operation: 'UPDATE',
        resourceType: 'User',
        resourceId: id,
        clinicId: '',
      },
      this.queryOptionsBuilder.useCache(false).build()
    );
  }

  /**
   * Delete user
   */
  async deleteUserSafe(id: string): Promise<UserWithRelations> {
    return await this.executeWrite<UserWithRelations>(
      async prisma => {
        return await prisma.user.delete({
          where: { id },
          include: {
            doctor: true,
            patient: true,
            receptionists: true,
            clinicAdmins: true,
            superAdmin: true,
            pharmacist: true,
            therapist: true,
            labTechnician: true,
            financeBilling: true,
            supportStaff: true,
            nurse: true,
            counselor: true,
          },
        });
      },
      {
        userId: 'system',
        userRole: 'system',
        operation: 'DELETE',
        resourceType: 'User',
        resourceId: id,
        clinicId: '',
      },
      this.queryOptionsBuilder.useCache(false).build()
    );
  }

  /**
   * Count users with filtering
   */
  async countUsersSafe(where: UserWhereInput): Promise<number> {
    return await this.executeRead<number>(async prisma => {
      return await prisma.user.count({
        where,
      });
    }, this.queryOptionsBuilder.useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(true).build());
  }
}
