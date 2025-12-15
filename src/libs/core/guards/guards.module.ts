import { Module, forwardRef, Global } from '@nestjs/common';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@config';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { ClinicGuard } from './clinic.guard';
import { IpWhitelistGuard } from './ip-whitelist.guard';
import { RedisModule } from '@infrastructure/cache/redis/redis.module';
import { RateLimitModule } from '@security/rate-limit/rate-limit.module';
import { RateLimitService } from '@security/rate-limit/rate-limit.service';
import { DatabaseModule } from '@infrastructure/database';
import { RbacModule } from '@core/rbac/rbac.module';
import { Reflector } from '@nestjs/core';
import { LoggingModule, LoggingService } from '@infrastructure/logging';
import { JwtAuthService } from '@services/auth/core/jwt.service';
import { CacheModule } from '@infrastructure/cache/cache.module';
import { SignOptions } from 'jsonwebtoken';

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
    ConfigModule, // For ConfigService
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService): JwtModuleOptions => {
        // Use ConfigService (which uses dotenv) for environment variable access
        const jwtConfig = configService.getJwtConfig();
        const expiresIn = configService.getEnv('JWT_ACCESS_EXPIRES_IN', '24h') || '24h';
        return {
          secret: jwtConfig.secret || 'dev-jwt-secret-key',
          signOptions: {
            expiresIn: expiresIn as SignOptions['expiresIn'],
          } as SignOptions,
        };
      },
      inject: [ConfigService],
    }),
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
    IpWhitelistGuard,
    Reflector,
    LoggingService,
    RateLimitService,
  ],
  exports: [
    JwtAuthGuard,
    RolesGuard,
    ClinicGuard,
    IpWhitelistGuard,
    LoggingService,
    JwtModule, // Export JwtModule so other modules can use the configured JWT service
    RateLimitModule,
    RateLimitService,
    JwtAuthService,
    RbacModule, // Export RbacModule so RbacGuard and RbacService are available
  ],
})
@Global() // Make GuardsModule global so JwtService is available to all modules
export class GuardsModule {}
