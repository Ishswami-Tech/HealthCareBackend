import { Injectable, NotFoundException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma/prisma.service';
import { LoggingService } from '../../shared/logging/logging.service';
import { EventService } from '../../shared/events/event.service';
import { LogLevel, LogType } from '../../shared/logging/types/logging.types';

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
  ) {}

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

      if (!creator || creator.role !== Role.SUPER_ADMIN || !creator.superAdmin) {
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

      const user = await this.prisma.user.create({
        data: {
          email: data.email,
          password: data.password,
          name: data.name,
          role: data.role,
          age: 0,
          isVerified: false,
          createdAt: new Date(),
          updatedAt: new Date()
        },
      });

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'User created successfully',
        'UsersService',
        { userId: user.id, email: data.email, role: data.role }
      );

      await this.eventService.emit('user.created', {
        userId: user.id,
        email: data.email,
        role: data.role,
        createdBy: data.createdBy
      });

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

  async getAllUsers(userId: string) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: { superAdmin: true },
      });

      if (!user || user.role !== Role.SUPER_ADMIN || !user.superAdmin) {
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

      const user = await this.prisma.user.findUnique({
        where: { id },
      });

      if (!user) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'User not found for update',
          'UsersService',
          { userId: id }
        );
        throw new NotFoundException('User not found');
      }

      if (data.email && data.email !== user.email) {
        const existingUser = await this.prisma.user.findUnique({
          where: { email: data.email },
        });

        if (existingUser) {
          await this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            'User update failed - email already exists',
            'UsersService',
            { userId: id, email: data.email }
          );
          throw new ConflictException('Email already exists');
        }
      }

      const updatedUser = await this.prisma.user.update({
        where: { id },
        data,
      });

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'User updated successfully',
        'UsersService',
        { userId: id, updatedFields: Object.keys(data) }
      );

      await this.eventService.emit('user.updated', {
        userId: id,
        updatedFields: Object.keys(data),
        updatedBy: userId
      });

      return updatedUser;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to update user',
        'UsersService',
        { error: error.message, userId: id, ...data }
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

      if (!requestingUser) {
        await this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'User not found while deleting user',
          'UsersService',
          { userId }
        );
        throw new NotFoundException('User not found');
      }

      if (requestingUser.role !== Role.SUPER_ADMIN) {
        await this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'Unauthorized user deletion attempt',
          'UsersService',
          { requestingUserId: userId, targetUserId: id }
        );
        throw new UnauthorizedException('Only SuperAdmin can delete users');
      }

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

      return { message: 'User deleted successfully' };
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