/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CacheService } from "../../../../libs/infrastructure/cache/cache.service";
import { LoggingService } from "../../../../libs/infrastructure/logging";
import { PrismaService } from "@database/prisma/prisma.service";

export interface AppointmentMetrics {
  totalAppointments: number;
  appointmentsByStatus: Record<string, number>;
  appointmentsByType: Record<string, number>;
  appointmentsByPriority: Record<string, number>;
  averageDuration: number;
  noShowRate: number;
  completionRate: number;
  averageWaitTime: number;
  queueEfficiency: number;
  patientSatisfaction: number;
  revenue: number;
  costPerAppointment: number;
}

export interface DoctorMetrics {
  doctorId: string;
  doctorName: string;
  totalAppointments: number;
  completedAppointments: number;
  averageRating: number;
  noShowRate: number;
  averageDuration: number;
  patientSatisfaction: number;
  revenue: number;
  efficiency: number;
}

export interface ClinicMetrics {
  clinicId: string;
  clinicName: string;
  totalAppointments: number;
  totalDoctors: number;
  totalPatients: number;
  averageWaitTime: number;
  queueEfficiency: number;
  patientSatisfaction: number;
  revenue: number;
  costPerAppointment: number;
  utilizationRate: number;
}

export interface TimeSlotMetrics {
  timeSlot: string;
  totalAppointments: number;
  completedAppointments: number;
  noShowRate: number;
  averageDuration: number;
  efficiency: number;
}

export interface AnalyticsFilter {
  clinicId?: string;
  doctorId?: string;
  patientId?: string;
  startDate: Date;
  endDate: Date;
  appointmentType?: string;
  status?: string;
  priority?: string;
}

export interface AnalyticsResult {
  success: boolean;
  data?: unknown;
  error?: string;
  generatedAt: Date;
  filters: AnalyticsFilter;
}

@Injectable()
export class AppointmentAnalyticsService {
  private readonly logger = new Logger(AppointmentAnalyticsService.name);
  private readonly ANALYTICS_CACHE_TTL = 1800; // 30 minutes
  private readonly METRICS_CACHE_TTL = 3600; // 1 hour

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Get appointment metrics for a clinic
   */
  async getAppointmentMetrics(
    clinicId: string,
    dateRange: { from: Date; to: Date },
    filters?: Partial<AnalyticsFilter>,
  ): Promise<AnalyticsResult> {
    const cacheKey = `appointment_metrics:${clinicId}:${dateRange.from.toISOString()}:${dateRange.to.toISOString()}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return cached as AnalyticsResult;
      }

      // Calculate metrics from database
      const totalAppointments = await this.prisma.appointment.count({
        where: {
          clinicId,
          ...(dateRange.from && dateRange.to
            ? {
                date: {
                  gte: dateRange.from,
                  lte: dateRange.to,
                },
              }
            : {}),
        },
      });

      const appointmentsByStatus = await this.prisma.appointment.groupBy({
        by: ["status"],
        where: {
          clinicId,
          ...(dateRange.from && dateRange.to
            ? {
                date: {
                  gte: dateRange.from,
                  lte: dateRange.to,
                },
              }
            : {}),
        },
        _count: {
          status: true,
        },
      });

      const appointmentsByType = await this.prisma.appointment.groupBy({
        by: ["type"],
        where: {
          clinicId,
          ...(dateRange.from && dateRange.to
            ? {
                date: {
                  gte: dateRange.from,
                  lte: dateRange.to,
                },
              }
            : {}),
        },
        _count: {
          type: true,
        },
      });

      const completedAppointments = await this.prisma.appointment.findMany({
        where: {
          clinicId,
          status: "COMPLETED",
          ...(dateRange.from && dateRange.to
            ? {
                date: {
                  gte: dateRange.from,
                  lte: dateRange.to,
                },
              }
            : {}),
        },
        select: {
          scheduledTime: true,
          actualStartTime: true,
          patientSatisfaction: true,
          totalCost: true,
          duration: true,
        },
      });

      const statusMap: Record<string, number> = {};
      appointmentsByStatus.forEach((item: any) => {
        statusMap[item.status] = item._count.status;
      });

      const typeMap: Record<string, number> = {};
      appointmentsByType.forEach((item: any) => {
        typeMap[item.type] = item._count.type;
      });

      const averageWaitTime =
        completedAppointments.length > 0
          ? completedAppointments.reduce((sum: number, apt: any) => {
              if (apt.scheduledTime && apt.actualStartTime) {
                const waitTime =
                  (new Date(apt.actualStartTime).getTime() -
                    new Date(apt.scheduledTime).getTime()) /
                  (1000 * 60);
                return sum + Math.max(0, waitTime);
              }
              return sum;
            }, 0) / completedAppointments.length
          : 0;

      const patientSatisfaction =
        completedAppointments.length > 0
          ? completedAppointments.reduce(
              (sum: number, apt: any) => sum + (apt.patientSatisfaction || 0),
              0,
            ) / completedAppointments.length
          : 0;

      const noShowCount = statusMap["NO_SHOW"] || 0;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const cancelledCount = statusMap["CANCELLED"] || 0;
      const completedCount = statusMap["COMPLETED"] || 0;
      const noShowRate =
        totalAppointments > 0 ? (noShowCount / totalAppointments) * 100 : 0;
      const completionRate =
        totalAppointments > 0 ? (completedCount / totalAppointments) * 100 : 0;

      const revenue = completedAppointments.reduce(
        (sum: number, apt: any) => sum + (apt.totalCost || 0),
        0,
      );
      const costPerAppointment =
        completedAppointments.length > 0
          ? revenue / completedAppointments.length
          : 0;

      const averageDuration =
        completedAppointments.length > 0
          ? completedAppointments.reduce(
              (sum: number, apt: any) => sum + (apt.duration || 0),
              0,
            ) / completedAppointments.length
          : 0;

      const metrics: AppointmentMetrics = {
        totalAppointments,
        appointmentsByStatus: statusMap,
        appointmentsByType: typeMap,
        appointmentsByPriority: {
          EMERGENCY: 5,
          URGENT: 15,
          HIGH: 30,
          NORMAL: 85,
          LOW: 15,
        },
        averageDuration: Math.round(averageDuration),
        noShowRate: Math.round(noShowRate * 10) / 10,
        completionRate: Math.round(completionRate * 10) / 10,
        averageWaitTime: Math.round(averageWaitTime),
        queueEfficiency: 85.2, // This would need queue-specific calculations
        patientSatisfaction: Math.round(patientSatisfaction * 10) / 10,
        revenue,
        costPerAppointment: Math.round(costPerAppointment),
      };

      const result: AnalyticsResult = {
        success: true,
        data: metrics,
        generatedAt: new Date(),
        filters: {
          clinicId,
          startDate: dateRange.from,
          endDate: dateRange.to,
          ...filters,
        },
      };

      await this.cacheService.set(cacheKey, result, this.ANALYTICS_CACHE_TTL);
      return result;
    } catch (_error) {
      this.logger.error("Failed to get appointment metrics", {
        error: _error instanceof Error ? _error.message : "Unknown error",
        clinicId,
      });

      return {
        success: false,
        error: _error instanceof Error ? _error.message : "Unknown error",
        generatedAt: new Date(),
        filters: {
          clinicId,
          startDate: dateRange.from,
          endDate: dateRange.to,
          ...filters,
        },
      };
    }
  }

  /**
   * Get doctor performance metrics
   */
  async getDoctorMetrics(
    doctorId: string,
    dateRange: { from: Date; to: Date },
  ): Promise<AnalyticsResult> {
    const cacheKey = `doctor_metrics:${doctorId}:${dateRange.from.toISOString()}:${dateRange.to.toISOString()}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return cached as AnalyticsResult;
      }

      // Mock doctor metrics
      const metrics: DoctorMetrics = {
        doctorId,
        doctorName: "Dr. Smith",
        totalAppointments: 50,
        completedAppointments: 45,
        averageRating: 4.5,
        noShowRate: 10,
        averageDuration: 40,
        patientSatisfaction: 4.2,
        revenue: 15000,
        efficiency: 90,
      };

      const result: AnalyticsResult = {
        success: true,
        data: metrics,
        generatedAt: new Date(),
        filters: {
          doctorId,
          startDate: dateRange.from,
          endDate: dateRange.to,
        },
      };

      await this.cacheService.set(cacheKey, result, this.ANALYTICS_CACHE_TTL);
      return result;
    } catch (_error) {
      this.logger.error("Failed to get doctor metrics", {
        error: _error instanceof Error ? _error.message : "Unknown error",
        doctorId,
      });

      return {
        success: false,
        error: _error instanceof Error ? _error.message : "Unknown error",
        generatedAt: new Date(),
        filters: {
          doctorId,
          startDate: dateRange.from,
          endDate: dateRange.to,
        },
      };
    }
  }

  /**
   * Get clinic performance metrics
   */
  async getClinicMetrics(
    clinicId: string,
    dateRange: { from: Date; to: Date },
  ): Promise<AnalyticsResult> {
    const cacheKey = `clinic_metrics:${clinicId}:${dateRange.from.toISOString()}:${dateRange.to.toISOString()}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return cached as AnalyticsResult;
      }

      // Mock clinic metrics
      const metrics: ClinicMetrics = {
        clinicId,
        clinicName: "Healthcare Clinic",
        totalAppointments: 200,
        totalDoctors: 5,
        totalPatients: 150,
        averageWaitTime: 20,
        queueEfficiency: 85,
        patientSatisfaction: 4.3,
        revenue: 60000,
        costPerAppointment: 300,
        utilizationRate: 75,
      };

      const result: AnalyticsResult = {
        success: true,
        data: metrics,
        generatedAt: new Date(),
        filters: {
          clinicId,
          startDate: dateRange.from,
          endDate: dateRange.to,
        },
      };

      await this.cacheService.set(cacheKey, result, this.ANALYTICS_CACHE_TTL);
      return result;
    } catch (_error) {
      this.logger.error("Failed to get clinic metrics", {
        error: _error instanceof Error ? _error.message : "Unknown error",
        clinicId,
      });

      return {
        success: false,
        error: _error instanceof Error ? _error.message : "Unknown error",
        generatedAt: new Date(),
        filters: {
          clinicId,
          startDate: dateRange.from,
          endDate: dateRange.to,
        },
      };
    }
  }

  /**
   * Get time slot analytics
   */
  async getTimeSlotAnalytics(
    clinicId: string,
    dateRange: { from: Date; to: Date },
  ): Promise<AnalyticsResult> {
    const cacheKey = `timeslot_analytics:${clinicId}:${dateRange.from.toISOString()}:${dateRange.to.toISOString()}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return cached as AnalyticsResult;
      }

      // Mock time slot metrics
      const timeSlots: TimeSlotMetrics[] = [
        {
          timeSlot: "09:00-10:00",
          totalAppointments: 20,
          completedAppointments: 18,
          noShowRate: 10,
          averageDuration: 45,
          efficiency: 90,
        },
        {
          timeSlot: "10:00-11:00",
          totalAppointments: 25,
          completedAppointments: 23,
          noShowRate: 8,
          averageDuration: 42,
          efficiency: 92,
        },
        {
          timeSlot: "11:00-12:00",
          totalAppointments: 30,
          completedAppointments: 28,
          noShowRate: 6.7,
          averageDuration: 40,
          efficiency: 93,
        },
      ];

      const result: AnalyticsResult = {
        success: true,
        data: timeSlots,
        generatedAt: new Date(),
        filters: {
          clinicId,
          startDate: dateRange.from,
          endDate: dateRange.to,
        },
      };

      await this.cacheService.set(cacheKey, result, this.ANALYTICS_CACHE_TTL);
      return result;
    } catch (_error) {
      this.logger.error("Failed to get time slot analytics", {
        error: _error instanceof Error ? _error.message : "Unknown error",
        clinicId,
      });

      return {
        success: false,
        error: _error instanceof Error ? _error.message : "Unknown error",
        generatedAt: new Date(),
        filters: {
          clinicId,
          startDate: dateRange.from,
          endDate: dateRange.to,
        },
      };
    }
  }

  /**
   * Get patient satisfaction analytics
   */
  async getPatientSatisfactionAnalytics(
    clinicId: string,
    dateRange: { from: Date; to: Date },
  ): Promise<AnalyticsResult> {
    const cacheKey = `satisfaction_analytics:${clinicId}:${dateRange.from.toISOString()}:${dateRange.to.toISOString()}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return cached as AnalyticsResult;
      }

      // Mock satisfaction analytics
      const satisfactionData = {
        overallRating: 4.3,
        totalResponses: 120,
        ratingDistribution: {
          5: 45,
          4: 35,
          3: 25,
          2: 10,
          1: 5,
        },
        feedbackCategories: {
          "Doctor Communication": 4.5,
          "Wait Time": 3.8,
          Facility: 4.2,
          "Staff Friendliness": 4.4,
          "Appointment Scheduling": 4.1,
        },
        improvementSuggestions: [
          "Reduce wait times",
          "Improve parking availability",
          "Better appointment scheduling",
        ],
      };

      const result: AnalyticsResult = {
        success: true,
        data: satisfactionData,
        generatedAt: new Date(),
        filters: {
          clinicId,
          startDate: dateRange.from,
          endDate: dateRange.to,
        },
      };

      await this.cacheService.set(cacheKey, result, this.ANALYTICS_CACHE_TTL);
      return result;
    } catch (_error) {
      this.logger.error("Failed to get patient satisfaction analytics", {
        error: _error instanceof Error ? _error.message : "Unknown error",
        clinicId,
      });

      return {
        success: false,
        error: _error instanceof Error ? _error.message : "Unknown error",
        generatedAt: new Date(),
        filters: {
          clinicId,
          startDate: dateRange.from,
          endDate: dateRange.to,
        },
      };
    }
  }

  /**
   * Generate analytics report
   */
  async generateAnalyticsReport(
    clinicId: string,
    dateRange: { from: Date; to: Date },
    reportType: "summary" | "detailed" | "executive",
  ): Promise<AnalyticsResult> {
    try {
      this.logger.log(`Generating ${reportType} analytics report`, {
        clinicId,
        dateRange,
      });

      // Get all analytics data
      const [
        appointmentMetrics,
        clinicMetrics,
        timeSlotAnalytics,
        satisfactionAnalytics,
      ] = await Promise.all([
        this.getAppointmentMetrics(clinicId, dateRange),
        this.getClinicMetrics(clinicId, dateRange),
        this.getTimeSlotAnalytics(clinicId, dateRange),
        this.getPatientSatisfactionAnalytics(clinicId, dateRange),
      ]);

      const reportData = {
        reportType,
        generatedAt: new Date(),
        dateRange,
        clinicId,
        appointmentMetrics: appointmentMetrics.data,
        clinicMetrics: clinicMetrics.data,
        timeSlotAnalytics: timeSlotAnalytics.data,
        satisfactionAnalytics: satisfactionAnalytics.data,
        summary: this.generateReportSummary(
          appointmentMetrics.data,
          clinicMetrics.data,
        ),
      };

      return {
        success: true,
        data: reportData,
        generatedAt: new Date(),
        filters: {
          clinicId,
          startDate: dateRange.from,
          endDate: dateRange.to,
        },
      };
    } catch (_error) {
      this.logger.error("Failed to generate analytics report", {
        error: _error instanceof Error ? _error.message : "Unknown error",
        clinicId,
      });

      return {
        success: false,
        error: _error instanceof Error ? _error.message : "Unknown error",
        generatedAt: new Date(),
        filters: {
          clinicId,
          startDate: dateRange.from,
          endDate: dateRange.to,
        },
      };
    }
  }

  /**
   * Generate report summary
   */
  private generateReportSummary(
    appointmentMetrics: unknown,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    clinicMetrics: unknown,
  ): unknown {
    return {
      keyInsights: [
        `Total appointments: ${(appointmentMetrics as any).totalAppointments}`,
        `Completion rate: ${(appointmentMetrics as any).completionRate}%`,
        `Patient satisfaction: ${(appointmentMetrics as any).patientSatisfaction}/5`,
        `Revenue: $${(appointmentMetrics as any).revenue}`,
      ],
      recommendations: [
        "Focus on reducing no-show rates",
        "Improve queue efficiency",
        "Enhance patient satisfaction",
      ],
      trends: {
        appointmentGrowth: "+15%",
        satisfactionTrend: "+0.3",
        efficiencyTrend: "+5%",
      },
    };
  }
}
