import { Module } from '@nestjs/common';
import { ConfigModule } from '@config';
import { JwtModule } from '@nestjs/jwt';
import { SessionManagementService } from './session-management.service';
import { FastifySessionStoreAdapter } from './fastify-session-store.adapter';
import { DatabaseModule } from '@infrastructure/database';
import { CacheModule } from '@infrastructure/cache/cache.module';
import { LoggingModule } from '@infrastructure/logging';

/**
 * Session Module for Healthcare Backend
 * @module SessionModule
 * @description Provides comprehensive session management for 1M+ users with
 * distributed storage, security monitoring, and automatic cleanup.
 * Uses @fastify/session and @fastify/cookie for session management.
 * @example
 * ```typescript
 * @Module({
 *   imports: [SessionModule],
 *   // ... other module configuration
 * })
 * export class AppModule {}
 * ```
 */
@Module({
  imports: [ConfigModule, JwtModule, DatabaseModule, CacheModule, LoggingModule],
  providers: [SessionManagementService, FastifySessionStoreAdapter],
  exports: [SessionManagementService, FastifySessionStoreAdapter],
})
export class SessionModule {}
