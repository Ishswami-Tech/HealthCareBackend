import { Process, Processor } from '@nestjs/bull';
import { Logger, Injectable, OnModuleInit } from '@nestjs/common';
import { Job } from 'bull';
import { JobType, JobData } from '../../../shared/queue/queue.service';
import { PrismaService } from '../../../shared/database/prisma/prisma.service';
import { SocketService } from '../../../shared/socket/socket.service';
import { AppointmentStatus } from '../../../shared/database/prisma/prisma.types';
import { EventEmitter2 } from '@nestjs/event-emitter';

// Extend the JobData interface for appointment-specific data
interface AppointmentJobData extends JobData {
  doctorId?: string;
  retryCount?: number;
  lastError?: string;
  processingTime?: number;
  priority?: number;
}

interface ProcessingMetrics {
  startTime: number;
  attempts: number;
  errors: string[];
}

@Injectable()
@Processor('appointment-queue')
export class AppointmentQueueProcessor implements OnModuleInit {
  // Create a logger instance for this class
  private readonly logger = new Logger(AppointmentQueueProcessor.name);
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAYS = [5000, 15000, 30000]; // 5s, 15s, 30s
  private readonly JOB_TIMEOUT = 30000; // 30 seconds
  private readonly processingJobs = new Map<string, ProcessingMetrics>();
  
  constructor(
    private readonly prisma: PrismaService,
    private readonly socketService: SocketService,
    private readonly eventEmitter: EventEmitter2
  ) {}

  // Implementation of OnModuleInit
  onModuleInit() {
    this.logger.log('Appointment Queue Processor initialized');
    this.setupQueueMonitoring();
  }

  private setupQueueMonitoring() {
    // Monitor active jobs
    setInterval(async () => {
      for (const [jobId, metrics] of this.processingJobs.entries()) {
        const processingTime = Date.now() - metrics.startTime;
        if (processingTime > this.JOB_TIMEOUT) {
          this.logger.warn(`Job ${jobId} is taking longer than expected: ${processingTime}ms`);
          this.eventEmitter.emit('appointment.job.slow', { jobId, processingTime, metrics });
        }
      }
    }, 10000);
  }

  private async handleJobError(job: Job<AppointmentJobData>, error: Error, operation: string) {
    const retryCount = job.data.retryCount || 0;
    const lastError = error.message;
    
    // Update processing metrics
    const metrics = this.processingJobs.get(job.id.toString()) || {
      startTime: Date.now(),
      attempts: 0,
      errors: []
    };
    metrics.attempts++;
    metrics.errors.push(lastError);
    this.processingJobs.set(job.id.toString(), metrics);
    
    if (retryCount < this.MAX_RETRIES) {
      const delay = this.RETRY_DELAYS[retryCount];
      this.logger.warn(
        `Retrying ${operation} for appointment ${job.data.id} after ${delay}ms. Attempt ${retryCount + 1}/${this.MAX_RETRIES}`
      );
      
      await job.progress({
        retryCount: retryCount + 1,
        lastError,
        nextRetry: new Date(Date.now() + delay).toISOString(),
        metrics
      });
      
      this.eventEmitter.emit('appointment.job.retry', {
        jobId: job.id,
        appointmentId: job.data.id,
        operation,
        retryCount: retryCount + 1,
        delay,
        error: lastError
      });
      
      throw error;
    } else {
      this.logger.error(
        `Failed to ${operation} appointment ${job.data.id} after ${this.MAX_RETRIES} attempts. Last error: ${lastError}`,
        error.stack
      );
      
      await this.notifyCriticalError(job.data, error);
      await job.moveToFailed({ message: lastError }, true);
      
      this.eventEmitter.emit('appointment.job.failed', {
        jobId: job.id,
        appointmentId: job.data.id,
        operation,
        attempts: metrics.attempts,
        errors: metrics.errors,
        processingTime: Date.now() - metrics.startTime
      });
      
      return { success: false, error: lastError };
    }
  }

  @Process(JobType.CREATE)
  async processCreateJob(job: Job<AppointmentJobData>) {
    const metrics: ProcessingMetrics = {
      startTime: Date.now(),
      attempts: 0,
      errors: []
    };
    this.processingJobs.set(job.id.toString(), metrics);
    
    try {
      this.logger.log(`Processing create appointment job ${job.id}`);
      const { id, locationId, userId, doctorId } = job.data;
      
      await job.progress(0);
      
      // Update appointment status
      const appointment = await this.prisma.appointment.update({
        where: { id },
        data: { 
          status: AppointmentStatus.SCHEDULED,
        },
        include: {
          User: true,
          doctor: true,
          location: true
        }
      });
      
      // Notify via WebSocket
      await this.notifyAppointmentUpdate(appointment);
      
      const processingTime = Date.now() - metrics.startTime;
      this.logger.log(`Appointment ${id} created and scheduled successfully in ${processingTime}ms`);
      
      await job.progress(100);
      this.processingJobs.delete(job.id.toString());
      
      this.eventEmitter.emit('appointment.created', {
        appointment,
        processingTime,
        metrics
      });
      
      return { 
        success: true, 
        appointmentId: id, 
        status: AppointmentStatus.SCHEDULED,
        processingTime
      };
    } catch (error) {
      return this.handleJobError(job, error, 'create');
    }
  }

  @Process(JobType.CONFIRM)
  async processConfirmJob(job: Job<AppointmentJobData>) {
    const metrics: ProcessingMetrics = {
      startTime: Date.now(),
      attempts: 0,
      errors: []
    };
    this.processingJobs.set(job.id.toString(), metrics);
    
    try {
      this.logger.log(`Processing confirm appointment job ${job.id}`);
      const { id } = job.data;
      
      await job.progress(0);
      
      // Update appointment status
      const appointment = await this.prisma.appointment.update({
        where: { id },
        data: { 
          status: AppointmentStatus.CONFIRMED,
        },
        include: {
          User: true,
          doctor: true,
          location: true
        }
      });
      
      // Notify via WebSocket
      await this.notifyAppointmentUpdate(appointment);
      
      const processingTime = Date.now() - metrics.startTime;
      this.logger.log(`Appointment ${id} confirmed successfully in ${processingTime}ms`);
      
      await job.progress(100);
      this.processingJobs.delete(job.id.toString());
      
      this.eventEmitter.emit('appointment.confirmed', {
        appointment,
        processingTime,
        metrics
      });
      
      return { 
        success: true, 
        appointmentId: id, 
        status: AppointmentStatus.CONFIRMED,
        processingTime
      };
    } catch (error) {
      return this.handleJobError(job, error, 'confirm');
    }
  }

  @Process(JobType.COMPLETE)
  async processCompleteJob(job: Job<AppointmentJobData>) {
    const startTime = Date.now();
    try {
      this.logger.log(`Processing complete appointment job ${job.id}`);
      const { id } = job.data;
      
      // Set job timeout
      await job.progress(0);
      
      // Update appointment status in database
      const appointment = await this.prisma.appointment.update({
        where: { id },
        data: { status: AppointmentStatus.COMPLETED },
        include: {
          User: true,
          doctor: true,
          location: true
        }
      });
      
      // Notify via WebSocket
      await this.notifyAppointmentUpdate(appointment);
      
      const processingTime = Date.now() - startTime;
      this.logger.log(`Appointment ${id} marked as completed in ${processingTime}ms`);
      
      // Update job with processing time
      await job.progress(100);
      
      return { 
        success: true, 
        appointmentId: id, 
        status: AppointmentStatus.COMPLETED,
        processingTime
      };
    } catch (error) {
      return this.handleJobError(job, error, 'complete');
    }
  }

  @Process(JobType.NOTIFY)
  async processNotifyJob(job: Job<AppointmentJobData>) {
    const startTime = Date.now();
    try {
      this.logger.log(`Processing notification job ${job.id}`);
      const { id, userId, metadata } = job.data;
      
      // Set job timeout
      await job.progress(0);
      
      if (!userId) {
        this.logger.warn(`No userId provided for notification job ${job.id}`);
        return { success: false, error: 'No userId provided' };
      }
      
      // Send real-time notification via WebSocket
      await this.socketService.sendToUser(userId, 'appointmentNotification', {
        appointmentId: id,
        title: metadata?.title || 'Appointment Update',
        message: metadata?.message || 'You have an update for your appointment',
        data: { ...job.data }
      });
      
      const processingTime = Date.now() - startTime;
      this.logger.log(`Notification sent for appointment ${id} in ${processingTime}ms`);
      
      // Update job with processing time
      await job.progress(100);
      
      return { 
        success: true, 
        appointmentId: id,
        processingTime
      };
    } catch (error) {
      return this.handleJobError(job, error, 'notify');
    }
  }

  /**
   * Notify all relevant parties about an appointment update
   */
  private async notifyAppointmentUpdate(appointment: any) {
    try {
      const { id, userId, doctorId, locationId, status } = appointment;
      
      const updateData = {
        appointmentId: id,
        status,
        message: `Appointment status updated to ${status}`,
        timestamp: new Date().toISOString(),
        queueInfo: await this.calculateQueuePosition(id, locationId)
      };
      
      // Emit event for external subscribers
      this.eventEmitter.emit('appointment.updated', {
        appointment,
        updateData
      });
      
      // Send notifications via WebSocket
      if (userId) {
        this.socketService.sendToUser(userId, 'appointmentUpdate', updateData);
      }
      
      if (doctorId) {
        this.socketService.sendToResource('doctor', doctorId, 'appointmentUpdate', updateData);
      }
      
      if (locationId) {
        this.socketService.sendToLocation(locationId, 'queueUpdate', {
          appointment: id,
          ...updateData
        });
      }
      
      this.logger.log(`Sent appointment update notifications for appointment ${id}`);
    } catch (error) {
      this.logger.error(`Error sending appointment update notifications: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Notify system administrators about critical errors
   */
  private async notifyCriticalError(data: AppointmentJobData, error: any) {
    try {
      const { id, userId, doctorId, locationId } = data;
      
      const errorData = {
        appointmentId: id,
        error: error.message,
        timestamp: new Date().toISOString(),
        type: 'CRITICAL_ERROR'
      };
      
      // Emit error event
      this.eventEmitter.emit('appointment.error', {
        appointment: data,
        error: errorData
      });
      
      // Send error notifications
      if (userId) {
        this.socketService.sendToUser(userId, 'appointmentError', errorData);
      }
      
      if (doctorId) {
        this.socketService.sendToResource('doctor', doctorId, 'appointmentError', errorData);
      }
      
      if (locationId) {
        this.socketService.sendToLocation(locationId, 'appointmentError', errorData);
      }
      
      this.logger.error(`Sent critical error notifications for appointment ${id}`);
    } catch (notifyError) {
      this.logger.error(`Error sending critical error notifications: ${notifyError.message}`, notifyError.stack);
    }
  }

  private async calculateQueuePosition(appointmentId: string, locationId: string) {
    const appointmentsAhead = await this.prisma.appointment.count({
      where: {
        locationId,
        status: {
          in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED]
        },
        id: {
          not: appointmentId
        }
      }
    });
    
    return {
      position: appointmentsAhead + 1,
      estimatedWaitTime: appointmentsAhead * 15, // 15 minutes per appointment
      updatedAt: new Date().toISOString()
    };
  }
} 