import { Module } from '@nestjs/common';
import { AppointmentsController } from './appointments.controller';
import { AppointmentLocationModule } from './appointment-location/appointment-location.module';
import { AppointmentConfirmationModule } from './appointment-confirmation/appointment-confirmation.module';
import { AppointmentSocketModule } from './appointment-socket/appointment-socket.module';
import { AppointmentProcessorModule } from './appointment-processor/appointment-processor.module';
import { AppointmentQueueModule } from './appointment-queue/appointment-queue.module';
import { CheckInModule } from './check-in/check-in.module';
import { LoggingModule } from '../../libs/infrastructure/logging/logging.module';
import { AppointmentService } from './appointments.service';
import { QueueModule } from '../../libs/infrastructure/queue/queue.module';
import { JwtModule } from '@nestjs/jwt';
import { RedisModule } from '../../libs/infrastructure/cache/redis/redis.module';
import { RateLimitModule } from '../../libs/utils/rate-limit/rate-limit.module';
import { GuardsModule } from '../../libs/core/guards/guards.module';
import { PermissionsModule } from '../../libs/infrastructure/permissions';
import { QrModule } from '../../libs/utils/QR/qr.module';

@Module({
  imports: [
    QueueModule.register(),
    AppointmentLocationModule,
    AppointmentConfirmationModule,
    AppointmentSocketModule,
    AppointmentProcessorModule,
    AppointmentQueueModule,
    CheckInModule,
    LoggingModule,
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
  controllers: [AppointmentsController],
  providers: [AppointmentService],
  exports: [AppointmentService],
})
export class AppointmentsModule {} 