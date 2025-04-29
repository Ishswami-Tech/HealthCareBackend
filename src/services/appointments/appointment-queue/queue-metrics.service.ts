import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma/prisma.service';
import { LoggingService } from '../../../shared/logging/logging.service';
import { LogType, LogLevel } from '../../../shared/logging/types/logging.types';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppointmentStatus } from '@prisma/client';

interface QueueMetrics {
  averageWaitTime: number;
  maxWaitTime: number;
  minWaitTime: number;
  totalPatients: number;
  completedAppointments: number;
  noShows: number;
  cancellations: number;
  timestamp: Date;
}

interface DoctorMetrics {
  doctorId: string;
  averageConsultationTime: number;
  patientsPerHour: number;
  utilization: number;
}

@Injectable()
export class QueueMetricsService implements OnModuleInit {
  private metricsInterval: NodeJS.Timeout;
  private readonly METRICS_INTERVAL = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly loggingService: LoggingService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit() {
    this.startMetricsCollection();
  }

  private startMetricsCollection() {
    this.metricsInterval = setInterval(async () => {
      try {
        await this.collectQueueMetrics();
      } catch (error) {
        this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          `Failed to collect queue metrics: ${error.message}`,
          'QueueMetricsService',
          { error: error.stack }
        );
      }
    }, this.METRICS_INTERVAL);
  }

  private async collectQueueMetrics() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const appointments = await this.prisma.appointment.findMany({
      where: {
        date: {
          gte: today
        },
        status: {
          in: [
            AppointmentStatus.COMPLETED,
            AppointmentStatus.NO_SHOW,
            AppointmentStatus.CANCELLED
          ]
        }
      },
      select: {
        id: true,
        status: true,
        date: true,
        time: true,
        duration: true,
        startedAt: true,
        checkedInAt: true,
        completedAt: true,
        doctorId: true,
        doctor: {
          select: {
            id: true,
            userId: true,
            specialization: true,
            experience: true,
            qualification: true,
            consultationFee: true,
            rating: true,
            isAvailable: true,
            workingHours: true,
            createdAt: true
          }
        }
      }
    });

    const metrics: QueueMetrics = {
      averageWaitTime: 0,
      maxWaitTime: 0,
      minWaitTime: Number.MAX_VALUE,
      totalPatients: appointments.length,
      completedAppointments: appointments.filter(a => a.status === AppointmentStatus.COMPLETED).length,
      noShows: appointments.filter(a => a.status === AppointmentStatus.NO_SHOW).length,
      cancellations: appointments.filter(a => a.status === AppointmentStatus.CANCELLED).length,
      timestamp: new Date()
    };

    // Calculate wait times
    const waitTimes = appointments
      .filter(a => a.status === AppointmentStatus.COMPLETED && a.startedAt && a.checkedInAt)
      .map(a => a.startedAt.getTime() - a.checkedInAt.getTime());

    if (waitTimes.length > 0) {
      metrics.averageWaitTime = waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length;
      metrics.maxWaitTime = Math.max(...waitTimes);
      metrics.minWaitTime = Math.min(...waitTimes);
    }

    // Calculate doctor-specific metrics
    const doctorMetrics = new Map<string, DoctorMetrics>();
    const doctorAppointments = new Map<string, typeof appointments>();

    // Group appointments by doctor
    appointments.forEach(appointment => {
      if (!doctorAppointments.has(appointment.doctorId)) {
        doctorAppointments.set(appointment.doctorId, []);
      }
      doctorAppointments.get(appointment.doctorId).push(appointment);
    });

    // Calculate metrics for each doctor
    for (const [doctorId, apps] of doctorAppointments) {
      const completedApps = apps.filter(a => a.status === AppointmentStatus.COMPLETED);
      const consultationTimes = completedApps
        .filter(a => a.startedAt && a.completedAt)
        .map(a => a.completedAt.getTime() - a.startedAt.getTime());

      const avgConsultationTime = consultationTimes.length > 0
        ? consultationTimes.reduce((a, b) => a + b, 0) / consultationTimes.length
        : 0;

      const workingHours = 8; // Assume 8-hour workday
      const patientsPerHour = completedApps.length / workingHours;
      const utilization = (avgConsultationTime * completedApps.length) / (workingHours * 3600000); // Convert to hours

      doctorMetrics.set(doctorId, {
        doctorId,
        averageConsultationTime: avgConsultationTime,
        patientsPerHour,
        utilization
      });
    }

    // Emit metrics events
    this.eventEmitter.emit('queue.metrics.updated', {
      metrics,
      doctorMetrics: Array.from(doctorMetrics.values())
    });

    // Log metrics
    this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Queue metrics collected',
      'QueueMetricsService',
      { metrics, doctorMetrics: Array.from(doctorMetrics.values()) }
    );

    return {
      metrics,
      doctorMetrics: Array.from(doctorMetrics.values())
    };
  }

  async getQueueEfficiency(locationId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const appointments = await this.prisma.appointment.findMany({
      where: {
        locationId,
        date: {
          gte: today
        },
        status: {
          in: [AppointmentStatus.COMPLETED, AppointmentStatus.NO_SHOW]
        }
      },
      select: {
        id: true,
        status: true,
        date: true,
        startedAt: true,
        completedAt: true
      }
    });

    const completed = appointments.filter(a => a.status === AppointmentStatus.COMPLETED).length;
    const total = appointments.length;

    return total > 0 ? (completed / total) * 100 : 100;
  }

  async getDoctorUtilization(doctorId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const appointments = await this.prisma.appointment.findMany({
      where: {
        doctorId,
        date: {
          gte: today
        },
        status: AppointmentStatus.COMPLETED
      },
      select: {
        id: true,
        date: true,
        startedAt: true,
        completedAt: true
      }
    });

    const totalConsultationTime = appointments
      .filter(a => a.startedAt && a.completedAt)
      .reduce((total, app) => total + (app.completedAt.getTime() - app.startedAt.getTime()), 0);

    const workingHours = 8 * 3600000; // 8 hours in milliseconds
    return (totalConsultationTime / workingHours) * 100;
  }

  onModuleDestroy() {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
  }
} 