/**
 * Reception sees no clinical records (product rule 4).
 *
 * The receptionist registers patients, checks them in and collects payment; it never reads the
 * medical history, allergies, diagnoses, medications, vitals or any EHR content. Patient reads
 * that reception may call (patient lists / profile / directory) go through this redaction, so the
 * clinical keys are simply absent from the JSON - the UI hiding them is not the enforcement.
 *
 * Matching is on the WHOLE key (case and separators ignored), never on a fragment, so `notes`,
 * `name` or `history` (a visit list) are not touched.
 */

import { stripKeysDeep } from './billing-redaction.util';

/** Roles that must never receive clinical patient data. */
export const CLINICAL_BLIND_ROLES: ReadonlySet<string> = new Set(['RECEPTIONIST']);

/** Normalised (lower-case, letters and digits only) clinical keys. */
const CLINICAL_KEYS: ReadonlySet<string> = new Set([
  'medicalhistory',
  'medicalhistories',
  'allergies',
  'allergy',
  'chronicconditions',
  'conditions',
  'currentmedications',
  'medications',
  'medication',
  'diagnosis',
  'diagnoses',
  'prescriptions',
  'vitals',
  'vitalsigns',
  'vitalsexamination',
  'latestvitals',
  'healthrecords',
  'medicalrecords',
  'labresults',
  'labreports',
  'symptoms',
  'treatmentplan',
  'clinicalnotes',
  'casesheet',
  'height',
  'weight',
  'bmi',
  'bloodgroup',
  'bloodtype',
  'immunizations',
  'surgicalhistory',
  'familyhistory',
  'ehr',
  'ehrsummary',
  'investigations',
]);

export function isClinicalKey(key: string): boolean {
  return CLINICAL_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''));
}

export function isClinicalBlindRole(role: unknown): boolean {
  return typeof role === 'string' && CLINICAL_BLIND_ROLES.has(role.trim().toUpperCase());
}

/** Deep copy of `value` without any clinical key. */
export function stripClinicalFields<T>(value: T): T {
  return stripKeysDeep(value, isClinicalKey);
}
