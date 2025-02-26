import { Injectable } from "@nestjs/common";
import { User, Role } from '@prisma/client';
import { getPrismaClient } from '../../../shared/database/prisma/prisma.types';
import { PrismaService } from "../../../shared/database/prisma/prisma.service";
import { RedisService } from "../../../shared/cache/redis/redis.service";
import { KafkaService } from "../../../shared/messaging/kafka/kafka.service";
import { RedisCache } from "../../../shared/cache/decorators/redis-cache.decorator";
import { CreateUserDto } from '../../../libs/dtos/user.dto';

@Injectable()
export class UsersService {
  private prisma = getPrismaClient();

  constructor(
    private redis: RedisService,
    private kafka: KafkaService
  ) {}

  @RedisCache({ prefix: "users:all", ttl: 3600 })
  async findAll(): Promise<User[]> {
    return await this.prisma.user.findMany();
  }

  @RedisCache({ prefix: "users:one", ttl: 3600 })
  async findOne(id: string): Promise<User | null> {
    return await this.prisma.user.findUnique({
      where: { id },
    });
  }

  async count(): Promise<number> {
    return await this.prisma.user.count();
  }

  async createUser(data: CreateUserDto): Promise<User> {
    const user = await this.prisma.user.create({
      data: {
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
}
