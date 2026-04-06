import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { AppointmentAnalyticsService } from '../appointments/plugins/analytics/appointment-analytics.service';
import { BillingService } from '../billing/billing.service';
import { DatabaseService } from '@infrastructure/database';
import type { AnalyticsFilter, AppointmentMetrics } from '@core/types/appointment.types';

export type AnalyticsQueryFilters = Partial<AnalyticsFilter> & {
  period?: string;
};

interface BillingStats {
  totalRevenue: number;
  totalExpenses?: number;
  netProfit?: number;
}

interface PatientAnalyticsClient {
  patient: {
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isAppointmentMetrics(value: unknown): value is AppointmentMetrics {
  return isRecord(value) && typeof value['totalAppointments'] === 'number';
}

function isBillingStats(value: unknown): value is BillingStats {
  return isRecord(value) && typeof value['totalRevenue'] === 'number';
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly appointmentAnalytics: AppointmentAnalyticsService,
    @Inject(forwardRef(() => BillingService))
    private readonly billingService: BillingService,
    private readonly databaseService: DatabaseService
  ) {}

  async getDashboardStats(clinicId: string, period: string = 'month') {
    const range = this.getDateRange(period);

    const [appointmentMetrics, billingStats] = await Promise.all([
      this.appointmentAnalytics.getAppointmentMetrics(clinicId, range),
      this.billingService.getStats(clinicId),
    ]);

    return {
      appointments: appointmentMetrics.data,
      billing: billingStats,
      summary: {
        totalAppointments: isAppointmentMetrics(appointmentMetrics.data)
          ? appointmentMetrics.data.totalAppointments
          : 0,
        revenue: isBillingStats(billingStats) ? billingStats.totalRevenue : 0,
        // Add more summary data as needed by frontend
      },
    };
  }

  async getAppointmentAnalytics(clinicId: string, filters: AnalyticsQueryFilters = {}) {
    const range = this.getDateRange(filters.period ?? 'month');
    return await this.appointmentAnalytics.getAppointmentMetrics(clinicId, range, filters);
  }

  async getRevenueAnalytics(clinicId: string, _filters: AnalyticsQueryFilters = {}) {
    // Currently BillingService.getStats only takes clinicId.
    // In a real app we'd add date range filtering to it.
    return await this.billingService.getStats(clinicId);
  }

  async getPatientAnalytics(clinicId: string, _filters: AnalyticsQueryFilters = {}) {
    // Basic patient stats
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PatientAnalyticsClient;

      const totalPatients = await typedClient.patient.count({
        where: {
          appointments: {
            some: { clinicId },
          },
        },
      });

      const newPatients = await typedClient.patient.count({
        where: {
          createdAt: { gte: this.getDateRange('month').from },
          appointments: {
            some: { clinicId },
          },
        },
      });

      return {
        totalPatients,
        newPatients,
        returningPatients: totalPatients - newPatients,
      };
    });
  }

  async getDoctorPerformance(_clinicId: string, doctorId: string, period: string = 'month') {
    const range = this.getDateRange(period);
    return await this.appointmentAnalytics.getDoctorMetrics(doctorId, range);
  }

  async getClinicPerformance(clinicId: string, period: string = 'month') {
    const range = this.getDateRange(period);
    return await this.appointmentAnalytics.getClinicMetrics(clinicId, range);
  }

  async getServiceUtilization(clinicId: string, filters: AnalyticsQueryFilters = {}) {
    const range = this.getDateRange(filters.period ?? 'month');
    // Call appointment analytics for time slot usage which is a proxy for service utilization
    return await this.appointmentAnalytics.getTimeSlotAnalytics(clinicId, range);
  }

  async getWaitTimeAnalytics(clinicId: string, filters: AnalyticsQueryFilters = {}) {
    const range = this.getDateRange(filters.period ?? 'month');
    return await this.appointmentAnalytics.getWaitTimeAnalytics(clinicId, range);
  }

  async getSatisfactionAnalytics(clinicId: string, filters: AnalyticsQueryFilters = {}) {
    const range = this.getDateRange(filters.period ?? 'month');
    return await this.appointmentAnalytics.getPatientSatisfactionAnalytics(clinicId, range);
  }

  async getQueueAnalytics(clinicId: string, filters: AnalyticsQueryFilters = {}) {
    const range = this.getDateRange(filters.period ?? 'month');
    return await this.appointmentAnalytics.getWaitTimeAnalytics(clinicId, range);
  }

  private getDateRange(period: string): { from: Date; to: Date } {
    const to = new Date();
    const from = new Date();

    switch (period) {
      case 'day':
        from.setHours(0, 0, 0, 0);
        break;
      case 'week':
        from.setDate(to.getDate() - 7);
        break;
      case 'month':
        from.setMonth(to.getMonth() - 1);
        break;
      case 'year':
        from.setFullYear(to.getFullYear() - 1);
        break;
      default:
        from.setMonth(to.getMonth() - 1);
    }

    return { from, to };
  }
}
