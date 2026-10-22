/**
 * Input of the prescription PDF (see prescription-pdf.util.ts). Every header value comes from
 * the prescription's own clinic / doctor / patient records; nothing here is clinic specific.
 * All fields added after the first version are optional so older callers keep compiling.
 */

export interface PrescriptionPdfItem {
  readonly medicineName: string;
  readonly quantity: number;
  readonly dosage?: string | null;
  readonly frequency?: string | null;
  readonly duration?: string | null;
  readonly unit?: string | null;
  /** Free-text usage instructions ("After meals"). Printed in the TIMING column. */
  readonly instructions?: string | null;
  /** Strength from the medicine master (Medicine.dosage, e.g. "500 mg"). */
  readonly strength?: string | null;
  /** Dosage form / category from the medicine master (TABLET, SYRUP, ...). */
  readonly category?: string | null;
}

export interface PrescriptionPdfInvestigation {
  readonly name: string;
  readonly kind?: string | null;
  readonly urgency?: string | null;
}

export interface PrescriptionPdfFollowUp {
  readonly scheduledFor: Date | string;
  readonly instructions?: string | null;
  readonly followUpType?: string | null;
}

export interface PrescriptionPdfData {
  readonly prescriptionNumber: string;
  readonly clinicName: string;
  readonly prescribedAt: Date | string | null;
  readonly patientName: string;
  readonly patientAge?: number | null;
  readonly patientGender?: string | null;
  readonly patientNumber?: string | null;
  readonly doctorName: string;
  /** Registration number of the prescribing doctor (Doctor.licenseNumber). Printed when known. */
  readonly doctorRegistrationNumber?: string | null;
  readonly diagnosis?: string | null;
  readonly notes?: string | null;
  readonly status: string;
  readonly items: readonly PrescriptionPdfItem[];

  /** Prescription row id; part of the verification QR payload. */
  readonly prescriptionId?: string | null;
  /** Clinic business code (Clinic.clinicId, e.g. CL0002); part of the verification QR payload. */
  readonly clinicCode?: string | null;
  readonly clinicAddress?: string | null;
  readonly clinicPhone?: string | null;
  readonly clinicEmail?: string | null;
  /**
   * Clinic logo. Only an inline `data:image/png|jpeg;base64,...` value is drawn (no remote
   * fetch while rendering); anything else falls back to the drawn brand tile.
   */
  readonly clinicLogo?: string | null;
  readonly doctorQualification?: string | null;
  readonly doctorSpecialization?: string | null;
  /** Clinic-issued health ID (UHID). Preferred over patientNumber for the PATIENT ID cell. */
  readonly patientUhid?: string | null;
  /** Display weight, e.g. "68 kg". Omitted from the sheet when unknown. */
  readonly patientWeight?: string | null;
  /** Known allergies (allergen names). Omitted from the sheet when empty. */
  readonly patientAllergies?: readonly string[] | null;
  readonly validUntil?: Date | string | null;
  readonly investigations?: readonly PrescriptionPdfInvestigation[] | null;
  readonly followUp?: PrescriptionPdfFollowUp | null;
  /** Name of the assistant who drafted the prescription (Prescription.draftedByUserId). */
  readonly draftedByName?: string | null;
  /** Render time; defaults to now. */
  readonly generatedAt?: Date | null;
}
