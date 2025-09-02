import { Module } from '@nestjs/common';
import { AppointmentQueueService } from './appointment-queue.service';
import { AppointmentQueueController } from './appointment-queue.controller';
import { PrismaModule } from 'src/libs/infrastructure/database/prisma/prisma.module';
import { LoggingModule } from 'src/libs/infrastructure/logging/logging.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SocketModule } from 'src/libs/communication/socket/socket.module';
import { AuthModule } from '../../../services/auth/auth.module';
import { RedisModule } from 'src/libs/infrastructure/cache/redis/redis.module';
import { RateLimitModule } from '../../../libs/utils/rate-limit/rate-limit.module';
import { PermissionsModule } from 'src/libs/infrastructure/permissions';

@Module({
  imports: [
    PrismaModule,
    LoggingModule,
    SocketModule,
    AuthModule,
    RedisModule,
    RateLimitModule,
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