/**
 * IPD Admission Request DTOs
 * @module IPD Admission Request DTOs
 * @description Request DTOs for admission, discharge, and bed transfer operations
 */

import type { BedStatus, AdmissionStatus, DischargeType } from './ipd.enums';

/**
 * Admit a patient to IPD
 * @class AdmitPatientDto
 */
export class AdmitPatientDto {
  /** Patient ID */
  patientId!: string;

  /** Ward ID for admission */
  wardId!: string;

  /** Bed ID to assign */
  bedId!: string;

  /** Admitting doctor user ID */
  admittingDoctorId!: string;

  /** Primary diagnosis for admission */
  primaryDiagnosis?: string;

  /** Secondary diagnoses */
  secondaryDiagnoses?: string[];

  /** Reason for admission */
  admissionReason!: string;

  /** Expected discharge date (ISO string) */
  expectedDischargeDate?: string;

  /** Referring doctor name */
  referringDoctor?: string;

  /** Emergency contact */
  emergencyContact?: string;

  /** Attendant name */
  attendantName?: string;

  /** Attendant phone */
  attendantPhone?: string;

  /** Insurance details */
  insuranceDetails?: Record<string, string>;

  /** Initial notes */
  notes?: string;
}

/**
 * Transfer a patient to a different bed
 * @class TransferBedDto
 */
export class TransferBedDto {
  /** Target ward ID */
  toWardId!: string;

  /** Target bed ID */
  toBedId!: string;

  /** Reason for transfer */
  transferReason!: string;

  /** Authorizing doctor user ID */
  authorizedBy!: string;
}

/**
 * Discharge a patient from IPD
 * @class DischargePatientDto
 */
export class DischargePatientDto {
  /** Discharge type */
  dischargeType!: DischargeType;

  /** Final diagnosis */
  finalDiagnosis?: string;

  /** Summary of treatment provided */
  treatmentSummary?: string;

  /** Discharging doctor user ID */
  dischargedBy!: string;

  /** Follow-up instructions */
  followUpInstructions?: string;

  /** Follow-up date (ISO string) */
  followUpDate?: string;

  /** Prescribed medications at discharge */
  dischargeMedications?: Array<{
    medicationName: string;
    dosage: string;
    frequency: string;
    duration: string;
  }>;

  /** Discharge advice */
  dischargeAdvice?: string;

  /** Additional notes */
  notes?: string;
}
