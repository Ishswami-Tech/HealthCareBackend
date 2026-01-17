/**
 * Input Types - Centralized Prisma input type definitions
 * These types define the structure for creating and updating entities
 * All input types should be defined here, not in database module files
 */

// Date is a built-in JavaScript type, no import needed

/**
 * User creation input
 */
export type UserCreateInput = {
  email: string;
  password: string;
  userid: string;
  name: string;
  age?: number;
  firstName: string;
  lastName: string;
  phone?: string;
  dateOfBirth?: Date;
  gender?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  zipCode?: string;
  profilePicture?: string;
  isActive?: boolean;
  isVerified?: boolean;
  lastLogin?: Date;
  role?: string;
  primaryClinicId?: string;
  googleId?: string;
  facebookId?: string;
  appleId?: string;
};

/**
 * User update input
 */
export type UserUpdateInput = {
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  dateOfBirth?: Date;
  gender?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  profilePicture?: string;
  isActive?: boolean;
  isVerified?: boolean;
  lastLogin?: Date;
  role?: string;
  primaryClinicId?: string;
};

/**
 * User where input (for filtering)
 */
export type UserWhereInput = {
  id?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  isActive?: boolean;
  isVerified?: boolean;
  role?: string;
  primaryClinicId?: string;
};

/**
 * User where unique input
 */
export type UserWhereUniqueInput = {
  id?: string;
  email?: string;
};

/**
 * Appointment creation input
 */
export type AppointmentCreateInput = {
  patientId: string;
  doctorId: string;
  clinicId: string;
  locationId?: string;
  date: Date;
  time: string;
  duration: number;
  status: string;
  priority: string;
  notes?: string;
  reason?: string;
  symptoms?: string;
  diagnosis?: string;
  treatment?: string;
  followUpRequired?: boolean;
  followUpDate?: Date;
  followUpNotes?: string;
  isRecurring?: boolean;
  recurrencePattern?: string;
  recurrenceEndDate?: Date;
  parentAppointmentId?: string;
};

/**
 * Appointment update input
 */
export type AppointmentUpdateInput = {
  date?: Date;
  time?: string;
  duration?: number;
  status?: string;
  priority?: string;
  notes?: string;
  reason?: string;
  symptoms?: string;
  diagnosis?: string;
  treatment?: string;
  followUpRequired?: boolean;
  followUpDate?: Date;
  followUpNotes?: string;
  isRecurring?: boolean;
  recurrencePattern?: string;
  recurrenceEndDate?: Date;
  parentAppointmentId?: string;
};

/**
 * Appointment where input (for filtering)
 */
export type AppointmentWhereInput = {
  id?: string;
  patientId?: string;
  doctorId?: string;
  clinicId?: string;
  locationId?: string;
  date?: Date;
  time?: string;
  status?: string;
  priority?: string;
  isRecurring?: boolean;
  parentAppointmentId?: string;
};

/**
 * Appointment where unique input
 */
export type AppointmentWhereUniqueInput = {
  id?: string;
};

/**
 * Billing plan creation input
 */
export type BillingPlanCreateInput = {
  name: string;
  description?: string;
  amount: number;
  currency?: string;
  interval?: string;
  intervalCount?: number;
  trialPeriodDays?: number;
  features?: Record<string, unknown>;
  isActive?: boolean;
  clinicId?: string;
  metadata?: Record<string, unknown>;
  appointmentsIncluded?: number;
  isUnlimitedAppointments?: boolean;
  appointmentTypes?: Record<string, unknown>;
};

/**
 * Billing plan update input
 */
export type BillingPlanUpdateInput = {
  name?: string;
  description?: string;
  amount?: number;
  currency?: string;
  interval?: string;
  intervalCount?: number;
  trialPeriodDays?: number;
  features?: Record<string, unknown>;
  isActive?: boolean;
  clinicId?: string;
  metadata?: Record<string, unknown>;
  appointmentsIncluded?: number;
  isUnlimitedAppointments?: boolean;
  appointmentTypes?: Record<string, unknown>;
};

/**
 * Billing plan where input
 */
export type BillingPlanWhereInput = {
  id?: string;
  name?: string;
  isActive?: boolean;
  clinicId?: string;
};

/**
 * Subscription creation input
 */
export type SubscriptionCreateInput = {
  userId: string;
  planId: string;
  clinicId: string;
  status?: string;
  startDate?: Date;
  endDate?: Date;
  currentPeriodStart?: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd?: boolean;
  cancelledAt?: Date;
  trialStart?: Date;
  trialEnd?: Date;
  metadata?: Record<string, unknown>;
  appointmentsUsed?: number;
  appointmentsRemaining?: number;
};

/**
 * Subscription update input
 */
export type SubscriptionUpdateInput = {
  userId?: string;
  planId?: string;
  clinicId?: string;
  status?: string;
  startDate?: Date;
  endDate?: Date;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
  cancelledAt?: Date;
  trialStart?: Date;
  trialEnd?: Date;
  metadata?: Record<string, unknown>;
  appointmentsUsed?: number;
  appointmentsRemaining?: number;
};

/**
 * Subscription where input
 */
export type SubscriptionWhereInput = {
  id?: string;
  userId?: string;
  planId?: string;
  clinicId?: string;
  status?: string;
};

/**
 * Invoice creation input
 */
export type InvoiceCreateInput = {
  invoiceNumber: string;
  userId: string;
  subscriptionId?: string;
  clinicId: string;
  amount: number;
  tax?: number;
  discount?: number;
  totalAmount: number;
  status?: string;
  dueDate: Date;
  paidAt?: Date;
  description?: string;
  lineItems?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  pdfFilePath?: string;
  pdfUrl?: string;
  sentViaWhatsApp?: boolean;
};

/**
 * Invoice update input
 */
export type InvoiceUpdateInput = {
  invoiceNumber?: string;
  userId?: string;
  subscriptionId?: string;
  clinicId?: string;
  amount?: number;
  tax?: number;
  discount?: number;
  totalAmount?: number;
  status?: string;
  dueDate?: Date;
  paidAt?: Date;
  description?: string;
  lineItems?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  pdfFilePath?: string;
  pdfUrl?: string;
  sentViaWhatsApp?: boolean;
};

/**
 * Invoice where input
 */
export type InvoiceWhereInput = {
  id?: string;
  invoiceNumber?: string;
  userId?: string;
  subscriptionId?: string;
  clinicId?: string;
  status?: string;
};

/**
 * Payment creation input
 */
export type PaymentCreateInput = {
  appointmentId?: string;
  amount: number;
  status?: string;
  method?: string;
  transactionId?: string;
  clinicId: string;
  userId?: string;
  invoiceId?: string;
  subscriptionId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  refundAmount?: number;
  refundedAt?: Date;
};

/**
 * Payment update input
 */
export type PaymentUpdateInput = {
  appointmentId?: string;
  amount?: number;
  status?: string;
  method?: string;
  transactionId?: string;
  clinicId?: string;
  userId?: string;
  invoiceId?: string;
  subscriptionId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  refundAmount?: number;
  refundedAt?: Date;
};

/**
 * Payment where input
 */
export type PaymentWhereInput = {
  id?: string;
  appointmentId?: string;
  status?: string;
  method?: string;
  transactionId?: string;
  clinicId?: string;
  userId?: string;
  invoiceId?: string;
  subscriptionId?: string;
};
