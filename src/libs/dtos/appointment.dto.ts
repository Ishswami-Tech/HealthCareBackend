import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsUUID,
  IsDateString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
  Max,
  IsBoolean,
  IsObject,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { IsClinicId } from '@core/decorators/clinic-id.validator';

/**
 * Appointment status enumeration
 * @enum {string} AppointmentStatus
 * @description Defines the possible states of an appointment in the system
 * @example AppointmentStatus.SCHEDULED
 */
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
  FOLLOW_UP_SCHEDULED = 'FOLLOW_UP_SCHEDULED',
}

/**
 * Appointment type enumeration
 * @enum {string} AppointmentType
 * @description Defines the different types of appointments available
 * @example AppointmentType.CONSULTATION
 */
export enum AppointmentType {
  // Healthcare Appointment Types
  GENERAL_CONSULTATION = 'GENERAL_CONSULTATION',
  CONSULTATION = 'CONSULTATION',
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
  ROUTINE_CHECKUP = 'ROUTINE_CHECKUP',
  SPECIALIST_VISIT = 'SPECIALIST_VISIT',
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
  TELEMEDICINE = 'TELEMEDICINE',
}

/**
 * Appointment priority enumeration
 * @enum {string} AppointmentPriority
 * @description Defines the priority levels for appointments
 * @example AppointmentPriority.HIGH
 */
export enum AppointmentPriority {
  EMERGENCY = 'EMERGENCY',
  URGENT = 'URGENT',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  NORMAL = 'NORMAL',
  LOW = 'LOW',
  ROUTINE = 'ROUTINE',
}

/**
 * Payment status enumeration
 * @enum {string} PaymentStatus
 */
export enum PaymentStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
  PARTIAL = 'PARTIAL',
  INSURANCE_PENDING = 'INSURANCE_PENDING',
}

/**
 * Payment method enumeration
 * @enum {string} PaymentMethod
 */
export enum PaymentMethod {
  CASH = 'CASH',
  CARD = 'CARD',
  UPI = 'UPI',
  NET_BANKING = 'NET_BANKING',
  WALLET = 'WALLET',
  CHEQUE = 'CHEQUE',
  INSURANCE = 'INSURANCE',
  DIGITAL_PAYMENT = 'DIGITAL_PAYMENT',
}

/**
 * Video call status enumeration
 * @enum {string} VideoCallStatus
 */
export enum VideoCallStatus {
  NOT_SCHEDULED = 'NOT_SCHEDULED',
  SCHEDULED = 'SCHEDULED',
  STARTED = 'STARTED',
  ENDED = 'ENDED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  WAITING_ROOM = 'WAITING_ROOM',
}

/**
 * Queue status enumeration
 * @enum {string} QueueStatus
 */
export enum QueueStatus {
  WAITING = 'WAITING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
  ON_HOLD = 'ON_HOLD',
  TRANSFERRED = 'TRANSFERRED',
}

/**
 * Notification type enumeration
 * @enum {string} NotificationType
 */
export enum NotificationType {
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  PUSH_NOTIFICATION = 'PUSH_NOTIFICATION',
  WHATSAPP = 'WHATSAPP',
  IN_APP = 'IN_APP',
  VOICE_CALL = 'VOICE_CALL',
}

/**
 * Language enumeration
 * @enum {string} Language
 */
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
  AS = 'as',
}

/**
 * Data Transfer Object for creating new appointments
 * @class CreateAppointmentDto
 * @description Contains all required fields for appointment creation with validation
 * @example
 * ```typescript
 * const appointment = new CreateAppointmentDto();
 * appointment.patientId = "patient-uuid-123";
 * appointment.doctorId = "doctor-uuid-123";
 * appointment.appointmentDate = "2024-01-15T10:00:00.000Z";
 * ```
 */
export class CreateAppointmentDto {
  @ApiProperty({
    example: 'patient-uuid-123',
    description: 'Patient ID for the appointment',
  })
  @IsUUID('4', { message: 'Patient ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Patient ID is required' })
  patientId!: string;

  @ApiProperty({
    example: 'doctor-uuid-123',
    description: 'Doctor ID for the appointment',
  })
  @IsUUID('4', { message: 'Doctor ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Doctor ID is required' })
  doctorId!: string;

  @ApiProperty({
    example: 'CL0001',
    description: 'Clinic ID where appointment will take place (UUID or clinic code like CL0001)',
  })
  @IsClinicId({ message: 'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001)' })
  @IsNotEmpty({ message: 'Clinic ID is required' })
  clinicId!: string;

  @ApiPropertyOptional({
    example: 'location-uuid-123',
    description:
      'Clinic location ID for in-person appointments. Required for in-person appointment types.',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Location ID must be a valid UUID' })
  locationId?: string;

  @ApiProperty({
    example: '2024-01-15T10:00:00.000Z',
    description: 'Appointment date and time',
    format: 'date-time',
  })
  @IsDateString({}, { message: 'Appointment date must be a valid date string' })
  @IsNotEmpty({ message: 'Appointment date is required' })
  appointmentDate!: string;

  @ApiProperty({
    example: 30,
    description: 'Appointment duration in minutes',
    minimum: 15,
    maximum: 480,
  })
  @IsNumber({}, { message: 'Duration must be a number' })
  @Min(15, { message: 'Duration must be at least 15 minutes' })
  @Max(480, { message: 'Duration cannot exceed 8 hours' })
  duration!: number;

  @ApiProperty({
    example: 'CONSULTATION',
    description: 'Type of appointment',
    enum: AppointmentType,
  })
  @IsEnum(AppointmentType, { message: 'Appointment type must be a valid type' })
  @IsNotEmpty({ message: 'Appointment type is required' })
  type!: AppointmentType;

  @ApiPropertyOptional({
    example: 'MEDIUM',
    description: 'Appointment priority level',
    enum: AppointmentPriority,
    default: AppointmentPriority.MEDIUM,
  })
  @IsOptional()
  @IsEnum(AppointmentPriority, {
    message: 'Priority must be a valid priority level',
  })
  priority?: AppointmentPriority = AppointmentPriority.MEDIUM;

  @ApiPropertyOptional({
    example: 'Regular checkup appointment',
    description: 'Appointment notes or description',
  })
  @IsOptional()
  @IsString({ message: 'Notes must be a string' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  notes?: string;

  @ApiPropertyOptional({
    example: 'clinic-uuid-123',
    description: 'Studio ID for clinic domain appointments',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Studio ID must be a valid UUID' })
  studioId?: string;

  @ApiPropertyOptional({
    example: 'healthcare',
    description: 'Application domain for multi-domain setup',
    enum: ['healthcare', 'clinic'],
  })
  @IsOptional()
  @IsString({ message: 'App domain must be a string' })
  appDomain?: string;

  @ApiPropertyOptional({
    description: 'List of symptoms',
    example: ['Fever', 'Headache'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  symptoms?: string[];
}

/**
 * Data Transfer Object for updating existing appointments
 * @class UpdateAppointmentDto
 * @description Contains optional fields for appointment updates with validation
 * @example
 * ```typescript
 * const update = new UpdateAppointmentDto();
 * update.status = AppointmentStatus.CONFIRMED;
 * update.notes = "Updated appointment notes";
 * ```
 */
export class UpdateAppointmentDto {
  @ApiPropertyOptional({
    example: '2024-01-15T10:00:00.000Z',
    description: 'New appointment date and time',
  })
  @IsOptional()
  @IsDateString({}, { message: 'Appointment date must be a valid date string' })
  appointmentDate?: string;

  @ApiPropertyOptional({
    example: 45,
    description: 'New appointment duration in minutes',
  })
  @IsOptional()
  @IsNumber({}, { message: 'Duration must be a number' })
  @Min(15, { message: 'Duration must be at least 15 minutes' })
  @Max(480, { message: 'Duration cannot exceed 8 hours' })
  duration?: number;

  @ApiPropertyOptional({
    example: 'CONFIRMED',
    description: 'New appointment status',
  })
  @IsOptional()
  @IsEnum(AppointmentStatus, {
    message: 'Status must be a valid appointment status',
  })
  status?: AppointmentStatus;

  @ApiPropertyOptional({
    example: 'HIGH',
    description: 'New appointment priority level',
  })
  @IsOptional()
  @IsEnum(AppointmentPriority, {
    message: 'Priority must be a valid priority level',
  })
  priority?: AppointmentPriority;

  @ApiPropertyOptional({
    example: 'Updated appointment notes',
    description: 'New appointment notes or description',
  })
  @IsOptional()
  @IsString({ message: 'Notes must be a string' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  notes?: string;

  @ApiPropertyOptional({
    example: 'doctor-uuid-456',
    description: 'New doctor ID for the appointment',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Doctor ID must be a valid UUID' })
  doctorId?: string;

  @ApiPropertyOptional({
    example: 'CL0001',
    description: 'New clinic ID for the appointment (UUID or clinic code like CL0001)',
  })
  @IsOptional()
  @IsClinicId({ message: 'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001)' })
  clinicId?: string;

  @ApiPropertyOptional({ description: 'List of symptoms' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  symptoms?: string[];

  @ApiPropertyOptional({ description: 'Diagnosis' })
  @IsOptional()
  @IsString()
  diagnosis?: string;

  @ApiPropertyOptional({ description: 'Prescription text' })
  @IsOptional()
  @IsString()
  prescription?: string;

  @ApiPropertyOptional({ description: 'Treatment Plan' })
  @IsOptional()
  @IsString()
  treatmentPlan?: string;

  @ApiPropertyOptional({ description: 'Follow-up Date' })
  @IsOptional()
  @IsDateString()
  followUpDate?: string;
}

/**
 * Data Transfer Object for appointment responses
 * @class AppointmentResponseDto
 * @description Contains appointment data for API responses, excluding sensitive information
 * @example
 * ```typescript
 * const response = new AppointmentResponseDto();
 * response.id = "appointment-uuid-123";
 * response.status = AppointmentStatus.SCHEDULED;
 * ```
 */
export class AppointmentResponseDto {
  @ApiProperty({
    example: 'appointment-uuid-123',
    description: 'Unique appointment identifier',
  })
  @IsUUID('4', { message: 'Appointment ID must be a valid UUID' })
  id!: string;

  @ApiProperty({
    example: 'patient-uuid-123',
    description: 'Patient ID for the appointment',
  })
  @IsUUID('4', { message: 'Patient ID must be a valid UUID' })
  patientId!: string;

  @ApiProperty({
    example: 'doctor-uuid-123',
    description: 'Doctor ID for the appointment',
  })
  @IsUUID('4', { message: 'Doctor ID must be a valid UUID' })
  doctorId!: string;

  @ApiProperty({
    example: 'CL0001',
    description: 'Clinic ID where appointment takes place (UUID or clinic code like CL0001)',
  })
  @IsClinicId({ message: 'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001)' })
  clinicId!: string;

  @ApiProperty({
    example: '2024-01-15T10:00:00.000Z',
    description: 'Appointment date and time',
  })
  @IsDateString({}, { message: 'Appointment date must be a valid date string' })
  appointmentDate!: string;

  @ApiProperty({
    example: 30,
    description: 'Appointment duration in minutes',
  })
  @IsNumber({}, { message: 'Duration must be a number' })
  duration!: number;

  @ApiProperty({
    example: 'CONSULTATION',
    description: 'Type of appointment',
  })
  @IsEnum(AppointmentType, { message: 'Appointment type must be a valid type' })
  type!: AppointmentType;

  @ApiProperty({
    example: 'SCHEDULED',
    description: 'Current appointment status',
  })
  @IsEnum(AppointmentStatus, {
    message: 'Status must be a valid appointment status',
  })
  status!: AppointmentStatus;

  @ApiProperty({
    example: 'MEDIUM',
    description: 'Appointment priority level',
  })
  @IsEnum(AppointmentPriority, {
    message: 'Priority must be a valid priority level',
  })
  priority!: AppointmentPriority;

  @ApiPropertyOptional({
    example: 'Regular checkup appointment',
    description: 'Appointment notes or description',
  })
  @IsOptional()
  @IsString({ message: 'Notes must be a string' })
  notes?: string;

  @ApiProperty({
    example: '2024-01-01T00:00:00.000Z',
    description: 'Appointment creation timestamp',
  })
  @IsDateString({}, { message: 'Created at must be a valid date string' })
  createdAt!: string;

  @ApiProperty({
    example: '2024-01-01T00:00:00.000Z',
    description: 'Appointment last update timestamp',
  })
  @IsDateString({}, { message: 'Updated at must be a valid date string' })
  updatedAt!: string;

  @ApiPropertyOptional({
    example: 'clinic-uuid-123',
    description: 'Studio ID for clinic domain appointments',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Studio ID must be a valid UUID' })
  studioId?: string;

  @ApiPropertyOptional({
    example: 'healthcare',
    description: 'Application domain for multi-domain setup',
  })
  @IsOptional()
  @IsString({ message: 'App domain must be a string' })
  appDomain?: string;
}

/**
 * Data Transfer Object for appointment search and filtering
 * @class AppointmentSearchDto
 * @description Contains optional fields for searching and filtering appointments
 * @example
 * ```typescript
 * const search = new AppointmentSearchDto();
 * search.patientId = "patient-uuid-123";
 * search.status = AppointmentStatus.SCHEDULED;
 * ```
 */
export class AppointmentSearchDto {
  @ApiPropertyOptional({
    example: '2024-01-01',
    description: 'Start date for appointment search (YYYY-MM-DD)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'Start date must be a valid date string' })
  startDate?: string;

  @ApiPropertyOptional({
    example: '2024-01-31',
    description: 'End date for appointment search (YYYY-MM-DD)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'End date must be a valid date string' })
  endDate?: string;

  @ApiPropertyOptional({
    example: 'patient-uuid-123',
    description: 'Filter by patient ID',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Patient ID must be a valid UUID' })
  patientId?: string;

  @ApiPropertyOptional({
    example: 'doctor-uuid-123',
    description: 'Filter by doctor ID',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Doctor ID must be a valid UUID' })
  doctorId?: string;

  @ApiPropertyOptional({
    example: 'clinic-uuid-123',
    description: 'Filter by clinic ID',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Clinic ID must be a valid UUID' })
  clinicId?: string;

  @ApiPropertyOptional({
    example: 'SCHEDULED',
    description: 'Filter by appointment status',
    enum: AppointmentStatus,
  })
  @IsOptional()
  @IsEnum(AppointmentStatus, {
    message: 'Status must be a valid appointment status',
  })
  status?: AppointmentStatus;

  @ApiPropertyOptional({
    example: 'CONSULTATION',
    description: 'Filter by appointment type',
    enum: AppointmentType,
  })
  @IsOptional()
  @IsEnum(AppointmentType, { message: 'Type must be a valid appointment type' })
  type?: AppointmentType;

  @ApiPropertyOptional({
    example: 'MEDIUM',
    description: 'Filter by appointment priority',
    enum: AppointmentPriority,
  })
  @IsOptional()
  @IsEnum(AppointmentPriority, {
    message: 'Priority must be a valid priority level',
  })
  priority?: AppointmentPriority;

  @ApiPropertyOptional({
    example: 'healthcare',
    description: 'Filter by application domain',
    enum: ['healthcare', 'clinic'],
  })
  @IsOptional()
  @IsString({ message: 'App domain must be a string' })
  appDomain?: string;
}

/**
 * Data Transfer Object for bulk appointment creation
 * @class BulkCreateAppointmentsDto
 * @description Contains array of appointments and notification settings for bulk creation
 * @example
 * ```typescript
 * const bulk = new BulkCreateAppointmentsDto();
 * bulk.appointments = [appointment1, appointment2];
 * bulk.sendNotifications = true;
 * ```
 */
export class BulkCreateAppointmentsDto {
  @ApiProperty({
    description: 'Array of appointments to create',
    type: [CreateAppointmentDto],
  })
  @IsArray({ message: 'Appointments must be an array' })
  @ValidateNested({ each: true })
  @Type(() => CreateAppointmentDto)
  appointments!: CreateAppointmentDto[];

  @ApiPropertyOptional({
    example: true,
    description: 'Whether to send notifications for created appointments',
    default: true,
  })
  @IsOptional()
  @IsBoolean({ message: 'Send notifications must be a boolean' })
  sendNotifications?: boolean = true;
}

/**
 * Data Transfer Object for appointment cancellation
 * @class CancelAppointmentDto
 * @description Contains reason and notification settings for appointment cancellation
 * @example
 * ```typescript
 * const cancel = new CancelAppointmentDto();
 * cancel.reason = "Patient requested cancellation";
 * cancel.sendNotification = true;
 * ```
 */
export class CancelAppointmentDto {
  @ApiProperty({
    example: 'Patient requested cancellation',
    description: 'Reason for appointment cancellation',
  })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  reason!: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether to send cancellation notification',
    default: true,
  })
  @IsOptional()
  @IsBoolean({ message: 'Send notification must be a boolean' })
  sendNotification?: boolean = true;
}

/**
 * Data Transfer Object for appointment rescheduling
 * @class RescheduleAppointmentDto
 * @description Contains new date and reason for appointment rescheduling
 * @example
 * ```typescript
 * const reschedule = new RescheduleAppointmentDto();
 * reschedule.newAppointmentDate = "2024-01-16T10:00:00.000Z";
 * reschedule.reason = "Patient requested reschedule";
 * ```
 */
export class RescheduleAppointmentDto {
  @ApiProperty({
    example: '2024-01-16T10:00:00.000Z',
    description: 'New appointment date and time',
  })
  @IsDateString({}, { message: 'New appointment date must be a valid date string' })
  @IsNotEmpty({ message: 'New appointment date is required' })
  newAppointmentDate!: string;

  @ApiPropertyOptional({
    example: 'Patient requested reschedule',
    description: 'Reason for rescheduling',
  })
  @IsOptional()
  @IsString({ message: 'Reschedule reason must be a string' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  reason?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether to send reschedule notification',
    default: true,
  })
  @IsOptional()
  @IsBoolean({ message: 'Send notification must be a boolean' })
  sendNotification?: boolean = true;
}

// =============================================
// QR CODE CHECK-IN DTOs
// =============================================

/**
 * Data Transfer Object for scanning location QR code
 * @class ScanLocationQRDto
 * @description Contains QR code data and optional geofencing information for location-based check-in
 * @example
 * ```typescript
 * const scanDto = new ScanLocationQRDto();
 * scanDto.qrCode = "CHK-clinic123-loc456-1234567890-abc123";
 * scanDto.coordinates = { lat: 19.0760, lng: 72.8777 };
 * ```
 */
export class ScanLocationQRDto {
  @ApiProperty({
    description: 'QR code string scanned from location QR code',
    example: 'CHK-clinic123-loc456-1234567890-abc123',
    required: true,
  })
  @IsString({ message: 'QR code must be a string' })
  @IsNotEmpty({ message: 'QR code is required' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  qrCode!: string;

  @ApiPropertyOptional({
    description: 'Optional patient coordinates for geofencing validation',
    required: false,
  })
  @IsOptional()
  @IsObject({ message: 'Coordinates must be an object' })
  coordinates?: {
    lat: number;
    lng: number;
  };

  @ApiPropertyOptional({
    description: 'Optional device information',
    required: false,
  })
  @IsOptional()
  @IsObject({ message: 'Device info must be an object' })
  deviceInfo?: {
    userAgent?: string;
    platform?: string;
    model?: string;
  };

  @ApiPropertyOptional({
    description:
      'Optional appointment ID to check into when multiple appointments are available at the same location',
    required: false,
  })
  @IsOptional()
  @IsUUID('4', { message: 'Appointment ID must be a valid UUID' })
  appointmentId?: string;
}

/**
 * Data Transfer Object for QR scan response
 * @class ScanLocationQRResponseDto
 * @description Contains check-in result with queue position and appointment details
 * @example
 * ```typescript
 * const response = new ScanLocationQRResponseDto();
 * response.success = true;
 * response.data = { appointmentId: "...", queuePosition: 3, ... };
 * ```
 */
export class ScanLocationQRResponseDto {
  @ApiProperty({ description: 'Success status' })
  @IsBoolean({ message: 'Success must be a boolean' })
  success!: boolean;

  @ApiPropertyOptional({ description: 'Response data', required: false })
  @IsOptional()
  @IsObject({ message: 'Data must be an object' })
  data?: {
    appointmentId: string;
    locationId: string;
    locationName: string;
    checkedInAt: string;
    queuePosition: number;
    totalInQueue: number;
    estimatedWaitTime: number;
    doctorId: string;
    doctorName: string;
  };

  @ApiPropertyOptional({ description: 'Error information', required: false })
  @IsOptional()
  @IsObject({ message: 'Error must be an object' })
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };

  @ApiPropertyOptional({ description: 'Success message', required: false })
  @IsOptional()
  @IsString({ message: 'Message must be a string' })
  message?: string;
}

/**
 * Data Transfer Object for location QR code generation response
 * @class LocationQRCodeResponseDto
 * @description Contains generated QR code image and location details
 * @example
 * ```typescript
 * const response = new LocationQRCodeResponseDto();
 * response.qrCode = "data:image/png;base64,...";
 * response.locationId = "loc-uuid";
 * ```
 */
export class LocationQRCodeResponseDto {
  @ApiProperty({ description: 'QR code image as base64 data URL' })
  @IsString({ message: 'QR code must be a string' })
  @IsNotEmpty({ message: 'QR code is required' })
  qrCode!: string;

  @ApiProperty({ description: 'Location ID' })
  @IsUUID('4', { message: 'Location ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Location ID is required' })
  locationId!: string;

  @ApiProperty({ description: 'Location name' })
  @IsString({ message: 'Location name must be a string' })
  @IsNotEmpty({ message: 'Location name is required' })
  locationName!: string;

  @ApiProperty({ description: 'QR code string value' })
  @IsString({ message: 'QR code string must be a string' })
  @IsNotEmpty({ message: 'QR code string is required' })
  qrCodeString!: string;
}

/**
 * Data Transfer Object for processing check-in
 * @class ProcessCheckInDto
 * @description appointmentId comes from URL path, so it's optional in body
 */
export class ProcessCheckInDto {
  @ApiPropertyOptional({
    description: 'Appointment ID to check in (optional, comes from URL path)',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Appointment ID must be a valid UUID' })
  appointmentId?: string;

  @ApiPropertyOptional({ description: 'Location ID for check-in', required: false })
  @IsOptional()
  @IsUUID('4', { message: 'Location ID must be a valid UUID' })
  locationId?: string;

  @ApiPropertyOptional({ description: 'QR code for verification', required: false })
  @IsOptional()
  @IsString({ message: 'QR code must be a string' })
  qrCode?: string;

  @ApiPropertyOptional({ description: 'Check-in method', required: false })
  @IsOptional()
  @IsString({ message: 'Check-in method must be a string' })
  checkInMethod?: string;

  @ApiPropertyOptional({ description: 'Notes', required: false })
  @IsOptional()
  @IsString({ message: 'Notes must be a string' })
  notes?: string;
}

/**
 * Data Transfer Object for reordering queue
 * @class ReorderQueueDto
 */
export class ReorderQueueDto {
  @ApiProperty({
    description: 'Ordered list of appointment IDs',
    type: [String],
  })
  @IsArray({ message: 'Appointment order must be an array' })
  @IsUUID('4', { each: true, message: 'Each appointment ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Appointment order is required' })
  appointmentOrder!: string[];

  @ApiPropertyOptional({ description: 'Reason for reordering', required: false })
  @IsOptional()
  @IsString({ message: 'Reason must be a string' })
  reason?: string;
}

/**
 * Data Transfer Object for verifying appointment QR code
 * @class VerifyAppointmentQRDto
 */
export class VerifyAppointmentQRDto {
  @ApiProperty({ description: 'QR data string' })
  @IsString({ message: 'QR data must be a string' })
  @IsNotEmpty({ message: 'QR data is required' })
  qrData!: string;

  @ApiProperty({ description: 'Location ID' })
  @IsUUID('4', { message: 'Location ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Location ID is required' })
  locationId!: string;

  @ApiProperty({ description: 'Clinic ID (UUID or clinic code like CL0001)' })
  @IsClinicId({ message: 'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001)' })
  @IsNotEmpty({ message: 'Clinic ID is required' })
  clinicId!: string;

  @ApiProperty({ description: 'Timestamp' })
  @IsString({ message: 'Timestamp must be a string' })
  @IsNotEmpty({ message: 'Timestamp is required' })
  timestamp!: string;

  @ApiPropertyOptional({ description: 'Appointment ID', required: false })
  @IsOptional()
  @IsUUID('4', { message: 'Appointment ID must be a valid UUID' })
  appointmentId?: string;
}

/**
 * Data Transfer Object for completing appointment
 * @class CompleteAppointmentDto
 */
export class CompleteAppointmentDto {
  @ApiProperty({ description: 'Doctor ID' })
  @IsUUID('4', { message: 'Doctor ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Doctor ID is required' })
  doctorId!: string;

  @ApiPropertyOptional({ description: 'Completion notes', required: false })
  @IsOptional()
  @IsString({ message: 'Notes must be a string' })
  notes?: string;

  @ApiPropertyOptional({ description: 'Diagnosis', required: false })
  @IsOptional()
  @IsString({ message: 'Diagnosis must be a string' })
  diagnosis?: string;

  @ApiPropertyOptional({ description: 'Treatment plan', required: false })
  @IsOptional()
  @IsString({ message: 'Treatment plan must be a string' })
  treatmentPlan?: string;

  @ApiPropertyOptional({ description: 'Prescription text', required: false })
  @IsOptional()
  @IsString()
  prescription?: string;

  @ApiPropertyOptional({ description: 'Follow-up required', required: false })
  @IsOptional()
  @IsBoolean({ message: 'Follow-up required must be a boolean' })
  followUpRequired?: boolean;

  @ApiPropertyOptional({ description: 'Follow-up date', required: false })
  @IsOptional()
  @IsDateString({}, { message: 'Follow-up date must be a valid date string' })
  followUpDate?: string;

  @ApiPropertyOptional({
    description: 'Follow-up type',
    enum: ['routine', 'urgent', 'specialist', 'therapy', 'surgery'],
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Follow-up type must be a string' })
  followUpType?: 'routine' | 'urgent' | 'specialist' | 'therapy' | 'surgery';

  @ApiPropertyOptional({ description: 'Follow-up instructions', required: false })
  @IsOptional()
  @IsString({ message: 'Follow-up instructions must be a string' })
  followUpInstructions?: string;

  @ApiPropertyOptional({
    description: 'Follow-up priority',
    enum: ['low', 'normal', 'high', 'urgent'],
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Follow-up priority must be a string' })
  followUpPriority?: 'low' | 'normal' | 'high' | 'urgent';

  @ApiPropertyOptional({
    description: 'Medications prescribed',
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray({ message: 'Medications must be an array' })
  @IsString({ each: true, message: 'Each medication must be a string' })
  medications?: string[];

  @ApiPropertyOptional({
    description: 'Tests recommended',
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray({ message: 'Tests must be an array' })
  @IsString({ each: true, message: 'Each test must be a string' })
  tests?: string[];

  @ApiPropertyOptional({
    description: 'Restrictions or precautions',
    type: [String],
    required: false,
  })
  @IsOptional()
  @IsArray({ message: 'Restrictions must be an array' })
  @IsString({ each: true, message: 'Each restriction must be a string' })
  restrictions?: string[];
}

/**
 * Data Transfer Object for starting consultation
 * @class StartConsultationDto
 */
export class StartConsultationDto {
  @ApiProperty({ description: 'Doctor ID' })
  @IsUUID('4', { message: 'Doctor ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Doctor ID is required' })
  doctorId!: string;

  @ApiPropertyOptional({ description: 'Consultation type', required: false })
  @IsOptional()
  @IsString({ message: 'Consultation type must be a string' })
  consultationType?: string;

  @ApiPropertyOptional({ description: 'Notes', required: false })
  @IsOptional()
  @IsString({ message: 'Notes must be a string' })
  notes?: string;
}

/**
 * Data Transfer Object for appointment filtering
 * @class AppointmentFilterDto
 */
export class AppointmentFilterDto {
  @ApiPropertyOptional({ description: 'Start date', required: false })
  @IsOptional()
  @IsDateString({}, { message: 'Start date must be a valid date string' })
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date', required: false })
  @IsOptional()
  @IsDateString({}, { message: 'End date must be a valid date string' })
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Status filter',
    enum: AppointmentStatus,
    required: false,
  })
  @IsOptional()
  @IsEnum(AppointmentStatus, { message: 'Status must be a valid appointment status' })
  status?: AppointmentStatus;

  @ApiPropertyOptional({
    description: 'Type filter',
    enum: AppointmentType,
    required: false,
  })
  @IsOptional()
  @IsEnum(AppointmentType, { message: 'Type must be a valid appointment type' })
  type?: AppointmentType;

  @ApiPropertyOptional({
    description: 'Priority filter',
    enum: AppointmentPriority,
    required: false,
  })
  @IsOptional()
  @IsEnum(AppointmentPriority, { message: 'Priority must be a valid priority level' })
  priority?: AppointmentPriority;

  @ApiPropertyOptional({ description: 'Provider ID filter', required: false })
  @IsOptional()
  @IsUUID('4', { message: 'Provider ID must be a valid UUID' })
  providerId?: string;

  @ApiPropertyOptional({ description: 'Patient/Customer ID filter', required: false })
  @IsOptional()
  @IsUUID('4', { message: 'Patient ID must be a valid UUID' })
  patientId?: string;

  @ApiPropertyOptional({ description: 'Location ID filter', required: false })
  @IsOptional()
  @IsUUID('4', { message: 'Location ID must be a valid UUID' })
  locationId?: string;

  @ApiPropertyOptional({
    description: 'Clinic ID filter (UUID or clinic code like CL0001)',
    required: false,
  })
  @IsOptional()
  @IsClinicId({ message: 'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001)' })
  clinicId?: string;

  @ApiPropertyOptional({ description: 'Page number', required: false })
  @IsOptional()
  @IsNumber({}, { message: 'Page must be a number' })
  page?: number;

  @ApiPropertyOptional({ description: 'Page size', required: false })
  @IsOptional()
  @IsNumber({}, { message: 'Limit must be a number' })
  limit?: number;
}

// =============================================
// FOLLOW-UP DTOs
// =============================================

/**
 * Data Transfer Object for scheduling follow-up from plan
 * @class ScheduleFollowUpDto
 * @description Contains appointment details for scheduling a follow-up from a plan
 * @example
 * ```typescript
 * const scheduleDto = new ScheduleFollowUpDto();
 * scheduleDto.appointmentDate = "2024-02-15T10:00:00Z";
 * scheduleDto.doctorId = "doctor-uuid";
 * scheduleDto.locationId = "location-uuid";
 * ```
 */
export class ScheduleFollowUpDto {
  @ApiProperty({
    example: '2024-02-15T10:00:00.000Z',
    description: 'Appointment date and time for the follow-up',
  })
  @IsDateString({}, { message: 'Appointment date must be a valid date string' })
  @IsNotEmpty({ message: 'Appointment date is required' })
  appointmentDate!: string;

  @ApiProperty({
    example: 'doctor-uuid-123',
    description: 'Doctor ID for the follow-up appointment',
  })
  @IsUUID('4', { message: 'Doctor ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Doctor ID is required' })
  doctorId!: string;

  @ApiProperty({
    example: 'location-uuid-123',
    description: 'Location ID where the follow-up will take place',
  })
  @IsUUID('4', { message: 'Location ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Location ID is required' })
  locationId!: string;

  @ApiPropertyOptional({
    example: 'Patient requested morning slot',
    description: 'Optional notes for the follow-up appointment',
  })
  @IsOptional()
  @IsString({ message: 'Notes must be a string' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  notes?: string;
}

/**
 * Data Transfer Object for follow-up plan response
 * @class FollowUpPlanResponseDto
 * @description Contains follow-up plan details
 */
export class FollowUpPlanResponseDto {
  @ApiProperty({ description: 'Follow-up plan ID' })
  id!: string;

  @ApiProperty({ description: 'Original appointment ID' })
  appointmentId!: string;

  @ApiProperty({ description: 'Patient ID' })
  patientId!: string;

  @ApiProperty({ description: 'Doctor ID' })
  doctorId!: string;

  @ApiProperty({ description: 'Clinic ID' })
  clinicId!: string;

  @ApiProperty({
    description: 'Follow-up type',
    enum: ['routine', 'urgent', 'specialist', 'therapy', 'surgery'],
  })
  followUpType!: 'routine' | 'urgent' | 'specialist' | 'therapy' | 'surgery';

  @ApiProperty({ description: 'Scheduled date for follow-up' })
  scheduledFor!: Date;

  @ApiProperty({
    description: 'Plan status',
    enum: ['scheduled', 'completed', 'cancelled', 'overdue'],
  })
  status!: 'scheduled' | 'completed' | 'cancelled' | 'overdue';

  @ApiProperty({
    description: 'Priority level',
    enum: ['low', 'normal', 'high', 'urgent'],
  })
  priority!: 'low' | 'normal' | 'high' | 'urgent';

  @ApiProperty({ description: 'Follow-up instructions' })
  instructions!: string;

  @ApiPropertyOptional({ description: 'Medications', type: [String] })
  medications?: string[];

  @ApiPropertyOptional({ description: 'Tests', type: [String] })
  tests?: string[];

  @ApiPropertyOptional({ description: 'Restrictions', type: [String] })
  restrictions?: string[];

  @ApiPropertyOptional({ description: 'Additional notes' })
  notes?: string;

  @ApiPropertyOptional({ description: 'Linked follow-up appointment ID' })
  followUpAppointmentId?: string;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt!: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt!: Date;
}

/**
 * Data Transfer Object for appointment chain response
 * @class AppointmentChainResponseDto
 * @description Contains original appointment and all follow-ups
 */
export class AppointmentChainResponseDto {
  @ApiProperty({ description: 'Original appointment', type: AppointmentResponseDto })
  original!: AppointmentResponseDto;

  @ApiProperty({
    description: 'Follow-up appointments',
    type: [AppointmentResponseDto],
  })
  followUps!: AppointmentResponseDto[];

  @ApiProperty({ description: 'Total appointments in chain' })
  totalAppointments!: number;

  @ApiProperty({ description: 'Number of completed appointments' })
  completed!: number;

  @ApiProperty({ description: 'Number of pending appointments' })
  pending!: number;
}

/**
 * Data Transfer Object for creating a recurring appointment series
 * @class CreateRecurringSeriesDto
 */
export class CreateRecurringSeriesDto {
  @ApiProperty({
    example: 'template-uuid-123',
    description: 'Appointment template ID',
  })
  @IsUUID('4', { message: 'Template ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Template ID is required' })
  templateId!: string;

  @ApiProperty({
    example: 'patient-uuid-123',
    description: 'Patient ID',
  })
  @IsUUID('4', { message: 'Patient ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Patient ID is required' })
  patientId!: string;

  @ApiProperty({
    example: '2024-01-15T10:00:00.000Z',
    description: 'Start date for the recurring series',
  })
  @IsDateString({}, { message: 'Start date must be a valid date string' })
  @IsNotEmpty({ message: 'Start date is required' })
  startDate!: string;

  @ApiPropertyOptional({
    example: '2024-06-15T10:00:00.000Z',
    description: 'End date for the recurring series (optional)',
  })
  @IsOptional()
  @IsDateString({}, { message: 'End date must be a valid date string' })
  endDate?: string;
}

/**
 * Data Transfer Object for updating a recurring appointment series
 * @class UpdateRecurringSeriesDto
 */
export class UpdateRecurringSeriesDto {
  @ApiPropertyOptional({
    example: '2024-06-15T10:00:00.000Z',
    description: 'New end date for the series',
  })
  @IsOptional()
  @IsDateString({}, { message: 'End date must be a valid date string' })
  endDate?: string;

  @ApiPropertyOptional({
    example: 'active',
    description: 'Series status',
    enum: ['active', 'paused', 'cancelled'],
  })
  @IsOptional()
  @IsString({ message: 'Status must be a string' })
  status?: 'active' | 'paused' | 'cancelled';
}

/**
 * Data Transfer Object for recurring series response
 * @class RecurringSeriesResponseDto
 */
export class RecurringSeriesResponseDto {
  @ApiProperty({ description: 'Series ID' })
  id!: string;

  @ApiProperty({ description: 'Template ID' })
  templateId!: string;

  @ApiProperty({ description: 'Patient ID' })
  patientId!: string;

  @ApiProperty({ description: 'Clinic ID' })
  clinicId!: string;

  @ApiProperty({ description: 'Start date' })
  startDate!: Date;

  @ApiPropertyOptional({ description: 'End date' })
  endDate?: Date;

  @ApiProperty({ description: 'Series status' })
  status!: string;

  @ApiProperty({ description: 'Appointments in series', type: [AppointmentResponseDto] })
  appointments!: AppointmentResponseDto[];

  @ApiProperty({ description: 'Total appointments' })
  totalAppointments!: number;

  @ApiProperty({ description: 'Created at' })
  createdAt!: Date;

  @ApiProperty({ description: 'Updated at' })
  updatedAt!: Date;
}

/**
 * Data Transfer Object for updating a follow-up plan
 * @class UpdateFollowUpPlanDto
 */
export class UpdateFollowUpPlanDto {
  @ApiPropertyOptional({
    example: '2024-02-20T10:00:00.000Z',
    description: 'New scheduled date for follow-up',
  })
  @IsOptional()
  @IsDateString({}, { message: 'Scheduled date must be a valid date string' })
  scheduledFor?: string;

  @ApiPropertyOptional({
    description: 'Follow-up type',
    enum: ['routine', 'urgent', 'specialist', 'therapy', 'surgery'],
  })
  @IsOptional()
  @IsString({ message: 'Follow-up type must be a string' })
  followUpType?: 'routine' | 'urgent' | 'specialist' | 'therapy' | 'surgery';

  @ApiPropertyOptional({ description: 'Follow-up instructions' })
  @IsOptional()
  @IsString({ message: 'Instructions must be a string' })
  instructions?: string;

  @ApiPropertyOptional({
    description: 'Follow-up priority',
    enum: ['low', 'normal', 'high', 'urgent'],
  })
  @IsOptional()
  @IsString({ message: 'Priority must be a string' })
  priority?: 'low' | 'normal' | 'high' | 'urgent';

  @ApiPropertyOptional({
    description: 'Medications',
    type: [String],
  })
  @IsOptional()
  @IsArray({ message: 'Medications must be an array' })
  @IsString({ each: true, message: 'Each medication must be a string' })
  medications?: string[];

  @ApiPropertyOptional({
    description: 'Tests',
    type: [String],
  })
  @IsOptional()
  @IsArray({ message: 'Tests must be an array' })
  @IsString({ each: true, message: 'Each test must be a string' })
  tests?: string[];

  @ApiPropertyOptional({
    description: 'Restrictions',
    type: [String],
  })
  @IsOptional()
  @IsArray({ message: 'Restrictions must be an array' })
  @IsString({ each: true, message: 'Each restriction must be a string' })
  restrictions?: string[];

  @ApiPropertyOptional({ description: 'Notes' })
  @IsOptional()
  @IsString({ message: 'Notes must be a string' })
  notes?: string;

  @ApiPropertyOptional({
    description: 'Status',
    enum: ['scheduled', 'completed', 'cancelled', 'overdue'],
  })
  @IsOptional()
  @IsString({ message: 'Status must be a string' })
  status?: 'scheduled' | 'completed' | 'cancelled' | 'overdue';
}

/**
 * Appointment List Response DTO
 * @class AppointmentListResponseDto
 * @description Response DTO for list of appointments with pagination
 */
export class AppointmentListResponseDto {
  @ApiProperty({
    description: 'List of appointments',
    type: [AppointmentResponseDto],
  })
  @IsArray({ message: 'Appointments must be an array' })
  @ValidateNested({ each: true })
  @Type(() => AppointmentResponseDto)
  appointments!: AppointmentResponseDto[];

  @ApiProperty({
    description: 'Pagination metadata',
    example: { page: 1, limit: 20, total: 100, totalPages: 5 },
  })
  pagination!: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

/**
 * Doctor Availability Response DTO
 * @class DoctorAvailabilityResponseDto
 * @description Response DTO for doctor availability information
 */
export class DoctorAvailabilityResponseDto {
  @ApiProperty({
    example: 'doctor-uuid-123',
    description: 'Doctor ID',
  })
  @IsUUID('4', { message: 'Doctor ID must be a valid UUID' })
  doctorId!: string;

  @ApiProperty({
    example: '2024-01-15',
    description: 'Date for availability check',
  })
  @IsDateString({}, { message: 'Date must be a valid date string' })
  date!: string;

  @ApiProperty({
    example: true,
    description: 'Whether doctor has available slots',
  })
  @IsBoolean({ message: 'Available must be a boolean' })
  available!: boolean;

  @ApiProperty({
    example: ['09:00', '10:00', '11:00'],
    description: 'List of available time slots',
    type: [String],
  })
  @IsArray({ message: 'Available slots must be an array' })
  @IsString({ each: true, message: 'Each slot must be a string' })
  availableSlots!: string[];

  @ApiProperty({
    example: ['14:00', '15:00'],
    description: 'List of booked time slots',
    type: [String],
  })
  @IsArray({ message: 'Booked slots must be an array' })
  @IsString({ each: true, message: 'Each slot must be a string' })
  bookedSlots!: string[];

  @ApiProperty({
    example: { start: '09:00', end: '18:00' },
    description: 'Working hours',
  })
  workingHours!: {
    start: string;
    end: string;
  };

  @ApiProperty({
    example: 'Doctor has available slots',
    description: 'Status message',
  })
  @IsString({ message: 'Message must be a string' })
  message!: string;
}
