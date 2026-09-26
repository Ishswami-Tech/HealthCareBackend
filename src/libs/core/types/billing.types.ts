/**
 * Billing-related types
 * Centralized types for billing operations, invoices, and PDF generation
 */

/**
 * Invoice PDF data for PDF generation
 */
export interface InvoicePDFData {
  invoiceNumber: string;
  gatewayOrderId?: string;
  invoiceDate: Date;
  dueDate: Date;
  status: string;

  // Clinic details
  clinicName: string;
  clinicAddress?: string;
  clinicPhone?: string;
  clinicEmail?: string;
  clinicLogo?: string;

  // Patient/User details
  userName: string;
  userEmail?: string;
  userPhone?: string;
  userAddress?: string;

  // Subscription details (if applicable)
  subscriptionPlan?: string;
  subscriptionPeriod?: string;

  // Line items
  lineItems: Array<{
    description: string;
    quantity?: number;
    unitPrice?: number;
    amount: number;
  }>;

  // Totals
  subtotal: number;
  tax: number;
  discount: number;
  total: number;

  // Payment details
  paidAt?: Date;
  paymentMethod?: string;
  transactionId?: string;

  // Additional notes
  notes?: string;
  termsAndConditions?: string;
}

/**
 * Payment data for processing payments
 */
export interface PaymentData {
  amount: number;
  currency: string;
  paymentMethod: string;
  customerId: string;
  appointmentId: string;
  description?: string;
}

/**
 * Refund data for processing refunds
 */
export interface RefundData {
  paymentId: string;
  amount: number;
  reason: string;
  customerId: string;
}

/**
 * Subscription data for subscription management
 */
export interface SubscriptionData {
  customerId: string;
  planId: string;
  amount: number;
  interval: 'monthly' | 'yearly';
}

/**
 * Payout data for provider payouts
 */
export interface PayoutData {
  providerId: string;
  amount: number;
  currency: string;
  description: string;
}

/**
 * Kind of bill an Invoice represents. Mirrors the Prisma `BillType` enum
 * (`schema.prisma`) as a domain-level string union rather than importing the
 * generated Prisma enum directly (this project keeps `@database/types` and
 * `@types` decoupled). Values MUST stay in sync with the Prisma enum.
 */
export const BILL_TYPES = [
  'CONSULTATION',
  'PHARMACY',
  'APPOINTMENT',
  'SUBSCRIPTION',
  'IPD',
  'OTHER',
] as const;

export type BillType = (typeof BILL_TYPES)[number];

/**
 * Full invoice record shape including the bill-history columns
 * (`billType`, `patientId`, `visitId`, `prescriptionId`, `appointmentId`)
 * that are not yet reflected in the generic `InvoiceBase`/`InvoiceWithRelations`
 * types under `@core/types/database.types`. Used by BillingService methods
 * that query the `Invoice` model directly via the typed-client-cast pattern.
 */
export interface InvoiceRecordPayment {
  id: string;
  amount: number;
  method: string | null;
  status: string;
  transactionId: string | null;
  createdAt: Date;
}

export interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  userId: string;
  clinicId: string;
  subscriptionId?: string | null;
  amount: number;
  tax: number | null;
  discount: number | null;
  totalAmount: number;
  status: string;
  dueDate: Date;
  paidAt: Date | null;
  description: string | null;
  lineItems: unknown;
  metadata: unknown;
  pdfFilePath?: string | null;
  pdfUrl: string | null;
  sentViaWhatsApp?: boolean;
  billType: BillType;
  patientId: string | null;
  visitId: string | null;
  prescriptionId: string | null;
  appointmentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  payments?: InvoiceRecordPayment[];
}

/**
 * One row in the per-patient "Bill History" tab. Can originate either from
 * an `Invoice` (billType-aware, downloadable) or from a legacy orphan
 * `Payment` row that predates the Invoice bill-history columns (no
 * invoiceId, e.g. old prescription cash payments) — not downloadable.
 */
export type PatientBillStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'VOID' | 'REFUNDED';

export interface PatientBillPaymentSummary {
  id: string;
  amount: number;
  method: string | null;
  status: string;
  transactionId: string | null;
  createdAt: string;
}

export interface PatientBillRow {
  id: string;
  source: 'INVOICE' | 'PAYMENT';
  billType: BillType;
  invoiceNumber: string | null;
  date: string;
  description: string | null;
  visitId?: string | null;
  opdNumber?: string | null;
  prescriptionId?: string | null;
  appointmentId?: string | null;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paidAmount: number;
  balance: number;
  status: PatientBillStatus;
  payments: PatientBillPaymentSummary[];
  downloadable: boolean;
}

export interface PatientBillHistorySummary {
  totalBilled: number;
  totalPaid: number;
  outstanding: number;
}

export interface PatientBillHistory {
  rows: PatientBillRow[];
  total: number;
  summary: PatientBillHistorySummary;
}

export interface PatientBillHistoryFilters {
  type?: string;
  status?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}
