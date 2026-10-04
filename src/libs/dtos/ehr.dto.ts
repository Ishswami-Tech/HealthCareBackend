/**
 * EHR DTOs
 * @module EHRDTOs
 * @description Centralized Electronic Health Record Data Transfer Objects
 */

import {
  IsString,
  IsOptional,
  IsDateString,
  IsInt,
  IsIn,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  ArrayMaxSize,
  MaxLength,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsClinicId } from '@core/decorators/clinic-id.validator';
import type { TreatmentPlanDto } from './appointment.dto';
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
  PrescriptionHistoryResponse,
} from '@core/types/ehr.types';

/** Allowed `status` values of the records that expose one in their responses. */
export const MEDICAL_HISTORY_STATUSES = ['ACTIVE', 'CHRONIC', 'RESOLVED'] as const;
export const LAB_REPORT_STATUSES = ['PENDING', 'COMPLETED', 'REVIEWED'] as const;
export type MedicalHistoryStatus = (typeof MEDICAL_HISTORY_STATUSES)[number];
export type LabReportStatus = (typeof LAB_REPORT_STATUSES)[number];

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

  @IsOptional()
  @IsIn(MEDICAL_HISTORY_STATUSES)
  status?: MedicalHistoryStatus;

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
  @IsIn(MEDICAL_HISTORY_STATUSES)
  status?: MedicalHistoryStatus;

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
  @IsIn(LAB_REPORT_STATUSES)
  status?: LabReportStatus;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  doctorId?: string;

  @IsOptional()
  @IsString()
  appointmentId?: string;

  @IsOptional()
  @IsString()
  fileUrl?: string;

  @IsOptional()
  @IsString()
  fileKey?: string;
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
  @IsIn(LAB_REPORT_STATUSES)
  status?: LabReportStatus;

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

export class PrescriptionMedicationDto {
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

  @IsOptional()
  @IsString()
  instructions?: string;
}

export class CreatePrescriptionDto {
  @IsString()
  userId!: string;

  @IsOptional()
  @IsClinicId({ message: 'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001)' })
  clinicId?: string | undefined;

  @IsOptional()
  @IsString()
  doctorId?: string | undefined;

  @IsString()
  @IsOptional()
  notes?: string | undefined;

  @IsString()
  @IsOptional()
  diagnosis?: string | undefined;

  @IsOptional()
  treatmentPlan?: TreatmentPlanDto | undefined;

  @IsOptional()
  medications?: PrescriptionMedicationDto[] | undefined;
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

// Family History DTOs
export class CreateFamilyHistoryDto {
  @IsString()
  userId!: string;

  @IsOptional()
  @IsClinicId({ message: 'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001)' })
  clinicId?: string;

  @IsString()
  relation!: string;

  @IsString()
  condition!: string;

  @IsOptional()
  @IsString()
  duration?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  diagnosedAge?: number;

  @IsOptional()
  @IsString()
  doctorId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateFamilyHistoryDto {
  @IsOptional()
  @IsString()
  relation?: string;

  @IsOptional()
  @IsString()
  condition?: string;

  @IsOptional()
  @IsString()
  duration?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  diagnosedAge?: number;

  @IsOptional()
  @IsString()
  doctorId?: string;

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
  prescriptions?: PrescriptionHistoryResponse[];
}

export class EHRAISummaryDto {
  @IsString()
  patientId!: string;

  @IsString()
  summary!: string;

  @IsString()
  keyFindings!: string[];

  @IsString()
  recommendations!: string[];

  @IsDateString()
  generatedAt!: string;

  @IsString()
  modelName!: string;
}
export class BulkEHRImportDto {
  @IsString()
  userId!: string;

  @IsString()
  clinicId!: string;

  @IsOptional()
  @IsString()
  importId?: string;

  @IsOptional()
  records?: unknown[];
}

// ===== MEDICAL RECORDS DTOs =====

/** `HealthRecordType` values of the database enum. */
export const MEDICAL_RECORD_TYPES = [
  'LAB_TEST',
  'XRAY',
  'MRI',
  'PRESCRIPTION',
  'DIAGNOSIS_REPORT',
  'PULSE_DIAGNOSIS',
  'GENERAL_DOCUMENT',
] as const;
export type MedicalRecordType = (typeof MEDICAL_RECORD_TYPES)[number];

/** Names the web / mobile clients use for the two types a patient may create. */
export const MEDICAL_RECORD_TYPE_ALIASES = {
  LAB_REPORT: 'LAB_TEST',
  OTHER: 'GENERAL_DOCUMENT',
} as const satisfies Record<string, MedicalRecordType>;
export type MedicalRecordTypeInput = MedicalRecordType | keyof typeof MEDICAL_RECORD_TYPE_ALIASES;

/** The only types a PATIENT may create (their own lab results and other documents). */
export const PATIENT_MEDICAL_RECORD_TYPES: readonly MedicalRecordType[] = [
  'LAB_TEST',
  'GENERAL_DOCUMENT',
];

/** Maps a client type name (including LAB_REPORT / OTHER) to the database enum value. */
export function normaliseMedicalRecordType(raw: MedicalRecordTypeInput): MedicalRecordType {
  return raw in MEDICAL_RECORD_TYPE_ALIASES
    ? MEDICAL_RECORD_TYPE_ALIASES[raw as keyof typeof MEDICAL_RECORD_TYPE_ALIASES]
    : (raw as MedicalRecordType);
}

export class CreateMedicalRecordDto {
  @IsString()
  userId!: string;

  @IsOptional()
  @IsString()
  clinicId?: string;

  @IsIn([...MEDICAL_RECORD_TYPES, ...Object.keys(MEDICAL_RECORD_TYPE_ALIASES)])
  type!: MedicalRecordTypeInput;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  doctorId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  uploadedBy?: string;
}

export class UpdateMedicalRecordDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class MedicalRecordFilterDto {
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  uploadedBy?: string;

  @IsOptional()
  @IsString()
  doctorId?: string;
}

// ===== EHR WORKSPACE DTOs =====

export const CARE_PLAN_STATUSES = ['ACTIVE', 'COMPLETED', 'ARCHIVED'] as const;
export type CarePlanStatus = (typeof CARE_PLAN_STATUSES)[number];
export const CARE_PLAN_MAX_ITEMS = 30;
export const CARE_PLAN_ITEM_MAX_LENGTH = 500;

/** One goal / intervention line of a care plan. */
export class CarePlanItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(CARE_PLAN_ITEM_MAX_LENGTH)
  text!: string;

  @IsOptional()
  @IsBoolean()
  done?: boolean;
}

/** PUT body of a patient's care plan (full replace of the editable fields). */
export class UpsertCarePlanDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsIn(CARE_PLAN_STATUSES)
  status?: CarePlanStatus;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  summary?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CARE_PLAN_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => CarePlanItemDto)
  goals?: CarePlanItemDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CARE_PLAN_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => CarePlanItemDto)
  interventions?: CarePlanItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  dietNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  lifestyleNotes?: string;

  @IsOptional()
  @IsDateString()
  nextReviewDate?: string;
}

/** Query of GET /ehr/clinic/patients/:patientId/appointments */
export class PatientAppointmentsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  status?: string;
}

/** Query of GET /ehr/analytics/medication-adherence/:userId (YYYY-MM-DD, IST days) */
export class MedicationAdherenceQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}

/** Body of POST /ehr/medications/:id/doses (patient marks one dose taken / undoes it). */
export class MarkMedicationDoseDto {
  /** Day of the dose (YYYY-MM-DD, IST); defaults to today. */
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsInt()
  @Min(0)
  @Max(5)
  doseIndex!: number;

  /** false removes the mark again. Defaults to true. */
  @IsOptional()
  @IsBoolean()
  taken?: boolean;
}
