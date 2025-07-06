import { Module } from "@nestjs/common";
import { UsersService } from "./users.service";
import { UsersController } from "./controllers/users.controller";
import { PrismaModule } from "../../shared/database/prisma/prisma.module";
import { RedisModule } from "../../shared/cache/redis/redis.module";
import { GuardsModule } from "../../libs/guards/guards.module";
import { RateLimitModule } from "../../shared/rate-limit/rate-limit.module";
import { LoggingModule } from "../../shared/logging/logging.module";
import { EventsModule } from "../../shared/events/events.module";
import { SharedModule } from '../../shared/shared.module';
import { PermissionsModule } from '../../shared/permissions';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    GuardsModule,
    RateLimitModule,
    LoggingModule,
    EventsModule,
    SharedModule,
    PermissionsModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
