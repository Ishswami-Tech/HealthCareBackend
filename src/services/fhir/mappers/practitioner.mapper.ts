import { DOCTOR_LICENSE_IDENTIFIER_SYSTEM } from '@services/fhir/fhir.constants';
import type { FhirPractitioner } from '@services/fhir/fhir.types';
import { cleanText } from '@services/fhir/mappers/fhir-mapper.util';

export interface PractitionerSource {
  /** Doctor.id */
  readonly id: string;
  readonly name: string | null;
  readonly licenseNumber?: string | null;
  readonly qualification?: string | null;
}

export function mapPractitioner(source: PractitionerSource): FhirPractitioner {
  const license = cleanText(source.licenseNumber);
  const name = cleanText(source.name);
  const qualification = cleanText(source.qualification);
  return {
    resourceType: 'Practitioner',
    id: source.id,
    ...(license
      ? { identifier: [{ system: DOCTOR_LICENSE_IDENTIFIER_SYSTEM, value: license }] }
      : {}),
    active: true,
    ...(name ? { name: [{ use: 'official' as const, text: name }] } : {}),
    ...(qualification ? { qualification: [{ code: { text: qualification } }] } : {}),
  };
}
