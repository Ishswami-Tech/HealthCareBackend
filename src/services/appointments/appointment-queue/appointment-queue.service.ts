import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma/prisma.service';
import { LoggingService } from '../../../shared/logging/logging.service';
import { LogType, LogLevel } from '../../../shared/logging/types/logging.types';
import { AppointmentStatus } from '@prisma/client';

@Injectable()
export class AppointmentQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loggingService: LoggingService,
  ) {}

  /**
   * Get current queue for a doctor
   */
  async getDoctorQueue(doctorId: string, date: string) {
    try {
      const appointments = await this.prisma.appointment.findMany({
        where: {
          doctorId,
          date: new Date(date),
          status: AppointmentStatus.CONFIRMED,
        },
        orderBy: [
          { time: 'asc' },
        ],
        include: {
          patient: {
            select: {
              id: true,
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                  phone: true,
                }
              }
            },
          },
        },
      });

      return {
        confirmed: appointments,
      };
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get doctor queue: ${error.message}`,
        'AppointmentQueueService',
        { doctorId, date, error: error.stack }
      );
      throw error;
    }
  }

  /**
   * Get patient's position in queue
   */
  async getPatientQueuePosition(appointmentId: string) {
    try {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: {
          doctor: true,
        },
      });

      if (!appointment) {
        throw new NotFoundException(`Appointment with ID ${appointmentId} not found`);
      }

      const queue = await this.getDoctorQueue(
        appointment.doctorId,
        appointment.date.toISOString(),
      );

      const position = queue.confirmed.findIndex(a => a.id === appointmentId);
      return position >= 0 ? position + 1 : null;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get patient queue position: ${error.message}`,
        'AppointmentQueueService',
        { appointmentId, error: error.stack }
      );
      throw error;
    }
  }

  /**
   * Move appointment to confirmed status
   */
  async confirmAppointment(appointmentId: string) {
    try {
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
      });

      if (!appointment) {
        throw new NotFoundException(`Appointment with ID ${appointmentId} not found`);
      }

      if (appointment.status !== AppointmentStatus.CHECKED_IN) {
        throw new BadRequestException('Appointment must be checked in before confirmation');
      }

      const updatedAppointment = await this.prisma.appointment.update({
        where: { id: appointmentId },
        data: { status: AppointmentStatus.CONFIRMED },
      });

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Appointment ${appointmentId} confirmed`,
        'AppointmentQueueService',
        { appointmentId }
      );

      return updatedAppointment;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to confirm appointment: ${error.message}`,
        'AppointmentQueueService',
        { appointmentId, error: error.stack }
      );
      throw error;
    }
  }

  /**
   * Start consultation (move to IN_PROGRESS)
   */
  async startConsultation(appointmentId: string, doctorId: string) {
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

      if (appointment.status !== AppointmentStatus.CONFIRMED) {
        throw new BadRequestException('Only confirmed appointments can be started');
      }

      const updatedAppointment = await this.prisma.appointment.update({
        where: { id: appointmentId },
        data: { status: AppointmentStatus.IN_PROGRESS },
      });

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        `Consultation started for appointment ${appointmentId}`,
        'AppointmentQueueService',
        { appointmentId, doctorId }
      );

      return updatedAppointment;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to start consultation: ${error.message}`,
        'AppointmentQueueService',
        { appointmentId, doctorId, error: error.stack }
      );
      throw error;
    }
  }
} 