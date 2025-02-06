import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { User, Prisma } from '@prisma/client';
import { RedisCache } from '../utils/redis-cache.decorator';
import { KafkaService } from '../kafka/kafka.service';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private kafka: KafkaService,
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
    data: Omit<Prisma.UserCreateInput, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<User> {
    const user = await this.prisma.user.create({ data });
    await this.redis.del('users:all');

    await this.kafka.sendMessage('user-events', {
      type: 'USER_CREATED',
      data: user,
      timestamp: new Date().toISOString(),
    });

    return user;
  }

  async checkCache(key: string): Promise<string | null> {
    return await this.redis.get(key);
  }
}
