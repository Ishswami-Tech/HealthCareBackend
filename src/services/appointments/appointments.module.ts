import { Module } from '@nestjs/common';
import { AppointmentController } from './appointments.controller';
import { AppointmentLocationModule } from './appointment-location/appointment-location.module';
import { AppointmentConfirmationModule } from './appointment-confirmation/appointment-confirmation.module';
import { AppointmentSocketModule } from './appointment-socket/appointment-socket.module';
import { AppointmentProcessorModule } from './appointment-processor/appointment-processor.module';
import { AppointmentQueueModule } from './appointment-queue/appointment-queue.module';
import { CheckInModule } from './check-in/check-in.module';
import { SharedModule } from '../../shared/shared.module';
import { LoggingModule } from '../../shared/logging/logging.module';
import { AppointmentService } from './appointments.service';
import { QueueModule } from '../../shared/queue/queue.module';
import { JwtModule } from '@nestjs/jwt';
import { RedisModule } from '../../shared/cache/redis/redis.module';
import { RateLimitModule } from '../../shared/rate-limit/rate-limit.module';
import { GuardsModule } from '../../libs/guards/guards.module';

@Module({
  imports: [
    SharedModule,
    QueueModule.register(),
    AppointmentLocationModule,
    AppointmentConfirmationModule,
    AppointmentSocketModule,
    AppointmentProcessorModule,
    AppointmentQueueModule,
    CheckInModule,
    LoggingModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: '24h' },
    }),
    RedisModule,
    RateLimitModule,
    GuardsModule,
  ],
  controllers: [AppointmentController],
  providers: [AppointmentService],
  exports: [AppointmentService],
})
export class AppointmentsModule {} 