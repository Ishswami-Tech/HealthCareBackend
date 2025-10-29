import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseService } from "../../libs/infrastructure/database";
import {
  MedicalHistoryRecord,
  LabReportRecord,
  VitalRecord,
  AllergyRecord,
  MedicationRecord,
  ImmunizationRecord,
  RadiologyReportRecord,
  ClinicAnalytics,
  PatientSummary,
  SearchResultItem,
  CriticalAlert,
  PrismaUserSelect,
  PrismaCountResult,
  PrismaGroupByResult,
  PrismaUserWithRelations,
  GetClinicRecordsByFilterResult,
  GetClinicEHRAnalyticsResult,
  GetClinicPatientsSummaryResult,
  SearchClinicRecordsResult,
  GetClinicCriticalAlertsResult,
} from "./types/ehr.types";
import { CacheService } from "../../libs/infrastructure/cache";
import { LoggingService } from "../../libs/infrastructure/logging/logging.service";
import { EventService } from "../../libs/infrastructure/events/event.service";
import {
  LogLevel,
  LogType,
} from "../../libs/infrastructure/logging/types/logging.types";
import {
  addDateRangeFilter,
  addStringFilter,
  USER_SELECT_FIELDS,
} from "../../libs/utils/query";
import {
  CreateMedicalHistoryDto,
  UpdateMedicalHistoryDto,
  CreateLabReportDto,
  UpdateLabReportDto,
  CreateRadiologyReportDto,
  UpdateRadiologyReportDto,
  CreateSurgicalRecordDto,
  UpdateSurgicalRecordDto,
  CreateVitalDto,
  UpdateVitalDto,
  CreateAllergyDto,
  UpdateAllergyDto,
  CreateMedicationDto,
  UpdateMedicationDto,
  CreateImmunizationDto,
  UpdateImmunizationDto,
  HealthRecordSummaryDto,
} from "./dto/ehr.dto";
import type {
  MedicalHistoryResponse,
  LabReportResponse,
  RadiologyReportResponse,
  SurgicalRecordResponse,
  VitalResponse,
  AllergyResponse,
  MedicationResponse,
  ImmunizationResponse,
  FamilyHistoryResponse,
  LifestyleAssessmentResponse,
} from "./types/ehr.types";
import type {
  MedicalHistory,
  LabReport,
  RadiologyReport,
  SurgicalRecord,
  Vital,
  Allergy,
  Medication,
  Immunization,
  FamilyHistory,
  LifestyleAssessment,
} from ".prisma/client";

@Injectable()
export class EHRService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService,
  ) {}

  // ============ Comprehensive Health Record ============

  async getComprehensiveHealthRecord(
    userId: string,

    _clinicId?: string,
  ): Promise<HealthRecordSummaryDto> {
    const cacheKey = `ehr:comprehensive:${userId}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const [
          medicalHistoryRaw,
          labReportsRaw,
          radiologyReportsRaw,
          surgicalRecordsRaw,
          vitalsRaw,
          allergiesRaw,
          medicationsRaw,
          immunizationsRaw,
          familyHistoryRaw,
          lifestyleAssessmentRaw,
        ]: [
          MedicalHistory[],
          LabReport[],
          RadiologyReport[],
          SurgicalRecord[],
          Vital[],
          Allergy[],
          Medication[],
          Immunization[],
          FamilyHistory[],
          LifestyleAssessment | null,
        ] = await Promise.all([
          this.databaseService.getPrismaClient().medicalHistory.findMany({
            where: { userId },
            orderBy: { date: "desc" },
          }),
          this.databaseService.getPrismaClient().labReport.findMany({
            where: { userId },
            orderBy: { date: "desc" },
          }),
          this.databaseService.getPrismaClient().radiologyReport.findMany({
            where: { userId },
            orderBy: { date: "desc" },
          }),
          this.databaseService.getPrismaClient().surgicalRecord.findMany({
            where: { userId },
            orderBy: { date: "desc" },
          }),
          this.databaseService.getPrismaClient().vital.findMany({
            where: { userId },
            orderBy: { recordedAt: "desc" },
          }),
          this.databaseService.getPrismaClient().allergy.findMany({
            where: { userId },
            orderBy: { diagnosedDate: "desc" },
          }),
          this.databaseService.getPrismaClient().medication.findMany({
            where: { userId },
            orderBy: { startDate: "desc" },
          }),
          this.databaseService.getPrismaClient().immunization.findMany({
            where: { userId },
            orderBy: { dateAdministered: "desc" },
          }),
          this.databaseService
            .getPrismaClient()
            .familyHistory.findMany({ where: { userId } }),
          this.databaseService.getPrismaClient().lifestyleAssessment.findFirst({
            where: { userId },
            orderBy: { createdAt: "desc" },
          }),
        ]);

        // Transform to response types
        const medicalHistory = medicalHistoryRaw.map((record) =>
          this.transformMedicalHistory(record),
        );
        const labReports = labReportsRaw.map((record) =>
          this.transformLabReport(record),
        );
        const radiologyReports = radiologyReportsRaw.map((record) =>
          this.transformRadiologyReport(record),
        );
        const surgicalRecords = surgicalRecordsRaw.map((record) =>
          this.transformSurgicalRecord(record),
        );
        const vitals = vitalsRaw.map((record) => this.transformVital(record));
        const allergies = allergiesRaw.map((record) =>
          this.transformAllergy(record),
        );
        const medications = medicationsRaw.map((record) =>
          this.transformMedication(record),
        );
        const immunizations = immunizationsRaw.map((record) =>
          this.transformImmunization(record),
        );
        const familyHistory = familyHistoryRaw.map((record) =>
          this.transformFamilyHistory(record),
        );
        const lifestyleAssessment = lifestyleAssessmentRaw
          ? this.transformLifestyleAssessment(lifestyleAssessmentRaw)
          : {
              id: "",
              userId: "",
              clinicId: "",
              doctorId: "",
              diet: "",
              exercise: "",
              smoking: "",
              alcohol: "",
              sleep: "",
              stress: "",
              notes: "",
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };

        return {
          medicalHistory,
          labReports,
          radiologyReports,
          surgicalRecords,
          vitals,
          allergies,
          medications,
          immunizations,
          familyHistory,
          lifestyleAssessment,
        };
      },
      {
        ttl: 1800,
        tags: [`ehr:${userId}`],
        priority: "high",
        containsPHI: true,
      },
    );
  }

  async invalidateUserEHRCache(userId: string) {
    await this.cacheService.invalidateCacheByTag(`ehr:${userId}`);
  }

  // ============ Medical History ============

  async createMedicalHistory(
    data: CreateMedicalHistoryDto,
  ): Promise<MedicalHistoryResponse> {
    const record = await this.databaseService
      .getPrismaClient()
      .medicalHistory.create({
        data: {
          userId: data.userId,
          clinicId: data.clinicId,
          condition: data.condition,
          notes: data.notes,
          date: new Date(data.date),
        },
      });

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      "Medical history record created",
      "EHRService",
      { recordId: record.id, userId: data.userId, clinicId: data.clinicId },
    );

    await this.eventService.emit("ehr.medical_history.created", {
      recordId: record.id,
    });
    await this.invalidateUserEHRCache(data.userId);
    if (data.clinicId) {
      await this.cacheService.invalidateCacheByTag(`clinic:${data.clinicId}`);
    }

    return this.transformMedicalHistory(record);
  }

  async getMedicalHistory(
    userId: string,
    clinicId?: string,
  ): Promise<MedicalHistoryResponse[]> {
    const where: { userId: string; clinicId?: string } = { userId };
    if (clinicId) {
      where.clinicId = clinicId;
    }

    const records = await this.databaseService
      .getPrismaClient()
      .medicalHistory.findMany({
        where,
        orderBy: { date: "desc" },
      });

    return records.map((record: MedicalHistory) =>
      this.transformMedicalHistory(record),
    );
  }

  async updateMedicalHistory(
    id: string,
    data: UpdateMedicalHistoryDto,
  ): Promise<MedicalHistoryResponse> {
    const record = await this.databaseService
      .getPrismaClient()
      .medicalHistory.update({
        where: { id },
        data: {
          ...data,
          date: data.date ? new Date(data.date) : undefined,
        },
      });

    await this.eventService.emit("ehr.medical_history.updated", {
      recordId: id,
    });
    await this.invalidateUserEHRCache(record.userId);

    return this.transformMedicalHistory(record);
  }

  async deleteMedicalHistory(id: string): Promise<void> {
    const record = await this.databaseService
      .getPrismaClient()
      .medicalHistory.findUnique({
        where: { id },
      });
    if (!record)
      throw new NotFoundException(
        `Medical history record with ID ${id} not found`,
      );

    await this.databaseService
      .getPrismaClient()
      .medicalHistory.delete({ where: { id } });
    await this.eventService.emit("ehr.medical_history.deleted", {
      recordId: id,
    });
    await this.invalidateUserEHRCache(record.userId);
  }

  // ============ Lab Reports ============

  async createLabReport(data: CreateLabReportDto): Promise<LabReportResponse> {
    const report = await this.databaseService
      .getPrismaClient()
      .labReport.create({
        data: {
          userId: data.userId,
          testName: data.testName,
          result: data.result,
          unit: data.unit,
          normalRange: data.normalRange,
          date: new Date(data.date),
        },
      });

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      "Lab report created",
      "EHRService",
      { reportId: report.id, userId: data.userId },
    );

    await this.eventService.emit("ehr.lab_report.created", {
      reportId: report.id,
    });
    await this.invalidateUserEHRCache(data.userId);

    return report;
  }

  async getLabReports(userId: string): Promise<LabReportResponse[]> {
    const records = await this.databaseService
      .getPrismaClient()
      .labReport.findMany({
        where: { userId },
        orderBy: { date: "desc" },
      });

    return records.map((record: LabReport) => this.transformLabReport(record));
  }

  async updateLabReport(
    id: string,
    data: UpdateLabReportDto,
  ): Promise<LabReportResponse> {
    const report = await this.databaseService
      .getPrismaClient()
      .labReport.update({
        where: { id },
        data: {
          ...data,
          date: data.date ? new Date(data.date) : undefined,
        },
      });

    await this.eventService.emit("ehr.lab_report.updated", { reportId: id });
    await this.invalidateUserEHRCache(report.userId);

    return report;
  }

  async deleteLabReport(id: string): Promise<void> {
    const report = await this.databaseService
      .getPrismaClient()
      .labReport.findUnique({
        where: { id },
      });
    if (!report)
      throw new NotFoundException(`Lab report with ID ${id} not found`);

    await this.databaseService
      .getPrismaClient()
      .labReport.delete({ where: { id } });
    await this.eventService.emit("ehr.lab_report.deleted", { reportId: id });
    await this.invalidateUserEHRCache(report.userId);
  }

  // ============ Radiology Reports ============

  async createRadiologyReport(
    data: CreateRadiologyReportDto,
  ): Promise<unknown> {
    const report = await this.databaseService
      .getPrismaClient()
      .radiologyReport.create({
        data: {
          userId: data.userId,
          imageType: data.imageType,
          findings: data.findings,
          conclusion: data.conclusion,
          date: new Date(data.date),
        },
      });

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      "Radiology report created",
      "EHRService",
      { reportId: report.id, userId: data.userId },
    );

    await this.eventService.emit("ehr.radiology_report.created", {
      reportId: report.id,
    });
    await this.invalidateUserEHRCache(data.userId);

    return report;
  }

  async getRadiologyReports(
    userId: string,
  ): Promise<RadiologyReportResponse[]> {
    const records = await this.databaseService
      .getPrismaClient()
      .radiologyReport.findMany({
        where: { userId },
        orderBy: { date: "desc" },
      });

    return records.map((record: RadiologyReport) =>
      this.transformRadiologyReport(record),
    );
  }

  async updateRadiologyReport(
    id: string,
    data: UpdateRadiologyReportDto,
  ): Promise<RadiologyReportResponse> {
    const report = await this.databaseService
      .getPrismaClient()
      .radiologyReport.update({
        where: { id },
        data: {
          ...data,
          date: data.date ? new Date(data.date) : undefined,
        },
      });

    await this.eventService.emit("ehr.radiology_report.updated", {
      reportId: id,
    });
    await this.invalidateUserEHRCache(report.userId);

    return report;
  }

  async deleteRadiologyReport(id: string): Promise<void> {
    const report = await this.databaseService
      .getPrismaClient()
      .radiologyReport.findUnique({
        where: { id },
      });
    if (!report)
      throw new NotFoundException(`Radiology report with ID ${id} not found`);

    await this.databaseService
      .getPrismaClient()
      .radiologyReport.delete({ where: { id } });
    await this.eventService.emit("ehr.radiology_report.deleted", {
      reportId: id,
    });
    await this.invalidateUserEHRCache(report.userId);
  }

  // ============ Surgical Records ============

  async createSurgicalRecord(
    data: CreateSurgicalRecordDto,
  ): Promise<SurgicalRecordResponse> {
    const record = await this.databaseService
      .getPrismaClient()
      .surgicalRecord.create({
        data: {
          userId: data.userId,
          surgeryName: data.surgeryName,
          surgeon: data.surgeon,
          notes: data.notes,
          date: new Date(data.date),
        },
      });

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      "Surgical record created",
      "EHRService",
      { recordId: record.id, userId: data.userId },
    );

    await this.eventService.emit("ehr.surgical_record.created", {
      recordId: record.id,
    });
    await this.invalidateUserEHRCache(data.userId);

    return record;
  }

  async getSurgicalRecords(userId: string): Promise<SurgicalRecordResponse[]> {
    const records = await this.databaseService
      .getPrismaClient()
      .surgicalRecord.findMany({
        where: { userId },
        orderBy: { date: "desc" },
      });

    return records.map((record: SurgicalRecord) =>
      this.transformSurgicalRecord(record),
    );
  }

  async updateSurgicalRecord(
    id: string,
    data: UpdateSurgicalRecordDto,
  ): Promise<SurgicalRecordResponse> {
    const record = await this.databaseService
      .getPrismaClient()
      .surgicalRecord.update({
        where: { id },
        data: {
          ...data,
          date: data.date ? new Date(data.date) : undefined,
        },
      });

    await this.eventService.emit("ehr.surgical_record.updated", {
      recordId: id,
    });
    await this.invalidateUserEHRCache(record.userId);

    return record;
  }

  async deleteSurgicalRecord(id: string): Promise<void> {
    const record = await this.databaseService
      .getPrismaClient()
      .surgicalRecord.findUnique({
        where: { id },
      });
    if (!record)
      throw new NotFoundException(`Surgical record with ID ${id} not found`);

    await this.databaseService
      .getPrismaClient()
      .surgicalRecord.delete({ where: { id } });
    await this.eventService.emit("ehr.surgical_record.deleted", {
      recordId: id,
    });
    await this.invalidateUserEHRCache(record.userId);
  }

  // ============ Vitals ============

  async createVital(data: CreateVitalDto): Promise<VitalResponse> {
    const vital = await this.databaseService.getPrismaClient().vital.create({
      data: {
        userId: data.userId,
        type: data.type,
        value: data.value,
        recordedAt: new Date(data.recordedAt),
      },
    });

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      "Vital record created",
      "EHRService",
      { vitalId: vital.id, userId: data.userId, type: data.type },
    );

    await this.eventService.emit("ehr.vital.created", { vitalId: vital.id });
    await this.invalidateUserEHRCache(data.userId);

    return vital;
  }

  async getVitals(userId: string, type?: string) {
    return await this.databaseService.getPrismaClient().vital.findMany({
      where: {
        userId,
        ...(type && { type }),
      },
      orderBy: { recordedAt: "desc" },
    });
  }

  async updateVital(id: string, data: UpdateVitalDto): Promise<VitalResponse> {
    const vital = await this.databaseService.getPrismaClient().vital.update({
      where: { id },
      data: {
        ...data,
        recordedAt: data.recordedAt ? new Date(data.recordedAt) : undefined,
      },
    });

    await this.eventService.emit("ehr.vital.updated", { vitalId: id });
    await this.invalidateUserEHRCache(vital.userId);

    return vital;
  }

  async deleteVital(id: string): Promise<void> {
    const vital = await this.databaseService
      .getPrismaClient()
      .vital.findUnique({
        where: { id },
      });
    if (!vital)
      throw new NotFoundException(`Vital record with ID ${id} not found`);

    await this.databaseService
      .getPrismaClient()
      .vital.delete({ where: { id } });
    await this.eventService.emit("ehr.vital.deleted", { vitalId: id });
    await this.invalidateUserEHRCache(vital.userId);
  }

  // ============ Allergies ============

  async createAllergy(data: CreateAllergyDto): Promise<AllergyResponse> {
    const allergy = await this.databaseService
      .getPrismaClient()
      .allergy.create({
        data: {
          userId: data.userId,
          allergen: data.allergen,
          severity: data.severity,
          reaction: data.reaction,
          diagnosedDate: new Date(data.diagnosedDate),
          notes: data.notes,
        },
      });

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      "Allergy record created",
      "EHRService",
      { allergyId: allergy.id, userId: data.userId },
    );

    await this.eventService.emit("ehr.allergy.created", {
      allergyId: allergy.id,
    });
    await this.invalidateUserEHRCache(data.userId);

    return allergy;
  }

  async getAllergies(userId: string) {
    return await this.databaseService.getPrismaClient().allergy.findMany({
      where: { userId },
      orderBy: { diagnosedDate: "desc" },
    });
  }

  async updateAllergy(
    id: string,
    data: UpdateAllergyDto,
  ): Promise<AllergyResponse> {
    const allergy = await this.databaseService
      .getPrismaClient()
      .allergy.update({
        where: { id },
        data: {
          ...data,
          diagnosedDate: data.diagnosedDate
            ? new Date(data.diagnosedDate)
            : undefined,
        },
      });

    await this.eventService.emit("ehr.allergy.updated", { allergyId: id });
    await this.invalidateUserEHRCache(allergy.userId);

    return allergy;
  }

  async deleteAllergy(id: string): Promise<void> {
    const allergy = await this.databaseService
      .getPrismaClient()
      .allergy.findUnique({
        where: { id },
      });
    if (!allergy)
      throw new NotFoundException(`Allergy record with ID ${id} not found`);

    await this.databaseService
      .getPrismaClient()
      .allergy.delete({ where: { id } });
    await this.eventService.emit("ehr.allergy.deleted", { allergyId: id });
    await this.invalidateUserEHRCache(allergy.userId);
  }

  // ============ Medications ============

  async createMedication(
    data: CreateMedicationDto,
  ): Promise<MedicationResponse> {
    const medication = await this.databaseService
      .getPrismaClient()
      .medication.create({
        data: {
          userId: data.userId,
          name: data.name,
          dosage: data.dosage,
          frequency: data.frequency,
          startDate: new Date(data.startDate),
          endDate: data.endDate ? new Date(data.endDate) : undefined,
          prescribedBy: data.prescribedBy,
          purpose: data.purpose,
          sideEffects: data.sideEffects,
        },
      });

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      "Medication record created",
      "EHRService",
      { medicationId: medication.id, userId: data.userId },
    );

    await this.eventService.emit("ehr.medication.created", {
      medicationId: medication.id,
    });
    await this.invalidateUserEHRCache(data.userId);

    return medication;
  }

  async getMedications(userId: string, activeOnly: boolean = false) {
    return await this.databaseService.getPrismaClient().medication.findMany({
      where: {
        userId,
        ...(activeOnly && { isActive: true }),
      },
      orderBy: { startDate: "desc" },
    });
  }

  async updateMedication(
    id: string,
    data: UpdateMedicationDto,
  ): Promise<MedicationResponse> {
    const medication = await this.databaseService
      .getPrismaClient()
      .medication.update({
        where: { id },
        data: {
          ...data,
          startDate: data.startDate ? new Date(data.startDate) : undefined,
          endDate: data.endDate ? new Date(data.endDate) : undefined,
        },
      });

    await this.eventService.emit("ehr.medication.updated", {
      medicationId: id,
    });
    await this.invalidateUserEHRCache(medication.userId);

    return medication;
  }

  async deleteMedication(id: string): Promise<void> {
    const medication = await this.databaseService
      .getPrismaClient()
      .medication.findUnique({
        where: { id },
      });
    if (!medication)
      throw new NotFoundException(`Medication record with ID ${id} not found`);

    await this.databaseService
      .getPrismaClient()
      .medication.delete({ where: { id } });
    await this.eventService.emit("ehr.medication.deleted", {
      medicationId: id,
    });
    await this.invalidateUserEHRCache(medication.userId);
  }

  // ============ Immunizations ============

  async createImmunization(
    data: CreateImmunizationDto,
  ): Promise<ImmunizationResponse> {
    const immunization = await this.databaseService
      .getPrismaClient()
      .immunization.create({
        data: {
          userId: data.userId,
          vaccineName: data.vaccineName,
          dateAdministered: new Date(data.dateAdministered),
          nextDueDate: data.nextDueDate
            ? new Date(data.nextDueDate)
            : undefined,
          batchNumber: data.batchNumber,
          administrator: data.administrator,
          location: data.location,
          notes: data.notes,
        },
      });

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      "Immunization record created",
      "EHRService",
      { immunizationId: immunization.id, userId: data.userId },
    );

    await this.eventService.emit("ehr.immunization.created", {
      immunizationId: immunization.id,
    });
    await this.invalidateUserEHRCache(data.userId);

    return immunization;
  }

  async getImmunizations(userId: string): Promise<ImmunizationResponse[]> {
    const records: Immunization[] = await this.databaseService
      .getPrismaClient()
      .immunization.findMany({
        where: { userId },
        orderBy: { dateAdministered: "desc" },
      });

    return records.map((record) => this.transformImmunization(record));
  }

  async updateImmunization(
    id: string,
    data: UpdateImmunizationDto,
  ): Promise<ImmunizationResponse> {
    const immunization: Immunization = await this.databaseService
      .getPrismaClient()
      .immunization.update({
        where: { id },
        data: {
          ...data,
          dateAdministered: data.dateAdministered
            ? new Date(data.dateAdministered)
            : undefined,
          nextDueDate: data.nextDueDate
            ? new Date(data.nextDueDate)
            : undefined,
        },
      });

    await this.eventService.emit("ehr.immunization.updated", {
      immunizationId: id,
    });
    await this.invalidateUserEHRCache(immunization.userId);

    return this.transformImmunization(immunization);
  }

  async deleteImmunization(id: string): Promise<void> {
    const immunization: Immunization | null = await this.databaseService
      .getPrismaClient()
      .immunization.findUnique({
        where: { id },
      });
    if (!immunization)
      throw new NotFoundException(
        `Immunization record with ID ${id} not found`,
      );

    await this.databaseService
      .getPrismaClient()
      .immunization.delete({ where: { id } });
    await this.eventService.emit("ehr.immunization.deleted", {
      immunizationId: id,
    });
    await this.invalidateUserEHRCache(immunization.userId);
  }

  // ============ Analytics ============

  async getHealthTrends(
    userId: string,
    vitalType: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<{ vitalType: string; data: Vital[]; count: number }> {
    const where: {
      userId: string;
      type: string;
      recordedAt?: {
        gte?: Date;
        lte?: Date;
      };
    } = {
      userId,
      type: vitalType,
    };

    if (startDate || endDate) {
      where.recordedAt = {};
      if (startDate) where.recordedAt.gte = startDate;
      if (endDate) where.recordedAt.lte = endDate;
    }

    const vitals: Vital[] = await this.databaseService
      .getPrismaClient()
      .vital.findMany({
        where,
        orderBy: { recordedAt: "asc" },
      });

    return {
      vitalType,
      data: vitals,
      count: vitals.length,
    };
  }

  async getMedicationAdherence(
    userId: string,
  ): Promise<{ totalActive: number; medications: Medication[] }> {
    const medications: Medication[] = await this.databaseService
      .getPrismaClient()
      .medication.findMany({
        where: {
          userId,
          isActive: true,
        },
      });

    return {
      totalActive: medications.length,
      medications,
    };
  }

  // ============ Clinic-Wide EHR Access (Multi-Role Support) ============

  /**
   * Get all clinic patient records with role-based filtering
   */
  async getClinicPatientsRecords(
    clinicId: string,
    role: string,
    filters?: {
      recordType?: string;
      hasCondition?: string;
      hasAllergy?: string;
      onMedication?: string;
      dateFrom?: Date;
      dateTo?: Date;
    },
  ): Promise<{
    conditions: Array<{
      id: string;
      user: {
        id: string;
        firstName: string;
        lastName: string;
        email: string | null;
      } | null;
      condition: string;
      date: Date;
      notes?: string;
    }>;
    allergies: Array<{
      id: string;
      user: {
        id: string;
        firstName: string;
        lastName: string;
        email: string | null;
      } | null;
      allergen: string;
      severity: string;
      reaction: string;
      diagnosedDate: Date;
    }>;
    medications: Array<{
      id: string;
      user: {
        id: string;
        firstName: string;
        lastName: string;
        email: string | null;
      } | null;
      name: string;
      dosage: string;
      frequency: string;
      startDate: Date;
      isActive: boolean;
    }>;
    totalRecords: number;
  }> {
    let conditions: Array<{
      id: string;
      user: {
        id: string;
        firstName: string;
        lastName: string;
        email: string | null;
      } | null;
      condition: string;
      date: Date;
      notes?: string;
    }> = [];
    let allergies: Array<{
      id: string;
      user: {
        id: string;
        firstName: string;
        lastName: string;
        email: string | null;
      } | null;
      allergen: string;
      severity: string;
      reaction: string;
      diagnosedDate: Date;
    }> = [];
    let medications: Array<{
      id: string;
      user: {
        id: string;
        firstName: string;
        lastName: string;
        email: string | null;
      } | null;
      name: string;
      dosage: string;
      frequency: string;
      startDate: Date;
      isActive: boolean;
    }> = [];

    interface BaseWhereClause {
      clinicId: string;
      createdAt?: {
        gte?: Date;
        lte?: Date;
      };
      [key: string]: unknown;
    }

    interface MedicalHistoryWhere extends BaseWhereClause {
      condition?: { contains: string; mode: "insensitive" };
    }

    interface AllergyWhere extends BaseWhereClause {
      allergen?: { contains: string; mode: "insensitive" };
    }

    interface MedicationWhere extends BaseWhereClause {
      name?: { contains: string; mode: "insensitive" };
    }

    switch (filters?.recordType) {
      case "medical_history": {
        let where: MedicalHistoryWhere = { clinicId };
        where = addStringFilter(where, "condition", filters.hasCondition);
        where = addDateRangeFilter(where, filters?.dateFrom, filters?.dateTo);
        const medicalHistoryRecords = await this.databaseService
          .getPrismaClient()
          .medicalHistory.findMany({
            where,
            include: { user: { select: USER_SELECT_FIELDS } },
            orderBy: { date: "desc" },
          });
        conditions = medicalHistoryRecords.map((record: any) => ({
          id: record.id,
          user: record.user,
          condition: record.condition,
          date: record.date,
          notes: record.notes || "",
        }));
        break;
      }

      case "lab_report": {
        let where: BaseWhereClause = { clinicId };
        where = addDateRangeFilter(where, filters?.dateFrom, filters?.dateTo);
        const labReportRecords = await this.databaseService
          .getPrismaClient()
          .labReport.findMany({
            where,
            include: { user: { select: USER_SELECT_FIELDS } },
            orderBy: { date: "desc" },
          });
        // Lab reports don't fit into our current structure, skip for now
        break;
      }

      case "vital": {
        let where: BaseWhereClause = { clinicId };
        where = addDateRangeFilter(where, filters?.dateFrom, filters?.dateTo);
        const vitalRecords = await this.databaseService
          .getPrismaClient()
          .vital.findMany({
            where,
            include: { user: { select: USER_SELECT_FIELDS } },
            orderBy: { recordedAt: "desc" },
          });
        // Vitals don't fit into our current structure, skip for now
        break;
      }

      case "allergy": {
        let where: AllergyWhere = { clinicId };
        where = addStringFilter(where, "allergen", filters.hasAllergy);
        where = addDateRangeFilter(where, filters?.dateFrom, filters?.dateTo);
        const allergyRecords = await this.databaseService
          .getPrismaClient()
          .allergy.findMany({
            where,
            include: { user: { select: USER_SELECT_FIELDS } },
            orderBy: { diagnosedDate: "desc" },
          });
        allergies = allergyRecords.map((record: any) => ({
          id: record.id,
          user: record.user,
          allergen: record.allergen,
          severity: record.severity,
          reaction: record.reaction,
          diagnosedDate: record.diagnosedDate.toISOString(),
        }));
        break;
      }

      case "medication": {
        let where: MedicationWhere = { clinicId };
        where = addStringFilter(where, "name", filters.onMedication);
        where = addDateRangeFilter(where, filters?.dateFrom, filters?.dateTo);
        const medicationRecords = await this.databaseService
          .getPrismaClient()
          .medication.findMany({
            where,
            include: { user: { select: USER_SELECT_FIELDS } },
            orderBy: { startDate: "desc" },
          });
        medications = medicationRecords.map((record: any) => ({
          id: record.id,
          user: record.user,
          name: record.name,
          dosage: record.dosage,
          frequency: record.frequency,
          startDate: record.startDate.toISOString(),
          isActive: record.isActive,
        }));
        break;
      }

      default: {
        // Get all record types
        const [medicalHistoryRecords, allergyRecords, medicationRecords] =
          await Promise.all([
            this.databaseService.getPrismaClient().medicalHistory.findMany({
              where: { clinicId },
              include: { user: { select: USER_SELECT_FIELDS } },
              orderBy: { date: "desc" },
            }),
            this.databaseService.getPrismaClient().allergy.findMany({
              where: { clinicId },
              include: { user: { select: USER_SELECT_FIELDS } },
              orderBy: { diagnosedDate: "desc" },
            }),
            this.databaseService.getPrismaClient().medication.findMany({
              where: { clinicId },
              include: { user: { select: USER_SELECT_FIELDS } },
              orderBy: { startDate: "desc" },
            }),
          ]);

        conditions = medicalHistoryRecords.map((record: any) => ({
          id: record.id,
          user: record.user,
          condition: record.condition,
          date: record.date,
          notes: record.notes || "",
        }));
        allergies = allergyRecords.map((record: any) => ({
          id: record.id,
          user: record.user,
          allergen: record.allergen,
          severity: record.severity,
          reaction: record.reaction,
          diagnosedDate: record.diagnosedDate.toISOString(),
        }));
        medications = medicationRecords.map((record: any) => ({
          id: record.id,
          user: record.user,
          name: record.name,
          dosage: record.dosage,
          frequency: record.frequency,
          startDate: record.startDate.toISOString(),
          isActive: record.isActive,
        }));
        break;
      }
    }

    return {
      conditions,
      allergies,
      medications,
      totalRecords: conditions.length + allergies.length + medications.length,
    };
  }

  /**
   * Get clinic EHR analytics
   */
  async getClinicEHRAnalytics(clinicId: string): Promise<{
    clinicId: string;
    overview: {
      totalPatientsWithRecords: number;
      totalMedicalRecords: number;
      totalLabReports: number;
      totalVitals: number;
      activeAllergies: number;
      activeMedications: number;
    };
    recentActivity: {
      last30Days: {
        medicalRecords: number;
        labReports: number;
      };
    };
    insights: {
      commonConditions: Array<{ condition: string; count: number }>;
      commonAllergies: Array<{ allergen: string; count: number }>;
    };
  }> {
    const cacheKey = `ehr:analytics:${clinicId}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const [
          totalPatients,
          totalMedicalRecords,
          totalLabReports,
          totalVitals,
          activeAllergies,
          activeMedications,
          recentRecords,
          commonConditions,
          commonAllergies,
        ] = await Promise.all([
          this.databaseService.getPrismaClient().medicalHistory.findMany({
            where: { clinicId },
            select: { userId: true },
            distinct: ["userId"],
          }) as Promise<PrismaUserSelect[]>,
          this.databaseService
            .getPrismaClient()
            .medicalHistory.count({ where: { clinicId } }) as Promise<number>,
          this.databaseService
            .getPrismaClient()
            .labReport.count({ where: { clinicId } }) as Promise<number>,
          this.databaseService
            .getPrismaClient()
            .vital.count({ where: { clinicId } }) as Promise<number>,
          this.databaseService
            .getPrismaClient()
            .allergy.count({ where: { clinicId } }) as Promise<number>,
          this.databaseService.getPrismaClient().medication.count({
            where: { clinicId, isActive: true },
          }) as Promise<number>,
          Promise.all([
            this.databaseService.getPrismaClient().medicalHistory.count({
              where: {
                clinicId,
                createdAt: {
                  gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                },
              },
            }) as Promise<number>,
            this.databaseService.getPrismaClient().labReport.count({
              where: {
                clinicId,
                createdAt: {
                  gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                },
              },
            }) as Promise<number>,
          ]),
          this.databaseService.getPrismaClient().medicalHistory.groupBy({
            by: ["condition"],
            where: { clinicId },
            _count: { condition: true },
            orderBy: { _count: { condition: "desc" } },
            take: 10,
          }) as Promise<PrismaGroupByResult[]>,
          this.databaseService.getPrismaClient().allergy.groupBy({
            by: ["allergen"],
            where: { clinicId },
            _count: { allergen: true },
            orderBy: { _count: { allergen: "desc" } },
            take: 10,
          }) as Promise<PrismaGroupByResult[]>,
        ]);

        return {
          clinicId,
          overview: {
            totalPatientsWithRecords: totalPatients.length,
            totalMedicalRecords,
            totalLabReports,
            totalVitals,
            activeAllergies,
            activeMedications,
          },
          recentActivity: {
            last30Days: {
              medicalRecords: recentRecords[0],
              labReports: recentRecords[1],
            },
          },
          insights: {
            commonConditions: commonConditions.map((c) => ({
              condition: c.condition || "",
              count: c._count?.condition || 0,
            })),
            commonAllergies: commonAllergies.map((a) => ({
              allergen: a.allergen || "",
              count: a._count?.allergen || 0,
            })),
          },
        };
      },
      {
        ttl: 3600,
        tags: [`clinic:${clinicId}`, "analytics"],
        priority: "normal",
      },
    );
  }

  /**
   * Get clinic patients summary for dashboard
   */
  async getClinicPatientsSummary(clinicId: string): Promise<{
    clinicId: string;
    totalPatients: number;
    patients: Array<{
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      age: number | null;
      gender: string | null;
      lastVisit: Date | null;
      activeAllergies: number;
      activeMedications: number;
      criticalAllergies: Array<{
        allergen: string;
        severity: string;
      }>;
    }>;
  }> {
    return this.cacheService.cache(
      `ehr:patients:summary:${clinicId}`,
      async () => {
        const patientsWithRecords = await this.databaseService
          .getPrismaClient()
          .user.findMany({
            where: {
              OR: [
                { medicalHistories: { some: { clinicId } } },
                { labReports: { some: { clinicId } } },
                { vitals: { some: { clinicId } } },
                { allergies: { some: { clinicId } } },
                { medications: { some: { clinicId } } },
              ],
            },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              dateOfBirth: true,
              gender: true,
              medicalHistories: {
                where: { clinicId },
                orderBy: { date: "desc" },
                take: 1,
              },
              allergies: {
                where: { clinicId },
                select: { allergen: true, severity: true },
              },
              medications: {
                where: { clinicId, isActive: true },
                select: { name: true, dosage: true },
              },
            },
          });

        type PatientWithRecords = (typeof patientsWithRecords)[number];
        type AllergyRecord = PatientWithRecords["allergies"][number];

        return {
          clinicId,
          totalPatients: patientsWithRecords.length,
          patients: patientsWithRecords.map((patient: PatientWithRecords) => ({
            id: patient.id,
            name: `${patient.firstName} ${patient.lastName}`,
            email: patient.email,
            phone: patient.phone,
            age: patient.dateOfBirth
              ? Math.floor(
                  (Date.now() - patient.dateOfBirth.getTime()) /
                    (365.25 * 24 * 60 * 60 * 1000),
                )
              : null,
            gender: patient.gender,
            lastVisit: patient.medicalHistories[0]?.date || null,
            activeAllergies: patient.allergies.length,
            activeMedications: patient.medications.length,
            criticalAllergies: patient.allergies.filter(
              (a: AllergyRecord) => a.severity === "Severe",
            ),
          })),
        };
      },
      {
        ttl: 1800,
        tags: [`clinic:${clinicId}`, "patients_summary"],
        priority: "high",
        containsPHI: true,
      },
    );
  }

  /**
   * Search clinic EHR records
   */
  async searchClinicRecords(
    clinicId: string,
    searchTerm: string,
    searchTypes?: string[],
  ): Promise<{
    clinicId: string;
    searchTerm: string;
    results: {
      conditions?: Array<{
        id: string;
        user: { id: string; firstName: string; lastName: string } | null;
        condition: string;
        date: Date;
        notes?: string;
      }>;
      allergies?: Array<{
        id: string;
        user: { id: string; firstName: string; lastName: string } | null;
        allergen: string;
        severity: string;
        reaction: string;
        diagnosedDate: Date;
      }>;
      medications?: Array<{
        id: string;
        user: { id: string; firstName: string; lastName: string } | null;
        name: string;
        dosage: string;
        frequency: string;
        startDate: Date;
        isActive: boolean;
      }>;
      procedures?: Array<{
        id: string;
        user: { id: string; firstName: string; lastName: string } | null;
        surgeryName: string;
        surgeon: string;
        date: Date;
        notes?: string;
      }>;
    };
    totalResults: number;
  }> {
    const results: {
      conditions?: Array<{
        id: string;
        user: { id: string; firstName: string; lastName: string } | null;
        condition: string;
        date: Date;
        notes?: string;
      }>;
      allergies?: Array<{
        id: string;
        user: { id: string; firstName: string; lastName: string } | null;
        allergen: string;
        severity: string;
        reaction: string;
        diagnosedDate: Date;
      }>;
      medications?: Array<{
        id: string;
        user: { id: string; firstName: string; lastName: string } | null;
        name: string;
        dosage: string;
        frequency: string;
        startDate: Date;
        isActive: boolean;
      }>;
      procedures?: Array<{
        id: string;
        user: { id: string; firstName: string; lastName: string } | null;
        surgeryName: string;
        surgeon: string;
        date: Date;
        notes?: string;
      }>;
    } = {};
    const types = searchTypes || [
      "conditions",
      "allergies",
      "medications",
      "procedures",
    ];

    if (types.includes("conditions")) {
      results.conditions = await this.databaseService
        .getPrismaClient()
        .medicalHistory.findMany({
          where: {
            clinicId,
            OR: [
              { condition: { contains: searchTerm, mode: "insensitive" } },
              { notes: { contains: searchTerm, mode: "insensitive" } },
            ],
          },
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
          take: 20,
        });
    }

    if (types.includes("allergies")) {
      results.allergies = await this.databaseService
        .getPrismaClient()
        .allergy.findMany({
          where: {
            clinicId,
            allergen: { contains: searchTerm, mode: "insensitive" },
          },
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
          take: 20,
        });
    }

    if (types.includes("medications")) {
      results.medications = await this.databaseService
        .getPrismaClient()
        .medication.findMany({
          where: {
            clinicId,
            name: { contains: searchTerm, mode: "insensitive" },
          },
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
          take: 20,
        });
    }

    if (types.includes("procedures")) {
      results.procedures = await this.databaseService
        .getPrismaClient()
        .surgicalRecord.findMany({
          where: {
            clinicId,
            surgeryName: { contains: searchTerm, mode: "insensitive" },
          },
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
          take: 20,
        });
    }

    return {
      clinicId,
      searchTerm,
      results,
      totalResults:
        (results.conditions?.length || 0) +
        (results.allergies?.length || 0) +
        (results.medications?.length || 0) +
        (results.procedures?.length || 0),
    };
  }

  /**
   * Get critical health alerts for clinic
   */
  async getClinicCriticalAlerts(clinicId: string): Promise<{
    clinicId: string;
    alerts: {
      severeAllergies: {
        count: number;
        patients: Array<{
          patientId: string;
          patientName: string;
          allergen: string;
          reaction: string;
          diagnosedDate: Date;
        }>;
      };
      criticalVitals: {
        count: number;
        readings: Array<{
          patientId: string;
          patientName: string;
          vitalType: string;
          value: string;
          recordedAt: Date;
        }>;
      };
    };
    totalCriticalAlerts: number;
  }> {
    return this.cacheService.cache(
      `ehr:alerts:${clinicId}`,
      async () => {
        const [severeAllergies, criticalVitals]: [Allergy[], Vital[]] =
          await Promise.all([
            this.databaseService.getPrismaClient().allergy.findMany({
              where: {
                clinicId,
                severity: "Severe",
              },
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                  },
                },
              },
            }),
            this.databaseService.getPrismaClient().vital.findMany({
              where: {
                clinicId,
                type: { in: ["blood_pressure", "heart_rate", "temperature"] },
                recordedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
              },
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                  },
                },
              },
              orderBy: { recordedAt: "desc" },
            }),
          ]);

        type VitalRecord = (typeof criticalVitals)[number];
        type AllergyRecord = (typeof severeAllergies)[number];

        const criticalVitalAlerts = criticalVitals.filter(
          (vital: VitalRecord) => {
            if (vital.type === "blood_pressure") {
              const [systolic] = vital.value.split("/").map(Number);
              return (systolic ?? 0) >= 180 || (systolic ?? 0) <= 90;
            }
            if (vital.type === "heart_rate") {
              const hr = Number(vital.value);
              return hr >= 120 || hr <= 50;
            }
            if (vital.type === "temperature") {
              const temp = Number(vital.value);
              return temp >= 103 || temp <= 95;
            }
            return false;
          },
        );

        return {
          clinicId,
          alerts: {
            severeAllergies: {
              count: severeAllergies.length,
              patients: severeAllergies.map((a: AllergyRecord) => ({
                patientId: a.userId,
                patientName: (a as any).user
                  ? `${(a as any).user.firstName} ${(a as any).user.lastName}`
                  : "Unknown",
                allergen: a.allergen,
                reaction: a.reaction,
                diagnosedDate: a.diagnosedDate,
              })),
            },
            criticalVitals: {
              count: criticalVitalAlerts.length,
              readings: criticalVitalAlerts.map((v: VitalRecord) => ({
                patientId: v.userId,
                patientName: (v as any).user
                  ? `${(v as any).user.firstName} ${(v as any).user.lastName}`
                  : "Unknown",
                vitalType: v.type,
                value: v.value,
                recordedAt: v.recordedAt,
              })),
            },
          },
          totalCriticalAlerts:
            severeAllergies.length + criticalVitalAlerts.length,
        };
      },
      {
        ttl: 300,
        tags: [`clinic:${clinicId}`, "alerts"],
        priority: "high",
        containsPHI: true,
      },
    );
  }

  // ============ Transform Methods ============

  private transformMedicalHistory(
    record: MedicalHistory,
  ): MedicalHistoryResponse {
    return {
      id: record.id,
      userId: record.userId,
      clinicId: (record as any).clinicId || undefined,
      condition: record.condition,
      diagnosis: (record as any).diagnosis || "",
      treatment: (record as any).treatment || "",
      date: record.date.toISOString(),
      doctorId: (record as any).doctorId || "",
      notes: (record as any).notes || "",
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private transformLabReport(record: LabReport): LabReportResponse {
    return {
      id: record.id,
      userId: record.userId,
      clinicId: (record as any).clinicId || undefined,
      testName: record.testName,
      result: record.result,
      unit: (record as any).unit || "",
      normalRange: record.normalRange || "",
      date: record.date.toISOString(),
      doctorId: (record as any).doctorId || "",
      labName: (record as any).labName || "",
      notes: (record as any).notes || "",
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private transformRadiologyReport(
    record: RadiologyReport,
  ): RadiologyReportResponse {
    return {
      id: record.id,
      userId: record.userId,
      clinicId: (record as any).clinicId || undefined,
      imageType: record.imageType,
      findings: record.findings,
      conclusion: record.conclusion,
      date: record.date.toISOString(),
      doctorId: (record as any).doctorId || "",
      notes: (record as any).notes || "",
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private transformSurgicalRecord(
    record: SurgicalRecord,
  ): SurgicalRecordResponse {
    return {
      id: record.id,
      userId: record.userId,
      clinicId: (record as any).clinicId || undefined,
      surgeryName: record.surgeryName,
      surgeon: record.surgeon,
      date: record.date.toISOString(),
      doctorId: (record as any).doctorId || "",
      notes: (record as any).notes || "",
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private transformVital(record: Vital): VitalResponse {
    return {
      id: record.id,
      userId: record.userId,
      clinicId: (record as any).clinicId || undefined,
      type: record.type,
      value: Number(record.value),
      unit: (record as any).unit || "",
      recordedAt: record.recordedAt.toISOString(),
      doctorId: (record as any).doctorId || "",
      notes: (record as any).notes || "",
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private transformAllergy(record: Allergy): AllergyResponse {
    return {
      id: record.id,
      userId: record.userId,
      clinicId: (record as any).clinicId || undefined,
      allergen: record.allergen,
      severity: record.severity,
      reaction: record.reaction,
      diagnosedDate: record.diagnosedDate.toISOString(),
      doctorId: (record as any).doctorId || "",
      notes: (record as any).notes || "",
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private transformMedication(record: Medication): MedicationResponse {
    return {
      id: record.id,
      userId: record.userId,
      clinicId: (record as any).clinicId || undefined,
      name: record.name,
      dosage: record.dosage,
      frequency: record.frequency,
      startDate: record.startDate.toISOString(),
      ...(record.endDate && { endDate: record.endDate.toISOString() }),
      doctorId: (record as any).doctorId || "",
      prescribedBy: (record as any).prescribedBy || "",
      purpose: (record as any).purpose || "",
      sideEffects: (record as any).sideEffects || "",
      isActive: (record as any).isActive || false,
      notes: (record as any).notes || "",
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private transformImmunization(record: Immunization): ImmunizationResponse {
    return {
      id: record.id,
      userId: record.userId,
      clinicId: (record as any).clinicId || undefined,
      vaccineName: record.vaccineName,
      dateAdministered: record.dateAdministered.toISOString(),
      doctorId: (record as any).doctorId || "",
      ...(record.nextDueDate && {
        nextDueDate: record.nextDueDate.toISOString(),
      }),
      batchNumber: (record as any).batchNumber || "",
      administrator: (record as any).administrator || "",
      location: (record as any).location || "",
      notes: (record as any).notes || "",
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private transformFamilyHistory(record: FamilyHistory): FamilyHistoryResponse {
    return {
      id: record.id,
      userId: record.userId,
      clinicId: (record as any).clinicId || undefined,
      relation: (record as any).relation || "",
      condition: record.condition,
      doctorId: (record as any).doctorId || "",
      diagnosedAge: (record as any).diagnosedAge || undefined,
      notes: (record as any).notes || "",
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private transformLifestyleAssessment(
    record: LifestyleAssessment,
  ): LifestyleAssessmentResponse {
    return {
      id: record.id,
      userId: record.userId,
      clinicId: (record as any).clinicId || undefined,
      doctorId: (record as any).doctorId || "",
      diet: (record as any).diet || undefined,
      exercise: (record as any).exercise || undefined,
      smoking: (record as any).smoking || undefined,
      alcohol: (record as any).alcohol || undefined,
      sleep: (record as any).sleep || undefined,
      stress: (record as any).stress || undefined,
      notes: (record as any).notes || "",
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}
