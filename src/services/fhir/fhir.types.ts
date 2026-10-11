/**
 * Minimal HL7 FHIR R4 (4.0.1) shapes for the resources this read-only layer emits.
 * Only the elements we populate are modelled; this is not a full FHIR model.
 */

export interface FhirCoding {
  system?: string;
  code?: string;
  display?: string;
}

export interface FhirCodeableConcept {
  coding?: FhirCoding[];
  text?: string;
}

export interface FhirReference {
  reference: string;
  display?: string;
}

export interface FhirIdentifier {
  use?: 'usual' | 'official' | 'temp' | 'secondary' | 'old';
  type?: FhirCodeableConcept;
  system: string;
  value: string;
}

export interface FhirPeriod {
  start?: string;
  end?: string;
}

export interface FhirQuantity {
  value: number;
  unit: string;
  system: string;
  code: string;
}

export interface FhirAnnotation {
  text: string;
}

export interface FhirContactPoint {
  system: 'phone' | 'email';
  value: string;
}

export interface FhirHumanName {
  use?: 'official' | 'usual';
  text: string;
  family?: string;
  given?: string[];
}

export interface FhirMeta {
  lastUpdated?: string;
}

interface FhirResourceBase<T extends string> {
  resourceType: T;
  id: string;
  meta?: FhirMeta;
}

export type AdministrativeGender = 'male' | 'female' | 'other' | 'unknown';

export interface FhirPatient extends FhirResourceBase<'Patient'> {
  identifier?: FhirIdentifier[];
  active: boolean;
  name?: FhirHumanName[];
  telecom?: FhirContactPoint[];
  gender: AdministrativeGender;
  birthDate?: string;
}

export interface FhirPractitioner extends FhirResourceBase<'Practitioner'> {
  identifier?: FhirIdentifier[];
  active: boolean;
  name?: FhirHumanName[];
  qualification?: Array<{ code: FhirCodeableConcept }>;
}

export type EncounterStatus = 'in-progress' | 'finished';

export interface FhirEncounter extends FhirResourceBase<'Encounter'> {
  identifier?: FhirIdentifier[];
  status: EncounterStatus;
  class: FhirCoding;
  subject: FhirReference;
  participant?: Array<{ individual: FhirReference }>;
  period: FhirPeriod;
  reasonCode?: FhirCodeableConcept[];
}

export interface FhirObservationComponent {
  code: FhirCodeableConcept;
  valueQuantity?: FhirQuantity;
  valueCodeableConcept?: FhirCodeableConcept;
}

export interface FhirObservation extends FhirResourceBase<'Observation'> {
  status: 'final';
  category: FhirCodeableConcept[];
  code: FhirCodeableConcept;
  subject: FhirReference;
  encounter?: FhirReference;
  effectiveDateTime?: string;
  valueQuantity?: FhirQuantity;
  valueCodeableConcept?: FhirCodeableConcept;
  note?: FhirAnnotation[];
  component?: FhirObservationComponent[];
}

export interface FhirCondition extends FhirResourceBase<'Condition'> {
  clinicalStatus: FhirCodeableConcept;
  verificationStatus?: FhirCodeableConcept;
  code: FhirCodeableConcept;
  subject: FhirReference;
  recordedDate?: string;
  note?: FhirAnnotation[];
}

export interface FhirAllergyReaction {
  manifestation: FhirCodeableConcept[];
  severity?: 'mild' | 'moderate' | 'severe';
}

export interface FhirAllergyIntolerance extends FhirResourceBase<'AllergyIntolerance'> {
  clinicalStatus?: FhirCodeableConcept;
  verificationStatus?: FhirCodeableConcept;
  category?: Array<'food' | 'medication' | 'environment' | 'biologic'>;
  code: FhirCodeableConcept;
  patient: FhirReference;
  recordedDate?: string;
  reaction?: FhirAllergyReaction[];
  note?: FhirAnnotation[];
}

export interface FhirMedicationStatement extends FhirResourceBase<'MedicationStatement'> {
  status: 'active' | 'completed';
  medicationCodeableConcept: FhirCodeableConcept;
  subject: FhirReference;
  effectivePeriod?: FhirPeriod;
  dateAsserted?: string;
  informationSource?: { display: string };
  reasonCode?: FhirCodeableConcept[];
  dosage?: Array<{ text: string }>;
  note?: FhirAnnotation[];
}

export type FhirClinicalResource =
  | FhirPatient
  | FhirPractitioner
  | FhirEncounter
  | FhirObservation
  | FhirCondition
  | FhirAllergyIntolerance
  | FhirMedicationStatement;

export type FhirResourceType = FhirClinicalResource['resourceType'];

export interface FhirBundleEntry<R extends FhirClinicalResource = FhirClinicalResource> {
  fullUrl: string;
  resource: R;
  search?: { mode: 'match' };
}

/** A warning/info OperationOutcome carried inside a Bundle (e.g. "result truncated"). */
export interface FhirOutcomeEntry {
  resource: FhirOperationOutcome;
  search?: { mode: 'outcome' };
}

export interface FhirBundle<R extends FhirClinicalResource = FhirClinicalResource> {
  resourceType: 'Bundle';
  type: 'collection' | 'searchset';
  timestamp: string;
  total?: number;
  entry: Array<FhirBundleEntry<R> | FhirOutcomeEntry>;
}

export interface FhirCapabilityStatement {
  resourceType: 'CapabilityStatement';
  status: 'active';
  date: string;
  kind: 'instance';
  description: string;
  software: { name: string };
  fhirVersion: string;
  format: string[];
  rest: Array<{
    mode: 'server';
    documentation: string;
    resource: Array<{
      type: string;
      interaction: Array<{ code: 'read' | 'search-type' }>;
      searchParam?: Array<{ name: string; type: 'reference'; documentation: string }>;
      operation?: Array<{ name: string; definition: string }>;
    }>;
  }>;
}

export type OperationOutcomeIssueCode =
  | 'invalid'
  | 'incomplete'
  | 'not-found'
  | 'forbidden'
  | 'login'
  | 'not-supported'
  | 'throttled'
  | 'exception';

export interface FhirOperationOutcome {
  resourceType: 'OperationOutcome';
  issue: Array<{
    severity: 'warning' | 'error' | 'fatal';
    code: OperationOutcomeIssueCode;
    diagnostics: string;
  }>;
}
