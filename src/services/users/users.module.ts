import { Module } from "@nestjs/common";
import { UsersService } from "./services/users.service";
import { UsersController } from "./controllers/users.controller";
import { PrismaModule } from "../../shared/database/prisma/prisma.module";
import { RedisModule } from "../../shared/cache/redis/redis.module";
import { GuardsModule } from "../../libs/guards/guards.module";
import { RateLimitModule } from "../../shared/rate-limit/rate-limit.module";

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    GuardsModule,
    RateLimitModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
