import { Process, Processor } from '@nestjs/bull';
import { Logger, Injectable, OnModuleInit } from '@nestjs/common';
import { Job } from 'bull';
import { JobType, JobData } from '../../../shared/queue/queue.service';
import { PrismaService } from '../../../shared/database/prisma/prisma.service';
import { SocketService } from '../../../shared/socket/socket.service';
import { AppointmentStatus } from '../../../shared/database/prisma/prisma.types';

// Extend the JobData interface for appointment-specific data
interface AppointmentJobData extends JobData {
  doctorId?: string;
  retryCount?: number;
  lastError?: string;
  processingTime?: number;
}

@Injectable()
@Processor('appointment-queue')
export class AppointmentQueueProcessor implements OnModuleInit {
  // Create a logger instance for this class
  private readonly logger = new Logger(AppointmentQueueProcessor.name);
  private readonly MAX_RETRIES = 3;
  private readonly RETRY_DELAYS = [5000, 15000, 30000]; // 5s, 15s, 30s
  private readonly JOB_TIMEOUT = 30000; // 30 seconds
  
  constructor(
    private readonly prisma: PrismaService,
    private readonly socketService: SocketService
  ) {}

  // Implementation of OnModuleInit
  onModuleInit() {
    this.logger.log('Appointment Queue Processor initialized');
  }

  private async handleJobError(job: Job<AppointmentJobData>, error: Error, operation: string) {
    const retryCount = job.data.retryCount || 0;
    const lastError = error.message;
    
    if (retryCount < this.MAX_RETRIES) {
      const delay = this.RETRY_DELAYS[retryCount];
      this.logger.warn(
        `Retrying ${operation} for appointment ${job.data.id} after ${delay}ms. Attempt ${retryCount + 1}/${this.MAX_RETRIES}`
      );
      
      // Update job data with retry information
      await job.progress({
        retryCount: retryCount + 1,
        lastError,
        nextRetry: new Date(Date.now() + delay).toISOString()
      });
      
      // Throw error to trigger retry
      throw error;
    } else {
      this.logger.error(
        `Failed to ${operation} appointment ${job.data.id} after ${this.MAX_RETRIES} attempts. Last error: ${lastError}`,
        error.stack
      );
      
      // Notify about permanent failure
      await this.notifyCriticalError(job.data, error);
      
      // Mark job as failed
      await job.moveToFailed({ message: lastError }, true);
      return { success: false, error: lastError };
    }
  }

  @Process(JobType.CREATE)
  async processCreateJob(job: Job<AppointmentJobData>) {
    const startTime = Date.now();
    try {
      this.logger.log(`Processing create appointment job ${job.id}`);
      const { id, locationId, userId, doctorId } = job.data;
      
      // Set job timeout
      await job.progress(0);
      
      // Update appointment status in the database
      await this.prisma.appointment.update({
        where: { id },
        data: { status: AppointmentStatus.SCHEDULED },
      });
      
      // Notify via WebSocket
      await this.notifyAppointmentUpdate(job.data, AppointmentStatus.SCHEDULED);
      
      const processingTime = Date.now() - startTime;
      this.logger.log(`Appointment ${id} created and scheduled successfully in ${processingTime}ms`);
      
      // Update job with processing time
      await job.progress(100);
      
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
    const startTime = Date.now();
    try {
      this.logger.log(`Processing confirm appointment job ${job.id}`);
      const { id } = job.data;
      
      // Set job timeout
      await job.progress(0);
      
      // Update appointment status in database
      await this.prisma.appointment.update({
        where: { id },
        data: { status: AppointmentStatus.CONFIRMED },
      });
      
      // Notify via WebSocket
      await this.notifyAppointmentUpdate(job.data, AppointmentStatus.CONFIRMED);
      
      const processingTime = Date.now() - startTime;
      this.logger.log(`Appointment ${id} confirmed successfully in ${processingTime}ms`);
      
      // Update job with processing time
      await job.progress(100);
      
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
      await this.prisma.appointment.update({
        where: { id },
        data: { status: AppointmentStatus.COMPLETED },
      });
      
      // Notify via WebSocket
      await this.notifyAppointmentUpdate(job.data, AppointmentStatus.COMPLETED);
      
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
  private async notifyAppointmentUpdate(data: AppointmentJobData, status: AppointmentStatus) {
    try {
      const { id, userId, doctorId, locationId } = data;
      
      const updateData = {
        appointmentId: id,
        status,
        message: `Appointment status updated to ${status}`,
        timestamp: new Date().toISOString()
      };
      
      // Send to user
      if (userId) {
        await this.socketService.sendToUser(userId, 'appointmentUpdate', updateData);
      }
      
      // Send to doctor
      if (doctorId) {
        await this.socketService.sendToResource('doctor', doctorId, 'appointmentUpdate', updateData);
      }
      
      // Send to location staff
      if (locationId) {
        await this.socketService.sendToLocation(locationId, 'appointmentUpdate', updateData);
      }
    } catch (error) {
      this.logger.error(`Failed to send WebSocket notification: ${error.message}`, error.stack);
      throw error; // Propagate error to trigger retry
    }
  }

  /**
   * Notify system administrators about critical errors
   */
  private async notifyCriticalError(data: AppointmentJobData, error: any) {
    try {
      const { id, locationId } = data;
      
      // Only notify for locationId if it exists
      if (locationId) {
        await this.socketService.sendToLocation(locationId, 'systemAlert', {
          type: 'error',
          source: 'appointment-processor',
          message: `Failed to process appointment ${id}: ${error.message}`,
          timestamp: new Date().toISOString(),
          error: {
            message: error.message,
            stack: error.stack,
            code: error.code
          }
        });
      }
      
      // Log to monitoring system
      this.logger.error(`Critical error in appointment processing: ${error.message}`, {
        appointmentId: id,
        locationId,
        error: {
          message: error.message,
          stack: error.stack,
          code: error.code
        }
      });
    } catch (err) {
      this.logger.error(`Failed to send error notification: ${err.message}`, err.stack);
    }
  }
} 