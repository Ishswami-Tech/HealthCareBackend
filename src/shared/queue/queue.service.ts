import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job } from 'bull';

export enum JobType {
  CREATE = 'create',
  UPDATE = 'update',
  CONFIRM = 'confirm',
  COMPLETE = 'complete',
  NOTIFY = 'notify',
}

export enum JobPriority {
  LOW = 10,
  NORMAL = 5,
  HIGH = 1,
  CRITICAL = 0
}

export interface JobData {
  id: string;
  userId?: string;
  resourceId?: string;
  resourceType?: string;
  locationId?: string;
  date?: Date;
  metadata?: Record<string, any>;
}

@Injectable()
export class QueueService implements OnModuleInit {
  private readonly logger = new Logger(QueueService.name);
  private jobCleanupInterval: NodeJS.Timeout;

  constructor(
    private readonly serviceQueue: Queue,
    private readonly appointmentQueue: Queue,
  ) {}

  async onModuleInit() {
    // Listen for queue events
    this.setupQueueListeners();
    
    // Setup periodic job cleanup
    this.jobCleanupInterval = setInterval(
      () => this.cleanupOldJobs(), 
      1000 * 60 * 60 * 6 // Run every 6 hours
    );
  }

  private setupQueueListeners() {
    // Service queue listeners
    this.serviceQueue.on('error', (error) => {
      this.logger.error(`Service queue error: ${error.message}`, error.stack);
    });

    this.serviceQueue.on('failed', (job, error) => {
      this.logger.error(`Service job ${job.id} failed: ${error.message}`);
    });

    this.serviceQueue.on('stalled', (jobId) => {
      this.logger.warn(`Service job ${jobId} stalled and will be reprocessed`);
    });

    // Appointment queue listeners
    this.appointmentQueue.on('error', (error) => {
      this.logger.error(`Appointment queue error: ${error.message}`, error.stack);
    });

    this.appointmentQueue.on('failed', (job, error) => {
      this.logger.error(`Appointment job ${job.id} failed: ${error.message}`);
    });

    this.appointmentQueue.on('stalled', (jobId) => {
      this.logger.warn(`Appointment job ${jobId} stalled and will be reprocessed`);
    });
  }

  /**
   * Clean up old jobs to prevent Redis memory issues
   */
  private async cleanupOldJobs() {
    try {
      const twoWeeksAgo = new Date();
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

      // Clean completed jobs older than 2 weeks
      await this.serviceQueue.clean(1000 * 60 * 60 * 24 * 14, 'completed');
      await this.appointmentQueue.clean(1000 * 60 * 60 * 24 * 14, 'completed');
      
      // Clean failed jobs older than 2 weeks
      await this.serviceQueue.clean(1000 * 60 * 60 * 24 * 14, 'failed');
      await this.appointmentQueue.clean(1000 * 60 * 60 * 24 * 14, 'failed');
      
      this.logger.log('Cleaned up old jobs from the queues');
    } catch (error) {
      this.logger.error(`Error cleaning up jobs: ${error.message}`, error.stack);
    }
  }

  /**
   * Add a job to the queue
   * @param type - Type of job
   * @param data - Job data
   * @param options - Additional options like delay, priority
   * @returns Job ID as a string
   */
  async addJob(
    type: string,
    data: JobData,
    options: { 
      delay?: number; 
      priority?: JobPriority | number; 
      attempts?: number; 
      removeOnComplete?: boolean;
      jobId?: string; // Optional custom job ID
      timeout?: number; // Job timeout in milliseconds
      queueName?: string; // Optional queue name
    } = {},
  ): Promise<string> {
    try {
      // Validate data
      if (!data.id) {
        throw new Error('Job data must include an ID');
      }
      
      // Determine which queue to use based on the resource type or explicit queue name
      const queue = this.getQueueForJob(data, options.queueName);
      
      // Use custom job ID if provided, otherwise generate one
      const jobId = options.jobId || `${type}-${data.id}-${Date.now()}`;
      
      // Check if job already exists with the same ID
      if (options.jobId) {
        const existingJob = await queue.getJob(jobId);
        if (existingJob) {
          this.logger.log(`Job ${jobId} already exists, returning existing job ID`);
          return jobId;
        }
      }

      // Add job to queue with enhanced options
      const job = await queue.add(type, data, {
        jobId,
        delay: options.delay || 0,
        priority: options.priority !== undefined ? options.priority : JobPriority.NORMAL,
        attempts: options.attempts || 3,
        removeOnComplete: options.removeOnComplete !== undefined 
          ? options.removeOnComplete 
          : false, // Keep completed jobs for monitoring by default
        timeout: options.timeout || 30000, // Default 30 second timeout
        backoff: {
          type: 'exponential',
          delay: 5000, // 5 seconds initial delay
        },
      });
      
      this.logger.log(`Added ${type} job for resource ${data.id} with job ID ${job.id}`);
      return job.id.toString(); // Convert JobId to string
    } catch (error) {
      this.logger.error(`Failed to add ${type} job to queue: ${error.message}`, error.stack);
      throw new Error(`Failed to add job to queue: ${error.message}`);
    }
  }
  
  /**
   * Determine which queue to use for a job
   */
  private getQueueForJob(data: JobData, queueName?: string): Queue {
    if (queueName === 'appointment-queue') {
      return this.appointmentQueue;
    }
    if (queueName === 'service-queue') {
      return this.serviceQueue;
    }
    
    // If resourceType is specified, use that to determine queue
    if (data.resourceType) {
      return data.resourceType.includes('appointment') 
        ? this.appointmentQueue 
        : this.serviceQueue;
    }
    
    // Default to service queue
    return this.serviceQueue;
  }

  /**
   * Get job by ID
   * @param jobId - The job ID
   * @param queueName - Optional queue name
   * @returns Job data
   */
  async getJob(jobId: string, queueName?: string): Promise<Job | null> {
    try {
      // Try service queue first if not specified
      if (!queueName || queueName === 'service-queue') {
        const job = await this.serviceQueue.getJob(jobId);
        if (job) return job;
      }
      
      // Try appointment queue if not found or explicitly specified
      if (!queueName || queueName === 'appointment-queue') {
        return await this.appointmentQueue.getJob(jobId);
      }
      
      return null;
    } catch (error) {
      this.logger.error(`Error getting job ${jobId}: ${error.message}`, error.stack);
      return null;
    }
  }

  /**
   * Remove a job from the queue
   * @param jobId - The job ID
   * @param queueName - Optional queue name
   * @returns Success status
   */
  async removeJob(jobId: string, queueName?: string): Promise<boolean> {
    try {
      let job: Job | null = null;
      
      // Try to find the job in the appropriate queue(s)
      if (!queueName || queueName === 'service-queue') {
        job = await this.serviceQueue.getJob(jobId);
      }
      
      if ((!job && !queueName) || queueName === 'appointment-queue') {
        job = await this.appointmentQueue.getJob(jobId);
      }
      
      if (!job) {
        this.logger.warn(`Job ${jobId} not found in any queue`);
        return false;
      }
      
      await job.remove();
      this.logger.log(`Job ${jobId} removed from queue`);
      return true;
    } catch (error) {
      this.logger.error(`Error removing job ${jobId}: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * Get current position in queue for a resource
   * @param resourceId - The resource ID
   * @param resourceType - The type of resource (e.g., 'appointment')
   * @param queueName - Optional queue name to search in
   * @returns Queue position
   */
  async getQueuePosition(
    resourceId: string, 
    resourceType?: string,
    queueName?: string
  ): Promise<number> {
    try {
      // Determine which queue to check based on the parameters
      const queue = queueName === 'appointment-queue' ? 
        this.appointmentQueue : 
        (queueName === 'service-queue' ? 
          this.serviceQueue : 
          (resourceType?.includes('appointment') ? 
            this.appointmentQueue : 
            this.serviceQueue));
      
      // Get all waiting jobs
      const waitingJobs = await queue.getWaiting();
      
      // Find position of the resource in the queue
      const position = waitingJobs.findIndex(job => {
        if (resourceType) {
          return job.data.resourceId === resourceId && job.data.resourceType === resourceType;
        }
        return job.data.id === resourceId;
      });
      
      return position >= 0 ? position + 1 : -1; // Return 1-based position or -1 if not found
    } catch (error) {
      this.logger.error(`Failed to get queue position: ${error.message}`, error.stack);
      throw new Error('Failed to get queue position');
    }
  }

  /**
   * Get queue statistics by location
   * @param locationId - The location ID
   * @param resourceType - Optional resource type to filter by
   * @returns Queue statistics
   */
  async getQueueStatsByLocation(locationId: string, resourceType?: string): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    avgWaitTime: number;
    estimatedWaitTime: number;
  }> {
    try {
      const waiting = await this.serviceQueue.getWaiting();
      const active = await this.serviceQueue.getActive();
      const completed = await this.serviceQueue.getCompleted();
      const failed = await this.serviceQueue.getFailed();
      
      // Filter by location and optionally by resourceType
      const filterJob = (job) => {
        if (resourceType) {
          return job.data.locationId === locationId && job.data.resourceType === resourceType;
        }
        return job.data.locationId === locationId;
      };
      
      const locationWaiting = waiting.filter(filterJob);
      const locationActive = active.filter(filterJob);
      const locationCompleted = completed.filter(filterJob).slice(-100); // Last 100 completed jobs
      const locationFailed = failed.filter(filterJob);
      
      // Calculate average wait time from completed jobs
      const waitTimes = locationCompleted.map(job => {
        const processed = job.processedOn || Date.now();
        const added = job.timestamp;
        return processed - added;
      });
      
      const avgWaitTime = waitTimes.length > 0 
        ? waitTimes.reduce((sum, time) => sum + time, 0) / waitTimes.length 
        : 0;
      
      // Estimate wait time based on average processing time and queue position
      const estimatedWaitTime = waitTimes.length > 0 
        ? (avgWaitTime * locationWaiting.length) / Math.max(1, locationActive.length)
        : locationWaiting.length * 60000; // Fallback: 1 minute per waiting job
      
      return {
        waiting: locationWaiting.length,
        active: locationActive.length,
        completed: locationCompleted.length,
        failed: locationFailed.length,
        avgWaitTime,
        estimatedWaitTime,
      };
    } catch (error) {
      this.logger.error(`Failed to get queue stats: ${error.message}`, error.stack);
      throw new Error('Failed to get queue statistics');
    }
  }

  /**
   * Pause the processing of jobs in the queue
   */
  async pauseQueue(): Promise<boolean> {
    try {
      await this.serviceQueue.pause();
      this.logger.log('Queue paused');
      return true;
    } catch (error) {
      this.logger.error(`Error pausing queue: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * Resume the processing of jobs in the queue
   */
  async resumeQueue(): Promise<boolean> {
    try {
      await this.serviceQueue.resume();
      this.logger.log('Queue resumed');
      return true;
    } catch (error) {
      this.logger.error(`Error resuming queue: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * Clean up resources when the application shuts down
   */
  async onModuleDestroy() {
    if (this.jobCleanupInterval) {
      clearInterval(this.jobCleanupInterval);
    }
    
    // Close the queue when the app shuts down
    await this.serviceQueue.close();
    this.logger.log('Queue closed');
  }
} 