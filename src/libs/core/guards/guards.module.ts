import { Module, forwardRef } from "@nestjs/common";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { RolesGuard } from "./roles.guard";
import { ClinicGuard } from "./clinic.guard";
import { RbacGuard } from "../rbac/rbac.guard";
import { RedisModule } from "../../infrastructure/cache/redis/redis.module";
import { RateLimitModule } from "../../utils/rate-limit/rate-limit.module";
import { RateLimitService } from "../../utils/rate-limit/rate-limit.service";
import { PrismaModule } from "../../infrastructure/database/prisma/prisma.module";
import { LoggingService } from "../../infrastructure/logging/logging.service";
import { RbacModule } from "../rbac/rbac.module";
import { Reflector } from "@nestjs/core";
import { LoggingModule } from "src/libs/infrastructure/logging";
import { JwtAuthService } from "../../../services/auth/core/jwt.service";
import { CacheModule } from "../../infrastructure/cache/cache.module";

@Module({
  imports: [
    JwtModule,
    RedisModule,
    RateLimitModule,
    PrismaModule,
    LoggingModule,
    RbacModule,
    CacheModule,
  ],
  providers: [
    JwtAuthGuard,
    JwtAuthService,
    RolesGuard,
    ClinicGuard,
    RbacGuard,
    Reflector,
    LoggingService,
    RateLimitService,
  ],
  exports: [
    JwtAuthGuard,
    RolesGuard,
    ClinicGuard,
    RbacGuard,
    LoggingService,
    JwtModule,
    RateLimitModule,
    RateLimitService,
    JwtAuthService,
  ],
})
export class GuardsModule {}
