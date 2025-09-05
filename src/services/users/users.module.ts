import { Module, forwardRef } from "@nestjs/common";
import { UsersService } from "./users.service";
import { UsersController } from "./controllers/users.controller";
import { PrismaModule } from "../../libs/infrastructure/database/prisma/prisma.module";
import { CacheServiceModule } from "../../libs/infrastructure/cache/cache-service.module";
import { GuardsModule } from "../../libs/core/guards/guards.module";
import { RateLimitModule } from "../../libs/utils/rate-limit/rate-limit.module";
import { LoggingServiceModule } from "../../libs/infrastructure/logging";
import { EventsModule } from "../../libs/infrastructure/events/events.module";
import { RbacModule } from '../../libs/core/rbac/rbac.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    PrismaModule,
    CacheServiceModule,
    GuardsModule,
    RateLimitModule,
    LoggingServiceModule,
    EventsModule,
    RbacModule,
    forwardRef(() => AuthModule),
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
