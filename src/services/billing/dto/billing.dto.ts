import { IsString, IsNumber, IsOptional, IsEnum, IsBoolean, IsDateString, IsObject, Min } from 'class-validator';

export enum BillingInterval {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  QUARTERLY = 'QUARTERLY',
  YEARLY = 'YEARLY',
}

export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  CANCELLED = 'CANCELLED',
  INCOMPLETE = 'INCOMPLETE',
  INCOMPLETE_EXPIRED = 'INCOMPLETE_EXPIRED',
  TRIALING = 'TRIALING',
  PAUSED = 'PAUSED',
}

export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  OPEN = 'OPEN',
  PAID = 'PAID',
  VOID = 'VOID',
  UNCOLLECTIBLE = 'UNCOLLECTIBLE',
  OVERDUE = 'OVERDUE',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

export enum PaymentMethod {
  CASH = 'CASH',
  CARD = 'CARD',
  UPI = 'UPI',
  NET_BANKING = 'NET_BANKING',
  WALLET = 'WALLET',
  INSURANCE = 'INSURANCE',
}

// Billing Plan DTOs
export class CreateBillingPlanDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsString()
  currency?: string = 'INR';

  @IsEnum(BillingInterval)
  interval: BillingInterval;

  @IsOptional()
  @IsNumber()
  @Min(1)
  intervalCount?: number = 1;

  @IsOptional()
  @IsNumber()
  @Min(0)
  trialPeriodDays?: number;

  @IsOptional()
  @IsObject()
  features?: Record<string, any>;

  @IsOptional()
  @IsString()
  clinicId?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsNumber()
  @Min(0)
  appointmentsIncluded?: number;

  @IsOptional()
  @IsBoolean()
  isUnlimitedAppointments?: boolean;

  @IsOptional()
  @IsObject()
  appointmentTypes?: Record<string, any>;
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
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsObject()
  features?: Record<string, any>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @IsOptional()
  @IsNumber()
  @Min(0)
  appointmentsIncluded?: number;

  @IsOptional()
  @IsBoolean()
  isUnlimitedAppointments?: boolean;

  @IsOptional()
  @IsObject()
  appointmentTypes?: Record<string, any>;
}

// Subscription DTOs
export class CreateSubscriptionDto {
  @IsString()
  userId: string;

  @IsString()
  planId: string;

  @IsString()
  clinicId: string;

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
  metadata?: Record<string, any>;
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
  metadata?: Record<string, any>;
}

// Payment DTOs
export class CreatePaymentDto {
  @IsNumber()
  @Min(0)
  amount: number;

  @IsString()
  clinicId: string;

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
  metadata?: Record<string, any>;
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
  @Min(0)
  refundAmount?: number;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

// Invoice DTOs
export class CreateInvoiceDto {
  @IsString()
  userId: string;

  @IsString()
  clinicId: string;

  @IsOptional()
  @IsString()
  subscriptionId?: string;

  @IsNumber()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  tax?: number = 0;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number = 0;

  @IsDateString()
  dueDate: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  lineItems?: Record<string, any>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
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
  @IsObject()
  lineItems?: Record<string, any>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
