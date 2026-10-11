/**
 * Compliance types: PHI access auditing, patient consent (DPDP Act 2023) and patient
 * identifiers (UHID / ABHA). Shared by the compliance, patient-visits and FHIR services.
 * @module ComplianceTypes
 */

/** Actions recorded for access to protected health information (matches LoggingService.logPhiAccess). */
export const PHI_AUDIT_ACTIONS = ['VIEW', 'CREATE', 'UPDATE', 'DELETE', 'EXPORT'] as const;
export type PhiAuditAction = (typeof PHI_AUDIT_ACTIONS)[number];

export type PhiAuditOutcome = 'SUCCESS' | 'FAILURE' | 'DENIED';

/** One access to a patient's record: who, to which record, and why. */
export interface PhiAuditEntry {
  readonly userId: string;
  readonly userRole: string;
  readonly patientId: string;
  readonly clinicId: string;
  readonly action: PhiAuditAction;
  /** Kind of record touched, e.g. PATIENT_VISIT, CASE_SHEET, FHIR_BUNDLE. */
  readonly resourceType: string;
  readonly resourceId: string;
  /** Names of the data groups returned (never their values). */
  readonly fields?: readonly string[];
  readonly purpose?: string;
  readonly outcome?: PhiAuditOutcome;
  readonly reason?: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

/** `AuditLog.action` value of the structured rows written for PHI access. */
export const PHI_AUDIT_LOG_ACTION_PREFIX = 'PHI_';

/** What the patient consents to. One ledger row per grant or withdrawal. */
export const CONSENT_PURPOSES = [
  'TREATMENT_AND_RECORDS',
  'TELECONSULTATION',
  'DATA_SHARING_WITH_PROVIDERS',
  'ABDM_LINKING',
  'COMMUNICATIONS',
  'RESEARCH',
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export const CONSENT_STATUSES = ['GRANTED', 'WITHDRAWN'] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

/** How the consent was captured. IMPORT marks consent carried over from a previous system. */
export const CONSENT_CAPTURE_CHANNELS = ['SELF', 'STAFF', 'IMPORT'] as const;
export type ConsentCaptureChannel = (typeof CONSENT_CAPTURE_CHANNELS)[number];

export interface PatientConsentRecord {
  readonly id: string;
  readonly patientId: string;
  readonly clinicId: string;
  readonly purpose: ConsentPurpose;
  readonly noticeVersion: string;
  readonly language: string | null;
  readonly status: ConsentStatus;
  readonly recordedBy: string;
  readonly capturedVia: ConsentCaptureChannel;
  readonly evidence: Record<string, unknown> | null;
  readonly recordedAt: Date;
}

/** Identifier systems stored in `patient_identifiers.system`. */
export const PATIENT_IDENTIFIER_SYSTEMS = [
  'UHID',
  'ABHA_NUMBER',
  'ABHA_ADDRESS',
  'LEGACY_REGISTRATION',
] as const;
export type PatientIdentifierSystem = (typeof PATIENT_IDENTIFIER_SYSTEMS)[number];

export interface PatientIdentifierRecord {
  readonly id: string;
  readonly patientId: string;
  readonly clinicId: string;
  readonly system: PatientIdentifierSystem;
  readonly value: string;
  readonly source: string;
  readonly createdAt: Date;
}

/** A standard code attached to a diagnosis or finding (FHIR Coding shape). */
export interface MedicalCoding {
  readonly system: string;
  readonly code: string;
  readonly display?: string;
}
