import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma/prisma.service';
import { QrService } from '../../../shared/QR/qr.service';
import { LocationQrService } from '../../../shared/QR/location-qr.service';
import { LoggingService } from '../../../shared/logging/logging.service';
import { LogType, LogLevel } from '../../../shared/logging/types/logging.types';
import { AppointmentStatus } from '@prisma/client';
import { AppointmentQueueService } from '../appointment-queue/appointment-queue.service';

@Injectable()
export class AppointmentConfirmationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly qrService: QrService,
    private readonly locationQrService: LocationQrService,
    private readonly loggingService: LoggingService,
    private readonly queueService: AppointmentQueueService,
  ) {}

  /**
   * Generate QR code for appointment check-in
   */
  async generateCheckInQR(appointmentId: string) {
    try {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
      });

      if (!appointment) {
        throw new NotFoundException(`Appointment with ID ${appointmentId} not found`);
      }

      if (appointment.status !== AppointmentStatus.SCHEDULED) {
        throw new BadRequestException('Appointment is not in SCHEDULED status');
      }

      const qrData = {
        appointmentId,
        type: 'CHECK_IN',
        timestamp: new Date().toISOString(),
      };

      return this.qrService.generateQR(JSON.stringify(qrData));
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to generate check-in QR: ${error.message}`,
        'AppointmentConfirmationService',
        { appointmentId, error: error.stack }
      );
      throw error;
    }
  }

  /**
   * Process check-in when QR is scanned and directly confirm the appointment
   */
  async processCheckIn(qrData: string, appointmentId: string) {
    try {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          location: true,
        },
      });

      if (!appointment) {
        throw new NotFoundException(`Appointment with ID ${appointmentId} not found`);
      }

      if (appointment.status !== AppointmentStatus.SCHEDULED) {
        throw new BadRequestException('Appointment is not in SCHEDULED status');
      }

      // Verify if the QR code is valid for this location
      await this.locationQrService.verifyLocationQR(qrData, appointment.locationId);

      // Check if patient arrived within the allowed time window (15-30 minutes before appointment)
      const appointmentTime = new Date(appointment.date);
      const currentTime = new Date();
      const timeDifference = appointmentTime.getTime() - currentTime.getTime();
      const minutesDifference = timeDifference / (1000 * 60);

      if (minutesDifference < 15 || minutesDifference > 30) {
        throw new BadRequestException('Please arrive 15-30 minutes before your appointment time');
      }

      // Update appointment status directly to CONFIRMED
      const updatedAppointment = await this.prisma.appointment.update({
        where: { id: appointmentId },
        data: { status: AppointmentStatus.CONFIRMED },
      });

      // Get queue position
      const queuePosition = await this.queueService.getPatientQueuePosition(appointmentId);

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Patient checked in and confirmed for appointment ${appointmentId} at location ${appointment.location.name}`,
        'AppointmentConfirmationService',
        { appointmentId, locationId: appointment.locationId }
      );

      return {
        appointment: updatedAppointment,
        queuePosition,
        message: 'Check-in and confirmation successful',
      };
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to process check-in: ${error.message}`,
        'AppointmentConfirmationService',
        { qrData, appointmentId, error: error.stack }
      );
      throw error;
    }
  }

  /**
   * Confirm appointment after check-in
   */
  async confirmAppointment(appointmentId: string) {
    try {
      return await this.queueService.confirmAppointment(appointmentId);
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to confirm appointment: ${error.message}`,
        'AppointmentConfirmationService',
        { appointmentId, error: error.stack }
      );
      throw error;
    }
  }

  /**
   * Mark appointment as completed
   */
  async markAppointmentCompleted(appointmentId: string, doctorId: string) {
    try {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
      });

      if (!appointment) {
        throw new NotFoundException(`Appointment with ID ${appointmentId} not found`);
      }

      if (appointment.doctorId !== doctorId) {
        throw new BadRequestException('This appointment does not belong to this doctor');
      }

      if (appointment.status !== AppointmentStatus.IN_PROGRESS) {
        throw new BadRequestException('Only in-progress appointments can be marked as completed');
      }

      const updatedAppointment = await this.prisma.appointment.update({
        where: { id: appointmentId },
        data: { status: AppointmentStatus.COMPLETED },
      });

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Appointment ${appointmentId} marked as completed by doctor ${doctorId}`,
        'AppointmentConfirmationService',
        { appointmentId, doctorId }
      );

      return {
        appointment: updatedAppointment,
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
      throw error;
    }
  }

  async generateConfirmationQR(appointmentId: string): Promise<string> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        doctor: true,
        patient: true,
        location: true,
      },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    const qrData = {
      appointmentId,
      doctorId: appointment.doctorId,
      patientId: appointment.patientId,
      locationId: appointment.locationId,
      timestamp: new Date().toISOString(),
    };

    return this.qrService.generateQR(JSON.stringify(qrData));
  }

  async verifyAppointmentQR(qrData: string, clinicId: string): Promise<any> {
    try {
      const data = JSON.parse(qrData);
      
      const appointment = await this.prisma.appointment.findFirst({
        where: { 
          id: data.appointmentId,
          clinicId: clinicId
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
          location: true,
        },
      });

      if (!appointment) {
        throw new NotFoundException('Appointment not found');
      }

      // Verify the QR code is not too old (e.g., within 5 minutes)
      const timestamp = new Date(data.timestamp);
      const now = new Date();
      const fiveMinutes = 5 * 60 * 1000;
      if (now.getTime() - timestamp.getTime() > fiveMinutes) {
        throw new BadRequestException('QR code has expired');
      }

      return {
        ...appointment,
        doctor: {
          ...appointment.doctor,
          name: `${appointment.doctor.user.firstName} ${appointment.doctor.user.lastName}`
        },
        patient: {
          ...appointment.patient,
          name: `${appointment.patient.user.firstName} ${appointment.patient.user.lastName}`
        }
      };
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to verify appointment QR: ${error.message}`,
        'AppointmentConfirmationService',
        { error: error.stack }
      );
      throw error;
    }
  }
} 