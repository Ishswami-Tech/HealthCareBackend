import { Injectable, NotFoundException } from '@nestjs/common';
import { Role, User, Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/database/prisma/prisma.service';
import { RedisCache } from '../../../shared/cache/decorators/redis-cache.decorator';
import { CreateUserDto, UpdateUserDto, UserResponseDto } from '../../../libs/dtos/user.dto';
import { RedisService } from '../../../shared/cache/redis/redis.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @RedisCache({ prefix: "users:all", ttl: 3600 })
  async findAll(role?: Role): Promise<UserResponseDto[]> {
    const users = await this.prisma.user.findMany({
      where: role ? { role } : undefined,
      include: {
        doctor: role === Role.DOCTOR,
        patient: role === Role.PATIENT,
        receptionist: role === Role.RECEPTIONIST,
        clinicAdmin: role === Role.CLINIC_ADMIN,
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

  @RedisCache({ prefix: "users:one", ttl: 3600 })
  async findOne(id: string): Promise<UserResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        doctor: true,
        patient: true,
        receptionist: true,
        clinicAdmin: true,
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
        receptionist: true,
        clinicAdmin: true,
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
    const currentId = await this.redis.get(COUNTER_KEY);
    const nextId = currentId ? parseInt(currentId) + 1 : 1;
    await this.redis.set(COUNTER_KEY, nextId.toString());
    return `UID${nextId.toString().padStart(6, '0')}`;
  }

  async createUser(data: CreateUserDto): Promise<User> {
    const userId = await this.getNextNumericId();
    const user = await this.prisma.user.create({
      data: {
        id: userId,
        email: data.email,
        password: data.password,
        name: data.name,
        age: data.age || 0,
        firstName: data.firstName || '',
        lastName: data.lastName || '',
        phone: data.phone,
        role: data.role as Role || Role.PATIENT,
        profilePicture: data.profilePicture || null,
        gender: data.gender || null,
        dateOfBirth: data.dateOfBirth || null,
        address: data.address || null,
        city: data.city || null,
        state: data.state || null,
        country: data.country || null,
        zipCode: data.zipCode || null,
        isVerified: false,
        lastLogin: data.lastLogin || null
      }
    });
    return user;
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<UserResponseDto> {
    const user = await this.prisma.user.update({
      where: { id },
      data: updateUserDto,
      include: {
        doctor: true,
        patient: true,
        receptionist: true,
        clinicAdmin: true,
        superAdmin: true,
      },
    });

    // Invalidate cache
    await Promise.all([
      this.redis.del(`users:one:${id}`),
      this.redis.del('users:all'),
      this.redis.del(`users:${user.role.toLowerCase()}`),
    ]);

    const { password, ...result } = user;
    const userResponse = { ...result } as any;
    if (userResponse.dateOfBirth) {
      userResponse.dateOfBirth = userResponse.dateOfBirth.toISOString().split('T')[0];
    }
    return userResponse as UserResponseDto;
  }

  async remove(id: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        doctor: true,
        patient: true,
        receptionist: true,
        clinicAdmin: true,
        superAdmin: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    // Delete role-specific record first
    switch (user.role) {
      case Role.DOCTOR:
        if (user.doctor) {
          await this.prisma.doctor.delete({
            where: { userId: id }
          });
        }
        break;
      case Role.PATIENT:
        if (user.patient) {
          await this.prisma.patient.delete({
            where: { userId: id }
          });
        }
        break;
      case Role.RECEPTIONIST:
        if (user.receptionist) {
          await this.prisma.receptionist.delete({
            where: { userId: id }
          });
        }
        break;
      case Role.CLINIC_ADMIN:
        if (user.clinicAdmin) {
          await this.prisma.clinicAdmin.delete({
            where: { userId: id }
          });
        }
        break;
      case Role.SUPER_ADMIN:
        if (user.superAdmin) {
          await this.prisma.superAdmin.delete({
            where: { userId: id }
          });
        }
        break;
    }

    // Delete user record
    await this.prisma.user.delete({
      where: { id }
    });

    // Invalidate cache
    await Promise.all([
      this.redis.del(`users:one:${id}`),
      this.redis.del('users:all'),
      this.redis.del(`users:${user.role.toLowerCase()}`),
    ]);
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

  async logout(userId: string): Promise<void> {
    // Check if user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    try {
      // Update last login timestamp
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          lastLogin: null
        }
      });

      // Clear all user-related cache
      await Promise.all([
        this.redis.del(`users:one:${userId}`),
        this.redis.del(`users:all`),
        this.redis.del(`users:${user.role.toLowerCase()}`),
        this.redis.del(`user:sessions:${userId}`)
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
        receptionist: true,
        clinicAdmin: true,
        superAdmin: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    // Delete old role-specific record
    switch (user.role) {
      case Role.DOCTOR:
        if (user.doctor) {
          await this.prisma.doctor.delete({
            where: { userId: id }
          });
        }
        break;
      case Role.PATIENT:
        if (user.patient) {
          await this.prisma.patient.delete({
            where: { userId: id }
          });
        }
        break;
      case Role.RECEPTIONIST:
        if (user.receptionist) {
          await this.prisma.receptionist.delete({
            where: { userId: id }
          });
        }
        break;
      case Role.CLINIC_ADMIN:
        if (user.clinicAdmin) {
          await this.prisma.clinicAdmin.delete({
            where: { userId: id }
          });
        }
        break;
      case Role.SUPER_ADMIN:
        if (user.superAdmin) {
          await this.prisma.superAdmin.delete({
            where: { userId: id }
          });
        }
        break;
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
        receptionist: true,
        clinicAdmin: true,
        superAdmin: true,
      },
    });

    // Invalidate cache
    await Promise.all([
      this.redis.del(`users:one:${id}`),
      this.redis.del('users:all'),
      this.redis.del(`users:${user.role.toLowerCase()}`),
      this.redis.del(`users:${role.toLowerCase()}`),
    ]);

    const { password, ...result } = updatedUser;
    const userResponse = { ...result } as any;
    if (userResponse.dateOfBirth) {
      userResponse.dateOfBirth = userResponse.dateOfBirth.toISOString().split('T')[0];
    }
    return userResponse as UserResponseDto;
  }
}
