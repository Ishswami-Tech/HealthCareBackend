import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma/prisma.service';
import { QrService } from '../../../shared/QR/qr.service';
import { QueueService, JobType } from '../../../shared/queue/queue.service';
import { LoggingService } from '../../../shared/logging/logging.service';
import { LogLevel, LogType } from '../../../shared/logging/types/logging.types';

@Injectable()
export class AppointmentConfirmationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qrService: QrService,
    private readonly queueService: QueueService,
    private readonly loggingService: LoggingService,
  ) {}

  /**
   * Generate QR code for appointment confirmation
   * @param appointmentId - The appointment ID
   */
  async generateConfirmationQR(appointmentId: string): Promise<string> {
    try {
      // Verify appointment exists
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
      });

      if (!appointment) {
        throw new NotFoundException(`Appointment with ID ${appointmentId} not found`);
      }

      // Generate QR code
      const qrCode = await this.qrService.generateAppointmentQR(appointmentId);
      
      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Generated QR code for appointment ${appointmentId}`,
        'AppointmentConfirmationService',
        { appointmentId }
      );
      
      return qrCode;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to generate QR code: ${error.message}`,
        'AppointmentConfirmationService',
        { appointmentId, error: error.stack }
      );
      
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new Error(`Failed to generate QR code: ${error.message}`);
    }
  }

  /**
   * Verify QR code to confirm appointment
   * @param qrData - Data scanned from QR code
   * @param locationId - Location ID where QR is being scanned
   */
  async verifyAppointmentQR(qrData: string, locationId: string): Promise<{ 
    success: boolean; 
    appointmentId: string;
    message: string;
  }> {
    try {
      // Extract appointment ID from QR code
      const appointmentId = this.qrService.verifyAppointmentQR(qrData);
      
      // Verify appointment exists
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
      });

      if (!appointment) {
        throw new NotFoundException(`Appointment with ID ${appointmentId} not found`);
      }

      // Check if appointment is at the correct location
      if (appointment.locationId !== locationId) {
        throw new BadRequestException('Appointment is for a different location');
      }

      // Check if appointment is already confirmed
      if (appointment.status === 'CONFIRMED') {
        this.loggingService.log(
          LogType.APPOINTMENT,
          LogLevel.INFO,
          `Appointment ${appointmentId} is already confirmed`,
          'AppointmentConfirmationService',
          { appointmentId, locationId }
        );
        
        return {
          success: true,
          appointmentId,
          message: 'Appointment is already confirmed',
        };
      }

      // Check if appointment is already completed
      if (appointment.status === 'COMPLETED') {
        throw new BadRequestException('Appointment is already completed');
      }

      // Add confirmation job to queue
      await this.queueService.addJob(
        JobType.CONFIRM,
        {
          id: appointmentId,
          userId: appointment.userId,
          resourceId: appointmentId,
          resourceType: 'appointment',
          locationId,
          date: appointment.date,
        },
      );

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Appointment ${appointmentId} confirmed successfully`,
        'AppointmentConfirmationService',
        { appointmentId, locationId }
      );
      
      return {
        success: true,
        appointmentId,
        message: 'Appointment confirmed successfully',
      };
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to verify QR code: ${error.message}`,
        'AppointmentConfirmationService',
        { locationId, error: error.stack }
      );
      
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new Error(`Failed to verify QR code: ${error.message}`);
    }
  }

  /**
   * Mark appointment as completed by doctor
   * @param appointmentId - The appointment ID
   * @param doctorId - The doctor ID
   */
  async markAppointmentCompleted(appointmentId: string, doctorId: string): Promise<{ 
    success: boolean; 
    message: string;
  }> {
    try {
      // Verify appointment exists and belongs to doctor
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
      });

      if (!appointment) {
        throw new NotFoundException(`Appointment with ID ${appointmentId} not found`);
      }

      if (appointment.doctorId !== doctorId) {
        throw new BadRequestException('This appointment does not belong to this doctor');
      }

      if (appointment.status !== 'CONFIRMED') {
        throw new BadRequestException('Only confirmed appointments can be marked as completed');
      }

      // Add completion job to queue
      await this.queueService.addJob(JobType.COMPLETE, {
        id: appointmentId,
        userId: appointment.userId,
        resourceId: appointmentId,
        resourceType: 'appointment',
        locationId: appointment.locationId,
        date: appointment.date,
        metadata: {
          doctorId: appointment.doctorId
        }
      });

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Appointment ${appointmentId} marked as completed by doctor ${doctorId}`,
        'AppointmentConfirmationService',
        { appointmentId, doctorId }
      );
      
      return {
        success: true,
        message: 'Appointment marked as completed',
      };
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to mark appointment as completed: ${error.message}`,
        'AppointmentConfirmationService',
        { appointmentId, doctorId, error: error.stack }
      );
      
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new Error(`Failed to mark appointment as completed: ${error.message}`);
    }
  }
} 