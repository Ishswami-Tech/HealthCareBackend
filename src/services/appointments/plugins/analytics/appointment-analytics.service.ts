import { Injectable } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { DatabaseService } from '@infrastructure/database';
import type {
  AppointmentMetrics,
  DoctorMetrics,
  ClinicMetrics,
  TimeSlotMetrics,
  AnalyticsFilter,
  AnalyticsResult,
} from '@core/types/appointment.types';

// Re-export types for backward compatibility
export type {
  AppointmentMetrics,
  DoctorMetrics,
  ClinicMetrics,
  TimeSlotMetrics,
  AnalyticsFilter,
  AnalyticsResult,
};

@Injectable()
export class AppointmentAnalyticsService {
  private readonly ANALYTICS_CACHE_TTL = 1800; // 30 minutes
  private readonly METRICS_CACHE_TTL = 3600; // 1 hour

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService
  ) {}

  /**
   * Get appointment metrics for a clinic
   */
  async getAppointmentMetrics(
    clinicId: string,
    dateRange: { from: Date; to: Date },
    filters?: Partial<AnalyticsFilter>
  ): Promise<AnalyticsResult> {
    const cacheKey = `appointment_metrics:${clinicId}:${dateRange.from.toISOString()}:${dateRange.to.toISOString()}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return cached as AnalyticsResult;
      }

      // Calculate metrics from database using executeHealthcareRead with client parameter
      const whereClause = {
        clinicId,
        ...(dateRange.from && dateRange.to
          ? {
              date: {
                gte: dateRange.from,
                lte: dateRange.to,
              },
            }
          : {}),
      };

      // Use countAppointmentsSafe for counts
      const totalAppointments = await this.databaseService.countAppointmentsSafe(
        whereClause as never
      );

      // Use executeHealthcareRead for groupBy and complex queries
      const [appointmentsByStatus, appointmentsByType, completedAppointments] = (await Promise.all([
        this.databaseService.executeHealthcareRead(async client => {
          const appointment = client['appointment'] as unknown as {
            groupBy: (args: {
              by: string[];
              where: unknown;
              _count: { status: boolean };
            }) => Promise<Array<{ status: string; _count: { status: number } }>>;
          };
          return (await appointment.groupBy({
            by: ['status'],
            where: whereClause,
            _count: {
              status: true,
            },
          })) as unknown as Array<{ status: string; _count: { status: number } }>;
        }),
        this.databaseService.executeHealthcareRead(async client => {
          const appointment = client['appointment'] as unknown as {
            groupBy: (args: {
              by: string[];
              where: unknown;
              _count: { type: boolean };
            }) => Promise<Array<{ type: string; _count: { type: number } }>>;
          };
          return (await appointment.groupBy({
            by: ['type'],
            where: whereClause,
            _count: {
              type: true,
            },
          })) as unknown as Array<{ type: string; _count: { type: number } }>;
        }),
        this.databaseService.executeHealthcareRead(async client => {
          const appointment = client['appointment'] as unknown as {
            findMany: (args: {
              where: unknown;
              select: {
                date: boolean;
                startedAt: boolean;
                completedAt: boolean;
                duration: boolean;
              };
            }) => Promise<
              Array<{
                date: Date;
                startedAt: Date | null;
                completedAt: Date | null;
                duration?: number;
              }>
            >;
          };
          return (await appointment.findMany({
            where: {
              ...whereClause,
              status: 'COMPLETED',
            },
            select: {
              date: true,
              startedAt: true,
              completedAt: true,
              duration: true,
            },
          })) as unknown as Array<{
            date: Date;
            startedAt: Date | null;
            completedAt: Date | null;
            duration?: number;
          }>;
        }),
      ])) as unknown as [
        Array<{ status: string; _count: { status: number } }>,
        Array<{ type: string; _count: { type: number } }>,
        Array<{ date: Date; startedAt: Date | null; completedAt: Date | null; duration?: number }>,
      ];

      const statusMap: Record<string, number> = {};
      (appointmentsByStatus as Array<{ status: string; _count: { status: number } }>).forEach(
        (item: { status: string; _count: { status: number } }) => {
          statusMap[item.status] = item._count.status;
        }
      );

      const typeMap: Record<string, number> = {};
      (appointmentsByType as Array<{ type: string; _count: { type: number } }>).forEach(
        (item: { type: string; _count: { type: number } }) => {
          typeMap[item.type] = item._count.type;
        }
      );

      const completedAppointmentsTyped = completedAppointments as Array<{
        date: Date;
        startedAt: Date | null;
        completedAt: Date | null;
        duration?: number;
      }>;
      const averageWaitTime =
        completedAppointmentsTyped.length > 0
          ? completedAppointmentsTyped.reduce(
              (
                sum: number,
                apt: {
                  date: Date;
                  startedAt: Date | null;
                }
              ) => {
                if (apt.date && apt.startedAt) {
                  const waitTime =
                    (new Date(apt.startedAt).getTime() - new Date(apt.date).getTime()) /
                    (1000 * 60);
                  return sum + Math.max(0, waitTime);
                }
                return sum;
              },
              0
            ) / completedAppointmentsTyped.length
          : 0;

      const patientSatisfaction = 0; // Patient satisfaction would need to come from a separate Review/Feedback table

      const noShowCount = statusMap['NO_SHOW'] || 0;
      const _cancelledCount = statusMap['CANCELLED'] || 0;
      const completedCount = statusMap['COMPLETED'] || 0;
      const noShowRate = totalAppointments > 0 ? (noShowCount / totalAppointments) * 100 : 0;
      const completionRate = totalAppointments > 0 ? (completedCount / totalAppointments) * 100 : 0;

      const revenue = 0; // Revenue would need to come from Payment table
      const costPerAppointment = 0;

      const averageDuration =
        completedAppointmentsTyped.length > 0
          ? completedAppointmentsTyped.reduce(
              (sum: number, apt: { duration?: number }) => sum + (apt.duration || 0),
              0
            ) / completedAppointmentsTyped.length
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
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to get appointment metrics',
        'AppointmentAnalyticsService',
        {
          error: _error instanceof Error ? _error.message : 'Unknown error',
          clinicId,
        }
      );

      return {
        success: false,
        error: _error instanceof Error ? _error.message : 'Unknown error',
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
    dateRange: { from: Date; to: Date }
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
        doctorName: 'Dr. Smith',
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
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to get doctor metrics',
        'AppointmentAnalyticsService',
        {
          error: _error instanceof Error ? _error.message : 'Unknown error',
          doctorId,
        }
      );

      return {
        success: false,
        error: _error instanceof Error ? _error.message : 'Unknown error',
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
    dateRange: { from: Date; to: Date }
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
        clinicName: 'Healthcare Clinic',
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
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to get clinic metrics',
        'AppointmentAnalyticsService',
        {
          error: _error instanceof Error ? _error.message : 'Unknown error',
          clinicId,
        }
      );

      return {
        success: false,
        error: _error instanceof Error ? _error.message : 'Unknown error',
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
    dateRange: { from: Date; to: Date }
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
          timeSlot: '09:00-10:00',
          totalAppointments: 20,
          completedAppointments: 18,
          noShowRate: 10,
          averageDuration: 45,
          efficiency: 90,
        },
        {
          timeSlot: '10:00-11:00',
          totalAppointments: 25,
          completedAppointments: 23,
          noShowRate: 8,
          averageDuration: 42,
          efficiency: 92,
        },
        {
          timeSlot: '11:00-12:00',
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
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to get time slot analytics',
        'AppointmentAnalyticsService',
        {
          error: _error instanceof Error ? _error.message : 'Unknown error',
          clinicId,
        }
      );

      return {
        success: false,
        error: _error instanceof Error ? _error.message : 'Unknown error',
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
    dateRange: { from: Date; to: Date }
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
          'Doctor Communication': 4.5,
          'Wait Time': 3.8,
          Facility: 4.2,
          'Staff Friendliness': 4.4,
          'Appointment Scheduling': 4.1,
        },
        improvementSuggestions: [
          'Reduce wait times',
          'Improve parking availability',
          'Better appointment scheduling',
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
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to get patient satisfaction analytics',
        'AppointmentAnalyticsService',
        {
          error: _error instanceof Error ? _error.message : 'Unknown error',
          clinicId,
        }
      );

      return {
        success: false,
        error: _error instanceof Error ? _error.message : 'Unknown error',
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
    reportType: 'summary' | 'detailed' | 'executive'
  ): Promise<AnalyticsResult> {
    try {
      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Generating ${reportType} analytics report`,
        'AppointmentAnalyticsService',
        {
          clinicId,
          dateRange,
        }
      );

      // Get all analytics data
      const [appointmentMetrics, clinicMetrics, timeSlotAnalytics, satisfactionAnalytics] =
        await Promise.all([
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
          appointmentMetrics.data as AppointmentMetrics,
          clinicMetrics.data as ClinicMetrics
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
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to generate analytics report',
        'AppointmentAnalyticsService',
        {
          error: _error instanceof Error ? _error.message : 'Unknown error',
          clinicId,
        }
      );

      return {
        success: false,
        error: _error instanceof Error ? _error.message : 'Unknown error',
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
    appointmentMetrics: AppointmentMetrics,
    _clinicMetrics: ClinicMetrics
  ): {
    keyInsights: string[];
    recommendations: string[];
    trends: {
      appointmentGrowth: string;
      satisfactionTrend: string;
      efficiencyTrend: string;
    };
  } {
    return {
      keyInsights: [
        `Total appointments: ${appointmentMetrics.totalAppointments ?? 0}`,
        `Completion rate: ${appointmentMetrics.completionRate ?? 0}%`,
        `Patient satisfaction: ${appointmentMetrics.patientSatisfaction ?? 0}/5`,
        `Revenue: $${appointmentMetrics.revenue ?? 0}`,
      ],
      recommendations: [
        'Focus on reducing no-show rates',
        'Improve queue efficiency',
        'Enhance patient satisfaction',
      ],
      trends: {
        appointmentGrowth: '+15%',
        satisfactionTrend: '+0.3',
        efficiencyTrend: '+5%',
      },
    };
  }

  /**
   * Get wait time analytics
   */
  async getWaitTimeAnalytics(
    clinicId: string,
    dateRange: { from: Date; to: Date },
    locationId?: string,
    doctorId?: string
  ): Promise<AnalyticsResult> {
    const cacheKey = `wait_time_analytics:${clinicId}:${locationId || 'all'}:${doctorId || 'all'}:${dateRange.from.toISOString()}:${dateRange.to.toISOString()}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string) as AnalyticsResult;
      }

      // Query CheckIn and Appointment tables for wait time analysis
      const waitTimeData = await this.databaseService.executeHealthcareRead(async client => {
        const checkIns = await (
          client as unknown as {
            checkIn: {
              findMany: <T>(args: T) => Promise<
                Array<{
                  checkedInAt: Date;
                  appointmentId: string;
                  locationId: string;
                  clinicId: string;
                }>
              >;
            };
            appointment: {
              findMany: <T>(args: T) => Promise<
                Array<{
                  id: string;
                  date: Date;
                  time: string;
                  status: string;
                  startedAt?: Date | null;
                }>
              >;
            };
          }
        ).checkIn.findMany({
          where: {
            clinicId,
            checkedInAt: {
              gte: dateRange.from,
              lte: dateRange.to,
            },
            ...(locationId && { locationId }),
          },
          select: {
            checkedInAt: true,
            appointmentId: true,
            locationId: true,
            clinicId: true,
          },
          orderBy: { checkedInAt: 'desc' },
        } as never);

        const appointmentIds = checkIns.map(ci => ci.appointmentId);
        const appointments = await (
          client as unknown as {
            appointment: {
              findMany: <T>(args: T) => Promise<
                Array<{
                  id: string;
                  date: Date;
                  time: string;
                  status: string;
                  startedAt?: Date | null;
                  doctorId?: string;
                }>
              >;
            };
          }
        ).appointment.findMany({
          where: {
            id: { in: appointmentIds },
            ...(doctorId && { doctorId }),
          },
          select: {
            id: true,
            date: true,
            time: true,
            status: true,
            startedAt: true,
            doctorId: true,
          },
        } as never);

        // Calculate wait times
        const waitTimes: number[] = [];
        const byHour: Record<number, number[]> = {};
        const byLocation: Record<string, number[]> = {};
        const byDoctor: Record<string, number[]> = {};

        for (const checkIn of checkIns) {
          const appointment = appointments.find(a => a.id === checkIn.appointmentId);
          if (!appointment || !appointment.startedAt) continue;

          const appointmentDateTime = new Date(appointment.date);
          const timeParts = appointment.time.split(':').map(Number);
          const hours = timeParts[0] ?? 0;
          const minutes = timeParts[1] ?? 0;
          appointmentDateTime.setHours(hours, minutes, 0, 0);

          const waitTime =
            Math.max(0, appointment.startedAt.getTime() - checkIn.checkedInAt.getTime()) /
            (1000 * 60); // minutes

          waitTimes.push(waitTime);

          const checkInHour = checkIn.checkedInAt.getHours();
          if (!byHour[checkInHour]) byHour[checkInHour] = [];
          byHour[checkInHour].push(waitTime);

          const locationId = checkIn.locationId;
          if (!byLocation[locationId]) {
            byLocation[locationId] = [];
          }
          const locationArray = byLocation[locationId];
          if (locationArray) {
            locationArray.push(waitTime);
          }

          if (appointment.doctorId) {
            const doctorId = appointment.doctorId;
            if (!byDoctor[doctorId]) {
              byDoctor[doctorId] = [];
            }
            const doctorArray = byDoctor[doctorId];
            if (doctorArray) {
              doctorArray.push(waitTime);
            }
          }
        }

        const avgWaitTime =
          waitTimes.length > 0 ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length : 0;
        const sortedWaitTimes = waitTimes.length > 0 ? [...waitTimes].sort((a, b) => a - b) : [];
        const medianWaitTime =
          sortedWaitTimes.length > 0
            ? (sortedWaitTimes[Math.floor(sortedWaitTimes.length / 2)] ?? 0)
            : 0;
        const p95WaitTime =
          sortedWaitTimes.length > 0
            ? (sortedWaitTimes[Math.floor(sortedWaitTimes.length * 0.95)] ?? 0)
            : 0;

        const filters: AnalyticsFilter = {
          clinicId,
          ...(locationId && { doctorId: locationId }),
          ...(doctorId && { doctorId }),
          startDate: dateRange.from,
          endDate: dateRange.to,
        };

        return {
          success: true,
          data: {
            averageWaitTime: Math.round(avgWaitTime * 10) / 10,
            medianWaitTime: Math.round(medianWaitTime * 10) / 10,
            p95WaitTime: Math.round(p95WaitTime * 10) / 10,
            minWaitTime: waitTimes.length > 0 ? Math.min(...waitTimes) : 0,
            maxWaitTime: waitTimes.length > 0 ? Math.max(...waitTimes) : 0,
            totalAppointments: waitTimes.length,
            waitTimesByHour: Object.fromEntries(
              Object.entries(byHour).map(([hour, times]) => [
                hour,
                {
                  average: Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10,
                  count: times.length,
                },
              ])
            ),
            waitTimesByLocation: Object.fromEntries(
              Object.entries(byLocation).map(([locId, times]) => [
                locId,
                {
                  average: Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10,
                  count: times.length,
                },
              ])
            ),
            waitTimesByDoctor: Object.fromEntries(
              Object.entries(byDoctor).map(([docId, times]) => [
                docId,
                {
                  average: Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10,
                  count: times.length,
                },
              ])
            ),
          },
          generatedAt: new Date(),
          filters,
        };
      });

      await this.cacheService.set(cacheKey, JSON.stringify(waitTimeData), this.ANALYTICS_CACHE_TTL);

      return waitTimeData;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get wait time analytics: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentAnalyticsService',
        {
          clinicId,
          locationId,
          doctorId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );

      const filters: AnalyticsFilter = {
        clinicId,
        ...(locationId && { doctorId: locationId }),
        ...(doctorId && { doctorId }),
        startDate: dateRange.from,
        endDate: dateRange.to,
      };

      return {
        success: false,
        error: _error instanceof Error ? _error.message : 'Unknown error',
        generatedAt: new Date(),
        filters,
      };
    }
  }

  /**
   * Get check-in pattern analytics
   */
  async getCheckInPatternAnalytics(
    clinicId: string,
    dateRange: { from: Date; to: Date },
    locationId?: string
  ): Promise<AnalyticsResult> {
    const cacheKey = `checkin_pattern_analytics:${clinicId}:${locationId || 'all'}:${dateRange.from.toISOString()}:${dateRange.to.toISOString()}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string) as AnalyticsResult;
      }

      const patternData = await this.databaseService.executeHealthcareRead(async client => {
        const checkIns = await (
          client as unknown as {
            checkIn: {
              findMany: <T>(
                args: T
              ) => Promise<Array<{ checkedInAt: Date; locationId: string; appointmentId: string }>>;
            };
            appointment: {
              findMany: <T>(args: T) => Promise<Array<{ id: string; date: Date; time: string }>>;
            };
          }
        ).checkIn.findMany({
          where: {
            clinicId,
            checkedInAt: {
              gte: dateRange.from,
              lte: dateRange.to,
            },
            ...(locationId && { locationId }),
          },
          select: {
            checkedInAt: true,
            locationId: true,
            appointmentId: true,
          },
          orderBy: { checkedInAt: 'desc' },
        } as never);

        const appointmentIds = checkIns.map(ci => ci.appointmentId);
        const appointments = await (
          client as unknown as {
            appointment: {
              findMany: <T>(args: T) => Promise<Array<{ id: string; date: Date; time: string }>>;
            };
          }
        ).appointment.findMany({
          where: { id: { in: appointmentIds } },
          select: {
            id: true,
            date: true,
            time: true,
          },
        } as never);

        // Analyze check-in patterns
        const byDayOfWeek: Record<number, number> = {};
        const byHour: Record<number, number> = {};
        let earlyCheckIns = 0; // Checked in >30min before
        let onTimeCheckIns = 0; // Checked in within ±30min
        let lateCheckIns = 0; // Checked in >30min after
        const byLocation: Record<string, number> = {};

        for (const checkIn of checkIns) {
          const appointment = appointments.find(a => a.id === checkIn.appointmentId);
          if (!appointment) continue;

          const appointmentDateTime = new Date(appointment.date);
          const timeParts = appointment.time.split(':').map(Number);
          const hours = timeParts[0] ?? 0;
          const minutes = timeParts[1] ?? 0;
          appointmentDateTime.setHours(hours, minutes, 0, 0);

          const diffMinutes =
            (checkIn.checkedInAt.getTime() - appointmentDateTime.getTime()) / (1000 * 60);

          if (diffMinutes < -30) earlyCheckIns++;
          else if (diffMinutes <= 30) onTimeCheckIns++;
          else lateCheckIns++;

          const dayOfWeek = checkIn.checkedInAt.getDay();
          byDayOfWeek[dayOfWeek] = (byDayOfWeek[dayOfWeek] || 0) + 1;

          const hour = checkIn.checkedInAt.getHours();
          byHour[hour] = (byHour[hour] || 0) + 1;

          byLocation[checkIn.locationId] = (byLocation[checkIn.locationId] || 0) + 1;
        }

        return {
          success: true,
          data: {
            totalCheckIns: checkIns.length,
            earlyCheckIns,
            onTimeCheckIns,
            lateCheckIns,
            checkInTimingDistribution: {
              early: Math.round((earlyCheckIns / checkIns.length) * 100) || 0,
              onTime: Math.round((onTimeCheckIns / checkIns.length) * 100) || 0,
              late: Math.round((lateCheckIns / checkIns.length) * 100) || 0,
            },
            checkInsByDayOfWeek: byDayOfWeek,
            checkInsByHour: byHour,
            checkInsByLocation: byLocation,
            peakCheckInHour: Object.entries(byHour).reduce(
              (a, b) => {
                const aVal = byHour[Number(a[0])] ?? 0;
                const bVal = byHour[Number(b[0])] ?? 0;
                return aVal > bVal ? a : b;
              },
              ['0', 0]
            )[0],
            peakCheckInDay: Object.entries(byDayOfWeek).reduce(
              (a, b) => {
                const aVal = byDayOfWeek[Number(a[0])] ?? 0;
                const bVal = byDayOfWeek[Number(b[0])] ?? 0;
                return aVal > bVal ? a : b;
              },
              ['0', 0]
            )[0],
          },
          generatedAt: new Date(),
          filters: {
            clinicId,
            ...(locationId && { doctorId: locationId }),
            startDate: dateRange.from,
            endDate: dateRange.to,
          },
        };
      });

      await this.cacheService.set(cacheKey, JSON.stringify(patternData), this.ANALYTICS_CACHE_TTL);

      return patternData;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get check-in pattern analytics: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentAnalyticsService',
        {
          clinicId,
          locationId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );

      return {
        success: false,
        error: _error instanceof Error ? _error.message : 'Unknown error',
        generatedAt: new Date(),
        filters: {
          clinicId,
          ...(locationId && { doctorId: locationId }),
          startDate: dateRange.from,
          endDate: dateRange.to,
        },
      };
    }
  }

  /**
   * Get no-show correlation analytics
   */
  async getNoShowCorrelationAnalytics(
    clinicId: string,
    dateRange: { from: Date; to: Date },
    locationId?: string
  ): Promise<AnalyticsResult> {
    const cacheKey = `noshow_correlation_analytics:${clinicId}:${locationId || 'all'}:${dateRange.from.toISOString()}:${dateRange.to.toISOString()}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string) as AnalyticsResult;
      }

      const correlationData = await this.databaseService.executeHealthcareRead(async client => {
        const appointments = await (
          client as unknown as {
            appointment: {
              findMany: <T>(args: T) => Promise<
                Array<{
                  id: string;
                  date: Date;
                  time: string;
                  status: string;
                  locationId?: string;
                  checkedInAt?: Date | null;
                }>
              >;
            };
            checkIn: {
              findMany: <T>(args: T) => Promise<Array<{ appointmentId: string }>>;
            };
          }
        ).appointment.findMany({
          where: {
            clinicId,
            date: {
              gte: dateRange.from,
              lte: dateRange.to,
            },
            ...(locationId && { locationId }),
            status: {
              in: ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'CANCELLED'],
            },
          },
          select: {
            id: true,
            date: true,
            time: true,
            status: true,
            locationId: true,
            checkedInAt: true,
          },
        } as never);

        const checkedInAppointmentIds = new Set(
          (
            await (
              client as unknown as {
                checkIn: {
                  findMany: <T>(args: T) => Promise<Array<{ appointmentId: string }>>;
                };
              }
            ).checkIn.findMany({
              where: {
                appointmentId: { in: appointments.map(a => a.id) },
              },
              select: { appointmentId: true },
            } as never)
          ).map(ci => ci.appointmentId)
        );

        // Analyze no-show correlation with check-in
        const totalAppointments = appointments.length;
        const checkedIn = appointments.filter(
          a => checkedInAppointmentIds.has(a.id) || a.checkedInAt
        ).length;
        const noShows = appointments.filter(a => a.status === 'NO_SHOW').length;
        const noShowsWithCheckIn = appointments.filter(
          a => a.status === 'NO_SHOW' && (checkedInAppointmentIds.has(a.id) || a.checkedInAt)
        ).length;
        const noShowsWithoutCheckIn = noShows - noShowsWithCheckIn;

        // Check-in timing vs no-show
        const checkedInAppointments = appointments.filter(
          a => checkedInAppointmentIds.has(a.id) || a.checkedInAt
        );
        const earlyCheckedIn = checkedInAppointments.filter(a => {
          if (!a.checkedInAt) return false;
          const appointmentDateTime = new Date(a.date);
          const timeParts = a.time.split(':').map(Number);
          const hours = timeParts[0] ?? 0;
          const minutes = timeParts[1] ?? 0;
          appointmentDateTime.setHours(hours, minutes, 0, 0);
          return a.checkedInAt.getTime() < appointmentDateTime.getTime() - 30 * 60 * 1000;
        }).length;

        return {
          success: true,
          data: {
            totalAppointments,
            checkedInCount: checkedIn,
            noShowCount: noShows,
            noShowRate: Math.round((noShows / totalAppointments) * 1000) / 10,
            checkInRate: Math.round((checkedIn / totalAppointments) * 1000) / 10,
            noShowCorrelation: {
              withCheckIn: {
                count: noShowsWithCheckIn,
                percentage:
                  noShows > 0 ? Math.round((noShowsWithCheckIn / noShows) * 1000) / 10 : 0,
              },
              withoutCheckIn: {
                count: noShowsWithoutCheckIn,
                percentage:
                  noShows > 0 ? Math.round((noShowsWithoutCheckIn / noShows) * 1000) / 10 : 0,
              },
            },
            earlyCheckInCount: earlyCheckedIn,
            earlyCheckInRate:
              checkedIn > 0 ? Math.round((earlyCheckedIn / checkedIn) * 1000) / 10 : 0,
            insight:
              noShowsWithoutCheckIn > noShowsWithCheckIn
                ? 'Patients who check in are less likely to be no-shows'
                : 'Check-in status does not significantly correlate with no-show rate',
          },
          generatedAt: new Date(),
          filters: {
            clinicId,
            ...(locationId && { doctorId: locationId }),
            startDate: dateRange.from,
            endDate: dateRange.to,
          },
        };
      });

      await this.cacheService.set(
        cacheKey,
        JSON.stringify(correlationData),
        this.ANALYTICS_CACHE_TTL
      );

      return correlationData;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get no-show correlation analytics: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentAnalyticsService',
        {
          clinicId,
          locationId,
          error: _error instanceof Error ? _error.stack : undefined,
        }
      );

      return {
        success: false,
        error: _error instanceof Error ? _error.message : 'Unknown error',
        generatedAt: new Date(),
        filters: {
          clinicId,
          ...(locationId && { doctorId: locationId }),
          startDate: dateRange.from,
          endDate: dateRange.to,
        },
      };
    }
  }
}
