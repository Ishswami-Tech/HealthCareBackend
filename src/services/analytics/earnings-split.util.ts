/**
 * Admin view of how paid video consultations split between each doctor and the platform
 * (convenience fee). Completed visits are earnings; a payment on a visit that did not complete
 * (expired, no-show, cancelled...) is listed separately so an admin can refund or settle it.
 * Money is summed in integer paise.
 */
import { formatDateKeyInIST } from '@utils/date-time.util';

export interface SplitPaymentRow {
  paymentId: string;
  appointmentId: string;
  appointmentDate: Date;
  appointmentStatus: string;
  doctorId: string;
  doctorName: string;
  /** What the patient paid, after refunds (already net on the payout). */
  grossAmount: number;
  doctorShareAmount: number;
  platformFeeAmount: number;
}

export interface SplitTotals {
  consultations: number;
  grossAmount: number;
  doctorShareAmount: number;
  convenienceFeeAmount: number;
}

export interface DoctorSplitReport extends SplitTotals {
  doctorId: string;
  doctorName: string;
  daily: Array<SplitTotals & { date: string }>;
}

export interface PaidNotCompletedItem {
  paymentId: string;
  appointmentId: string;
  doctorId: string;
  doctorName: string;
  date: string;
  appointmentStatus: string;
  amount: number;
}

export interface EarningsSplitReport {
  from: string;
  to: string;
  currency: 'INR';
  totals: SplitTotals;
  doctors: DoctorSplitReport[];
  paidNotCompleted: PaidNotCompletedItem[];
}

const toPaise = (rupees: number): number => Math.round(rupees * 100);

interface Accumulator {
  appointments: Set<string>;
  grossPaise: number;
  doctorPaise: number;
  feePaise: number;
}

const emptyAccumulator = (): Accumulator => ({
  appointments: new Set<string>(),
  grossPaise: 0,
  doctorPaise: 0,
  feePaise: 0,
});

function add(acc: Accumulator, row: SplitPaymentRow): void {
  acc.appointments.add(row.appointmentId);
  acc.grossPaise += toPaise(row.grossAmount);
  acc.doctorPaise += toPaise(row.doctorShareAmount);
  acc.feePaise += toPaise(row.platformFeeAmount);
}

function toTotals(acc: Accumulator): SplitTotals {
  return {
    consultations: acc.appointments.size,
    grossAmount: acc.grossPaise / 100,
    doctorShareAmount: acc.doctorPaise / 100,
    convenienceFeeAmount: acc.feePaise / 100,
  };
}

export function buildEarningsSplitReport(
  window: { from: string; to: string },
  rows: readonly SplitPaymentRow[]
): EarningsSplitReport {
  const total = emptyAccumulator();
  const perDoctor = new Map<
    string,
    { name: string; acc: Accumulator; days: Map<string, Accumulator> }
  >();
  const paidNotCompleted: PaidNotCompletedItem[] = [];

  for (const row of rows) {
    if (row.appointmentStatus !== 'COMPLETED') {
      paidNotCompleted.push({
        paymentId: row.paymentId,
        appointmentId: row.appointmentId,
        doctorId: row.doctorId,
        doctorName: row.doctorName,
        date: formatDateKeyInIST(row.appointmentDate),
        appointmentStatus: row.appointmentStatus,
        amount: row.grossAmount,
      });
      continue;
    }
    add(total, row);
    const doctor = perDoctor.get(row.doctorId) ?? {
      name: row.doctorName,
      acc: emptyAccumulator(),
      days: new Map<string, Accumulator>(),
    };
    add(doctor.acc, row);
    const dayKey = formatDateKeyInIST(row.appointmentDate);
    const day = doctor.days.get(dayKey) ?? emptyAccumulator();
    add(day, row);
    doctor.days.set(dayKey, day);
    perDoctor.set(row.doctorId, doctor);
  }

  const doctors: DoctorSplitReport[] = [...perDoctor.entries()]
    .map(([doctorId, doctor]) => ({
      doctorId,
      doctorName: doctor.name,
      ...toTotals(doctor.acc),
      daily: [...doctor.days.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, acc]) => ({ date, ...toTotals(acc) })),
    }))
    .sort((a, b) => a.doctorName.localeCompare(b.doctorName));

  return {
    from: window.from,
    to: window.to,
    currency: 'INR',
    totals: toTotals(total),
    doctors,
    paidNotCompleted: paidNotCompleted.sort((a, b) => a.date.localeCompare(b.date)),
  };
}
