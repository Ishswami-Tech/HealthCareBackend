import { Injectable, NotFoundException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma/prisma.service';
import { LoggingService } from '../../shared/logging/logging.service';
import { EventService } from '../../shared/events/event.service';
import { LogLevel, LogType } from '../../shared/logging/types/logging.types';
import { RedisCache } from '../../shared/cache/decorators/redis-cache.decorator';
import { RedisService } from '../../shared/cache/redis/redis.service';

// Define the Role enum locally since it's not exported from @prisma/client
enum Role {
  SUPER_ADMIN = 'SUPER_ADMIN',
  CLINIC_ADMIN = 'CLINIC_ADMIN',
  DOCTOR = 'DOCTOR',
  PATIENT = 'PATIENT',
}

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService,
    private readonly redis: RedisService,
  ) {}

  private async generateNextUID(): Promise<string> {
    // Get the last user with a UID
    const lastUser = await this.prisma.user.findFirst({
      where: {
        userid: {
          startsWith: 'UID'
        }
      },
      orderBy: {
        userid: 'desc'
      }
    });

    let nextNumber = 1;
    if (lastUser && lastUser.userid) {
      // Extract the number from the last UID and increment it
      const lastNumber = parseInt(lastUser.userid.replace('UID', ''));
      nextNumber = lastNumber + 1;
    }

    // Format the new UID with leading zeros (6 digits)
    return `UID${nextNumber.toString().padStart(6, '0')}`;
  }

  async createUser(data: {
    email: string;
    password: string;
    name: string;
    role: Role;
    createdBy: string;
  }) {
    try {
      const creator = await this.prisma.user.findUnique({
        where: { id: data.createdBy },
        include: { superAdmin: true },
      });

      if (!creator || creator.role !== Role.SUPER_ADMIN) {
        await this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'Unauthorized user creation attempt',
          'UsersService',
          { userId: data.createdBy }
        );
        throw new UnauthorizedException('Only SuperAdmin can create users');
      }

      const existingUser = await this.prisma.user.findUnique({
        where: { email: data.email },
      });

      if (existingUser) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'User creation failed - email already exists',
          'UsersService',
          { email: data.email }
        );
        throw new ConflictException('Email already exists');
      }

      // Generate the next UID
      const userid = await this.generateNextUID();

      const user = await this.prisma.user.create({
        data: {
          email: data.email,
          password: data.password,
          name: data.name,
          role: data.role,
          age: 0,
          isVerified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
          userid: userid
        },
      });

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'User created successfully',
        'UsersService',
        { userId: user.id, userid: user.userid, email: data.email, role: data.role }
      );

      await this.eventService.emit('user.created', {
        userId: user.id,
        userid: user.userid,
        email: data.email,
        role: data.role,
        createdBy: data.createdBy
      });

      // Invalidate any user list caches when a new user is created
      await this.redis.invalidateCacheByTag('users');

      return user;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to create user',
        'UsersService',
        { error: error.message, ...data }
      );
      throw error;
    }
  }

  @RedisCache({
    ttl: 600,              // 10 minutes cache TTL
    prefix: 'users:list',  // Cache key prefix
    staleTime: 300,        // Data becomes stale after 5 minutes
    tags: ['users']        // Tag for grouped invalidation
  })
  async getAllUsers(userId: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { superAdmin: true },
      });

      if (!user || user.role !== Role.SUPER_ADMIN) {
        await this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'Unauthorized user list access attempt',
          'UsersService',
          { userId }
        );
        throw new UnauthorizedException('Only SuperAdmin can view all users');
      }

      const users = await this.prisma.user.findMany({
        include: {
          superAdmin: true,
          clinicAdmin: true,
          doctor: true,
          patient: true,
        },
      });

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Users fetched successfully',
        'UsersService',
        { count: users.length }
      );

      return users;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to fetch users',
        'UsersService',
        { error: error.message, userId }
      );
      throw error;
    }
  }

  @RedisCache({
    ttl: 1800,                  // 30 minutes cache TTL
    prefix: 'users:profile',    // Cache key prefix
    staleTime: 600,             // Data becomes stale after 10 minutes
    tags: ['users', 'user']     // Tags for grouped invalidation
  })
  async getUserById(id: string, userId: string) {
    try {
      const requestingUser = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { superAdmin: true },
      });

      if (!requestingUser) {
        await this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'User not found while fetching user',
          'UsersService',
          { userId }
        );
        throw new NotFoundException('User not found');
      }

      if (requestingUser.role !== Role.SUPER_ADMIN && id !== userId) {
        await this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'Unauthorized user access attempt',
          'UsersService',
          { requestingUserId: userId, targetUserId: id }
        );
        throw new UnauthorizedException('You do not have permission to view this user');
      }

      const user = await this.prisma.user.findUnique({
        where: { id },
        include: {
          superAdmin: true,
          clinicAdmin: true,
          doctor: true,
          patient: true,
        },
      });

      if (!user) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'User not found',
          'UsersService',
          { userId: id }
        );
        throw new NotFoundException('User not found');
      }

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'User fetched successfully',
        'UsersService',
        { userId: id }
      );

      return user;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to fetch user',
        'UsersService',
        { error: error.message, userId: id }
      );
      throw error;
    }
  }

  async updateUser(id: string, data: {
    name?: string;
    email?: string;
    password?: string;
    role?: Role;
  }, userId: string) {
    try {
      const requestingUser = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { superAdmin: true },
      });

      if (!requestingUser) {
        await this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'User not found while updating user',
          'UsersService',
          { userId }
        );
        throw new NotFoundException('User not found');
      }

      if (requestingUser.role !== Role.SUPER_ADMIN && id !== userId) {
        await this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'Unauthorized user update attempt',
          'UsersService',
          { requestingUserId: userId, targetUserId: id }
        );
        throw new UnauthorizedException('You do not have permission to update this user');
      }

      // If email is being updated, check if it's already taken
      if (data.email) {
        const existingUser = await this.prisma.user.findFirst({
          where: {
            email: data.email,
            id: { not: id },
          },
        });

        if (existingUser) {
          await this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            'User update failed - email already exists',
            'UsersService',
            { email: data.email }
          );
          throw new ConflictException('Email already exists');
        }
      }

      const user = await this.prisma.user.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'User updated successfully',
        'UsersService',
        { userId: id }
      );

      await this.eventService.emit('user.updated', {
        userId: id,
        updatedBy: userId,
        data
      });

      // Invalidate user-specific and users list caches
      await Promise.all([
        this.redis.invalidateCache(`users:profile:${id}:${userId}`),
        this.redis.invalidateCacheByTag('users'),
        this.redis.invalidateCacheByTag(`user:${id}`)
      ]);

      return user;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to update user',
        'UsersService',
        { error: error.message, userId: id }
      );
      throw error;
    }
  }

  async deleteUser(id: string, userId: string) {
    try {
      const requestingUser = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { superAdmin: true },
      });

      if (!requestingUser || requestingUser.role !== Role.SUPER_ADMIN) {
        await this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'Unauthorized user deletion attempt',
          'UsersService',
          { requestingUserId: userId, targetUserId: id }
        );
        throw new UnauthorizedException('Only SuperAdmin can delete users');
      }

      // Check if user exists
      const user = await this.prisma.user.findUnique({
        where: { id },
      });

      if (!user) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'User not found for deletion',
          'UsersService',
          { userId: id }
        );
        throw new NotFoundException('User not found');
      }

      // Delete the user
      await this.prisma.user.delete({
        where: { id },
      });

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'User deleted successfully',
        'UsersService',
        { userId: id }
      );

      await this.eventService.emit('user.deleted', {
        userId: id,
        deletedBy: userId
      });

      // Invalidate all user-related caches
      await Promise.all([
        this.redis.invalidateCache(`users:profile:${id}:${userId}`),
        this.redis.invalidateCacheByTag('users'),
        this.redis.invalidateCacheByTag(`user:${id}`)
      ]);

      return { success: true, message: 'User deleted successfully' };
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to delete user',
        'UsersService',
        { error: error.message, userId: id }
      );
      throw error;
    }
  }
} 