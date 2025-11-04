import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events';
import { LogLevel, LogType } from '@core/types';
import type { UserProfile } from '@core/types';
import { isPrismaDatabaseError } from '@core/types/error.types';
import { Role } from '@core/types/enums.types';
import type { User } from '@core/types/database.types';
import { RbacService } from '@core/rbac/rbac.service';
import { CreateUserDto, UserResponseDto, UpdateUserDto } from '@dtos/user.dto';
import { AuthService } from '../auth/auth.service';
import { HealthcareErrorsService } from '@core/errors';

type UserWithRelations = User & {
  doctor?: {
    id: string;
    userId: string;
    specialization: string;
    experience: number;
  } | null;
  patient?: {
    id: string;
    userId: string;
  } | null;
  receptionists?: Array<{
    id: string;
    userId: string;
  }>;
  clinicAdmins?: Array<{
    id: string;
    userId: string;
    clinicId: string;
  }>;
  superAdmin?: {
    id: string;
    userId: string;
  } | null;
};

@Injectable()
export class UsersService {
  private formatDateToString(date: Date | string | null | undefined): string {
    if (date instanceof Date) {
      return date.toISOString().split('T')[0] || '';
    }
    if (typeof date === 'string') {
      return date;
    }
    return '';
  }
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService,
    private readonly rbacService: RbacService,
    private readonly authService: AuthService,
    private readonly errors: HealthcareErrorsService
  ) {}

  async findAll(role?: Role): Promise<UserResponseDto[]> {
    const cacheKey = `users:all:${role || 'all'}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        // Use executeHealthcareRead for optimized query with caching
        const users = (await this.databaseService.executeHealthcareRead(async client => {
          return await client.user.findMany({
            ...(role ? { where: { role } } : {}),
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
          });
        })) as unknown as UserWithRelations[];

        const result = users.map((userData: UserWithRelations): UserResponseDto => {
          const { password: _password, ...user } = userData;
          const userResponse: UserResponseDto = {
            id: user.id,
            email: user.email,
            firstName: user.firstName ?? '',
            lastName: user.lastName ?? '',
            role: user.role as Role,
            isVerified: user.isVerified,
            isActive: true, // User accounts are active by default
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            phone: user.phone ?? '',
          };

          if (user.dateOfBirth) {
            userResponse.dateOfBirth = this.formatDateToString(user.dateOfBirth);
          }
          return userResponse;
        });

        return result;
      },
      {
        ttl: 1800, // 30 minutes
        tags: ['users', 'user_lists', role ? `role:${role}` : 'all_roles'],
        priority: 'normal',
        enableSwr: true,
        compress: true, // Compress user lists
        containsPHI: true, // User lists contain PHI
      }
    );
  }

  async findOne(id: string): Promise<UserResponseDto> {
    const cacheKey = `users:one:${id}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        // Use findUserByIdSafe for optimized query with caching
        const userRaw = await this.databaseService.findUserByIdSafe(id);
        const user = userRaw as UserWithRelations | null;

        if (!user) {
          throw this.errors.userNotFound(id, 'UsersService.findOne');
        }

        const { password: _password, ...result } = user;
        const userResponse: UserResponseDto = {
          id: result.id,
          email: result.email,
          firstName: result.firstName ?? '',
          lastName: result.lastName ?? '',
          role: result.role as Role,
          isVerified: result.isVerified,
          isActive: true, // User accounts are active by default
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
          phone: result.phone ?? '',
        };

        if (result.dateOfBirth) {
          userResponse.dateOfBirth = this.formatDateToString(result.dateOfBirth);
        }

        return userResponse;
      },
      {
        ttl: 3600, // 1 hour
        tags: [`user:${id}`, 'user_details'],
        priority: 'high',
        enableSwr: true,
        compress: true, // Compress user details
        containsPHI: true, // User details contain PHI
      }
    );
  }

  /**
   * Get user profile with auth service integration
   */
  async getUserProfile(userId: string, clinicId?: string): Promise<UserProfile> {
    return this.authService.getUserProfile(userId, clinicId);
  }

  /**
   * Get user permissions with auth service integration
   */
  async getUserPermissions(userId: string, clinicId: string): Promise<string[]> {
    return this.authService.getUserPermissions(userId, clinicId);
  }

  /**
   * Change user password with auth service integration
   */
  async changeUserPassword(
    userId: string,
    currentPassword: string,
    newPassword: string
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
  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    return this.authService.resetPassword({
      token,
      newPassword,
      confirmPassword: newPassword, // Use same password for confirmation
    });
  }

  async findByEmail(email: string): Promise<UserResponseDto | null> {
    // Use findUserByEmailSafe for optimized query
    const userRaw = await this.databaseService.findUserByEmailSafe(email);
    if (!userRaw) {
      return null;
    }

    // Get with relations if needed
    const user = await this.databaseService.executeHealthcareRead(async client => {
      return await client.user.findFirst({
        where: {
          email: {
            mode: 'insensitive',
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
    });

    if (!user) {
      return null;
    }

    // Type-safe password removal with explicit type
    const userRecord = user as {
      id: string;
      email: string;
      firstName?: string | null;
      lastName?: string | null;
      role: string;
      isVerified: boolean;
      createdAt: Date;
      updatedAt: Date;
      dateOfBirth?: Date | string | null;
      phone?: string | null;
      password?: string;
    };
    const { password: _password, ...result } = userRecord;
    const userResponse: UserResponseDto = {
      id: result.id,
      email: result.email,
      firstName: result.firstName ?? '',
      lastName: result.lastName ?? '',
      role: result.role as Role,
      isVerified: result.isVerified,
      isActive: true, // User accounts are active by default
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
      ...(result.dateOfBirth && {
        dateOfBirth: this.formatDateToString(result.dateOfBirth),
      }),
      phone: result.phone ?? '',
    };
    return userResponse;
  }

  async count(): Promise<number> {
    // Use executeHealthcareRead for count query
    return await this.databaseService.executeHealthcareRead(async client => {
      return await client.user.count();
    });
  }

  private async getNextNumericId(): Promise<string> {
    const COUNTER_KEY = 'user:counter';
    const currentId = await this.cacheService.get(COUNTER_KEY);
    const nextId = currentId ? parseInt(currentId as string) + 1 : 1;
    await this.cacheService.set(COUNTER_KEY, nextId.toString());
    return `UID${nextId.toString().padStart(6, '0')}`;
  }

  async createUser(data: CreateUserDto, userId?: string, clinicId?: string): Promise<User> {
    // RBAC: Check permission to create users
    if (userId && clinicId) {
      const permissionCheck = await this.rbacService.checkPermission({
        userId,
        clinicId,
        resource: 'users',
        action: 'create',
      });
      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('UsersService.createUser');
      }
    }

    try {
      // Use auth service for proper user registration with password hashing
      await this.authService.register({
        email: data.email,
        password: data.password,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role || 'PATIENT',
        ...(data.clinicId && { clinicId: data.clinicId }),
        phone: data.phone,
      });

      // Get the created user from database using findUserByEmailSafe
      const userRaw = await this.databaseService.findUserByEmailSafe(data.email);
      // If we need relations, use executeHealthcareRead
      const user = userRaw
        ? await this.databaseService.executeHealthcareRead(async client => {
            return await client.user.findUnique({
              where: { id: userRaw.id },
              include: {
                doctor: data.role === Role.DOCTOR,
                patient: data.role === Role.PATIENT,
                receptionists: data.role === Role.RECEPTIONIST,
                clinicAdmins: data.role === Role.CLINIC_ADMIN,
                superAdmin: data.role === Role.SUPER_ADMIN,
              },
            });
          })
        : null;

      if (!user) {
        throw this.errors.userNotFound(undefined, 'UsersService.createUser');
      }

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'User created successfully with auth integration',
        'UsersService',
        {
          userId: user.id,
          email: data.email,
          role: data.role,
          clinicId: data.clinicId,
        }
      );
      await this.eventService.emit('user.created', {
        userId: user.id,
        email: data.email,
        role: data.role,
        clinicId: data.clinicId,
        authIntegrated: true,
      });
      await this.cacheService.invalidateCacheByTag('users');

      return user as unknown as User;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'User creation failed',
        'UsersService',
        {
          error: errorMessage,
          email: data.email,
        }
      );
      throw error;
    }
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
    userId?: string,
    clinicId?: string
  ): Promise<UserResponseDto> {
    if (!id || id === 'undefined') {
      throw new BadRequestException('User ID is required');
    }

    // RBAC: Check permission to update users
    if (userId && clinicId) {
      const permissionCheck = await this.rbacService.checkPermission({
        userId,
        clinicId,
        resource: 'users',
        action: 'update',
        resourceId: id,
      });
      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('UsersService.update');
      }
    }
    try {
      // Check if user exists first using findUserByIdSafe
      const existingUserRaw = await this.databaseService.findUserByIdSafe(id);
      // Get with relations if needed
      const existingUser = existingUserRaw
        ? await this.databaseService.executeHealthcareRead(async client => {
            return await client.user.findUnique({
              where: { id },
              include: {
                doctor: true,
                patient: true,
                receptionists: true,
                clinicAdmins: true,
                superAdmin: true,
              },
            });
          })
        : null;

      if (!existingUser) {
        throw this.errors.userNotFound(id, 'UsersService.update');
      }

      // Log the update attempt
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Attempting to update user',
        'UsersService',
        {
          userId: id,
          updateFields: Object.keys(updateUserDto),
          role: existingUser.role,
        }
      );

      // Clean up the data to prevent errors
      const cleanedData: Partial<UpdateUserDto> = { ...updateUserDto };

      // Prevent users from updating clinicId
      delete cleanedData.clinicId;

      // Handle date conversion properly
      if (cleanedData.dateOfBirth && typeof cleanedData.dateOfBirth === 'string') {
        try {
          // Keep as string for Prisma
          cleanedData.dateOfBirth = cleanedData.dateOfBirth;
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          void this.loggingService.log(
            LogType.ERROR,
            LogLevel.ERROR,
            'Invalid date format for dateOfBirth',
            'UsersService',
            {
              userId: id,
              dateOfBirth: cleanedData.dateOfBirth,
            }
          );
          throw this.errors.invalidDate(cleanedData.dateOfBirth?.toString(), 'UsersService.update');
        }
      }

      // Handle role-specific data updates
      if (existingUser.role === Role.DOCTOR && cleanedData.specialization) {
        const existingUserWithDoctor = existingUser as unknown as UserWithRelations;
        // Ensure doctor record exists using executeHealthcareWrite
        if (!existingUserWithDoctor.doctor) {
          await this.databaseService.executeHealthcareWrite(
            async client => {
              return await client.doctor.create({
                data: {
                  userId: id,
                  specialization: cleanedData.specialization ?? '',
                  experience:
                    typeof cleanedData.experience === 'string'
                      ? parseInt(cleanedData.experience) || 0
                      : 0,
                },
              });
            },
            {
              userId: id,
              clinicId: existingUser.primaryClinicId || '',
              resourceType: 'DOCTOR',
              operation: 'CREATE',
              resourceId: id,
              userRole: 'system',
              details: { specialization: cleanedData.specialization },
            }
          );
        } else if (existingUserWithDoctor.doctor) {
          const doctorData = existingUserWithDoctor.doctor;
          await this.databaseService.executeHealthcareWrite(
            async client => {
              return await client.doctor.update({
                where: { userId: id },
                data: {
                  specialization: cleanedData.specialization ?? doctorData.specialization,
                  experience:
                    typeof cleanedData.experience === 'string'
                      ? parseInt(cleanedData.experience) || doctorData.experience
                      : doctorData.experience,
                },
              });
            },
            {
              userId: id,
              clinicId: existingUser.primaryClinicId || '',
              resourceType: 'DOCTOR',
              operation: 'UPDATE',
              resourceId: id,
              userRole: 'system',
              details: { specialization: cleanedData.specialization },
            }
          );
        }

        // Remove doctor-specific fields from main update
        delete cleanedData.specialization;
        delete cleanedData.experience;
      }

      // Update the user record using updateUserSafe or executeHealthcareWrite
      await this.databaseService.updateUserSafe(id, cleanedData as never);
      // Fetch updated user with relations
      const user = (await this.databaseService.executeHealthcareRead(async client => {
        return await client.user.findUnique({
          where: { id },
          include: {
            doctor: true,
            patient: true,
            receptionists: true,
            clinicAdmins: true,
            superAdmin: true,
          },
        });
      })) as unknown as UserWithRelations;

      // Invalidate cache
      await Promise.all([
        this.cacheService.invalidateCache(`users:one:${id}`),
        this.cacheService.invalidateCacheByTag('users'),
        this.cacheService.invalidateCacheByTag(`user:${id}`),
      ]);

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'User updated successfully',
        'UsersService',
        { userId: id }
      );
      await this.eventService.emit('user.updated', {
        userId: id,
        data: updateUserDto,
      });

      // Type-safe password removal with explicit type
      const userRecord = user as {
        id: string;
        email: string;
        firstName?: string | null;
        lastName?: string | null;
        role: string;
        isVerified: boolean;
        createdAt: Date;
        updatedAt: Date;
        dateOfBirth?: Date | string | null;
        phone?: string | null;
        password?: string;
      };
      const { password: _password, ...result } = userRecord;
      const userResponse: UserResponseDto = {
        id: result.id,
        email: result.email,
        firstName: result.firstName ?? '',
        lastName: result.lastName ?? '',
        role: result.role as Role,
        isVerified: result.isVerified,
        isActive: true, // User accounts are active by default
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
        ...(result.dateOfBirth && {
          dateOfBirth: this.formatDateToString(result.dateOfBirth),
        }),
        phone: result.phone ?? '',
      };
      return userResponse;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      // Log the error
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Error updating user: ${errorMessage}`,
        'UsersService',
        {
          userId: id,
          error: error instanceof Error ? error.stack : '',
        }
      );

      // Rethrow as appropriate exception using HealthcareErrorsService
      if (isPrismaDatabaseError(error)) {
        if (error.code === 'P2025') {
          // Record not found
          throw this.errors.userNotFound(id, 'UsersService.update');
        } else if (error.code === 'P2002') {
          // Unique constraint violation
          const target = Array.isArray(error.meta?.target)
            ? error.meta.target.join(', ')
            : error.meta?.target || 'unknown';
          if (target.includes('email')) {
            throw this.errors.emailAlreadyExists(updateUserDto.email || '', 'UsersService.update');
          }
          throw this.errors.userAlreadyExists(undefined, 'UsersService.update');
        }
      }

      throw error;
    }
  }

  async remove(id: string, userId?: string, clinicId?: string): Promise<void> {
    // RBAC: Check permission to delete users
    if (userId && clinicId) {
      const permissionCheck = await this.rbacService.checkPermission({
        userId,
        clinicId,
        resource: 'users',
        action: 'delete',
        resourceId: id,
      });
      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('UsersService.remove');
      }
    }

    // Use findUserByIdSafe first, then get with relations
    const userRaw = await this.databaseService.findUserByIdSafe(id);
    if (!userRaw) {
      throw this.errors.userNotFound(id, 'UsersService.remove');
    }

    // Get user with relations for role-specific deletion
    const user = (await this.databaseService.executeHealthcareRead(async client => {
      return await client.user.findUnique({
        where: { id },
        include: {
          doctor: true,
          patient: true,
          receptionists: true,
          clinicAdmins: true,
          superAdmin: true,
        },
      });
    })) as unknown as UserWithRelations;

    if (!user) {
      throw this.errors.userNotFound(id, 'UsersService.remove');
    }

    // Delete role-specific records using executeHealthcareWrite with audit info
    const userWithRelations = user;
    const auditInfo = {
      userId: id,
      clinicId: user.primaryClinicId || '',
      resourceType: 'USER',
      operation: 'DELETE',
      resourceId: id,
      userRole: 'system',
      details: { role: user.role },
    };

    if (user.role === Role.DOCTOR && userWithRelations.doctor) {
      await this.databaseService.executeHealthcareWrite(
        async client => {
          return await client.doctor.delete({
            where: { userId: id },
          });
        },
        { ...auditInfo, resourceType: 'DOCTOR' }
      );
    }
    if (user.role === Role.PATIENT && userWithRelations.patient) {
      await this.databaseService.executeHealthcareWrite(
        async client => {
          return await client.patient.delete({
            where: { userId: id },
          });
        },
        { ...auditInfo, resourceType: 'PATIENT' }
      );
    }
    if (
      user.role === Role.RECEPTIONIST &&
      userWithRelations.receptionists &&
      userWithRelations.receptionists.length > 0
    ) {
      await this.databaseService.executeHealthcareWrite(
        async client => {
          return await client.receptionist.delete({
            where: { userId: id },
          });
        },
        { ...auditInfo, resourceType: 'RECEPTIONIST' }
      );
    }
    if (
      user.role === Role.CLINIC_ADMIN &&
      userWithRelations.clinicAdmins &&
      userWithRelations.clinicAdmins.length > 0
    ) {
      await this.databaseService.executeHealthcareWrite(
        async client => {
          return await client.clinicAdmin.delete({
            where: { userId: id },
          });
        },
        { ...auditInfo, resourceType: 'CLINIC_ADMIN' }
      );
    }
    if (user.role === Role.SUPER_ADMIN && userWithRelations.superAdmin) {
      await this.databaseService.executeHealthcareWrite(
        async client => {
          return await client.superAdmin.delete({
            where: { userId: id },
          });
        },
        { ...auditInfo, resourceType: 'SUPER_ADMIN' }
      );
    }

    // Delete user record using deleteUserSafe
    await this.databaseService.deleteUserSafe(id);

    // Invalidate cache
    await Promise.all([
      this.cacheService.invalidateCache(`users:one:${id}`),
      this.cacheService.invalidateCacheByTag('users'),
      this.cacheService.invalidateCacheByTag(`user:${id}`),
    ]);

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'User deleted successfully',
      'UsersService',
      { userId: id }
    );
    await this.eventService.emit('user.deleted', { userId: id });
  }

  private async logAuditEvent(userId: string, action: string, description: string): Promise<void> {
    // Use executeHealthcareWrite for audit log creation
    // Note: Using fields that match the Prisma AuditLog schema (updated with resourceType, resourceId, metadata, userAgent)
    await this.databaseService.executeHealthcareWrite(
      async client => {
        await client.auditLog.create({
          data: {
            userId,
            action,
            description: description || '',
            timestamp: new Date(),
          },
        });
      },
      {
        userId,
        clinicId: '',
        resourceType: 'AUDIT_LOG',
        operation: 'CREATE',
        resourceId: '',
        userRole: 'system',
        details: { action, description },
      }
    );
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

    _clinicId?: string
  ): Promise<void> {
    // Check if user exists using findUserByIdSafe
    const user = await this.databaseService.findUserByIdSafe(userId);

    if (!user) {
      throw this.errors.userNotFound(userId, 'UsersService.logout');
    }

    try {
      // Use auth service for proper logout with session management
      await this.authService.logout(userId);

      // Update last login timestamp using updateUserSafe
      await this.databaseService.updateUserSafe(userId, {
        lastLogin: null,
      } as never);

      // Clear all user-related cache
      await Promise.all([
        this.cacheService.del(`users:one:${userId}`),
        this.cacheService.del(`users:all`),
        this.cacheService.del(`users:${user.role.toLowerCase()}`),
        this.cacheService.del(`user:sessions:${userId}`),
      ]);

      // Log the logout event
      await this.logAuditEvent(userId, 'LOGOUT', 'User logged out successfully');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      // Log the error
      await this.logAuditEvent(userId, 'LOGOUT_ERROR', `Logout failed: ${errorMessage}`);

      // Re-throw the error
      throw error;
    }
  }

  async updateUserRole(
    id: string,
    role: Role,
    createUserDto: CreateUserDto,
    userId?: string,
    clinicId?: string
  ): Promise<UserResponseDto> {
    // RBAC: Check permission to update user roles (requires admin permissions)
    if (userId && clinicId) {
      const permissionCheck = await this.rbacService.checkPermission({
        userId,
        clinicId,
        resource: 'users',
        action: 'updateRole',
        resourceId: id,
      });
      if (!permissionCheck.hasPermission) {
        throw this.errors.insufficientPermissions('UsersService.updateUserRole');
      }
    }

    // Use findUserByIdSafe first, then get with relations
    const userRawCheck = await this.databaseService.findUserByIdSafe(id);
    if (!userRawCheck) {
      throw this.errors.userNotFound(id, 'UsersService.updateUserRole');
    }

    const userRaw = await this.databaseService.executeHealthcareRead(async client => {
      return await client.user.findUnique({
        where: { id },
        include: {
          doctor: true,
          patient: true,
          receptionists: true,
          clinicAdmins: true,
          superAdmin: true,
        },
      });
    });

    if (!userRaw) {
      throw this.errors.userNotFound(id, 'UsersService.updateUserRole');
    }

    const user = userRaw as unknown as UserWithRelations;

    // Delete old role-specific records using executeHealthcareWrite
    const auditInfo = {
      userId: id,
      clinicId: user.primaryClinicId || '',
      resourceType: 'USER',
      operation: 'UPDATE',
      resourceId: id,
      userRole: 'system',
      details: { oldRole: user.role, newRole: role },
    };

    if (user.role === Role.DOCTOR && user.doctor) {
      await this.databaseService.executeHealthcareWrite(
        async client => {
          return await client.doctor.delete({
            where: { userId: id },
          });
        },
        { ...auditInfo, resourceType: 'DOCTOR' }
      );
    }
    if (user.role === Role.PATIENT && user.patient) {
      await this.databaseService.executeHealthcareWrite(
        async client => {
          return await client.patient.delete({
            where: { userId: id },
          });
        },
        { ...auditInfo, resourceType: 'PATIENT' }
      );
    }
    if (user.role === Role.RECEPTIONIST && user.receptionists && user.receptionists.length > 0) {
      await this.databaseService.executeHealthcareWrite(
        async client => {
          return await client.receptionist.delete({
            where: { userId: id },
          });
        },
        { ...auditInfo, resourceType: 'RECEPTIONIST' }
      );
    }
    if (user.role === Role.CLINIC_ADMIN && user.clinicAdmins && user.clinicAdmins.length > 0) {
      await this.databaseService.executeHealthcareWrite(
        async client => {
          return await client.clinicAdmin.delete({
            where: { userId: id },
          });
        },
        { ...auditInfo, resourceType: 'CLINIC_ADMIN' }
      );
    }
    if (user.role === Role.SUPER_ADMIN && user.superAdmin) {
      await this.databaseService.executeHealthcareWrite(
        async client => {
          return await client.superAdmin.delete({
            where: { userId: id },
          });
        },
        { ...auditInfo, resourceType: 'SUPER_ADMIN' }
      );
    }

    // Create new role-specific records using executeHealthcareWrite
    const createAuditInfo = {
      userId: id,
      clinicId: user.primaryClinicId || '',
      resourceType: 'USER',
      operation: 'CREATE',
      resourceId: id,
      userRole: 'system',
      details: { newRole: role },
    };

    switch (role) {
      case Role.PATIENT:
        await this.databaseService.executeHealthcareWrite(
          async client => {
            return await client.patient.create({
              data: { userId: id },
            });
          },
          { ...createAuditInfo, resourceType: 'PATIENT' }
        );
        break;
      case Role.DOCTOR:
        await this.databaseService.executeHealthcareWrite(
          async client => {
            return await client.doctor.create({
              data: {
                userId: id,
                specialization: '',
                experience: 0,
              },
            });
          },
          { ...createAuditInfo, resourceType: 'DOCTOR' }
        );
        break;
      case Role.RECEPTIONIST:
        await this.databaseService.executeHealthcareWrite(
          async client => {
            return await client.receptionist.create({
              data: { userId: id },
            });
          },
          { ...createAuditInfo, resourceType: 'RECEPTIONIST' }
        );
        break;
      case Role.CLINIC_ADMIN: {
        // Get clinics using executeHealthcareRead
        const clinics = await this.databaseService.executeHealthcareRead(async client => {
          return await client.clinic.findMany({
            take: 1,
          });
        });
        if (!clinics || clinics.length === 0) {
          throw this.errors.clinicNotFound(undefined, 'UsersService.updateUserRole');
        }

        const targetClinicId = createUserDto.clinicId || (clinics[0]?.id ?? '');
        if (!targetClinicId) {
          throw this.errors.clinicNotFound(undefined, 'UsersService.updateUserRole');
        }

        await this.databaseService.executeHealthcareWrite(
          async client => {
            return await client.clinicAdmin.create({
              data: {
                userId: id,
                clinicId: targetClinicId,
              },
            });
          },
          {
            ...createAuditInfo,
            resourceType: 'CLINIC_ADMIN',
            clinicId: targetClinicId,
          }
        );
        break;
      }
      case Role.SUPER_ADMIN:
        await this.databaseService.executeHealthcareWrite(
          async client => {
            return await client.superAdmin.create({
              data: { userId: id },
            });
          },
          { ...createAuditInfo, resourceType: 'SUPER_ADMIN' }
        );
        break;
    }

    // Update user role using updateUserSafe
    await this.databaseService.updateUserSafe(id, { role } as never);
    // Fetch updated user with relations
    const updatedUser = await this.databaseService.executeHealthcareRead(async client => {
      return await client.user.findUnique({
        where: { id },
        include: {
          doctor: true,
          patient: true,
          receptionists: true,
          clinicAdmins: true,
          superAdmin: true,
        },
      });
    });

    // Invalidate cache
    await Promise.all([
      this.cacheService.invalidateCache(`users:one:${id}`),
      this.cacheService.invalidateCacheByTag('users'),
      this.cacheService.invalidateCacheByTag(`user:${id}`),
      this.cacheService.invalidateCacheByTag(`users:${user?.role?.toLowerCase() ?? 'unknown'}`),
      this.cacheService.invalidateCacheByTag(`users:${role.toLowerCase()}`),
    ]);

    if (!updatedUser) {
      throw this.errors.userNotFound(id, 'UsersService.updateUserRole');
    }

    // Type-safe password removal with explicit type
    const userRecord = updatedUser as {
      id: string;
      email: string;
      firstName?: string | null;
      lastName?: string | null;
      role: string;
      isVerified: boolean;
      createdAt: Date;
      updatedAt: Date;
      dateOfBirth?: Date | string | null;
      phone?: string | null;
      password?: string;
    };
    const { password: _password, ...result } = userRecord;
    const userResponse: UserResponseDto = {
      id: result.id,
      email: result.email,
      firstName: result.firstName ?? '',
      lastName: result.lastName ?? '',
      role: result.role as Role,
      isVerified: result.isVerified,
      isActive: true, // User accounts are active by default
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
      ...(result.dateOfBirth && {
        dateOfBirth: this.formatDateToString(result.dateOfBirth),
      }),
      phone: result.phone ?? '',
    };
    return userResponse;
  }
}
