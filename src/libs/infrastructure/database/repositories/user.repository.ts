import { Injectable } from "@nestjs/common";
import {
  BaseRepository,
  RepositoryResult,
  QueryOptions,
} from "./base.repository";
import { PrismaService } from "../prisma/prisma.service";
import { Prisma } from "@prisma/client";
import { CreateUserDto, UpdateUserDto } from "../../../dtos/user.dto";

// Define User interface locally to match the expected return type
interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  name: string;
  role: string;
  isVerified: boolean;
  phone?: string;
  avatar?: string;
  lastLoginAt?: Date;
}

export interface UserWithProfile extends User {
  profile?: unknown;
  appointments?: unknown[];
  medicalHistory?: unknown[];
}

export interface UserSearchOptions extends QueryOptions {
  searchTerm?: string;
  role?: string;
  status?: string;
  dateRange?: {
    start: Date;
    end: Date;
  };
  includeProfile?: boolean;
  includeAppointments?: boolean;
  includeMedicalHistory?: boolean;
}

@Injectable()
export class UserRepository extends BaseRepository<
  User,
  CreateUserDto,
  UpdateUserDto,
  string
> {
  constructor(private readonly prisma: PrismaService) {
    super("User", prisma.user);
  }

  /**
   * Find user by email (unique constraint)
   */
  async findByEmail(
    email: string,
    options?: QueryOptions,
  ): Promise<RepositoryResult<User | null>> {
    try {
      this.logger.debug(`Finding user by email: ${email}`);
      const user = await this.prisma.user.findUnique({
        where: { email },
        ...(this.buildQueryOptions(options) || {}),
      });
      // Convert null values to undefined for compatibility
      const convertedUser = user
        ? {
            ...user,
            firstName: user.firstName || undefined,
            lastName: user.lastName || undefined,
            phone: user.phone || undefined,
          }
        : null;
      return RepositoryResult.success(convertedUser);
    } catch (_error) {
      this.logger.error("Failed to find user by email:", _error);
      return RepositoryResult.failure(_error as Error);
    }
  }

  /**
   * Find user by phone number
   */
  async findByPhone(
    phone: string,
    options?: QueryOptions,
  ): Promise<RepositoryResult<User | null>> {
    try {
      this.logger.debug(`Finding user by phone: ${phone}`);
      const user = await this.prisma.user.findFirst({
        where: { phone },
        ...(this.buildQueryOptions(options) || {}),
      });
      // Convert null values to undefined for compatibility
      const convertedUser = user
        ? {
            ...user,
            firstName: user.firstName || undefined,
            lastName: user.lastName || undefined,
            phone: user.phone || undefined,
          }
        : null;
      return RepositoryResult.success(convertedUser);
    } catch (_error) {
      this.logger.error("Failed to find user by phone:", _error);
      return RepositoryResult.failure(_error as Error);
    }
  }

  /**
   * Search users with advanced filtering
   */
  async searchUsers(
    options: UserSearchOptions,
  ): Promise<RepositoryResult<UserWithProfile[]>> {
    try {
      const where: any = {};

      // Text search across multiple fields
      if (options.searchTerm) {
        where.OR = [
          { firstName: { contains: options.searchTerm, mode: "insensitive" } },
          { lastName: { contains: options.searchTerm, mode: "insensitive" } },
          { email: { contains: options.searchTerm, mode: "insensitive" } },
          { phone: { contains: options.searchTerm } },
        ];
      }

      // Role filter
      if (options.role) {
        where.role = options.role as any;
      }

      // Status filter (based on isVerified field in your schema)
      if (options.status) {
        where.isVerified = options.status === "active";
      }

      // Date range filter
      if (options.dateRange) {
        where.createdAt = {
          gte: options.dateRange.start,
          lte: options.dateRange.end,
        };
      }

      const include: any = {};

      if (options.includeProfile) {
        include.doctor = true; // Include doctor profile if user is a doctor
        include.patient = true; // Include patient profile if user is a patient
      }

      if (options.includeAppointments) {
        include.appointments = {
          take: 10,
          orderBy: { date: "desc" },
        };
      }

      if (options.includeMedicalHistory) {
        include.medicalHistories = {
          take: 5,
          orderBy: { createdAt: "desc" },
        };
      }

      const users = await this.prisma.user.findMany({
        where,
        include,
        ...(this.buildQueryOptions(options) || {}),
      });

      this.logger.debug(`Found ${users.length} users matching search criteria`);
      // Convert null values to undefined for compatibility
      const convertedUsers = users.map((user: unknown) => ({
        ...(user as any),
        firstName: (user as any).firstName || undefined,
        lastName: (user as any).lastName || undefined,
        phone: (user as any).phone || undefined,
      }));
      return RepositoryResult.success(convertedUsers as UserWithProfile[]);
    } catch (_error) {
      this.logger.error("Failed to search users:", _error);
      return RepositoryResult.failure(_error as Error);
    }
  }

  /**
   * Get users by role with pagination
   */
  async findByRole(
    role: string,
    options?: QueryOptions,
  ): Promise<RepositoryResult<User[]>> {
    try {
      this.logger.debug(`Finding users by role: ${role}`);
      const users = await this.prisma.user.findMany({
        where: { role },
        ...(this.buildQueryOptions(options) || {}),
      });
      // Convert null values to undefined for compatibility
      const convertedUsers = users.map((user: unknown) => ({
        ...(user as any),
        firstName: (user as any).firstName || undefined,
        lastName: (user as any).lastName || undefined,
        phone: (user as any).phone || undefined,
      }));
      return RepositoryResult.success(convertedUsers);
    } catch (_error) {
      this.logger.error("Failed to find users by role:", _error);
      return RepositoryResult.failure(_error as Error);
    }
  }

  /**
   * Get active doctors with their profiles
   */
  async getActiveDoctors(
    options?: QueryOptions,
  ): Promise<RepositoryResult<UserWithProfile[]>> {
    try {
      this.logger.debug("Finding active doctors");
      const doctors = await this.prisma.user.findMany({
        where: {
          role: "DOCTOR",
          isVerified: true,
        },
        include: {
          doctor: true,
          appointments: {
            where: {
              status: "SCHEDULED",
            },
            take: 5,
          },
        },
        ...(this.buildQueryOptions(options) || {}),
      });
      // Convert null values to undefined for compatibility
      const convertedDoctors = doctors.map((doctor: unknown) => ({
        ...(doctor as any),
        firstName: (doctor as any).firstName || undefined,
        lastName: (doctor as any).lastName || undefined,
        phone: (doctor as any).phone || undefined,
      }));
      return RepositoryResult.success(convertedDoctors as UserWithProfile[]);
    } catch (_error) {
      this.logger.error("Failed to find active doctors:", _error);
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
      const [total, active, inactive, roleStats, recentRegistrations] =
        await Promise.all([
          this.prisma.user.count(),
          this.prisma.user.count({ where: { isVerified: true } }),
          this.prisma.user.count({ where: { isVerified: false } }),
          this.prisma.user.groupBy({
            by: ["role"],
            _count: { role: true },
          }),
          this.prisma.user.count({
            where: {
              createdAt: {
                gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
              },
            },
          }),
        ]);

      const byRole: Record<string, number> = {};
      for (const stat of roleStats) {
        byRole[stat.role] = stat._count.role;
      }

      const stats = {
        total,
        active,
        inactive,
        byRole,
        recentRegistrations,
      };

      this.logger.debug("User statistics calculated:", stats);
      return RepositoryResult.success(stats);
    } catch (_error) {
      this.logger.error("Failed to get user statistics:", _error);
      return RepositoryResult.failure(_error as Error);
    }
  }

  /**
   * Update user password hash
   */
  async updatePassword(
    id: string,
    password: string,
  ): Promise<RepositoryResult<User>> {
    try {
      this.logger.debug(`Updating password for user: ${id}`);
      const user = await this.prisma.user.update({
        where: { id },
        data: {
          password,
          updatedAt: new Date(),
          passwordChangedAt: new Date(),
        },
      });
      // Convert null values to undefined for compatibility
      const convertedUser = {
        ...user,
        firstName: user.firstName || undefined,
        lastName: user.lastName || undefined,
        phone: user.phone || undefined,
      };
      return RepositoryResult.success(convertedUser);
    } catch (_error) {
      this.logger.error("Failed to update user password:", _error);
      return RepositoryResult.failure(_error as Error);
    }
  }

  /**
   * Update user last login timestamp
   */
  async updateLastLogin(id: string): Promise<RepositoryResult<User>> {
    try {
      const user = await this.prisma.user.update({
        where: { id },
        data: { lastLogin: new Date() },
      });
      // Convert null values to undefined for compatibility
      const convertedUser = {
        ...user,
        firstName: user.firstName || undefined,
        lastName: user.lastName || undefined,
        phone: user.phone || undefined,
      };
      return RepositoryResult.success(convertedUser);
    } catch (_error) {
      this.logger.error("Failed to update last login:", _error);
      return RepositoryResult.failure(_error as Error);
    }
  }

  /**
   * Activate/Deactivate user account
   */
  async toggleUserStatus(
    id: string,
    isVerified: boolean,
  ): Promise<RepositoryResult<User>> {
    try {
      this.logger.debug(
        `${isVerified ? "Verifying" : "Unverifying"} user: ${id}`,
      );
      const user = await this.prisma.user.update({
        where: { id },
        data: {
          isVerified,
          updatedAt: new Date(),
        },
      });
      // Convert null values to undefined for compatibility
      const convertedUser = {
        ...user,
        firstName: user.firstName || undefined,
        lastName: user.lastName || undefined,
        phone: user.phone || undefined,
      };
      return RepositoryResult.success(convertedUser);
    } catch (_error) {
      this.logger.error("Failed to toggle user status:", _error);
      return RepositoryResult.failure(_error as Error);
    }
  }

  /**
   * Get users with upcoming appointments
   */
  async getUsersWithUpcomingAppointments(
    days: number = 7,
  ): Promise<RepositoryResult<UserWithProfile[]>> {
    try {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + days);

      const users = await this.prisma.user.findMany({
        where: {
          appointments: {
            some: {
              date: {
                gte: new Date(),
                lte: futureDate,
              },
              status: "SCHEDULED",
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
              status: "SCHEDULED",
            },
            orderBy: { date: "asc" },
          },
        },
      });

      // Convert null values to undefined for compatibility
      const convertedUsers = users.map((user: unknown) => ({
        ...(user as any),
        firstName: (user as any).firstName || undefined,
        lastName: (user as any).lastName || undefined,
        phone: (user as any).phone || undefined,
      }));
      return RepositoryResult.success(convertedUsers as UserWithProfile[]);
    } catch (_error) {
      this.logger.error(
        "Failed to get users with upcoming appointments:",
        _error,
      );
      return RepositoryResult.failure(_error as Error);
    }
  }

  /**
   * Bulk update users
   */
  async bulkUpdateUsers(
    userIds: string[],
    updateData: Partial<UpdateUserDto>,
  ): Promise<RepositoryResult<{ count: number }>> {
    return this.executeInTransaction(async (tx: any) => {
      const result = await (tx as any).user.updateMany({
        where: {
          id: { in: userIds },
        },
        data: {
          ...updateData,
          updatedAt: new Date(),
        },
      });

      this.logger.debug(`Bulk updated ${result.count} users`);
      return result;
    });
  }

  /**
   * Soft delete user (healthcare compliance)
   */
  async softDeleteUser(id: string): Promise<RepositoryResult<User>> {
    return this.executeInTransaction(async (tx: any) => {
      // First, anonymize sensitive data
      const user = await (tx as any).user.update({
        where: { id },
        data: {
          email: `deleted_${id}@deleted.local`,
          phone: null,
          firstName: "Deleted",
          lastName: "User",
          isVerified: false,
        },
      });

      // Update related records if needed - cancel their appointments
      await (tx as any).appointment.updateMany({
        where: { userId: id },
        data: { status: "CANCELLED" },
      });

      this.logger.debug(`Soft deleted user: ${id}`);
      // Convert null values to undefined for compatibility
      const convertedUser = {
        ...user,
        firstName: user.firstName || undefined,
        lastName: user.lastName || undefined,
        phone: user.phone || undefined,
      };
      return convertedUser;
    });
  }
}
