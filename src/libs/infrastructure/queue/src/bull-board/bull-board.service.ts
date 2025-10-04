import { Injectable, Logger, Optional } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bull";
import {
  SERVICE_QUEUE,
  APPOINTMENT_QUEUE,
  EMAIL_QUEUE,
  NOTIFICATION_QUEUE,
  VIDHAKARMA_QUEUE,
  PANCHAKARMA_QUEUE,
  CHEQUP_QUEUE,
} from "../queue.constants";

@Injectable()
export class BullBoardService {
  private readonly logger = new Logger(BullBoardService.name);

  constructor(
    @Optional() @InjectQueue(SERVICE_QUEUE) private serviceQueue: Queue,
    @Optional() @InjectQueue(APPOINTMENT_QUEUE) private appointmentQueue: Queue,
    @Optional() @InjectQueue(EMAIL_QUEUE) private emailQueue: Queue,
    @Optional()
    @InjectQueue(NOTIFICATION_QUEUE)
    private notificationQueue: Queue,
    @Optional() @InjectQueue(VIDHAKARMA_QUEUE) private vidhakarmaQueue: Queue,
    @Optional() @InjectQueue(PANCHAKARMA_QUEUE) private panchakarmaQueue: Queue,
    @Optional() @InjectQueue(CHEQUP_QUEUE) private chequpQueue: Queue,
  ) {}

  /**
   * Get all registered queues for BullBoard
   */
  getQueues() {
    const queues: Record<string, Queue | undefined> = {};
    if (this.serviceQueue) queues[SERVICE_QUEUE] = this.serviceQueue;
    if (this.appointmentQueue)
      queues[APPOINTMENT_QUEUE] = this.appointmentQueue;
    if (this.emailQueue) queues[EMAIL_QUEUE] = this.emailQueue;
    if (this.notificationQueue)
      queues[NOTIFICATION_QUEUE] = this.notificationQueue;
    if (this.vidhakarmaQueue) queues[VIDHAKARMA_QUEUE] = this.vidhakarmaQueue;
    if (this.panchakarmaQueue)
      queues[PANCHAKARMA_QUEUE] = this.panchakarmaQueue;
    if (this.chequpQueue) queues[CHEQUP_QUEUE] = this.chequpQueue;
    return queues;
  }

  /**
   * Get queue statistics for monitoring
   */
  async getQueueStats() {
    const queues = this.getQueues();
    const stats: Record<string, unknown> = {};

    for (const [name, queue] of Object.entries(queues)) {
      if (!queue) {
        stats[name] = { _error: "Queue not available" };
        continue;
      }

      try {
        const [waiting, active, completed, failed, delayed] = await Promise.all(
          [
            queue.getWaiting(),
            queue.getActive(),
            queue.getCompleted(),
            queue.getFailed(),
            queue.getDelayed(),
          ],
        );

        stats[name] = {
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
          delayed: delayed.length,
          total:
            waiting.length +
            active.length +
            completed.length +
            failed.length +
            delayed.length,
        };
      } catch (error) {
        this.logger.error(
          `Failed to get stats for queue ${name}:`,
          error instanceof Error ? error.stack : "",
        );
        stats[name] = {
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }

    return stats;
  }

  /**
   * Get detailed queue information
   */
  async getQueueDetails(queueName: string) {
    const queues = this.getQueues();
    const queue = queues[queueName];

    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        queue.getWaiting(),
        queue.getActive(),
        queue.getCompleted(),
        queue.getFailed(),
        queue.getDelayed(),
      ]);

      return {
        name: queueName,
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
        total:
          waiting.length +
          active.length +
          completed.length +
          failed.length +
          delayed.length,
        jobs: {
          waiting: waiting.slice(0, 10), // First 10 waiting jobs
          active: active.slice(0, 10), // First 10 active jobs
          failed: failed.slice(0, 10), // First 10 failed jobs
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to get details for queue ${queueName}:`,
        error instanceof Error ? error.stack : "",
      );
      throw error;
    }
  }

  /**
   * Retry failed jobs
   */
  async retryFailedJobs(queueName: string, jobIds?: string[]) {
    const queues = this.getQueues();
    const queue = queues[queueName];

    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    try {
      if (jobIds && jobIds.length > 0) {
        // Retry specific jobs
        const results = [];
        for (const jobId of jobIds) {
          const job = await queue.getJob(jobId);
          if (job) {
            await job.retry();
            results.push({ jobId, status: "retried" });
          } else {
            results.push({ jobId, status: "not_found" });
          }
        }
        return results;
      } else {
        // Retry all failed jobs
        const failedJobs = await queue.getFailed();
        const results = [];
        for (const job of failedJobs) {
          await job.retry();
          results.push({ jobId: job.id, status: "retried" });
        }
        return results;
      }
    } catch (error) {
      this.logger.error(
        `Failed to retry jobs in queue ${queueName}:`,
        error instanceof Error ? error.stack : "",
      );
      throw error;
    }
  }

  /**
   * Remove jobs from queue
   */
  async removeJobs(queueName: string, jobIds: string[]) {
    const queues = this.getQueues();
    const queue = queues[queueName];

    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    try {
      const results = [];
      for (const jobId of jobIds) {
        const job = await queue.getJob(jobId);
        if (job) {
          await job.remove();
          results.push({ jobId, status: "removed" });
        } else {
          results.push({ jobId, status: "not_found" });
        }
      }
      return results;
    } catch (error) {
      this.logger.error(
        `Failed to remove jobs from queue ${queueName}:`,
        error instanceof Error ? error.stack : "",
      );
      throw error;
    }
  }

  /**
   * Pause/Resume queue
   */
  async toggleQueue(queueName: string, pause: boolean) {
    const queues = this.getQueues();
    const queue = queues[queueName];

    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    try {
      if (pause) {
        await queue.pause();
        this.logger.log(`Queue ${queueName} paused`);
      } else {
        await queue.resume();
        this.logger.log(`Queue ${queueName} resumed`);
      }
      return { queueName, paused: pause };
    } catch (error) {
      this.logger.error(
        `Failed to ${pause ? "pause" : "resume"} queue ${queueName}:`,
        error instanceof Error ? error.stack : "",
      );
      throw error;
    }
  }

  /**
   * Get queue health status
   */
  async getQueueHealth() {
    const stats = await this.getQueueStats();
    const health = {
      overall: "healthy" as string,
      queues: {} as Record<string, string>,
      issues: [] as string[],
    };

    for (const [queueName, queueStats] of Object.entries(stats)) {
      const stat = queueStats as Record<string, unknown>;
      if (stat.error) {
        health.queues[queueName] = "unhealthy";
        health.issues.push(`Queue ${queueName}: ${stat.error}`);
        health.overall = "unhealthy";
      } else if ((stat.failed as number) > 100) {
        health.queues[queueName] = "degraded";
        health.issues.push(
          `Queue ${queueName}: High failure rate (${stat.failed} failed jobs)`,
        );
        health.overall =
          health.overall === "healthy" ? "degraded" : health.overall;
      } else if ((stat.waiting as number) > 1000) {
        health.queues[queueName] = "degraded";
        health.issues.push(
          `Queue ${queueName}: High queue depth (${stat.waiting} waiting jobs)`,
        );
        health.overall =
          health.overall === "healthy" ? "degraded" : health.overall;
      } else {
        health.queues[queueName] = "healthy";
      }
    }

    return health;
  }
}
