import { Logger } from "@nestjs/common";
import { Job } from "bullmq";
import { JobData } from "./queue.service";
import { DatabaseService } from "../../database";

// NOTE: In BullMQ, job processing is handled by Worker instances, not decorators.
// Worker registration should be done in the module or service setup.

export class QueueProcessor {
  private readonly logger = new Logger(QueueProcessor.name);

  constructor(private readonly prisma: DatabaseService) {}

  // Example BullMQ job handler for CREATE
  processCreateJob(job: Job<JobData>) {
    try {
      this.logger.log(
        `Processing create job ${String(job["id"])} for resource ${String(job.data["id"])}`,
      );
      // Ensure this handler is idempotent!
      // ... job logic ...
      this.logger.log(`Job ${String(job.id)} processed successfully`);
      return { success: true };
    } catch (_error) {
      if (_error instanceof Error) {
        this.logger.error(
          `Error processing create job: ${_error.message}`,
          _error.stack,
        );
      } else {
        this.logger.error(`Error processing create job: ${String(_error)}`);
      }
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
      this.logger.log(
        `Processing update job ${String(job["id"])} for resource ${String(job.data["id"])}`,
      );

      // Generic processing logic for service-queue
      // Implementation of UPDATE job for service-queue

      this.logger.log(`Job ${String(job.id)} processed successfully`);
      return { success: true };
    } catch (_error) {
      if (_error instanceof Error) {
        this.logger.error(
          `Error processing update job: ${_error.message}`,
          _error.stack,
        );
      } else {
        this.logger.error(`Error processing update job: ${String(_error)}`);
      }
      throw _error; // Rethrow to trigger job retry
    }
  }

  processConfirmJob(job: Job<JobData>) {
    try {
      this.logger.log(
        `Processing confirm job ${String(job["id"])} for resource ${String(job.data["id"])}`,
      );

      // Generic processing logic for service-queue
      // Implementation of CONFIRM job for service-queue

      this.logger.log(`Job ${String(job.id)} processed successfully`);
      return { success: true };
    } catch (_error) {
      if (_error instanceof Error) {
        this.logger.error(
          `Error processing confirm job: ${_error.message}`,
          _error.stack,
        );
      } else {
        this.logger.error(`Error processing confirm job: ${String(_error)}`);
      }
      throw _error; // Rethrow to trigger job retry
    }
  }

  processCompleteJob(job: Job<JobData>) {
    try {
      this.logger.log(
        `Processing complete job ${String(job["id"])} for resource ${String(job.data["id"])}`,
      );

      // Generic processing logic for service-queue
      // Implementation of COMPLETE job for service-queue

      this.logger.log(`Job ${String(job.id)} processed successfully`);
      return { success: true };
    } catch (_error) {
      if (_error instanceof Error) {
        this.logger.error(
          `Error processing complete job: ${_error.message}`,
          _error.stack,
        );
      } else {
        this.logger.error(`Error processing complete job: ${String(_error)}`);
      }
      throw _error; // Rethrow to trigger job retry
    }
  }

  processNotifyJob(job: Job<JobData>) {
    try {
      this.logger.log(
        `Processing notification job ${String(job["id"])} for resource ${String(job.data["id"])}`,
      );

      // Send notification logic for service-queue
      this.logger.log(
        `Sending notification for resource ${String(job.data["id"])} to user ${String(job.data["userId"])}`,
      );

      // Example of FCM notification (would need to be implemented)
      // await this.fcmService.sendNotification({
      //   userId: job.data.userId,
      //   title: 'Resource Update',
      //   body: job.(data as { meta?: unknown }).metadata?.message || 'Your resource status has been updated',
      //   data: { resourceId: job.data.id, resourceType: job.data.resourceType },
      // });

      this.logger.log(
        `Notification sent for resource ${String(job.data["id"])}`,
      );
      return { success: true };
    } catch (_error) {
      if (_error instanceof Error) {
        this.logger.error(
          `Error processing notification job: ${_error.message}`,
          _error.stack,
        );
      } else {
        this.logger.error(
          `Error processing notification job: ${String(_error)}`,
        );
      }
      throw _error; // Rethrow to trigger job retry
    }
  }
}
