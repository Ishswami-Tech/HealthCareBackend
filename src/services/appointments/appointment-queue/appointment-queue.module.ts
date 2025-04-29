import { Module } from '@nestjs/common';
import { AppointmentQueueService } from './appointment-queue.service';
import { AppointmentQueueController } from './appointment-queue.controller';
import { PrismaModule } from '../../../shared/database/prisma/prisma.module';
import { LoggingModule } from '../../../shared/logging/logging.module';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { SocketModule } from '../../../shared/socket/socket.module';

@Module({
  imports: [
    PrismaModule,
    LoggingModule,
    SocketModule,
    BullModule.registerQueueAsync({
      name: 'appointment-queue',
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        redis: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: configService.get('REDIS_PORT', 6379),
          password: configService.get('REDIS_PASSWORD'),
        },
        defaultJobOptions: {
          removeOnComplete: false,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          timeout: 30000,
        },
        settings: {
          lockDuration: 30000,
          stalledInterval: 30000,
          maxStalledCount: 3,
        },
      }),
      inject: [ConfigService],
    }),
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