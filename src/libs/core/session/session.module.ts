import { Module, forwardRef, Global } from '@nestjs/common';
import { ConfigModule } from '@config';
import { JwtModule } from '@nestjs/jwt';
import { SessionManagementService } from './session-management.service';
import { FastifySessionStoreAdapter } from './fastify-session-store.adapter';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { CacheModule } from '@infrastructure/cache/cache.module';
import { LoggingModule } from '@infrastructure/logging';

/**
 * Session Module for Healthcare Backend
 * @module SessionModule
 * @description Provides comprehensive session management for 1M+ users with
 * distributed storage, security monitoring, and automatic cleanup.
 * Uses @fastify/session and @fastify/cookie for session management.
 *
 * @Global() - SessionManagementService is required by JwtAuthGuard which is used
 * throughout the application. Making this module global ensures SessionManagementService
 * is available to all modules without explicit imports.
 *
 * @example
 * ```typescript
 * @Module({
 *   imports: [SessionModule],
 *   // ... other module configuration
 * })
 * export class AppModule {}
 * ```
 */
@Global()
@Module({
  imports: [
    ConfigModule,
    JwtModule,
    forwardRef(() => DatabaseModule),
    forwardRef(() => CacheModule),
    // Use forwardRef to break: GuardsModule -> SessionModule -> CacheModule -> GuardsModule
    LoggingModule,
  ],
  providers: [SessionManagementService, FastifySessionStoreAdapter],
  exports: [SessionManagementService, FastifySessionStoreAdapter],
})
export class SessionModule {}
