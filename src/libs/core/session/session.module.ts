import { Module } from '@nestjs/common';
import { ConfigModule } from '@config';
import { JwtModule } from '@nestjs/jwt';
import { SessionManagementService } from './session-management.service';
import { DatabaseModule } from '@infrastructure/database';
import { RedisModule } from '@infrastructure/cache/redis/redis.module';
import { LoggingModule } from '@infrastructure/logging';

/**
 * Session Module for Healthcare Backend
 * @module SessionModule
 * @description Provides comprehensive session management for 1M+ users with
 * distributed storage, security monitoring, and automatic cleanup.
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
  imports: [ConfigModule, JwtModule, DatabaseModule, RedisModule, LoggingModule],
  providers: [SessionManagementService],
  exports: [SessionManagementService],
})
export class SessionModule {}
