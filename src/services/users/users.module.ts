import { Module } from "@nestjs/common";
import { UsersService } from "./services/users.service";
import { UsersController } from "./controllers/users.controller";
import { PrismaModule } from "../../shared/database/prisma/prisma.module";
import { RedisModule } from "../../shared/cache/redis/redis.module";
import { KafkaModule } from "../../shared/messaging/kafka/kafka.module";

@Module({
  imports: [PrismaModule, RedisModule, KafkaModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
