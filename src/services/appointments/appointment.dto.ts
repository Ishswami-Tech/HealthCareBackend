import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID, IsEnum, IsNumber, IsDateString, IsBoolean, IsArray, IsObject, IsEmail, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

// Enhanced Enums for Enterprise Features
export enum AppointmentType {
  // Healthcare Appointment Types
  GENERAL_CONSULTATION = 'GENERAL_CONSULTATION',
  FOLLOW_UP = 'FOLLOW_UP',
  EMERGENCY = 'EMERGENCY',
  THERAPY = 'THERAPY',
  SURGERY = 'SURGERY',
  LAB_TEST = 'LAB_TEST',
  IMAGING = 'IMAGING',
  VACCINATION = 'VACCINATION',
  PHYSICAL_EXAM = 'PHYSICAL_EXAM',
  MENTAL_HEALTH = 'MENTAL_HEALTH',
  DENTAL = 'DENTAL',
  EYE_EXAM = 'EYE_EXAM',
  PHYSIOTHERAPY = 'PHYSIOTHERAPY',
  NUTRITION = 'NUTRITION',
  
  // Ayurveda & Alternative Medicine
  AYURVEDA = 'AYURVEDA',
  PANCHAKARMA = 'PANCHAKARMA',
  SHIRODHARA = 'SHIRODHARA',
  VIRECHANA = 'VIRECHANA',
  BASTI = 'BASTI',
  NASYA = 'NASYA',
  RAKTAMOKSHANA = 'RAKTAMOKSHANA',
  AGNIKARMA = 'AGNIKARMA',
  VIDDHAKARMA = 'VIDDHAKARMA',
  NADI_PARIKSHA = 'NADI_PARIKSHA',
  DOSHA_ANALYSIS = 'DOSHA_ANALYSIS',
  
  // Consultation Types
  IN_PERSON = 'IN_PERSON',
  VIDEO_CALL = 'VIDEO_CALL',
  HOME_VISIT = 'HOME_VISIT',
  TELEMEDICINE = 'TELEMEDICINE'
}

export enum AppointmentStatus {
  // Core Statuses
  PENDING = 'PENDING',
  SCHEDULED = 'SCHEDULED',
  CONFIRMED = 'CONFIRMED',
  CHECKED_IN = 'CHECKED_IN',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
  RESCHEDULED = 'RESCHEDULED',
  
  // Enhanced Statuses
  WAITING = 'WAITING',
  ON_HOLD = 'ON_HOLD',
  TRANSFERRED = 'TRANSFERRED',
  DISCHARGED = 'DISCHARGED',
  FOLLOW_UP_SCHEDULED = 'FOLLOW_UP_SCHEDULED'
}

export enum AppointmentPriority {
  EMERGENCY = 'EMERGENCY',
  URGENT = 'URGENT',
  HIGH = 'HIGH',
  NORMAL = 'NORMAL',
  LOW = 'LOW',
  ROUTINE = 'ROUTINE'
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
  PARTIAL = 'PARTIAL',
  INSURANCE_PENDING = 'INSURANCE_PENDING'
}

export enum PaymentMethod {
  CASH = 'CASH',
  CARD = 'CARD',
  UPI = 'UPI',
  NET_BANKING = 'NET_BANKING',
  WALLET = 'WALLET',
  CHEQUE = 'CHEQUE',
  INSURANCE = 'INSURANCE',
  DIGITAL_PAYMENT = 'DIGITAL_PAYMENT'
}

export enum VideoCallStatus {
  NOT_SCHEDULED = 'NOT_SCHEDULED',
  SCHEDULED = 'SCHEDULED',
  STARTED = 'STARTED',
  ENDED = 'ENDED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  WAITING_ROOM = 'WAITING_ROOM'
}

export enum QueueStatus {
  WAITING = 'WAITING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
  ON_HOLD = 'ON_HOLD',
  TRANSFERRED = 'TRANSFERRED'
}

export enum NotificationType {
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  PUSH_NOTIFICATION = 'PUSH_NOTIFICATION',
  WHATSAPP = 'WHATSAPP',
  IN_APP = 'IN_APP',
  VOICE_CALL = 'VOICE_CALL'
}

export enum Language {
  EN = 'en',
  HI = 'hi',
  MR = 'mr',
  TA = 'ta',
  TE = 'te',
  KN = 'kn',
  ML = 'ml',
  BN = 'bn',
  GU = 'gu',
  PA = 'pa',
  OR = 'or',
  AS = 'as'
}

// Enhanced DTOs for Enterprise Features
export class CreateAppointmentDto {
  @ApiProperty({ description: 'Patient ID', example: 'patient-uuid' })
  @IsUUID()
  patientId!: string;

  @ApiProperty({ description: 'Doctor ID', example: 'doctor-uuid' })
  @IsUUID()
  doctorId!: string;

  @ApiProperty({ description: 'Location ID', example: 'location-uuid' })
  @IsUUID()
  locationId!: string;

  @ApiProperty({ description: 'Clinic ID', example: 'clinic-uuid' })
  @IsUUID()
  clinicId!: string;

  @ApiProperty({ description: 'Appointment date (YYYY-MM-DD)', example: '2024-06-01' })
  @IsDateString()
  @Transform(({ value }) => value?.trim())
  date!: string;

  @ApiProperty({ description: 'Appointment time (HH:mm)', example: '10:00' })
  @IsString()
  @Transform(({ value }) => value?.trim())
  time!: string;

  @ApiProperty({ description: 'Duration in minutes', example: 30 })
  @IsNumber()
  duration!: number;

  @ApiProperty({ description: 'Appointment type', enum: AppointmentType, example: 'GENERAL_CONSULTATION' })
  @IsEnum(AppointmentType)
  type!: AppointmentType;

  @ApiProperty({ description: 'Appointment priority', enum: AppointmentPriority, example: 'NORMAL' })
  @IsEnum(AppointmentPriority)
  @IsOptional()
  priority?: AppointmentPriority;

  @ApiProperty({ description: 'Payment status', enum: PaymentStatus, example: 'PENDING' })
  @IsEnum(PaymentStatus)
  @IsOptional()
  paymentStatus?: PaymentStatus;

  @ApiProperty({ description: 'Payment method', enum: PaymentMethod, example: 'CASH' })
  @IsEnum(PaymentMethod)
  @IsOptional()
  paymentMethod?: PaymentMethod;

  @ApiProperty({ description: 'Amount', example: 500 })
  @IsNumber()
  @IsOptional()
  amount?: number;

  @ApiProperty({ description: 'Currency', example: 'INR' })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiProperty({ description: 'Notes for the appointment', required: false })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;

  @ApiProperty({ description: 'Symptoms (for healthcare)', required: false })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  symptoms?: string;

  @ApiProperty({ description: 'Is recurring appointment', required: false })
  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;

  @ApiProperty({ description: 'Recurring pattern', required: false })
  @IsOptional()
  @IsString()
  recurringPattern?: string;

  @ApiProperty({ description: 'Recurring end date', required: false })
  @IsOptional()
  @IsDateString()
  recurringEndDate?: string;

  @ApiProperty({ description: 'Video call URL', required: false })
  @IsOptional()
  @IsString()
  videoCallUrl?: string;

  @ApiProperty({ description: 'Language preference', enum: Language, example: 'en' })
  @IsEnum(Language)
  @IsOptional()
  language?: Language;

  @ApiProperty({ description: 'Pre-screening data', required: false })
  @IsOptional()
  @IsObject()
  preScreeningData?: any;

  @ApiProperty({ description: 'Insurance information', required: false })
  @IsOptional()
  @IsObject()
  insuranceInfo?: any;

  @ApiProperty({ description: 'Therapy ID', required: false })
  @IsOptional()
  @IsUUID()
  therapyId?: string;
}

export class UpdateAppointmentDto {
  @ApiProperty({ description: 'Appointment date (YYYY-MM-DD)', required: false })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => value?.trim())
  date?: string;

  @ApiProperty({ description: 'Appointment time (HH:mm)', required: false })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => value?.trim())
  time?: string;

  @ApiProperty({ description: 'Duration in minutes', required: false })
  @IsOptional()
  @IsNumber()
  duration?: number;

  @ApiProperty({ description: 'Appointment status', enum: AppointmentStatus, required: false })
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @ApiProperty({ description: 'Appointment type', enum: AppointmentType, required: false })
  @IsOptional()
  @IsEnum(AppointmentType)
  type?: AppointmentType;

  @ApiProperty({ description: 'Appointment priority', enum: AppointmentPriority, required: false })
  @IsOptional()
  @IsEnum(AppointmentPriority)
  priority?: AppointmentPriority;

  @ApiProperty({ description: 'Payment status', enum: PaymentStatus, required: false })
  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @ApiProperty({ description: 'Payment method', enum: PaymentMethod, required: false })
  @IsOptional()
  @IsEnum(PaymentMethod)
  paymentMethod?: PaymentStatus;

  @ApiProperty({ description: 'Amount', required: false })
  @IsOptional()
  @IsNumber()
  amount?: number;

  @ApiProperty({ description: 'Notes for the appointment', required: false })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;

  @ApiProperty({ description: 'Symptoms (for healthcare)', required: false })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  symptoms?: string;

  @ApiProperty({ description: 'Started at timestamp', required: false })
  @IsOptional()
  @IsDateString()
  startedAt?: string;

  @ApiProperty({ description: 'Checked in at timestamp', required: false })
  @IsOptional()
  @IsDateString()
  checkedInAt?: string;

  @ApiProperty({ description: 'Completed at timestamp', required: false })
  @IsOptional()
  @IsDateString()
  completedAt?: string;
}

export class AppointmentResponseDto {
  @ApiProperty({ description: 'Appointment ID' })
  id!: string;

  @ApiProperty({ description: 'Appointment type', enum: AppointmentType })
  type!: AppointmentType;

  @ApiProperty({ description: 'Appointment status', enum: AppointmentStatus })
  status!: AppointmentStatus;

  @ApiProperty({ description: 'Appointment priority', enum: AppointmentPriority })
  priority!: AppointmentPriority;

  @ApiProperty({ description: 'Appointment date' })
  date!: Date;

  @ApiProperty({ description: 'Appointment time' })
  time!: string;

  @ApiProperty({ description: 'Duration in minutes' })
  duration!: number;

  @ApiProperty({ description: 'Payment status', enum: PaymentStatus })
  paymentStatus!: PaymentStatus;

  @ApiProperty({ description: 'Payment method', enum: PaymentMethod })
  paymentMethod!: PaymentMethod;

  @ApiProperty({ description: 'Amount' })
  amount!: number;

  @ApiProperty({ description: 'Currency' })
  currency!: string;

  @ApiProperty({ description: 'Video call status', enum: VideoCallStatus })
  videoCallStatus?: VideoCallStatus;

  @ApiProperty({ description: 'Notes' })
  notes?: string;

  @ApiProperty({ description: 'Symptoms' })
  symptoms?: string;

  @ApiProperty({ description: 'Created at' })
  createdAt!: Date;

  @ApiProperty({ description: 'Updated at' })
  updatedAt!: Date;

  @ApiProperty({ description: 'Started at' })
  startedAt?: Date;

  @ApiProperty({ description: 'Checked in at' })
  checkedInAt?: Date;

  @ApiProperty({ description: 'Completed at' })
  completedAt?: Date;

  @ApiProperty({ description: 'Doctor information' })
  doctor!: {
    id: string;
    name: string;
    email: string;
    specialization: string;
    licenseNumber?: string;
    experience: number;
    rating?: number;
  };

  @ApiProperty({ description: 'Patient information' })
  patient!: {
    id: string;
    name: string;
    email: string;
    phone?: string;
    patientNumber?: string;
    bloodGroup?: string;
    emergencyContact?: string;
  };

  @ApiProperty({ description: 'Location information' })
  location!: {
    id: string;
    name: string;
    address: string;
    city: string;
    phone?: string;
  };

  @ApiProperty({ description: 'Clinic information' })
  clinic!: {
    id: string;
    name: string;
    subdomain: string;
    address: string;
    phone: string;
  };
}

export class AppointmentListResponseDto {
  @ApiProperty({ description: 'List of appointments', type: [AppointmentResponseDto] })
  appointments!: AppointmentResponseDto[];

  @ApiProperty({ description: 'Total count of appointments' })
  total!: number;

  @ApiProperty({ description: 'Current page number' })
  page!: number;

  @ApiProperty({ description: 'Number of items per page' })
  limit!: number;

  @ApiProperty({ description: 'Total number of pages' })
  totalPages!: number;

  @ApiProperty({ description: 'Has next page' })
  hasNext!: boolean;

  @ApiProperty({ description: 'Has previous page' })
  hasPrev!: boolean;
}

export class DoctorAvailabilityResponseDto {
  @ApiProperty({ description: 'Whether doctor is available' })
  available!: boolean;

  @ApiProperty({ description: 'Available time slots', type: [String] })
  availableSlots!: string[];

  @ApiProperty({ description: 'Booked time slots', type: [String] })
  bookedSlots!: string[];

  @ApiProperty({ description: 'Working hours for the day' })
  workingHours: any;

  @ApiProperty({ description: 'Next available slot' })
  nextAvailableSlot?: string;

  @ApiProperty({ description: 'Message about availability', required: false })
  message?: string;
}

export class ProcessCheckInDto {
  @ApiProperty({ description: 'Appointment ID to check in' })
  @IsUUID()
  appointmentId!: string;

  @ApiProperty({ description: 'QR code for verification', required: false })
  @IsOptional()
  @IsString()
  qrCode?: string;

  @ApiProperty({ description: 'Check-in method', required: false })
  @IsOptional()
  @IsString()
  checkInMethod?: string;

  @ApiProperty({ description: 'Notes', required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ReorderQueueDto {
  @ApiProperty({ description: 'Ordered list of appointment IDs', type: [String] })
  @IsArray()
  @IsUUID('4', { each: true })
  appointmentOrder!: string[];

  @ApiProperty({ description: 'Reason for reordering', required: false })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class VerifyAppointmentQRDto {
  @ApiProperty({ description: 'QR data string' })
  @IsString()
  qrData!: string;

  @ApiProperty({ description: 'Location ID' })
  @IsUUID()
  locationId!: string;

  @ApiProperty({ description: 'Clinic ID' })
  @IsUUID()
  clinicId!: string;

  @ApiProperty({ description: 'Timestamp' })
  @IsString()
  timestamp!: string;

  @ApiProperty({ description: 'Appointment ID', required: false })
  @IsOptional()
  @IsUUID()
  appointmentId?: string;
}

export class CompleteAppointmentDto {
  @ApiProperty({ description: 'Doctor ID' })
  @IsUUID()
  doctorId!: string;

  @ApiProperty({ description: 'Completion notes', required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ description: 'Diagnosis', required: false })
  @IsOptional()
  @IsString()
  diagnosis?: string;

  @ApiProperty({ description: 'Treatment plan', required: false })
  @IsOptional()
  @IsString()
  treatmentPlan?: string;

  @ApiProperty({ description: 'Follow-up required', required: false })
  @IsOptional()
  @IsBoolean()
  followUpRequired?: boolean;

  @ApiProperty({ description: 'Follow-up date', required: false })
  @IsOptional()
  @IsDateString()
  followUpDate?: string;
}

export class StartConsultationDto {
  @ApiProperty({ description: 'Doctor ID' })
  @IsUUID()
  doctorId!: string;

  @ApiProperty({ description: 'Consultation type', required: false })
  @IsOptional()
  @IsString()
  consultationType?: string;

  @ApiProperty({ description: 'Notes', required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class AppointmentFilterDto {
  @ApiProperty({ description: 'Start date', required: false })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({ description: 'End date', required: false })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiProperty({ description: 'Status filter', enum: AppointmentStatus, required: false })
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @ApiProperty({ description: 'Type filter', enum: AppointmentType, required: false })
  @IsOptional()
  @IsEnum(AppointmentType)
  type?: AppointmentType;

  @ApiProperty({ description: 'Priority filter', enum: AppointmentPriority, required: false })
  @IsOptional()
  @IsEnum(AppointmentPriority)
  priority?: AppointmentPriority;

  @ApiProperty({ description: 'Provider ID filter', required: false })
  @IsOptional()
  @IsUUID()
  providerId?: string;

  @ApiProperty({ description: 'Patient/Customer ID filter', required: false })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiProperty({ description: 'Location ID filter', required: false })
  @IsOptional()
  @IsUUID()
  locationId?: string;

  @ApiProperty({ description: 'Clinic ID filter', required: false })
  @IsOptional()
  @IsUUID()
  clinicId?: string;

  @ApiProperty({ description: 'Page number', required: false })
  @IsOptional()
  @IsNumber()
  page?: number;

  @ApiProperty({ description: 'Page size', required: false })
  @IsOptional()
  @IsNumber()
  limit?: number;
}

// Enhanced Interfaces for Enterprise Features
export interface Doctor {
  id: string;
  userId: string;
  specialization: string;
  experience: number;
  qualification?: string;
  consultationFee?: number;
  rating?: number;
  isAvailable: boolean;
  nextAvailableSlot?: string;
  workingHours?: any;
}

export interface Patient {
  id: string;
  userId: string;
  bloodGroup?: string;
  emergencyContact?: string;
  insuranceProvider?: string;
  insuranceNumber?: string;
  patientNumber?: string;
  medicalHistory?: any;
  allergies?: string[];
  medications?: string[];
}

export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  name: string;
  role: string;
  isVerified: boolean;
  phone?: string;
  avatar?: string;
  lastLoginAt?: Date;
}

export type DoctorWithUser = Doctor & {
  user: User;
};

export type PatientWithUser = Patient & {
  user: User;
};

export interface Appointment {
  id: string;
  type: AppointmentType;
  status: AppointmentStatus;
  priority: AppointmentPriority;
  doctorId: string;
  patientId: string;
  locationId: string;
  clinicId: string;
  date: Date;
  time: string;
  duration: number;
  notes?: string;
  symptoms?: string;
  userId: string;
  therapyId?: string;
  startedAt?: Date;
  checkedInAt?: Date;
  completedAt?: Date;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  amount: number;
  currency: string;
  videoCallStatus?: VideoCallStatus;
  videoCallUrl?: string;
  isRecurring: boolean;
  recurringPattern?: string;
  recurringEndDate?: Date;
  language: Language;
  preScreeningData?: any;
  insuranceInfo?: any;
  metadata: {
    createdAt: Date;
    updatedAt: Date;
    createdBy: string;
    updatedBy?: string;
    version: number;
    auditTrail: any[];
  };
}

export type AppointmentWithRelations = Appointment & {
  doctor: DoctorWithUser;
  patient: PatientWithUser;
  location: any;
  clinic: any;
}; 