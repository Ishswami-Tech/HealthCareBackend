import {
  Injectable,
  Inject,
  forwardRef,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { AppointmentAnalyticsService } from '../appointments/plugins/analytics/appointment-analytics.service';
import { BillingService } from '../billing/billing.service';
import { DatabaseService } from '@infrastructure/database';
import type { AnalyticsFilter, AppointmentMetrics } from '@core/types/appointment.types';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { formatDateKeyInIST } from '@utils/date-time.util';
import {
  SalesRangeError,
  resolveSalesRange,
} from '@services/pharmacy/services/pharmacy-sales.util';
import {
  summarizeDoctorEarnings,
  type DoctorEarningsSummary,
  type PaidConsultationRow,
} from './doctor-earnings.util';

/** Most paid consultations one earnings summary reads; a larger window must be narrowed. */
const MAX_EARNINGS_ROWS = 20_000;

interface DoctorEarningsClient {
  doctor: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
  };
  doctorClinic: {
    findFirst: (args: unknown) => Promise<{ doctorId: string } | null>;
  };
  payment: {
    findMany: (args: unknown) => Promise<
      Array<{
        amount: number;
        refundAmount: number | null;
        appointment: { id: string; date: Date } | null;
      }>
    >;
  };
}

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
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService
  ) {}

  async getDashboardStats(clinicId: string, period: string = 'month') {
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      `Fetching dashboard stats for clinic ${clinicId}`,
      'AnalyticsService.getDashboardStats',
      { clinicId, period }
    );
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

  /**
   * The signed-in doctor's own earnings: completed payments of consultations booked with them
   * in this clinic, grouped by appointment day (IST), net of refunds. A caller who is not a
   * doctor of this clinic gets 403; nobody can ask for another doctor's figures.
   */
  async getDoctorOwnEarnings(
    userId: string,
    clinicId: string,
    query: { from?: string; to?: string }
  ): Promise<DoctorEarningsSummary> {
    let range: { from: Date; to: Date };
    try {
      range = resolveSalesRange(query.from, query.to);
    } catch (error) {
      if (error instanceof SalesRangeError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const rows = await this.databaseService.executeHealthcareRead(async client => {
      const db = client as unknown as DoctorEarningsClient;
      const doctor = await db.doctor.findFirst({ where: { userId }, select: { id: true } });
      if (!doctor) {
        throw new ForbiddenException('Only a doctor can read their own earnings');
      }
      const member = await db.doctorClinic.findFirst({
        where: { doctorId: doctor.id, clinicId },
        select: { doctorId: true },
      });
      if (!member) {
        throw new ForbiddenException('You are not a doctor of this clinic');
      }
      return await db.payment.findMany({
        where: {
          clinicId,
          status: 'COMPLETED',
          appointment: {
            is: {
              doctorId: doctor.id,
              clinicId,
              date: { gte: range.from, lt: range.to },
            },
          },
        },
        select: {
          amount: true,
          refundAmount: true,
          appointment: { select: { id: true, date: true } },
        },
        take: MAX_EARNINGS_ROWS + 1,
      });
    });

    if (rows.length > MAX_EARNINGS_ROWS) {
      throw new BadRequestException('Too many payments in this range. Narrow the date range.');
    }

    const paid: PaidConsultationRow[] = rows.flatMap(row =>
      row.appointment
        ? [
            {
              appointmentId: row.appointment.id,
              appointmentDate: row.appointment.date,
              amount: row.amount,
              refundAmount: row.refundAmount,
            },
          ]
        : []
    );
    return summarizeDoctorEarnings(
      {
        from: formatDateKeyInIST(range.from),
        to: formatDateKeyInIST(new Date(range.to.getTime() - 1)),
      },
      paid
    );
  }

  private getDateRange(period: string): { from: Date; to: Date } {
    // Round "now" to a 5-minute bucket instead of using millisecond-precision
    // Date.now(). Callers (e.g. appointment-analytics.service.ts) bake
    // `to.toISOString()` straight into a cache key, so a fresh timestamp on
    // every call meant every analytics cache lookup was a guaranteed miss -
    // this was the dominant contributor to the persistently low cache hit
    // rate. Bucketing to 5 minutes (matching the "short" cache strategy's
    // 300s TTL) lets repeated calls within the same window share a cache
    // key without materially changing what "now" means for a dashboard range.
    const bucketMs = 5 * 60 * 1000;
    const to = new Date(Math.floor(Date.now() / bucketMs) * bucketMs);
    const from = new Date(to);

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
