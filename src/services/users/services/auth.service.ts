import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { PrismaService } from '../../../shared/database/prisma/prisma.service';
import { RedisService } from '../../../shared/cache/redis/redis.service';
import { CreateUserDto, UserResponseDto } from '../../../libs/dtos/user.dto';
import * as bcrypt from 'bcryptjs';
import { Role, User } from '@prisma/client';

@Injectable()
export class AuthService {
  private readonly SALT_ROUNDS = 10; // 2^10 iterations, ~10 hashes/sec on 2GHz core

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
  ) {
    this.ensureSuperAdmin();
  }

  private async ensureSuperAdmin() {
    const superAdminEmail = 'superadmin@healthcare.com';
    console.log('Checking for existing super admin...');
    
    const existingSuperAdmin = await this.prisma.user.findFirst({
      where: { role: Role.SUPER_ADMIN }
    });

    if (!existingSuperAdmin) {
      console.log('No super admin found, creating one...');
      const hashedPassword = await bcrypt.hash('superadmin123', this.SALT_ROUNDS);
      try {
        const superAdmin = await this.prisma.user.create({
          data: {
            email: superAdminEmail,
            password: hashedPassword,
            name: 'Super Admin',
            firstName: 'Super',
            lastName: 'Admin',
            phone: '+1234567890',
            role: Role.SUPER_ADMIN,
            age: 30,
            isVerified: true,
          }
        });

        await this.prisma.superAdmin.create({
          data: {
            userId: superAdmin.id,
          }
        });

        console.log('Super admin account created successfully:', superAdmin.id);
      } catch (error) {
        console.error('Error creating super admin:', error);
      }
    } else {
      console.log('Super admin already exists:', existingSuperAdmin.id);
      console.log('Super admin details:', {
        email: existingSuperAdmin.email,
        role: existingSuperAdmin.role
      });
    }
  }

  async validateUser(email: string, password: string): Promise<any> {
    console.log(`Attempting to validate user with email: ${email}`);
    
    // First try exact match
    let user = await this.prisma.user.findUnique({ 
      where: { email },
      include: { superAdmin: true }
    });

    if (!user) {
      // Try case-insensitive search
      user = await this.prisma.user.findFirst({
        where: {
          email: {
            mode: 'insensitive',
            equals: email
          }
        },
        include: { superAdmin: true }
      });
    }

    if (!user) {
      console.log('User not found. Checking all users in database...');
      const allUsers = await this.prisma.user.findMany({
        select: { email: true, role: true }
      });
      console.log('Available users:', allUsers);
      return null;
    }

    console.log('Found user:', { id: user.id, email: user.email, role: user.role });
    const isPasswordValid = await bcrypt.compare(password, user.password);
    console.log(`Password validation result: ${isPasswordValid}`);

    if (isPasswordValid) {
      const { password, ...result } = user;
      return result;
    }
    return null;
  }

  async login(user: User) {
    const payload = { email: user.email, sub: user.id, role: user.role };
    const token = this.jwtService.sign(payload);
    
    // Store session in Redis
    await this.redisService.set(`session:${user.id}`, JSON.stringify({
      userId: user.id,
      email: user.email,
      role: user.role,
      lastLogin: new Date(),
    }), 24 * 60 * 60); // 24 hours expiry

    // Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    return {
      access_token: token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    };
  }

  async register(createUserDto: CreateUserDto): Promise<UserResponseDto> {
    // Generate hash with $2b$ prefix (most secure version) and 10 rounds
    const hashedPassword = await bcrypt.hash(createUserDto.password, this.SALT_ROUNDS);
    
    const user = await this.prisma.user.create({
      data: {
        ...createUserDto,
        password: hashedPassword,
      },
    });

    // Create role-specific record
    switch (user.role) {
      case Role.PATIENT:
        await this.prisma.patient.create({
          data: {
            userId: user.id,
          },
        });
        break;
      case Role.DOCTOR:
        await this.prisma.doctor.create({
          data: {
            userId: user.id,
            specialization: '', // Required field, should be provided in extended DTO
            experience: 0, // Required field, should be provided in extended DTO
          },
        });
        break;
      case Role.RECEPTIONIST:
        await this.prisma.receptionist.create({
          data: {
            userId: user.id,
          },
        });
        break;
      case Role.CLINIC_ADMIN:
        // Clinic admin requires a clinic ID, should be handled separately
        break;
    }

    const { password, ...result } = user;
    return result as UserResponseDto;
  }

  async logout(userId: string): Promise<void> {
    await this.redisService.del(`session:${userId}`);
  }

  async validateToken(token: string): Promise<any> {
    try {
      const payload = this.jwtService.verify(token);
      const session = await this.redisService.get(`session:${payload.sub}`);
      
      if (!session) {
        throw new UnauthorizedException('Session expired');
      }
      
      return payload;
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }
} 