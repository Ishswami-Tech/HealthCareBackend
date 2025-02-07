import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { User, Prisma } from "@prisma/client";
import { KafkaService } from "../kafka/kafka.service";
import { RedisCache } from "../utils/redis-cache.decorator";

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private kafka: KafkaService
  ) {}

  @RedisCache("users:all", 3600)
  async findAll(): Promise<User[]> {
    return await this.prisma.user.findMany();
  }

  @RedisCache("users:one", 3600)
  async findOne(id: any): Promise<User | null> {
    return await this.prisma.user.findUnique({
      where: { id },
    });
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
