import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsEnum, IsUUID, IsDateString, IsNotEmpty, IsArray, ValidateNested, IsNumber, Min, Max, IsBoolean } from 'class-validator';
import { Transform, Type } from 'class-transformer';

// Appointment status enum
export enum AppointmentStatus {
  SCHEDULED = 'SCHEDULED',
  CONFIRMED = 'CONFIRMED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  NO_SHOW = 'NO_SHOW',
  RESCHEDULED = 'RESCHEDULED'
}

// Appointment type enum
export enum AppointmentType {
  CONSULTATION = 'CONSULTATION',
  FOLLOW_UP = 'FOLLOW_UP',
  EMERGENCY = 'EMERGENCY',
  ROUTINE_CHECKUP = 'ROUTINE_CHECKUP',
  SPECIALIST_VISIT = 'SPECIALIST_VISIT',
  LAB_TEST = 'LAB_TEST',
  IMAGING = 'IMAGING',
  SURGERY = 'SURGERY'
}

// Priority enum
export enum AppointmentPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT'
}

/**
 * Base appointment DTO following NestJS best practices
 * Based on AI rules: @nestjs-specific.md and @coding-standards.md
 */
export class CreateAppointmentDto {
  @ApiProperty({
    example: 'patient-uuid-123',
    description: 'Patient ID for the appointment'
  })
  @IsUUID('4', { message: 'Patient ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Patient ID is required' })
  patientId: string;

  @ApiProperty({
    example: 'doctor-uuid-123',
    description: 'Doctor ID for the appointment'
  })
  @IsUUID('4', { message: 'Doctor ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Doctor ID is required' })
  doctorId: string;

  @ApiProperty({
    example: 'clinic-uuid-123',
    description: 'Clinic ID where appointment will take place'
  })
  @IsUUID('4', { message: 'Clinic ID must be a valid UUID' })
  @IsNotEmpty({ message: 'Clinic ID is required' })
  clinicId: string;

  @ApiProperty({
    example: '2024-01-15T10:00:00.000Z',
    description: 'Appointment date and time',
    format: 'date-time'
  })
  @IsDateString({}, { message: 'Appointment date must be a valid date string' })
  @IsNotEmpty({ message: 'Appointment date is required' })
  appointmentDate: string;

  @ApiProperty({
    example: 30,
    description: 'Appointment duration in minutes',
    minimum: 15,
    maximum: 480
  })
  @IsNumber({}, { message: 'Duration must be a number' })
  @Min(15, { message: 'Duration must be at least 15 minutes' })
  @Max(480, { message: 'Duration cannot exceed 8 hours' })
  duration: number;

  @ApiProperty({
    example: 'CONSULTATION',
    description: 'Type of appointment',
    enum: AppointmentType
  })
  @IsEnum(AppointmentType, { message: 'Appointment type must be a valid type' })
  @IsNotEmpty({ message: 'Appointment type is required' })
  type: AppointmentType;

  @ApiPropertyOptional({
    example: 'MEDIUM',
    description: 'Appointment priority level',
    enum: AppointmentPriority,
    default: AppointmentPriority.MEDIUM
  })
  @IsOptional()
  @IsEnum(AppointmentPriority, { message: 'Priority must be a valid priority level' })
  priority?: AppointmentPriority = AppointmentPriority.MEDIUM;

  @ApiPropertyOptional({
    example: 'Regular checkup appointment',
    description: 'Appointment notes or description'
  })
  @IsOptional()
  @IsString({ message: 'Notes must be a string' })
  @Transform(({ value }) => value?.trim())
  notes?: string;

  @ApiPropertyOptional({
    example: 'clinic-uuid-123',
    description: 'Studio ID for clinic domain appointments'
  })
  @IsOptional()
  @IsUUID('4', { message: 'Studio ID must be a valid UUID' })
  studioId?: string;

  @ApiPropertyOptional({
    example: 'healthcare',
    description: 'Application domain for multi-domain setup',
    enum: ['healthcare', 'clinic']
  })
  @IsOptional()
  @IsString({ message: 'App domain must be a string' })
  appDomain?: string;
}

/**
 * Appointment update DTO - all fields optional
 */
export class UpdateAppointmentDto {
  @ApiPropertyOptional({
    example: '2024-01-15T10:00:00.000Z',
    description: 'New appointment date and time'
  })
  @IsOptional()
  @IsDateString({}, { message: 'Appointment date must be a valid date string' })
  appointmentDate?: string;

  @ApiPropertyOptional({
    example: 45,
    description: 'New appointment duration in minutes'
  })
  @IsOptional()
  @IsNumber({}, { message: 'Duration must be a number' })
  @Min(15, { message: 'Duration must be at least 15 minutes' })
  @Max(480, { message: 'Duration cannot exceed 8 hours' })
  duration?: number;

  @ApiPropertyOptional({
    example: 'CONFIRMED',
    description: 'New appointment status'
  })
  @IsOptional()
  @IsEnum(AppointmentStatus, { message: 'Status must be a valid appointment status' })
  status?: AppointmentStatus;

  @ApiPropertyOptional({
    example: 'HIGH',
    description: 'New appointment priority level'
  })
  @IsOptional()
  @IsEnum(AppointmentPriority, { message: 'Priority must be a valid priority level' })
  priority?: AppointmentPriority;

  @ApiPropertyOptional({
    example: 'Updated appointment notes',
    description: 'New appointment notes or description'
  })
  @IsOptional()
  @IsString({ message: 'Notes must be a string' })
  @Transform(({ value }) => value?.trim())
  notes?: string;

  @ApiPropertyOptional({
    example: 'doctor-uuid-456',
    description: 'New doctor ID for the appointment'
  })
  @IsOptional()
  @IsUUID('4', { message: 'Doctor ID must be a valid UUID' })
  doctorId?: string;

  @ApiPropertyOptional({
    example: 'clinic-uuid-456',
    description: 'New clinic ID for the appointment'
  })
  @IsOptional()
  @IsUUID('4', { message: 'Clinic ID must be a valid UUID' })
  clinicId?: string;
}

/**
 * Appointment response DTO - excludes sensitive information
 */
export class AppointmentResponseDto {
  @ApiProperty({
    example: 'appointment-uuid-123',
    description: 'Unique appointment identifier'
  })
  @IsUUID('4', { message: 'Appointment ID must be a valid UUID' })
  id: string;

  @ApiProperty({
    example: 'patient-uuid-123',
    description: 'Patient ID for the appointment'
  })
  @IsUUID('4', { message: 'Patient ID must be a valid UUID' })
  patientId: string;

  @ApiProperty({
    example: 'doctor-uuid-123',
    description: 'Doctor ID for the appointment'
  })
  @IsUUID('4', { message: 'Doctor ID must be a valid UUID' })
  doctorId: string;

  @ApiProperty({
    example: 'clinic-uuid-123',
    description: 'Clinic ID where appointment takes place'
  })
  @IsUUID('4', { message: 'Clinic ID must be a valid UUID' })
  clinicId: string;

  @ApiProperty({
    example: '2024-01-15T10:00:00.000Z',
    description: 'Appointment date and time'
  })
  @IsDateString({}, { message: 'Appointment date must be a valid date string' })
  appointmentDate: string;

  @ApiProperty({
    example: 30,
    description: 'Appointment duration in minutes'
  })
  @IsNumber({}, { message: 'Duration must be a number' })
  duration: number;

  @ApiProperty({
    example: 'CONSULTATION',
    description: 'Type of appointment'
  })
  @IsEnum(AppointmentType, { message: 'Appointment type must be a valid type' })
  type: AppointmentType;

  @ApiProperty({
    example: 'SCHEDULED',
    description: 'Current appointment status'
  })
  @IsEnum(AppointmentStatus, { message: 'Status must be a valid appointment status' })
  status: AppointmentStatus;

  @ApiProperty({
    example: 'MEDIUM',
    description: 'Appointment priority level'
  })
  @IsEnum(AppointmentPriority, { message: 'Priority must be a valid priority level' })
  priority: AppointmentPriority;

  @ApiPropertyOptional({
    example: 'Regular checkup appointment',
    description: 'Appointment notes or description'
  })
  @IsOptional()
  @IsString({ message: 'Notes must be a string' })
  notes?: string;

  @ApiProperty({
    example: '2024-01-01T00:00:00.000Z',
    description: 'Appointment creation timestamp'
  })
  @IsDateString({}, { message: 'Created at must be a valid date string' })
  createdAt: string;

  @ApiProperty({
    example: '2024-01-01T00:00:00.000Z',
    description: 'Appointment last update timestamp'
  })
  @IsDateString({}, { message: 'Updated at must be a valid date string' })
  updatedAt: string;

  @ApiPropertyOptional({
    example: 'clinic-uuid-123',
    description: 'Studio ID for clinic domain appointments'
  })
  @IsOptional()
  @IsUUID('4', { message: 'Studio ID must be a valid UUID' })
  studioId?: string;

  @ApiPropertyOptional({
    example: 'healthcare',
    description: 'Application domain for multi-domain setup'
  })
  @IsOptional()
  @IsString({ message: 'App domain must be a string' })
  appDomain?: string;
}

/**
 * Appointment search/filter DTO
 */
export class AppointmentSearchDto {
  @ApiPropertyOptional({
    example: '2024-01-01',
    description: 'Start date for appointment search (YYYY-MM-DD)'
  })
  @IsOptional()
  @IsDateString({}, { message: 'Start date must be a valid date string' })
  startDate?: string;

  @ApiPropertyOptional({
    example: '2024-01-31',
    description: 'End date for appointment search (YYYY-MM-DD)'
  })
  @IsOptional()
  @IsDateString({}, { message: 'End date must be a valid date string' })
  endDate?: string;

  @ApiPropertyOptional({
    example: 'patient-uuid-123',
    description: 'Filter by patient ID'
  })
  @IsOptional()
  @IsUUID('4', { message: 'Patient ID must be a valid UUID' })
  patientId?: string;

  @ApiPropertyOptional({
    example: 'doctor-uuid-123',
    description: 'Filter by doctor ID'
  })
  @IsOptional()
  @IsUUID('4', { message: 'Doctor ID must be a valid UUID' })
  doctorId?: string;

  @ApiPropertyOptional({
    example: 'clinic-uuid-123',
    description: 'Filter by clinic ID'
  })
  @IsOptional()
  @IsUUID('4', { message: 'Clinic ID must be a valid UUID' })
  clinicId?: string;

  @ApiPropertyOptional({
    example: 'SCHEDULED',
    description: 'Filter by appointment status',
    enum: AppointmentStatus
  })
  @IsOptional()
  @IsEnum(AppointmentStatus, { message: 'Status must be a valid appointment status' })
  status?: AppointmentStatus;

  @ApiPropertyOptional({
    example: 'CONSULTATION',
    description: 'Filter by appointment type',
    enum: AppointmentType
  })
  @IsOptional()
  @IsEnum(AppointmentType, { message: 'Type must be a valid appointment type' })
  type?: AppointmentType;

  @ApiPropertyOptional({
    example: 'MEDIUM',
    description: 'Filter by appointment priority',
    enum: AppointmentPriority
  })
  @IsOptional()
  @IsEnum(AppointmentPriority, { message: 'Priority must be a valid priority level' })
  priority?: AppointmentPriority;

  @ApiPropertyOptional({
    example: 'healthcare',
    description: 'Filter by application domain',
    enum: ['healthcare', 'clinic']
  })
  @IsOptional()
  @IsString({ message: 'App domain must be a string' })
  appDomain?: string;
}

/**
 * Bulk appointment creation DTO
 */
export class BulkCreateAppointmentsDto {
  @ApiProperty({
    description: 'Array of appointments to create',
    type: [CreateAppointmentDto]
  })
  @IsArray({ message: 'Appointments must be an array' })
  @ValidateNested({ each: true })
  @Type(() => CreateAppointmentDto)
  appointments: CreateAppointmentDto[];

  @ApiPropertyOptional({
    example: true,
    description: 'Whether to send notifications for created appointments',
    default: true
  })
  @IsOptional()
  @IsBoolean({ message: 'Send notifications must be a boolean' })
  sendNotifications?: boolean = true;
}

/**
 * Appointment cancellation DTO
 */
export class CancelAppointmentDto {
  @ApiProperty({
    example: 'Patient requested cancellation',
    description: 'Reason for appointment cancellation'
  })
  @IsString({ message: 'Cancellation reason must be a string' })
  @IsNotEmpty({ message: 'Cancellation reason is required' })
  @Transform(({ value }) => value?.trim())
  reason: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether to send cancellation notification',
    default: true
  })
  @IsOptional()
  @IsBoolean({ message: 'Send notification must be a boolean' })
  sendNotification?: boolean = true;
}

/**
 * Appointment reschedule DTO
 */
export class RescheduleAppointmentDto {
  @ApiProperty({
    example: '2024-01-16T10:00:00.000Z',
    description: 'New appointment date and time'
  })
  @IsDateString({}, { message: 'New appointment date must be a valid date string' })
  @IsNotEmpty({ message: 'New appointment date is required' })
  newAppointmentDate: string;

  @ApiPropertyOptional({
    example: 'Patient requested reschedule',
    description: 'Reason for rescheduling'
  })
  @IsOptional()
  @IsString({ message: 'Reschedule reason must be a string' })
  @Transform(({ value }) => value?.trim())
  reason?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether to send reschedule notification',
    default: true
  })
  @IsOptional()
  @IsBoolean({ message: 'Send notification must be a boolean' })
  sendNotification?: boolean = true;
}
