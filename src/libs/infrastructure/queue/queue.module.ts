import { Module, DynamicModule } from '@nestjs/common';
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QueueService } from './queue.service';
import { QueueProcessor } from './queue.processor';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import { APPOINTMENT_QUEUE, EMAIL_QUEUE, NOTIFICATION_QUEUE, SERVICE_QUEUE, VIDHAKARMA_QUEUE, PANCHAKARMA_QUEUE, CHEQUP_QUEUE } from './queue.constants';
import { Queue, Worker } from 'bullmq';
import { PrismaService } from '../database/prisma/prisma.service';

@Module({})
export class QueueModule {
  static forRoot(): DynamicModule {
    return {
      module: QueueModule,
      imports: [
        BullModule.forRootAsync({
          imports: [ConfigModule],
          useFactory: async (configService: ConfigService) => ({
            connection: {
              host: configService.get('REDIS_HOST', 'localhost'),
              port: parseInt(configService.get('REDIS_PORT', '6379')),
              password: configService.get('REDIS_PASSWORD'),
            },
          }),
          inject: [ConfigService],
        }),
        BullModule.registerQueue({
          name: SERVICE_QUEUE,
        }),
        BullModule.registerQueue({
          name: APPOINTMENT_QUEUE,
        }),
        BullModule.registerQueue({
          name: EMAIL_QUEUE,
        }),
        BullModule.registerQueue({
          name: NOTIFICATION_QUEUE,
        }),
        BullModule.registerQueue({
          name: VIDHAKARMA_QUEUE,
        }),
        BullModule.registerQueue({
          name: PANCHAKARMA_QUEUE,
        }),
        BullModule.registerQueue({
          name: CHEQUP_QUEUE,
        }),
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
            notificationQueue: Queue,
            vidhakarmaQueue: Queue,
            panchakarmaQueue: Queue,
            chequpQueue: Queue
          ) => {
            const serverAdapter = new FastifyAdapter();
            createBullBoard({
              queues: [
                new BullMQAdapter(serviceQueue),
                new BullMQAdapter(appointmentQueue),
                new BullMQAdapter(emailQueue),
                new BullMQAdapter(notificationQueue),
                new BullMQAdapter(vidhakarmaQueue),
                new BullMQAdapter(panchakarmaQueue),
                new BullMQAdapter(chequpQueue),
              ],
              serverAdapter
            });
            return serverAdapter;
          },
          inject: [
            getQueueToken(SERVICE_QUEUE),
            getQueueToken(APPOINTMENT_QUEUE),
            getQueueToken(EMAIL_QUEUE),
            getQueueToken(NOTIFICATION_QUEUE),
            getQueueToken(VIDHAKARMA_QUEUE),
            getQueueToken(PANCHAKARMA_QUEUE),
            getQueueToken(CHEQUP_QUEUE)
          ]
        },
        {
          provide: 'BULLMQ_WORKERS',
          useFactory: async (
            queueProcessor: QueueProcessor,
            prisma: PrismaService
          ) => {
            const workers = [];
            workers.push(new Worker(
              SERVICE_QUEUE,
              async (job) => {
                switch (job.name) {
                  case 'create':
                    return queueProcessor.processCreateJob(job);
                  case 'update':
                    return queueProcessor.processUpdateJob(job);
                  case 'confirm':
                    return queueProcessor.processConfirmJob(job);
                  case 'complete':
                    return queueProcessor.processCompleteJob(job);
                  case 'notify':
                    return queueProcessor.processNotifyJob(job);
                  default:
                    throw new Error(`Unknown job type: ${job.name}`);
                }
              },
              {
                connection: {
                  host: process.env.REDIS_HOST || 'localhost',
                  port: parseInt(process.env.REDIS_PORT || '6379'),
                  password: process.env.REDIS_PASSWORD,
                },
                concurrency: parseInt(process.env.SERVICE_QUEUE_CONCURRENCY || '10'),
              }
            ));
            return workers;
          },
          inject: [QueueProcessor, PrismaService],
        }
      ],
      exports: [QueueService, BullModule]
    };
  }

  static register(): DynamicModule {
    return {
      module: QueueModule,
      imports: [
        BullModule.registerQueue({
          name: SERVICE_QUEUE,
        }),
        BullModule.registerQueue({
          name: APPOINTMENT_QUEUE,
        }),
        BullModule.registerQueue({
          name: EMAIL_QUEUE,
        }),
        BullModule.registerQueue({
          name: NOTIFICATION_QUEUE,
        }),
        BullModule.registerQueue({
          name: VIDHAKARMA_QUEUE,
        }),
        BullModule.registerQueue({
          name: PANCHAKARMA_QUEUE,
        }),
        BullModule.registerQueue({
          name: CHEQUP_QUEUE,
        }),
      ],
      providers: [QueueService],
      exports: [BullModule, QueueService],
    };
  }
} 