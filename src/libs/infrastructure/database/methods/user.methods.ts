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
  /**
   * Find user by ID with full relations
   */
  async findUserByIdSafe(id: string): Promise<UserWithRelations | null> {
    return await this.executeRead<UserWithRelations | null>(async prisma => {
      return await prisma.user.findUnique({
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
    }, this.queryOptionsBuilder.useCache(true).cacheStrategy('long').priority('high').hipaaCompliant(true).build());
  }

  /**
   * Find user by email with full relations
   */
  async findUserByEmailSafe(email: string): Promise<UserWithRelations | null> {
    return await this.executeRead<UserWithRelations | null>(async prisma => {
      return await prisma.user.findUnique({
        where: { email },
        include: {
          doctor: true,
          patient: true,
          receptionists: true,
          clinicAdmins: true,
          superAdmin: true,
        },
      });
    }, this.queryOptionsBuilder.useCache(true).cacheStrategy('long').priority('high').hipaaCompliant(true).build());
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
        },
      });
    }, this.queryOptionsBuilder.useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(true).build());
  }

  /**
   * Create user with full relations
   */
  async createUserSafe(data: UserCreateInput): Promise<UserWithRelations> {
    const result = await this.executeWrite<UserWithRelations>(
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
        clinicId: '',
        operation: 'CREATE_USER',
        resourceType: 'USER',
        resourceId: 'pending',
        timestamp: new Date(),
      }
    );

    // Invalidate cache after creation
    if (result?.id) {
      await this.invalidateCache([
        this.queryKeyFactory.user(result.id),
        `user:email:${result.email || ''}`,
        'users',
      ]);
    }

    return result;
  }

  /**
   * Update user with full relations
   */
  async updateUserSafe(id: string, data: UserUpdateInput): Promise<UserWithRelations> {
    const result = await this.executeWrite<UserWithRelations>(
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
        clinicId: '',
        operation: 'UPDATE_USER',
        resourceType: 'USER',
        resourceId: id,
        timestamp: new Date(),
      }
    );

    // Invalidate cache after update
    await this.invalidateCache([this.queryKeyFactory.user(id), 'users']);

    return result;
  }

  /**
   * Delete user with full relations
   */
  async deleteUserSafe(id: string): Promise<UserWithRelations> {
    const result = await this.executeWrite<UserWithRelations>(
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
        clinicId: '',
        operation: 'DELETE_USER',
        resourceType: 'USER',
        resourceId: id,
        timestamp: new Date(),
      }
    );

    // Invalidate cache after deletion
    await this.invalidateCache([this.queryKeyFactory.user(id), 'users']);

    return result;
  }

  /**
   * Count users with filtering
   */
  async countUsersSafe(where: UserWhereInput): Promise<number> {
    return await this.executeRead<number>(async prisma => {
      return await prisma.user.count({ where });
    }, this.queryOptionsBuilder.useCache(true).cacheStrategy('short').priority('normal').hipaaCompliant(true).build());
  }
}
