import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma/prisma.service';
import { QueueService } from '../../../shared/queue/queue.service';
import { SocketService } from '../../../shared/socket/socket.service';
import { AppointmentStatus, Appointment, Doctor, Patient, User, Prisma } from '@prisma/client';
import { JobType, JobPriority, JobData } from '../../../shared/queue/queue.service';
import { LoggingService } from '../../../shared/logging/logging.service';
import { LogLevel, LogType } from '../../../shared/logging/types/logging.types';
import { AppointmentWithRelations } from '../appointment.dto';

const appointmentInclude = {
  doctor: {
    include: {
      user: true
    }
  },
  patient: {
    include: {
      user: true
    }
  }
} as const;

@Injectable()
export class CheckInService {
  private readonly logger = new Logger(CheckInService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly socketService: SocketService,
    private readonly loggingService: LoggingService,
  ) {}

  async checkIn(appointmentId: string): Promise<AppointmentWithRelations> {
    try {
      // First, verify the appointment exists and is in a valid state
      const appointment = await this.prisma.appointment.findUnique({
        where: { id: appointmentId },
        include: appointmentInclude
      });

      if (!appointment) {
        throw new Error('Appointment not found');
      }

      if (appointment.status !== AppointmentStatus.SCHEDULED) {
        throw new Error(`Invalid appointment status for check-in: ${appointment.status}`);
      }

      // Get current time for check-in
      const checkedInAt = new Date();

      // Update appointment status and check-in time
      const updatedAppointment = await this.prisma.appointment.update({
        where: { id: appointmentId },
        data: {
          status: AppointmentStatus.CHECKED_IN,
          checkedInAt,
        },
        include: appointmentInclude
      });

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Patient checked in for appointment ${appointmentId}`,
        'CheckInService',
        { appointmentId, checkedInAt }
      );

      return updatedAppointment as unknown as AppointmentWithRelations;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to check in for appointment ${appointmentId}: ${error.message}`,
        'CheckInService',
        { appointmentId, error: error.stack }
      );
      throw error;
    }
  }

  async getQueuePosition(appointmentId: string): Promise<number> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: appointmentInclude
    });

    if (!appointment) {
      throw new Error('Appointment not found');
    }

    // Get all checked-in appointments for the same doctor and location on the same day
    const queuedAppointments = await this.prisma.appointment.findMany({
      where: {
        doctorId: appointment.doctorId,
        locationId: appointment.locationId,
        date: appointment.date,
        status: AppointmentStatus.CHECKED_IN,
      },
      orderBy: [
        { date: 'asc' },
        { checkedInAt: 'asc' }
      ],
      include: appointmentInclude
    });

    // Find position in queue (1-based index)
    const position = queuedAppointments.findIndex(a => a.id === appointmentId) + 1;
    return position > 0 ? position : 0;
  }

  async getQueueStatus(locationId: string, doctorId?: string): Promise<AppointmentWithRelations[]> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get all checked-in and in-progress appointments for today
    const appointments = await this.prisma.appointment.findMany({
      where: {
        locationId,
        ...(doctorId && { doctorId }),
        date: {
          gte: today,
          lt: new Date(today.getTime() + 24 * 60 * 60 * 1000),
        },
        status: {
          in: [AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_PROGRESS],
        },
      },
      orderBy: [
        { date: 'asc' },
        { checkedInAt: 'asc' }
      ],
      include: appointmentInclude
    });

    return appointments as unknown as AppointmentWithRelations[];
  }

  async processCheckIn(appointmentId: string, clinicId: string): Promise<AppointmentWithRelations> {
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        AND: [
          { clinicId }
        ]
      },
      include: appointmentInclude
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    if (appointment.status !== AppointmentStatus.SCHEDULED) {
      throw new BadRequestException('Appointment is not in SCHEDULED status');
    }

    const now = new Date();

    const updatedAppointment = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: AppointmentStatus.CONFIRMED,
        checkedInAt: now,
      },
      include: appointmentInclude
    });

    // Add to doctor's queue
    const jobData: JobData = {
      id: appointmentId,
      type: JobType.CONFIRM,
      userId: appointment.patientId,
      locationId: appointment.locationId,
      resourceType: 'appointment',
      resourceId: appointmentId,
      date: now,
      metadata: {
        doctorId: appointment.doctorId,
        checkedInAt: now.toISOString(),
        clinicId
      },
    };

    await this.queueService.addJob(
      JobType.CONFIRM,
      jobData,
      {
        priority: this.calculatePriority(appointment.time, now.toLocaleTimeString('en-US', { hour12: false })),
        queueName: `doctor-${appointment.doctorId}`,
      }
    );

    // Notify via WebSocket
    this.socketService.sendToRoom(
      `doctor-${appointment.doctorId}`,
      'checkIn',
      {
        appointment: updatedAppointment
      }
    );

    return updatedAppointment as unknown as AppointmentWithRelations;
  }

  private calculatePriority(scheduledTime: string, checkInTime: string): JobPriority {
    const [scheduledHour, scheduledMinute] = scheduledTime.split(':').map(Number);
    const [checkInHour, checkInMinute] = checkInTime.split(':').map(Number);
    
    const scheduledMinutes = scheduledHour * 60 + scheduledMinute;
    const checkInMinutes = checkInHour * 60 + checkInMinute;
    
    const timeDiff = Math.abs(scheduledMinutes - checkInMinutes);
    
    if (timeDiff <= 5) return JobPriority.HIGH;
    if (timeDiff <= 15) return JobPriority.NORMAL;
    return JobPriority.LOW;
  }

  async getDoctorQueue(doctorId: string, clinicId: string) {
    const queueStats = await this.queueService.getQueueStatsByLocation(doctorId);
    
    const appointments = await this.prisma.appointment.findMany({
      where: {
        doctorId,
        AND: [
          { clinicId }
        ],
        status: AppointmentStatus.CONFIRMED
      },
      include: appointmentInclude,
      orderBy: {
        checkedInAt: 'asc',
      },
    });

    return {
      appointments: appointments as unknown as AppointmentWithRelations[],
      queueStats,
    };
  }

  async getDoctorActiveQueue(doctorId: string, clinicId: string) {
    return this.getDoctorQueue(doctorId, clinicId);
  }

  async getPatientQueuePosition(appointmentId: string, clinicId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        AND: [
          { clinicId }
        ]
      },
      include: {
        doctor: {
          include: {
            user: true
          }
        },
      },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found');
    }

    const position = await this.queueService.getQueuePosition(appointmentId);
    return { position };
  }

  async reorderQueue(clinicId: string, appointmentOrder: string[]) {
    const appointments = await this.prisma.appointment.findMany({
      where: {
        id: { in: appointmentOrder },
        AND: [
          { clinicId }
        ]
      },
    });

    if (appointments.length !== appointmentOrder.length) {
      throw new BadRequestException('Invalid appointment IDs provided');
    }

    // Update queue order
    for (let i = 0; i < appointmentOrder.length; i++) {
      await this.queueService.addJob(
        JobType.UPDATE,
        {
          id: appointmentOrder[i],
          type: JobType.UPDATE,
          resourceType: 'appointment',
          resourceId: appointmentOrder[i],
          metadata: { position: i },
        },
        { priority: JobPriority.HIGH }
      );
    }

    return { success: true };
  }

  async getLocationQueue(clinicId: string) {
    const appointments = await this.prisma.appointment.findMany({
      where: {
        AND: [
          { clinicId },
          { status: AppointmentStatus.CONFIRMED }
        ]
      },
      include: appointmentInclude,
      orderBy: {
        checkedInAt: 'asc',
      },
    }) as unknown as AppointmentWithRelations[];

    // Group appointments by doctor
    const queueByDoctor = appointments.reduce((acc, appointment) => {
      const doctorId = appointment.doctorId;
      if (!acc[doctorId]) {
        acc[doctorId] = {
          doctor: appointment.doctor,
          appointments: [],
        };
      }
      acc[doctorId].appointments.push(appointment);
      return acc;
    }, {});

    return Object.values(queueByDoctor);
  }
} 