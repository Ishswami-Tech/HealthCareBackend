import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { User } from '@prisma/client';
import { RedisCache } from '../utils/redis-cache.decorator';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  @RedisCache('users:all', 3600)
  async findAll(): Promise<User[]> {
    return await this.prisma.user.findMany();
  }

  @RedisCache('users:one', 3600)
  async findOne(id: number): Promise<User | null> {
    return await this.prisma.user.findUnique({
      where: {
        id: id as any, // Type assertion to bypass the type check
      },
    });
  }

  async createUser(
    data: Omit<User, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<User> {
    const user = await this.prisma.user.create({ data });
    await this.redis.del('users:all');
    return user;
  }
}
