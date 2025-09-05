import { PrismaService } from '../../libs/infrastructure/database/prisma/prisma.service';
import { RedisCache } from '../../libs/infrastructure/cache/decorators/redis-cache.decorator';
import { Injectable, NotFoundException, ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { CacheService } from '../../libs/infrastructure/cache';
import { LoggingService } from '../../libs/infrastructure/logging/logging.service';
import { EventService } from '../../libs/infrastructure/events/event.service';
import { LogLevel, LogType } from '../../libs/infrastructure/logging/types/logging.types';
import { Role, Gender } from '../../libs/infrastructure/database/prisma/prisma.types';
import type { User } from '../../libs/infrastructure/database/prisma/prisma.types';
import { RbacService } from '../../libs/core/rbac/rbac.service';
import { CreateUserDto, UserResponseDto, UpdateUserDto } from '../../libs/dtos/user.dto';
import { ClinicAuthService } from '../auth/implementations/clinic-auth.service';
import { AuthPluginContext, AuthPluginDomain } from '../auth/core/auth-plugin.interface';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService,
    private readonly rbacService: RbacService,
    private readonly clinicAuthService: ClinicAuthService,
  ) {}

  @RedisCache({ prefix: "users:all", ttl: 3600, tags: ['users'] })
  async findAll(role?: Role): Promise<UserResponseDto[]> {
    const users = await this.prisma.user.findMany({
      where: role ? { role } : undefined,
      include: {
        doctor: role === Role.DOCTOR,
        patient: role === Role.PATIENT,
        receptionists: role === Role.RECEPTIONIST,
        clinicAdmins: role === Role.CLINIC_ADMIN,
        superAdmin: role === Role.SUPER_ADMIN,
      },
    });

    return users.map(({ password, ...user }) => {
      const userResponse = { ...user } as any;
      if (userResponse.dateOfBirth) {
        userResponse.dateOfBirth = userResponse.dateOfBirth.toISOString().split('T')[0];
      }
      return userResponse;
    }) as UserResponseDto[];
  }

  @RedisCache({ prefix: "users:one", ttl: 3600, tags: ['user'] })
  async findOne(id: string): Promise<UserResponseDto> {
    const user = await this.prisma.user.findUnique({
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

    const { password, ...result } = user;
    const userResponse = { ...result } as any;
    if (userResponse.dateOfBirth) {
      userResponse.dateOfBirth = userResponse.dateOfBirth.toISOString().split('T')[0];
    }
    return userResponse as UserResponseDto;
  }

  async findByEmail(email: string): Promise<UserResponseDto | null> {
    const user = await this.prisma.user.findFirst({
      where: {
        email: {
          mode: 'insensitive',
          equals: email
        }
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

    const { password, ...result } = user;
    const userResponse = { ...result } as any;
    if (userResponse.dateOfBirth) {
      userResponse.dateOfBirth = userResponse.dateOfBirth.toISOString().split('T')[0];
    }
    return userResponse as UserResponseDto;
  }

  async count(): Promise<number> {
    return await this.prisma.user.count();
  }

  private async getNextNumericId(): Promise<string> {
    const COUNTER_KEY = 'user:counter';
    const currentId = await this.cacheService.get<string>(COUNTER_KEY);
    const nextId = currentId ? parseInt(currentId) + 1 : 1;
    await this.cacheService.set(COUNTER_KEY, nextId.toString());
    return `UID${nextId.toString().padStart(6, '0')}`;
  }

  async createUser(data: CreateUserDto): Promise<User> {
    const userId = await this.getNextNumericId();
    
    // Create auth context for user registration
    const context: AuthPluginContext = {
      domain: AuthPluginDomain.CLINIC,
      clinicId: data.clinicId,
      userAgent: 'API',
      ipAddress: '127.0.0.1',
      metadata: { 
        source: 'user_service_registration',
        originalData: { email: data.email, role: data.role }
      },
    };

    // Use clinic auth service for user registration
    const authResponse = await this.clinicAuthService.register({
      email: data.email,
      password: data.password,
      name: `${data.firstName} ${data.lastName}`.trim(),
      phone: data.phone,
      role: (data.role as string) || 'PATIENT',
      metadata: {
        firstName: data.firstName,
        lastName: data.lastName,
        profilePicture: data.profilePicture,
        gender: data.gender,
        dateOfBirth: data.dateOfBirth,
        address: data.address,
        city: data.city,
        state: data.state,
        country: data.country,
        zipCode: data.zipCode,
        age: data.age || 0,
      },
      clinicId: context.clinicId,
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
    });

    if (!authResponse.success) {
      throw new Error(`User registration failed: ${authResponse.error}`);
    }

    const user = await this.prisma.user.create({
      data: {
        id: userId,
        userid: userId,
        email: data.email,
        password: data.password,
        firstName: data.firstName,
        lastName: data.lastName,
        name: `${data.firstName} ${data.lastName}`.trim(),
        phone: data.phone,
        role: (data.role as Role) || Role.PATIENT,
        profilePicture: data.profilePicture,
        gender: data.gender,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
        address: data.address,
        city: data.city,
        state: data.state,
        country: data.country,
        zipCode: data.zipCode,
        isVerified: false,
        age: data.age || 0
      }
    });

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'User created successfully with auth integration',
      'UsersService',
      { userId: user.id, email: data.email, role: data.role, clinicId: data.clinicId }
    );
    await this.eventService.emit('user.created', { 
      userId: user.id, 
      email: data.email, 
      role: data.role,
      clinicId: data.clinicId,
      authIntegrated: true
    });
    await this.cacheService.invalidateCacheByTag('users');

    return user as unknown as User;
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<UserResponseDto> {
    if (!id || id === 'undefined') {
      throw new BadRequestException('User ID is required');
    }
    try {
      // Check if user exists first
      const existingUser = await this.prisma.user.findUnique({
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
      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Attempting to update user',
        'UsersService',
        { 
          userId: id,
          updateFields: Object.keys(updateUserDto),
          role: existingUser.role
        }
      );

      // Clean up the data to prevent errors
      const cleanedData: any = { ...updateUserDto };
      
      // Prevent users from updating clinicId and appName
      delete cleanedData.clinicId;
      delete cleanedData.appName;
      
      // Handle date conversion properly
      if (cleanedData.dateOfBirth && typeof cleanedData.dateOfBirth === 'string') {
        try {
          cleanedData.dateOfBirth = new Date(cleanedData.dateOfBirth);
        } catch (error) {
          this.loggingService.log(
            LogType.ERROR,
            LogLevel.ERROR,
            'Invalid date format for dateOfBirth',
            'UsersService',
            { userId: id, dateOfBirth: cleanedData.dateOfBirth }
          );
          throw new Error('Invalid date format for dateOfBirth');
        }
      }

      // Handle role-specific data updates
      if (existingUser.role === Role.DOCTOR && cleanedData.specialization) {
        // Ensure doctor record exists
        if (!(existingUser as any).doctor) {
          await this.prisma.doctor.create({
            data: {
              userId: id,
              specialization: cleanedData.specialization,
              experience: parseInt(cleanedData.experience as string) || 0,
            },
          });
        } else {
          await this.prisma.doctor.update({
            where: { userId: id },
            data: {
              specialization: cleanedData.specialization,
              experience: parseInt(cleanedData.experience as string) || (existingUser as any).doctor.experience,
            },
          });
        }
        
        // Remove doctor-specific fields from main update
        delete cleanedData.specialization;
        delete cleanedData.experience;
      }

      // Update the user record
      const user = await this.prisma.user.update({
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
      await this.eventService.emit('user.updated', { userId: id, data: updateUserDto });

      const { password, ...result } = user;
      const userResponse = { ...result } as any;
      if (userResponse.dateOfBirth) {
        userResponse.dateOfBirth = userResponse.dateOfBirth.toISOString().split('T')[0];
      }
      return userResponse as UserResponseDto;
    } catch (error) {
      // Log the error
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Error updating user: ${error.message}`,
        'UsersService',
        { userId: id, error: error.stack }
      );
      
      // Rethrow as appropriate exception
      if (error.name === 'PrismaClientKnownRequestError') {
        if (error.code === 'P2025') {
          throw new NotFoundException(`User with ID ${id} not found`);
        } else if (error.code === 'P2002') {
          throw new Error(`Unique constraint violation: ${error.meta?.target}`);
        }
      }
      
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
      const user = await this.prisma.user.findUnique({
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
    if (user.role === Role.DOCTOR && (user as any).doctor) {
      await this.prisma.doctor.delete({
        where: { userId: id }
      });
    }
    if (user.role === Role.PATIENT && (user as any).patient) {
      await this.prisma.patient.delete({
        where: { userId: id }
      });
    }
    if (user.role === Role.RECEPTIONIST && (user as any).receptionists && (user as any).receptionists.length > 0) {
      await this.prisma.receptionist.delete({
        where: { userId: id }
      });
    }
    if (user.role === Role.CLINIC_ADMIN && (user as any).clinicAdmins && (user as any).clinicAdmins.length > 0) {
      await this.prisma.clinicAdmin.delete({
        where: { userId: id }
      });
    }
    if (user.role === Role.SUPER_ADMIN && (user as any).superAdmin) {
      await this.prisma.superAdmin.delete({
        where: { userId: id }
      });
    }

    // Delete user record
    await this.prisma.user.delete({
      where: { id }
    });

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

  private async logAuditEvent(
    userId: string,
    action: string,
    description: string,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        id: undefined,
        userId,
        action,
        description,
        timestamp: new Date(),
        ipAddress: '127.0.0.1',
        device: 'API',
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

  async logout(userId: string, sessionId?: string, clinicId?: string): Promise<void> {
    // Check if user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    try {
      // Create auth context for clinic logout
      const context: AuthPluginContext = {
        domain: AuthPluginDomain.CLINIC,
        clinicId,
        userAgent: 'API',
        ipAddress: '127.0.0.1',
        metadata: { userId },
      };

      // Use clinic auth service for secure logout
      await this.clinicAuthService.logout({
        userId,
        sessionId,
        clinicId,
        userAgent: context.userAgent,
        ipAddress: context.ipAddress
      });

      // Update last login timestamp
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          lastLogin: null
        }
      });

      // Clear all user-related cache
      await Promise.all([
        this.cacheService.del(`users:one:${userId}`),
        this.cacheService.del(`users:all`),
        this.cacheService.del(`users:${user.role.toLowerCase()}`),
        this.cacheService.del(`user:sessions:${userId}`)
      ]);

      // Log the logout event
      await this.logAuditEvent(userId, 'LOGOUT', 'User logged out successfully');
    } catch (error) {
      // Log the error
      await this.logAuditEvent(userId, 'LOGOUT_ERROR', `Logout failed: ${error.message}`);
      
      // Re-throw the error
      throw error;
    }
  }

  async updateUserRole(id: string, role: Role, createUserDto: CreateUserDto): Promise<UserResponseDto> {
      const user = await this.prisma.user.findUnique({
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
      await this.prisma.doctor.delete({
        where: { userId: id }
      });
    }
    if (user.role === Role.PATIENT && user.patient) {
      await this.prisma.patient.delete({
        where: { userId: id }
      });
    }
    if (user.role === Role.RECEPTIONIST && (user as any).receptionists && (user as any).receptionists.length > 0) {
      await this.prisma.receptionist.delete({
        where: { userId: id }
      });
    }
    if (user.role === Role.CLINIC_ADMIN && (user as any).clinicAdmins && (user as any).clinicAdmins.length > 0) {
      await this.prisma.clinicAdmin.delete({
        where: { userId: id }
      });
    }
    if (user.role === Role.SUPER_ADMIN && user.superAdmin) {
      await this.prisma.superAdmin.delete({
        where: { userId: id }
      });
    }

    // Create new role-specific record
    switch (role) {
      case Role.PATIENT:
        await this.prisma.patient.create({
          data: { userId: id }
        });
        break;
      case Role.DOCTOR:
        await this.prisma.doctor.create({
          data: {
            userId: id,
            specialization: '',
            experience: 0
          }
        });
        break;
      case Role.RECEPTIONIST:
        await this.prisma.receptionist.create({
          data: { userId: id }
        });
        break;
      case Role.CLINIC_ADMIN:
        const clinics = await this.prisma.clinic.findMany({
          take: 1
        });
        if (!clinics.length) {
          throw new Error('No clinic found. Please create a clinic first.');
        }
        await this.prisma.clinicAdmin.create({
          data: { 
        userId: id,
            clinicId: createUserDto.clinicId || clinics[0].id
          }
        });
        break;
      case Role.SUPER_ADMIN:
        await this.prisma.superAdmin.create({
          data: { userId: id }
        });
        break;
    }

    // Update user role
    const updatedUser = await this.prisma.user.update({
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
        this.cacheService.invalidateCacheByTag('users'),
      this.cacheService.invalidateCacheByTag(`user:${id}`),
      this.cacheService.invalidateCacheByTag(`users:${user.role.toLowerCase()}`),
      this.cacheService.invalidateCacheByTag(`users:${role.toLowerCase()}`),
    ]);

    const { password, ...result } = updatedUser;
    const userResponse = { ...result } as any;
    if (userResponse.dateOfBirth) {
      userResponse.dateOfBirth = userResponse.dateOfBirth.toISOString().split('T')[0];
    }
    return userResponse as UserResponseDto;
  }
}
