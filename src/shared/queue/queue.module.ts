import { Module, DynamicModule, Inject } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueService } from './queue.service';
import { QueueProcessor } from './queue.processor';
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import { APPOINTMENT_QUEUE, EMAIL_QUEUE, NOTIFICATION_QUEUE, SERVICE_QUEUE } from './queue.constants';
import { join } from 'path';
import { Queue } from 'bull';

@Module({})
export class QueueModule {
  static forRoot(): DynamicModule {
    const bullModule = BullModule.registerQueue(
      {
        name: SERVICE_QUEUE,
        defaultJobOptions: {
          priority: 1,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000
          }
        }
      },
      {
        name: APPOINTMENT_QUEUE,
        processors: [
          {
            path: join(__dirname, '../../services/appointments/appointment-processor/appointment-queue.processor.js'),
            concurrency: 10
          }
        ],
        defaultJobOptions: {
          priority: 2,
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 2000
          }
        }
      },
      {
        name: EMAIL_QUEUE,
        defaultJobOptions: {
          priority: 3,
          attempts: 3,
          backoff: {
            type: 'fixed',
            delay: 5000
          }
        }
      },
      {
        name: NOTIFICATION_QUEUE,
        defaultJobOptions: {
          priority: 1,
          attempts: 3,
          backoff: {
            type: 'fixed',
            delay: 1000
          }
        }
      }
    );

    return {
      module: QueueModule,
      imports: [
        BullModule.forRootAsync({
          imports: [ConfigModule],
          useFactory: async (configService: ConfigService) => ({
            redis: {
              host: configService.get('REDIS_HOST', 'localhost'),
              port: parseInt(configService.get('REDIS_PORT', '6379')),
              password: configService.get('REDIS_PASSWORD'),
              maxRetriesPerRequest: 3,
              enableReadyCheck: false,
              retryStrategy: (times: number) => {
                if (times > 3) return null;
                return Math.min(times * 100, 3000);
              },
              reconnectOnError: (err) => {
                const targetError = 'READONLY';
                if (err.message.includes(targetError)) {
                  return true;
                }
                return false;
              }
            },
            defaultJobOptions: {
              attempts: 3,
              backoff: {
                type: 'exponential',
                delay: 1000
              },
              removeOnComplete: true,
              removeOnFail: false,
              timeout: 30000
            },
            limiter: {
              max: 1000,
              duration: 5000,
              bounceBack: false
            },
            settings: {
              stalledInterval: 30000,
              maxStalledCount: 2,
              lockDuration: 30000,
              lockRenewTime: 15000,
              retryProcessDelay: 5000,
            }
          }),
          inject: [ConfigService],
        }),
        bullModule
      ],
      providers: [
        QueueService,
        QueueProcessor,
        {
          provide: 'BullBoard',
          useFactory: (
            serviceQueue: Queue,
            appointmentQueue: Queue,
            emailQueue: Queue,
            notificationQueue: Queue
          ) => {
            const serverAdapter = new FastifyAdapter();
            createBullBoard({
              queues: [
                new BullAdapter(serviceQueue),
                new BullAdapter(appointmentQueue),
                new BullAdapter(emailQueue),
                new BullAdapter(notificationQueue)
              ],
              serverAdapter
            });
            return serverAdapter;
          },
          inject: [
            getQueueToken(SERVICE_QUEUE),
            getQueueToken(APPOINTMENT_QUEUE),
            getQueueToken(EMAIL_QUEUE),
            getQueueToken(NOTIFICATION_QUEUE)
          ]
        }
      ],
      exports: [QueueService, bullModule]
    };
  }

  static register(queueName: string): DynamicModule {
    const bullModule = BullModule.registerQueue({
      name: queueName,
    });

    return {
      module: QueueModule,
      imports: [bullModule],
      providers: [QueueService],
      exports: [bullModule, QueueService],
    };
  }
} 