import {
  ENCOUNTER_IN_PROGRESS_WINDOW_MS,
  OPD_NUMBER_IDENTIFIER_SYSTEM,
  V3_ACT_CODE_SYSTEM,
} from '@services/fhir/fhir.constants';
import type { EncounterStatus, FhirEncounter } from '@services/fhir/fhir.types';
import { cleanText, reference, toInstant } from '@services/fhir/mappers/fhir-mapper.util';

export interface VisitSource {
  readonly id: string;
  readonly opdNumber: string;
  readonly registrationDate: Date | string;
  readonly patientId: string;
  readonly doctorId: string | null;
  readonly presentComplaints: string | null;
}

/**
 * Status rule: a visit has no explicit status column, so an OPD visit registered within the
 * last 24 hours is `in-progress` (the case sheet may still be edited) and anything older is
 * `finished`. `now` is injected so the rule is deterministic in tests.
 */
export function deriveEncounterStatus(registrationDate: Date | string, now: Date): EncounterStatus {
  const registered = new Date(registrationDate).getTime();
  if (Number.isNaN(registered)) return 'finished';
  return now.getTime() - registered < ENCOUNTER_IN_PROGRESS_WINDOW_MS ? 'in-progress' : 'finished';
}

export function mapEncounter(visit: VisitSource, now: Date): FhirEncounter {
  const start = toInstant(visit.registrationDate);
  const complaints = cleanText(visit.presentComplaints);
  return {
    resourceType: 'Encounter',
    id: visit.id,
    identifier: [{ use: 'usual', system: OPD_NUMBER_IDENTIFIER_SYSTEM, value: visit.opdNumber }],
    status: deriveEncounterStatus(visit.registrationDate, now),
    class: { system: V3_ACT_CODE_SYSTEM, code: 'AMB', display: 'ambulatory' },
    subject: reference('Patient', visit.patientId),
    ...(visit.doctorId
      ? { participant: [{ individual: reference('Practitioner', visit.doctorId) }] }
      : {}),
    period: start ? { start } : {},
    ...(complaints ? { reasonCode: [{ text: complaints }] } : {}),
  };
}
