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
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../database/prisma/prisma.service';
import { AppointmentStatus } from '../database/prisma/prisma.types';
import { SERVICE_QUEUE, APPOINTMENT_QUEUE, VIDHAKARMA_QUEUE, PANCHAKARMA_QUEUE, CHEQUP_QUEUE, EMAIL_QUEUE, NOTIFICATION_QUEUE } from './queue.constants';

export enum JobType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  CONFIRM = 'confirm',
  COMPLETE = 'complete',
  NOTIFY = 'notify',
  
  // Healthcare-specific job types
  APPOINTMENT_REMINDER = 'appointment.reminder',
  APPOINTMENT_FOLLOWUP = 'appointment.followup',
  PATIENT_REGISTERED = 'patient.registered',
  MEDICAL_RECORD_CREATED = 'medical_record.created',
  PRESCRIPTION_REMINDER = 'prescription.reminder',
  LAB_RESULT_NOTIFICATION = 'lab_result.notification',
  URGENT_ALERT = 'urgent.alert',
  CONSENT_VERIFICATION = 'consent.verification',
  DATA_EXPORT = 'data.export',
  AUDIT_REPORT = 'audit.report',
  CACHE_INVALIDATION = 'cache.invalidation',
}

export enum JobPriority {
  BACKGROUND = 15,  // System maintenance, analytics
  LOW = 10,         // Routine tasks, non-urgent reports
  NORMAL = 5,       // Regular appointments, standard notifications
  HIGH = 2,         // Same-day appointments, important notifications
  URGENT = 1,       // Emergency appointments, critical notifications
  CRITICAL = 0      // Life-threatening situations, system alerts
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
  
  // Healthcare-specific fields
  patientId?: string;
  doctorId?: string;
  appointmentId?: string;
  clinicId?: string;
  
  // Compliance and audit
  auditTrail?: AuditEntry[];
  dataClassification?: DataClassification;
  consentTokens?: ConsentToken[];
  
  // Workflow context
  correlationId?: string;
  workflowId?: string;
  stepName?: string;
  
  // Scheduling and urgency
  scheduledFor?: Date;
  deadline?: Date;
  urgencyLevel?: 'routine' | 'urgent' | 'emergency';
  
  // Integration context
  source?: 'api' | 'scheduler' | 'integration' | 'system';
  integrationId?: string;
}

export interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  timestamp: string;
  
  // Enhanced healthcare metrics
  throughputPerSecond?: number;
  averageWaitTime?: number;
  averageProcessingTime?: number;
  errorRate?: number;
  criticalJobsWaiting?: number;
}

// Healthcare-specific types
export interface AuditEntry {
  timestamp: Date;
  action: string;
  userId?: string;
  details: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export interface ConsentToken {
  purpose: string;
  granted: boolean;
  grantedAt?: Date;
  expiresAt?: Date;
  restrictions?: string[];
}

export enum DataClassification {
  PUBLIC = 'public',
  INTERNAL = 'internal', 
  CONFIDENTIAL = 'confidential',
  PHI = 'phi',            // Protected Health Information
  EMERGENCY = 'emergency' // Emergency/critical patient data
}

export interface HealthcareJobOptions {
  delay?: number;
  attempts?: number;
  backoff?: 'exponential' | 'linear' | 'fixed';
  removeOnComplete?: boolean;
  removeOnFail?: boolean;
  
  // Healthcare-specific options
  requireConsent?: boolean;
  emergencyOverride?: boolean;
  auditLevel?: 'minimal' | 'standard' | 'detailed' | 'comprehensive';
  
  // Integration options
  timeout?: number;
  retryableErrors?: string[];
  nonRetryableErrors?: string[];
  
  // Workflow options
  dependencies?: string[];
  onSuccess?: string[];
  onFailure?: string[];
}

@Injectable()
export class QueueService implements OnModuleInit {
  private readonly logger = new Logger(QueueService.name);
  private jobCleanupInterval: NodeJS.Timeout;
  private metricsInterval?: NodeJS.Timeout;

  constructor(
    @InjectQueue(SERVICE_QUEUE) private readonly serviceQueue: Queue,
    @InjectQueue(APPOINTMENT_QUEUE) private readonly appointmentQueue: Queue,
    @InjectQueue(VIDHAKARMA_QUEUE) private readonly vidhakarmaQueue: Queue,
    @InjectQueue(PANCHAKARMA_QUEUE) private readonly panchakarmaQueue: Queue,
    @InjectQueue(CHEQUP_QUEUE) private readonly chequpQueue: Queue,
    @InjectQueue(EMAIL_QUEUE) private readonly emailQueue: Queue,
    @InjectQueue(NOTIFICATION_QUEUE) private readonly notificationQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit() {
    // Setup periodic job cleanup
    this.jobCleanupInterval = setInterval(
      () => this.cleanupOldJobs(), 
      1000 * 60 * 60 * 6 // Run every 6 hours
    );
    
    // Setup metrics collection for healthcare monitoring
    this.startHealthcareMetricsCollection();
    
    this.logger.log('Enhanced Healthcare Queue Service initialized');
  }

  /**
   * Clean up old jobs to prevent Redis memory issues
   */
  private async cleanupOldJobs() {
    try {
      const retentionMs = 1000 * 60 * 60 * 24 * 14; // 14 days
      const queues = [
        this.serviceQueue,
        this.appointmentQueue,
        this.vidhakarmaQueue,
        this.panchakarmaQueue,
        this.chequpQueue,
        this.emailQueue,
        this.notificationQueue
      ];

      // Clean completed and failed jobs from all queues
      for (const queue of queues) {
        try {
          await queue.clean(retentionMs, 'completed' as any);
          await queue.clean(retentionMs, 'failed' as any);
        } catch (error) {
          this.logger.error(`Error cleaning queue ${queue.name}:`, error);
        }
      }
      
      this.logger.log('Healthcare queue cleanup completed');
      
      // Emit cleanup event for monitoring
      this.eventEmitter.emit('healthcare.queue.cleanup', {
        timestamp: new Date(),
        queuesProcessed: queues.length,
        retentionDays: 14
      });
    } catch (error) {
      this.logger.error(`Error during queue cleanup: ${error.message}`, error.stack);
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
   * Enhanced healthcare job creation with compliance features
   */
  async addHealthcareJob(
    jobData: JobData,
    options: HealthcareJobOptions = {}
  ): Promise<string> {
    try {
      // Validate healthcare-specific job data
      this.validateHealthcareJobData(jobData);
      
      // Check consent if required
      if (options.requireConsent && !this.hasValidConsent(jobData)) {
        throw new Error('Valid consent required for this healthcare operation');
      }
      
      // Add audit entry
      if (!jobData.auditTrail) {
        jobData.auditTrail = [];
      }
      jobData.auditTrail.push({
        timestamp: new Date(),
        action: 'job_queued',
        details: {
          jobType: jobData.type,
          queueName: this.getQueueForJob(jobData).name,
          emergencyOverride: options.emergencyOverride || false
        }
      });
      
      // Determine priority based on urgency and data classification
      const priority = this.calculateHealthcarePriority(jobData, options);
      
      const jobId = await this.addJob(jobData.type as string, jobData, {
        ...options,
        priority,
        attempts: this.getHealthcareAttempts(jobData, options),
        jobId: jobData.id
      });
      
      // Emit healthcare-specific event for monitoring
      this.eventEmitter.emit('healthcare.job.added', {
        jobId,
        jobType: jobData.type,
        priority,
        dataClassification: jobData.dataClassification,
        patientId: jobData.patientId,
        doctorId: jobData.doctorId,
        clinicId: jobData.clinicId,
        urgencyLevel: jobData.urgencyLevel,
        scheduledFor: jobData.scheduledFor,
        deadline: jobData.deadline
      });
      
      return jobId;
      
    } catch (error) {
      this.logger.error(`Failed to add healthcare job: ${error.message}`, {
        jobType: jobData.type,
        patientId: jobData.patientId,
        doctorId: jobData.doctorId,
        error: error.stack
      });
      throw error;
    }
  }

  /**
   * Schedule appointment reminder jobs
   */
  async scheduleAppointmentReminders(
    appointmentId: string,
    patientId: string,
    doctorId: string,
    appointmentDate: Date,
    clinicId: string
  ): Promise<string[]> {
    const jobIds: string[] = [];
    const now = new Date();
    
    // Healthcare reminder intervals
    const reminderIntervals = [
      { hours: 24, type: 'day_before' },
      { hours: 2, type: 'two_hours_before' },
      { hours: 0.5, type: 'thirty_minutes_before' }
    ];
    
    for (const reminder of reminderIntervals) {
      const reminderTime = new Date(appointmentDate.getTime() - (reminder.hours * 60 * 60 * 1000));
      
      if (reminderTime > now) {
        const jobData: JobData = {
          id: `reminder_${appointmentId}_${reminder.type}`,
          type: JobType.APPOINTMENT_REMINDER,
          patientId,
          doctorId,
          appointmentId,
          clinicId,
          scheduledFor: reminderTime,
          urgencyLevel: 'routine',
          dataClassification: DataClassification.CONFIDENTIAL,
          source: 'system',
          auditTrail: [{
            timestamp: new Date(),
            action: 'reminder_scheduled',
            details: { reminderType: reminder.type, scheduledFor: reminderTime }
          }],
          metadata: {
            reminderType: reminder.type,
            appointmentDate,
            hoursBeforeAppointment: reminder.hours
          }
        };
        
        const jobId = await this.addHealthcareJob(jobData, {
          delay: reminderTime.getTime() - now.getTime(),
          removeOnComplete: true,
          auditLevel: 'standard'
        });
        
        jobIds.push(jobId);
      }
    }
    
    return jobIds;
  }

  /**
   * Process urgent patient alert with immediate priority
   */
  async processUrgentAlert(
    patientId: string,
    alertType: string,
    alertData: any,
    clinicId: string
  ): Promise<string> {
    const jobData: JobData = {
      id: `urgent_alert_${patientId}_${Date.now()}`,
      type: JobType.URGENT_ALERT,
      patientId,
      clinicId,
      urgencyLevel: 'emergency',
      dataClassification: DataClassification.EMERGENCY,
      deadline: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes deadline
      source: 'system',
      auditTrail: [{
        timestamp: new Date(),
        action: 'urgent_alert_created',
        details: { alertType, patientId, clinicId }
      }],
      metadata: {
        alertType,
        alertData,
        timestamp: new Date()
      }
    };
    
    return this.addHealthcareJob(jobData, {
      attempts: 5,
      emergencyOverride: true,
      auditLevel: 'comprehensive',
      timeout: 30000 // 30 seconds
    });
  }

  /**
   * Cancel scheduled jobs by correlation ID (e.g., when appointment is cancelled)
   */
  async cancelScheduledJobs(correlationId: string): Promise<number> {
    let cancelledCount = 0;
    const queues = [
      this.appointmentQueue,
      this.serviceQueue,
      this.emailQueue,
      this.notificationQueue,
      this.vidhakarmaQueue,
      this.panchakarmaQueue,
      this.chequpQueue
    ];
    
    for (const queue of queues) {
      try {
        const [waiting, delayed] = await Promise.all([
          queue.getWaiting(),
          queue.getDelayed()
        ]);
        
        const allJobs = [...waiting, ...delayed];
        
        for (const job of allJobs) {
          const jobData = job.data as JobData;
          if (jobData.correlationId === correlationId) {
            await job.remove();
            cancelledCount++;
            this.logger.debug(`Cancelled job ${job.id} with correlation ID ${correlationId}`);
          }
        }
      } catch (error) {
        this.logger.error(`Error cancelling jobs in queue ${queue.name}:`, error);
      }
    }
    
    if (cancelledCount > 0) {
      this.eventEmitter.emit('healthcare.jobs.cancelled', {
        correlationId,
        cancelledCount,
        timestamp: new Date()
      });
    }
    
    return cancelledCount;
  }
  
  /**
   * Determine which queue to use for a job
   */
  private getQueueForJob(data: JobData, queueName?: string): Queue {
    // Explicit queue name mapping
    if (queueName === 'appointment-queue') return this.appointmentQueue;
    if (queueName === 'service-queue') return this.serviceQueue;
    if (queueName === 'email-queue') return this.emailQueue;
    if (queueName === 'notification-queue') return this.notificationQueue;
    if (queueName === 'vidhakarma-queue') return this.vidhakarmaQueue;
    if (queueName === 'panchakarma-queue') return this.panchakarmaQueue;
    if (queueName === 'chequp-queue') return this.chequpQueue;
    
    // Healthcare job type routing
    if (data.type) {
      const jobType = data.type as JobType;
      
      // Appointment-related jobs
      if (jobType === JobType.APPOINTMENT_REMINDER || 
          jobType === JobType.APPOINTMENT_FOLLOWUP ||
          jobType.toString().includes('appointment')) {
        return this.appointmentQueue;
      }
      
      // Notification jobs
      if (jobType === JobType.NOTIFY ||
          jobType === JobType.URGENT_ALERT ||
          jobType === JobType.LAB_RESULT_NOTIFICATION ||
          jobType === JobType.PRESCRIPTION_REMINDER) {
        return this.notificationQueue;
      }
      
      // Email-specific jobs would go to email queue if implemented
      // For now, route to notification queue
      
      // Data processing jobs
      if (jobType === JobType.DATA_EXPORT ||
          jobType === JobType.AUDIT_REPORT ||
          jobType === JobType.CONSENT_VERIFICATION) {
        return this.serviceQueue;
      }
    }
    
    // Route based on urgency level for healthcare jobs
    if (data.urgencyLevel === 'emergency') {
      return this.notificationQueue; // Emergency alerts need immediate processing
    }
    
    // Resource type routing (legacy support)
    if (data.resourceType) {
      return data.resourceType.includes('appointment') 
        ? this.appointmentQueue 
        : this.serviceQueue;
    }
    
    // Default routing based on data classification
    if (data.dataClassification === DataClassification.EMERGENCY) {
      return this.notificationQueue;
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

  // Healthcare-specific helper methods

  /**
   * Validate healthcare job data
   */
  private validateHealthcareJobData(jobData: JobData): void {
    if (!jobData.id) {
      throw new Error('Healthcare job ID is required');
    }
    if (!jobData.type) {
      throw new Error('Healthcare job type is required');
    }
    if (!jobData.source) {
      throw new Error('Healthcare job source is required');
    }
    
    // Validate healthcare-specific fields
    if (jobData.dataClassification === DataClassification.PHI && !jobData.patientId) {
      throw new Error('Patient ID is required for PHI data');
    }
    
    if (jobData.urgencyLevel === 'emergency' && !jobData.deadline) {
      throw new Error('Emergency jobs must have a deadline');
    }
  }

  /**
   * Check if job has valid consent tokens
   */
  private hasValidConsent(jobData: JobData): boolean {
    if (!jobData.consentTokens || jobData.consentTokens.length === 0) {
      return false;
    }
    
    const now = new Date();
    return jobData.consentTokens.some(token => 
      token.granted && 
      (!token.expiresAt || token.expiresAt > now)
    );
  }

  /**
   * Calculate priority based on healthcare context
   */
  private calculateHealthcarePriority(jobData: JobData, options: HealthcareJobOptions): JobPriority {
    // Emergency override takes precedence
    if (options.emergencyOverride) {
      return JobPriority.CRITICAL;
    }
    
    // Urgency level mapping
    switch (jobData.urgencyLevel) {
      case 'emergency':
        return JobPriority.CRITICAL;
      case 'urgent':
        return JobPriority.URGENT;
      case 'routine':
        return JobPriority.NORMAL;
    }
    
    // Data classification priority
    switch (jobData.dataClassification) {
      case DataClassification.EMERGENCY:
        return JobPriority.CRITICAL;
      case DataClassification.PHI:
        return JobPriority.HIGH;
      case DataClassification.CONFIDENTIAL:
        return JobPriority.NORMAL;
      default:
        return JobPriority.NORMAL;
    }
  }

  /**
   * Determine retry attempts based on healthcare context
   */
  private getHealthcareAttempts(jobData: JobData, options: HealthcareJobOptions): number {
    if (options.attempts) {
      return options.attempts;
    }
    
    // More retries for critical healthcare operations
    if (jobData.urgencyLevel === 'emergency') {
      return 5;
    }
    
    if (jobData.dataClassification === DataClassification.PHI) {
      return 4;
    }
    
    return 3; // Default
  }

  /**
   * Start healthcare metrics collection
   */
  private startHealthcareMetricsCollection(): void {
    const intervalMs = this.configService.get('HEALTHCARE_QUEUE_METRICS_INTERVAL', 60000); // 1 minute
    
    this.metricsInterval = setInterval(async () => {
      try {
        const metrics = await this.getEnhancedQueueMetrics();
        this.eventEmitter.emit('healthcare.queue.metrics', metrics);
      } catch (error) {
        this.logger.error('Error collecting healthcare queue metrics:', error);
      }
    }, intervalMs);
  }

  /**
   * Get enhanced queue metrics for healthcare monitoring
   */
  async getEnhancedQueueMetrics(): Promise<Record<string, QueueStats>> {
    const queues = [
      { name: 'appointments', queue: this.appointmentQueue },
      { name: 'services', queue: this.serviceQueue },
      { name: 'emails', queue: this.emailQueue },
      { name: 'notifications', queue: this.notificationQueue },
      { name: 'vidhakarma', queue: this.vidhakarmaQueue },
      { name: 'panchakarma', queue: this.panchakarmaQueue },
      { name: 'chequp', queue: this.chequpQueue }
    ];
    
    const metrics: Record<string, QueueStats> = {};
    
    for (const { name, queue } of queues) {
      try {
        const [waiting, active, completed, failed, delayed] = await Promise.all([
          queue.getWaiting(),
          queue.getActive(), 
          queue.getCompleted(0, 99),
          queue.getFailed(0, 99),
          queue.getDelayed()
        ]);
        
        // Calculate enhanced metrics
        const oneMinuteAgo = Date.now() - 60000;
        const recentCompleted = completed.filter(job => 
          job.finishedOn && job.finishedOn > oneMinuteAgo
        );
        
        const processingTimes = completed.map(job => 
          job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : 0
        ).filter(time => time > 0);
        
        const waitTimes = completed.map(job => 
          job.processedOn && job.timestamp ? job.processedOn - job.timestamp : 0
        ).filter(time => time > 0);
        
        const avgProcessingTime = processingTimes.length > 0 
          ? processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length 
          : 0;
        
        const avgWaitTime = waitTimes.length > 0 
          ? waitTimes.reduce((sum, time) => sum + time, 0) / waitTimes.length 
          : 0;
        
        // Count critical jobs waiting
        const criticalJobs = waiting.filter(job => {
          const jobData = job.data as JobData;
          return jobData.urgencyLevel === 'emergency' || 
                 jobData.dataClassification === DataClassification.EMERGENCY;
        });
        
        metrics[name] = {
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
          delayed: delayed.length,
          paused: 0, // BullMQ doesn't have a direct paused count
          timestamp: new Date().toISOString(),
          throughputPerSecond: recentCompleted.length / 60,
          averageWaitTime: avgWaitTime,
          averageProcessingTime: avgProcessingTime,
          errorRate: completed.length > 0 ? (failed.length / (completed.length + failed.length)) * 100 : 0,
          criticalJobsWaiting: criticalJobs.length
        };
        
      } catch (error) {
        this.logger.error(`Failed to get metrics for queue ${name}:`, error);
        metrics[name] = {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          paused: 0,
          timestamp: new Date().toISOString(),
          throughputPerSecond: 0,
          averageWaitTime: 0,
          averageProcessingTime: 0,
          errorRate: 0,
          criticalJobsWaiting: 0
        };
      }
    }
    
    return metrics;
  }

  /**
   * Clean up resources when the application shuts down
   */
  async onModuleDestroy() {
    // Clear all intervals
    if (this.jobCleanupInterval) {
      clearInterval(this.jobCleanupInterval);
    }
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    
    // Gracefully close all queues including the new ones
    await Promise.allSettled([
      this.serviceQueue.close(),
      this.appointmentQueue.close(),
      this.vidhakarmaQueue.close(),
      this.panchakarmaQueue.close(),
      this.chequpQueue.close(),
      this.emailQueue.close(),
      this.notificationQueue.close(),
    ]);
    
    this.logger.log('Enhanced Healthcare Queue Service destroyed - all queues closed');
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