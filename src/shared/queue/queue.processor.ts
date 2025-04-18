import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { JobType, JobData } from './queue.service';
import { PrismaService } from '../database/prisma/prisma.service';

@Processor('service-queue')
export class QueueProcessor {
  private readonly logger = new Logger(QueueProcessor.name);

  constructor(private readonly prisma: PrismaService) {}

  @Process(JobType.CREATE)
  async processCreateJob(job: Job<JobData>) {
    try {
      this.logger.log(`Processing create job ${job.id} for resource ${job.data.id}`);
      
      // Generic processing logic for service-queue
      // Implementation of CREATE job for service-queue
      
      this.logger.log(`Job ${job.id} processed successfully`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Error processing create job: ${error.message}`, error.stack);
      throw error; // Rethrow to trigger job retry
    }
  }

  @Process(JobType.UPDATE)
  async processUpdateJob(job: Job<JobData>) {
    try {
      this.logger.log(`Processing update job ${job.id} for resource ${job.data.id}`);
      
      // Generic processing logic for service-queue
      // Implementation of UPDATE job for service-queue
      
      this.logger.log(`Job ${job.id} processed successfully`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Error processing update job: ${error.message}`, error.stack);
      throw error; // Rethrow to trigger job retry
    }
  }

  @Process(JobType.CONFIRM)
  async processConfirmJob(job: Job<JobData>) {
    try {
      this.logger.log(`Processing confirm job ${job.id} for resource ${job.data.id}`);
      
      // Generic processing logic for service-queue
      // Implementation of CONFIRM job for service-queue
      
      this.logger.log(`Job ${job.id} processed successfully`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Error processing confirm job: ${error.message}`, error.stack);
      throw error; // Rethrow to trigger job retry
    }
  }

  @Process(JobType.COMPLETE)
  async processCompleteJob(job: Job<JobData>) {
    try {
      this.logger.log(`Processing complete job ${job.id} for resource ${job.data.id}`);
      
      // Generic processing logic for service-queue
      // Implementation of COMPLETE job for service-queue
      
      this.logger.log(`Job ${job.id} processed successfully`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Error processing complete job: ${error.message}`, error.stack);
      throw error; // Rethrow to trigger job retry
    }
  }

  @Process(JobType.NOTIFY)
  async processNotifyJob(job: Job<JobData>) {
    try {
      this.logger.log(`Processing notification job ${job.id} for resource ${job.data.id}`);
      
      // Send notification logic for service-queue
      this.logger.log(`Sending notification for resource ${job.data.id} to user ${job.data.userId}`);
      
      // Example of FCM notification (would need to be implemented)
      // await this.fcmService.sendNotification({
      //   userId: job.data.userId,
      //   title: 'Resource Update',
      //   body: job.data.metadata?.message || 'Your resource status has been updated',
      //   data: { resourceId: job.data.id, resourceType: job.data.resourceType },
      // });
      
      this.logger.log(`Notification sent for resource ${job.data.id}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Error processing notification job: ${error.message}`, error.stack);
      throw error; // Rethrow to trigger job retry
    }
  }
} 