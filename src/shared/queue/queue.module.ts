import { Module, DynamicModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { QueueService } from './queue.service';
import { QueueProcessor } from './queue.processor';
import { PrismaModule } from '../database/prisma/prisma.module';
import { BullBoardModule } from './bull-board/bull-board.module';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({})
export class QueueModule {
  static register(queueName: string = 'appointment-queue'): DynamicModule {
    return {
      module: QueueModule,
      imports: [
        PrismaModule,
        BullModule.registerQueue({
          name: queueName,
          defaultJobOptions: {
            removeOnComplete: false, // Keep completed jobs for monitoring
            attempts: 3,             // Default retry attempts
            backoff: {
              type: 'exponential',
              delay: 5000,          // 5 seconds initial delay
            },
          },
        }),
      ],
      providers: [
        {
          provide: QueueService,
          useFactory: (queue) => {
            return new QueueService(queue, queue);
          },
          inject: [`BullQueue_${queueName}`],
        }
      ],
      exports: [QueueService],
    };
  }
  
  static forRoot(): DynamicModule {
    return {
      module: QueueModule,
      imports: [
        PrismaModule,
        ConfigModule,
        BullModule.forRootAsync({
          imports: [ConfigModule],
          useFactory: (configService: ConfigService) => ({
            redis: {
              host: configService.get('redis.host') || 'redis',
              port: parseInt(configService.get('redis.port') || '6379'),
              password: configService.get('redis.password'),
              reconnectOnError: (err) => {
                // Only reconnect for specific errors
                const targetErrors = ['READONLY', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET'];
                const shouldReconnect = targetErrors.some(e => err.message.includes(e));
                return shouldReconnect;
              },
            },
            // Global settings that apply to all queues
            settings: {
              stalledInterval: 15000,      // Check for stalled jobs every 15 seconds
              maxStalledCount: 2,          // Consider job stalled after 2 missed checks
              guardInterval: 5000,         // How often to check for stalled jobs (ms)
              drainDelay: 5,               // Wait time between processing jobs (ms)
            },
            // Default job options 
            defaultJobOptions: {
              attempts: 5,                 // Default retry attempts
              removeOnComplete: 500,       // Keep last 500 completed jobs
              removeOnFail: 10000,         // Keep last 10000 failed jobs for debugging
            }
          }),
          inject: [ConfigService],
        }),
        // Register both queues at application startup
        BullModule.registerQueue(
          { name: 'service-queue' },
          { name: 'appointment-queue' }
        ),
        BullBoardModule,
      ],
      providers: [
        {
          provide: QueueService,
          useFactory: (serviceQueue, appointmentQueue) => {
            return new QueueService(serviceQueue, appointmentQueue);
          },
          inject: ['BullQueue_service-queue', 'BullQueue_appointment-queue'],
        }
      ],
      exports: [BullBoardModule, QueueService],
      global: true,
    };
  }
} 