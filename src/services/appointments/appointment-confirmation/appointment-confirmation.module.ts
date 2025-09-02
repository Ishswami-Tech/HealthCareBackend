import { Module } from '@nestjs/common';
import { AppointmentConfirmationController } from './appointment-confirmation.controller';
import { AppointmentConfirmationService } from './appointment-confirmation.service';
import { LoggingModule } from 'src/libs/infrastructure/logging/logging.module';
import { AppointmentQueueModule } from '../appointment-queue/appointment-queue.module';
import { JwtModule } from '@nestjs/jwt';
import { RedisModule } from 'src/libs/infrastructure/cache/redis/redis.module';
import { RateLimitModule } from '../../../libs/utils/rate-limit/rate-limit.module';
import { GuardsModule } from 'src/libs/core/guards/guards.module';
import { AuthModule } from '../../../services/auth/auth.module';
import { PermissionsModule } from 'src/libs/infrastructure/permissions';
import { QrModule } from '../../../libs/utils/QR/qr.module';

@Module({
  imports: [
    LoggingModule,
    AppointmentQueueModule,
    AuthModule,
    QrModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: '24h' },
    }),
    RedisModule,
    RateLimitModule,
    GuardsModule,
    PermissionsModule,
  ],
  controllers: [AppointmentConfirmationController],
  providers: [AppointmentConfirmationService],
  exports: [AppointmentConfirmationService],
})
export class AppointmentConfirmationModule {} 