import {
  FHIR_JSON_CONTENT_TYPE,
  FHIR_VERSION,
  PATIENT_EVERYTHING_OPERATION_URL,
} from '@services/fhir/fhir.constants';
import type { FhirCapabilityStatement } from '@services/fhir/fhir.types';

const PATIENT_SEARCH_PARAM = {
  name: 'patient',
  type: 'reference' as const,
  documentation: 'Patient.id of a patient registered with the caller clinic. Required.',
};

const SEARCHABLE_TYPES = [
  'Encounter',
  'Observation',
  'Condition',
  'AllergyIntolerance',
  'MedicationStatement',
] as const;

/**
 * The server's CapabilityStatement. Read-only by design: only `read` and `search-type`
 * interactions are advertised, and `search-type` supports the single `patient` parameter.
 */
export function buildCapabilityStatement(date: Date): FhirCapabilityStatement {
  return {
    resourceType: 'CapabilityStatement',
    status: 'active',
    date: date.toISOString(),
    kind: 'instance',
    description:
      'Read-only HL7 FHIR R4 view of clinic records. No create, update, delete, history or ' +
      'transaction interactions are supported. Search is limited to the `patient` parameter.',
    software: { name: 'Ishswami Healthcare FHIR read layer' },
    fhirVersion: FHIR_VERSION,
    format: [FHIR_JSON_CONTENT_TYPE],
    rest: [
      {
        mode: 'server',
        documentation:
          'Authenticated clinic-scoped access only. Every read is recorded in the PHI audit log.',
        resource: [
          {
            type: 'Patient',
            interaction: [{ code: 'read' }],
            operation: [{ name: 'everything', definition: PATIENT_EVERYTHING_OPERATION_URL }],
          },
          ...SEARCHABLE_TYPES.map(type => ({
            type,
            interaction: [{ code: 'read' as const }, { code: 'search-type' as const }],
            searchParam: [PATIENT_SEARCH_PARAM],
          })),
        ],
      },
    ],
  };
}
