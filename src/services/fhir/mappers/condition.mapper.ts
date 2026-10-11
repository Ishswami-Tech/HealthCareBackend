import type { MedicalCoding } from '@core/types/compliance.types';
import {
  CONDITION_CLINICAL_SYSTEM,
  CONDITION_VER_STATUS_SYSTEM,
} from '@services/fhir/fhir.constants';
import type { FhirAnnotation, FhirCodeableConcept, FhirCondition } from '@services/fhir/fhir.types';
import { cleanText, reference, toInstant } from '@services/fhir/mappers/fhir-mapper.util';

export interface DiagnosisSource {
  readonly id: string;
  readonly patientId: string;
  readonly primaryDisease: string;
  readonly secondaryDiseases?: readonly string[] | null;
  readonly clinicalAssessment?: string | null;
  readonly confidenceLevel?: string | null;
  readonly status: string;
  readonly diagnosedAt: Date | string;
  /** Standard codes chosen for the diagnosis (ICD-10 / ICD-11 / SNOMED / NAMASTE). */
  readonly codings?: readonly MedicalCoding[] | null | undefined;
}

function clinicalStatus(status: string): FhirCodeableConcept {
  const normalised = status.trim().toUpperCase();
  const code =
    normalised === 'ACTIVE' ? 'active' : normalised === 'RESOLVED' ? 'resolved' : 'inactive';
  return { coding: [{ system: CONDITION_CLINICAL_SYSTEM, code }] };
}

/** high -> confirmed, low/medium -> provisional; unknown/absent leaves the element out. */
function verificationStatus(confidence: string | null | undefined): FhirCodeableConcept | null {
  switch ((confidence ?? '').trim().toLowerCase()) {
    case 'high':
      return { coding: [{ system: CONDITION_VER_STATUS_SYSTEM, code: 'confirmed' }] };
    case 'medium':
    case 'low':
      return { coding: [{ system: CONDITION_VER_STATUS_SYSTEM, code: 'provisional' }] };
    default:
      return null;
  }
}

/** Keep only well-formed codings (system and code present); never invent either. */
function validCodings(codings: readonly MedicalCoding[] | null | undefined): MedicalCoding[] {
  return (codings ?? []).filter(
    coding => cleanText(coding.system) !== null && cleanText(coding.code) !== null
  );
}

export function mapCondition(source: DiagnosisSource): FhirCondition {
  const codings = validCodings(source.codings);
  const secondary = (source.secondaryDiseases ?? [])
    .map(disease => cleanText(disease))
    .filter((disease): disease is string => disease !== null);
  const assessment = cleanText(source.clinicalAssessment);
  const notes: FhirAnnotation[] = [
    ...(assessment ? [{ text: assessment }] : []),
    ...(secondary.length > 0 ? [{ text: `Secondary diagnoses: ${secondary.join(', ')}` }] : []),
  ];
  const verification = verificationStatus(source.confidenceLevel);
  const recordedDate = toInstant(source.diagnosedAt);

  return {
    resourceType: 'Condition',
    id: source.id,
    clinicalStatus: clinicalStatus(source.status),
    ...(verification ? { verificationStatus: verification } : {}),
    code: {
      ...(codings.length > 0
        ? {
            coding: codings.map(coding => ({
              system: coding.system,
              code: coding.code,
              ...(coding.display ? { display: coding.display } : {}),
            })),
          }
        : {}),
      text: source.primaryDisease,
    },
    subject: reference('Patient', source.patientId),
    ...(recordedDate ? { recordedDate } : {}),
    ...(notes.length > 0 ? { note: notes } : {}),
  };
}
