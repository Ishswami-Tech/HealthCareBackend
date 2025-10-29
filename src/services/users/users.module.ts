import { Module } from "@nestjs/common";
import { UsersService } from "./users.service";
import { UsersController } from "./controllers/users.controller";
import { PrismaModule } from "../../libs/infrastructure/database/prisma/prisma.module";
import { GuardsModule } from "../../libs/core/guards/guards.module";
import { RateLimitModule } from "../../libs/security/rate-limit/rate-limit.module";
import { EventsModule } from "../../libs/infrastructure/events/events.module";
import { RbacModule } from "../../libs/core/rbac/rbac.module";
import { AuthModule } from "../auth/auth.module";
import { LoggingServiceModule } from "../../libs/infrastructure/logging/logging-service.module";
import { ErrorsModule } from "../../libs/core/errors/errors.module";

@Module({
  imports: [
    PrismaModule,
    GuardsModule,
    RateLimitModule,
    EventsModule,
    RbacModule,
    AuthModule,
    LoggingServiceModule,
    ErrorsModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
