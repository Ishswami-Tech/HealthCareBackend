import { Injectable, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events';
import { LogLevel, LogType, type IEventService, isEventService } from '@core/types';

import type { UserWithRelations } from '@core/types/user.types';
import { isPrismaDatabaseError } from '@core/types/infrastructure.types';
import { Role } from '@core/types/enums.types';
import type { User } from '@core/types/database.types';
import { EmergencyContact } from '@core/types/database.types';
import { RbacService } from '@core/rbac/rbac.service';
import { CreateUserDto, UserResponseDto, UpdateUserDto, MedicalDocumentDto } from '@dtos/user.dto';
import { AuthService } from '@services/auth/auth.service';
import { HealthcareErrorsService } from '@core/errors';
// Removed ProfileCompletionService import as logic is moved here
import type {
  PrismaTransactionClientWithDelegates,
  PrismaDelegateArgs,
} from '@core/types/prisma.types';
import type { UserUpdateInput, UserWhereInput } from '@core/types/input.types';
import type { Doctor, Patient, Receptionist, ClinicAdmin, SuperAdmin, AuditLog } from '@core/types';
import { AuditInfo } from '@core/types/database.types';

export interface ProfileCompletionValidationResult {
  isComplete: boolean;
  missingFields: string[];
  errors: Array<{ field: string; message: string }>;
}

export interface RoleBasedRequirements {
  requiredFields: string[];
  conditionalFields: Record<string, string[]>;
}

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

  /**
   * Role-based profile completion requirements
   * Each role has specific mandatory fields for profile completion
   */
  private readonly ROLE_REQUIREMENTS: Record<Role, RoleBasedRequirements> = {
    PATIENT: {
      requiredFields: ['firstName', 'lastName', 'phone', 'dateOfBirth', 'gender', 'address'],
      conditionalFields: {},
    },
    DOCTOR: {
      requiredFields: [
        'firstName',
        'lastName',
        'phone',
        'dateOfBirth',
        'gender',
        'address',
        'specialization',
        'experience',
      ],
      conditionalFields: {},
    },
    ASSISTANT_DOCTOR: {
      requiredFields: [
        'firstName',
        'lastName',
        'phone',
        'dateOfBirth',
        'gender',
        'address',
        'specialization',
        'experience',
      ],
      conditionalFields: {},
    },
    RECEPTIONIST: {
      requiredFields: ['firstName', 'lastName', 'phone', 'dateOfBirth', 'gender', 'address'],
      conditionalFields: {},
    },
    PHARMACIST: {
      requiredFields: ['firstName', 'lastName', 'phone', 'dateOfBirth', 'gender', 'address'],
      conditionalFields: {},
    },
    THERAPIST: {
      requiredFields: ['firstName', 'lastName', 'phone', 'dateOfBirth', 'gender', 'address'],
      conditionalFields: {},
    },
    LAB_TECHNICIAN: {
      requiredFields: ['firstName', 'lastName', 'phone', 'dateOfBirth', 'gender', 'address'],
      conditionalFields: {},
    },
    FINANCE_BILLING: {
      requiredFields: ['firstName', 'lastName', 'phone', 'dateOfBirth', 'gender', 'address'],
      conditionalFields: {},
    },
    SUPPORT_STAFF: {
      requiredFields: ['firstName', 'lastName', 'phone', 'dateOfBirth', 'gender', 'address'],
      conditionalFields: {},
    },
    NURSE: {
      requiredFields: ['firstName', 'lastName', 'phone', 'dateOfBirth', 'gender', 'address'],
      conditionalFields: {},
    },
    COUNSELOR: {
      requiredFields: ['firstName', 'lastName', 'phone', 'dateOfBirth', 'gender', 'address'],
      conditionalFields: {},
    },
    LOCATION_HEAD: {
      requiredFields: ['firstName', 'lastName', 'phone', 'dateOfBirth', 'gender', 'address'],
      conditionalFields: {},
    },
    CLINIC_ADMIN: {
      requiredFields: [
        'firstName',
        'lastName',
        'phone',
        'dateOfBirth',
        'gender',
        'address',
        'clinicName',
        'clinicAddress', // Changed from clinicAddress to match DB schema if needed or keep consistent
      ],
      conditionalFields: {},
    },
    SUPER_ADMIN: {
      requiredFields: ['firstName', 'lastName', 'phone', 'dateOfBirth', 'gender', 'address'],
      conditionalFields: {},
    },
  };

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => EventService))
    eventService: unknown,
    private readonly rbacService: RbacService,
    @Inject(forwardRef(() => AuthService))
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

  async findAll(role?: Role, clinicId?: string): Promise<UserResponseDto[]> {
    const cacheKey = `users:all:${role || 'all'}:${clinicId || 'global'}`;

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
          const where: Record<string, unknown> = {};
          if (role) {
            where['role'] = role;
          }
          // 🔒 TENANT ISOLATION: Filter by clinic when clinicId is provided
          if (clinicId) {
            where['userClinics'] = { some: { clinicId } };
          }
          const result = await typedClient.user.findMany({
            where: where as PrismaDelegateArgs,
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

  async findOne(id: string, clinicId?: string): Promise<UserResponseDto> {
    const cacheKey = `users:one:${id}:${clinicId || 'global'}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        // Use findUserByIdSafe for optimized query with caching
        const userRaw = await this.databaseService.findUserByIdSafe(id);
        const user = userRaw;

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
      // Handle role-specific data updates
      if (
        (existingUser as { role?: string })['role'] === Role.DOCTOR &&
        cleanedData.specialization
      ) {
        await this.updateDoctorProfile(id, existingUser, cleanedData);
        delete cleanedData.specialization;
        delete cleanedData.experience;
      }

      // Handle Emergency Contact (Relation)
      if (cleanedData['emergencyContact']) {
        const emergencyContactData = cleanedData['emergencyContact'] as unknown as EmergencyContact;
        await this.updateEmergencyContact(id, existingUser, emergencyContactData);
        delete cleanedData['emergencyContact'];
      }

      // Handle Insurance (Relation)
      if (cleanedData['insurance']) {
        await this.updatePatientInsurance(
          id,
          existingUser,
          cleanedData['insurance'] as unknown as Record<string, unknown>[]
        );
        delete cleanedData['insurance'];
      }

      // Handle Medical Documents (Relation)
      if (cleanedData['medicalDocuments']) {
        await this.updatePatientDocuments(id, existingUser, cleanedData['medicalDocuments']);
        delete cleanedData['medicalDocuments'];
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
      const user = existingUserRaw
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
      // ... (rest of the code)
      // I will truncate here to avoid replacing too much, just need to insert after the `update` method.

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
  async getDoctors(clinicId?: string): Promise<UserResponseDto[]> {
    return this.findAll(Role.DOCTOR, clinicId);
  }

  async getPatients(clinicId?: string): Promise<UserResponseDto[]> {
    return this.findAll(Role.PATIENT, clinicId);
  }

  async getReceptionists(clinicId?: string): Promise<UserResponseDto[]> {
    return this.findAll(Role.RECEPTIONIST, clinicId);
  }

  async getClinicAdmins(clinicId?: string): Promise<UserResponseDto[]> {
    return this.findAll(Role.CLINIC_ADMIN, clinicId);
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

    // Unified audit info for role transition
    const auditInfo = {
      userId: id,
      clinicId: String((user as { primaryClinicId?: string | null })['primaryClinicId'] || ''),
      resourceType: 'USER',
      operation: 'UPDATE',
      resourceId: id,
      userRole: 'system',
      details: { oldRole: user.role, newRole: role },
    };

    // Remove all existing role-specific records
    await this.deleteOldRoleRecords(id, user, auditInfo);

    // Get resolution for location and clinic
    const { locationId: targetLocationId, clinicId: targetClinicId } =
      await this.resolveLocationAndClinic(
        createUserDto.locationId,
        createUserDto.clinicId ||
          clinicId ||
          (user as { primaryClinicId?: string | null })['primaryClinicId'] ||
          undefined
      );

    // Create the new role-specific record
    await this.createNewRoleRecord(id, role, targetLocationId, targetClinicId, auditInfo, user);

    // Update user role in DB
    await this.databaseService.updateUserSafe(id, { role } as never);

    // Fetch updated user with relations
    const updatedUser = await this.databaseService.executeHealthcareRead<UserWithRelations | null>(
      async client => {
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
        return result as unknown as UserWithRelations | null;
      }
    );

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

  /**
   * Search users with filters
   */
  async search(
    query: string,
    clinicId?: string,
    roles?: Role[],
    limit = 20,
    offset = 0
  ): Promise<{ data: UserResponseDto[]; total: number }> {
    // RBAC check usually happens at controller, but good to have clinic scope here
    const where: Record<string, unknown> = {};

    if (clinicId) {
      where['OR'] = [
        { primaryClinicId: clinicId },
        {
          doctor: {
            clinics: {
              some: {
                clinicId: clinicId,
              },
            },
          },
        },
        {
          receptionists: {
            some: {
              clinicId: clinicId,
            },
          },
        },
        {
          clinicAdmins: {
            some: {
              clinicId: clinicId,
            },
          },
        },
      ];
    }

    if (roles && roles.length > 0) {
      where['role'] = { in: roles };
    }

    if (query) {
      where['AND'] = [
        {
          OR: [
            { email: { contains: query, mode: 'insensitive' } },
            { firstName: { contains: query, mode: 'insensitive' } },
            { lastName: { contains: query, mode: 'insensitive' } },
            { phone: { contains: query, mode: 'insensitive' } },
          ],
        },
      ];
    }

    // Execute with caching
    const cacheKey = `users:search:${clinicId || 'all'}:${query}:${roles?.join(',') || 'all'}:${limit}:${offset}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const [users, total] = await Promise.all([
          this.databaseService.executeHealthcareRead<UserWithRelations[]>(async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            return await typedClient.user.findMany({
              where: where as UserWhereInput,
              take: limit,
              skip: offset,
              orderBy: { createdAt: 'desc' },
            } as PrismaDelegateArgs);
          }),
          this.databaseService.executeHealthcareRead<number>(async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            return await typedClient.user.count({
              where: where as UserWhereInput,
            } as PrismaDelegateArgs);
          }),
        ]);

        const data = users.map(user => {
          const { password: _password, ...rest } = user as User & { password?: string };
          const userResponse: UserResponseDto = {
            id: rest.id,
            email: rest.email,
            firstName: rest.firstName ?? '',
            lastName: rest.lastName ?? '',
            role: rest.role as Role,
            isVerified: rest.isVerified,
            isActive: true,
            createdAt: rest.createdAt,
            updatedAt: rest.updatedAt,
            phone: rest.phone ?? '',
          };
          if (rest.dateOfBirth) {
            userResponse.dateOfBirth = this.formatDateToString(rest.dateOfBirth);
          }
          return userResponse;
        });

        return { data, total };
      },
      {
        ttl: 300, // 5 minutes
        tags: ['users', 'search', clinicId ? `clinic:${clinicId}` : 'global'],
        priority: 'normal',
        enableSwr: true,
      }
    );
  }

  /**
   * Get user statistics
   */
  async getStats(
    clinicId?: string
  ): Promise<{ total: number; active: number; byRole: Record<string, number> }> {
    const cacheKey = `users:stats:${clinicId || 'all'}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const where: UserWhereInput = clinicId ? { primaryClinicId: clinicId } : {};

        // Count total
        const total = await this.countUsersSafe(where as PrismaDelegateArgs);

        // Count by role
        const byRoleRaw = await this.databaseService.executeHealthcareRead<
          Array<{ role: Role; _count: { id: number } }>
        >(async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return (await typedClient.user.groupBy({
            by: ['role'],
            where: where as PrismaDelegateArgs['where'],
            _count: {
              id: true,
            },
          } as PrismaDelegateArgs)) as unknown as Array<{ role: Role; _count: { id: number } }>;
        });

        const byRole: Record<string, number> = {};
        byRoleRaw.forEach(item => {
          byRole[item.role] = item._count.id;
        });

        const active = await this.databaseService.executeHealthcareRead<number>(
          async baseClient => {
            const typedClient = baseClient as unknown as PrismaTransactionClientWithDelegates;
            return await typedClient.user.count({
              where: {
                ...(clinicId ? { primaryClinicId: clinicId } : {}),
                isVerified: true,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          }
        );

        return { total, active, byRole };
      },
      {
        ttl: 1800, // 30 minutes
        tags: ['users', 'stats'],
        priority: 'low',
        enableSwr: true,
      }
    );
  }

  /**
   * Get user activity (audit logs)
   */
  async getUserActivity(userId: string, limit = 20): Promise<unknown[]> {
    try {
      return await this.databaseService.executeHealthcareRead<unknown[]>(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          auditLog: {
            findMany: (args: PrismaDelegateArgs) => Promise<unknown[]>;
          };
        };

        if (typedClient.auditLog) {
          return await typedClient.auditLog.findMany({
            where: { userId } as PrismaDelegateArgs,
            take: limit,
            orderBy: { timestamp: 'desc' } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        }
        return [];
      });
    } catch (_error) {
      return [];
    }
  }

  private async countUsersSafe(where: UserWhereInput): Promise<number> {
    return this.databaseService.executeHealthcareRead<number>(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return await typedClient.user.count({ where } as PrismaDelegateArgs);
    });
  }

  private async updateDoctorProfile(
    userId: string,
    existingUser: unknown,
    cleanedData: Partial<UpdateUserDto> & { specialization?: string; experience?: number | string }
  ): Promise<void> {
    const existingUserWithDoctor = existingUser as UserWithRelations;
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
              userId: userId,
              specialization: cleanedData.specialization ?? '',
              experience:
                typeof cleanedData.experience === 'string'
                  ? parseInt(cleanedData.experience) || 0
                  : 0,
            },
          });
        },
        {
          userId: userId,
          clinicId: String(
            (existingUser as { primaryClinicId?: string | null })['primaryClinicId'] || ''
          ),
          resourceType: 'DOCTOR',
          operation: 'CREATE',
          resourceId: userId,
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
            where: { userId: userId } as PrismaDelegateArgs,
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
          userId: userId,
          clinicId: String(
            (existingUser as { primaryClinicId?: string | null })['primaryClinicId'] || ''
          ),
          resourceType: 'DOCTOR',
          operation: 'UPDATE',
          resourceId: userId,
          userRole: 'system',
          details: { specialization: cleanedData.specialization },
        }
      );
    }
  }

  private async updateEmergencyContact(
    userId: string,
    existingUser: unknown,
    emergencyContactData: EmergencyContact
  ): Promise<void> {
    await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        // Find existing contact
        const existingContacts = await typedClient.emergencyContact.findMany({
          where: { userId: userId } as PrismaDelegateArgs,
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
              userId: userId,
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
        userId: userId,
        clinicId: String(
          (existingUser as { primaryClinicId?: string | null })['primaryClinicId'] || ''
        ),
        resourceType: 'EMERGENCY_CONTACT',
        operation: 'UPSERT',
        resourceId: userId,
        userRole: 'system',
        details: { emergencyContact: emergencyContactData },
      }
    );
  }

  private async updatePatientInsurance(
    userId: string,
    existingUser: unknown,
    insuranceData: Record<string, unknown>[]
  ): Promise<void> {
    const existingUserWithPatient = existingUser as UserWithRelations;
    if (!existingUserWithPatient.patient) return;

    const patientId = existingUserWithPatient.patient.id;

    await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        // For simplicity in this refinement, we'll replace existing insurance records with the new ones
        // In a more complex scenario, we might want to sync/update specific records
        await typedClient.insurance.deleteMany({
          where: { patientId },
        });

        if (insuranceData && insuranceData.length > 0) {
          await typedClient.insurance.createMany({
            data: insuranceData.map(item => {
              const provider = item['provider'];
              const policyNumber = item['policyNumber'];
              const primaryHolder = item['policyHolder'];
              const coverageType = item['coverageDetails'];

              return {
                provider: typeof provider === 'string' ? provider : '',
                policyNumber: typeof policyNumber === 'string' ? policyNumber : '',
                groupNumber: (item['groupNumber'] as string) || null,
                primaryHolder: typeof primaryHolder === 'string' ? primaryHolder : '',
                coverageStartDate: new Date(),
                coverageEndDate: item['expiryDate'] ? new Date(item['expiryDate'] as string) : null,
                coverageType: typeof coverageType === 'string' ? coverageType : 'standard',
                patientId,
              };
            }) as unknown as PrismaDelegateArgs[],
          });
        }
      },
      {
        userId,
        clinicId: String((existingUser as UserWithRelations).primaryClinicId || ''),
        resourceType: 'INSURANCE',
        operation: 'REPLACE',
        resourceId: userId,
        userRole: 'system',
        details: { count: insuranceData.length },
      }
    );
  }

  private async updatePatientDocuments(
    userId: string,
    existingUser: unknown,
    documentsData: MedicalDocumentDto[]
  ): Promise<void> {
    const existingUserWithPatient = existingUser as UserWithRelations;
    if (!existingUserWithPatient.patient) return;

    const patientId = existingUserWithPatient.patient.id;

    await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        // For documents, we usually append or sync. Here we'll just handle the create part if they are new.
        // For a full implementation, we'd need a way to distinguish new vs existing.
        // We'll assume these are new uploads being added to the profile.
        if (documentsData && documentsData.length > 0) {
          for (const doc of documentsData) {
            // Check if document already exists by URL to avoid duplicates
            const existing = await typedClient.medicalDocument.findFirst({
              where: { patientId, fileUrl: doc.fileUrl },
            });

            if (!existing) {
              await typedClient.medicalDocument.create({
                data: {
                  ...doc,
                  patientId,
                  uploadedAt: new Date(),
                },
              });
            }
          }
        }
      },
      {
        userId,
        clinicId: String((existingUser as UserWithRelations).primaryClinicId || ''),
        resourceType: 'MEDICAL_DOCUMENT',
        operation: 'UPSERT',
        resourceId: userId,
        userRole: 'system',
        details: { count: documentsData.length },
      }
    );
  }

  /**
   * Validate and complete user profile
   * This is the authoritative method for marking a profile as complete
   *
   * @param userId - User ID to validate and complete
   * @param profileData - Profile data to validate
   * @returns Updated user with profile completion status
   */
  async completeUserProfile(
    userId: string,
    profileData: Record<string, unknown>
  ): Promise<{ success: boolean; message: string; user?: UserResponseDto }> {
    try {
      // Get user with role
      const user = await this.databaseService.findUserByIdSafe(userId);

      if (!user) {
        throw new BadRequestException('User not found');
      }

      const userRole = user.role as Role;

      // Validate profile completion using local method
      const validation = this.validateProfileCompletion(profileData, userRole);

      if (!validation.isComplete) {
        return {
          success: false,
          message: `Profile incomplete. Missing fields: ${validation.missingFields.join(', ')}`,
        };
      }

      // All validations passed - mark profile as complete in database
      await this.databaseService.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          await typedClient.user.update({
            where: { id: userId } as PrismaDelegateArgs,
            data: {
              isProfileComplete: true,
              profileCompletedAt: new Date(),
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        {
          userId,
          clinicId: String(user.primaryClinicId || ''),
          resourceType: 'USER',
          operation: 'UPDATE',
          resourceId: userId,
          userRole: userRole,
          details: { action: 'profile_completed' },
        }
      );

      // Emit profile completion event
      if (isEventService(this.eventService)) {
        await this.eventService.emit('profile.completed', {
          userId,
          role: userRole,
          timestamp: new Date().toISOString(),
        });
      }

      // Invalidate cache
      await this.cacheService.del(`user:${userId}`);
      await this.cacheService.del(`user:${userId}:profile`);

      await this.loggingService.log(
        LogType.AUDIT,
        LogLevel.INFO,
        `Profile completed for user ${userId}`,
        'UsersService.completeUserProfile',
        { userId, role: userRole }
      );

      // Fetch updated user
      const updatedUser = await this.findOne(userId);
      return {
        success: true,
        message: 'Profile completed successfully',
        user: updatedUser,
      };
    } catch (error) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to complete profile for user ${userId}`,
        'UsersService.completeUserProfile',
        { error: error instanceof Error ? error.message : String(error) }
      );

      if (error instanceof BadRequestException) {
        throw error;
      }

      return {
        success: false,
        message: 'Failed to complete profile. Please try again.',
      };
    }
  }

  /**
   * Check if user profile is complete (authoritative check)
   * Uses database flag as primary source of truth
   *
   * @param userId - User ID to check
   * @returns Profile completion status
   */
  async checkUserProfileCompletion(userId: string): Promise<{
    isComplete: boolean;
    profileCompletedAt: Date | null;
    completionPercentage: number;
  }> {
    try {
      const user = await this.databaseService.findUserByIdSafe(userId);

      if (!user) {
        throw new BadRequestException('User not found');
      }

      const isComplete = user.isProfileComplete || false;
      const profileCompletedAt = user.profileCompletedAt || null;

      // Calculate completion percentage using local method
      const completionPercentage = this.getCompletionPercentage(
        user as unknown as Record<string, unknown>,
        user.role as Role
      );

      return {
        isComplete,
        profileCompletedAt,
        completionPercentage,
      };
    } catch (error) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to check profile completion for user ${userId}`,
        'UsersService.checkUserProfileCompletion',
        { error: error instanceof Error ? error.message : String(error) }
      );

      // Return incomplete status on error (fail-safe)
      return {
        isComplete: false,
        profileCompletedAt: null,
        completionPercentage: 0,
      };
    }
  }

  /**
   * Helper to resolve locationId and clinicId
   */
  private async resolveLocationAndClinic(
    providedLocationId?: string,
    providedClinicId?: string
  ): Promise<{ locationId: string | null; clinicId: string | null }> {
    if (providedLocationId) {
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

    return {
      locationId: providedLocationId || null,
      clinicId: providedClinicId || null,
    };
  }

  /**
   * Delete old role-specific records
   */
  private async deleteOldRoleRecords(
    id: string,
    user: UserWithRelations,
    auditInfo: AuditInfo
  ): Promise<void> {
    const rolesToRemove = [
      {
        cond: (user.role as Role) === Role.DOCTOR || (user.role as Role) === Role.ASSISTANT_DOCTOR,
        type: 'doctor',
      },
      { cond: (user.role as Role) === Role.PATIENT, type: 'patient' },
      { cond: (user.role as Role) === Role.RECEPTIONIST, type: 'receptionist' },
      { cond: (user.role as Role) === Role.CLINIC_ADMIN, type: 'clinicAdmin' },
      { cond: (user.role as Role) === Role.LOCATION_HEAD, type: 'locationHead' },
      { cond: (user.role as Role) === Role.SUPER_ADMIN, type: 'superAdmin' },
      { cond: (user.role as Role) === Role.PHARMACIST, type: 'pharmacist' },
      { cond: (user.role as Role) === Role.THERAPIST, type: 'therapist' },
      { cond: (user.role as Role) === Role.LAB_TECHNICIAN, type: 'labTechnician' },
      { cond: (user.role as Role) === Role.FINANCE_BILLING, type: 'financeBilling' },
      { cond: (user.role as Role) === Role.SUPPORT_STAFF, type: 'supportStaff' },
      { cond: (user.role as Role) === Role.NURSE, type: 'nurse' },
      { cond: (user.role as Role) === Role.COUNSELOR, type: 'counselor' },
    ];

    for (const role of rolesToRemove) {
      if (role.cond && (user as unknown as Record<string, unknown>)[role.type]) {
        await this.databaseService.executeHealthcareWrite(
          async client => {
            interface GenericDelegate {
              delete: (args: { where: { userId: string } }) => Promise<void>;
            }
            const delegate = (client as unknown as Record<string, GenericDelegate>)[role.type];
            if (delegate) {
              await delegate.delete({
                where: { userId: id },
              });
            }
          },
          { ...auditInfo, resourceType: role.type.toUpperCase() }
        );
      }
    }
  }

  /**
   * Create new role-specific record
   */
  private async createNewRoleRecord(
    id: string,
    role: Role,
    locationId: string | null,
    clinicId: string | null,
    auditInfo: AuditInfo,
    _user: UserWithRelations
  ): Promise<void> {
    const data: Record<string, unknown> = { userId: id };
    let resourceType = role.toString();

    switch (role) {
      case Role.DOCTOR:
      case Role.ASSISTANT_DOCTOR:
        data['specialization'] = '';
        data['experience'] = 0;
        resourceType = 'DOCTOR';
        break;
      case Role.RECEPTIONIST:
      case Role.CLINIC_ADMIN:
      case Role.PHARMACIST:
      case Role.THERAPIST:
      case Role.LAB_TECHNICIAN:
      case Role.FINANCE_BILLING:
      case Role.SUPPORT_STAFF:
      case Role.NURSE:
      case Role.COUNSELOR:
        data['clinicId'] = clinicId;
        data['locationId'] = locationId;
        resourceType = role.toString();
        break;
      case Role.LOCATION_HEAD:
        data['clinicId'] = clinicId;
        data['locationId'] = locationId;
        data['assignedBy'] = auditInfo.userId || 'SYSTEM';
        resourceType = 'LOCATION_HEAD';
        break;
      case Role.PATIENT:
      case Role.SUPER_ADMIN:
        resourceType = role.toString();
        break;
    }

    const prismaModelMap: Record<string, string> = {
      [Role.DOCTOR]: 'doctor',
      [Role.ASSISTANT_DOCTOR]: 'doctor',
      [Role.PATIENT]: 'patient',
      [Role.RECEPTIONIST]: 'receptionist',
      [Role.CLINIC_ADMIN]: 'clinicAdmin',
      [Role.SUPER_ADMIN]: 'superAdmin',
      [Role.PHARMACIST]: 'pharmacist',
      [Role.THERAPIST]: 'therapist',
      [Role.LAB_TECHNICIAN]: 'labTechnician',
      [Role.FINANCE_BILLING]: 'financeBilling',
      [Role.SUPPORT_STAFF]: 'supportStaff',
      [Role.NURSE]: 'nurse',
      [Role.COUNSELOR]: 'counselor',
      [Role.LOCATION_HEAD]: 'locationHead',
    };

    const modelName = prismaModelMap[role];
    if (modelName) {
      await this.databaseService.executeHealthcareWrite(
        async client => {
          interface GenericDelegate {
            create: (args: { data: unknown }) => Promise<void>;
          }
          const delegate = (client as unknown as Record<string, GenericDelegate>)[modelName];
          if (delegate) {
            await delegate.create({ data });
          }
        },
        { ...auditInfo, resourceType: resourceType, operation: 'CREATE' }
      );
    }
  }

  /**
   * Get required profile fields for a role
   *
   * @param role - User role
   * @returns List of required fields
   */
  getRequiredProfileFields(role: Role): string[] {
    return this.getRequiredFieldsForRole(role);
  }

  /**
   * Update user profile with validation
   * This method validates profile data before updating and auto-completes if all required fields are present
   *
   * @param userId - User ID to update
   * @param profileData - Profile data to update
   * @param operatorId - ID of user performing the update (for audit)
   * @param clinicId - Clinic ID for tenant isolation
   * @returns Updated user
   */
  async updateUserProfileWithValidation(
    userId: string,
    profileData: Record<string, unknown>,
    operatorId?: string,
    clinicId?: string
  ): Promise<UserResponseDto> {
    try {
      // Get user
      const user = await this.databaseService.findUserByIdSafe(userId);

      if (!user) {
        throw new BadRequestException('User not found');
      }

      const userRole = user.role as Role;

      // Validate profile data (non-blocking validation)
      const validation = this.validateProfileCompletion(
        { ...(user as unknown as Record<string, unknown>), ...profileData },
        userRole
      );

      // Update user with provided data
      const updatedUser = await this.update(
        userId,
        profileData as UpdateUserDto,
        operatorId,
        clinicId
      );

      // If profile is now complete, mark it as such
      if (validation.isComplete && !user.isProfileComplete) {
        await this.completeUserProfile(userId, {
          ...(user as unknown as Record<string, unknown>),
          ...profileData,
        });
      }

      return updatedUser;
    } catch (error) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to update profile for user ${userId}`,
        'UsersService.updateUserProfileWithValidation',
        { error: error instanceof Error ? error.message : String(error) }
      );

      throw error;
    }
  }

  /**
   * Validate if a user's profile is complete based on their role
   */
  public validateProfileCompletion(
    profile: Record<string, unknown>,
    role: Role
  ): ProfileCompletionValidationResult {
    const requirements = this.ROLE_REQUIREMENTS[role];

    if (!requirements) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Unknown role for profile validation: ${role}`,
        'UsersService.validateProfileCompletion'
      );

      return {
        isComplete: false,
        missingFields: [],
        errors: [{ field: 'role', message: 'Invalid role specified' }],
      };
    }

    const missingFields: string[] = [];
    const errors: Array<{ field: string; message: string }> = [];

    // Check each required field
    for (const field of requirements.requiredFields) {
      const value = profile[field];

      if (this.isFieldEmpty(value)) {
        missingFields.push(field);
        errors.push({
          field,
          message: `${this.formatFieldName(field)} is required for ${role} users`,
        });
      }
    }

    // Validate field formats
    this.validateFieldFormats(profile, role, errors);

    const isComplete = missingFields.length === 0 && errors.length === 0;

    if (!isComplete) {
      void this.loggingService.log(
        LogType.AUDIT,
        LogLevel.INFO,
        `Profile incomplete for ${role}: missing ${missingFields.join(', ')}`,
        'UsersService.validateProfileCompletion',
        { role, missingFields, errorCount: errors.length }
      );
    }

    return {
      isComplete,
      missingFields,
      errors,
    };
  }

  /**
   * Check if a field is empty (null, undefined, empty string, etc.)
   */
  private isFieldEmpty(value: unknown): boolean {
    if (value === null || value === undefined) {
      return true;
    }

    if (typeof value === 'string') {
      return value.trim().length === 0;
    }

    if (Array.isArray(value)) {
      return value.length === 0;
    }

    return false;
  }

  /**
   * Validate field formats (email, phone, dates, etc.)
   */
  private validateFieldFormats(
    profile: Record<string, unknown>,
    role: Role,
    errors: Array<{ field: string; message: string }>
  ): void {
    // Validate phone format if present
    const phone = profile['phone'] as string | undefined;
    if (phone && phone.trim()) {
      const phoneRegex = /^\+?[1-9]\d{1,14}$/;
      if (!phoneRegex.test(phone.trim())) {
        errors.push({
          field: 'phone',
          message: 'Phone number format is invalid',
        });
      }
    }

    // Validate date of birth if present
    const dateOfBirth = profile['dateOfBirth'] as string | Date | undefined;
    if (dateOfBirth) {
      const dob = typeof dateOfBirth === 'string' ? new Date(dateOfBirth) : dateOfBirth;

      if (isNaN(dob.getTime())) {
        errors.push({
          field: 'dateOfBirth',
          message: 'Invalid date of birth format',
        });
      } else {
        // Check age is reasonable (12-120 years)
        const today = new Date();
        let age = today.getFullYear() - dob.getFullYear();
        const monthDiff = today.getMonth() - dob.getMonth();

        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
          age--;
        }

        if (age < 12) {
          errors.push({
            field: 'dateOfBirth',
            message: 'You must be at least 12 years old',
          });
        } else if (age > 120) {
          errors.push({
            field: 'dateOfBirth',
            message: 'Invalid date of birth',
          });
        }
      }
    }

    // Validate experience for medical staff
    if (role === Role.DOCTOR || role === Role.ASSISTANT_DOCTOR) {
      const experience = profile['experience'] as number | string | undefined;
      if (experience !== undefined && experience !== '') {
        const expValue = typeof experience === 'string' ? parseInt(experience, 10) : experience;

        if (isNaN(expValue) || expValue < 0 || expValue > 60) {
          errors.push({
            field: 'experience',
            message: 'Experience must be between 0 and 60 years',
          });
        }
      }
    }

    // Validate gender value if present
    const gender = profile['gender'] as string | undefined;
    if (gender && gender.trim()) {
      const validGenders = ['MALE', 'FEMALE', 'OTHER'];
      if (!validGenders.includes(gender.toUpperCase())) {
        errors.push({
          field: 'gender',
          message: 'Invalid gender value',
        });
      }
    }
  }

  /**
   * Format field name for display (camelCase to Title Case)
   */
  private formatFieldName(fieldName: string): string {
    return fieldName
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .replace(/[A-Z]/g, ' $&')
      .trim()
      .replace(/ /g, ' ');
  }

  /**
   * Get required fields for a specific role
   */
  public getRequiredFieldsForRole(role: Role): string[] {
    const requirements = this.ROLE_REQUIREMENTS[role];
    return requirements?.requiredFields || [];
  }

  /**
   * Check if profile should be considered complete (server-side logic)
   * This is the single source of truth for profile completion status
   */
  public isProfileComplete(profile: Record<string, unknown>, role: Role): boolean {
    const result = this.validateProfileCompletion(profile, role);
    return result.isComplete;
  }

  /**
   * Get profile completion percentage
   */
  public getCompletionPercentage(profile: Record<string, unknown>, role: Role): number {
    const requirements = this.ROLE_REQUIREMENTS[role];

    if (!requirements || requirements.requiredFields.length === 0) {
      return 0;
    }

    const completedFields = requirements.requiredFields.filter(
      field => !this.isFieldEmpty(profile[field])
    ).length;

    return Math.round((completedFields / requirements.requiredFields.length) * 100);
  }

  /**
   * Check if emergency contact is complete
   */
  public isEmergencyContactComplete(
    emergencyContact: Record<string, unknown> | null | undefined
  ): boolean {
    if (!emergencyContact) {
      return false;
    }

    const contact = emergencyContact as {
      name?: string;
      phone?: string;
      relationship?: string;
    };

    return !!(contact.name?.trim() && contact.phone?.trim() && contact.relationship?.trim());
  }
}
