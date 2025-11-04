/**
 * Billing-related types
 * Centralized types for billing operations, invoices, and PDF generation
 */

/**
 * Invoice PDF data for PDF generation
 */
export interface InvoicePDFData {
  invoiceNumber: string;
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
