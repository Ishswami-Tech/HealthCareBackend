import { Injectable, Optional } from '@nestjs/common';
import { BaseRepository, RepositoryResult, QueryOptions } from './base.repository';
import { DatabaseService } from '@infrastructure/database';
import { CreateUserDto, UpdateUserDto } from '@dtos/user.dto';
import { LoggingService } from '@infrastructure/logging';
import { CacheService } from '@infrastructure/cache';
import { HealthcareDatabaseClient } from '../clients/healthcare-database.client';
import { LogType, LogLevel } from '@core/types';
import type { User, UserWithProfile, UserSearchOptions, UserBase } from '@core/types';
// Type-safe Prisma operation helpers
// Prisma delegates return 'unknown' to avoid 'any' type errors from Prisma's generated types
type PrismaUserDelegate = {
  findUnique: <T>(args: T) => Promise<unknown>;
  findFirst: <T>(args: T) => Promise<unknown>;
  findMany: <T>(args: T) => Promise<unknown>;
  update: <T>(args: T) => Promise<unknown>;
  updateMany: <T>(args: T) => Promise<unknown>;
  count: <T>(args?: T) => Promise<unknown>;
  groupBy: <T>(args: T) => Promise<unknown>;
};

function getUserDelegate(prismaClient: { user: unknown }): PrismaUserDelegate {
  return prismaClient.user as PrismaUserDelegate;
}

/**
 * Converts Prisma user result to UserBase
 * - Prisma returns null for optional fields, but TypeScript optional properties use undefined
 * - This converts null to undefined for firstName, lastName, phone
 */
function toUserBase(user: unknown): UserBase {
  // Prisma returns objects with null values, TypeScript expects undefined for optional properties
  const prismaUser = user as {
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
    [key: string]: string | number | boolean | Date | null | undefined;
  };
  return {
    ...prismaUser,
    firstName: prismaUser.firstName ?? undefined,
    lastName: prismaUser.lastName ?? undefined,
    phone: prismaUser.phone ?? undefined,
  } as UserBase;
}

/**
 * Converts Prisma result to UserBase or null
 * Handles null/undefined from database queries
 * Returns null if result is null/undefined, otherwise returns UserBase
 * Note: Return type is not explicitly annotated to avoid 'any' in union types
 */
function toUserBaseOrNull(result: unknown) {
  if (result === null || result === undefined) {
    return null;
  }
  return toUserBase(result);
}

/**
 * Converts Prisma array result to UserBase array
 * Validates the result is an array before mapping
 * Note: Return type is not explicitly annotated to avoid 'any' in union types
 */
function toUserBaseArray(result: unknown) {
  if (!Array.isArray(result)) {
    return [];
  }
  return result.map(user => toUserBase(user));
}

/**
 * User Repository - INTERNAL INFRASTRUCTURE COMPONENT
 *
 * NOT FOR DIRECT USE - Use DatabaseService instead.
 * This repository is an internal component used by DatabaseService optimization layers.
 * @internal
 */
@Injectable()
export class UserRepository extends BaseRepository<User, CreateUserDto, UpdateUserDto, string> {
  constructor(
    databaseService: DatabaseService,
    loggingService: LoggingService,
    @Optional() cacheService?: CacheService
  ) {
    // Use internal accessor - repositories are infrastructure components
    super(
      'User',
      (
        databaseService as unknown as { getInternalPrismaClient: () => { user: unknown } }
      ).getInternalPrismaClient().user,
      loggingService,
      cacheService,
      databaseService
    );
  }

  /**
   * Find user by email (unique constraint)
   */
  async findByEmail(
    email: string,
    options?: QueryOptions
  ): Promise<RepositoryResult<UserBase | null>> {
    try {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Finding user by email: ${email}`,
        'UserRepository'
      );
      // Use internal accessor - repositories are infrastructure components
      const prismaClient = (
        this.databaseService as unknown as { getInternalPrismaClient: () => { user: unknown } }
      ).getInternalPrismaClient();
      const userDelegate = getUserDelegate(prismaClient);
      const rawResult = await userDelegate.findUnique({
        where: { email },
        ...(this.buildQueryOptions(options) || {}),
      });
      const userResult = toUserBaseOrNull(rawResult);
      return RepositoryResult.success(userResult);
    } catch (_error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to find user by email: ${_error instanceof Error ? _error.message : String(_error)}`,
        'UserRepository',
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );
      return RepositoryResult.failure(_error as Error);
    }
  }

  /**
   * Find user by phone number
   */
  async findByPhone(
    phone: string,
    options?: QueryOptions
  ): Promise<RepositoryResult<UserBase | null>> {
    try {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Finding user by phone: ${phone}`,
        'UserRepository'
      );
      // Use internal accessor - repositories are infrastructure components
      const prismaClient = (
        this.databaseService as unknown as { getInternalPrismaClient: () => { user: unknown } }
      ).getInternalPrismaClient();
      const userDelegate = getUserDelegate(prismaClient);
      const rawResult = await userDelegate.findFirst({
        where: { phone },
        ...(this.buildQueryOptions(options) || {}),
      });
      const userResult = toUserBaseOrNull(rawResult);
      return RepositoryResult.success(userResult);
    } catch (_error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to find user by phone: ${_error instanceof Error ? _error.message : String(_error)}`,
        'UserRepository',
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );
      return RepositoryResult.failure(_error as Error);
    }
  }

  /**
   * Search users with advanced filtering
   */
  async searchUsers(options: UserSearchOptions): Promise<RepositoryResult<UserWithProfile[]>> {
    try {
      const where: Record<string, unknown> = {};

      // Text search across multiple fields
      if (options.searchTerm) {
        where['OR'] = [
          { firstName: { contains: options.searchTerm, mode: 'insensitive' } },
          { lastName: { contains: options.searchTerm, mode: 'insensitive' } },
          { email: { contains: options.searchTerm, mode: 'insensitive' } },
          { phone: { contains: options.searchTerm } },
        ];
      }

      // Role filter
      if (options.role) {
        where['role'] = options.role;
      }

      // Status filter (based on isVerified field in your schema)
      if (options.status) {
        where['isVerified'] = options.status === 'active';
      }

      // Date range filter
      if (options.dateRange) {
        where['createdAt'] = {
          gte: options.dateRange.start,
          lte: options.dateRange.end,
        };
      }

      const include: Record<string, unknown> = {};

      if (options.includeProfile) {
        include['doctor'] = true; // Include doctor profile if user is a doctor
        include['patient'] = true; // Include patient profile if user is a patient
      }

      if (options.includeAppointments) {
        include['appointments'] = {
          take: 10,
          orderBy: { date: 'desc' },
        };
      }

      if (options.includeMedicalHistory) {
        include['medicalHistories'] = {
          take: 5,
          orderBy: { createdAt: 'desc' },
        };
      }

      // Use internal accessor - repositories are infrastructure components
      const prismaClient = (
        this.databaseService as unknown as { getInternalPrismaClient: () => { user: unknown } }
      ).getInternalPrismaClient();
      const userDelegate = getUserDelegate(prismaClient);
      const rawResult = await userDelegate.findMany({
        where,
        include,
        ...(this.buildQueryOptions(options) || {}),
      });
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Found ${Array.isArray(rawResult) ? rawResult.length : 0} users matching search criteria`,
        'UserRepository'
      );

      // Convert Prisma results to UserWithProfile
      const users: UserWithProfile[] = Array.isArray(rawResult)
        ? rawResult.map(user => toUserBase(user) as UserWithProfile)
        : [];
      return RepositoryResult.success(users);
    } catch (_error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to search users: ${_error instanceof Error ? _error.message : String(_error)}`,
        'UserRepository',
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );
      return RepositoryResult.failure(_error as Error);
    }
  }

  /**
   * Get users by role with pagination
   */
  async findByRole(role: string, options?: QueryOptions): Promise<RepositoryResult<UserBase[]>> {
    try {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Finding users by role: ${role}`,
        'UserRepository'
      );
      // Use internal accessor - repositories are infrastructure components
      const prismaClient = (
        this.databaseService as unknown as { getInternalPrismaClient: () => { user: unknown } }
      ).getInternalPrismaClient();
      const userDelegate = getUserDelegate(prismaClient);
      const rawResult = await userDelegate.findMany({
        where: { role },
        ...(this.buildQueryOptions(options) || {}),
      });
      const usersResult = toUserBaseArray(rawResult);
      return RepositoryResult.success(usersResult);
    } catch (_error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to find users by role: ${_error instanceof Error ? _error.message : String(_error)}`,
        'UserRepository',
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );
      return RepositoryResult.failure(_error as Error);
    }
  }

  /**
   * Get active doctors with their profiles
   */
  async getActiveDoctors(options?: QueryOptions): Promise<RepositoryResult<UserWithProfile[]>> {
    try {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        'Finding active doctors',
        'UserRepository'
      );
      // Use internal accessor - repositories are infrastructure components
      const prismaClient = (
        this.databaseService as unknown as { getInternalPrismaClient: () => { user: unknown } }
      ).getInternalPrismaClient();
      const userDelegate = getUserDelegate(prismaClient);
      const rawResult = await userDelegate.findMany({
        where: {
          role: 'DOCTOR',
          isVerified: true,
        },
        include: {
          doctor: true,
          appointments: {
            where: {
              status: 'SCHEDULED',
            },
            take: 5,
          },
        },
        ...(this.buildQueryOptions(options) || {}),
      });
      // Convert Prisma results to UserWithProfile
      const doctors: UserWithProfile[] = Array.isArray(rawResult)
        ? rawResult.map(doctor => toUserBase(doctor) as UserWithProfile)
        : [];
      return RepositoryResult.success(doctors);
    } catch (_error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to find active doctors: ${_error instanceof Error ? _error.message : String(_error)}`,
        'UserRepository',
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );
      return RepositoryResult.failure(_error as Error);
    }
  }

  /**
   * Get user statistics
   */
  async getUserStats(): Promise<
    RepositoryResult<{
      total: number;
      active: number;
      inactive: number;
      byRole: Record<string, number>;
      recentRegistrations: number;
    }>
  > {
    try {
      // Use internal accessor - repositories are infrastructure components
      const prismaClient = (
        this.databaseService as unknown as { getInternalPrismaClient: () => { user: unknown } }
      ).getInternalPrismaClient();
      const userDelegate = getUserDelegate(prismaClient);
      const results = await Promise.all([
        userDelegate.count(),
        userDelegate.count({ where: { isVerified: true } }),
        userDelegate.count({ where: { isVerified: false } }),
        userDelegate.groupBy({
          by: ['role'],
          _count: { role: true },
        }),
        userDelegate.count({
          where: {
            createdAt: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
            },
          },
        }),
      ]);
      const total = results[0] as number;
      const active = results[1] as number;
      const inactive = results[2] as number;
      const roleStats = results[3] as Array<{ role: string; _count: { role: number } }>;
      const recentRegistrations = results[4] as number;

      const totalCount = Number(total);
      const activeCount = Number(active);
      const inactiveCount = Number(inactive);
      const recentRegistrationsCount = Number(recentRegistrations);

      const byRole: Record<string, number> = {};
      const roleStatsArray = (Array.isArray(roleStats) ? roleStats : []) as Array<{
        role: string;
        _count: { role: number };
      }>;
      for (const stat of roleStatsArray) {
        byRole[stat.role] = stat._count.role;
      }

      const stats = {
        total: totalCount,
        active: activeCount,
        inactive: inactiveCount,
        byRole,
        recentRegistrations: recentRegistrationsCount,
      };

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        'User statistics calculated',
        'UserRepository',
        { stats }
      );
      return RepositoryResult.success(stats);
    } catch (_error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to get user statistics: ${_error instanceof Error ? _error.message : String(_error)}`,
        'UserRepository',
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );
      return RepositoryResult.failure(_error as Error);
    }
  }

  /**
   * Update user password hash
   */
  async updatePassword(id: string, password: string): Promise<RepositoryResult<UserBase>> {
    try {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Updating password for user: ${id}`,
        'UserRepository'
      );
      // Use internal accessor - repositories are infrastructure components
      const prismaClient = (
        this.databaseService as unknown as { getInternalPrismaClient: () => { user: unknown } }
      ).getInternalPrismaClient();
      const userDelegate = getUserDelegate(prismaClient);
      const rawResult = await userDelegate.update({
        where: { id },
        data: {
          password,
          updatedAt: new Date(),
          passwordChangedAt: new Date(),
        },
      });
      const userResult = toUserBase(rawResult);
      return RepositoryResult.success(userResult);
    } catch (_error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to update user password: ${_error instanceof Error ? _error.message : String(_error)}`,
        'UserRepository',
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );
      return RepositoryResult.failure(_error as Error);
    }
  }

  /**
   * Update user last login timestamp
   */
  async updateLastLogin(id: string): Promise<RepositoryResult<UserBase>> {
    try {
      // Use internal accessor - repositories are infrastructure components
      const prismaClient = (
        this.databaseService as unknown as { getInternalPrismaClient: () => { user: unknown } }
      ).getInternalPrismaClient();
      const userDelegate = getUserDelegate(prismaClient);
      const rawResult = await userDelegate.update({
        where: { id },
        data: { lastLogin: new Date() },
      });
      const userResult = toUserBase(rawResult);
      return RepositoryResult.success(userResult);
    } catch (_error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to update last login: ${_error instanceof Error ? _error.message : String(_error)}`,
        'UserRepository',
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );
      return RepositoryResult.failure(_error as Error);
    }
  }

  /**
   * Activate/Deactivate user account
   */
  async toggleUserStatus(id: string, isVerified: boolean): Promise<RepositoryResult<UserBase>> {
    try {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `${isVerified ? 'Verifying' : 'Unverifying'} user: ${id}`,
        'UserRepository'
      );
      // Use internal accessor - repositories are infrastructure components
      const prismaClient = (
        this.databaseService as unknown as { getInternalPrismaClient: () => { user: unknown } }
      ).getInternalPrismaClient();
      const userDelegate = getUserDelegate(prismaClient);
      const rawResult = await userDelegate.update({
        where: { id },
        data: {
          isVerified,
          updatedAt: new Date(),
        },
      });
      const userResult = toUserBase(rawResult);
      return RepositoryResult.success(userResult);
    } catch (_error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to toggle user status: ${_error instanceof Error ? _error.message : String(_error)}`,
        'UserRepository',
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );
      return RepositoryResult.failure(_error as Error);
    }
  }

  /**
   * Get users with upcoming appointments
   */
  async getUsersWithUpcomingAppointments(
    days: number = 7
  ): Promise<RepositoryResult<UserWithProfile[]>> {
    try {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + days);

      // Use internal accessor - repositories are infrastructure components
      const prismaClient = (
        this.databaseService as unknown as { getInternalPrismaClient: () => { user: unknown } }
      ).getInternalPrismaClient();
      const userDelegate = getUserDelegate(prismaClient);
      const rawResult = await userDelegate.findMany({
        where: {
          appointments: {
            some: {
              date: {
                gte: new Date(),
                lte: futureDate,
              },
              status: 'SCHEDULED',
            },
          },
        },
        include: {
          appointments: {
            where: {
              date: {
                gte: new Date(),
                lte: futureDate,
              },
              status: 'SCHEDULED',
            },
            orderBy: { date: 'asc' },
          },
        },
      });
      // Convert Prisma results to UserWithProfile
      const users: UserWithProfile[] = Array.isArray(rawResult)
        ? rawResult.map(user => toUserBase(user) as UserWithProfile)
        : [];
      return RepositoryResult.success(users);
    } catch (_error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to get users with upcoming appointments: ${_error instanceof Error ? _error.message : String(_error)}`,
        'UserRepository',
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );
      return RepositoryResult.failure(_error as Error);
    }
  }

  /**
   * Bulk update users
   */
  async bulkUpdateUsers(
    userIds: string[],
    updateData: Partial<UpdateUserDto>
  ): Promise<RepositoryResult<{ count: number }>> {
    try {
      // Use internal accessor - repositories are infrastructure components
      const prismaClient = (
        this.databaseService as unknown as { getInternalPrismaClient: () => { user: unknown } }
      ).getInternalPrismaClient();
      const userDelegate = getUserDelegate(prismaClient);
      const rawResult = await userDelegate.updateMany({
        where: {
          id: { in: userIds },
        },
        data: {
          ...updateData,
          updatedAt: new Date(),
        },
      });
      const updateResult = rawResult as { count: number };

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Bulk updated ${updateResult.count} users`,
        'UserRepository'
      );
      return RepositoryResult.success(updateResult);
    } catch (_error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to bulk update users: ${_error instanceof Error ? _error.message : String(_error)}`,
        'UserRepository',
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );
      return RepositoryResult.failure(_error as Error);
    }
  }

  /**
   * Soft delete user (healthcare compliance)
   */
  async softDeleteUser(id: string): Promise<RepositoryResult<UserBase>> {
    const result = await this.executeInTransaction(async (tx: unknown) => {
      // Type the transaction client
      type TransactionClient = {
        user: {
          update: (args: {
            where: { id: string };
            data: Record<string, unknown>;
          }) => Promise<unknown>;
        };
        appointment: {
          updateMany: (args: {
            where: { userId: string };
            data: { status: string };
          }) => Promise<{ count: number }>;
        };
      };
      const transactionClient = tx as TransactionClient;

      // First, anonymize sensitive data
      const rawResult = await transactionClient.user.update({
        where: { id },
        data: {
          email: `deleted_${id}@deleted.local`,
          phone: null,
          firstName: 'Deleted',
          lastName: 'User',
          isVerified: false,
        },
      });

      // Update related records if needed - cancel their appointments
      await transactionClient.appointment.updateMany({
        where: { userId: id },
        data: { status: 'CANCELLED' },
      });

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.DEBUG,
        `Soft deleted user: ${id}`,
        'UserRepository'
      );

      const userResult = toUserBase(rawResult);
      return userResult;
    });

    if (result.isFailure) {
      return result;
    }

    // Unwrap the nested result
    const innerResult = result.data;
    if (innerResult && innerResult instanceof RepositoryResult) {
      return innerResult;
    }

    // If data is UserBase, wrap it in success result
    return RepositoryResult.success(result.data as UserBase);
  }
}
