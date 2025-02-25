import { Injectable } from "@nestjs/common";
import { User, Prisma } from "@prisma/client";
import { PrismaService } from "../../../shared/database/prisma/prisma.service";
import { RedisService } from "../../../shared/cache/redis/redis.service";
import { KafkaService } from "../../../shared/messaging/kafka/kafka.service";
import { RedisCache } from "../../../shared/cache/decorators/redis-cache.decorator";

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
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

  async createUser(
    data: Omit<Prisma.UserCreateInput, "id" | "createdAt" | "updatedAt">
  ): Promise<User> {
    const user = await this.prisma.user.create({ data });

    // Invalidate related caches
    await Promise.all([
      this.redis.del("users:all"),
      this.redis.del(`users:one:${user.id}`),
    ]);

    await this.kafka.sendMessage("user-events", {
      type: "USER_CREATED",
      data: user,
      timestamp: new Date().toISOString(),
    });

    return user;
  }
}
