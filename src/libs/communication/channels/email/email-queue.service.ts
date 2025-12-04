import { Injectable, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { LoggingService } from '@logging';
import { QueueService } from '@infrastructure/queue';
import { LogType, LogLevel } from '@core/types';

export interface EmailQueueData {
  to: string | string[];
  subject: string;
  body: string;
  isHtml?: boolean;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }>;
  priority?: 'low' | 'normal' | 'high' | 'critical';
  delay?: number;
  metadata?: Record<string, unknown>;
}

export interface BulkEmailData {
  emails: EmailQueueData[];
  batchSize?: number;
  delayBetweenBatches?: number;
}

export interface EmailJobResult {
  success: boolean;
  messageId?: string;
  error?: string;
  timestamp: Date;
}

export interface EmailQueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

@Injectable()
export class EmailQueueService {
  constructor(
    @Optional()
    @InjectQueue(QueueService.EMAIL_QUEUE as string)
    private readonly emailQueue: Queue<EmailQueueData> | null,
    private readonly queueService: QueueService,
    private readonly loggingService: LoggingService
  ) {}

  async addEmailToQueue(
    emailData: EmailQueueData,
    options?: {
      delay?: number;
      attempts?: number;
      backoff?: number | { type: string; delay: number };
      priority?: 'low' | 'normal' | 'high' | 'critical';
      removeOnComplete?: number;
      removeOnFail?: number;
    }
  ): Promise<Job<EmailQueueData>> {
    try {
      const priorityString = options?.priority || emailData.priority || 'normal';
      const job = await this.queueService.addJob<EmailQueueData>(
        QueueService.EMAIL_QUEUE as string,
        'send-email',
        emailData,
        {
          delay: emailData.delay || options?.delay || 0,
          attempts: options?.attempts || 3,
          priority: this.getPriorityValue(priorityString),
          removeOnComplete: options?.removeOnComplete || 50,
          removeOnFail: options?.removeOnFail || 20,
        }
      );

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        'Email added to queue',
        'EmailQueueService',
        {
          jobId: job.id,
          to: Array.isArray(emailData.to) ? emailData.to.join(', ') : emailData.to,
          subject: emailData.subject,
          priority: emailData.priority || 'normal',
        }
      );

      return job;
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        'Failed to add email to queue',
        'EmailQueueService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          to: emailData.to,
          subject: emailData.subject,
        }
      );
      throw error;
    }
  }

  async addBulkEmailsToQueue(
    bulkEmailData: BulkEmailData,
    options?: {
      attempts?: number;
      backoff?: number | { type: string; delay: number };
      removeOnComplete?: number;
      removeOnFail?: number;
    }
  ): Promise<Job<EmailQueueData>[]> {
    try {
      const { emails, batchSize = 50, delayBetweenBatches = 1000 } = bulkEmailData;
      const jobs: Job<EmailQueueData>[] = [];

      // Process emails in batches
      for (let i = 0; i < emails.length; i += batchSize) {
        const batch = emails.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize);
        const batchDelay = batchNumber * delayBetweenBatches;

        for (const emailData of batch) {
          const job = await this.queueService.addJob<EmailQueueData>(
            QueueService.EMAIL_QUEUE as string,
            'send-bulk-email',
            {
              ...emailData,
              metadata: {
                ...(emailData.metadata || {}),
                batchNumber,
                totalBatches: Math.ceil(emails.length / batchSize),
              },
            },
            {
              delay: batchDelay + (emailData.delay || 0),
              attempts: options?.attempts || 3,
              priority: this.getPriorityValue(emailData.priority || 'normal'),
              removeOnComplete: options?.removeOnComplete || 50,
              removeOnFail: options?.removeOnFail || 20,
            }
          );

          jobs.push(job as Job<EmailQueueData>);
        }
      }

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        'Bulk emails added to queue',
        'EmailQueueService',
        {
          totalEmails: emails.length,
          batches: Math.ceil(emails.length / batchSize),
          batchSize,
          totalJobs: jobs.length,
        }
      );

      return jobs;
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        'Failed to add bulk emails to queue',
        'EmailQueueService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          emailCount: bulkEmailData.emails.length,
        }
      );
      throw error;
    }
  }

  async scheduleRecurringEmail(
    emailData: EmailQueueData,
    cronExpression: string,
    options?: {
      attempts?: number;
      backoff?: number | { type: string; delay: number };
      removeOnComplete?: number;
      removeOnFail?: number;
    }
  ): Promise<Job<EmailQueueData>> {
    if (!this.emailQueue) {
      throw new Error('Email queue is not available (cache is disabled)');
    }
    try {
      // Use direct queue access for recurring jobs (cron) as QueueService doesn't support repeat option
      const job = await this.emailQueue.add('send-recurring-email', emailData, {
        repeat: { pattern: cronExpression },
        attempts: options?.attempts || 3,
        backoff: options?.backoff
          ? typeof options.backoff === 'number'
            ? { type: 'exponential', delay: options.backoff }
            : options.backoff
          : { type: 'exponential', delay: 2000 },
        priority: this.getPriorityValue(emailData.priority),
        removeOnComplete: options?.removeOnComplete || 50,
        removeOnFail: options?.removeOnFail || 20,
      });

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        'Recurring email scheduled',
        'EmailQueueService',
        {
          jobId: job.id,
          to: emailData.to,
          subject: emailData.subject,
          cronExpression,
          priority: emailData.priority || 'normal',
        }
      );

      return job;
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        'Failed to schedule recurring email',
        'EmailQueueService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          to: emailData.to,
          subject: emailData.subject,
          cronExpression,
        }
      );
      throw error;
    }
  }

  async getJob(jobId: string | number): Promise<Job<EmailQueueData> | null> {
    if (!this.emailQueue) {
      return null;
    }
    try {
      const jobIdString = String(jobId);
      const job = await this.emailQueue.getJob(jobIdString);
      return job || null;
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        'Failed to get job',
        'EmailQueueService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          jobId,
        }
      );
      return null;
    }
  }

  async removeJob(jobId: string | number): Promise<boolean> {
    if (!this.emailQueue) {
      return false;
    }
    try {
      const jobIdString = String(jobId);
      const job = await this.emailQueue.getJob(jobIdString);
      if (job) {
        await job.remove();
        void this.loggingService.log(
          LogType.QUEUE,
          LogLevel.INFO,
          'Job removed from queue',
          'EmailQueueService',
          { jobId }
        );
        return true;
      }
      return false;
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        'Failed to remove job',
        'EmailQueueService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          jobId,
        }
      );
      return false;
    }
  }

  async retryFailedJob(jobId: string | number): Promise<boolean> {
    if (!this.emailQueue) {
      return false;
    }
    try {
      const jobIdString = String(jobId);
      const job = await this.emailQueue.getJob(jobIdString);
      if (job) {
        await job.retry();
        void this.loggingService.log(
          LogType.QUEUE,
          LogLevel.INFO,
          'Job retried',
          'EmailQueueService',
          { jobId }
        );
        return true;
      }
      return false;
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        'Failed to retry job',
        'EmailQueueService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          jobId,
        }
      );
      return false;
    }
  }

  async getQueueStats(): Promise<EmailQueueStats> {
    try {
      // Using string literal that matches QueueService.EMAIL_QUEUE
      const metrics = await this.queueService.getQueueMetrics('email-queue');
      return {
        waiting: metrics.waiting,
        active: metrics.active,
        completed: metrics.completed,
        failed: metrics.failed,
        delayed: metrics.delayed,
        paused: 0, // BullMQ doesn't track paused count separately
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        'Failed to get queue stats',
        'EmailQueueService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );

      return {
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: 0,
      };
    }
  }

  async getFailedJobs(start = 0, end = -1): Promise<Job<EmailQueueData>[]> {
    try {
      const jobs = await this.queueService.getJobs(QueueService.EMAIL_QUEUE, {
        status: ['failed'],
      });
      // Apply start/end range if specified
      if (end === -1) {
        return jobs.slice(start) as Job<EmailQueueData>[];
      }
      return jobs.slice(start, end + 1) as Job<EmailQueueData>[];
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        'Failed to get failed jobs',
        'EmailQueueService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      return [];
    }
  }

  async retryAllFailedJobs(): Promise<{ success: number; failed: number }> {
    try {
      const failedJobs = await this.getFailedJobs();
      let successCount = 0;
      let failedCount = 0;

      for (const job of failedJobs) {
        try {
          await job.retry();
          successCount++;
        } catch {
          failedCount++;
        }
      }

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        'Retry all failed jobs completed',
        'EmailQueueService',
        {
          totalJobs: failedJobs.length,
          successful: successCount,
          failed: failedCount,
        }
      );

      return { success: successCount, failed: failedCount };
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        'Failed to retry all failed jobs',
        'EmailQueueService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      return { success: 0, failed: 0 };
    }
  }

  async clearCompletedJobs(): Promise<number> {
    try {
      const completedJobs = await this.queueService.getJobs(QueueService.EMAIL_QUEUE as string, {
        status: ['completed'],
      });
      let clearedCount = 0;

      for (const job of completedJobs) {
        try {
          await job.remove();
          clearedCount++;
        } catch {
          // Continue even if some jobs fail to be removed
        }
      }

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        'Completed jobs cleared',
        'EmailQueueService',
        {
          clearedCount,
          totalCompleted: completedJobs.length,
        }
      );

      return clearedCount;
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        'Failed to clear completed jobs',
        'EmailQueueService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      return 0;
    }
  }

  async pauseQueue(): Promise<void> {
    if (!this.emailQueue) {
      throw new Error('Email queue is not available (cache is disabled)');
    }
    try {
      await this.emailQueue.pause();
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        'Email queue paused',
        'EmailQueueService'
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        'Failed to pause queue',
        'EmailQueueService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      throw error;
    }
  }

  async resumeQueue(): Promise<void> {
    if (!this.emailQueue) {
      throw new Error('Email queue is not available (cache is disabled)');
    }
    try {
      await this.emailQueue.resume();
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        'Email queue resumed',
        'EmailQueueService'
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        'Failed to resume queue',
        'EmailQueueService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      throw error;
    }
  }

  async drainQueue(): Promise<void> {
    if (!this.emailQueue) {
      throw new Error('Email queue is not available (cache is disabled)');
    }
    try {
      // Remove all jobs from the queue using obliterate (BullMQ method)
      await this.emailQueue.obliterate({ force: true });
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        'Email queue drained',
        'EmailQueueService'
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        'Failed to drain queue',
        'EmailQueueService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
      throw error;
    }
  }

  private getPriorityValue(priority?: string): number {
    switch (priority) {
      case 'critical':
        return 1; // Critical - highest priority
      case 'high':
        return 2; // High priority
      case 'normal':
        return 3; // Normal priority (default)
      case 'low':
        return 4; // Low priority
      default:
        return 3; // Default to normal
    }
  }

  async getQueueHealth(): Promise<{
    isHealthy: boolean;
    stats: EmailQueueStats;
    performance: {
      averageWaitTime: number;
      throughputPerHour: number;
      errorRate: number;
    };
  }> {
    try {
      const stats = await this.getQueueStats();
      const metrics = await this.queueService.getQueueMetrics(QueueService.EMAIL_QUEUE as string);
      const jobs = await this.queueService.getJobs(QueueService.EMAIL_QUEUE, {
        status: ['completed'],
      });
      const completed = jobs.slice(0, 99);

      // Calculate performance metrics
      const totalProcessed = stats.completed + stats.failed;
      const calculatedErrorRate = totalProcessed > 0 ? (stats.failed / totalProcessed) * 100 : 0;
      const errorRate = metrics.errorRate || calculatedErrorRate;

      // Calculate average processing time from recent completed jobs
      const recentJobs = completed.slice(-50);
      const avgWaitTime =
        recentJobs.length > 0
          ? recentJobs.reduce((sum, job) => {
              const wait = job.processedOn && job.timestamp ? job.processedOn - job.timestamp : 0;
              return sum + wait;
            }, 0) / recentJobs.length
          : metrics.averageProcessingTime || 0;

      // Estimate throughput (jobs per hour based on recent activity)
      const hourlyThroughput = metrics.throughputPerMinute
        ? metrics.throughputPerMinute * 60
        : recentJobs.length > 0
          ? recentJobs.length * 60
          : 0;
      const isHealthy =
        stats.active < 100 && // Not too many active jobs
        stats.failed < 50 && // Not too many failed jobs
        errorRate < 10; // Error rate below 10%

      return {
        isHealthy,
        stats,
        performance: {
          averageWaitTime: Math.round(avgWaitTime),
          throughputPerHour: Math.round(hourlyThroughput),
          errorRate: Math.round(errorRate * 100) / 100,
        },
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        'Failed to get queue health',
        'EmailQueueService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );

      return {
        isHealthy: false,
        stats: {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          paused: 0,
        },
        performance: {
          averageWaitTime: 0,
          throughputPerHour: 0,
          errorRate: 100,
        },
      };
    }
  }
}
