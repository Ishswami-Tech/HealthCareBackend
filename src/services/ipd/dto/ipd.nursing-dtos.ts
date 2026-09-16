/**
 * IPD Nursing Station Request DTOs
 * @module IPD Nursing Station Request DTOs
 * @description Request DTOs for nursing notes, vitals, and bedside medications
 */

import type { NoteSeverity, MedicationRoute, BedStatus, WardType } from './ipd.enums';

/**
 * Query bed board
 * @class BedBoardQueryDto
 */
export class BedBoardQueryDto {
  /** Filter by ward ID */
  wardId?: string;

  /** Filter by bed status */
  status?: BedStatus;

  /** Filter by ward type */
  wardType?: WardType;

  /** Page number */
  page?: number;

  /** Items per page */
  limit?: number;
}

/**
 * Query nursing notes
 * @class NursingNotesQueryDto
 */
export class NursingNotesQueryDto {
  /** Admission ID filter */
  admissionId?: string;

  /** Patient ID filter */
  patientId?: string;

  /** Severity filter */
  severity?: NoteSeverity;

  /** Page number */
  page?: number;

  /** Items per page */
  limit?: number;
}

/**
 * Add a nursing note
 * @class CreateNursingNoteDto
 */
export class CreateNursingNoteDto {
  /** Admission ID */
  admissionId!: string;

  /** Note content */
  content!: string;

  /** Note severity */
  severity!: NoteSeverity;

  /** Nurse user ID */
  nurseId!: string;

  /** Whether note requires doctor acknowledgment */
  requiresAcknowledgment?: boolean;
}

/**
 * Record patient vitals
 * @class RecordVitalsDto
 */
export class RecordVitalsDto {
  /** Admission ID */
  admissionId!: string;

  /** Blood pressure systolic (mmHg) */
  bpSystolic?: number;

  /** Blood pressure diastolic (mmHg) */
  bpDiastolic?: number;

  /** Heart rate (bpm) */
  heartRate?: number;

  /** Temperature (Celsius) */
  temperature?: number;

  /** Respiratory rate (breaths/min) */
  respiratoryRate?: number;

  /** Oxygen saturation (%) */
  oxygenSaturation?: number;

  /** Blood glucose (mg/dL) */
  bloodGlucose?: number;

  /** Weight (kg) */
  weight?: number;

  /** Height (cm) */
  height?: number;

  /** Pain score (0-10) */
  painScore?: number;

  /** Recorded by nurse user ID */
  recordedBy!: string;

  /** Additional observations */
  notes?: string;
}

/**
 * Administer bedside medication
 * @class AdministerMedicationDto
 */
export class AdministerMedicationDto {
  /** Admission ID */
  admissionId!: string;

  /** Patient ID */
  patientId!: string;

  /** Medication name */
  medicationName!: string;

  /** Dosage */
  dosage!: string;

  /** Medication route */
  route!: MedicationRoute;

  /** Frequency */
  frequency?: string;

  /** Administered by nurse user ID */
  administeredBy!: string;

  /** Verified by doctor user ID (optional) */
  verifiedBy?: string;

  /** Administration time (ISO string) */
  administeredAt?: string;

  /** Batch number */
  batchNumber?: string;

  /** Any adverse reactions */
  adverseReactions?: string;

  /** Notes */
  notes?: string;
}

/**
 * Accrue daily bed charges
 * @class AccrueDailyChargesDto
 */
export class AccrueDailyChargesDto {
  /** Admission ID */
  admissionId!: string;

  /** Charge date (ISO string, defaults to today) */
  chargeDate?: string;

  /** Additional charges beyond bed rate */
  additionalCharges?: Array<{
    description: string;
    amount: number;
  }>;
}
