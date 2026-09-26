/**
 * Patient Visit (OPD registration / encounter) DTOs
 * @module PatientVisitDTOs
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum SpecialCaseFlag {
  MINOR = 'MINOR',
  PHYSICAL_HANDICAP = 'PHYSICAL_HANDICAP',
  PREGNANT_OR_SENIOR_CITIZEN = 'PREGNANT_OR_SENIOR_CITIZEN',
}

export class CollectVisitFeeDto {
  @ApiPropertyOptional({ example: 'CASH', enum: ['CASH', 'UPI', 'CARD', 'NET_BANKING'] })
  @IsIn(['CASH', 'UPI', 'CARD', 'NET_BANKING'])
  method!: 'CASH' | 'UPI' | 'CARD' | 'NET_BANKING';

  @ApiPropertyOptional({ example: 'txn-uuid-123' })
  @IsOptional()
  @IsString()
  transactionId?: string;

  @ApiPropertyOptional({ example: 'Collected at reception desk' })
  @IsOptional()
  @IsString()
  note?: string;
}

export class CreatePatientVisitDto {
  @ApiPropertyOptional({
    example: 'patient-uuid',
    description: 'Patient.id. Either this or patientUserId is required.',
  })
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiPropertyOptional({
    example: 'user-uuid',
    description:
      'User.id of the patient — accepted so a visit can be opened right after quick registration, which only returns the User.id.',
  })
  @IsOptional()
  @IsString()
  patientUserId?: string;

  @ApiPropertyOptional({
    example: 'doctor-uuid',
    description: 'Doctor.id assigned to this visit. Defaults to the registering doctor.',
  })
  @IsOptional()
  @IsString()
  doctorId?: string;

  @ApiPropertyOptional({ example: '2026-09-25T09:30:00.000Z' })
  @IsOptional()
  @IsDateString()
  registrationDate?: string;

  @ApiPropertyOptional({ enum: SpecialCaseFlag, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(SpecialCaseFlag, { each: true })
  specialCaseFlags?: SpecialCaseFlag[];

  @ApiPropertyOptional({ example: 'P1234567', description: 'Passport / foreign ID' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  internationalId?: string;

  @ApiPropertyOptional({ example: 'Recurring lower back pain for 3 months' })
  @IsOptional()
  @IsString()
  presentIllness?: string;

  @ApiPropertyOptional({ example: 'Pain radiating to left leg, worse in mornings' })
  @IsOptional()
  @IsString()
  presentComplaints?: string;

  @ApiPropertyOptional({ example: 'Hypertension since 2019' })
  @IsOptional()
  @IsString()
  knownCaseOf?: string;

  @ApiPropertyOptional({
    example: 500,
    description:
      'Explicit consultation fee for this visit. Falls back to Doctor.consultationFee, then the clinic billingSettings default, when omitted.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  consultationFee?: number;

  @ApiPropertyOptional({ example: 50, description: 'Discount off the resolved consultation fee' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  feeDiscount?: number;

  @ApiPropertyOptional({
    example: false,
    description: 'Waive the consultation fee entirely (invoice created PAID at ₹0)',
  })
  @IsOptional()
  @IsBoolean()
  waiveFee?: boolean;

  @ApiPropertyOptional({
    description: 'Collect the consultation fee immediately at registration',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CollectVisitFeeDto)
  collectFee?: CollectVisitFeeDto;

  @ApiPropertyOptional({
    example: false,
    description:
      'Skip creating a consultation invoice for this visit entirely (e.g. free follow-up)',
  })
  @IsOptional()
  @IsBoolean()
  skipConsultationInvoice?: boolean;
}

export class UpdatePatientVisitDto {
  @ApiPropertyOptional({ example: 'doctor-uuid' })
  @IsOptional()
  @IsString()
  doctorId?: string;

  @ApiPropertyOptional({ enum: SpecialCaseFlag, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(SpecialCaseFlag, { each: true })
  specialCaseFlags?: SpecialCaseFlag[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  internationalId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  presentIllness?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  presentComplaints?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  knownCaseOf?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  pastHistoryNotes?: string;

  @ApiPropertyOptional({
    example: { smoking: 'Moderate', tea: 'Heavy' },
    description: 'Habit key -> selected option label',
  })
  @IsOptional()
  @IsObject()
  habits?: Record<string, string>;

  @ApiPropertyOptional({ example: 'सम्यक्' })
  @IsOptional()
  @IsString()
  nidra?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nidraNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  foodAllergyNotes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  drugAllergyNotes?: string;
}

/**
 * General Examination + Physical Measurement snapshot for one visit.
 * All values in canonical units (cm / kg / °C); unit toggles are a UI concern.
 */
export class UpsertVisitVitalsExaminationDto {
  @ApiPropertyOptional({ example: 170 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  heightCm?: number;

  @ApiPropertyOptional({ example: 68.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  weightKg?: number;

  @ApiPropertyOptional({ example: 37.2 })
  @IsOptional()
  @IsNumber()
  temperatureC?: number;

  @ApiPropertyOptional({ example: 72 })
  @IsOptional()
  @IsInt()
  @Min(0)
  pulse?: number;

  @ApiPropertyOptional({ example: 120 })
  @IsOptional()
  @IsInt()
  @Min(0)
  bpSystolic?: number;

  @ApiPropertyOptional({ example: 80 })
  @IsOptional()
  @IsInt()
  @Min(0)
  bpDiastolic?: number;

  @ApiPropertyOptional({ example: 16, description: 'Respiratory rate (breaths per minute)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  rr?: number;

  @ApiPropertyOptional({ example: 4, description: '0-10' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  painScore?: number;

  @ApiPropertyOptional({ example: 95, description: 'Fasting blood sugar (mg/dL)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  fbs?: number;

  @ApiPropertyOptional({ example: 140, description: 'Post-prandial blood sugar (mg/dL)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  ppbs?: number;

  @ApiPropertyOptional({ example: 110, description: 'Random/plain blood sugar (mg/dL)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  pbs?: number;

  @ApiPropertyOptional({ example: 98 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  spo2?: number;

  @ApiPropertyOptional({ example: 'Sound' })
  @IsOptional()
  @IsString()
  sleep?: string;

  @ApiPropertyOptional({ example: 'Regular' })
  @IsOptional()
  @IsString()
  bowel?: string;

  @ApiPropertyOptional({ example: 'Good' })
  @IsOptional()
  @IsString()
  appetite?: string;

  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) neck?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) chest?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) upperAbs?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) waist?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) lowerAbs?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) hips?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) thighLeft?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) thighRight?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) calfLeft?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) calfRight?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) upperArmLeft?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) upperArmRight?: number;
}

export interface PatientVisitResponse {
  id: string;
  opdNumber: string;
  registrationDate: string;
  patientId: string;
  clinicId: string;
  doctorId: string | null;
  specialCaseFlags: SpecialCaseFlag[];
  internationalId: string | null;
  presentIllness: string | null;
  presentComplaints: string | null;
  knownCaseOf: string | null;
  pastHistoryNotes: string | null;
  habits: Record<string, string> | null;
  nidra: string | null;
  nidraNotes: string | null;
  foodAllergyNotes: string | null;
  drugAllergyNotes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Consultation invoice created for this visit (billType CONSULTATION),
   * when one could be created — null when billing was skipped (e.g. no
   * fee configured and `skipConsultationInvoice` not set, or the billing
   * write failed; registration itself never fails because of billing).
   */
  consultationInvoice?: {
    id: string;
    invoiceNumber: string;
    totalAmount: number;
    status: string;
    paidAmount: number;
  } | null;
}

export interface VisitVitalsExaminationResponse {
  id: string;
  visitId: string;
  heightCm: number | null;
  weightKg: number | null;
  bmi: number | null;
  temperatureC: number | null;
  pulse: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  rr: number | null;
  painScore: number | null;
  fbs: number | null;
  ppbs: number | null;
  pbs: number | null;
  spo2: number | null;
  sleep: string | null;
  bowel: string | null;
  appetite: string | null;
  neck: number | null;
  chest: number | null;
  upperAbs: number | null;
  waist: number | null;
  lowerAbs: number | null;
  hips: number | null;
  thighLeft: number | null;
  thighRight: number | null;
  calfLeft: number | null;
  calfRight: number | null;
  upperArmLeft: number | null;
  upperArmRight: number | null;
  recordedBy: string | null;
  createdAt: string;
  updatedAt: string;
}
