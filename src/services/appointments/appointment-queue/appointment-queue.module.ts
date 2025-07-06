import { Module } from '@nestjs/common';
import { AppointmentQueueService } from './appointment-queue.service';
import { AppointmentQueueController } from './appointment-queue.controller';
import { PrismaModule } from '../../../shared/database/prisma/prisma.module';
import { LoggingModule } from '../../../shared/logging/logging.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SocketModule } from '../../../shared/socket/socket.module';
import { AuthModule } from '../../../services/auth/auth.module';
import { RedisModule } from '../../../shared/cache/redis/redis.module';
import { RateLimitModule } from '../../../shared/rate-limit/rate-limit.module';
import { SharedModule } from '../../../shared/shared.module';
import { PermissionsModule } from '../../../shared/permissions';

@Module({
  imports: [
    PrismaModule,
    LoggingModule,
    SocketModule,
    AuthModule,
    RedisModule,
    RateLimitModule,
    SharedModule,
    PermissionsModule,
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 20,
      verboseMemoryLeak: true,
      ignoreErrors: false,
    }),
  ],
  controllers: [AppointmentQueueController],
  providers: [
    AppointmentQueueService,
    {
      provide: 'QUEUE_CONFIG',
      useFactory: (configService: ConfigService) => ({
        defaultWaitTime: configService.get('DEFAULT_WAIT_TIME', 15), // minutes
        maxQueueSize: configService.get('MAX_QUEUE_SIZE', 50),
        checkInWindow: {
          before: configService.get('CHECK_IN_WINDOW_BEFORE', 30), // minutes
          after: configService.get('CHECK_IN_WINDOW_AFTER', 15), // minutes
        },
        autoConfirmation: configService.get('AUTO_CONFIRM_CHECKIN', true),
      }),
      inject: [ConfigService],
    },
  ],
  exports: [AppointmentQueueService],
})
export class AppointmentQueueModule {} 