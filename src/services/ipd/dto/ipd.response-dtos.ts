/**
 * IPD Admission Response DTOs
 * @module IPD Admission Response DTOs
 * @description Response DTOs for IPD admission and bed assignment flows
 */

export class AdmissionResponseDto {
  id!: string;
  admissionNumber!: string;
  patientId!: string;
  patientName?: string | undefined;
  clinicId!: string;
  clinicLocationId!: string;
  wardId!: string;
  wardName?: string | undefined;
  wardType?: string | undefined;
  bedId!: string;
  bedNumber?: string | undefined;
  roomNumber?: string | undefined;
  admittingDoctorId!: string;
  admittingDoctorName?: string | undefined;
  status!: string;
  admittedAt!: string;
  primaryDiagnosis?: string | undefined;
  secondaryDiagnoses?: string[] | undefined;
  admissionReason!: string;
  expectedDischargeDate?: string | undefined;
  referringDoctor?: string | undefined;
  attendantName?: string | undefined;
  attendantPhone?: string | undefined;
  insuranceDetails?: Record<string, unknown> | Array<Record<string, unknown>> | null | undefined;
  notes?: string | undefined;
  dischargedAt?: string | undefined;
  dischargeType?: string | undefined;
  dischargedById?: string | undefined;
  finalDiagnosis?: string | undefined;
  treatmentSummary?: string | undefined;
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
  createdBy?: string | undefined;
  createdAt!: string;
  updatedAt!: string;
}

export class BedAssignmentResponseDto {
  id!: string;
  admissionId!: string;
  bedId!: string;
  wardId!: string;
  bedNumber?: string | undefined;
  roomNumber?: string | undefined;
  wardName?: string | undefined;
  assignedAt!: string;
  releasedAt?: string | undefined;
  isActive!: boolean;
  transferReason?: string | undefined;
  authorizedBy?: string | undefined;
  createdAt!: string;
  updatedAt!: string;
}
