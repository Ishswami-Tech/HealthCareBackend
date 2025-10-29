import { DatabaseService } from "../../libs/infrastructure/database";
import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { CacheService } from "../../libs/infrastructure/cache";
import { LoggingService } from "../../libs/infrastructure/logging/logging.service";
import { EventService } from "../../libs/infrastructure/events/event.service";
import {
  LogLevel,
  LogType,
} from "../../libs/infrastructure/logging/types/logging.types";
import { Role } from "../../libs/infrastructure/database/prisma/prisma.types";
import type { User } from "../../libs/infrastructure/database/prisma/prisma.types";

// Type for user with relations
interface UserWithRelations extends User {
  doctor?: {
    id: string;
    specialization?: string;
    licenseNumber?: string;
  } | null;
  patient?: {
    id: string;
    dateOfBirth?: Date;
    emergencyContact?: string;
  } | null;
  receptionist?: {
    id: string;
    department?: string;
  } | null;
  clinicAdmin?: {
    id: string;
    permissions?: string[];
  } | null;
  superAdmin?: {
    id: string;
    systemAccess?: boolean;
  } | null;
  receptionists?: Array<{
    id: string;
    department?: string;
    userId: string;
    clinicId: string | null;
    createdAt: Date;
  }>;
  clinicAdmins?: Array<{
    id: string;
    clinicId: string;
    userId: string;
    createdAt: Date;
    isOwner: boolean;
  }>;
}
import { RbacService } from "../../libs/core/rbac/rbac.service";
import {
  CreateUserDto,
  UserResponseDto,
  UpdateUserDto,
} from "../../libs/dtos/user.dto";
import { AuthService } from "../auth/auth.service";
import { HealthcareErrorsService } from "../../libs/core/errors";

@Injectable()
export class UsersService {
  private formatDateToString(date: Date | string | null | undefined): string {
    if (date instanceof Date) {
      return date.toISOString().split("T")[0] || "";
    }
    if (typeof date === "string") {
      return date;
    }
    return "";
  }
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService,
    private readonly rbacService: RbacService,
    private readonly authService: AuthService,
    private readonly errors: HealthcareErrorsService,
  ) {}

  async findAll(role?: Role): Promise<UserResponseDto[]> {
    const cacheKey = `users:all:${role || "all"}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const users = (await this.databaseService
          .getPrismaClient()
          .user.findMany({
            where: role ? { role } : undefined,
            include: {
              doctor: role === Role.DOCTOR,
              patient: role === Role.PATIENT,
              receptionists: role === Role.RECEPTIONIST,
              clinicAdmins: role === Role.CLINIC_ADMIN,
              superAdmin: role === Role.SUPER_ADMIN,
              pharmacist: role === Role.PHARMACIST,
              therapist: role === Role.THERAPIST,
              labTechnician: role === Role.LAB_TECHNICIAN,
              financeBilling: role === Role.FINANCE_BILLING,
              supportStaff: role === Role.SUPPORT_STAFF,
              nurse: role === Role.NURSE,
              counselor: role === Role.COUNSELOR,
            },
          })) as UserWithRelations[];

        const result = users.map(
          (userData: UserWithRelations): UserResponseDto => {
            const { password: _password, ...user } = userData;
            const userResponse: UserResponseDto = {
              id: user.id,
              email: user.email,
              firstName: user.firstName ?? "",
              lastName: user.lastName ?? "",
              role: user.role as Role,
              isVerified: user.isVerified,
              isActive: (user as any).isActive ?? true,
              createdAt: user.createdAt,
              updatedAt: user.updatedAt,
              phone: user.phone ?? "",
            };

            if (user.dateOfBirth) {
              userResponse.dateOfBirth = this.formatDateToString(
                user.dateOfBirth,
              );
            }
            return userResponse;
          },
        );

        return result;
      },
      {
        ttl: 1800, // 30 minutes
        tags: ["users", "user_lists", role ? `role:${role}` : "all_roles"],
        priority: "normal",
        enableSwr: true,
        compress: true, // Compress user lists
        containsPHI: true, // User lists contain PHI
      },
    );
  }

  async findOne(id: string): Promise<UserResponseDto> {
    const cacheKey = `users:one:${id}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const user = (await this.databaseService
          .getPrismaClient()
          .user.findUnique({
            where: { id },
            include: {
              doctor: true,
              patient: true,
              receptionists: true,
              clinicAdmins: true,
              superAdmin: true,
            },
          })) as UserWithRelations | null;

        if (!user) {
          throw new NotFoundException(`User with ID ${id} not found`);
        }

        const { password: _password, ...result } = user;
        const userResponse: UserResponseDto = {
          id: result.id,
          email: result.email,
          firstName: result.firstName ?? "",
          lastName: result.lastName ?? "",
          role: result.role as Role,
          isVerified: result.isVerified,
          isActive: (result as any).isActive ?? true,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
          phone: result.phone ?? "",
        };

        if (result.dateOfBirth) {
          userResponse.dateOfBirth = this.formatDateToString(
            result.dateOfBirth,
          );
        }

        return userResponse;
      },
      {
        ttl: 3600, // 1 hour
        tags: [`user:${id}`, "user_details"],
        priority: "high",
        enableSwr: true,
        compress: true, // Compress user details
        containsPHI: true, // User details contain PHI
      },
    );
  }

  /**
   * Get user profile with auth service integration
   */
  async getUserProfile(userId: string, clinicId?: string): Promise<unknown> {
    return this.authService.getUserProfile(userId, clinicId);
  }

  /**
   * Get user permissions with auth service integration
   */
  async getUserPermissions(userId: string, clinicId: string): Promise<unknown> {
    return this.authService.getUserPermissions(userId, clinicId);
  }

  /**
   * Change user password with auth service integration
   */
  async changeUserPassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    return this.authService.changePassword(userId, {
      currentPassword,
      newPassword,
      confirmPassword: newPassword, // Use same password for confirmation
    });
  }

  /**
   * Request password reset with auth service integration
   */
  async requestPasswordReset(email: string): Promise<{ message: string }> {
    return this.authService.requestPasswordReset({ email });
  }

  /**
   * Reset password with auth service integration
   */
  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    return this.authService.resetPassword({
      token,
      newPassword,
      confirmPassword: newPassword, // Use same password for confirmation
    });
  }

  async findByEmail(email: string): Promise<UserResponseDto | null> {
    const user = await this.databaseService.getPrismaClient().user.findFirst({
      where: {
        email: {
          mode: "insensitive",
          equals: email,
        },
      },
      include: {
        doctor: true,
        patient: true,
        receptionists: true,
        clinicAdmins: true,
        superAdmin: true,
      },
    });

    if (!user) {
      return null;
    }

    const { password: _password, ...result } = user;
    const userResponse: UserResponseDto = {
      id: result.id,
      email: result.email,
      firstName: result.firstName ?? "",
      lastName: result.lastName ?? "",
      role: result.role,
      isVerified: result.isVerified,
      isActive: result.isActive ?? true,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
      ...(result.dateOfBirth && {
        dateOfBirth: this.formatDateToString(result.dateOfBirth),
      }),
      phone: result.phone ?? "",
    };
    return userResponse;
  }

  async count(): Promise<number> {
    return await this.databaseService.getPrismaClient().user.count();
  }

  private async getNextNumericId(): Promise<string> {
    const COUNTER_KEY = "user:counter";
    const currentId = await this.cacheService.get(COUNTER_KEY);
    const nextId = currentId ? parseInt(currentId as string) + 1 : 1;
    await this.cacheService.set(COUNTER_KEY, nextId.toString());
    return `UID${nextId.toString().padStart(6, "0")}`;
  }

  async createUser(data: CreateUserDto): Promise<User> {
    try {
      // Use auth service for proper user registration with password hashing
      await this.authService.register({
        email: data.email,
        password: data.password,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role || "PATIENT",
        ...(data.clinicId && { clinicId: data.clinicId }),
        phone: data.phone,
      });

      // Get the created user from database
      const user = await this.databaseService
        .getPrismaClient()
        .user.findUnique({
          where: { email: data.email },
          include: {
            doctor: data.role === Role.DOCTOR,
            patient: data.role === Role.PATIENT,
            receptionists: data.role === Role.RECEPTIONIST,
            clinicAdmins: data.role === Role.CLINIC_ADMIN,
            superAdmin: data.role === Role.SUPER_ADMIN,
          },
        });

      if (!user) {
        throw new Error(
          "User creation failed - user not found after registration",
        );
      }

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "User created successfully with auth integration",
        "UsersService",
        {
          userId: user.id,
          email: data.email,
          role: data.role,
          clinicId: data.clinicId,
        },
      );
      await this.eventService.emit("user.created", {
        userId: user.id,
        email: data.email,
        role: data.role,
        clinicId: data.clinicId,
        authIntegrated: true,
      });
      await this.cacheService.invalidateCacheByTag("users");

      return user as User;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        "User creation failed",
        "UsersService",
        {
          error: errorMessage,
          email: data.email,
        },
      );
      throw error;
    }
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    if (!id || id === "undefined") {
      throw new BadRequestException("User ID is required");
    }
    try {
      // Check if user exists first

      const existingUser = await this.databaseService
        .getPrismaClient()
        .user.findUnique({
          where: { id },
          include: {
            doctor: true,
            patient: true,
            receptionists: true,
            clinicAdmins: true,
            superAdmin: true,
          },
        });

      if (!existingUser) {
        throw new NotFoundException(`User with ID ${id} not found`);
      }

      // Log the update attempt
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Attempting to update user",
        "UsersService",
        {
          userId: id,
          updateFields: Object.keys(updateUserDto),
          role: existingUser.role,
        },
      );

      // Clean up the data to prevent errors
      const cleanedData: Partial<UpdateUserDto> = { ...updateUserDto };

      // Prevent users from updating clinicId
      delete cleanedData.clinicId;

      // Handle date conversion properly
      if (
        cleanedData.dateOfBirth &&
        typeof cleanedData.dateOfBirth === "string"
      ) {
        try {
          // Keep as string for Prisma
          cleanedData.dateOfBirth = cleanedData.dateOfBirth;
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          void this.loggingService.log(
            LogType.ERROR,
            LogLevel.ERROR,
            "Invalid date format for dateOfBirth",
            "UsersService",
            {
              userId: id,
              dateOfBirth: cleanedData.dateOfBirth,
            },
          );
          throw new Error("Invalid date format for dateOfBirth");
        }
      }

      // Handle role-specific data updates
      if (existingUser.role === Role.DOCTOR && cleanedData.specialization) {
        // Ensure doctor record exists
        if (!existingUser.doctor) {
          await this.databaseService.getPrismaClient().doctor.create({
            data: {
              userId: id,
              specialization: cleanedData.specialization ?? "",
              experience:
                typeof cleanedData.experience === "string"
                  ? parseInt(cleanedData.experience) || 0
                  : 0,
            },
          });
        } else {
          await this.databaseService.getPrismaClient().doctor.update({
            where: { userId: id },
            data: {
              specialization:
                cleanedData.specialization ??
                existingUser.doctor.specialization,
              experience:
                typeof cleanedData.experience === "string"
                  ? parseInt(cleanedData.experience) ||
                    existingUser.doctor.experience
                  : existingUser.doctor.experience,
            },
          });
        }

        // Remove doctor-specific fields from main update
        delete cleanedData.specialization;
        delete cleanedData.experience;
      }

      // Update the user record
      const user = await this.databaseService.getPrismaClient().user.update({
        where: { id },
        data: cleanedData,
        include: {
          doctor: true,
          patient: true,
          receptionists: true,
          clinicAdmins: true,
          superAdmin: true,
        },
      });

      // Invalidate cache
      await Promise.all([
        this.cacheService.invalidateCache(`users:one:${id}`),
        this.cacheService.invalidateCacheByTag("users"),
        this.cacheService.invalidateCacheByTag(`user:${id}`),
      ]);

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "User updated successfully",
        "UsersService",
        { userId: id },
      );
      await this.eventService.emit("user.updated", {
        userId: id,
        data: updateUserDto,
      });

      const { password: _password, ...result } = user;
      const userResponse: UserResponseDto = {
        id: result.id,
        email: result.email,
        firstName: result.firstName ?? "",
        lastName: result.lastName ?? "",
        role: result.role,
        isVerified: result.isVerified,
        isActive: result.isActive ?? true,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
        ...(result.dateOfBirth && {
          dateOfBirth: this.formatDateToString(result.dateOfBirth),
        }),
        phone: result.phone ?? "",
      };
      return userResponse;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      // Log the error
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Error updating user: ${errorMessage}`,
        "UsersService",
        {
          userId: id,
          error: error instanceof Error ? error.stack : "",
        },
      );

      // Rethrow as appropriate exception
      if (
        error instanceof Error &&
        error.name === "PrismaClientKnownRequestError"
      ) {
        const prismaError = error as {
          code?: string;
          meta?: { target?: string };
        };
        if (prismaError.code === "P2025") {
          throw new NotFoundException(`User with ID ${id} not found`);
        } else if (prismaError.code === "P2002") {
          throw new ConflictException(
            `Unique constraint violation: ${prismaError.meta?.target}`,
          );
        }
      }

      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    const user = await this.databaseService.getPrismaClient().user.findUnique({
      where: { id },
      include: {
        doctor: true,
        patient: true,
        receptionists: true,
        clinicAdmins: true,
        superAdmin: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    // Delete role-specific record first
    if (user.role === Role.DOCTOR && user.doctor) {
      await this.databaseService.getPrismaClient().doctor.delete({
        where: { userId: id },
      });
    }
    if (user.role === Role.PATIENT && user.patient) {
      await this.databaseService.getPrismaClient().patient.delete({
        where: { userId: id },
      });
    }
    if (
      user.role === Role.RECEPTIONIST &&
      user.receptionists &&
      user.receptionists.length > 0
    ) {
      await this.databaseService.getPrismaClient().receptionist.delete({
        where: { userId: id },
      });
    }
    if (
      user.role === Role.CLINIC_ADMIN &&
      user.clinicAdmins &&
      user.clinicAdmins.length > 0
    ) {
      await this.databaseService.getPrismaClient().clinicAdmin.delete({
        where: { userId: id },
      });
    }
    if (user.role === Role.SUPER_ADMIN && user.superAdmin) {
      await this.databaseService.getPrismaClient().superAdmin.delete({
        where: { userId: id },
      });
    }

    // Delete user record

    await this.databaseService.getPrismaClient().user.delete({
      where: { id },
    });

    // Invalidate cache
    await Promise.all([
      this.cacheService.invalidateCache(`users:one:${id}`),
      this.cacheService.invalidateCacheByTag("users"),
      this.cacheService.invalidateCacheByTag(`user:${id}`),
    ]);

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      "User deleted successfully",
      "UsersService",
      { userId: id },
    );
    await this.eventService.emit("user.deleted", { userId: id });
  }

  private async logAuditEvent(
    userId: string,
    action: string,
    description: string,
  ): Promise<void> {
    await this.databaseService.getPrismaClient().auditLog.create({
      data: {
        id: undefined,
        userId,
        action,
        description,
        timestamp: new Date(),
        ipAddress: "127.0.0.1",
        device: "API",
      },
    });
  }

  // Role-specific methods
  async getDoctors(): Promise<UserResponseDto[]> {
    return this.findAll(Role.DOCTOR);
  }

  async getPatients(): Promise<UserResponseDto[]> {
    return this.findAll(Role.PATIENT);
  }

  async getReceptionists(): Promise<UserResponseDto[]> {
    return this.findAll(Role.RECEPTIONIST);
  }

  async getClinicAdmins(): Promise<UserResponseDto[]> {
    return this.findAll(Role.CLINIC_ADMIN);
  }

  async logout(
    userId: string,

    _sessionId?: string,

    _clinicId?: string,
  ): Promise<void> {
    // Check if user exists
    const user = await this.databaseService.getPrismaClient().user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    try {
      // Use auth service for proper logout with session management
      await this.authService.logout(userId);

      // Update last login timestamp

      await this.databaseService.getPrismaClient().user.update({
        where: { id: userId },
        data: {
          lastLogin: null,
        },
      });

      // Clear all user-related cache
      await Promise.all([
        this.cacheService.del(`users:one:${userId}`),
        this.cacheService.del(`users:all`),
        this.cacheService.del(`users:${user.role.toLowerCase()}`),
        this.cacheService.del(`user:sessions:${userId}`),
      ]);

      // Log the logout event
      await this.logAuditEvent(
        userId,
        "LOGOUT",
        "User logged out successfully",
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      // Log the error
      await this.logAuditEvent(
        userId,
        "LOGOUT_ERROR",
        `Logout failed: ${errorMessage}`,
      );

      // Re-throw the error
      throw error;
    }
  }

  async updateUserRole(
    id: string,
    role: Role,
    createUserDto: CreateUserDto,
  ): Promise<UserResponseDto> {
    const user = await this.databaseService.getPrismaClient().user.findUnique({
      where: { id },
      include: {
        doctor: true,
        patient: true,
        receptionists: true,
        clinicAdmins: true,
        superAdmin: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    // Delete old role-specific record
    if (user.role === Role.DOCTOR && user.doctor) {
      await this.databaseService.getPrismaClient().doctor.delete({
        where: { userId: id },
      });
    }
    if (user.role === Role.PATIENT && user.patient) {
      await this.databaseService.getPrismaClient().patient.delete({
        where: { userId: id },
      });
    }
    if (
      user.role === Role.RECEPTIONIST &&
      user.receptionists &&
      user.receptionists.length > 0
    ) {
      await this.databaseService.getPrismaClient().receptionist.delete({
        where: { userId: id },
      });
    }
    if (
      user.role === Role.CLINIC_ADMIN &&
      user.clinicAdmins &&
      user.clinicAdmins.length > 0
    ) {
      await this.databaseService.getPrismaClient().clinicAdmin.delete({
        where: { userId: id },
      });
    }
    if (user.role === Role.SUPER_ADMIN && user.superAdmin) {
      await this.databaseService.getPrismaClient().superAdmin.delete({
        where: { userId: id },
      });
    }

    // Create new role-specific record
    switch (role) {
      case Role.PATIENT:
        await this.databaseService.getPrismaClient().patient.create({
          data: { userId: id },
        });
        break;
      case Role.DOCTOR:
        await this.databaseService.getPrismaClient().doctor.create({
          data: {
            userId: id,
            specialization: "",
            experience: 0,
          },
        });
        break;
      case Role.RECEPTIONIST:
        await this.databaseService.getPrismaClient().receptionist.create({
          data: { userId: id },
        });
        break;
      case Role.CLINIC_ADMIN: {
        const clinics = await this.databaseService
          .getPrismaClient()
          .clinic.findMany({
            take: 1,
          });
        if (!clinics.length) {
          throw new Error("No clinic found. Please create a clinic first.");
        }

        await this.databaseService.getPrismaClient().clinicAdmin.create({
          data: {
            userId: id,
            clinicId: createUserDto.clinicId || clinics[0].id,
          },
        });
        break;
      }
      case Role.SUPER_ADMIN:
        await this.databaseService.getPrismaClient().superAdmin.create({
          data: { userId: id },
        });
        break;
    }

    // Update user role

    const updatedUser = await this.databaseService
      .getPrismaClient()
      .user.update({
        where: { id },
        data: { role },
        include: {
          doctor: true,
          patient: true,
          receptionists: true,
          clinicAdmins: true,
          superAdmin: true,
        },
      });

    // Invalidate cache
    await Promise.all([
      this.cacheService.invalidateCache(`users:one:${id}`),
      this.cacheService.invalidateCacheByTag("users"),
      this.cacheService.invalidateCacheByTag(`user:${id}`),
      this.cacheService.invalidateCacheByTag(
        `users:${user.role.toLowerCase()}`,
      ),
      this.cacheService.invalidateCacheByTag(`users:${role.toLowerCase()}`),
    ]);

    const { password: _password, ...result } = updatedUser;
    const userResponse: UserResponseDto = {
      id: result.id,
      email: result.email,
      firstName: result.firstName ?? "",
      lastName: result.lastName ?? "",
      role: result.role,
      isVerified: result.isVerified,
      isActive: result.isActive ?? true,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
      ...(result.dateOfBirth && {
        dateOfBirth: this.formatDateToString(result.dateOfBirth),
      }),
      phone: result.phone ?? "",
    };
    return userResponse;
  }
}
