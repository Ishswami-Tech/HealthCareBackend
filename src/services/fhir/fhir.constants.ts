/**
 * Every URI and fixed code used by the FHIR R4 read layer lives here, so a profile or
 * terminology change is a one-file edit. Only values that are published standards (or our
 * own namespaced URNs) belong in this file; anything uncertain is emitted as text instead.
 */

export const FHIR_VERSION = '4.0.1';
export const FHIR_JSON_CONTENT_TYPE = 'application/fhir+json';

// ---- Code systems -----------------------------------------------------------------------
export const LOINC_SYSTEM = 'http://loinc.org';
export const SNOMED_SYSTEM = 'http://snomed.info/sct';
export const ICD10_SYSTEM = 'http://hl7.org/fhir/sid/icd-10';
export const ICD11_MMS_SYSTEM = 'http://id.who.int/icd/release/11/mms';
export const UCUM_SYSTEM = 'http://unitsofmeasure.org';

// ---- HL7 terminology (value sets used by structural elements) ---------------------------
export const OBSERVATION_CATEGORY_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/observation-category';
export const CONDITION_CLINICAL_SYSTEM = 'http://terminology.hl7.org/CodeSystem/condition-clinical';
export const CONDITION_VER_STATUS_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/condition-ver-status';
export const ALLERGY_CLINICAL_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical';
export const ALLERGY_VERIFICATION_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification';
export const V2_IDENTIFIER_TYPE_SYSTEM = 'http://terminology.hl7.org/CodeSystem/v2-0203';
export const V3_ACT_CODE_SYSTEM = 'http://terminology.hl7.org/CodeSystem/v3-ActCode';
export const PATIENT_EVERYTHING_OPERATION_URL =
  'http://hl7.org/fhir/OperationDefinition/Patient-everything';

// ---- Identifier systems -----------------------------------------------------------------
export const UHID_IDENTIFIER_SYSTEM = 'urn:ishswami-healthcare:identifier:uhid';
export const OPD_NUMBER_IDENTIFIER_SYSTEM = 'urn:ishswami-healthcare:identifier:opd-number';
export const DOCTOR_LICENSE_IDENTIFIER_SYSTEM =
  'urn:ishswami-healthcare:identifier:doctor-licence-number';
export const LEGACY_REGISTRATION_IDENTIFIER_SYSTEM =
  'urn:ishswami-healthcare:identifier:legacy-registration';
// verify against the current ABDM FHIR profile before ABDM go-live
export const ABHA_NUMBER_IDENTIFIER_SYSTEM = 'https://healthid.ndhm.gov.in';
// verify against the current ABDM FHIR profile before ABDM go-live
export const ABHA_ADDRESS_IDENTIFIER_SYSTEM = 'https://healthid.ndhm.gov.in/address';

// ---- LOINC codes (each one verified; anything not listed is emitted text-only) -----------
export const LOINC = {
  BODY_WEIGHT: { code: '29463-7', display: 'Body weight' },
  BODY_HEIGHT: { code: '8302-2', display: 'Body height' },
  BODY_TEMPERATURE: { code: '8310-5', display: 'Body temperature' },
  HEART_RATE: { code: '8867-4', display: 'Heart rate' },
  OXYGEN_SATURATION: {
    code: '59408-5',
    display: 'Oxygen saturation in Arterial blood by Pulse oximetry',
  },
  RESPIRATORY_RATE: { code: '9279-1', display: 'Respiratory rate' },
  BLOOD_PRESSURE_PANEL: {
    code: '85354-9',
    display: 'Blood pressure panel with all children optional',
  },
  SYSTOLIC_BP: { code: '8480-6', display: 'Systolic blood pressure' },
  DIASTOLIC_BP: { code: '8462-4', display: 'Diastolic blood pressure' },
  BODY_MASS_INDEX: { code: '39156-5', display: 'Body mass index (BMI) [Ratio]' },
} as const;

// ---- UCUM units ---------------------------------------------------------------------------
export const UCUM_UNITS = {
  KG: { unit: 'kg', code: 'kg' },
  CM: { unit: 'cm', code: 'cm' },
  CELSIUS: { unit: 'Cel', code: 'Cel' },
  BEATS_PER_MIN: { unit: 'beats/min', code: '/min' },
  BREATHS_PER_MIN: { unit: 'breaths/min', code: '/min' },
  PERCENT: { unit: '%', code: '%' },
  MMHG: { unit: 'mm[Hg]', code: 'mm[Hg]' },
  BMI: { unit: 'kg/m2', code: 'kg/m2' },
  MG_PER_DL: { unit: 'mg/dL', code: 'mg/dL' },
  SCORE: { unit: 'score', code: '{score}' },
} as const;

/** Local CodeSystem used to label the sections of the case sheet that have no LOINC code. */
export const CASE_SHEET_SECTION_SYSTEM = 'urn:ishswami-healthcare:codesystem:case-sheet-section';

/** An encounter registered less than this long ago is reported as `in-progress`. */
export const ENCOUNTER_IN_PROGRESS_WINDOW_MS = 24 * 60 * 60 * 1000;

/** List queries read at most this many recent visits (each costs a few reads). */
export const FHIR_MAX_VISITS_PER_QUERY = 20;
/** Diagnoses read per query. */
export const FHIR_MAX_DIAGNOSES_PER_QUERY = 100;
