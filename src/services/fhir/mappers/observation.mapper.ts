import {
  CASE_SHEET_SECTION_SYSTEM,
  LOINC,
  LOINC_SYSTEM,
  OBSERVATION_CATEGORY_SYSTEM,
  UCUM_SYSTEM,
  UCUM_UNITS,
} from '@services/fhir/fhir.constants';
import type {
  FhirCodeableConcept,
  FhirObservation,
  FhirObservationComponent,
} from '@services/fhir/fhir.types';
import {
  cleanText,
  isFiniteNumber,
  quantity,
  reference,
  toInstant,
} from '@services/fhir/mappers/fhir-mapper.util';

/** Measured values of one visit's General Examination + Physical Measurement. */
export interface VitalsSource {
  readonly visitId: string;
  readonly heightCm: number | null;
  readonly weightKg: number | null;
  readonly bmi: number | null;
  readonly temperatureC: number | null;
  readonly pulse: number | null;
  readonly bpSystolic: number | null;
  readonly bpDiastolic: number | null;
  readonly rr: number | null;
  readonly painScore: number | null;
  readonly fbs: number | null;
  readonly ppbs: number | null;
  readonly pbs: number | null;
  readonly spo2: number | null;
  readonly neck: number | null;
  readonly chest: number | null;
  readonly upperAbs: number | null;
  readonly waist: number | null;
  readonly lowerAbs: number | null;
  readonly hips: number | null;
  readonly thighLeft: number | null;
  readonly thighRight: number | null;
  readonly calfLeft: number | null;
  readonly calfRight: number | null;
  readonly upperArmLeft: number | null;
  readonly upperArmRight: number | null;
  readonly createdAt: Date | string;
}

type NumericVitalKey = Exclude<keyof VitalsSource, 'visitId' | 'createdAt'>;
type ObservationCategoryCode = 'vital-signs' | 'laboratory' | 'exam';

interface VitalDefinition {
  readonly field: NumericVitalKey;
  /** Suffix of the Observation id (`<visitId>-<idSuffix>`). */
  readonly idSuffix: string;
  /** Standard LOINC code; absent means the observation is emitted text-only. */
  readonly loinc?: { readonly code: string; readonly display: string };
  readonly text: string;
  readonly units: { readonly unit: string; readonly code: string };
  readonly category: ObservationCategoryCode;
}

/** Stand-alone vitals. Blood pressure is a panel and is built separately. */
const VITAL_DEFINITIONS: readonly VitalDefinition[] = [
  {
    field: 'weightKg',
    idSuffix: 'weight',
    loinc: LOINC.BODY_WEIGHT,
    text: 'Body weight',
    units: UCUM_UNITS.KG,
    category: 'vital-signs',
  },
  {
    field: 'heightCm',
    idSuffix: 'height',
    loinc: LOINC.BODY_HEIGHT,
    text: 'Body height',
    units: UCUM_UNITS.CM,
    category: 'vital-signs',
  },
  {
    field: 'temperatureC',
    idSuffix: 'temperature',
    loinc: LOINC.BODY_TEMPERATURE,
    text: 'Body temperature',
    units: UCUM_UNITS.CELSIUS,
    category: 'vital-signs',
  },
  {
    field: 'pulse',
    idSuffix: 'heart-rate',
    loinc: LOINC.HEART_RATE,
    text: 'Heart rate',
    units: UCUM_UNITS.BEATS_PER_MIN,
    category: 'vital-signs',
  },
  {
    field: 'spo2',
    idSuffix: 'spo2',
    loinc: LOINC.OXYGEN_SATURATION,
    text: 'Oxygen saturation (SpO2)',
    units: UCUM_UNITS.PERCENT,
    category: 'vital-signs',
  },
  {
    field: 'rr',
    idSuffix: 'respiratory-rate',
    loinc: LOINC.RESPIRATORY_RATE,
    text: 'Respiratory rate',
    units: UCUM_UNITS.BREATHS_PER_MIN,
    category: 'vital-signs',
  },
  {
    field: 'bmi',
    idSuffix: 'bmi',
    loinc: LOINC.BODY_MASS_INDEX,
    text: 'Body mass index',
    units: UCUM_UNITS.BMI,
    category: 'vital-signs',
  },
  // No LOINC: the specimen/method behind these readings is not recorded, so a code would be a guess.
  {
    field: 'painScore',
    idSuffix: 'pain-score',
    text: 'Pain score (0-10)',
    units: UCUM_UNITS.SCORE,
    category: 'exam',
  },
  {
    field: 'fbs',
    idSuffix: 'fasting-blood-sugar',
    text: 'Fasting blood sugar',
    units: UCUM_UNITS.MG_PER_DL,
    category: 'laboratory',
  },
  {
    field: 'ppbs',
    idSuffix: 'post-prandial-blood-sugar',
    text: 'Post-prandial blood sugar',
    units: UCUM_UNITS.MG_PER_DL,
    category: 'laboratory',
  },
  {
    field: 'pbs',
    idSuffix: 'random-blood-sugar',
    text: 'Random blood sugar',
    units: UCUM_UNITS.MG_PER_DL,
    category: 'laboratory',
  },
  {
    field: 'neck',
    idSuffix: 'neck-circumference',
    text: 'Neck circumference',
    units: UCUM_UNITS.CM,
    category: 'exam',
  },
  {
    field: 'chest',
    idSuffix: 'chest-circumference',
    text: 'Chest circumference',
    units: UCUM_UNITS.CM,
    category: 'exam',
  },
  {
    field: 'upperAbs',
    idSuffix: 'upper-abdomen-circumference',
    text: 'Upper abdomen circumference',
    units: UCUM_UNITS.CM,
    category: 'exam',
  },
  {
    field: 'waist',
    idSuffix: 'waist-circumference',
    text: 'Waist circumference',
    units: UCUM_UNITS.CM,
    category: 'exam',
  },
  {
    field: 'lowerAbs',
    idSuffix: 'lower-abdomen-circumference',
    text: 'Lower abdomen circumference',
    units: UCUM_UNITS.CM,
    category: 'exam',
  },
  {
    field: 'hips',
    idSuffix: 'hip-circumference',
    text: 'Hip circumference',
    units: UCUM_UNITS.CM,
    category: 'exam',
  },
  {
    field: 'thighLeft',
    idSuffix: 'thigh-left-circumference',
    text: 'Left thigh circumference',
    units: UCUM_UNITS.CM,
    category: 'exam',
  },
  {
    field: 'thighRight',
    idSuffix: 'thigh-right-circumference',
    text: 'Right thigh circumference',
    units: UCUM_UNITS.CM,
    category: 'exam',
  },
  {
    field: 'calfLeft',
    idSuffix: 'calf-left-circumference',
    text: 'Left calf circumference',
    units: UCUM_UNITS.CM,
    category: 'exam',
  },
  {
    field: 'calfRight',
    idSuffix: 'calf-right-circumference',
    text: 'Right calf circumference',
    units: UCUM_UNITS.CM,
    category: 'exam',
  },
  {
    field: 'upperArmLeft',
    idSuffix: 'upper-arm-left-circumference',
    text: 'Left upper arm circumference',
    units: UCUM_UNITS.CM,
    category: 'exam',
  },
  {
    field: 'upperArmRight',
    idSuffix: 'upper-arm-right-circumference',
    text: 'Right upper arm circumference',
    units: UCUM_UNITS.CM,
    category: 'exam',
  },
];

function categoryConcept(code: ObservationCategoryCode): FhirCodeableConcept {
  const display = { 'vital-signs': 'Vital Signs', laboratory: 'Laboratory', exam: 'Exam' }[code];
  return { coding: [{ system: OBSERVATION_CATEGORY_SYSTEM, code, display }] };
}

function loincConcept(
  loinc: { readonly code: string; readonly display: string },
  text: string
): FhirCodeableConcept {
  return { coding: [{ system: LOINC_SYSTEM, code: loinc.code, display: loinc.display }], text };
}

function buildBloodPressurePanel(
  vitals: VitalsSource,
  patientId: string,
  effectiveDateTime: string | undefined
): FhirObservation | null {
  const components: FhirObservationComponent[] = [];
  if (isFiniteNumber(vitals.bpSystolic)) {
    components.push({
      code: loincConcept(LOINC.SYSTOLIC_BP, 'Systolic blood pressure'),
      valueQuantity: quantity(vitals.bpSystolic, UCUM_UNITS.MMHG, UCUM_SYSTEM),
    });
  }
  if (isFiniteNumber(vitals.bpDiastolic)) {
    components.push({
      code: loincConcept(LOINC.DIASTOLIC_BP, 'Diastolic blood pressure'),
      valueQuantity: quantity(vitals.bpDiastolic, UCUM_UNITS.MMHG, UCUM_SYSTEM),
    });
  }
  if (components.length === 0) return null;
  return {
    resourceType: 'Observation',
    id: `${vitals.visitId}-blood-pressure`,
    status: 'final',
    category: [categoryConcept('vital-signs')],
    code: loincConcept(LOINC.BLOOD_PRESSURE_PANEL, 'Blood pressure'),
    subject: reference('Patient', patientId),
    encounter: reference('Encounter', vitals.visitId),
    ...(effectiveDateTime ? { effectiveDateTime } : {}),
    component: components,
  };
}

/** One Observation per recorded value; null/absent values are skipped. */
export function mapVitalsToObservations(
  vitals: VitalsSource,
  patientId: string
): FhirObservation[] {
  const effectiveDateTime = toInstant(vitals.createdAt);
  const observations: FhirObservation[] = [];

  for (const def of VITAL_DEFINITIONS) {
    const value = vitals[def.field];
    if (!isFiniteNumber(value)) continue;
    observations.push({
      resourceType: 'Observation',
      id: `${vitals.visitId}-${def.idSuffix}`,
      status: 'final',
      category: [categoryConcept(def.category)],
      code: def.loinc ? loincConcept(def.loinc, def.text) : { text: def.text },
      subject: reference('Patient', patientId),
      encounter: reference('Encounter', vitals.visitId),
      ...(effectiveDateTime ? { effectiveDateTime } : {}),
      valueQuantity: quantity(value, def.units, UCUM_SYSTEM),
    });
  }

  const bloodPressure = buildBloodPressurePanel(vitals, patientId, effectiveDateTime);
  return bloodPressure ? [bloodPressure, ...observations] : observations;
}

/** Code lookups for classical exam findings (backed by `case-sheet-codes.ts`). */
export interface CaseSheetCodeResolver {
  readonly system: string;
  categoryCode(examType: string, categoryKey: string): string | null;
  optionCode(examType: string, categoryKey: string, storedOption: string): string | null;
}

export interface ExamFindingSource {
  readonly id: string;
  readonly visitId: string;
  readonly examType: string;
  readonly categoryKey: string;
  readonly selectedOptions: readonly string[];
  readonly remark: string | null;
  readonly createdAt: Date | string;
}

/**
 * One Observation per finding. The category code comes from the case-sheet CodeSystem when it
 * has one; each selected option becomes a Coding (when coded) and the stored labels are kept
 * verbatim in `valueCodeableConcept.text`. A finding with neither options nor remark is skipped.
 */
export function mapExamFindingToObservation(
  finding: ExamFindingSource,
  patientId: string,
  codes: CaseSheetCodeResolver
): FhirObservation | null {
  const options = finding.selectedOptions
    .map(option => cleanText(option))
    .filter((option): option is string => option !== null);
  const remark = cleanText(finding.remark);
  if (options.length === 0 && remark === null) return null;

  const categoryCode = codes.categoryCode(finding.examType, finding.categoryKey);
  const optionCodings = options.flatMap(option => {
    const code = codes.optionCode(finding.examType, finding.categoryKey, option);
    return code ? [{ system: codes.system, code, display: option }] : [];
  });
  const effectiveDateTime = toInstant(finding.createdAt);

  return {
    resourceType: 'Observation',
    id: finding.id,
    status: 'final',
    category: [
      categoryConcept('exam'),
      { coding: [{ system: CASE_SHEET_SECTION_SYSTEM, code: finding.examType }] },
    ],
    code: {
      ...(categoryCode
        ? { coding: [{ system: codes.system, code: categoryCode, display: finding.categoryKey }] }
        : {}),
      text: finding.categoryKey,
    },
    subject: reference('Patient', patientId),
    encounter: reference('Encounter', finding.visitId),
    ...(effectiveDateTime ? { effectiveDateTime } : {}),
    ...(options.length > 0
      ? {
          valueCodeableConcept: {
            ...(optionCodings.length > 0 ? { coding: optionCodings } : {}),
            text: options.join(', '),
          },
        }
      : {}),
    ...(remark ? { note: [{ text: remark }] } : {}),
  };
}
