import { describe, it, expect } from '@jest/globals';
import type { PatientIdentifierRecord } from '@core/types/compliance.types';
import {
  ABHA_NUMBER_IDENTIFIER_SYSTEM,
  DOCTOR_LICENSE_IDENTIFIER_SYSTEM,
  FHIR_VERSION,
  LOINC_SYSTEM,
  UHID_IDENTIFIER_SYSTEM,
} from '@services/fhir/fhir.constants';
import type { FhirObservation } from '@services/fhir/fhir.types';
import { mapAllergy, mapVisitAllergyNotes } from '@services/fhir/mappers/allergy.mapper';
import { buildCollectionBundle, buildSearchsetBundle } from '@services/fhir/mappers/bundle.mapper';
import { buildCapabilityStatement } from '@services/fhir/mappers/capability-statement';
import { mapCondition } from '@services/fhir/mappers/condition.mapper';
import { deriveEncounterStatus, mapEncounter } from '@services/fhir/mappers/encounter.mapper';
import { mapMedicationStatement } from '@services/fhir/mappers/medication-statement.mapper';
import {
  mapExamFindingToObservation,
  mapVitalsToObservations,
} from '@services/fhir/mappers/observation.mapper';
import type {
  CaseSheetCodeResolver,
  VitalsSource,
} from '@services/fhir/mappers/observation.mapper';
import { buildOperationOutcome } from '@services/fhir/mappers/operation-outcome';
import { mapPatient } from '@services/fhir/mappers/patient.mapper';
import { mapPractitioner } from '@services/fhir/mappers/practitioner.mapper';

const NOW = new Date('2026-10-10T10:00:00.000Z');

function identifier(
  system: PatientIdentifierRecord['system'],
  value: string
): PatientIdentifierRecord {
  return {
    id: `id-${value}`,
    patientId: 'p1',
    clinicId: 'c1',
    system,
    value,
    source: 'test',
    createdAt: NOW,
  };
}

const EMPTY_VITALS: VitalsSource = {
  visitId: 'v1',
  heightCm: null,
  weightKg: null,
  bmi: null,
  temperatureC: null,
  pulse: null,
  bpSystolic: null,
  bpDiastolic: null,
  rr: null,
  painScore: null,
  fbs: null,
  ppbs: null,
  pbs: null,
  spo2: null,
  neck: null,
  chest: null,
  upperAbs: null,
  waist: null,
  lowerAbs: null,
  hips: null,
  thighLeft: null,
  thighRight: null,
  calfLeft: null,
  calfRight: null,
  upperArmLeft: null,
  upperArmRight: null,
  createdAt: NOW,
};

const CODES: CaseSheetCodeResolver = {
  system: 'urn:test:case-sheet',
  categoryCode: (_examType, categoryKey) => (categoryKey === 'nadi' ? 'nadi' : null),
  optionCode: (_examType, _categoryKey, option) => (option === 'वात' ? 'vata' : null),
};

describe('Patient mapper', () => {
  it('maps demographics and every identifier system', () => {
    const patient = mapPatient(
      {
        id: 'p1',
        name: 'Asha Rao',
        firstName: 'Asha',
        lastName: 'Rao',
        gender: 'FEMALE',
        dateOfBirth: new Date('1990-04-05T00:00:00.000Z'),
        phone: '+919999999999',
        email: 'asha@example.com',
      },
      [
        identifier('UHID', 'UH-1'),
        identifier('ABHA_NUMBER', '12-3456-7890-1234'),
        identifier('ABHA_ADDRESS', 'asha@abdm'),
        identifier('LEGACY_REGISTRATION', 'OLD-9'),
      ]
    );

    expect(patient.resourceType).toBe('Patient');
    expect(patient.gender).toBe('female');
    expect(patient.birthDate).toBe('1990-04-05');
    expect(patient.name?.[0]).toEqual({
      use: 'official',
      text: 'Asha Rao',
      family: 'Rao',
      given: ['Asha'],
    });
    expect(patient.telecom).toEqual([
      { system: 'phone', value: '+919999999999' },
      { system: 'email', value: 'asha@example.com' },
    ]);
    expect(patient.identifier).toHaveLength(4);
    expect(patient.identifier?.[0]).toMatchObject({
      system: UHID_IDENTIFIER_SYSTEM,
      value: 'UH-1',
      use: 'usual',
    });
    expect(patient.identifier?.[1]?.system).toBe(ABHA_NUMBER_IDENTIFIER_SYSTEM);
  });

  it('omits identifier, telecom, name and birthDate when there is nothing to report', () => {
    const patient = mapPatient({ id: 'p2', name: null }, []);
    expect(patient).toEqual({ resourceType: 'Patient', id: 'p2', active: true, gender: 'unknown' });
  });
});

describe('Practitioner mapper', () => {
  it('uses the licence number as the identifier under the licence system', () => {
    const practitioner = mapPractitioner({
      id: 'd1',
      name: 'Dr. Mehta',
      licenseNumber: ' MH-123 ',
      qualification: 'BAMS',
    });
    expect(practitioner.identifier).toEqual([
      { system: DOCTOR_LICENSE_IDENTIFIER_SYSTEM, value: 'MH-123' },
    ]);
    expect(practitioner.qualification?.[0]?.code.text).toBe('BAMS');
  });

  it('has no identifier without a licence number', () => {
    expect(
      mapPractitioner({ id: 'd2', name: null, licenseNumber: '  ' }).identifier
    ).toBeUndefined();
  });
});

describe('Encounter mapper', () => {
  const visit = {
    id: 'v1',
    opdNumber: 'OPD-0001',
    registrationDate: '2026-10-10T08:00:00.000Z',
    patientId: 'p1',
    doctorId: 'd1',
    presentComplaints: 'Knee pain',
  };

  it('maps OPD number, period, reason and participants', () => {
    const encounter = mapEncounter(visit, NOW);
    expect(encounter.identifier?.[0]?.value).toBe('OPD-0001');
    expect(encounter.period.start).toBe('2026-10-10T08:00:00.000Z');
    expect(encounter.reasonCode?.[0]?.text).toBe('Knee pain');
    expect(encounter.subject.reference).toBe('Patient/p1');
    expect(encounter.participant?.[0]?.individual.reference).toBe('Practitioner/d1');
    expect(encounter.class.code).toBe('AMB');
  });

  it('is in-progress within 24h of registration and finished afterwards', () => {
    expect(deriveEncounterStatus('2026-10-10T08:00:00.000Z', NOW)).toBe('in-progress');
    expect(deriveEncounterStatus('2026-10-08T08:00:00.000Z', NOW)).toBe('finished');
  });
});

describe('Vitals observations', () => {
  it('skips null vitals entirely', () => {
    expect(mapVitalsToObservations(EMPTY_VITALS, 'p1')).toEqual([]);
  });

  it('emits LOINC-coded vitals with UCUM quantities', () => {
    const observations = mapVitalsToObservations(
      {
        ...EMPTY_VITALS,
        weightKg: 70,
        heightCm: 172,
        temperatureC: 37,
        pulse: 80,
        spo2: 98,
        rr: 16,
        bmi: 23.7,
      },
      'p1'
    );
    const loincById = Object.fromEntries(observations.map(o => [o.id, o.code.coding?.[0]?.code]));
    expect(loincById).toEqual({
      'v1-weight': '29463-7',
      'v1-height': '8302-2',
      'v1-temperature': '8310-5',
      'v1-heart-rate': '8867-4',
      'v1-spo2': '59408-5',
      'v1-respiratory-rate': '9279-1',
      'v1-bmi': '39156-5',
    });
    const weight = observations.find(o => o.id === 'v1-weight');
    expect(weight?.code.coding?.[0]?.system).toBe(LOINC_SYSTEM);
    expect(weight?.valueQuantity).toMatchObject({ value: 70, unit: 'kg', code: 'kg' });
    expect(weight?.encounter?.reference).toBe('Encounter/v1');
  });

  it('builds the blood pressure panel with systolic and diastolic components', () => {
    const [panel] = mapVitalsToObservations(
      { ...EMPTY_VITALS, bpSystolic: 120, bpDiastolic: 80 },
      'p1'
    );
    expect(panel?.code.coding?.[0]?.code).toBe('85354-9');
    expect(panel?.component?.map(c => c.code.coding?.[0]?.code)).toEqual(['8480-6', '8462-4']);
    expect(panel?.component?.[0]?.valueQuantity).toMatchObject({ value: 120, code: 'mm[Hg]' });
  });

  it('keeps a partial blood pressure and drops it when both are missing', () => {
    const [systolicOnly] = mapVitalsToObservations({ ...EMPTY_VITALS, bpSystolic: 130 }, 'p1');
    expect(systolicOnly?.component).toHaveLength(1);
    expect(mapVitalsToObservations({ ...EMPTY_VITALS, bpSystolic: null }, 'p1')).toEqual([]);
  });

  it('emits readings without a certain LOINC as text-only', () => {
    const observations = mapVitalsToObservations(
      { ...EMPTY_VITALS, fbs: 95, painScore: 4, waist: 80 },
      'p1'
    );
    expect(observations).toHaveLength(3);
    for (const observation of observations) {
      expect(observation.code.coding).toBeUndefined();
      expect(observation.code.text).toBeTruthy();
    }
  });
});

describe('Classical exam finding observation', () => {
  const finding = {
    id: 'f1',
    visitId: 'v1',
    examType: 'ASHTAVIDHA_PARIKSHA',
    categoryKey: 'nadi',
    selectedOptions: ['वात', 'अज्ञात'],
    remark: 'Irregular at rest',
    createdAt: NOW,
  };

  it('codes the category, codes only known options, keeps labels and the remark', () => {
    const observation = mapExamFindingToObservation(finding, 'p1', CODES) as FhirObservation;
    expect(observation.id).toBe('f1');
    expect(observation.code).toEqual({
      coding: [{ system: 'urn:test:case-sheet', code: 'nadi', display: 'nadi' }],
      text: 'nadi',
    });
    expect(observation.valueCodeableConcept?.coding).toEqual([
      { system: 'urn:test:case-sheet', code: 'vata', display: 'वात' },
    ]);
    expect(observation.valueCodeableConcept?.text).toBe('वात, अज्ञात');
    expect(observation.note).toEqual([{ text: 'Irregular at rest' }]);
    expect(observation.encounter?.reference).toBe('Encounter/v1');
  });

  it('falls back to text when the category has no code', () => {
    const observation = mapExamFindingToObservation(
      { ...finding, categoryKey: 'unknown-cat', selectedOptions: ['x'] },
      'p1',
      CODES
    ) as FhirObservation;
    expect(observation.code.coding).toBeUndefined();
    expect(observation.valueCodeableConcept?.coding).toBeUndefined();
  });

  it('skips a finding with neither options nor remark', () => {
    expect(
      mapExamFindingToObservation({ ...finding, selectedOptions: [], remark: ' ' }, 'p1', CODES)
    ).toBeNull();
  });
});

describe('Condition mapper', () => {
  const base = {
    id: 'dx1',
    patientId: 'p1',
    primaryDisease: 'Amavata',
    status: 'ACTIVE',
    diagnosedAt: NOW,
  };

  it('uses codings when present and keeps the free text', () => {
    const condition = mapCondition({
      ...base,
      confidenceLevel: 'high',
      codings: [
        {
          system: 'http://hl7.org/fhir/sid/icd-10',
          code: 'M06.9',
          display: 'Rheumatoid arthritis',
        },
        { system: '', code: 'bad' },
      ],
    });
    expect(condition.code.coding).toEqual([
      { system: 'http://hl7.org/fhir/sid/icd-10', code: 'M06.9', display: 'Rheumatoid arthritis' },
    ]);
    expect(condition.code.text).toBe('Amavata');
    expect(condition.clinicalStatus.coding?.[0]?.code).toBe('active');
    expect(condition.verificationStatus?.coding?.[0]?.code).toBe('confirmed');
  });

  it('is text-only without codings', () => {
    for (const codings of [undefined, null, []]) {
      const condition = mapCondition({ ...base, status: 'RESOLVED', codings });
      expect(condition.code).toEqual({ text: 'Amavata' });
      expect(condition.clinicalStatus.coding?.[0]?.code).toBe('resolved');
      expect(condition.verificationStatus).toBeUndefined();
    }
  });
});

describe('Allergy and medication mappers', () => {
  it('maps an EHR allergy with severity and reaction', () => {
    const allergy = mapAllergy(
      {
        id: 'a1',
        allergen: 'Penicillin',
        severity: 'Severe',
        reaction: 'Rash',
        diagnosedDate: NOW,
      },
      'p1'
    );
    expect(allergy.code.text).toBe('Penicillin');
    expect(allergy.reaction?.[0]?.severity).toBe('severe');
    expect(allergy.patient.reference).toBe('Patient/p1');
  });

  it('turns visit free-text allergies into food and medication categories', () => {
    const allergies = mapVisitAllergyNotes(
      {
        visitId: 'v1',
        foodAllergyNotes: 'Peanuts',
        drugAllergyNotes: ' ',
        registrationDate: NOW,
      },
      'p1'
    );
    expect(allergies).toHaveLength(1);
    expect(allergies[0]).toMatchObject({ id: 'v1-food-allergy', category: ['food'] });
  });

  it('maps a medication to a MedicationStatement', () => {
    const statement = mapMedicationStatement(
      {
        id: 'm1',
        name: 'Ashwagandha',
        dosage: '500 mg',
        frequency: 'twice daily',
        startDate: NOW,
        endDate: null,
        isActive: false,
      },
      'p1'
    );
    expect(statement.status).toBe('completed');
    expect(statement.dosage?.[0]?.text).toBe('500 mg, twice daily');
    expect(statement.effectivePeriod).toEqual({ start: NOW.toISOString() });
  });
});

describe('Bundles', () => {
  const patient = mapPatient({ id: 'p1', name: 'A' }, []);
  const encounter = mapEncounter(
    {
      id: 'v1',
      opdNumber: 'O1',
      registrationDate: NOW,
      patientId: 'p1',
      doctorId: null,
      presentComplaints: null,
    },
    NOW
  );

  it('searchset carries total equal to the entries', () => {
    const bundle = buildSearchsetBundle([encounter, encounter], NOW);
    expect(bundle.type).toBe('searchset');
    expect(bundle.total).toBe(2);
    expect(bundle.entry).toHaveLength(2);
    expect(bundle.entry[0]).toMatchObject({ fullUrl: 'Encounter/v1', search: { mode: 'match' } });
    expect(buildSearchsetBundle([], NOW).total).toBe(0);
  });

  it('collection has no total and holds the resources in order', () => {
    const bundle = buildCollectionBundle([patient, encounter], NOW);
    expect(bundle.type).toBe('collection');
    expect(bundle.total).toBeUndefined();
    expect(bundle.entry.map(e => e.resource.resourceType)).toEqual(['Patient', 'Encounter']);
    expect(bundle.timestamp).toBe(NOW.toISOString());
  });
});

describe('CapabilityStatement', () => {
  const statement = buildCapabilityStatement(NOW);

  it('is an R4 instance statement', () => {
    expect(statement.resourceType).toBe('CapabilityStatement');
    expect(statement.fhirVersion).toBe(FHIR_VERSION);
    expect(statement.fhirVersion).toBe('4.0.1');
    expect(statement.kind).toBe('instance');
    expect(statement.format).toContain('application/fhir+json');
  });

  it('advertises only read and search-type interactions', () => {
    const resources = statement.rest[0]?.resource ?? [];
    const codes = new Set(resources.flatMap(r => r.interaction.map(i => i.code)));
    expect([...codes].sort()).toEqual(['read', 'search-type']);
    expect(resources.map(r => r.type)).toEqual(
      expect.arrayContaining(['Patient', 'Encounter', 'Observation', 'Condition'])
    );
    const patient = resources.find(r => r.type === 'Patient');
    expect(patient?.interaction).toEqual([{ code: 'read' }]);
    expect(patient?.operation?.[0]?.name).toBe('everything');
    expect(statement.description.toLowerCase()).toContain('read-only');
  });
});

describe('OperationOutcome', () => {
  it('maps status to an issue code', () => {
    expect(buildOperationOutcome(404, 'nope').issue[0]).toEqual({
      severity: 'error',
      code: 'not-found',
      diagnostics: 'nope',
    });
    expect(buildOperationOutcome(403, 'x').issue[0]?.code).toBe('forbidden');
    expect(buildOperationOutcome(500, 'x').issue[0]).toMatchObject({
      severity: 'fatal',
      code: 'exception',
    });
  });
});
