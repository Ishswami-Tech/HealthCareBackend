import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma/prisma.service';
import { QueueService } from '../../../shared/queue/queue.service';
import { SocketService } from '../../../shared/socket/socket.service';
import { AppointmentStatus, Appointment, Doctor, Patient, User, Prisma } from '@prisma/client';
import { JobType, JobPriority, JobData } from '../../../shared/queue/queue.service';

type AppointmentWithRelations = Appointment & {
  doctor: Doctor & {
    user: User;
  };
  patient: Patient & {
    user: User;
  };
};

@Injectable()
export class CheckInService {
  private readonly logger = new Logger(CheckInService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly socketService: SocketService,
  ) {}

  async processCheckIn(appointmentId: string, clinicId: string): Promise<AppointmentWithRelations> {
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

    if (appointment.status !== AppointmentStatus.SCHEDULED) {
      throw new BadRequestException('Appointment is not in SCHEDULED status');
    }

    const now = new Date();
    const checkInTime = now.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit' 
    });

    const updatedAppointment = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: AppointmentStatus.CONFIRMED,
        checkInTime,
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
        checkInTime,
        clinicId
      },
    };

    await this.queueService.addJob(
      JobType.CONFIRM,
      jobData,
      {
        priority: this.calculatePriority(appointment.time, checkInTime),
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

    return updatedAppointment;
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
      orderBy: {
        checkInTime: 'asc',
      },
    });

    return {
      appointments,
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
      orderBy: {
        checkInTime: 'asc',
      },
    });

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