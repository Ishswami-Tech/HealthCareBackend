import { Module } from "@nestjs/common";
import { AuthController } from "./controllers/auth.controller";
import { PrismaModule } from "../../shared/database/prisma/prisma.module";
import { RedisModule } from "../../shared/cache/redis/redis.module";
import { KafkaModule } from "../../shared/messaging/kafka/kafka.module";
import { UsersModule } from "../users/users.module";
import { AuthService } from "./services/auth.service";
import { GuardsModule } from "../../libs/guards/guards.module";
import { RateLimitModule } from "../../shared/rate-limit/rate-limit.module";

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    KafkaModule,
    UsersModule,
    GuardsModule,
    RateLimitModule,
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {} 