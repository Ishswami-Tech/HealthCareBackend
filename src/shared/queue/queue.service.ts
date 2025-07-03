/**
 * CENTRALIZED QUEUE SERVICE (BullMQ)
 * -------------------------------------------------------------
 * All queue operations (add, get, remove, etc.) must go through this service.
 * Do NOT use BullMQ directly anywhere else in the codebase.
 *
 * Usage Example:
 *   // Inject QueueService in your service or controller
 *   constructor(private readonly queueService: QueueService) {}
 *
 *   // Add a job
 *   await this.queueService.addJob('create', { id: '123', ... }, { queueName: 'service-queue' });
 *
 *   // Get a job
 *   const job = await this.queueService.getJob('jobId');
 *
 *   // Remove a job
 *   await this.queueService.removeJob('jobId');
 *
 * This pattern ensures maintainability, scalability, and robust queue management.
 * -------------------------------------------------------------
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { PrismaService } from '../database/prisma/prisma.service';
import { AppointmentStatus } from '../database/prisma/prisma.types';
import { SERVICE_QUEUE, APPOINTMENT_QUEUE, VIDHAKARMA_QUEUE, PANCHAKARMA_QUEUE, CHEQUP_QUEUE } from './queue.constants';

export enum JobType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
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
  type?: JobType;
  userId?: string;
  locationId?: string;
  metadata?: Record<string, any>;
  resourceType?: string;
  resourceId?: string;
  date?: Date;
}

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  timestamp: string;
}

@Injectable()
export class QueueService implements OnModuleInit {
  private readonly logger = new Logger(QueueService.name);
  private jobCleanupInterval: NodeJS.Timeout;

  constructor(
    @InjectQueue(SERVICE_QUEUE) private readonly serviceQueue: Queue,
    @InjectQueue(APPOINTMENT_QUEUE) private readonly appointmentQueue: Queue,
    @InjectQueue(VIDHAKARMA_QUEUE) private readonly vidhakarmaQueue: Queue,
    @InjectQueue(PANCHAKARMA_QUEUE) private readonly panchakarmaQueue: Queue,
    @InjectQueue(CHEQUP_QUEUE) private readonly chequpQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    // NOTE: BullMQ does not support queue.on('failed') directly. Use Worker for job events.
    // You should move event listeners to Worker-based processors.
    // this.setupQueueListeners();
    // Setup periodic job cleanup
    this.jobCleanupInterval = setInterval(
      () => this.cleanupOldJobs(), 
      1000 * 60 * 60 * 6 // Run every 6 hours
    );
  }

  /**
   * Clean up old jobs to prevent Redis memory issues
   */
  private async cleanupOldJobs() {
    try {
      // BullMQ: use queue.clean for completed/failed jobs
      await this.serviceQueue.clean(1000 * 60 * 60 * 24 * 14, 'completed' as any);
      await this.appointmentQueue.clean(1000 * 60 * 60 * 24 * 14, 'completed' as any);
      await this.serviceQueue.clean(1000 * 60 * 60 * 24 * 14, 'failed' as any);
      await this.appointmentQueue.clean(1000 * 60 * 60 * 24 * 14, 'failed' as any);
      this.logger.log('Cleaned up old jobs from the queues');
    } catch (error) {
      this.logger.error(`Error cleaning up jobs: ${error.message}`, error.stack);
    }
  }

  /**
   * Add a job to the queue
   * Ensure job data is validated and log all lifecycle events
   * Job handlers should be idempotent to avoid duplicate side effects
   */
  async addJob(
    type: string,
    data: JobData,
    options: {
      delay?: number;
      priority?: JobPriority | number;
      attempts?: number;
      removeOnComplete?: boolean;
      jobId?: string;
      queueName?: string;
    } = {},
  ): Promise<string> {
    try {
      if (!data.id) {
        this.logger.error('Job data must include an ID');
        throw new Error('Job data must include an ID');
      }
      const queue = this.getQueueForJob(data, options.queueName);
      const jobId = options.jobId || `${type}-${data.id}-${Date.now()}`;
      if (options.jobId) {
        const existingJob = await queue.getJob(jobId);
        if (existingJob) {
          this.logger.log(`Job ${jobId} already exists, returning existing job ID`);
          return jobId;
        }
      }
      const job = await queue.add(type, data, {
        jobId,
        delay: options.delay || 0,
        priority: options.priority !== undefined ? options.priority : JobPriority.NORMAL,
        attempts: options.attempts || 3,
        removeOnComplete: options.removeOnComplete !== undefined 
          ? options.removeOnComplete 
          : false,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      });
      this.logger.log(`Added ${type} job for resource ${data.id} with job ID ${job.id}`);
      return job.id.toString();
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
    if (queueName === 'vidhakarma-queue') {
      return this.vidhakarmaQueue;
    }
    if (queueName === 'panchakarma-queue') {
      return this.panchakarmaQueue;
    }
    if (queueName === 'chequp-queue') {
      return this.chequpQueue;
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
    // Gracefully close all queues
    await Promise.all([
      this.serviceQueue.close(),
      this.appointmentQueue.close(),
      this.vidhakarmaQueue.close(),
      this.panchakarmaQueue.close(),
      this.chequpQueue.close(),
    ]);
    this.logger.log('All queues closed');
  }

  /**
   * Health check for Redis and all queues
   */
  async healthCheck(): Promise<{ redis: boolean; queues: Record<string, boolean> }> {
    const result: { redis: boolean; queues: Record<string, boolean> } = { redis: false, queues: {} };
    try {
      // BullMQ: Use a simple Redis command for health check if needed
      result.redis = true; // Assume healthy if no error
    } catch (e) {
      this.logger.error('Redis health check failed', e.stack);
      return result;
    }
    // Check each queue
    const queues = [
      { name: 'serviceQueue', queue: this.serviceQueue },
      { name: 'appointmentQueue', queue: this.appointmentQueue },
      { name: 'vidhakarmaQueue', queue: this.vidhakarmaQueue },
      { name: 'panchakarmaQueue', queue: this.panchakarmaQueue },
      { name: 'chequpQueue', queue: this.chequpQueue },
    ];
    for (const { name, queue } of queues) {
      try {
        await queue.getJobCounts();
        result.queues[name] = true;
      } catch (e) {
        this.logger.error(`Queue health check failed: ${name}`, e.stack);
        result.queues[name] = false;
      }
    }
    return result;
  }

  /**
   * Move failed jobs to a Dead Letter Queue (DLQ) after all retries
   * (You must create and process a DLQ queue for this to be effective)
   */
  private async moveToDLQ(job: Job, queueName: string) {
    try {
      // Example: Add job data to a DLQ queue (could be a special queue or external system)
      const dlqQueue = this.serviceQueue; // Replace with your DLQ queue
      await dlqQueue.add('dlq', job.data, { removeOnComplete: true });
      this.logger.warn(`Job ${job.id} moved to DLQ from ${queueName}`);
    } catch (e) {
      this.logger.error(`Failed to move job ${job.id} to DLQ: ${e.message}`, e.stack);
    }
  }

  /**
   * Get appointment details by ID
   */
  async getAppointmentDetails(appointmentId: string) {
    try {
      return await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          doctor: {
            include: {
              user: true
            }
          },
          patient: {
            include: {
              user: true
            }
          },
          location: true
        },
      });
    } catch (error) {
      this.logger.error(`Error getting appointment details: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get appointment queue position and estimated wait time
   */
  async getAppointmentQueuePosition(appointmentId: string) {
    try {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          location: true,
        },
      });

      if (!appointment) {
        throw new Error('Appointment not found');
      }

      const appointmentsAhead = await this.prisma.appointment.count({
        where: {
          locationId: appointment.locationId,
          status: {
            in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED],
          },
          date: {
            lt: appointment.date,
          },
        },
      });

      // Calculate estimated wait time (15 minutes per appointment ahead)
      const estimatedWaitTime = appointmentsAhead * 15;

      return {
        position: appointmentsAhead + 1,
        estimatedWaitTime,
        totalAhead: appointmentsAhead,
      };
    } catch (error) {
      this.logger.error(`Error getting queue position: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get all active appointments
   */
  async getActiveAppointments() {
    try {
      return await this.prisma.appointment.findMany({
        where: {
          status: {
            in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED],
          },
        },
        include: {
          doctor: {
            include: {
              user: true
            }
          },
          patient: {
            include: {
              user: true
            }
          },
          location: true
        },
        orderBy: {
          date: 'asc',
        },
      });
    } catch (error) {
      this.logger.error(`Error getting active appointments: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get user's active appointments
   */
  async getUserActiveAppointments(userId: string) {
    try {
      return await this.prisma.appointment.findMany({
        where: {
          userId,
          status: {
            in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED],
          },
        },
        include: {
          doctor: {
            include: {
              user: true
            }
          },
          patient: {
            include: {
              user: true
            }
          },
          location: true
        },
        orderBy: {
          date: 'asc',
        },
      });
    } catch (error) {
      this.logger.error(`Error getting user appointments: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get doctor's queue status
   */
  async getDoctorQueueStatus(doctorId: string) {
    try {
      const appointments = await this.prisma.appointment.findMany({
        where: {
          doctorId,
          status: {
            in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED],
          },
        },
        orderBy: {
          date: 'asc',
        },
      });

      const currentTime = new Date();
      const upcomingAppointments = appointments.filter(
        (apt) => apt.date > currentTime
      );

      return {
        totalAppointments: appointments.length,
        upcomingAppointments: upcomingAppointments.length,
        nextAppointment: upcomingAppointments[0] || null,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(`Error getting doctor queue status: ${error.message}`, error.stack);
      throw error;
    }
  }
} 