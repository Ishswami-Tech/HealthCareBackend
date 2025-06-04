import { Module } from '@nestjs/common';
import { AppointmentLocationService } from './appointment-location.service';
import { AppointmentLocationController } from './appointment-location.controller';
import { PrismaModule } from '../../../shared/database/prisma/prisma.module';
import { CacheModule } from '../../../shared/cache/cache.module';
import { LoggingModule } from '../../../shared/logging/logging.module';
import { JwtModule } from '@nestjs/jwt';
import { RedisModule } from '../../../shared/cache/redis/redis.module';
import { RateLimitModule } from '../../../shared/rate-limit/rate-limit.module';
import { GuardsModule } from '../../../libs/guards/guards.module';
import { AuthModule } from '../../../services/auth/auth.module';

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
  ],
  controllers: [AppointmentLocationController],
  providers: [AppointmentLocationService],
  exports: [AppointmentLocationService],
})
export class AppointmentLocationModule {} 