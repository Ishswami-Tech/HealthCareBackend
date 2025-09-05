import { Worker } from 'bullmq';
import {
  SERVICE_QUEUE,
  APPOINTMENT_QUEUE,
  EMAIL_QUEUE,
  NOTIFICATION_QUEUE,
  ENHANCED_APPOINTMENT_QUEUE,
  PAYMENT_PROCESSING_QUEUE,
  REMINDER_QUEUE
} from './libs/infrastructure/queue/src/queue.constants';
import { QueueProcessor } from './libs/infrastructure/queue/src/queue.processor';
import { PrismaService } from './libs/infrastructure/database/prisma/prisma.service';

// Setup Prisma and processor (adjust as needed for DI)
const prisma = new PrismaService();
const processor = new QueueProcessor(prisma as any);

const queueNames = [
  SERVICE_QUEUE,
  APPOINTMENT_QUEUE,
  EMAIL_QUEUE,
  NOTIFICATION_QUEUE,
  ENHANCED_APPOINTMENT_QUEUE,
  PAYMENT_PROCESSING_QUEUE,
  REMINDER_QUEUE
];

queueNames.forEach((queueName) => {
  const worker = new Worker(
    queueName,
    async (job) => {
      switch (job.name) {
        case 'create':
          return processor.processCreateJob(job);
        case 'update':
          return processor.processUpdateJob(job);
        case 'confirm':
          return processor.processConfirmJob(job);
        case 'complete':
          return processor.processCompleteJob(job);
        case 'notify':
          return processor.processNotifyJob(job);
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
  );

  worker.on('completed', (job) => {
    console.log(`[${queueName}] Job ${job.id} has completed!`);
  });
  worker.on('failed', (job, err) => {
    console.error(`[${queueName}] Job ${job?.id} has failed with error: ${err.message}`);
  });
});

// Optional: Healthcheck endpoint for Docker/K8s
if (process.argv.includes('--healthcheck')) {
  // Just exit successfully to indicate the worker is running
  process.exit(0);
} 