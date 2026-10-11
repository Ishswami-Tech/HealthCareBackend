# FHIR R4 read layer

A **read-only** HL7 FHIR R4 (4.0.1) view of clinic records, served under
`/fhir`. It reuses the existing services (EHR, patients, patient visits,
Ayurveda diagnoses, doctors, compliance) and owns no queries of its own.
Responses are `application/fhir+json`; errors are `OperationOutcome` bodies.

## Routes

| Route                                    | Roles                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------ |
| `GET /fhir/metadata`                     | any authenticated role                                                         |
| `GET /fhir/Patient/:id`                  | DOCTOR, ASSISTANT_DOCTOR, CLINIC_ADMIN, SUPER_ADMIN, PATIENT (own record only) |
| `GET /fhir/Patient/:id/$everything`      | same                                                                           |
| `GET /fhir/Encounter?patient=`           | same                                                                           |
| `GET /fhir/Observation?patient=`         | same                                                                           |
| `GET /fhir/Condition?patient=`           | same                                                                           |
| `GET /fhir/AllergyIntolerance?patient=`  | same                                                                           |
| `GET /fhir/MedicationStatement?patient=` | same                                                                           |

`:id` / `patient` is a Patient id (or the patient's User id; `Patient/<id>` is
accepted). The patient must belong to the caller's clinic. A PATIENT caller
asking for anyone else gets `404` (and a `DENIED` PHI audit row). Every FHIR
read is written to the PHI audit log (`FHIR_*` resource types; `$everything` is
recorded as `EXPORT`).

## What is mapped

- **Patient**: identifiers (UHID, ABHA number, ABHA address, legacy
  registration), name, gender, birthDate, phone/email.
- **Practitioner** (only inside `$everything`): Doctor licence number as
  identifier, name, qualification text.
- **Encounter**: one per OPD visit. identifier = OPD number, class `AMB`,
  period.start = registration date, reasonCode.text = present complaints. Status
  rule: a visit has no status column, so a visit registered in the last 24 hours
  is `in-progress`, older is `finished`.
- **Observation**: vitals from the visit's General Examination (LOINC where
  certain, see below), the blood pressure panel, and one coded Observation per
  classical exam finding (category code from the case-sheet CodeSystem, one
  Coding per selected option, stored labels kept in `text`, remark as `note`).
- **Condition**: Ayurvedic diagnoses. `code.coding` comes from the `codings`
  column when present, `code.text` is always the primary disease.
- **AllergyIntolerance**: EHR allergies plus the visit's food / drug allergy
  free text (text-only).
- **MedicationStatement**: EHR medications.
- **Bundle**: `collection` for `$everything`, `searchset` with `total` for
  searches. **CapabilityStatement** at `/fhir/metadata`.

LOINC codes emitted: body weight 29463-7, body height 8302-2, body temperature
8310-5, heart rate 8867-4, oxygen saturation 59408-5, respiratory rate 9279-1,
blood pressure panel 85354-9 (systolic 8480-6, diastolic 8462-4), BMI 39156-5.
Blood sugar, pain score and body circumferences are text-only: the specimen or
method is not recorded, so a code would be a guess.

All URIs live in `fhir.constants.ts`. The ABHA identifier systems there must be
verified against the current ABDM FHIR profile before ABDM go-live.

## What is NOT covered

- No write interactions (create / update / delete / patch / transaction /
  history). The controller has GET routes only.
- No search parameters other than `patient`; no `_count`, `_include`, paging.
  Lists read the 20 most recent visits and 100 most recent diagnoses.
- No FHIR profiles, no ABDM bundles (OP consultation record, prescription,
  etc.), no `meta.profile`, no signatures.
- ICD-10 / ICD-11 / SNOMED / NAMASTE datasets are not bundled. Codings are
  passed through exactly as stored on the diagnosis; free text is used when
  there are none.
- Lab reports, immunizations, family / medical history, therapy and diet charts
  are not mapped yet.
- Bundle `fullUrl` values are relative (`Patient/<id>`).
- A PATIENT cannot read a dependent's record through these routes.
