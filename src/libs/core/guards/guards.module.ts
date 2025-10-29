import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { RolesGuard } from "./roles.guard";
import { ClinicGuard } from "./clinic.guard";
import { RbacGuard } from "../rbac/rbac.guard";
import { RedisModule } from "../../infrastructure/cache/redis/redis.module";
import { RateLimitModule } from "../../security/rate-limit/rate-limit.module";
import { RateLimitService } from "../../security/rate-limit/rate-limit.service";
import { PrismaModule } from "../../infrastructure/database/prisma/prisma.module";
import { LoggingService } from "../../infrastructure/logging/logging.service";
import { RbacModule } from "../rbac/rbac.module";
import { Reflector } from "@nestjs/core";
import { LoggingModule } from "src/libs/infrastructure/logging";
import { JwtAuthService } from "../../../services/auth/core/jwt.service";
import { CacheModule } from "../../infrastructure/cache/cache.module";

/**
 * Guards Module for Healthcare Applications
 *
 * @module GuardsModule
 * @description Centralized module for all authentication and authorization guards.
 * Provides JWT authentication, role-based access control, clinic isolation, and RBAC guards.
 *
 * @example
 * ```typescript
 * // app.module.ts
 * import { GuardsModule } from '@libs/core/guards';
 *
 * @Module({
 *   imports: [
 *     GuardsModule,
 *     // ... other modules
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
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
