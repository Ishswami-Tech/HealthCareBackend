/**
 * EHR DTOs
 * @module EHRDTOs
 * @description Centralized Electronic Health Record Data Transfer Objects
 */

import { IsString, IsOptional, IsDateString } from 'class-validator';
import { IsClinicId } from '@core/decorators/clinic-id.validator';
import type {
  MedicalHistoryResponse,
  LabReportResponse,
  RadiologyReportResponse,
  SurgicalRecordResponse,
  VitalResponse,
  AllergyResponse,
  MedicationResponse,
  ImmunizationResponse,
  FamilyHistoryResponse,
  LifestyleAssessmentResponse,
} from '@core/types/ehr.types';

// Medical History DTOs
export class CreateMedicalHistoryDto {
  @IsString()
  userId!: string;

  @IsOptional()
  @IsClinicId({ message: 'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001)' })
  clinicId?: string;

  @IsString()
  condition!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsDateString()
  date!: string;
}

export class UpdateMedicalHistoryDto {
  @IsOptional()
  @IsString()
  condition?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsDateString()
  date?: string;
}

// Lab Report DTOs
export class CreateLabReportDto {
  @IsString()
  userId!: string;

  @IsOptional()
  @IsClinicId({ message: 'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001)' })
  clinicId?: string;

  @IsString()
  testName!: string;

  @IsString()
  result!: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  normalRange?: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  doctorId?: string;

  @IsOptional()
  @IsString()
  appointmentId?: string;
}

export class UpdateLabReportDto {
  @IsOptional()
  @IsString()
  testName?: string;

  @IsOptional()
  @IsString()
  result?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  normalRange?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

// Radiology Report DTOs
export class CreateRadiologyReportDto {
  @IsString()
  userId!: string;

  @IsString()
  imageType!: string;

  @IsString()
  findings!: string;

  @IsString()
  conclusion!: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  recommendations?: string;

  @IsOptional()
  @IsString({ each: true })
  images?: string[];

  @IsOptional()
  @IsString()
  doctorId?: string;

  @IsOptional()
  @IsString()
  appointmentId?: string;
}

export class UpdateRadiologyReportDto {
  @IsOptional()
  @IsString()
  imageType?: string;

  @IsOptional()
  @IsString()
  findings?: string;

  @IsOptional()
  @IsString()
  conclusion?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  recommendations?: string;

  @IsOptional()
  @IsString({ each: true })
  images?: string[];
}

// Surgical Record DTOs
export class CreateSurgicalRecordDto {
  @IsString()
  userId!: string;

  @IsString()
  surgeryName!: string;

  @IsString()
  surgeon!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  anesthesia?: string;

  @IsOptional()
  @IsString()
  complications?: string;

  @IsOptional()
  @IsString()
  outcome?: string;

  @IsOptional()
  @IsString()
  doctorId?: string;
}

export class UpdateSurgicalRecordDto {
  @IsOptional()
  @IsString()
  surgeryName?: string;

  @IsOptional()
  @IsString()
  surgeon?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  anesthesia?: string;

  @IsOptional()
  @IsString()
  complications?: string;

  @IsOptional()
  @IsString()
  outcome?: string;
}

// Vital DTOs
export class CreateVitalDto {
  @IsString()
  userId!: string;

  @IsString()
  type!: string;

  @IsString()
  value!: string;

  @IsDateString()
  recordedAt!: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  recordedBy?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateVitalDto {
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  value?: string;

  @IsOptional()
  @IsDateString()
  recordedAt?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

// Allergy DTOs
export class CreateAllergyDto {
  @IsString()
  userId!: string;

  @IsString()
  allergen!: string;

  @IsString()
  severity!: string;

  @IsString()
  reaction!: string;

  @IsDateString()
  diagnosedDate!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateAllergyDto {
  @IsOptional()
  @IsString()
  allergen?: string;

  @IsOptional()
  @IsString()
  severity?: string;

  @IsOptional()
  @IsString()
  reaction?: string;

  @IsOptional()
  @IsDateString()
  diagnosedDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

// Medication DTOs
export class CreateMedicationDto {
  @IsString()
  userId!: string;

  @IsString()
  name!: string;

  @IsString()
  dosage!: string;

  @IsString()
  frequency!: string;

  @IsDateString()
  startDate!: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsString()
  prescribedBy!: string;

  @IsOptional()
  @IsString()
  purpose?: string;

  @IsOptional()
  @IsString()
  sideEffects?: string;

  @IsOptional()
  @IsString()
  instructions?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class UpdateMedicationDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  dosage?: string;

  @IsOptional()
  @IsString()
  frequency?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  prescribedBy?: string;

  @IsOptional()
  @IsString()
  purpose?: string;

  @IsOptional()
  @IsString()
  sideEffects?: string;

  @IsOptional()
  @IsString()
  instructions?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

// Immunization DTOs
export class CreateImmunizationDto {
  @IsString()
  userId!: string;

  @IsString()
  vaccineName!: string;

  @IsDateString()
  dateAdministered!: string;

  @IsOptional()
  @IsDateString()
  nextDueDate?: string;

  @IsOptional()
  @IsString()
  batchNumber?: string;

  @IsOptional()
  @IsString()
  administrator?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  manufacturer?: string;
}

export class UpdateImmunizationDto {
  @IsOptional()
  @IsString()
  vaccineName?: string;

  @IsOptional()
  @IsDateString()
  dateAdministered?: string;

  @IsOptional()
  @IsDateString()
  nextDueDate?: string;

  @IsOptional()
  @IsString()
  batchNumber?: string;

  @IsOptional()
  @IsString()
  administrator?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

// Comprehensive Health Record DTOs
export class HealthRecordSummaryDto {
  medicalHistory?: MedicalHistoryResponse[];
  labReports?: LabReportResponse[];
  radiologyReports?: RadiologyReportResponse[];
  surgicalRecords?: SurgicalRecordResponse[];
  vitals?: VitalResponse[];
  allergies?: AllergyResponse[];
  medications?: MedicationResponse[];
  immunizations?: ImmunizationResponse[];
  familyHistory?: FamilyHistoryResponse[];
  lifestyleAssessment?: LifestyleAssessmentResponse;
}
