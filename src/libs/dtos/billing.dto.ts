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
} from 'class-validator';
import { IsClinicId } from '@core/decorators/clinic-id.validator';

export class CreateBillingPlanDto {
  name!: string;
  description?: string;
  amount!: number;
  currency?: string = 'INR';
  interval!: BillingInterval;
  intervalCount?: number = 1;
  trialPeriodDays?: number;
  features?: Record<string, unknown>;
  @IsOptional()
  @IsClinicId({ message: 'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001)' })
  clinicId?: string;
  metadata?: Record<string, unknown>;
  appointmentsIncluded?: number;
  isUnlimitedAppointments?: boolean;
  appointmentTypes?: Record<string, unknown>;
}

export class UpdateBillingPlanDto {
  name?: string;
  description?: string;
  amount?: number;
  isActive?: boolean;
  features?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  appointmentsIncluded?: number;
  isUnlimitedAppointments?: boolean;
  appointmentTypes?: Record<string, unknown>;
}

export class CreateSubscriptionDto {
  userId!: string;
  planId!: string;
  @IsNotEmpty({ message: 'Clinic ID is required' })
  @IsClinicId({ message: 'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001)' })
  clinicId!: string;
  startDate?: string;
  endDate?: string;
  trialStart?: string;
  trialEnd?: string;
  metadata?: Record<string, unknown>;
}

export class UpdateSubscriptionDto {
  status?: SubscriptionStatus;
  endDate?: string;
  cancelAtPeriodEnd?: boolean;
  metadata?: Record<string, unknown>;
}

export class CreatePaymentDto {
  amount!: number;
  @IsNotEmpty({ message: 'Clinic ID is required' })
  @IsClinicId({ message: 'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001)' })
  clinicId!: string;
  appointmentId?: string;
  userId?: string;
  invoiceId?: string;
  subscriptionId?: string;
  method?: PaymentMethod;
  transactionId?: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export class UpdatePaymentDto {
  status?: PaymentStatus;
  method?: PaymentMethod;
  transactionId?: string;
  refundAmount?: number;
  metadata?: Record<string, unknown>;
}

export class CreateInvoiceDto {
  userId!: string;
  @IsNotEmpty({ message: 'Clinic ID is required' })
  @IsClinicId({ message: 'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001)' })
  clinicId!: string;
  subscriptionId?: string;
  amount!: number;
  tax?: number = 0;
  discount?: number = 0;
  dueDate!: string;
  description?: string;
  lineItems?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export class UpdateInvoiceDto {
  status?: InvoiceStatus;
  amount?: number;
  tax?: number;
  discount?: number;
  dueDate?: string;
  description?: string;
  lineItems?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
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
  plan!: BillingPlanResponseDto;
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
