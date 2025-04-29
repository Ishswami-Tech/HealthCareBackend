import { Injectable, NotFoundException, BadRequestException, Inject } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma/prisma.service';
import { LoggingService } from '../../../shared/logging/logging.service';
import { LogType, LogLevel } from '../../../shared/logging/types/logging.types';
import { AppointmentStatus } from '@prisma/client';
import { LocationQueueStats, QueuePosition } from '../../../libs/types/queue.types';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SocketService } from '../../../shared/socket/socket.service';

interface QueueConfig {
  defaultWaitTime: number;
  maxQueueSize: number;
  checkInWindow: {
    before: number;
    after: number;
  };
  autoConfirmation: boolean;
}

@Injectable()
export class AppointmentQueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly loggingService: LoggingService,
    private readonly eventEmitter: EventEmitter2,
    private readonly socketService: SocketService,
    @Inject('QUEUE_CONFIG') private readonly queueConfig: QueueConfig,
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
          status: {
            in: [
              AppointmentStatus.SCHEDULED,
              AppointmentStatus.CONFIRMED,
              AppointmentStatus.IN_PROGRESS
            ]
          }
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

      const queueStats = {
        confirmed: appointments.filter(a => a.status === AppointmentStatus.CONFIRMED),
        waiting: appointments.filter(a => a.status === AppointmentStatus.SCHEDULED),
        inProgress: appointments.filter(a => a.status === AppointmentStatus.IN_PROGRESS),
      };

      this.eventEmitter.emit('queue.doctor.updated', {
        doctorId,
        stats: queueStats,
      });

      return queueStats;
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
  async getPatientQueuePosition(appointmentId: string): Promise<QueuePosition> {
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

      const position = queue.waiting.findIndex(a => a.id === appointmentId) + 1;
      const totalAhead = position > 0 ? position - 1 : queue.waiting.length;
      const estimatedWaitTime = totalAhead * this.queueConfig.defaultWaitTime;

      const queuePosition: QueuePosition = {
        position: position > 0 ? position : queue.waiting.length + 1,
        estimatedWaitTime,
        totalAhead,
      };

      this.eventEmitter.emit('queue.position.updated', {
        appointmentId,
        position: queuePosition,
      });

      return queuePosition;
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
   * Get queue statistics for a location
   */
  async getLocationQueueStats(locationId: string): Promise<LocationQueueStats> {
    try {
      const appointments = await this.prisma.appointment.findMany({
        where: {
          locationId,
          status: {
            in: [
              AppointmentStatus.SCHEDULED,
              AppointmentStatus.CONFIRMED,
              AppointmentStatus.IN_PROGRESS
            ]
          }
        },
        include: {
          doctor: true
        }
      });

      const stats: LocationQueueStats = {
        locationId,
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        avgWaitTime: 0,
        estimatedWaitTime: 0,
        doctorStats: {}
      };

      const doctorAppointments = new Map<string, AppointmentStatus[]>();

      for (const appointment of appointments) {
        if (appointment.status === AppointmentStatus.SCHEDULED || 
            appointment.status === AppointmentStatus.CONFIRMED) {
          stats.waiting++;
        } else if (appointment.status === AppointmentStatus.IN_PROGRESS) {
          stats.active++;
        }

        if (!doctorAppointments.has(appointment.doctorId)) {
          doctorAppointments.set(appointment.doctorId, []);
        }
        doctorAppointments.get(appointment.doctorId).push(appointment.status);
      }

      const completedAppointments = await this.prisma.appointment.count({
        where: {
          locationId,
          status: AppointmentStatus.COMPLETED
        }
      });

      stats.completed = completedAppointments;
      stats.avgWaitTime = this.queueConfig.defaultWaitTime * 60 * 1000; // Convert minutes to milliseconds
      stats.estimatedWaitTime = stats.waiting * this.queueConfig.defaultWaitTime;

      for (const [doctorId, appointments] of doctorAppointments) {
        stats.doctorStats[doctorId] = {
          waiting: appointments.filter(status => 
            status === AppointmentStatus.SCHEDULED || 
            status === AppointmentStatus.CONFIRMED
          ).length,
          active: appointments.filter(status => 
            status === AppointmentStatus.IN_PROGRESS
          ).length,
          avgWaitTime: stats.avgWaitTime
        };
      }

      this.eventEmitter.emit('queue.location.updated', {
        locationId,
        stats,
      });

      return stats;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get location queue stats: ${error.message}`,
        'AppointmentQueueService',
        { locationId, error: error.stack }
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
        include: {
          location: true,
          doctor: true,
        },
      });

      if (!appointment) {
        throw new NotFoundException(`Appointment with ID ${appointmentId} not found`);
      }

      if (appointment.status !== AppointmentStatus.SCHEDULED) {
        throw new BadRequestException('Appointment must be in SCHEDULED status before confirmation');
      }

      // Check if queue size is within limits
      const currentQueue = await this.getDoctorQueue(
        appointment.doctorId,
        appointment.date.toISOString(),
      );

      if (currentQueue.confirmed.length >= this.queueConfig.maxQueueSize) {
        throw new BadRequestException('Queue is full. Please try again later.');
      }

      const updatedAppointment = await this.prisma.appointment.update({
        where: { id: appointmentId },
        data: { status: AppointmentStatus.CONFIRMED },
        include: {
          doctor: true,
          patient: true,
          location: true,
        },
      });

      // Emit events
      this.eventEmitter.emit('appointment.confirmed', {
        appointment: updatedAppointment,
      });

      // Send WebSocket notifications
      await this.socketService.sendToUser(
        updatedAppointment.patient.userId,
        'appointmentConfirmed',
        {
          appointmentId,
          message: 'Your appointment has been confirmed',
          queuePosition: await this.getPatientQueuePosition(appointmentId),
        }
      );

      await this.socketService.sendToResource(
        'doctor',
        updatedAppointment.doctorId,
        'queueUpdated',
        await this.getDoctorQueue(updatedAppointment.doctorId, updatedAppointment.date.toISOString())
      );

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