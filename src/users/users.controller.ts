import { Controller, Get, Post, Body } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { UsersService } from "./users.service";
import { UserResponseDto, CreateUserDto } from "./user.entity";
import { RedisService } from "../redis/redis.service";
import { KafkaService } from "../kafka/kafka.service";

@ApiTags("users")
@Controller("users")
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly redis: RedisService,
    private readonly kafka: KafkaService
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
}
