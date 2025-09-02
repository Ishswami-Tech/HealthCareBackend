import { Module } from '@nestjs/common';
import { AppointmentLocationService } from './appointment-location.service';
import { AppointmentLocationController } from './appointment-location.controller';
import { PrismaModule } from '../../../libs/infrastructure/database/prisma/prisma.module';
import { CacheModule } from '../../../libs/infrastructure/cache/cache.module';
import { LoggingModule } from '../../../libs/infrastructure/logging/logging.module';
import { JwtModule } from '@nestjs/jwt';
import { RedisModule } from '../../../libs/infrastructure/cache/redis/redis.module';
import { RateLimitModule } from '../../../libs/utils/rate-limit/rate-limit.module';
import { GuardsModule } from '../../../libs/core/guards/guards.module';
import { AuthModule } from '../../../services/auth/auth.module';
import { PermissionsModule } from '../../../libs/infrastructure/permissions';

@Module({
  imports: [
    PrismaModule,
    CacheModule,
    LoggingModule,
    AuthModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: '24h' },
    }),
    RedisModule,
    RateLimitModule,
    GuardsModule,
    PermissionsModule,
  ],
  controllers: [AppointmentLocationController],
  providers: [AppointmentLocationService],
  exports: [AppointmentLocationService],
})
export class AppointmentLocationModule {} 