import { Module } from "@nestjs/common";
import { UsersService } from "./users.service";
import { UsersController } from "./controllers/users.controller";
import { PrismaModule } from "../../libs/infrastructure/database/prisma/prisma.module";
import { RedisModule } from "../../libs/infrastructure/cache/redis/redis.module";
import { GuardsModule } from "../../libs/core/guards/guards.module";
import { RateLimitModule } from "../../libs/utils/rate-limit/rate-limit.module";
import { LoggingModule } from "../../libs/infrastructure/logging/logging.module";
import { EventsModule } from "../../libs/infrastructure/events/events.module";
import { PermissionsModule } from '../../libs/infrastructure/permissions';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    GuardsModule,
    RateLimitModule,
    LoggingModule,
    EventsModule,
    PermissionsModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
