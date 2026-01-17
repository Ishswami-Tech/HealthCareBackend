import { Module, forwardRef, Global } from '@nestjs/common';
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt';
// Use direct import to avoid TDZ issues with barrel exports
import { ConfigModule } from '@config/config.module';
import { ConfigService } from '@config/config.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { ClinicGuard } from './clinic.guard';
import { IpWhitelistGuard } from './ip-whitelist.guard';
import { RedisModule } from '@infrastructure/cache/redis/redis.module';
import { RateLimitModule } from '@security/rate-limit/rate-limit.module';
import { RateLimitService } from '@security/rate-limit/rate-limit.service';
// Use direct import to avoid TDZ issues with barrel exports
import { DatabaseModule } from '@infrastructure/database/database.module';
import { RbacModule } from '@core/rbac/rbac.module';
import { SessionModule } from '@core/session/session.module';
import { Reflector } from '@nestjs/core';
import { LoggingModule } from '@infrastructure/logging';
import { JwtAuthService } from '@services/auth/core/jwt.service';
// CacheModule is @Global() - no need to import it
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
    forwardRef(() => ConfigModule), // Use forwardRef to break circular dependency
    JwtModule.registerAsync({
      imports: [forwardRef(() => ConfigModule)], // Use forwardRef to break circular dependency
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
    forwardRef(() => LoggingModule), // Use forwardRef to break potential circular dependency
    forwardRef(() => RbacModule), // Use forwardRef to break circular dependency with DatabaseModule
    forwardRef(() => SessionModule), // JwtAuthGuard requires SessionManagementService
    // CacheModule is @Global() - no need to import it explicitly
  ],
  providers: [
    JwtAuthGuard,
    JwtAuthService,
    RolesGuard,
    ClinicGuard,
    IpWhitelistGuard,
    Reflector,
    // LoggingService is provided globally by LoggingModule (@Global()) - don't provide it here
    RateLimitService,
  ],
  exports: [
    JwtAuthGuard,
    RolesGuard,
    ClinicGuard,
    IpWhitelistGuard,
    // LoggingService is provided globally by LoggingModule (@Global()) - no need to export
    JwtModule, // Export JwtModule so other modules can use the configured JWT service
    RateLimitModule,
    RateLimitService,
    JwtAuthService,
    RbacModule, // Export RbacModule so RbacGuard and RbacService are available
  ],
})
@Global() // Make GuardsModule global so JwtService is available to all modules
export class GuardsModule {}
