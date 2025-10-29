import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { SessionManagementService } from "./session-management.service";
import { PrismaModule } from "../../infrastructure/database/prisma/prisma.module";
import { RedisModule } from "../../infrastructure/cache/redis/redis.module";
import { LoggingServiceModule } from "../../infrastructure/logging";

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
  imports: [
    ConfigModule,
    JwtModule,
    PrismaModule,
    RedisModule,
    LoggingServiceModule,
  ],
  providers: [SessionManagementService],
  exports: [SessionManagementService],
})
export class SessionModule {}
