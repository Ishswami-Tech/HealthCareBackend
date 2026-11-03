/**
 * Desk fees due (pure, no Nest imports): the unpaid consultation bills of today's in-person visits
 * at a reception location, e.g. the desk fee of a plan-less walk-in (clinic rule
 * ALLOW_WITH_DESK_FEE). The amounts are the stored invoice totals (raised from clinic settings),
 * never recomputed here. Paying never blocks the consultation: the list only keeps the bill visible
 * at the desk until it is collected.
 */

/** Invoice statuses that can still be collected (PAID and VOID never show). */
export const DESK_FEE_OPEN_STATUSES = ['PENDING'] as const;

/** Bill types collected at the desk for an in-person visit. */
export const DESK_FEE_BILL_TYPES = ['CONSULTATION'] as const;

export interface DeskFeeInvoiceRow {
  id: string;
  invoiceNumber: string;
  appointmentId: string | null;
  patientId: string | null;
  userId: string;
  totalAmount: number | string;
  status: string;
  description?: string | null;
  metadata?: unknown;
  createdAt: Date;
  payments?: Array<{ amount: number | string | null; status: string }>;
}

export interface DeskFeeVisitRef {
  appointmentId: string;
  patientId: string;
  patientUserId: string;
  patientName: string;
  doctorName: string;
  /** HH:mm (IST) of the visit, or "" */
  time: string;
  appointmentStatus: string;
}

export interface DeskFeeDue {
  invoiceId: string;
  invoiceNumber: string;
  appointmentId: string;
  /** Patient.id */
  patientId: string;
  /** User.id of the patient (the desk patient links are keyed by it). */
  patientUserId: string;
  patientName: string;
  doctorName: string;
  time: string;
  appointmentStatus: string;
  description: string | null;
  /** WALK_IN_DESK_FEE for a plan-less walk-in, else the invoice's own purpose (or null). */
  paymentFor: string | null;
  totalAmount: number;
  paidAmount: number;
  balance: number;
  createdAt: string;
}

export interface DeskFeesDue {
  locationId: string | null;
  date: string;
  fees: DeskFeeDue[];
  /** Sum of `balance` over `fees`, in rupees. */
  totalDue: number;
}

function toPaise(value: number | string | null | undefined): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function paymentForOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)['paymentFor'];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Collected so far (COMPLETED payments only), never above the total. */
function paidPaiseOf(invoice: DeskFeeInvoiceRow, totalPaise: number): number {
  const paid = (invoice.payments ?? [])
    .filter(payment => String(payment.status).toUpperCase() === 'COMPLETED')
    .reduce((sum, payment) => sum + toPaise(payment.amount), 0);
  return Math.min(totalPaise, paid);
}

/**
 * Joins open invoices to the day's visits. Invoices of another visit, already settled (no balance)
 * or PAID / VOID are dropped. Oldest first, so the desk collects in arrival order.
 */
export function buildDeskFeesDue(
  invoices: readonly DeskFeeInvoiceRow[],
  visits: readonly DeskFeeVisitRef[],
  meta: { locationId: string | null; date: string }
): DeskFeesDue {
  const visitById = new Map(visits.map(visit => [visit.appointmentId, visit]));
  const open = new Set<string>(DESK_FEE_OPEN_STATUSES);
  const fees: DeskFeeDue[] = [];
  for (const invoice of invoices) {
    if (!open.has(String(invoice.status).toUpperCase())) continue;
    const visit = invoice.appointmentId ? visitById.get(invoice.appointmentId) : undefined;
    if (!visit) continue;
    const totalPaise = toPaise(invoice.totalAmount);
    const paidPaise = paidPaiseOf(invoice, totalPaise);
    const balancePaise = Math.max(0, totalPaise - paidPaise);
    if (balancePaise <= 0) continue;
    fees.push({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      appointmentId: visit.appointmentId,
      patientId: invoice.patientId || visit.patientId,
      patientUserId: visit.patientUserId || invoice.userId,
      patientName: visit.patientName,
      doctorName: visit.doctorName,
      time: visit.time,
      appointmentStatus: visit.appointmentStatus,
      description: invoice.description ?? null,
      paymentFor: paymentForOf(invoice.metadata),
      totalAmount: totalPaise / 100,
      paidAmount: paidPaise / 100,
      balance: balancePaise / 100,
      createdAt: invoice.createdAt.toISOString(),
    });
  }
  fees.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const totalDuePaise = fees.reduce((sum, fee) => sum + Math.round(fee.balance * 100), 0);
  return { locationId: meta.locationId, date: meta.date, fees, totalDue: totalDuePaise / 100 };
}
