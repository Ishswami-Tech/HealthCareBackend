import { Injectable, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events';
import { LogLevel, LogType, type IEventService, isEventService } from '@core/types';

import type { UserProfile } from '@core/types';
import { isPrismaDatabaseError } from '@core/types/infrastructure.types';
import { Role } from '@core/types/enums.types';
import type { User } from '@core/types/database.types';
import { RbacService } from '@core/rbac/rbac.service';
import { CreateUserDto, UserResponseDto, UpdateUserDto } from '@dtos/user.dto';
import { AuthService } from '@services/auth/auth.service';
import { HealthcareErrorsService } from '@core/errors';
import type {
  PrismaTransactionClientWithDelegates,
  PrismaDelegateArgs,
} from '@core/types/prisma.types';
import type { UserUpdateInput } from '@core/types/input.types';
import type {
  Doctor,
  Patient,
  Receptionist,
  ClinicAdmin,
  SuperAdmin,
  AuditLog,
  Clinic,
} from '@core/types';

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
  locationHead?: {
    id: string;
    userId: string;
    clinicId: string;
    locationId: string | null;
  } | null;
  [key: string]: unknown;
};

@Injectable()
export class UsersService {
  private readonly eventService: IEventService;

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
    @Inject(forwardRef(() => EventService))
    eventService: unknown,
    private readonly rbacService: RbacService,
    private readonly authService: AuthService,
    private readonly errors: HealthcareErrorsService
  ) {
    // Type guard ensures type safety when using the service
    // This handles forwardRef circular dependency type resolution issues
    if (!isEventService(eventService)) {
      throw new Error('EventService is not available or invalid');
    }
    this.eventService = eventService;
  }

  async findAll(role?: Role): Promise<UserResponseDto[]> {
    const cacheKey = `users:all:${role || 'all'}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        // Use executeHealthcareRead for optimized query with caching
        const users = await this.databaseService.executeHealthcareRead<
          Array<{
            id: string;
            email: string;
            name: string | null;
            role: string;
            [key: string]: unknown;
          }>
        >(async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          const result = await typedClient.user.findMany({
            ...(role ? { where: { role } } : {}),
            include: {
              doctor: role === Role.DOCTOR || role === Role.ASSISTANT_DOCTOR,
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
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
          return result as unknown as Array<{
            id: string;
            email: string;
            name: string | null;
            role: string;
            [key: string]: unknown;
          }>;
        });

        const result = (users as unknown as UserWithRelations[]).map(
          (userData: UserWithRelations): UserResponseDto => {
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
          }
        );

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
    const user = await this.databaseService.executeHealthcareRead<{
      id: string;
      email: string;
      [key: string]: unknown;
    } | null>(async client => {
      const result = await (
        client as {
          user: {
            findFirst: (args: unknown) => Promise<{
              id: string;
              email: string;
              [key: string]: unknown;
            } | null>;
          };
        }
      )['user'].findFirst({
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
      return result;
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
    return await this.databaseService.executeHealthcareRead<number>(async client => {
      const result = await (client as { user: { count: () => Promise<number> } })['user'].count();
      return result;
    });
  }

  private async getNextNumericId(): Promise<string> {
    const COUNTER_KEY = 'user:counter';
    const currentId = await this.cacheService.get(COUNTER_KEY);
    const nextId = currentId ? parseInt(currentId as string) + 1 : 1;
    await this.cacheService.set(COUNTER_KEY, nextId.toString());
    return `UID${nextId.toString().padStart(6, '0')}`;
  }

  async createUser(
    data: CreateUserDto,
    userId?: string,
    clinicId?: string
  ): Promise<UserResponseDto> {
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
      // clinicId is required in RegisterDto, so use data.clinicId or the parameter clinicId
      const userClinicId = data.clinicId || clinicId;
      if (!userClinicId) {
        throw new Error('Clinic ID is required for user registration');
      }
      await this.authService.register({
        email: data.email,
        password: data.password,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role || 'PATIENT',
        clinicId: userClinicId,
        phone: data.phone,
      });

      // Get the created user from database using findUserByEmailSafe
      const userRaw = await this.databaseService.findUserByEmailSafe(data.email);
      // If we need relations, use executeHealthcareRead
      const user = userRaw
        ? await this.databaseService.executeHealthcareRead<{
            id: string;
            email: string;
            [key: string]: unknown;
          } | null>(async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            const result = await typedClient.user.findUnique({
              where: { id: userRaw.id } as PrismaDelegateArgs,
              include: {
                doctor: data.role === Role.DOCTOR || data.role === Role.ASSISTANT_DOCTOR,
                patient: data.role === Role.PATIENT,
                receptionists: data.role === Role.RECEPTIONIST,
                clinicAdmins: data.role === Role.CLINIC_ADMIN,
                superAdmin: data.role === Role.SUPER_ADMIN,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
            return result as {
              id: string;
              email: string;
              [key: string]: unknown;
            } | null;
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

      // Map to UserResponseDto
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

      const userResponse: UserResponseDto = {
        id: userRecord.id,
        email: userRecord.email,
        firstName: userRecord.firstName ?? '',
        lastName: userRecord.lastName ?? '',
        role: userRecord.role as Role,
        isVerified: userRecord.isVerified,
        isActive: true, // User accounts are active by default
        createdAt: userRecord.createdAt,
        updatedAt: userRecord.updatedAt,
        phone: userRecord.phone ?? '',
      };

      if (userRecord.dateOfBirth) {
        userResponse.dateOfBirth = this.formatDateToString(userRecord.dateOfBirth);
      }

      return userResponse;
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
          type: 'createUser_error',
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
        ? await this.databaseService.executeHealthcareRead<{
            id: string;
            email: string;
            [key: string]: unknown;
          } | null>(async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            const result = await typedClient.user.findUnique({
              where: { id } as PrismaDelegateArgs,
              include: {
                doctor: true,
                patient: true,
                receptionists: true,
                clinicAdmins: true,
                superAdmin: true,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
            return result as {
              id: string;
              email: string;
              [key: string]: unknown;
            } | null;
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
          role: (existingUser as { role?: string })['role'] || '',
        }
      );

      // Clean up the data to prevent errors
      const cleanedData: Partial<UpdateUserDto> = { ...updateUserDto };

      // Prevent users from updating clinicId
      delete cleanedData.clinicId;

      // Handle date conversion properly and calculate age
      if (cleanedData.dateOfBirth && typeof cleanedData.dateOfBirth === 'string') {
        try {
          // Validate date format - keep as string for Prisma
          const dateValue = cleanedData.dateOfBirth;
          const birthDate = new Date(dateValue);

          if (isNaN(birthDate.getTime())) {
            throw new Error('Invalid date');
          }

          // Calculate age
          const today = new Date();
          let age = today.getFullYear() - birthDate.getFullYear();
          const m = today.getMonth() - birthDate.getMonth();
          if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
            age--;
          }

          // Add age to payload using type-safe extension
          (cleanedData as UpdateUserDto & { age: number }).age = age;

          // Fix: Convert string to Date object for Prisma
          // Prisma requires Date objects for DateTime fields, passing string causes 500 error
          Object.assign(cleanedData, { dateOfBirth: birthDate });
        } catch (_error: unknown) {
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
      if (
        (existingUser as { role?: string })['role'] === Role.DOCTOR &&
        cleanedData.specialization
      ) {
        const existingUserWithDoctor = existingUser as unknown as UserWithRelations;
        // Ensure doctor record exists using executeHealthcareWrite
        if (!existingUserWithDoctor.doctor) {
          await this.databaseService.executeHealthcareWrite<{
            id: string;
            userId: string;
            [key: string]: unknown;
          }>(
            async client => {
              return await (
                client as {
                  doctor: {
                    create: (
                      args: unknown
                    ) => Promise<{ id: string; userId: string; [key: string]: unknown }>;
                  };
                }
              )['doctor'].create({
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
              clinicId: String(
                (existingUser as { primaryClinicId?: string | null })['primaryClinicId'] || ''
              ),
              resourceType: 'DOCTOR',
              operation: 'CREATE',
              resourceId: id,
              userRole: 'system',
              details: { specialization: cleanedData.specialization },
            }
          );
        } else if (existingUserWithDoctor.doctor) {
          const doctorData = existingUserWithDoctor.doctor;
          await this.databaseService.executeHealthcareWrite<Doctor>(
            async client => {
              const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
              return await typedClient.doctor.update({
                where: { userId: id } as PrismaDelegateArgs,
                data: {
                  specialization: cleanedData.specialization ?? doctorData.specialization,
                  experience:
                    typeof cleanedData.experience === 'string'
                      ? parseInt(cleanedData.experience) || doctorData.experience
                      : doctorData.experience,
                } as PrismaDelegateArgs,
              } as PrismaDelegateArgs);
            },
            {
              userId: id,
              clinicId: String(
                (existingUser as { primaryClinicId?: string | null })['primaryClinicId'] || ''
              ),
              resourceType: 'DOCTOR',
              operation: 'UPDATE',
              resourceId: id,
              userRole: 'system',
              details: { specialization: cleanedData.specialization },
            }
          );
        }

        delete cleanedData.specialization;
        delete cleanedData.experience;
      }

      // Handle Emergency Contact (Relation)
      if (cleanedData['emergencyContact']) {
        const emergencyContactData = cleanedData['emergencyContact'] as {
          name: string;
          relationship: string;
          phone: string;
          alternatePhone?: string;
          address?: string;
        };

        await this.databaseService.executeHealthcareWrite(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            // Find existing contact
            const existingContacts = await typedClient.emergencyContact.findMany({
              where: { userId: id } as PrismaDelegateArgs,
            });

            if (existingContacts.length > 0) {
              // Update the first one
              await typedClient.emergencyContact.update({
                where: { id: existingContacts[0]!.id } as PrismaDelegateArgs,
                data: {
                  name: emergencyContactData.name,
                  relationship: emergencyContactData.relationship,
                  phone: emergencyContactData.phone,
                  alternatePhone: emergencyContactData.alternatePhone,
                  address: emergencyContactData.address,
                } as PrismaDelegateArgs,
              } as PrismaDelegateArgs);
            } else {
              // Create new
              await typedClient.emergencyContact.create({
                data: {
                  userId: id,
                  name: emergencyContactData.name,
                  relationship: emergencyContactData.relationship,
                  phone: emergencyContactData.phone,
                  alternatePhone: emergencyContactData.alternatePhone,
                  address: emergencyContactData.address,
                } as PrismaDelegateArgs,
              } as PrismaDelegateArgs);
            }
          },
          {
            userId: id,
            clinicId: String(
              (existingUser as { primaryClinicId?: string | null })['primaryClinicId'] || ''
            ),
            resourceType: 'EMERGENCY_CONTACT',
            operation: 'UPSERT',
            resourceId: id,
            userRole: 'system',
            details: { emergencyContact: emergencyContactData },
          }
        );

        // Remove from user update data to avoid schema mismatch (User model has emergencyContact string?)
        // Schema has emergencyContact: String? AND emergencyContacts: EmergencyContact[].
        // We want to use the relation. But we should also perhaps clear strict checking or ensure we don't pass object to string field.
        delete cleanedData['emergencyContact'];
      }

      // Update the user record using updateUserSafe or executeHealthcareWrite
      // Map UpdateUserProfileDto to UserUpdateInput, converting Gender enum to string and filtering undefined
      const userUpdateData = Object.fromEntries(
        Object.entries({
          firstName: cleanedData.firstName,
          lastName: cleanedData.lastName,
          phone: cleanedData.phone,
          dateOfBirth: cleanedData.dateOfBirth,
          gender: cleanedData.gender ? String(cleanedData.gender) : undefined,
          address: cleanedData.address,
          city: cleanedData.city,
          state: cleanedData.state,
          country: cleanedData.country,
          profilePicture: cleanedData.profilePicture,
        }).filter(([_, v]) => v !== undefined)
      ) as UserUpdateInput;
      await this.databaseService.updateUserSafe(id, userUpdateData);
      // Fetch updated user with relations
      const user = (await this.databaseService.executeHealthcareRead<{
        id: string;
        email: string;
        [key: string]: unknown;
      } | null>(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        const result = await typedClient.user.findUnique({
          where: { id } as PrismaDelegateArgs,
          include: {
            doctor: true,
            patient: true,
            receptionists: true,
            clinicAdmins: true,
            superAdmin: true,
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        return result as {
          id: string;
          email: string;
          [key: string]: unknown;
        } | null;
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
    const user = (await this.databaseService.executeHealthcareRead<{
      id: string;
      email: string;
      [key: string]: unknown;
    } | null>(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      const result = await typedClient.user.findUnique({
        where: { id } as PrismaDelegateArgs,
        include: {
          doctor: true,
          patient: true,
          receptionists: true,
          clinicAdmins: true,
          superAdmin: true,
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
      return result as {
        id: string;
        email: string;
        [key: string]: unknown;
      } | null;
    })) as unknown as UserWithRelations;

    if (!user) {
      throw this.errors.userNotFound(id, 'UsersService.remove');
    }

    // Delete role-specific records using executeHealthcareWrite with audit info
    const userWithRelations = user;
    const auditInfo = {
      userId: id,
      clinicId: String((user as { primaryClinicId?: string | null })['primaryClinicId'] || ''),
      resourceType: 'USER',
      operation: 'DELETE',
      resourceId: id,
      userRole: 'system',
      details: { role: user.role },
    };

    if (
      ((user.role as Role) === Role.DOCTOR || (user.role as Role) === Role.ASSISTANT_DOCTOR) &&
      userWithRelations.doctor
    ) {
      await this.databaseService.executeHealthcareWrite<Doctor>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.doctor.delete({
            where: { userId: id } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        { ...auditInfo, resourceType: 'DOCTOR' }
      );
    }
    if ((user.role as Role) === Role.PATIENT && userWithRelations.patient) {
      await this.databaseService.executeHealthcareWrite<Patient>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.patient.delete({
            where: { userId: id } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        { ...auditInfo, resourceType: 'PATIENT' }
      );
    }
    if (
      (user.role as Role) === Role.RECEPTIONIST &&
      userWithRelations.receptionists &&
      userWithRelations.receptionists.length > 0
    ) {
      await this.databaseService.executeHealthcareWrite<Receptionist>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.receptionist.delete({
            where: { userId: id } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        { ...auditInfo, resourceType: 'RECEPTIONIST' }
      );
    }
    if (
      (user.role as Role) === Role.CLINIC_ADMIN &&
      userWithRelations.clinicAdmins &&
      userWithRelations.clinicAdmins.length > 0
    ) {
      await this.databaseService.executeHealthcareWrite<ClinicAdmin>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.clinicAdmin.delete({
            where: { userId: id } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        { ...auditInfo, resourceType: 'CLINIC_ADMIN' }
      );
    }
    if ((user.role as Role) === Role.SUPER_ADMIN && userWithRelations.superAdmin) {
      await this.databaseService.executeHealthcareWrite<SuperAdmin>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.superAdmin.delete({
            where: { userId: id } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
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
    await this.databaseService.executeHealthcareWrite<AuditLog>(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        return await typedClient.auditLog.create({
          data: {
            userId,
            action,
            description: description || '',
            timestamp: new Date(),
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
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
    // RBAC: Check permission to update user roles
    if (userId) {
      const permClinicId = clinicId || createUserDto.clinicId;
      const permissionCheck = await this.rbacService.checkPermission({
        userId,
        clinicId: permClinicId || '',
        resource: 'users',
        action: 'update',
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

    const userRaw = await this.databaseService.executeHealthcareRead<{
      id: string;
      email: string;
      [key: string]: unknown;
    } | null>(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      const result = await typedClient.user.findUnique({
        where: { id } as PrismaDelegateArgs,
        include: {
          doctor: { include: { clinics: true } },
          patient: true,
          receptionists: true,
          clinicAdmins: true,
          superAdmin: true,
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
      return result as {
        id: string;
        email: string;
        [key: string]: unknown;
      } | null;
    });

    if (!userRaw) {
      throw this.errors.userNotFound(id, 'UsersService.updateUserRole');
    }

    const user = userRaw as unknown as UserWithRelations;

    // Clinic Admin scope: can only assign roles to users in their clinic, and only to assignable staff roles
    const clinicAdminAssignableRoles = [
      Role.DOCTOR,
      Role.ASSISTANT_DOCTOR,
      Role.RECEPTIONIST,
      Role.PHARMACIST,
      Role.NURSE,
    ];
    if (clinicId) {
      const targetPrimaryClinic = (user as { primaryClinicId?: string | null })['primaryClinicId'];
      const docClinics = (user.doctor as { clinics?: Array<{ clinicId: string }> } | undefined)
        ?.clinics;
      const belongsToClinic =
        targetPrimaryClinic === clinicId ||
        (Array.isArray(user.clinicAdmins) &&
          user.clinicAdmins.some((ca: { clinicId: string }) => ca.clinicId === clinicId)) ||
        (user.receptionists as { clinicId?: string } | null)?.clinicId === clinicId ||
        docClinics?.some((c: { clinicId: string }) => c.clinicId === clinicId);
      if (!belongsToClinic) {
        throw this.errors.insufficientPermissions(
          'UsersService.updateUserRole - User does not belong to your clinic'
        );
      }
      if (!clinicAdminAssignableRoles.includes(role)) {
        throw this.errors.validationError(
          'role',
          `Clinic Admin can only assign: ${clinicAdminAssignableRoles.join(', ')}`,
          'UsersService.updateUserRole'
        );
      }
    }

    // Define staff roles that require locationId (for future location validation if needed)
    const _staffRoles = [
      Role.DOCTOR,
      Role.ASSISTANT_DOCTOR,
      Role.RECEPTIONIST,
      Role.CLINIC_ADMIN,
      Role.PHARMACIST,
      Role.THERAPIST,
      Role.LAB_TECHNICIAN,
      Role.FINANCE_BILLING,
      Role.SUPPORT_STAFF,
      Role.NURSE,
      Role.COUNSELOR,
      Role.LOCATION_HEAD,
    ];

    // Validate location belongs to clinic if locationId is provided (optional for clinic admin)
    // locationId is optional - resolveLocationAndClinic will use clinicId when locationId not provided
    if (createUserDto.locationId) {
      const targetClinicId = createUserDto.clinicId || clinicId || user.primaryClinicId;
      if (!targetClinicId) {
        throw this.errors.validationError(
          'clinicId',
          'Clinic ID is required when assigning location',
          'UsersService.updateUserRole'
        );
      }

      // Verify location belongs to clinic
      const location = await this.databaseService.executeHealthcareRead<{
        id: string;
        clinicId: string;
      } | null>(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        const result = await typedClient.clinicLocation.findFirst({
          where: {
            OR: [{ id: createUserDto.locationId }, { locationId: createUserDto.locationId }],
          } as PrismaDelegateArgs,
          select: { id: true, clinicId: true } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        return result as { id: string; clinicId: string } | null;
      });

      if (!location) {
        throw this.errors.validationError(
          'locationId',
          `Location with ID ${createUserDto.locationId} not found`,
          'UsersService.updateUserRole'
        );
      }

      if (location.clinicId !== targetClinicId) {
        throw this.errors.validationError(
          'locationId',
          `Location ${createUserDto.locationId} does not belong to clinic ${targetClinicId}`,
          'UsersService.updateUserRole'
        );
      }
    }

    // Delete old role-specific records using executeHealthcareWrite
    const auditInfo = {
      userId: id,
      clinicId: String((user as { primaryClinicId?: string | null })['primaryClinicId'] || ''),
      resourceType: 'USER',
      operation: 'UPDATE',
      resourceId: id,
      userRole: 'system',
      details: { oldRole: user.role, newRole: role },
    };

    if (
      ((user.role as Role) === Role.DOCTOR || (user.role as Role) === Role.ASSISTANT_DOCTOR) &&
      user.doctor
    ) {
      await this.databaseService.executeHealthcareWrite<Doctor>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.doctor.delete({
            where: { userId: id } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        { ...auditInfo, resourceType: 'DOCTOR' }
      );
    }
    if (
      (user as { role?: string })['role'] === Role.PATIENT &&
      (user as { patient?: unknown })['patient']
    ) {
      await this.databaseService.executeHealthcareWrite<Patient>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.patient.delete({
            where: { userId: id } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        { ...auditInfo, resourceType: 'PATIENT' }
      );
    }
    if (
      (user.role as Role) === Role.RECEPTIONIST &&
      user.receptionists &&
      user.receptionists.length > 0
    ) {
      await this.databaseService.executeHealthcareWrite<Receptionist>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.receptionist.delete({
            where: { userId: id } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        { ...auditInfo, resourceType: 'RECEPTIONIST' }
      );
    }
    if (
      (user.role as Role) === Role.CLINIC_ADMIN &&
      user.clinicAdmins &&
      user.clinicAdmins.length > 0
    ) {
      await this.databaseService.executeHealthcareWrite<ClinicAdmin>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.clinicAdmin.delete({
            where: { userId: id } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        { ...auditInfo, resourceType: 'CLINIC_ADMIN' }
      );
    }
    if (
      (user.role as Role) === Role.LOCATION_HEAD &&
      (user as { locationHead?: unknown })['locationHead']
    ) {
      await this.databaseService.executeHealthcareWrite<{
        id: string;
        userId: string;
        [key: string]: unknown;
      }>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            locationHead: {
              delete: (args: {
                where: { userId: string };
              }) => Promise<{ id: string; userId: string }>;
            };
          };
          return await typedClient.locationHead.delete({
            where: { userId: id },
          });
        },
        { ...auditInfo, resourceType: 'LOCATION_HEAD' }
      );
    }
    if (
      (user as { role?: string })['role'] === Role.SUPER_ADMIN &&
      (user as { superAdmin?: unknown })['superAdmin']
    ) {
      await this.databaseService.executeHealthcareWrite<SuperAdmin>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.superAdmin.delete({
            where: { userId: id } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        { ...auditInfo, resourceType: 'SUPER_ADMIN' }
      );
    }

    // Helper function to resolve locationId and clinicId
    const resolveLocationAndClinic = async (
      providedLocationId?: string,
      providedClinicId?: string
    ): Promise<{ locationId: string | null; clinicId: string | null }> => {
      if (providedLocationId) {
        // Fetch location to get clinicId
        const location = await this.databaseService.executeHealthcareRead<{
          id: string;
          clinicId: string;
        } | null>(async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          const result = await typedClient.clinicLocation.findFirst({
            where: {
              OR: [{ id: providedLocationId }, { locationId: providedLocationId }],
            } as PrismaDelegateArgs,
            select: { id: true, clinicId: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
          return result as { id: string; clinicId: string } | null;
        });

        if (location) {
          return {
            locationId: location.id,
            clinicId: location.clinicId,
          };
        }
      }

      // Fallback to provided clinicId or null
      return {
        locationId: providedLocationId || null,
        clinicId: providedClinicId || null,
      };
    };

    // Create new role-specific records using executeHealthcareWrite
    const createAuditInfo = {
      userId: id,
      clinicId: String((user as { primaryClinicId?: string | null })['primaryClinicId'] || ''),
      resourceType: 'USER',
      operation: 'CREATE',
      resourceId: id,
      userRole: 'system',
      details: { newRole: role },
    };

    switch (role) {
      case Role.PATIENT: {
        // Get clinicId from context or user's primary clinic (for audit purposes only)
        const targetClinicId = createUserDto.clinicId || clinicId || user.primaryClinicId;
        // Patient model only has userId field, clinic association is through User model
        await this.databaseService.executeHealthcareWrite<Patient>(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            return await typedClient.patient.create({
              data: {
                userId: id,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          },
          {
            ...createAuditInfo,
            resourceType: 'PATIENT',
            clinicId: targetClinicId || '',
          }
        );
        break;
      }
      case Role.DOCTOR:
      case Role.ASSISTANT_DOCTOR:
        await this.databaseService.executeHealthcareWrite<Doctor>(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            return await typedClient.doctor.create({
              data: {
                userId: id,
                specialization: '',
                experience: 0,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          },
          { ...createAuditInfo, resourceType: 'DOCTOR' }
        );
        break;
      case Role.RECEPTIONIST: {
        const { locationId: targetLocationId, clinicId: targetClinicId } =
          await resolveLocationAndClinic(
            createUserDto.locationId,
            createUserDto.clinicId || clinicId
          );
        await this.databaseService.executeHealthcareWrite<Receptionist>(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            return await typedClient.receptionist.create({
              data: {
                userId: id,
                clinicId: targetClinicId,
                locationId: targetLocationId,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          },
          {
            ...createAuditInfo,
            resourceType: 'RECEPTIONIST',
            clinicId: targetClinicId || '',
          }
        );
        break;
      }
      case Role.CLINIC_ADMIN: {
        const { locationId: targetLocationId, clinicId: resolvedClinicId } =
          await resolveLocationAndClinic(
            createUserDto.locationId,
            createUserDto.clinicId || clinicId
          );

        // If no clinicId resolved from location, try to get from clinics
        let targetClinicId = resolvedClinicId;
        if (!targetClinicId) {
          const clinics = await this.databaseService.executeHealthcareRead<Clinic[]>(
            async client => {
              const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
              return await typedClient.clinic.findMany({
                take: 1,
              } as PrismaDelegateArgs);
            }
          );
          if (!clinics || clinics.length === 0) {
            throw this.errors.clinicNotFound(undefined, 'UsersService.updateUserRole');
          }
          targetClinicId = clinics[0]?.id ?? '';
        }

        if (!targetClinicId) {
          throw this.errors.clinicNotFound(undefined, 'UsersService.updateUserRole');
        }

        await this.databaseService.executeHealthcareWrite<ClinicAdmin>(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            return await typedClient.clinicAdmin.create({
              data: {
                userId: id,
                clinicId: targetClinicId,
                locationId: targetLocationId,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
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
        await this.databaseService.executeHealthcareWrite<{
          id: string;
          userId: string;
          [key: string]: unknown;
        }>(
          async client => {
            const result = await (
              client as {
                superAdmin: {
                  create: (
                    args: unknown
                  ) => Promise<{ id: string; userId: string; [key: string]: unknown }>;
                };
              }
            )['superAdmin'].create({
              data: { userId: id },
            });
            return result;
          },
          { ...createAuditInfo, resourceType: 'SUPER_ADMIN' }
        );
        break;
      case Role.PHARMACIST: {
        const { locationId: targetLocationId, clinicId: targetClinicId } =
          await resolveLocationAndClinic(
            createUserDto.locationId,
            createUserDto.clinicId || clinicId
          );
        await this.databaseService.executeHealthcareWrite(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            return await typedClient.pharmacist.create({
              data: {
                userId: id,
                clinicId: targetClinicId,
                locationId: targetLocationId,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          },
          {
            ...createAuditInfo,
            resourceType: 'PHARMACIST',
            clinicId: targetClinicId || '',
          }
        );
        break;
      }
      case Role.THERAPIST: {
        const { locationId: targetLocationId, clinicId: targetClinicId } =
          await resolveLocationAndClinic(
            createUserDto.locationId,
            createUserDto.clinicId || clinicId
          );
        await this.databaseService.executeHealthcareWrite(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            return await typedClient.therapist.create({
              data: {
                userId: id,
                clinicId: targetClinicId,
                locationId: targetLocationId,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          },
          {
            ...createAuditInfo,
            resourceType: 'THERAPIST',
            clinicId: targetClinicId || '',
          }
        );
        break;
      }
      case Role.LAB_TECHNICIAN: {
        const { locationId: targetLocationId, clinicId: targetClinicId } =
          await resolveLocationAndClinic(
            createUserDto.locationId,
            createUserDto.clinicId || clinicId
          );
        await this.databaseService.executeHealthcareWrite(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            return await typedClient.labTechnician.create({
              data: {
                userId: id,
                clinicId: targetClinicId,
                locationId: targetLocationId,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          },
          {
            ...createAuditInfo,
            resourceType: 'LAB_TECHNICIAN',
            clinicId: targetClinicId || '',
          }
        );
        break;
      }
      case Role.FINANCE_BILLING: {
        const { locationId: targetLocationId, clinicId: targetClinicId } =
          await resolveLocationAndClinic(
            createUserDto.locationId,
            createUserDto.clinicId || clinicId
          );
        await this.databaseService.executeHealthcareWrite(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            return await typedClient.financeBilling.create({
              data: {
                userId: id,
                clinicId: targetClinicId,
                locationId: targetLocationId,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          },
          {
            ...createAuditInfo,
            resourceType: 'FINANCE_BILLING',
            clinicId: targetClinicId || '',
          }
        );
        break;
      }
      case Role.SUPPORT_STAFF: {
        const { locationId: targetLocationId, clinicId: targetClinicId } =
          await resolveLocationAndClinic(
            createUserDto.locationId,
            createUserDto.clinicId || clinicId
          );
        await this.databaseService.executeHealthcareWrite(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            return await typedClient.supportStaff.create({
              data: {
                userId: id,
                clinicId: targetClinicId,
                locationId: targetLocationId,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          },
          {
            ...createAuditInfo,
            resourceType: 'SUPPORT_STAFF',
            clinicId: targetClinicId || '',
          }
        );
        break;
      }
      case Role.NURSE: {
        const { locationId: targetLocationId, clinicId: targetClinicId } =
          await resolveLocationAndClinic(
            createUserDto.locationId,
            createUserDto.clinicId || clinicId
          );
        await this.databaseService.executeHealthcareWrite(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            return await typedClient.nurse.create({
              data: {
                userId: id,
                clinicId: targetClinicId,
                locationId: targetLocationId,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          },
          {
            ...createAuditInfo,
            resourceType: 'NURSE',
            clinicId: targetClinicId || '',
          }
        );
        break;
      }
      case Role.COUNSELOR: {
        const { locationId: targetLocationId, clinicId: targetClinicId } =
          await resolveLocationAndClinic(
            createUserDto.locationId,
            createUserDto.clinicId || clinicId
          );
        await this.databaseService.executeHealthcareWrite(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            return await typedClient.counselor.create({
              data: {
                userId: id,
                clinicId: targetClinicId,
                locationId: targetLocationId,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          },
          {
            ...createAuditInfo,
            resourceType: 'COUNSELOR',
            clinicId: targetClinicId || '',
          }
        );
        break;
      }
      case Role.LOCATION_HEAD: {
        const { locationId: targetLocationId, clinicId: targetClinicId } =
          await resolveLocationAndClinic(
            createUserDto.locationId,
            createUserDto.clinicId || clinicId
          );
        if (!targetClinicId) {
          throw this.errors.clinicNotFound(undefined, 'UsersService.updateUserRole');
        }
        await this.databaseService.executeHealthcareWrite<{
          id: string;
          userId: string;
          clinicId: string;
          locationId: string | null;
          assignedBy: string;
          assignedAt: Date;
          isActive: boolean;
          [key: string]: unknown;
        }>(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
              locationHead: {
                create: (args: {
                  data: {
                    userId: string;
                    clinicId: string;
                    locationId: string | null;
                    assignedBy: string;
                  };
                }) => Promise<{
                  id: string;
                  userId: string;
                  clinicId: string;
                  locationId: string | null;
                  assignedBy: string;
                  assignedAt: Date;
                  isActive: boolean;
                }>;
              };
            };
            return await typedClient.locationHead.create({
              data: {
                userId: id,
                clinicId: targetClinicId,
                locationId: targetLocationId,
                assignedBy: userId || 'SYSTEM',
              },
            });
          },
          {
            ...createAuditInfo,
            resourceType: 'LOCATION_HEAD',
            clinicId: targetClinicId,
          }
        );
        break;
      }
    }

    // Update user role using updateUserSafe
    await this.databaseService.updateUserSafe(id, { role } as never);
    // Fetch updated user with relations
    const updatedUser = await this.databaseService.executeHealthcareRead<{
      id: string;
      email: string;
      [key: string]: unknown;
    } | null>(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      const result = await typedClient.user.findUnique({
        where: { id } as PrismaDelegateArgs,
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
          locationHead: true,
          nurse: true,
          counselor: true,
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
      return result as {
        id: string;
        email: string;
        [key: string]: unknown;
      } | null;
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
