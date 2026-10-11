import type {
  PatientIdentifierRecord,
  PatientIdentifierSystem,
} from '@core/types/compliance.types';
import {
  ABHA_ADDRESS_IDENTIFIER_SYSTEM,
  ABHA_NUMBER_IDENTIFIER_SYSTEM,
  LEGACY_REGISTRATION_IDENTIFIER_SYSTEM,
  UHID_IDENTIFIER_SYSTEM,
  V2_IDENTIFIER_TYPE_SYSTEM,
} from '@services/fhir/fhir.constants';
import type {
  AdministrativeGender,
  FhirContactPoint,
  FhirHumanName,
  FhirIdentifier,
  FhirPatient,
} from '@services/fhir/fhir.types';
import { cleanText, toFhirDate } from '@services/fhir/mappers/fhir-mapper.util';

export interface PatientSource {
  /** Patient.id */
  readonly id: string;
  readonly name: string | null;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  readonly gender?: string | null;
  readonly dateOfBirth?: Date | string | null;
  readonly phone?: string | null;
  readonly email?: string | null;
}

const IDENTIFIER_SYSTEM_URIS: Readonly<Record<PatientIdentifierSystem, string>> = {
  UHID: UHID_IDENTIFIER_SYSTEM,
  ABHA_NUMBER: ABHA_NUMBER_IDENTIFIER_SYSTEM,
  ABHA_ADDRESS: ABHA_ADDRESS_IDENTIFIER_SYSTEM,
  LEGACY_REGISTRATION: LEGACY_REGISTRATION_IDENTIFIER_SYSTEM,
};

export function mapGender(value: string | null | undefined): AdministrativeGender {
  switch ((value ?? '').trim().toLowerCase()) {
    case 'male':
    case 'm':
      return 'male';
    case 'female':
    case 'f':
      return 'female';
    case 'other':
    case 'o':
      return 'other';
    default:
      return 'unknown';
  }
}

export function mapPatientIdentifier(record: PatientIdentifierRecord): FhirIdentifier {
  const base: FhirIdentifier = {
    system: IDENTIFIER_SYSTEM_URIS[record.system],
    value: record.value,
  };
  if (record.system === 'UHID') {
    return {
      ...base,
      use: 'usual',
      type: {
        coding: [
          { system: V2_IDENTIFIER_TYPE_SYSTEM, code: 'MR', display: 'Medical record number' },
        ],
      },
    };
  }
  return base;
}

function buildName(source: PatientSource): FhirHumanName[] {
  const text = cleanText(source.name);
  const given = cleanText(source.firstName);
  const family = cleanText(source.lastName);
  const display = text ?? [given, family].filter(Boolean).join(' ');
  if (!display) return [];
  return [
    {
      use: 'official',
      text: display,
      ...(family ? { family } : {}),
      ...(given ? { given: [given] } : {}),
    },
  ];
}

function buildTelecom(source: PatientSource): FhirContactPoint[] {
  const phone = cleanText(source.phone);
  const email = cleanText(source.email);
  return [
    ...(phone ? [{ system: 'phone' as const, value: phone }] : []),
    ...(email ? [{ system: 'email' as const, value: email }] : []),
  ];
}

export function mapPatient(
  source: PatientSource,
  identifiers: readonly PatientIdentifierRecord[]
): FhirPatient {
  const name = buildName(source);
  const telecom = buildTelecom(source);
  const birthDate = toFhirDate(source.dateOfBirth);
  return {
    resourceType: 'Patient',
    id: source.id,
    ...(identifiers.length > 0 ? { identifier: identifiers.map(mapPatientIdentifier) } : {}),
    active: true,
    ...(name.length > 0 ? { name } : {}),
    ...(telecom.length > 0 ? { telecom } : {}),
    gender: mapGender(source.gender),
    ...(birthDate ? { birthDate } : {}),
  };
}
