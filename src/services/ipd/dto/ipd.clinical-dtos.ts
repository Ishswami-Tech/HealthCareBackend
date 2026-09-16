/**
 * IPD Clinical Response DTOs
 * @module IPD Clinical Response DTOs
 * @description Response DTOs for admission and clinical operations
 */

export class NursingNoteResponseDto {
  id!: string;
  clinicId!: string;
  clinicLocationId!: string;
  admissionId!: string;
  patientId!: string;
  nurseId!: string;
  nurseName?: string | undefined;
  content!: string;
  severity!: string;
  doctorAcknowledged!: boolean;
  acknowledgedById?: string | undefined;
  acknowledgedAt?: string | undefined;
  notes?: string | undefined;
  createdAt!: string;
  updatedAt!: string;
}

export class VitalsResponseDto {
  id!: string;
  clinicId!: string;
  clinicLocationId!: string;
  admissionId!: string;
  patientId!: string;
  bpSystolic?: number | undefined;
  bpDiastolic?: number | undefined;
  heartRate?: number | undefined;
  temperature?: number | undefined;
  respiratoryRate?: number | undefined;
  oxygenSaturation?: number | undefined;
  bloodGlucose?: number | undefined;
  weight?: number | undefined;
  height?: number | undefined;
  bmi?: number | undefined;
  painScore?: number | undefined;
  recordedBy!: string;
  recordedByName?: string | undefined;
  notes?: string | undefined;
  recordedAt!: string;
  createdAt!: string;
}

export class BedsideMedicationResponseDto {
  id!: string;
  clinicId!: string;
  clinicLocationId!: string;
  admissionId!: string;
  patientId!: string;
  medicationName!: string;
  dosage!: string;
  route!: string;
  frequency?: string | undefined;
  administeredBy!: string;
  administeredByName?: string | undefined;
  verifiedById?: string | undefined;
  verifiedByName?: string | undefined;
  administeredAt!: string;
  batchNumber?: string | undefined;
  adverseReactions?: string | undefined;
  notes?: string | undefined;
  createdAt!: string;
}

export class DischargeSummaryResponseDto {
  id!: string;
  admissionId!: string;
  patientId!: string;
  clinicId!: string;
  clinicLocationId!: string;
  finalDiagnosis?: string | undefined;
  treatmentSummary?: string | undefined;
  dischargeType!: string;
  dischargedAt!: string;
  dischargedById?: string | undefined;
  dischargedByName?: string | undefined;
  followUpInstructions?: string | undefined;
  followUpDate?: string | undefined;
  dischargeMedications?:
    | Array<{
        medicationName: string;
        dosage: string;
        frequency: string;
        duration: string;
      }>
    | undefined;
  dischargeAdvice?: string | undefined;
  pdfGenerated!: boolean;
  pdfUrl?: string | undefined;
  notes?: string | undefined;
  createdAt!: string;
}

export class BedChargeResponseDto {
  id!: string;
  clinicId!: string;
  clinicLocationId!: string;
  admissionId!: string;
  patientId!: string;
  patientName?: string | undefined;
  chargeDate!: string;
  days!: number;
  bedRate!: number;
  bedCharges!: number;
  additionalCharges?:
    | Array<{
        description: string;
        amount: number;
      }>
    | undefined;
  totalCharges!: number;
  isBilled!: boolean;
  createdAt!: string;
}
