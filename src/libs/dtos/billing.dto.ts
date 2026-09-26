import {
  BillingInterval,
  SubscriptionStatus,
  InvoiceStatus,
  PaymentStatus,
  PaymentMethod,
} from '@core/types/enums.types';
import {
  IsOptional,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
  IsDateString,
  IsEnum,
  IsUUID,
  IsBoolean,
  IsObject,
  IsIn,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsClinicId } from '@core/decorators/clinic-id.validator';
import { AppointmentPriority, AppointmentType, TreatmentType } from '@dtos/appointment.dto';
import { PaymentProvider } from '@core/types';
import { BILL_TYPES, type BillType } from '@core/types/billing.types';

export class CreateBillingPlanDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  currency?: string = 'INR';

  @IsEnum(BillingInterval)
  interval!: BillingInterval;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  intervalCount?: number = 1;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  trialPeriodDays?: number;

  @IsOptional()
  @IsObject()
  features?: Record<string, unknown>;

  @IsOptional()
  @IsClinicId({ message: 'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001)' })
  clinicId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  appointmentsIncluded?: number;

  @IsOptional()
  @IsBoolean()
  isUnlimitedAppointments?: boolean;

  @IsOptional()
  @IsObject()
  appointmentTypes?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateBillingPlanDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsObject()
  features?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  appointmentsIncluded?: number;

  @IsOptional()
  @IsBoolean()
  isUnlimitedAppointments?: boolean;

  @IsOptional()
  @IsObject()
  appointmentTypes?: Record<string, unknown>;
}

export class CreateSubscriptionDto {
  @IsUUID('4', { message: 'User ID must be a valid UUID' })
  userId!: string;

  @IsUUID('4', { message: 'Plan ID must be a valid UUID' })
  planId!: string;

  @IsNotEmpty({ message: 'Clinic ID is required' })
  @IsClinicId({ message: 'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001)' })
  clinicId!: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsDateString()
  trialStart?: string;

  @IsOptional()
  @IsDateString()
  trialEnd?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateSubscriptionDto {
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsBoolean()
  cancelAtPeriodEnd?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreatePaymentDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsNotEmpty({ message: 'Clinic ID is required' })
  @IsClinicId({ message: 'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001)' })
  clinicId!: string;

  @IsOptional()
  @IsString()
  appointmentId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  invoiceId?: string;

  @IsOptional()
  @IsString()
  subscriptionId?: string;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @IsString()
  transactionId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsEnum(PaymentProvider)
  provider?: PaymentProvider;
}

export class UpdatePaymentDto {
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  @IsOptional()
  @IsString()
  transactionId?: string;

  @IsOptional()
  @IsNumber()
  refundAmount?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CreateInvoiceDto {
  @IsNotEmpty({ message: 'User ID is required' })
  @IsString()
  userId!: string;

  @IsNotEmpty({ message: 'Clinic ID is required' })
  @IsClinicId({ message: 'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001)' })
  clinicId!: string;

  @IsOptional()
  @IsString()
  subscriptionId?: string;

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tax?: number = 0;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number = 0;

  @IsNotEmpty({ message: 'Due date is required' })
  @IsDateString()
  dueDate!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  lineItems?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  /**
   * Bill-history columns (see `Invoice.billType/patientId/visitId/prescriptionId/appointmentId`
   * in schema.prisma). All optional so the pre-existing `POST /billing/invoices`
   * route keeps working for callers that only pass the original fields.
   */
  @IsOptional()
  @IsIn(BILL_TYPES)
  billType?: BillType;

  @IsOptional()
  @IsString()
  patientId?: string;

  @IsOptional()
  @IsString()
  visitId?: string;

  @IsOptional()
  @IsString()
  prescriptionId?: string;

  @IsOptional()
  @IsString()
  appointmentId?: string;

  /**
   * Allows internal callers (e.g. `ensureVisitConsultationInvoice` waiving a
   * fee) to create an invoice that is already settled, instead of always
   * starting PENDING. Left optional/undecorated-by-default behaviour intact
   * for the public route: omit both to get the original PENDING invoice.
   */
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @IsDateString()
  paidAt?: string;
}

export class UpdateInvoiceDto {
  @IsOptional()
  @IsEnum(InvoiceStatus)
  status?: InvoiceStatus;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tax?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  lineItems?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CollectInvoicePaymentDto {
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @IsOptional()
  @IsString()
  transactionId?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateConsultationInvoiceDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @IsOptional()
  @IsBoolean()
  waive?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => CollectInvoicePaymentDto)
  collect?: CollectInvoicePaymentDto;
}

export class RecordInvoicePaymentDto {
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @IsOptional()
  @IsString()
  transactionId?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateClinicExpenseDto {
  @IsNotEmpty({ message: 'Clinic ID is required' })
  @IsClinicId()
  clinicId!: string;

  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsNotEmpty()
  @IsString()
  category!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class CreateInsuranceClaimDto {
  @IsNotEmpty()
  @IsString()
  patientId!: string;

  @IsOptional()
  @IsString()
  appointmentId?: string;

  @IsOptional()
  @IsString()
  invoiceId?: string;

  @IsNotEmpty()
  @IsClinicId()
  clinicId!: string;

  @IsNotEmpty()
  @IsString()
  claimNumber!: string;

  @IsNotEmpty()
  @IsString()
  provider!: string;

  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateInsuranceClaimDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsDateString()
  responseAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateInPersonSubscriptionAppointmentDto {
  @IsNotEmpty({ message: 'Patient ID is required' })
  @IsUUID('4', { message: 'Patient ID must be a valid UUID' })
  patientId!: string;

  @IsNotEmpty({ message: 'Doctor ID is required' })
  @IsUUID('4', { message: 'Doctor ID must be a valid UUID' })
  doctorId!: string;

  @IsNotEmpty({ message: 'Clinic ID is required' })
  @IsClinicId({ message: 'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001)' })
  clinicId!: string;

  @IsNotEmpty({ message: 'Location ID is required for in-person appointments' })
  @IsUUID('4', { message: 'Location ID must be a valid UUID' })
  locationId!: string;

  @IsNotEmpty({ message: 'Appointment date is required' })
  @IsDateString({}, { message: 'Appointment date must be a valid date-time string' })
  appointmentDate!: string;

  @IsNotEmpty({ message: 'Duration is required' })
  @IsNumber({}, { message: 'Duration must be a number' })
  @IsPositive({ message: 'Duration must be positive' })
  duration!: number;

  @IsOptional()
  @IsEnum(TreatmentType, { message: 'Treatment type must be valid' })
  treatmentType?: TreatmentType;

  @IsOptional()
  @IsEnum(AppointmentPriority, { message: 'Priority must be valid' })
  priority?: AppointmentPriority;

  @IsOptional()
  @IsString({ message: 'Notes must be a string' })
  notes?: string;

  @IsOptional()
  @IsEnum(AppointmentType, { message: 'Type must be a valid appointment type' })
  type?: AppointmentType;
}

export class BillingPlanResponseDto {
  id!: string;
  name!: string;
  description?: string;
  amount!: number;
  currency!: string;
  interval!: BillingInterval;
  intervalCount!: number;
  trialPeriodDays?: number;
  features?: Record<string, unknown>;
  clinicId?: string;
  metadata?: Record<string, unknown>;
  appointmentsIncluded?: number;
  isUnlimitedAppointments?: boolean;
  appointmentTypes?: Record<string, unknown>;
  isActive!: boolean;
  createdAt!: Date;
  updatedAt!: Date;
}

export class SubscriptionResponseDto {
  id!: string;
  userId!: string;
  planId!: string;
  clinicId!: string;
  status!: SubscriptionStatus;
  startDate!: Date;
  endDate?: Date;
  currentPeriodStart!: Date;
  currentPeriodEnd!: Date;
  trialStart?: Date;
  trialEnd?: Date;
  appointmentsUsed!: number;
  appointmentsRemaining?: number;
  cancelAtPeriodEnd!: boolean;
  cancelledAt?: Date;
  metadata?: Record<string, unknown>;
  createdAt!: Date;
  updatedAt!: Date;
  @IsOptional()
  plan?: BillingPlanResponseDto;
}

export class PaymentResponseDto {
  id!: string;
  amount!: number;
  clinicId!: string;
  appointmentId?: string;
  userId?: string;
  invoiceId?: string;
  subscriptionId?: string;
  method?: PaymentMethod;
  transactionId?: string;
  description?: string;
  status!: PaymentStatus;
  refundAmount?: number;
  refundedAt?: Date;
  metadata?: Record<string, unknown>;
  createdAt!: Date;
  updatedAt!: Date;
  patientName?: string;
  orderId?: string;
}

export class InvoiceResponseDto {
  id!: string;
  invoiceNumber!: string;
  userId!: string;
  subscriptionId?: string;
  clinicId!: string;
  amount!: number;
  tax!: number;
  discount!: number;
  totalAmount!: number;
  status!: InvoiceStatus;
  dueDate!: Date;
  paidAt?: Date;
  description?: string;
  lineItems?: Record<string, unknown>;
  pdfFilePath?: string;
  pdfUrl?: string;
  sentViaWhatsApp!: boolean;
  whatsappSentAt?: Date;
  metadata?: Record<string, unknown>;
  createdAt!: Date;
  updatedAt!: Date;
}

export class BillingPlanQueryDto {
  @IsOptional()
  @IsClinicId({ message: 'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001)' })
  clinicId?: string;
  isActive?: boolean;
  search?: string;
}

export class SubscriptionQueryDto {
  userId?: string;
  @IsOptional()
  @IsClinicId({ message: 'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001)' })
  clinicId?: string;
  status?: SubscriptionStatus;
}

export class PaymentQueryDto {
  userId?: string;
  @IsOptional()
  @IsClinicId({ message: 'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001)' })
  clinicId?: string;
  status?: PaymentStatus;
  startDate?: string;
  endDate?: string;
}

export class InvoiceQueryDto {
  userId?: string;
  @IsOptional()
  @IsClinicId({ message: 'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001)' })
  clinicId?: string;
  status?: InvoiceStatus;
  startDate?: string;
  endDate?: string;
}

export class RevenueAnalyticsDto {
  totalRevenue!: number;
  paymentCount!: number;
  averagePayment!: number;
  payments!: PaymentResponseDto[];
}

export class SubscriptionMetricsDto {
  total!: number;
  active!: number;
  trialing!: number;
  cancelled!: number;
  pastDue!: number;
  monthlyRecurringRevenue!: number;
  churnRate!: number;
}

export class SubscriptionUsageStatsDto {
  subscriptionId!: string;
  planName!: string;
  appointmentsIncluded?: number;
  isUnlimited!: boolean;
  appointmentsUsed!: number;
  appointmentsRemaining?: number;
  actualAppointmentCount!: number;
  periodStart!: Date;
  periodEnd!: Date;
  status!: SubscriptionStatus;
}

export class AppointmentCoverageDto {
  covered!: boolean;
  requiresPayment!: boolean;
  paymentAmount?: number;
  quotaAvailable?: boolean;
  remaining?: number;
  total?: number;
  isUnlimited?: boolean;
  message?: string;
}

export class CanBookAppointmentDto {
  allowed!: boolean;
  requiresPayment?: boolean;
  paymentAmount?: number;
  reason?: string;
}
