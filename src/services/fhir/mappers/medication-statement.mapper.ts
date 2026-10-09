import type { FhirMedicationStatement } from '@services/fhir/fhir.types';
import { cleanText, reference, toInstant } from '@services/fhir/mappers/fhir-mapper.util';

/** EHR `Medication` row. */
export interface MedicationSource {
  readonly id: string;
  readonly name: string;
  readonly dosage: string;
  readonly frequency: string;
  readonly startDate: Date | string;
  readonly endDate?: Date | string | null;
  readonly prescribedBy?: string | null;
  readonly purpose?: string | null;
  readonly notes?: string | null;
  readonly isActive: boolean;
}

export function mapMedicationStatement(
  source: MedicationSource,
  patientId: string
): FhirMedicationStatement {
  const start = toInstant(source.startDate);
  const end = toInstant(source.endDate);
  const dosage = [cleanText(source.dosage), cleanText(source.frequency)]
    .filter((part): part is string => part !== null)
    .join(', ');
  const purpose = cleanText(source.purpose);
  const prescriber = cleanText(source.prescribedBy);
  const notes = cleanText(source.notes);
  return {
    resourceType: 'MedicationStatement',
    id: source.id,
    status: source.isActive ? 'active' : 'completed',
    medicationCodeableConcept: { text: source.name },
    subject: reference('Patient', patientId),
    ...(start || end
      ? { effectivePeriod: { ...(start ? { start } : {}), ...(end ? { end } : {}) } }
      : {}),
    ...(prescriber ? { informationSource: { display: prescriber } } : {}),
    ...(purpose ? { reasonCode: [{ text: purpose }] } : {}),
    ...(dosage ? { dosage: [{ text: dosage }] } : {}),
    ...(notes ? { note: [{ text: notes }] } : {}),
  };
}
