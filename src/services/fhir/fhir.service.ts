/**
 * FHIR R4 read service.
 * @module Fhir
 * @description Orchestrates the existing clinical services (EHR, patients, visits, Ayurveda
 * diagnoses, doctors, compliance) and maps their output to FHIR resources. It owns no queries of
 * its own and never writes clinical data; the only write is the PHI audit row for each read.
 */

import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode, HealthcareError } from '@core/errors';
import { Role } from '@core/types/enums.types';
import type { PhiAuditAction, PhiAuditEntry } from '@core/types/compliance.types';
import {
  CASE_SHEET_CODE_SYSTEM,
  categoryCode,
  optionCode,
} from '@services/ayurveda/data/case-sheet-codes';
import { AyurvedicDiagnosisService } from '@services/ayurveda/services/ayurvedic-diagnosis.service';
import { ClassicalExamService } from '@services/ayurveda/services/classical-exam.service';
import { PhiAuditService } from '@services/compliance/services/phi-audit.service';
import { PatientIdentifierService } from '@services/compliance/services/patient-identifier.service';
import { DoctorsService } from '@services/doctors/doctors.service';
import { EHRService } from '@services/ehr/ehr.service';
import {
  FHIR_MAX_DIAGNOSES_PER_QUERY,
  FHIR_MAX_VISITS_PER_QUERY,
} from '@services/fhir/fhir.constants';
import type {
  FhirAllergyIntolerance,
  FhirBundle,
  FhirCapabilityStatement,
  FhirClinicalResource,
  FhirCondition,
  FhirEncounter,
  FhirMedicationStatement,
  FhirObservation,
  FhirPatient,
  FhirOperationOutcome,
  FhirPractitioner,
  FhirResourceType,
} from '@services/fhir/fhir.types';
import {
  mapWithConcurrency,
  parseExportReason,
  parsePatientParam,
  VISIT_READ_CONCURRENCY,
} from '@services/fhir/fhir-request.util';
import type { ParseResult, RawQueryValue } from '@services/fhir/fhir-request.util';
import { buildTruncationOutcome } from '@services/fhir/mappers/operation-outcome';
import { mapAllergy, mapVisitAllergyNotes } from '@services/fhir/mappers/allergy.mapper';
import type { AllergySource } from '@services/fhir/mappers/allergy.mapper';
import { buildCollectionBundle, buildSearchsetBundle } from '@services/fhir/mappers/bundle.mapper';
import { buildCapabilityStatement } from '@services/fhir/mappers/capability-statement';
import { mapCondition } from '@services/fhir/mappers/condition.mapper';
import { mapEncounter } from '@services/fhir/mappers/encounter.mapper';
import { mapMedicationStatement } from '@services/fhir/mappers/medication-statement.mapper';
import type { MedicationSource } from '@services/fhir/mappers/medication-statement.mapper';
import {
  mapExamFindingToObservation,
  mapVitalsToObservations,
} from '@services/fhir/mappers/observation.mapper';
import type { CaseSheetCodeResolver } from '@services/fhir/mappers/observation.mapper';
import { mapPatient } from '@services/fhir/mappers/patient.mapper';
import type { PatientSource } from '@services/fhir/mappers/patient.mapper';
import { mapPractitioner } from '@services/fhir/mappers/practitioner.mapper';
import { PatientsService } from '@services/patients/patients.service';
import { PatientVisitsService } from '@services/patient-visits/patient-visits.service';
import { VisitVitalsExaminationService } from '@services/patient-visits/services/visit-vitals-examination.service';
import type { PatientVisitResponse, VisitVitalsExaminationResponse } from '@dtos/patient-visit.dto';
import type { ClassicalExamFindingResponse } from '@services/ayurveda/dto/classical-exam.dto';

/** Who is reading, as resolved by the controller from the authenticated request. */
export interface FhirActor {
  readonly userId: string;
  readonly role: string;
  readonly clinicId: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

interface ResolvedPatient {
  readonly id: string;
  readonly userId: string;
}

interface VisitClinicalData {
  readonly visit: PatientVisitResponse;
  readonly vitals: VisitVitalsExaminationResponse | null;
  readonly exams: ClassicalExamFindingResponse[];
}

const EVERYTHING_RESOURCE_TYPES: readonly FhirResourceType[] = [
  'Patient',
  'Practitioner',
  'Encounter',
  'Observation',
  'Condition',
  'AllergyIntolerance',
  'MedicationStatement',
];
const PATIENT_ROLE: string = Role.PATIENT;
const FHIR_READ_PURPOSE = 'FHIR read';

const CASE_SHEET_CODES: CaseSheetCodeResolver = {
  system: CASE_SHEET_CODE_SYSTEM,
  categoryCode,
  optionCode,
};

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function readDate(record: Record<string, unknown>, key: string): Date | string | null {
  const value = record[key];
  return value instanceof Date || typeof value === 'string' ? value : null;
}

@Injectable()
export class FhirService {
  constructor(
    private readonly ehrService: EHRService,
    private readonly patientsService: PatientsService,
    private readonly visitsService: PatientVisitsService,
    private readonly vitalsService: VisitVitalsExaminationService,
    private readonly classicalExamService: ClassicalExamService,
    private readonly diagnosisService: AyurvedicDiagnosisService,
    private readonly doctorsService: DoctorsService,
    private readonly identifierService: PatientIdentifierService,
    private readonly phiAudit: PhiAuditService
  ) {}

  getCapabilityStatement(): FhirCapabilityStatement {
    return buildCapabilityStatement(new Date());
  }

  async getPatient(patientParam: RawQueryValue, actor: FhirActor): Promise<FhirPatient> {
    const patient = await this.beginRead(patientParam, actor, 'Patient');
    return this.buildPatient(patient, actor.clinicId);
  }

  /**
   * Full export. The audit row is written first and fails closed: if it cannot be stored, no
   * clinical data is loaded. `reasonParam` (optional, max 200 chars) is stored as the purpose
   * and never echoed back.
   */
  async getEverything(
    patientParam: RawQueryValue,
    actor: FhirActor,
    reasonParam?: RawQueryValue
  ): Promise<FhirBundle> {
    const purpose = this.parseOrReject(parseExportReason(reasonParam));
    const patient = await this.resolveAuthorizedPatient(patientParam, actor);
    await this.phiAudit.recordStrict(
      this.auditEntry(
        actor,
        'EXPORT',
        'FHIR_BUNDLE',
        patient.id,
        EVERYTHING_RESOURCE_TYPES,
        purpose
      )
    );

    const now = new Date();
    const { data: visitData, total: totalVisits } = await this.loadVisitData(
      patient,
      actor.clinicId
    );
    const [patientResource, practitioners, conditions, allergies, medications] = await Promise.all([
      this.buildPatient(patient, actor.clinicId),
      this.buildPractitioners(visitData, actor.clinicId),
      this.buildConditions(patient, actor.clinicId),
      this.buildAllergies(patient, actor.clinicId, visitData),
      this.buildMedications(patient, actor.clinicId),
    ]);
    const resources: FhirClinicalResource[] = [
      patientResource,
      ...practitioners,
      ...this.buildEncounters(visitData, now),
      ...this.buildObservations(visitData, patient.id),
      ...conditions,
      ...allergies,
      ...medications,
    ];
    return buildCollectionBundle(resources, now, this.truncation(visitData.length, totalVisits));
  }

  async searchEncounters(
    patientParam: RawQueryValue,
    actor: FhirActor
  ): Promise<FhirBundle<FhirEncounter>> {
    const patient = await this.beginRead(patientParam, actor, 'Encounter');
    const { visits, total } = await this.loadVisits(patient, actor.clinicId);
    const now = new Date();
    return buildSearchsetBundle(
      visits.map(visit => mapEncounter(visit, now)),
      now,
      this.truncation(visits.length, total)
    );
  }

  async searchObservations(
    patientParam: RawQueryValue,
    actor: FhirActor
  ): Promise<FhirBundle<FhirObservation>> {
    const patient = await this.beginRead(patientParam, actor, 'Observation');
    const { data, total } = await this.loadVisitData(patient, actor.clinicId);
    return buildSearchsetBundle(
      this.buildObservations(data, patient.id),
      new Date(),
      this.truncation(data.length, total)
    );
  }

  async searchConditions(
    patientParam: RawQueryValue,
    actor: FhirActor
  ): Promise<FhirBundle<FhirCondition>> {
    const patient = await this.beginRead(patientParam, actor, 'Condition');
    const conditions = await this.buildConditions(patient, actor.clinicId);
    return buildSearchsetBundle(conditions, new Date());
  }

  async searchAllergies(
    patientParam: RawQueryValue,
    actor: FhirActor
  ): Promise<FhirBundle<FhirAllergyIntolerance>> {
    const patient = await this.beginRead(patientParam, actor, 'AllergyIntolerance');
    const { visits, total } = await this.loadVisits(patient, actor.clinicId);
    const allergies = await this.buildAllergies(
      patient,
      actor.clinicId,
      visits.map(visit => ({ visit, vitals: null, exams: [] }))
    );
    return buildSearchsetBundle(allergies, new Date(), this.truncation(visits.length, total));
  }

  async searchMedicationStatements(
    patientParam: RawQueryValue,
    actor: FhirActor
  ): Promise<FhirBundle<FhirMedicationStatement>> {
    const patient = await this.beginRead(patientParam, actor, 'MedicationStatement');
    const medications = await this.buildMedications(patient, actor.clinicId);
    return buildSearchsetBundle(medications, new Date());
  }

  // ---- authorisation ---------------------------------------------------------------------

  /**
   * Resolves the patient inside the caller's clinic (same rule the EHR routes use) and, for the
   * PATIENT role, requires it to be the caller's own record. Anything else is reported as
   * not-found so the response does not reveal whether the id exists elsewhere.
   */
  private async resolveAuthorizedPatient(
    patientParam: RawQueryValue,
    actor: FhirActor
  ): Promise<ResolvedPatient> {
    const identifier = this.parseOrReject(parsePatientParam(patientParam));
    const patient = await this.ehrService.resolvePatient(identifier, actor.clinicId);
    if (!patient) {
      throw this.notFound(`Patient/${identifier}`);
    }
    if (actor.role === PATIENT_ROLE && patient.userId !== actor.userId) {
      await this.phiAudit.record({
        ...this.auditEntry(actor, 'VIEW', 'FHIR_PATIENT', patient.id, [], FHIR_READ_PURPOSE),
        outcome: 'DENIED',
        reason: 'PATIENT role may read only its own record',
      });
      throw this.notFound(`Patient/${identifier}`);
    }
    return patient;
  }

  /**
   * Resolves and authorises the patient, then records the (non-strict) VIEW audit entry
   * before any clinical data is built or returned. All entries use the resolved Patient.id.
   */
  private async beginRead(
    patientParam: RawQueryValue,
    actor: FhirActor,
    resourceType: FhirResourceType
  ): Promise<ResolvedPatient> {
    const patient = await this.resolveAuthorizedPatient(patientParam, actor);
    await this.phiAudit.record(
      this.auditEntry(
        actor,
        'VIEW',
        `FHIR_${resourceType.toUpperCase()}`,
        patient.id,
        [resourceType],
        FHIR_READ_PURPOSE
      )
    );
    return patient;
  }

  private parseOrReject(result: ParseResult): string {
    if (!result.ok) {
      throw new HealthcareError(ErrorCode.VALIDATION_ERROR, result.message, HttpStatus.BAD_REQUEST);
    }
    return result.value;
  }

  private notFound(what: string): HealthcareError {
    return new HealthcareError(
      ErrorCode.RESOURCE_NOT_FOUND,
      `${what} was not found`,
      HttpStatus.NOT_FOUND
    );
  }

  // ---- data loading ----------------------------------------------------------------------

  private async loadVisits(
    patient: ResolvedPatient,
    clinicId: string
  ): Promise<{ visits: PatientVisitResponse[]; total: number }> {
    return this.visitsService.listVisitsForPatient(patient.id, clinicId, {
      limit: FHIR_MAX_VISITS_PER_QUERY,
    });
  }

  /** At most VISIT_READ_CONCURRENCY visits are read at a time, to protect the DB pool. */
  private async loadVisitData(
    patient: ResolvedPatient,
    clinicId: string
  ): Promise<{ data: VisitClinicalData[]; total: number }> {
    const { visits, total } = await this.loadVisits(patient, clinicId);
    const data = await mapWithConcurrency(visits, VISIT_READ_CONCURRENCY, async visit => {
      const [vitals, exams] = await Promise.all([
        this.vitalsService.getForVisit(visit.id, clinicId),
        this.classicalExamService.getFindingsForVisit(visit.id, clinicId),
      ]);
      return { visit, vitals, exams };
    });
    return { data, total };
  }

  /** Warning outcome when fewer visits were included than exist; undefined otherwise. */
  private truncation(included: number, total: number): FhirOperationOutcome | undefined {
    return total > included ? buildTruncationOutcome(included, total) : undefined;
  }

  // ---- resource builders -----------------------------------------------------------------

  private async buildPatient(patient: ResolvedPatient, clinicId: string): Promise<FhirPatient> {
    const [profile, identifiers] = await Promise.all([
      this.patientsService.getPatientProfile(patient.userId),
      this.identifierService.listForPatient(patient.id, clinicId),
    ]);
    return mapPatient(this.toPatientSource(patient.id, profile), identifiers);
  }

  private toPatientSource(
    patientId: string,
    profile: Record<string, unknown> | null
  ): PatientSource {
    if (!profile) {
      return { id: patientId, name: null };
    }
    return {
      id: patientId,
      name: readString(profile, 'name'),
      firstName: readString(profile, 'firstName'),
      lastName: readString(profile, 'lastName'),
      gender: readString(profile, 'gender'),
      dateOfBirth: readDate(profile, 'dateOfBirth'),
      phone: readString(profile, 'phone'),
      email: readString(profile, 'email'),
    };
  }

  private buildEncounters(data: readonly VisitClinicalData[], now: Date): FhirEncounter[] {
    return data.map(({ visit }) => mapEncounter(visit, now));
  }

  private buildObservations(
    data: readonly VisitClinicalData[],
    patientId: string
  ): FhirObservation[] {
    return data.flatMap(({ vitals, exams }) => [
      ...(vitals ? mapVitalsToObservations(vitals, patientId) : []),
      ...exams.flatMap(exam => {
        const observation = mapExamFindingToObservation(exam, patientId, CASE_SHEET_CODES);
        return observation ? [observation] : [];
      }),
    ]);
  }

  private async buildPractitioners(
    data: readonly VisitClinicalData[],
    clinicId: string
  ): Promise<FhirPractitioner[]> {
    const doctorIds = [
      ...new Set(data.flatMap(({ visit }) => (visit.doctorId ? [visit.doctorId] : []))),
    ];
    const doctors = await this.doctorsService.getPractitionerSummaries(doctorIds, clinicId);
    return doctors.map(doctor => mapPractitioner(doctor));
  }

  private async buildConditions(
    patient: ResolvedPatient,
    clinicId: string
  ): Promise<FhirCondition[]> {
    const diagnoses = await this.diagnosisService.getPatientDiagnoses(
      patient.id,
      clinicId,
      FHIR_MAX_DIAGNOSES_PER_QUERY,
      0
    );
    return diagnoses.map(diagnosis =>
      mapCondition({
        id: diagnosis.id,
        patientId: patient.id,
        primaryDisease: diagnosis.primaryDisease,
        secondaryDiseases: diagnosis.secondaryDiseases ?? null,
        clinicalAssessment: diagnosis.clinicalAssessment,
        confidenceLevel: diagnosis.confidenceLevel ?? null,
        status: diagnosis.status,
        diagnosedAt: diagnosis.diagnosedAt,
        codings: diagnosis.codings ?? null,
      })
    );
  }

  private async buildAllergies(
    patient: ResolvedPatient,
    clinicId: string,
    data: readonly VisitClinicalData[]
  ): Promise<FhirAllergyIntolerance[]> {
    const rows = (await this.ehrService.getAllergies(patient.userId, clinicId)) as AllergySource[];
    return [
      ...rows.map(row => mapAllergy(row, patient.id)),
      ...data.flatMap(({ visit }) =>
        mapVisitAllergyNotes(
          {
            visitId: visit.id,
            foodAllergyNotes: visit.foodAllergyNotes,
            drugAllergyNotes: visit.drugAllergyNotes,
            registrationDate: visit.registrationDate,
          },
          patient.id
        )
      ),
    ];
  }

  private async buildMedications(
    patient: ResolvedPatient,
    clinicId: string
  ): Promise<FhirMedicationStatement[]> {
    const rows = (await this.ehrService.getMedications(
      patient.userId,
      false,
      clinicId
    )) as MedicationSource[];
    return rows.map(row => mapMedicationStatement(row, patient.id));
  }

  // ---- audit -----------------------------------------------------------------------------

  private auditEntry(
    actor: FhirActor,
    action: PhiAuditAction,
    resourceType: string,
    patientId: string,
    fields: readonly string[],
    purpose: string
  ): PhiAuditEntry {
    return {
      userId: actor.userId,
      userRole: actor.role,
      patientId,
      clinicId: actor.clinicId,
      action,
      resourceType,
      resourceId: patientId,
      fields,
      purpose,
      ...(actor.ipAddress ? { ipAddress: actor.ipAddress } : {}),
      ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
    };
  }
}
