import { Module } from '@nestjs/common';
import { AppointmentConfirmationController } from './appointment-confirmation.controller';
import { AppointmentConfirmationService } from './appointment-confirmation.service';
import { SharedModule } from '../../../shared/shared.module';
import { LoggingModule } from '../../../shared/logging/logging.module';
import { AppointmentQueueModule } from '../appointment-queue/appointment-queue.module';
import { JwtModule } from '@nestjs/jwt';
import { RedisModule } from '../../../shared/cache/redis/redis.module';
import { RateLimitModule } from '../../../shared/rate-limit/rate-limit.module';
import { GuardsModule } from '../../../libs/guards/guards.module';

@Module({
  imports: [
    SharedModule,
    LoggingModule,
    AppointmentQueueModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: '24h' },
    }),
    RedisModule,
    RateLimitModule,
    GuardsModule,
  ],
  controllers: [AppointmentConfirmationController],
  providers: [AppointmentConfirmationService],
  exports: [AppointmentConfirmationService],
})
export class AppointmentConfirmationModule {} 