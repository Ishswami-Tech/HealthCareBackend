/**
 * Pure aggregation of a doctor's own earnings: paid consultations grouped by appointment day
 * (IST). Money is summed in integer paise; a refund reduces the amount that counts.
 */
import { formatDateKeyInIST } from '@utils/date-time.util';

export interface PaidConsultationRow {
  appointmentId: string;
  appointmentDate: Date;
  amount: number;
  refundAmount: number | null;
}

export interface DoctorEarningsDay {
  date: string;
  consultations: number;
  total: number;
}

export interface DoctorEarningsSummary {
  from: string;
  to: string;
  currency: 'INR';
  consultations: number;
  total: number;
  daily: DoctorEarningsDay[];
}

const toPaise = (rupees: number): number => Math.round(rupees * 100);

/** What a payment counts for after refunds, in paise (never below zero). */
function netPaise(row: PaidConsultationRow): number {
  return Math.max(0, toPaise(row.amount) - toPaise(row.refundAmount ?? 0));
}

export function summarizeDoctorEarnings(
  window: { from: string; to: string },
  rows: readonly PaidConsultationRow[]
): DoctorEarningsSummary {
  const days = new Map<string, { appointments: Set<string>; paise: number }>();
  for (const row of rows) {
    const key = formatDateKeyInIST(row.appointmentDate);
    const day = days.get(key) ?? { appointments: new Set<string>(), paise: 0 };
    day.appointments.add(row.appointmentId);
    day.paise += netPaise(row);
    days.set(key, day);
  }

  const daily = [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, day]) => ({
      date,
      consultations: day.appointments.size,
      total: day.paise / 100,
    }));

  return {
    from: window.from,
    to: window.to,
    currency: 'INR',
    consultations: new Set(rows.map(row => row.appointmentId)).size,
    total: daily.reduce((sum, day) => sum + toPaise(day.total), 0) / 100,
    daily,
  };
}
