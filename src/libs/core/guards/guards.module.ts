import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { ClinicGuard } from './clinic.guard';
import { RedisModule } from '@infrastructure/cache/redis/redis.module';
import { RateLimitModule } from '@security/rate-limit/rate-limit.module';
import { RateLimitService } from '@security/rate-limit/rate-limit.service';
import { DatabaseModule } from '@infrastructure/database';
import { RbacModule } from '@core/rbac/rbac.module';
import { Reflector } from '@nestjs/core';
import { LoggingModule, LoggingService } from '@infrastructure/logging';
import { JwtAuthService } from '@services/auth/core/jwt.service';
import { CacheModule } from '@infrastructure/cache/cache.module';

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
    forwardRef(() => DatabaseModule),
    LoggingModule,
    RbacModule,
    CacheModule,
  ],
  providers: [
    JwtAuthGuard,
    JwtAuthService,
    RolesGuard,
    ClinicGuard,
    Reflector,
    LoggingService,
    RateLimitService,
  ],
  exports: [
    JwtAuthGuard,
    RolesGuard,
    ClinicGuard,
    LoggingService,
    JwtModule,
    RateLimitModule,
    RateLimitService,
    JwtAuthService,
    RbacModule, // Export RbacModule so RbacGuard and RbacService are available
  ],
})
export class GuardsModule {}
