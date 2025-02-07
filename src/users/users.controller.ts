import { Controller, Get, Post, Body } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { UsersService } from "./users.service";
import { UserResponseDto, CreateUserDto } from "./user.entity";
import { RedisService } from "../redis/redis.service";
import { KafkaService } from "../kafka/kafka.service";
import { PrismaService } from "../prisma/prisma.service";

@ApiTags("users")
@Controller("users")
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly redis: RedisService,
    private readonly kafka: KafkaService,
    private readonly prisma: PrismaService
  ) {}

  @Get()
  @ApiOperation({ summary: "Get all users" })
  @ApiResponse({
    status: 200,
    description: "Return all users",
    type: [UserResponseDto],
  })
  findAll() {
    return this.usersService.findAll();
  }

  @Post()
  @ApiOperation({ summary: "Create user" })
  @ApiResponse({
    status: 201,
    description: "User created successfully",
    type: UserResponseDto,
  })
  create(@Body() userData: CreateUserDto) {
    return this.usersService.createUser(userData);
  }

  @Get("monitoring/cache-status")
  @ApiOperation({ summary: "Check Redis cache status" })
  async checkCacheStatus() {
    const allUsersCache = await this.redis.get("users:all");
    return {
      isCacheConnected: !!this.redis,
      allUsersCached: !!allUsersCache,
      cachedUsersCount: allUsersCache
        ? (JSON.parse(allUsersCache) as unknown[]).length
        : 0,
    };
  }

  @Get("monitoring/kafka-status")
  @ApiOperation({ summary: "Check Kafka status" })
  async checkKafkaStatus() {
    return await this.kafka.getStatus();
  }

  @Get("monitoring/status")
  @ApiOperation({ summary: "Check all services status" })
  async checkAllServices() {
    const [kafkaStatus, redisStatus, cacheStatus] = await Promise.all([
      this.kafka.getDetailedStatus(),
      this.redis.getStatus(),
      this.checkCacheStatus(),
    ]);

    return {
      kafka: kafkaStatus,
      redis: redisStatus,
      cache: cacheStatus,
      timestamp: new Date().toISOString(),
    };
  }

  @Post("monitoring/test-message")
  @ApiOperation({ summary: "Send test message to Kafka" })
  async sendTestMessage() {
    const testMessage = {
      type: "TEST_EVENT",
      data: { test: true },
      timestamp: new Date().toISOString(),
    };

    await this.kafka.sendMessage("user-events", testMessage);
    return { success: true, message: "Test message sent" };
  }

  @Get("monitoring/redis-keys")
  @ApiOperation({ summary: "List all Redis keys and their types" })
  async listRedisKeys() {
    const keys = await this.redis.keys("*");
    const keyDetails = await Promise.all(
      keys.map(async (key) => ({
        key,
        type: await this.redis.type(key),
        ttl: await this.redis.ttl(key),
      }))
    );

    return keyDetails;
  }

  @Get("redis-health")
  async checkRedisHealth() {
    try {
      const testKey = "health-check";
      await this.redis.set(testKey, "OK", 60);
      const result = await this.redis.get(testKey);
      return {
        status: "healthy",
        connected: result === "OK",
      };
    } catch (error) {
      return {
        status: "unhealthy",
        error: error.message,
      };
    }
  }

  @Get("cache/debug")
  async debugCache() {
    const allKeys = await this.redis.keys("*");
    const cacheDetails = await Promise.all(
      allKeys.map(async (key) => ({
        key,
        type: await this.redis.type(key),
        ttl: await this.redis.ttl(key),
        value: await this.redis.get(key),
      }))
    );

    return {
      totalKeys: allKeys.length,
      keys: cacheDetails,
    };
  }

  @Get("monitoring/redis-status")
  @ApiOperation({ summary: "Get Redis status and cache statistics" })
  async getRedisStatus() {
    try {
      // Basic connectivity check
      const healthCheck = await this.checkRedisHealth();

      // Get cache statistics
      const [dbUsers, cachedUsers, cacheHits, cacheMisses] = await Promise.all([
        this.prisma.user.count(),
        this.redis.get("users:all"),
        this.redis.get("cache:hits:total"),
        this.redis.get("cache:misses:total"),
      ]);

      // Calculate hit ratio
      const hits = parseInt(cacheHits || "0");
      const misses = parseInt(cacheMisses || "0");
      const hitRatio = hits + misses > 0 ? (hits / (hits + misses)) * 100 : 0;

      return {
        status: {
          isConnected: healthCheck.status === "healthy",
          lastCheck: new Date().toISOString(),
        },
        cacheStats: {
          databaseRecords: dbUsers,
          cachedRecords: cachedUsers ? JSON.parse(cachedUsers).length : 0,
          performance: {
            hits,
            misses,
            hitRatio: `${hitRatio.toFixed(2)}%`,
          },
        },
      };
    } catch (error) {
      return {
        status: "error",
        message: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  @Get("cache/stats")
  @ApiOperation({ summary: "Get Redis cache statistics" })
  async getCacheStats() {
    try {
      // Get all users from database
      const dbUsers = await this.prisma.user.count();

      // Get cached users
      const cachedAllUsers = await this.redis.get("users:all");
      const allKeys = await this.redis.keys("users:*");

      // Get individual cached users
      const individualCacheKeys = allKeys.filter((key) =>
        key.startsWith("users:one:")
      );

      return {
        databaseCount: dbUsers,
        cachedListCount: cachedAllUsers ? JSON.parse(cachedAllUsers).length : 0,
        individualCachedCount: individualCacheKeys.length,
        cacheKeys: allKeys,
        cacheHitRatio: {
          total: (await this.redis.get("cache:hits:total")) || "0",
          misses: (await this.redis.get("cache:misses:total")) || "0",
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
