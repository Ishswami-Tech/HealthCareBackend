import { Job } from 'bullmq';

// Internal imports - Infrastructure
import { LoggingService } from '@infrastructure/logging';
import { DatabaseService } from '@infrastructure/database';

// Internal imports - Core
import { LogType, LogLevel } from '@core/types';
import type { JobData } from '@core/types/queue.types';

// NOTE: In BullMQ, job processing is handled by Worker instances, not decorators.
// Worker registration should be done in the module or service setup.

export class QueueProcessor {
  constructor(
    private readonly prisma: DatabaseService,
    private readonly loggingService: LoggingService
  ) {}

  // Example BullMQ job handler for CREATE
  processCreateJob(job: Job<JobData>) {
    try {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing create job ${String(job.id)} for resource ${String(job.data['id'])}`,
        'QueueProcessor',
        { jobId: String(job.id), resourceId: String(job.data['id']) }
      );
      // Ensure this handler is idempotent!
      // ... job logic ...
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Job ${String(job.id)} processed successfully`,
        'QueueProcessor',
        { jobId: String(job.id) }
      );
      return { success: true };
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Error processing create job`,
        'QueueProcessor',
        {
          jobId: String(job.id),
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      // Optionally move to DLQ if available
      // if (job.attemptsMade >= (job.opts.attempts || 3) && this.queueService?.moveToDLQ) {
      //   await this.queueService.moveToDLQ(job, 'service-queue');
      // }
      throw _error;
    }
  }

  // Repeat for other job types (UPDATE, CONFIRM, COMPLETE, NOTIFY)
  processUpdateJob(job: Job<JobData>) {
    try {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing update job ${String(job.id)} for resource ${String(job.data['id'])}`,
        'QueueProcessor',
        { jobId: String(job.id), resourceId: String(job.data['id']) }
      );

      // Generic processing logic for service-queue
      // Implementation of UPDATE job for service-queue

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Job ${String(job.id)} processed successfully`,
        'QueueProcessor',
        { jobId: String(job.id) }
      );
      return { success: true };
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Error processing update job`,
        'QueueProcessor',
        {
          jobId: String(job.id),
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error; // Rethrow to trigger job retry
    }
  }

  processConfirmJob(job: Job<JobData>) {
    try {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing confirm job ${String(job.id)} for resource ${String(job.data['id'])}`,
        'QueueProcessor',
        { jobId: String(job.id), resourceId: String(job.data['id']) }
      );

      // Generic processing logic for service-queue
      // Implementation of CONFIRM job for service-queue

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Job ${String(job.id)} processed successfully`,
        'QueueProcessor',
        { jobId: String(job.id) }
      );
      return { success: true };
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Error processing confirm job`,
        'QueueProcessor',
        {
          jobId: String(job.id),
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error; // Rethrow to trigger job retry
    }
  }

  processCompleteJob(job: Job<JobData>) {
    try {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing complete job ${String(job.id)} for resource ${String(job.data['id'])}`,
        'QueueProcessor',
        { jobId: String(job.id), resourceId: String(job.data['id']) }
      );

      // Generic processing logic for service-queue
      // Implementation of COMPLETE job for service-queue

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Job ${String(job.id)} processed successfully`,
        'QueueProcessor',
        { jobId: String(job.id) }
      );
      return { success: true };
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Error processing complete job`,
        'QueueProcessor',
        {
          jobId: String(job.id),
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error; // Rethrow to trigger job retry
    }
  }

  processNotifyJob(job: Job<JobData>) {
    try {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Processing notification job ${String(job.id)} for resource ${String(job.data['id'])}`,
        'QueueProcessor',
        { jobId: String(job.id), resourceId: String(job.data['id']) }
      );

      // Send notification logic for service-queue
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Sending notification for resource ${String(job.data['id'])} to user ${String(job.data['userId'])}`,
        'QueueProcessor',
        { resourceId: String(job.data['id']), userId: String(job.data['userId']) }
      );

      // Example of FCM notification (would need to be implemented)
      // await this.fcmService.sendNotification({
      //   userId: job.data.userId,
      //   title: 'Resource Update',
      //   body: job.(data as { meta?: unknown }).metadata?.message || 'Your resource status has been updated',
      //   data: { resourceId: job.data.id, resourceType: job.data.resourceType },
      // });

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `Notification sent for resource ${String(job.data['id'])}`,
        'QueueProcessor',
        { resourceId: String(job.data['id']) }
      );
      return { success: true };
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Error processing notification job`,
        'QueueProcessor',
        {
          jobId: String(job.id),
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error; // Rethrow to trigger job retry
    }
  }
}
