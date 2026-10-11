import { ALLERGY_CLINICAL_SYSTEM } from '@services/fhir/fhir.constants';
import type { FhirAllergyIntolerance, FhirAllergyReaction } from '@services/fhir/fhir.types';
import { cleanText, reference, toInstant } from '@services/fhir/mappers/fhir-mapper.util';

/** EHR `Allergy` row. */
export interface AllergySource {
  readonly id: string;
  readonly allergen: string;
  readonly severity: string;
  readonly reaction: string;
  readonly diagnosedDate: Date | string;
  readonly notes?: string | null;
}

/** Free-text allergy notes captured on the visit case sheet. */
export interface VisitAllergyNotesSource {
  readonly visitId: string;
  readonly foodAllergyNotes: string | null;
  readonly drugAllergyNotes: string | null;
  readonly registrationDate: Date | string;
}

const ACTIVE_STATUS = { coding: [{ system: ALLERGY_CLINICAL_SYSTEM, code: 'active' }] };

function mapSeverity(value: string): FhirAllergyReaction['severity'] | undefined {
  switch (value.trim().toLowerCase()) {
    case 'mild':
    case 'low':
      return 'mild';
    case 'moderate':
    case 'medium':
      return 'moderate';
    case 'severe':
    case 'high':
      return 'severe';
    default:
      return undefined;
  }
}

export function mapAllergy(source: AllergySource, patientId: string): FhirAllergyIntolerance {
  const reaction = cleanText(source.reaction);
  const severity = mapSeverity(source.severity);
  const notes = cleanText(source.notes);
  const recordedDate = toInstant(source.diagnosedDate);
  return {
    resourceType: 'AllergyIntolerance',
    id: source.id,
    clinicalStatus: ACTIVE_STATUS,
    code: { text: source.allergen },
    patient: reference('Patient', patientId),
    ...(recordedDate ? { recordedDate } : {}),
    ...(reaction
      ? {
          reaction: [{ manifestation: [{ text: reaction }], ...(severity ? { severity } : {}) }],
        }
      : {}),
    ...(notes ? { note: [{ text: notes }] } : {}),
  };
}

/** Food and drug allergy free text from a visit becomes up to two text-only AllergyIntolerances. */
export function mapVisitAllergyNotes(
  source: VisitAllergyNotesSource,
  patientId: string
): FhirAllergyIntolerance[] {
  const recordedDate = toInstant(source.registrationDate);
  const entries: Array<{ suffix: string; text: string | null; category: 'food' | 'medication' }> = [
    { suffix: 'food-allergy', text: cleanText(source.foodAllergyNotes), category: 'food' },
    { suffix: 'drug-allergy', text: cleanText(source.drugAllergyNotes), category: 'medication' },
  ];
  return entries.flatMap(entry =>
    entry.text
      ? [
          {
            resourceType: 'AllergyIntolerance' as const,
            id: `${source.visitId}-${entry.suffix}`,
            clinicalStatus: ACTIVE_STATUS,
            category: [entry.category],
            code: { text: entry.text },
            patient: reference('Patient', patientId),
            ...(recordedDate ? { recordedDate } : {}),
          },
        ]
      : []
  );
}
