import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID, IsEnum, IsNumber, IsDateString } from 'class-validator';

// Define enums
export enum AppointmentType {
  IN_PERSON = 'IN_PERSON',
  VIDEO_CALL = 'VIDEO_CALL',
  HOME_VISIT = 'HOME_VISIT'
}

export enum AppointmentStatus {
  PENDING = 'PENDING',
  SCHEDULED = 'SCHEDULED',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
  NO_SHOW = 'NO_SHOW'
}

// Response DTOs for better API documentation
export class AppointmentResponseDto {
  @ApiProperty({ description: 'Appointment ID' })
  id: string;

  @ApiProperty({ description: 'Appointment type' })
  type: string;

  @ApiProperty({ description: 'Appointment date' })
  date: Date;

  @ApiProperty({ description: 'Appointment time' })
  time: string;

  @ApiProperty({ description: 'Appointment duration in minutes' })
  duration: number;

  @ApiProperty({ description: 'Appointment status' })
  status: string;

  @ApiProperty({ description: 'Doctor information' })
  doctor: any;

  @ApiProperty({ description: 'Patient information' })
  patient: any;

  @ApiProperty({ description: 'Location information' })
  location: any;

  @ApiProperty({ description: 'Appointment notes', required: false })
  notes?: string;

  @ApiProperty({ description: 'Created at timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Updated at timestamp' })
  updatedAt: Date;
}

export class AppointmentListResponseDto {
  @ApiProperty({ description: 'List of appointments', type: [AppointmentResponseDto] })
  appointments: AppointmentResponseDto[];

  @ApiProperty({ description: 'Total count of appointments' })
  total: number;

  @ApiProperty({ description: 'Current page number' })
  page: number;

  @ApiProperty({ description: 'Number of items per page' })
  limit: number;

  @ApiProperty({ description: 'Total number of pages' })
  totalPages: number;
}

export class DoctorAvailabilityResponseDto {
  @ApiProperty({ description: 'Whether doctor is available' })
  available: boolean;

  @ApiProperty({ description: 'Available time slots', type: [String] })
  availableSlots: string[];

  @ApiProperty({ description: 'Booked time slots', type: [String] })
  bookedSlots: string[];

  @ApiProperty({ description: 'Working hours for the day' })
  workingHours: any;

  @ApiProperty({ description: 'Message about availability', required: false })
  message?: string;
}

// Basic type definitions
export interface Doctor {
  id: string;
  userId: string;
  specialization: string;
  experience: number;
  qualification?: string;
  consultationFee?: number;
  rating?: number;
}

export interface Patient {
  id: string;
  userId: string;
  bloodGroup?: string;
  emergencyContact?: string;
  insuranceProvider?: string;
  insuranceNumber?: string;
}

export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  name: string;
  role: string;
  isVerified: boolean;
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
  doctorId: string;
  patientId: string;
  locationId: string;
  clinicId: string;
  date: Date;
  time: string;
  duration: number;
  status: AppointmentStatus;
  notes?: string;
  userId: string;
  therapyId?: string;
  startedAt?: Date;
  checkedInAt?: Date;
  completedAt?: Date;
}

export type AppointmentWithRelations = Appointment & {
  doctor: DoctorWithUser;
  patient: PatientWithUser;
};

export class CreateAppointmentDto {
  @ApiProperty({ description: 'Doctor ID', example: 'doctor-uuid' })
  @IsUUID()
  doctorId: string;

  @ApiProperty({ description: 'Location ID', example: 'location-uuid' })
  @IsUUID()
  locationId: string;

  @ApiProperty({ description: 'Date of the appointment (YYYY-MM-DD)', example: '2024-06-01' })
  @IsDateString()
  date: string;

  @ApiProperty({ description: 'Time of the appointment (HH:mm)', example: '10:00' })
  @IsString()
  time: string;

  @ApiProperty({ description: 'Duration in minutes', example: 30 })
  @IsNumber()
  duration: number;

  @ApiProperty({ description: 'Type of appointment', enum: AppointmentType, example: 'IN_PERSON' })
  @IsEnum(AppointmentType)
  type: AppointmentType;

  @ApiProperty({ description: 'Notes for the appointment', required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ description: 'Therapy ID', example: 'therapy-uuid', required: false })
  @IsOptional()
  @IsUUID()
  therapyId?: string;
}

export class UpdateAppointmentDto {
  @ApiProperty({ description: 'Date of the appointment (YYYY-MM-DD)', required: false })
  @IsOptional()
  @IsDateString()
  date?: string;

  @ApiProperty({ description: 'Time of the appointment (HH:mm)', required: false })
  @IsOptional()
  @IsString()
  time?: string;

  @ApiProperty({ description: 'Duration in minutes', required: false })
  @IsOptional()
  @IsNumber()
  duration?: number;

  @ApiProperty({ description: 'Status of the appointment', enum: AppointmentStatus, required: false })
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @ApiProperty({ description: 'Notes for the appointment', required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ description: 'Therapy ID', example: 'therapy-uuid', required: false })
  @IsOptional()
  @IsUUID()
  therapyId?: string;

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

export class ProcessCheckInDto {
  @ApiProperty({ description: 'Appointment ID to check in' })
  @IsUUID()
  appointmentId: string;
}

export class ReorderQueueDto {
  @ApiProperty({ description: 'Ordered list of appointment IDs' , type: [String]})
  appointmentOrder: string[];
}

export class VerifyAppointmentQRDto {
  @ApiProperty({ description: 'QR data string' })
  @IsString()
  qrData: string;

  @ApiProperty({ description: 'Location ID' })
  @IsUUID()
  locationId: string;
}

export class CompleteAppointmentDto {
  @ApiProperty({ description: 'Doctor ID' })
  @IsUUID()
  doctorId: string;
}

export class StartConsultationDto {
  @ApiProperty({ description: 'Doctor ID' })
  @IsUUID()
  doctorId: string;
} 