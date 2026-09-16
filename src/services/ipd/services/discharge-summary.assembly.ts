/**
 * Discharge Summary Assembly
 * @module Discharge Summary Assembly
 * @description Utility for assembling discharge summary from clinical data
 */

import type {
  AdmissionResponseDto,
  DischargeSummaryResponseDto,
  DischargeType,
  VitalsResponseDto,
  NursingNoteResponseDto,
  BedsideMedicationResponseDto,
} from '@services/ipd/dto';

/**
 * Assembles clinical data into a structured discharge summary.
 *
 * @param admission - Admission record
 * @param nursingNotes - Nursing notes for the admission
 * @param vitals - Vitals records for the admission
 * @param medications - Administered medications
 * @returns Structured summary data suitable for PDF rendering
 */
export function assembleDischargeSummary(
  admission: AdmissionResponseDto,
  nursingNotes: NursingNoteResponseDto[],
  vitals: VitalsResponseDto[],
  medications: BedsideMedicationResponseDto[]
): {
  admissionId: string;
  patientId: string;
  clinicId: string;
  finalDiagnosis?: string | undefined;
  treatmentSummary?: string | undefined;
  dischargeType: DischargeType;
  dischargedAt: string;
  dischargedById?: string | undefined;
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
  notes?: string | undefined;
  nursingNotesSummary: string;
  vitalsSummary: string;
  administeredMedications: BedsideMedicationResponseDto[];
} {
  return {
    admissionId: admission.id,
    patientId: admission.patientId,
    clinicId: admission.clinicId,
    finalDiagnosis: admission.finalDiagnosis,
    treatmentSummary: admission.treatmentSummary,
    dischargeType: admission.dischargeType as DischargeType,
    dischargedAt: admission.dischargedAt ?? new Date().toISOString(),
    dischargedById: admission.dischargedById,
    followUpInstructions: admission.followUpInstructions,
    followUpDate: admission.followUpDate,
    dischargeMedications: admission.dischargeMedications,
    dischargeAdvice: admission.dischargeAdvice,
    notes: admission.notes,
    nursingNotesSummary: summarizeNursingNotes(nursingNotes),
    vitalsSummary: summarizeVitals(vitals),
    administeredMedications: medications,
  };
}

/**
 * Creates a narrative summary from nursing notes.
 *
 * @param notes - Nursing notes
 * @returns Narrative summary string
 */
export function summarizeNursingNotes(notes: NursingNoteResponseDto[]): string {
  if (notes.length === 0) {
    return 'No nursing notes recorded during stay.';
  }

  const criticalNotes = notes.filter(n => n.severity === 'CRITICAL');
  const urgentNotes = notes.filter(n => n.severity === 'URGENT');
  const routineNotes = notes.filter(n => n.severity === 'ROUTINE');

  const parts: string[] = [];

  if (criticalNotes.length > 0) {
    parts.push(`Critical observations (${criticalNotes.length}):`);
    criticalNotes.slice(0, 5).forEach(n => {
      parts.push(`- [${n.createdAt}] ${n.content}`);
    });
  }

  if (urgentNotes.length > 0) {
    parts.push(`Urgent observations (${urgentNotes.length}):`);
    urgentNotes.slice(0, 5).forEach(n => {
      parts.push(`- [${n.createdAt}] ${n.content}`);
    });
  }

  parts.push(`Total routine notes: ${routineNotes.length}.`);
  return parts.join('\n');
}

/**
 * Creates a trend summary from vitals data.
 *
 * @param vitals - Vitals records
 * @returns Trend summary with min/max/avg
 */
export function summarizeVitals(vitals: VitalsResponseDto[]): string {
  if (vitals.length === 0) {
    return 'No vitals recorded during stay.';
  }

  const parts: string[] = [`Total vitals entries: ${vitals.length}`];

  // Heart rate summary
  const hrValues = vitals.filter(v => v.heartRate).map(v => v.heartRate as number);
  if (hrValues.length > 0) {
    parts.push(
      `Heart Rate: avg ${round(hrValues.reduce((a, b) => a + b) / hrValues.length)} bpm (range: ${Math.min(...hrValues)}-${Math.max(...hrValues)})`
    );
  }

  // Temperature summary
  const tempValues = vitals.filter(v => v.temperature).map(v => v.temperature as number);
  if (tempValues.length > 0) {
    parts.push(
      `Temperature: avg ${round(tempValues.reduce((a, b) => a + b) / tempValues.length)}C (range: ${Math.min(...tempValues)}-${Math.max(...tempValues)})`
    );
  }

  // BP summary
  const bpSystolic = vitals.filter(v => v.bpSystolic).map(v => v.bpSystolic as number);
  const bpDiastolic = vitals.filter(v => v.bpDiastolic).map(v => v.bpDiastolic as number);
  if (bpSystolic.length > 0 && bpDiastolic.length > 0) {
    parts.push(
      `Blood Pressure: avg ${round(bpSystolic.reduce((a, b) => a + b) / bpSystolic.length)}/${round(bpDiastolic.reduce((a, b) => a + b) / bpDiastolic.length)} mmHg`
    );
  }

  return parts.join('\n');
}

/**
 * Rounds a number to 2 decimal places.
 *
 * @param value - Number to round
 * @returns Rounded number
 */
export function round(value: number): number {
  return Math.round(value * 100) / 100;
}
