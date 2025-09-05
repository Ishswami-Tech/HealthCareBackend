import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { SessionManagementService } from './session-management.service';
import { PrismaModule } from '../../infrastructure/database/prisma/prisma.module';
import { RedisModule } from '../../infrastructure/cache/redis/redis.module';
import { LoggingServiceModule } from "../../infrastructure/logging";

@Module({
  imports: [
    ConfigModule,
    JwtModule,
    PrismaModule,
    RedisModule,
    LoggingServiceModule,
  ],
  providers: [
    SessionManagementService,
  ],
  exports: [
    SessionManagementService,
  ],
})
export class SessionModule {}