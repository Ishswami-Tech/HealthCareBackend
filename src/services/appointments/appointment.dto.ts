import { Appointment, Doctor, Patient, User, Prisma } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';

export type DoctorWithUser = Doctor & {
  user: User;
};

export type PatientWithUser = Patient & {
  user: User;
};

export type AppointmentWithRelations = Appointment & {
  doctor: DoctorWithUser;
  patient: PatientWithUser;
};

export class CreateAppointmentDto {
  @ApiProperty({ description: 'Doctor ID', example: 'doctor-uuid' })
  doctorId: string;

  @ApiProperty({ description: 'Location ID', example: 'location-uuid' })
  locationId: string;

  @ApiProperty({ description: 'Date of the appointment (YYYY-MM-DD)', example: '2024-06-01' })
  date: string;

  @ApiProperty({ description: 'Time of the appointment (HH:mm)', example: '10:00' })
  time: string;

  @ApiProperty({ description: 'Duration in minutes', example: 30 })
  duration: number;

  @ApiProperty({ description: 'Type of appointment', example: 'CONSULTATION' })
  type: string;

  @ApiProperty({ description: 'Notes for the appointment', required: false })
  notes?: string;
}

export class UpdateAppointmentDto {
  @ApiProperty({ description: 'Date of the appointment (YYYY-MM-DD)', required: false })
  date?: string;

  @ApiProperty({ description: 'Time of the appointment (HH:mm)', required: false })
  time?: string;

  @ApiProperty({ description: 'Duration in minutes', required: false })
  duration?: number;

  @ApiProperty({ description: 'Status of the appointment', required: false })
  status?: string;

  @ApiProperty({ description: 'Notes for the appointment', required: false })
  notes?: string;
}

export class ProcessCheckInDto {
  @ApiProperty({ description: 'Appointment ID to check in' })
  appointmentId: string;
}

export class ReorderQueueDto {
  @ApiProperty({ description: 'Ordered list of appointment IDs' , type: [String]})
  appointmentOrder: string[];
}

export class VerifyAppointmentQRDto {
  @ApiProperty({ description: 'QR data string' })
  qrData: string;

  @ApiProperty({ description: 'Location ID' })
  locationId: string;
}

export class CompleteAppointmentDto {
  @ApiProperty({ description: 'Doctor ID' })
  doctorId: string;
}

export class StartConsultationDto {
  @ApiProperty({ description: 'Doctor ID' })
  doctorId: string;
} 