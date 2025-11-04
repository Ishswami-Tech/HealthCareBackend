import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import {
  AllergyRecord,
  MedicationRecord,
  MedicalHistoryRecord,
  ClinicEHRRecordFilters,
  GetClinicRecordsByFilterResult,
} from '@core/types/ehr.types';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events';
import { LogLevel, LogType } from '@core/types';
import { addDateRangeFilter, addStringFilter, USER_SELECT_FIELDS } from '@utils/query';
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
} from './dto/ehr.dto';
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
} from '@core/types/ehr.types';
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
} from '.prisma/client';

@Injectable()
export class EHRService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService
  ) {}

  // ============ Comprehensive Health Record ============

  async getComprehensiveHealthRecord(
    userId: string,

    _clinicId?: string
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
          // Use executeHealthcareRead for all queries with full optimization layers
          this.databaseService.executeHealthcareRead(async client => {
            return await client.medicalHistory.findMany({
              where: { userId },
              orderBy: { date: 'desc' },
            });
          }),
          this.databaseService.executeHealthcareRead(async client => {
            return await client.labReport.findMany({
              where: { userId },
              orderBy: { date: 'desc' },
            });
          }),
          this.databaseService.executeHealthcareRead(async client => {
            return await client.radiologyReport.findMany({
              where: { userId },
              orderBy: { date: 'desc' },
            });
          }),
          this.databaseService.executeHealthcareRead(async client => {
            return await client.surgicalRecord.findMany({
              where: { userId },
              orderBy: { date: 'desc' },
            });
          }),
          this.databaseService.executeHealthcareRead(async client => {
            return await client.vital.findMany({
              where: { userId },
              orderBy: { recordedAt: 'desc' },
            });
          }),
          this.databaseService.executeHealthcareRead(async client => {
            return await client.allergy.findMany({
              where: { userId },
              orderBy: { diagnosedDate: 'desc' },
            });
          }),
          this.databaseService.executeHealthcareRead(async client => {
            return await client.medication.findMany({
              where: { userId },
              orderBy: { startDate: 'desc' },
            });
          }),
          this.databaseService.executeHealthcareRead(async client => {
            return await client.immunization.findMany({
              where: { userId },
              orderBy: { dateAdministered: 'desc' },
            });
          }),
          this.databaseService.executeHealthcareRead(async client => {
            return await client.familyHistory.findMany({ where: { userId } });
          }),
          this.databaseService.executeHealthcareRead(async client => {
            return await client.lifestyleAssessment.findFirst({
              where: { userId },
              orderBy: { createdAt: 'desc' },
            });
          }),
        ]);

        // Transform to response types
        const medicalHistory = medicalHistoryRaw.map(record =>
          this.transformMedicalHistory(record)
        );
        const labReports = labReportsRaw.map(record => this.transformLabReport(record));
        const radiologyReports = radiologyReportsRaw.map(record =>
          this.transformRadiologyReport(record)
        );
        const surgicalRecords = surgicalRecordsRaw.map(record =>
          this.transformSurgicalRecord(record)
        );
        const vitals = vitalsRaw.map(record => this.transformVital(record));
        const allergies = allergiesRaw.map(record => this.transformAllergy(record));
        const medications = medicationsRaw.map(record => this.transformMedication(record));
        const immunizations = immunizationsRaw.map(record => this.transformImmunization(record));
        const familyHistory = familyHistoryRaw.map(record => this.transformFamilyHistory(record));
        const lifestyleAssessment = lifestyleAssessmentRaw
          ? this.transformLifestyleAssessment(lifestyleAssessmentRaw)
          : {
              id: '',
              userId: '',
              clinicId: '',
              doctorId: '',
              diet: '',
              exercise: '',
              smoking: '',
              alcohol: '',
              sleep: '',
              stress: '',
              notes: '',
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
        priority: 'high',
        containsPHI: true,
      }
    );
  }

  async invalidateUserEHRCache(userId: string) {
    await this.cacheService.invalidateCacheByTag(`ehr:${userId}`);
  }

  // ============ Medical History ============

  async createMedicalHistory(data: CreateMedicalHistoryDto): Promise<MedicalHistoryResponse> {
    // Use executeHealthcareWrite for create with audit logging
    const record = await this.databaseService.executeHealthcareWrite(
      async client => {
        const createData: {
          userId: string;
          clinicId?: string;
          condition: string;
          notes?: string;
          date: Date;
        } = {
          userId: data.userId,
          condition: data.condition,
          date: new Date(data.date),
        };
        if (data.clinicId) {
          createData.clinicId = data.clinicId;
        }
        if (data.notes) {
          createData.notes = data.notes;
        }
        return await client.medicalHistory.create({
          data: createData,
        });
      },
      {
        userId: data.userId || 'system',
        clinicId: data.clinicId || '',
        resourceType: 'MEDICAL_HISTORY',
        operation: 'CREATE',
        resourceId: '',
        userRole: 'system',
        details: { userId: data.userId, condition: data.condition },
      }
    );

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Medical history record created',
      'EHRService',
      { recordId: record.id, userId: data.userId, clinicId: data.clinicId }
    );

    await this.eventService.emit('ehr.medical_history.created', {
      recordId: record.id,
    });
    await this.invalidateUserEHRCache(data.userId);
    if (data.clinicId) {
      await this.cacheService.invalidateCacheByTag(`clinic:${data.clinicId}`);
    }

    return this.transformMedicalHistory(record);
  }

  async getMedicalHistory(userId: string, clinicId?: string): Promise<MedicalHistoryResponse[]> {
    const where: { userId: string; clinicId?: string } = { userId };
    if (clinicId) {
      where.clinicId = clinicId;
    }

    // Use executeHealthcareRead for optimized query
    const records = await this.databaseService.executeHealthcareRead(async client => {
      return await client.medicalHistory.findMany({
        where,
        orderBy: { date: 'desc' },
      });
    });

    return records.map((record: MedicalHistory) => this.transformMedicalHistory(record));
  }

  async updateMedicalHistory(
    id: string,
    data: UpdateMedicalHistoryDto
  ): Promise<MedicalHistoryResponse> {
    // Use executeHealthcareWrite for update with audit logging
    const record = await this.databaseService.executeHealthcareWrite(
      async client => {
        const updateData: {
          condition?: string;
          notes?: string;
          date?: Date;
        } = {};
        if (data.condition) {
          updateData.condition = data.condition;
        }
        if (data.notes) {
          updateData.notes = data.notes;
        }
        if (data.date) {
          updateData.date = new Date(data.date);
        }
        return await client.medicalHistory.update({
          where: { id },
          data: updateData,
        });
      },
      {
        userId: 'system',
        clinicId: '',
        resourceType: 'MEDICAL_HISTORY',
        operation: 'UPDATE',
        resourceId: id,
        userRole: 'system',
        details: { updateFields: Object.keys(data) },
      }
    );

    await this.eventService.emit('ehr.medical_history.updated', {
      recordId: id,
    });
    await this.invalidateUserEHRCache(record.userId);

    return this.transformMedicalHistory(record);
  }

  async deleteMedicalHistory(id: string): Promise<void> {
    // Use executeHealthcareRead first to get record for cache invalidation
    const record = await this.databaseService.executeHealthcareRead(async client => {
      return await client.medicalHistory.findUnique({
        where: { id },
      });
    });
    if (!record) throw new NotFoundException(`Medical history record with ID ${id} not found`);

    // Use executeHealthcareWrite for delete with audit logging
    await this.databaseService.executeHealthcareWrite(
      async client => {
        return await client.medicalHistory.delete({ where: { id } });
      },
      {
        userId: record.userId,
        clinicId: record.clinicId || '',
        resourceType: 'MEDICAL_HISTORY',
        operation: 'DELETE',
        resourceId: id,
        userRole: 'system',
        details: { userId: record.userId },
      }
    );
    await this.eventService.emit('ehr.medical_history.deleted', {
      recordId: id,
    });
    await this.invalidateUserEHRCache(record.userId);
  }

  // ============ Lab Reports ============

  async createLabReport(data: CreateLabReportDto): Promise<LabReportResponse> {
    // Use executeHealthcareWrite for create with audit logging
    const report = await this.databaseService.executeHealthcareWrite(
      async client => {
        const createData: {
          userId: string;
          testName: string;
          result: string;
          unit?: string;
          normalRange?: string;
          date: Date;
        } = {
          userId: data.userId,
          testName: data.testName,
          result: data.result,
          date: new Date(data.date),
        };
        if (data.unit) {
          createData.unit = data.unit;
        }
        if (data.normalRange) {
          createData.normalRange = data.normalRange;
        }
        return await client.labReport.create({
          data: createData,
        });
      },
      {
        userId: data.userId || 'system',
        clinicId: data.clinicId || '',
        resourceType: 'LAB_REPORT',
        operation: 'CREATE',
        resourceId: '',
        userRole: 'system',
        details: { userId: data.userId, testName: data.testName },
      }
    );

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Lab report created',
      'EHRService',
      { reportId: report.id, userId: data.userId }
    );

    await this.eventService.emit('ehr.lab_report.created', {
      reportId: report.id,
    });
    await this.invalidateUserEHRCache(data.userId);

    return this.transformLabReport(report);
  }

  async getLabReports(userId: string): Promise<LabReportResponse[]> {
    // Use executeHealthcareRead for optimized query
    const records = await this.databaseService.executeHealthcareRead(async client => {
      return await client.labReport.findMany({
        where: { userId },
        orderBy: { date: 'desc' },
      });
    });

    return records.map((record: LabReport) => this.transformLabReport(record));
  }

  async updateLabReport(id: string, data: UpdateLabReportDto): Promise<LabReportResponse> {
    // Use executeHealthcareWrite for update with audit logging
    const report = await this.databaseService.executeHealthcareWrite(
      async client => {
        const updateData: {
          testName?: string;
          result?: string;
          unit?: string;
          normalRange?: string;
          date?: Date;
        } = {};
        if (data.testName) {
          updateData.testName = data.testName;
        }
        if (data.result) {
          updateData.result = data.result;
        }
        if (data.unit) {
          updateData.unit = data.unit;
        }
        if (data.normalRange) {
          updateData.normalRange = data.normalRange;
        }
        if (data.date) {
          updateData.date = new Date(data.date);
        }
        return await client.labReport.update({
          where: { id },
          data: updateData,
        });
      },
      {
        userId: 'system',
        clinicId: '',
        resourceType: 'LAB_REPORT',
        operation: 'UPDATE',
        resourceId: id,
        userRole: 'system',
        details: { updateFields: Object.keys(data) },
      }
    );

    await this.eventService.emit('ehr.lab_report.updated', { reportId: id });
    await this.invalidateUserEHRCache(report.userId);

    return this.transformLabReport(report);
  }

  async deleteLabReport(id: string): Promise<void> {
    // Use executeHealthcareRead first to get record for cache invalidation
    const report = await this.databaseService.executeHealthcareRead(async client => {
      return await client.labReport.findUnique({
        where: { id },
      });
    });
    if (!report) throw new NotFoundException(`Lab report with ID ${id} not found`);

    // Use executeHealthcareWrite for delete with audit logging
    await this.databaseService.executeHealthcareWrite(
      async client => {
        return await client.labReport.delete({ where: { id } });
      },
      {
        userId: report.userId,
        clinicId: report.clinicId || '',
        resourceType: 'LAB_REPORT',
        operation: 'DELETE',
        resourceId: id,
        userRole: 'system',
        details: { userId: report.userId },
      }
    );
    await this.eventService.emit('ehr.lab_report.deleted', { reportId: id });
    await this.invalidateUserEHRCache(report.userId);
  }

  // ============ Radiology Reports ============

  async createRadiologyReport(data: CreateRadiologyReportDto): Promise<unknown> {
    // Use executeHealthcareWrite for create with audit logging
    const report = await this.databaseService.executeHealthcareWrite(
      async client => {
        return await client.radiologyReport.create({
          data: {
            userId: data.userId,
            imageType: data.imageType,
            findings: data.findings,
            conclusion: data.conclusion,
            date: new Date(data.date),
          },
        });
      },
      {
        userId: data.userId || 'system',
        clinicId: '',
        resourceType: 'RADIOLOGY_REPORT',
        operation: 'CREATE',
        resourceId: '',
        userRole: 'system',
        details: { userId: data.userId, imageType: data.imageType },
      }
    );

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Radiology report created',
      'EHRService',
      { reportId: report.id, userId: data.userId }
    );

    await this.eventService.emit('ehr.radiology_report.created', {
      reportId: report.id,
    });
    await this.invalidateUserEHRCache(data.userId);

    return report;
  }

  async getRadiologyReports(userId: string): Promise<RadiologyReportResponse[]> {
    // Use executeHealthcareRead for optimized query
    const records = await this.databaseService.executeHealthcareRead(async client => {
      return await client.radiologyReport.findMany({
        where: { userId },
        orderBy: { date: 'desc' },
      });
    });

    return records.map((record: RadiologyReport) => this.transformRadiologyReport(record));
  }

  async updateRadiologyReport(
    id: string,
    data: UpdateRadiologyReportDto
  ): Promise<RadiologyReportResponse> {
    // Use executeHealthcareWrite for update with audit logging
    const report = await this.databaseService.executeHealthcareWrite(
      async client => {
        const updateData: {
          imageType?: string;
          findings?: string;
          conclusion?: string;
          date?: Date;
        } = {};
        if (data.imageType) {
          updateData.imageType = data.imageType;
        }
        if (data.findings) {
          updateData.findings = data.findings;
        }
        if (data.conclusion) {
          updateData.conclusion = data.conclusion;
        }
        if (data.date) {
          updateData.date = new Date(data.date);
        }
        return await client.radiologyReport.update({
          where: { id },
          data: updateData,
        });
      },
      {
        userId: 'system',
        clinicId: '',
        resourceType: 'RADIOLOGY_REPORT',
        operation: 'UPDATE',
        resourceId: id,
        userRole: 'system',
        details: { updateFields: Object.keys(data) },
      }
    );

    await this.eventService.emit('ehr.radiology_report.updated', {
      reportId: id,
    });
    await this.invalidateUserEHRCache(report.userId);

    return this.transformRadiologyReport(report);
  }

  async deleteRadiologyReport(id: string): Promise<void> {
    // Use executeHealthcareRead first to get record for cache invalidation
    const report = await this.databaseService.executeHealthcareRead(async client => {
      return await client.radiologyReport.findUnique({
        where: { id },
      });
    });
    if (!report) throw new NotFoundException(`Radiology report with ID ${id} not found`);

    // Use executeHealthcareWrite for delete with audit logging
    await this.databaseService.executeHealthcareWrite(
      async client => {
        return await client.radiologyReport.delete({ where: { id } });
      },
      {
        userId: report.userId,
        clinicId: report.clinicId || '',
        resourceType: 'RADIOLOGY_REPORT',
        operation: 'DELETE',
        resourceId: id,
        userRole: 'system',
        details: { userId: report.userId },
      }
    );
    await this.eventService.emit('ehr.radiology_report.deleted', {
      reportId: id,
    });
    await this.invalidateUserEHRCache(report.userId);
  }

  // ============ Surgical Records ============

  async createSurgicalRecord(data: CreateSurgicalRecordDto): Promise<SurgicalRecordResponse> {
    // Use executeHealthcareWrite for create with audit logging
    const record = await this.databaseService.executeHealthcareWrite(
      async client => {
        const createData: {
          userId: string;
          surgeryName: string;
          surgeon: string;
          notes?: string;
          date: Date;
        } = {
          userId: data.userId,
          surgeryName: data.surgeryName,
          surgeon: data.surgeon,
          date: new Date(data.date),
        };
        if (data.notes) {
          createData.notes = data.notes;
        }
        return await client.surgicalRecord.create({
          data: createData,
        });
      },
      {
        userId: data.userId || 'system',
        clinicId: '',
        resourceType: 'SURGICAL_RECORD',
        operation: 'CREATE',
        resourceId: '',
        userRole: 'system',
        details: { userId: data.userId, surgeryName: data.surgeryName },
      }
    );

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Surgical record created',
      'EHRService',
      { recordId: record.id, userId: data.userId }
    );

    await this.eventService.emit('ehr.surgical_record.created', {
      recordId: record.id,
    });
    await this.invalidateUserEHRCache(data.userId);

    return this.transformSurgicalRecord(record);
  }

  async getSurgicalRecords(userId: string): Promise<SurgicalRecordResponse[]> {
    // Use executeHealthcareRead for optimized query
    const records = await this.databaseService.executeHealthcareRead(async client => {
      return await client.surgicalRecord.findMany({
        where: { userId },
        orderBy: { date: 'desc' },
      });
    });

    return records.map((record: SurgicalRecord) => this.transformSurgicalRecord(record));
  }

  async updateSurgicalRecord(
    id: string,
    data: UpdateSurgicalRecordDto
  ): Promise<SurgicalRecordResponse> {
    // Use executeHealthcareWrite for update with audit logging
    const record = await this.databaseService.executeHealthcareWrite(
      async client => {
        const updateData: {
          surgeryName?: string;
          surgeon?: string;
          notes?: string;
          date?: Date;
        } = {};
        if (data.surgeryName) {
          updateData.surgeryName = data.surgeryName;
        }
        if (data.surgeon) {
          updateData.surgeon = data.surgeon;
        }
        if (data.notes) {
          updateData.notes = data.notes;
        }
        if (data.date) {
          updateData.date = new Date(data.date);
        }
        return await client.surgicalRecord.update({
          where: { id },
          data: updateData,
        });
      },
      {
        userId: 'system',
        clinicId: '',
        resourceType: 'SURGICAL_RECORD',
        operation: 'UPDATE',
        resourceId: id,
        userRole: 'system',
        details: { updateFields: Object.keys(data) },
      }
    );

    await this.eventService.emit('ehr.surgical_record.updated', {
      recordId: id,
    });
    await this.invalidateUserEHRCache(record.userId);

    return this.transformSurgicalRecord(record);
  }

  async deleteSurgicalRecord(id: string): Promise<void> {
    // Use executeHealthcareRead first to get record for cache invalidation
    const record = await this.databaseService.executeHealthcareRead(async client => {
      return await client.surgicalRecord.findUnique({
        where: { id },
      });
    });
    if (!record) throw new NotFoundException(`Surgical record with ID ${id} not found`);

    // Use executeHealthcareWrite for delete with audit logging
    await this.databaseService.executeHealthcareWrite(
      async client => {
        return await client.surgicalRecord.delete({ where: { id } });
      },
      {
        userId: record.userId,
        clinicId: record.clinicId || '',
        resourceType: 'SURGICAL_RECORD',
        operation: 'DELETE',
        resourceId: id,
        userRole: 'system',
        details: { userId: record.userId },
      }
    );
    await this.eventService.emit('ehr.surgical_record.deleted', {
      recordId: id,
    });
    await this.invalidateUserEHRCache(record.userId);
  }

  // ============ Vitals ============

  async createVital(data: CreateVitalDto): Promise<VitalResponse> {
    // Use executeHealthcareWrite for create with audit logging
    const vital = await this.databaseService.executeHealthcareWrite(
      async client => {
        return await client.vital.create({
          data: {
            userId: data.userId,
            type: data.type,
            value: data.value,
            recordedAt: new Date(data.recordedAt),
          },
        });
      },
      {
        userId: data.userId || 'system',
        clinicId: '',
        resourceType: 'VITAL',
        operation: 'CREATE',
        resourceId: '',
        userRole: 'system',
        details: { userId: data.userId, type: data.type },
      }
    );

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Vital record created',
      'EHRService',
      { vitalId: vital.id, userId: data.userId, type: data.type }
    );

    await this.eventService.emit('ehr.vital.created', { vitalId: vital.id });
    await this.invalidateUserEHRCache(data.userId);

    return this.transformVital(vital);
  }

  async getVitals(userId: string, type?: string) {
    // Use executeHealthcareRead for optimized query
    return await this.databaseService.executeHealthcareRead(async client => {
      return await client.vital.findMany({
        where: {
          userId,
          ...(type && { type }),
        },
        orderBy: { recordedAt: 'desc' },
      });
    });
  }

  async updateVital(id: string, data: UpdateVitalDto): Promise<VitalResponse> {
    // Use executeHealthcareWrite for update with audit logging
    const vital = await this.databaseService.executeHealthcareWrite(
      async client => {
        const updateData: {
          type?: string;
          value?: string;
          recordedAt?: Date;
        } = {};
        if (data.type) {
          updateData.type = data.type;
        }
        if (data.value) {
          updateData.value = data.value;
        }
        if (data.recordedAt) {
          updateData.recordedAt = new Date(data.recordedAt);
        }
        return await client.vital.update({
          where: { id },
          data: updateData,
        });
      },
      {
        userId: 'system',
        clinicId: '',
        resourceType: 'VITAL',
        operation: 'UPDATE',
        resourceId: id,
        userRole: 'system',
        details: { updateFields: Object.keys(data) },
      }
    );

    await this.eventService.emit('ehr.vital.updated', { vitalId: id });
    await this.invalidateUserEHRCache(vital.userId);

    return this.transformVital(vital);
  }

  async deleteVital(id: string): Promise<void> {
    // Use executeHealthcareRead first to get record for cache invalidation
    const vital = await this.databaseService.executeHealthcareRead(async client => {
      return await client.vital.findUnique({
        where: { id },
      });
    });
    if (!vital) throw new NotFoundException(`Vital record with ID ${id} not found`);

    // Use executeHealthcareWrite for delete with audit logging
    await this.databaseService.executeHealthcareWrite(
      async client => {
        return await client.vital.delete({ where: { id } });
      },
      {
        userId: vital.userId,
        clinicId: vital.clinicId || '',
        resourceType: 'VITAL',
        operation: 'DELETE',
        resourceId: id,
        userRole: 'system',
        details: { userId: vital.userId },
      }
    );
    await this.eventService.emit('ehr.vital.deleted', { vitalId: id });
    await this.invalidateUserEHRCache(vital.userId);
  }

  // ============ Allergies ============

  async createAllergy(data: CreateAllergyDto): Promise<AllergyResponse> {
    // Use executeHealthcareWrite for create with audit logging
    const allergy = await this.databaseService.executeHealthcareWrite(
      async client => {
        const createData: {
          userId: string;
          allergen: string;
          severity: string;
          reaction: string;
          diagnosedDate: Date;
          notes?: string;
        } = {
          userId: data.userId,
          allergen: data.allergen,
          severity: data.severity,
          reaction: data.reaction,
          diagnosedDate: new Date(data.diagnosedDate),
        };
        if (data.notes) {
          createData.notes = data.notes;
        }
        return await client.allergy.create({
          data: createData,
        });
      },
      {
        userId: data.userId || 'system',
        clinicId: '',
        resourceType: 'ALLERGY',
        operation: 'CREATE',
        resourceId: '',
        userRole: 'system',
        details: { userId: data.userId, allergen: data.allergen },
      }
    );

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Allergy record created',
      'EHRService',
      { allergyId: allergy.id, userId: data.userId }
    );

    await this.eventService.emit('ehr.allergy.created', {
      allergyId: allergy.id,
    });
    await this.invalidateUserEHRCache(data.userId);

    return this.transformAllergy(allergy);
  }

  async getAllergies(userId: string) {
    // Use executeHealthcareRead for optimized query
    return await this.databaseService.executeHealthcareRead(async client => {
      return await client.allergy.findMany({
        where: { userId },
        orderBy: { diagnosedDate: 'desc' },
      });
    });
  }

  async updateAllergy(id: string, data: UpdateAllergyDto): Promise<AllergyResponse> {
    // Use executeHealthcareWrite for update with audit logging
    const allergy = await this.databaseService.executeHealthcareWrite(
      async client => {
        const updateData: {
          allergen?: string;
          severity?: string;
          reaction?: string;
          diagnosedDate?: Date;
          notes?: string;
        } = {};
        if (data.allergen) {
          updateData.allergen = data.allergen;
        }
        if (data.severity) {
          updateData.severity = data.severity;
        }
        if (data.reaction) {
          updateData.reaction = data.reaction;
        }
        if (data.diagnosedDate) {
          updateData.diagnosedDate = new Date(data.diagnosedDate);
        }
        if (data.notes) {
          updateData.notes = data.notes;
        }
        return await client.allergy.update({
          where: { id },
          data: updateData,
        });
      },
      {
        userId: 'system',
        clinicId: '',
        resourceType: 'ALLERGY',
        operation: 'UPDATE',
        resourceId: id,
        userRole: 'system',
        details: { updateFields: Object.keys(data) },
      }
    );

    await this.eventService.emit('ehr.allergy.updated', { allergyId: id });
    await this.invalidateUserEHRCache(allergy.userId);

    return this.transformAllergy(allergy);
  }

  async deleteAllergy(id: string): Promise<void> {
    // Use executeHealthcareRead first to get record for cache invalidation
    const allergy = await this.databaseService.executeHealthcareRead(async client => {
      return await client.allergy.findUnique({
        where: { id },
      });
    });
    if (!allergy) throw new NotFoundException(`Allergy record with ID ${id} not found`);

    // Use executeHealthcareWrite for delete with audit logging
    await this.databaseService.executeHealthcareWrite(
      async client => {
        return await client.allergy.delete({ where: { id } });
      },
      {
        userId: allergy.userId,
        clinicId: allergy.clinicId || '',
        resourceType: 'ALLERGY',
        operation: 'DELETE',
        resourceId: id,
        userRole: 'system',
        details: { userId: allergy.userId },
      }
    );
    await this.eventService.emit('ehr.allergy.deleted', { allergyId: id });
    await this.invalidateUserEHRCache(allergy.userId);
  }

  // ============ Medications ============

  async createMedication(data: CreateMedicationDto): Promise<MedicationResponse> {
    // Use executeHealthcareWrite for create with audit logging
    const medication = await this.databaseService.executeHealthcareWrite(
      async client => {
        const createData: {
          userId: string;
          name: string;
          dosage: string;
          frequency: string;
          startDate: Date;
          endDate?: Date;
          prescribedBy: string;
          purpose?: string;
          sideEffects?: string;
        } = {
          userId: data.userId,
          name: data.name,
          dosage: data.dosage,
          frequency: data.frequency,
          startDate: new Date(data.startDate),
          prescribedBy: data.prescribedBy,
        };
        if (data.endDate) {
          createData.endDate = new Date(data.endDate);
        }
        if (data.purpose) {
          createData.purpose = data.purpose;
        }
        if (data.sideEffects) {
          createData.sideEffects = data.sideEffects;
        }
        return await client.medication.create({
          data: createData,
        });
      },
      {
        userId: data.userId || 'system',
        clinicId: '',
        resourceType: 'MEDICATION',
        operation: 'CREATE',
        resourceId: '',
        userRole: 'system',
        details: { userId: data.userId, name: data.name },
      }
    );

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Medication record created',
      'EHRService',
      { medicationId: medication.id, userId: data.userId }
    );

    await this.eventService.emit('ehr.medication.created', {
      medicationId: medication.id,
    });
    await this.invalidateUserEHRCache(data.userId);

    return this.transformMedication(medication);
  }

  async getMedications(userId: string, activeOnly: boolean = false) {
    // Use executeHealthcareRead for optimized query
    return await this.databaseService.executeHealthcareRead(async client => {
      return await client.medication.findMany({
        where: {
          userId,
          ...(activeOnly && { isActive: true }),
        },
        orderBy: { startDate: 'desc' },
      });
    });
  }

  async updateMedication(id: string, data: UpdateMedicationDto): Promise<MedicationResponse> {
    // Use executeHealthcareWrite for update with audit logging
    const medication = await this.databaseService.executeHealthcareWrite(
      async client => {
        const updateData: {
          name?: string;
          dosage?: string;
          frequency?: string;
          startDate?: Date;
          endDate?: Date;
          prescribedBy?: string;
          purpose?: string;
          sideEffects?: string;
        } = {};
        if (data.name) {
          updateData.name = data.name;
        }
        if (data.dosage) {
          updateData.dosage = data.dosage;
        }
        if (data.frequency) {
          updateData.frequency = data.frequency;
        }
        if (data.startDate) {
          updateData.startDate = new Date(data.startDate);
        }
        if (data.endDate) {
          updateData.endDate = new Date(data.endDate);
        }
        if (data.prescribedBy) {
          updateData.prescribedBy = data.prescribedBy;
        }
        if (data.purpose) {
          updateData.purpose = data.purpose;
        }
        if (data.sideEffects) {
          updateData.sideEffects = data.sideEffects;
        }
        return await client.medication.update({
          where: { id },
          data: updateData,
        });
      },
      {
        userId: 'system',
        clinicId: '',
        resourceType: 'MEDICATION',
        operation: 'UPDATE',
        resourceId: id,
        userRole: 'system',
        details: { updateFields: Object.keys(data) },
      }
    );

    await this.eventService.emit('ehr.medication.updated', {
      medicationId: id,
    });
    await this.invalidateUserEHRCache(medication.userId);

    return this.transformMedication(medication);
  }

  async deleteMedication(id: string): Promise<void> {
    // Use executeHealthcareRead first to get record for cache invalidation
    const medication = await this.databaseService.executeHealthcareRead(async client => {
      return await client.medication.findUnique({
        where: { id },
      });
    });
    if (!medication) throw new NotFoundException(`Medication record with ID ${id} not found`);

    // Use executeHealthcareWrite for delete with audit logging
    await this.databaseService.executeHealthcareWrite(
      async client => {
        return await client.medication.delete({ where: { id } });
      },
      {
        userId: medication.userId,
        clinicId: medication.clinicId || '',
        resourceType: 'MEDICATION',
        operation: 'DELETE',
        resourceId: id,
        userRole: 'system',
        details: { userId: medication.userId },
      }
    );
    await this.eventService.emit('ehr.medication.deleted', {
      medicationId: id,
    });
    await this.invalidateUserEHRCache(medication.userId);
  }

  // ============ Immunizations ============

  async createImmunization(data: CreateImmunizationDto): Promise<ImmunizationResponse> {
    // Use executeHealthcareWrite for create with audit logging
    const immunization = await this.databaseService.executeHealthcareWrite(
      async client => {
        const createData: {
          userId: string;
          vaccineName: string;
          dateAdministered: Date;
          nextDueDate?: Date;
          batchNumber?: string;
          administrator?: string;
          location?: string;
          notes?: string;
        } = {
          userId: data.userId,
          vaccineName: data.vaccineName,
          dateAdministered: new Date(data.dateAdministered),
        };
        if (data.nextDueDate) {
          createData.nextDueDate = new Date(data.nextDueDate);
        }
        if (data.batchNumber) {
          createData.batchNumber = data.batchNumber;
        }
        if (data.administrator) {
          createData.administrator = data.administrator;
        }
        if (data.location) {
          createData.location = data.location;
        }
        if (data.notes) {
          createData.notes = data.notes;
        }
        return await client.immunization.create({
          data: createData,
        });
      },
      {
        userId: data.userId || 'system',
        clinicId: '',
        resourceType: 'IMMUNIZATION',
        operation: 'CREATE',
        resourceId: '',
        userRole: 'system',
        details: { userId: data.userId, vaccineName: data.vaccineName },
      }
    );

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Immunization record created',
      'EHRService',
      { immunizationId: immunization.id, userId: data.userId }
    );

    await this.eventService.emit('ehr.immunization.created', {
      immunizationId: immunization.id,
    });
    await this.invalidateUserEHRCache(data.userId);

    return this.transformImmunization(immunization);
  }

  async getImmunizations(userId: string): Promise<ImmunizationResponse[]> {
    // Use executeHealthcareRead for optimized query
    const records: Immunization[] = await this.databaseService.executeHealthcareRead(
      async client => {
        return await client.immunization.findMany({
          where: { userId },
          orderBy: { dateAdministered: 'desc' },
        });
      }
    );

    return records.map(record => this.transformImmunization(record));
  }

  async updateImmunization(id: string, data: UpdateImmunizationDto): Promise<ImmunizationResponse> {
    // Use executeHealthcareWrite for update with audit logging
    const immunization: Immunization = await this.databaseService.executeHealthcareWrite(
      async client => {
        const updateData: {
          vaccineName?: string;
          dateAdministered?: Date;
          nextDueDate?: Date;
          batchNumber?: string;
          administrator?: string;
          location?: string;
          notes?: string;
        } = {};
        if (data.vaccineName) {
          updateData.vaccineName = data.vaccineName;
        }
        if (data.dateAdministered) {
          updateData.dateAdministered = new Date(data.dateAdministered);
        }
        if (data.nextDueDate) {
          updateData.nextDueDate = new Date(data.nextDueDate);
        }
        if (data.batchNumber) {
          updateData.batchNumber = data.batchNumber;
        }
        if (data.administrator) {
          updateData.administrator = data.administrator;
        }
        if (data.location) {
          updateData.location = data.location;
        }
        if (data.notes) {
          updateData.notes = data.notes;
        }
        return await client.immunization.update({
          where: { id },
          data: updateData,
        });
      },
      {
        userId: 'system',
        clinicId: '',
        resourceType: 'IMMUNIZATION',
        operation: 'UPDATE',
        resourceId: id,
        userRole: 'system',
        details: { updateFields: Object.keys(data) },
      }
    );

    await this.eventService.emit('ehr.immunization.updated', {
      immunizationId: id,
    });
    await this.invalidateUserEHRCache(immunization.userId);

    return this.transformImmunization(immunization);
  }

  async deleteImmunization(id: string): Promise<void> {
    // Use executeHealthcareRead first to get record for cache invalidation
    const immunization: Immunization | null = await this.databaseService.executeHealthcareRead(
      async client => {
        return await client.immunization.findUnique({
          where: { id },
        });
      }
    );
    if (!immunization) throw new NotFoundException(`Immunization record with ID ${id} not found`);

    // Use executeHealthcareWrite for delete with audit logging
    await this.databaseService.executeHealthcareWrite(
      async client => {
        return await client.immunization.delete({ where: { id } });
      },
      {
        userId: immunization.userId,
        clinicId: immunization.clinicId || '',
        resourceType: 'IMMUNIZATION',
        operation: 'DELETE',
        resourceId: id,
        userRole: 'system',
        details: { userId: immunization.userId },
      }
    );
    await this.eventService.emit('ehr.immunization.deleted', {
      immunizationId: id,
    });
    await this.invalidateUserEHRCache(immunization.userId);
  }

  // ============ Analytics ============

  async getHealthTrends(
    userId: string,
    vitalType: string,
    startDate?: Date,
    endDate?: Date
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

    // Use executeHealthcareRead for optimized query
    const vitals: Vital[] = await this.databaseService.executeHealthcareRead(async client => {
      return await client.vital.findMany({
        where,
        orderBy: { recordedAt: 'asc' },
      });
    });

    return {
      vitalType,
      data: vitals,
      count: vitals.length,
    };
  }

  async getMedicationAdherence(
    userId: string
  ): Promise<{ totalActive: number; medications: Medication[] }> {
    // Use executeHealthcareRead for optimized query
    const medications: Medication[] = await this.databaseService.executeHealthcareRead(
      async client => {
        return await client.medication.findMany({
          where: {
            userId,
            isActive: true,
          },
        });
      }
    );

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
    filters?: ClinicEHRRecordFilters
  ): Promise<GetClinicRecordsByFilterResult> {
    let conditions: MedicalHistoryRecord[] = [];
    let allergies: AllergyRecord[] = [];
    let medications: MedicationRecord[] = [];

    interface BaseWhereClause {
      clinicId: string;
      createdAt?: {
        gte?: Date;
        lte?: Date;
      };
      [key: string]: unknown;
    }

    interface MedicalHistoryWhere extends BaseWhereClause {
      condition?: { contains: string; mode: 'insensitive' };
    }

    interface AllergyWhere extends BaseWhereClause {
      allergen?: { contains: string; mode: 'insensitive' };
    }

    interface MedicationWhere extends BaseWhereClause {
      name?: { contains: string; mode: 'insensitive' };
    }

    switch (filters?.recordType) {
      case 'medical_history': {
        let where: MedicalHistoryWhere = { clinicId };
        where = addStringFilter(where, 'condition', filters.hasCondition);
        where = addDateRangeFilter(where, filters?.dateFrom, filters?.dateTo);
        // Use executeHealthcareRead for optimized query
        const medicalHistoryRecords = await this.databaseService.executeHealthcareRead(
          async client => {
            return (await client.medicalHistory.findMany({
              where,
              select: {
                id: true,
                userId: true,
                clinicId: true,
                condition: true,
                diagnosis: true,
                treatment: true,
                date: true,
                doctorId: true,
                notes: true,
                createdAt: true,
                updatedAt: true,
              } as {
                id: boolean;
                userId: boolean;
                clinicId: boolean;
                condition: boolean;
                diagnosis: boolean;
                treatment: boolean;
                date: boolean;
                doctorId: boolean;
                notes: boolean;
                createdAt: boolean;
                updatedAt: boolean;
              },
              orderBy: { date: 'desc' },
            })) as Array<{
              id: string;
              userId: string;
              clinicId: string | null;
              condition: string;
              diagnosis: string | null;
              treatment: string | null;
              date: Date;
              doctorId: string | null;
              notes: string | null;
              createdAt: Date;
              updatedAt: Date;
            }>;
          }
        );
        conditions = medicalHistoryRecords.map((record): MedicalHistoryRecord => {
          const result: MedicalHistoryRecord = {
            id: record.id,
            userId: record.userId,
            clinicId: record.clinicId || '',
            condition: record.condition,
            diagnosis: record.diagnosis || '',
            treatment: record.treatment || '',
            date: record.date,
            doctorId: record.doctorId || '',
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
          };
          if (record.notes) {
            result.notes = record.notes;
          }
          return result;
        });
        break;
      }

      case 'lab_report': {
        let where: BaseWhereClause = { clinicId };
        where = addDateRangeFilter(where, filters?.dateFrom, filters?.dateTo);
        // Use executeHealthcareRead for optimized query
        await this.databaseService.executeHealthcareRead(async client => {
          return await client.labReport.findMany({
            where,
            include: { user: { select: USER_SELECT_FIELDS } },
            orderBy: { date: 'desc' },
          });
        });
        // Lab reports don't fit into our current structure, skip for now
        break;
      }

      case 'vital': {
        let where: BaseWhereClause = { clinicId };
        where = addDateRangeFilter(where, filters?.dateFrom, filters?.dateTo);
        // Use executeHealthcareRead for optimized query
        await this.databaseService.executeHealthcareRead(async client => {
          return await client.vital.findMany({
            where,
            include: { user: { select: USER_SELECT_FIELDS } },
            orderBy: { recordedAt: 'desc' },
          });
        });
        // Vitals don't fit into our current structure, skip for now
        break;
      }

      case 'allergy': {
        let where: AllergyWhere = { clinicId };
        where = addStringFilter(where, 'allergen', filters.hasAllergy);
        where = addDateRangeFilter(where, filters?.dateFrom, filters?.dateTo);
        // Use executeHealthcareRead for optimized query
        const allergyRecords = await this.databaseService.executeHealthcareRead(async client => {
          return (await client.allergy.findMany({
            where,
            select: {
              id: true,
              userId: true,
              clinicId: true,
              allergen: true,
              severity: true,
              reaction: true,
              diagnosedDate: true,
              doctorId: true,
              notes: true,
              createdAt: true,
              updatedAt: true,
            } as {
              id: boolean;
              userId: boolean;
              clinicId: boolean;
              allergen: boolean;
              severity: boolean;
              reaction: boolean;
              diagnosedDate: boolean;
              doctorId: boolean;
              notes: boolean;
              createdAt: boolean;
              updatedAt: boolean;
            },
            orderBy: { diagnosedDate: 'desc' },
          })) as Array<{
            id: string;
            userId: string;
            clinicId: string | null;
            allergen: string;
            severity: string;
            reaction: string;
            diagnosedDate: Date;
            doctorId: string | null;
            notes: string | null;
            createdAt: Date;
            updatedAt: Date;
          }>;
        });
        allergies = allergyRecords.map((record): AllergyRecord => {
          const result: AllergyRecord = {
            id: record.id,
            userId: record.userId,
            clinicId: record.clinicId || '',
            allergen: record.allergen,
            severity: record.severity,
            reaction: record.reaction,
            diagnosedDate: record.diagnosedDate,
            doctorId: record.doctorId || '',
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
          };
          if (record.notes) {
            result.notes = record.notes;
          }
          return result;
        });
        break;
      }

      case 'medication': {
        let where: MedicationWhere = { clinicId };
        where = addStringFilter(where, 'name', filters.onMedication);
        where = addDateRangeFilter(where, filters?.dateFrom, filters?.dateTo);
        // Use executeHealthcareRead for optimized query
        const medicationRecords = await this.databaseService.executeHealthcareRead(async client => {
          return (await client.medication.findMany({
            where,
            select: {
              id: true,
              userId: true,
              clinicId: true,
              name: true,
              dosage: true,
              frequency: true,
              startDate: true,
              endDate: true,
              doctorId: true,
              notes: true,
              createdAt: true,
              updatedAt: true,
            } as {
              id: boolean;
              userId: boolean;
              clinicId: boolean;
              name: boolean;
              dosage: boolean;
              frequency: boolean;
              startDate: boolean;
              endDate: boolean;
              doctorId: boolean;
              notes: boolean;
              createdAt: boolean;
              updatedAt: boolean;
            },
            orderBy: { startDate: 'desc' },
          })) as Array<{
            id: string;
            userId: string;
            clinicId: string | null;
            name: string;
            dosage: string;
            frequency: string;
            startDate: Date;
            endDate: Date | null;
            doctorId: string | null;
            notes: string | null;
            createdAt: Date;
            updatedAt: Date;
          }>;
        });
        medications = medicationRecords.map((record): MedicationRecord => {
          const result: MedicationRecord = {
            id: record.id,
            userId: record.userId,
            clinicId: record.clinicId || '',
            name: record.name,
            dosage: record.dosage,
            frequency: record.frequency,
            startDate: record.startDate,
            doctorId: record.doctorId || '',
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
          };
          if (record.endDate) {
            result.endDate = record.endDate;
          }
          // notes field not in Medication Prisma schema - skip
          return result;
        });
        break;
      }

      default: {
        // Get all record types using executeHealthcareRead for optimized queries
        const [medicalHistoryRecords, allergyRecords, medicationRecords] = await Promise.all([
          this.databaseService.executeHealthcareRead(async client => {
            return (await client.medicalHistory.findMany({
              where: { clinicId },
              select: {
                id: true,
                userId: true,
                clinicId: true,
                condition: true,
                diagnosis: true,
                treatment: true,
                date: true,
                doctorId: true,
                notes: true,
                createdAt: true,
                updatedAt: true,
              } as {
                id: boolean;
                userId: boolean;
                clinicId: boolean;
                condition: boolean;
                diagnosis: boolean;
                treatment: boolean;
                date: boolean;
                doctorId: boolean;
                notes: boolean;
                createdAt: boolean;
                updatedAt: boolean;
              },
              orderBy: { date: 'desc' },
            })) as Array<{
              id: string;
              userId: string;
              clinicId: string | null;
              condition: string;
              diagnosis: string | null;
              treatment: string | null;
              date: Date;
              doctorId: string | null;
              notes: string | null;
              createdAt: Date;
              updatedAt: Date;
            }>;
          }),
          this.databaseService.executeHealthcareRead(async client => {
            return (await client.allergy.findMany({
              where: { clinicId },
              select: {
                id: true,
                userId: true,
                clinicId: true,
                allergen: true,
                severity: true,
                reaction: true,
                diagnosedDate: true,
                doctorId: true,
                notes: true,
                createdAt: true,
                updatedAt: true,
              } as {
                id: boolean;
                userId: boolean;
                clinicId: boolean;
                allergen: boolean;
                severity: boolean;
                reaction: boolean;
                diagnosedDate: boolean;
                doctorId: boolean;
                notes: boolean;
                createdAt: boolean;
                updatedAt: boolean;
              },
              orderBy: { diagnosedDate: 'desc' },
            })) as Array<{
              id: string;
              userId: string;
              clinicId: string | null;
              allergen: string;
              severity: string;
              reaction: string;
              diagnosedDate: Date;
              doctorId: string | null;
              notes: string | null;
              createdAt: Date;
              updatedAt: Date;
            }>;
          }),
          this.databaseService.executeHealthcareRead(async client => {
            return (await client.medication.findMany({
              where: { clinicId },
              select: {
                id: true,
                userId: true,
                clinicId: true,
                name: true,
                dosage: true,
                frequency: true,
                startDate: true,
                endDate: true,
                doctorId: true,
                notes: true,
                createdAt: true,
                updatedAt: true,
              } as {
                id: boolean;
                userId: boolean;
                clinicId: boolean;
                name: boolean;
                dosage: boolean;
                frequency: boolean;
                startDate: boolean;
                endDate: boolean;
                doctorId: boolean;
                notes: boolean;
                createdAt: boolean;
                updatedAt: boolean;
              },
              orderBy: { startDate: 'desc' },
            })) as Array<{
              id: string;
              userId: string;
              clinicId: string | null;
              name: string;
              dosage: string;
              frequency: string;
              startDate: Date;
              endDate: Date | null;
              doctorId: string | null;
              notes: string | null;
              createdAt: Date;
              updatedAt: Date;
            }>;
          }),
        ]);

        conditions = medicalHistoryRecords.map((record): MedicalHistoryRecord => {
          const result: MedicalHistoryRecord = {
            id: record.id,
            userId: record.userId,
            clinicId: record.clinicId || '',
            condition: record.condition,
            diagnosis: record.diagnosis || '',
            treatment: record.treatment || '',
            date: record.date,
            doctorId: record.doctorId || '',
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
          };
          if (record.notes) {
            result.notes = record.notes;
          }
          return result;
        });
        allergies = allergyRecords.map((record): AllergyRecord => {
          const result: AllergyRecord = {
            id: record.id,
            userId: record.userId,
            clinicId: record.clinicId || '',
            allergen: record.allergen,
            severity: record.severity,
            reaction: record.reaction,
            diagnosedDate: record.diagnosedDate,
            doctorId: record.doctorId || '',
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
          };
          if (record.notes) {
            result.notes = record.notes;
          }
          return result;
        });
        medications = medicationRecords.map((record): MedicationRecord => {
          const result: MedicationRecord = {
            id: record.id,
            userId: record.userId,
            clinicId: record.clinicId || '',
            name: record.name,
            dosage: record.dosage,
            frequency: record.frequency,
            startDate: record.startDate,
            doctorId: record.doctorId || '',
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
          };
          if (record.endDate) {
            result.endDate = record.endDate;
          }
          // notes field not in Medication Prisma schema - skip
          return result;
        });
        break;
      }
    }

    return {
      conditions,
      allergies,
      medications,
      total: conditions.length + allergies.length + medications.length,
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
          // Use executeHealthcareRead for optimized queries
          this.databaseService.executeHealthcareRead(async client => {
            return await client.medicalHistory.findMany({
              where: { clinicId },
              select: { userId: true },
              distinct: ['userId'],
            });
          }) as Promise<Array<{ userId: string }>>,
          this.databaseService.executeHealthcareRead(async client => {
            return await client.medicalHistory.count({ where: { clinicId } });
          }),
          this.databaseService.executeHealthcareRead(async client => {
            return await client.labReport.count({ where: { clinicId } });
          }),
          this.databaseService.executeHealthcareRead(async client => {
            return await client.vital.count({ where: { clinicId } });
          }),
          this.databaseService.executeHealthcareRead(async client => {
            return await client.allergy.count({ where: { clinicId } });
          }),
          this.databaseService.executeHealthcareRead(async client => {
            return await client.medication.count({
              where: { clinicId, isActive: true },
            });
          }),
          Promise.all([
            this.databaseService.executeHealthcareRead(async client => {
              return await client.medicalHistory.count({
                where: {
                  clinicId,
                  createdAt: {
                    gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                  },
                },
              });
            }),
            this.databaseService.executeHealthcareRead(async client => {
              return await client.labReport.count({
                where: {
                  clinicId,
                  createdAt: {
                    gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                  },
                },
              });
            }),
          ]),
          this.databaseService.executeHealthcareRead(async client => {
            return await client.medicalHistory.groupBy({
              by: ['condition'],
              where: { clinicId },
              _count: { condition: true },
              orderBy: { _count: { condition: 'desc' } },
              take: 10,
            });
          }),
          this.databaseService.executeHealthcareRead(async client => {
            return await client.allergy.groupBy({
              by: ['allergen'],
              where: { clinicId },
              _count: { allergen: true },
              orderBy: { _count: { allergen: 'desc' } },
              take: 10,
            });
          }),
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
            commonConditions: commonConditions.map(c => ({
              condition: c.condition || '',
              count: c._count?.condition || 0,
            })),
            commonAllergies: commonAllergies.map(a => ({
              allergen: a.allergen || '',
              count: a._count?.allergen || 0,
            })),
          },
        };
      },
      {
        ttl: 3600,
        tags: [`clinic:${clinicId}`, 'analytics'],
        priority: 'normal',
      }
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
        // Use executeHealthcareRead for optimized query
        const patientsWithRecords = (await this.databaseService.executeHealthcareRead(
          async client => {
            return await client.user.findMany({
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
                  orderBy: { date: 'desc' },
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
          }
        )) as Array<{
          id: string;
          firstName: string;
          lastName: string;
          email: string | null;
          phone: string | null;
          dateOfBirth: Date | null;
          gender: string | null;
          medicalHistories: Array<{ date: Date }>;
          allergies: Array<{ allergen: string; severity: string }>;
          medications: Array<{ name: string; dosage: string }>;
        }>;

        type PatientWithRecords = (typeof patientsWithRecords)[number];
        type AllergyRecord = PatientWithRecords['allergies'][number];

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
                  (Date.now() - patient.dateOfBirth.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
                )
              : null,
            gender: patient.gender,
            lastVisit: patient.medicalHistories[0]?.date || null,
            activeAllergies: patient.allergies.length,
            activeMedications: patient.medications.length,
            criticalAllergies: patient.allergies.filter(
              (a: AllergyRecord) => a.severity === 'Severe'
            ),
          })),
        };
      },
      {
        ttl: 1800,
        tags: [`clinic:${clinicId}`, 'patients_summary'],
        priority: 'high',
        containsPHI: true,
      }
    );
  }

  /**
   * Search clinic EHR records
   */
  async searchClinicRecords(
    clinicId: string,
    searchTerm: string,
    searchTypes?: string[]
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
    const types = searchTypes || ['conditions', 'allergies', 'medications', 'procedures'];

    if (types.includes('conditions')) {
      // Use executeHealthcareRead for optimized query
      results.conditions = (await this.databaseService.executeHealthcareRead(async client => {
        return await client.medicalHistory.findMany({
          where: {
            clinicId,
            OR: [
              { condition: { contains: searchTerm, mode: 'insensitive' } },
              { notes: { contains: searchTerm, mode: 'insensitive' } },
            ],
          },
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
          take: 20,
        });
      })) as Array<{
        id: string;
        user: { id: string; firstName: string; lastName: string } | null;
        condition: string;
        date: Date;
        notes?: string;
      }>;
    }

    if (types.includes('allergies')) {
      // Use executeHealthcareRead for optimized query
      results.allergies = (await this.databaseService.executeHealthcareRead(async client => {
        return await client.allergy.findMany({
          where: {
            clinicId,
            allergen: { contains: searchTerm, mode: 'insensitive' },
          },
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
          take: 20,
        });
      })) as Array<{
        id: string;
        user: { id: string; firstName: string; lastName: string } | null;
        allergen: string;
        severity: string;
        reaction: string;
        diagnosedDate: Date;
      }>;
    }

    if (types.includes('medications')) {
      // Use executeHealthcareRead for optimized query
      results.medications = (await this.databaseService.executeHealthcareRead(async client => {
        return await client.medication.findMany({
          where: {
            clinicId,
            name: { contains: searchTerm, mode: 'insensitive' },
          },
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
          take: 20,
        });
      })) as Array<{
        id: string;
        user: { id: string; firstName: string; lastName: string } | null;
        name: string;
        dosage: string;
        frequency: string;
        startDate: Date;
        isActive: boolean;
      }>;
    }

    if (types.includes('procedures')) {
      // Use executeHealthcareRead for optimized query
      results.procedures = (await this.databaseService.executeHealthcareRead(async client => {
        return await client.surgicalRecord.findMany({
          where: {
            clinicId,
            surgeryName: { contains: searchTerm, mode: 'insensitive' },
          },
          include: {
            user: { select: { id: true, firstName: true, lastName: true } },
          },
          take: 20,
        });
      })) as Array<{
        id: string;
        user: { id: string; firstName: string; lastName: string } | null;
        surgeryName: string;
        surgeon: string;
        date: Date;
        notes?: string;
      }>;
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
        // Use executeHealthcareRead for optimized queries
        const [severeAllergies, criticalVitals]: [Allergy[], Vital[]] = await Promise.all([
          this.databaseService.executeHealthcareRead(async client => {
            return await client.allergy.findMany({
              where: {
                clinicId,
                severity: 'Severe',
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
            });
          }) as Promise<Allergy[]>,
          this.databaseService.executeHealthcareRead(async client => {
            return await client.vital.findMany({
              where: {
                clinicId,
                type: { in: ['blood_pressure', 'heart_rate', 'temperature'] },
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
              orderBy: { recordedAt: 'desc' },
            });
          }) as Promise<Vital[]>,
        ]);

        // Define types for records with user relation
        type VitalRecordWithUser = {
          id: string;
          userId: string;
          clinicId: string | null;
          type: string;
          value: string;
          recordedAt: Date;
          user?: {
            id: string;
            firstName: string | null;
            lastName: string | null;
            phone: string | null;
          } | null;
        };

        type AllergyRecordWithUser = {
          id: string;
          userId: string;
          allergen: string;
          severity: string;
          reaction: string;
          diagnosedDate: Date;
          user?: {
            id: string;
            firstName: string | null;
            lastName: string | null;
            phone: string | null;
          } | null;
        };

        const criticalVitalAlerts = (criticalVitals as VitalRecordWithUser[]).filter(vital => {
          if (vital.type === 'blood_pressure') {
            const [systolicStr] = String(vital.value).split('/');
            const systolic = systolicStr ? Number(systolicStr) : 0;
            return systolic >= 180 || systolic <= 90;
          }
          if (vital.type === 'heart_rate') {
            const hr = Number(vital.value);
            return hr >= 120 || hr <= 50;
          }
          if (vital.type === 'temperature') {
            const temp = Number(vital.value);
            return temp >= 103 || temp <= 95;
          }
          return false;
        });

        return {
          clinicId,
          alerts: {
            severeAllergies: {
              count: severeAllergies.length,
              patients: (severeAllergies as AllergyRecordWithUser[]).map(a => ({
                patientId: a.userId,
                patientName: a.user
                  ? `${a.user.firstName || ''} ${a.user.lastName || ''}`.trim() || 'Unknown'
                  : 'Unknown',
                allergen: a.allergen,
                reaction: a.reaction,
                diagnosedDate: a.diagnosedDate,
              })),
            },
            criticalVitals: {
              count: criticalVitalAlerts.length,
              readings: criticalVitalAlerts.map(v => ({
                patientId: v.userId,
                patientName: v.user
                  ? `${v.user.firstName || ''} ${v.user.lastName || ''}`.trim() || 'Unknown'
                  : 'Unknown',
                vitalType: v.type,
                value: String(v.value),
                recordedAt: v.recordedAt,
              })),
            },
          },
          totalCriticalAlerts: severeAllergies.length + criticalVitalAlerts.length,
        };
      },
      {
        ttl: 300,
        tags: [`clinic:${clinicId}`, 'alerts'],
        priority: 'high',
        containsPHI: true,
      }
    );
  }

  // ============ Transform Methods ============

  private transformMedicalHistory(record: MedicalHistory): MedicalHistoryResponse {
    return {
      id: record.id,
      userId: record.userId,
      clinicId:
        'clinicId' in record && typeof record.clinicId === 'string' && record.clinicId
          ? record.clinicId
          : '',
      condition: record.condition,
      diagnosis:
        'diagnosis' in record && typeof record.diagnosis === 'string' ? record.diagnosis : '',
      treatment:
        'treatment' in record && typeof record.treatment === 'string' ? record.treatment : '',
      date: record.date.toISOString(),
      doctorId: 'doctorId' in record && typeof record.doctorId === 'string' ? record.doctorId : '',
      notes: 'notes' in record && typeof record.notes === 'string' ? record.notes : '',
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private transformLabReport(record: LabReport): LabReportResponse {
    return {
      id: record.id,
      userId: record.userId,
      clinicId:
        'clinicId' in record && typeof record.clinicId === 'string' && record.clinicId
          ? record.clinicId
          : '',
      testName: record.testName,
      result: record.result,
      unit: 'unit' in record && typeof record.unit === 'string' ? record.unit : '',
      normalRange:
        'normalRange' in record && typeof record.normalRange === 'string' ? record.normalRange : '',
      date: record.date.toISOString(),
      doctorId: 'doctorId' in record && typeof record.doctorId === 'string' ? record.doctorId : '',
      labName: 'labName' in record && typeof record.labName === 'string' ? record.labName : '',
      notes: 'notes' in record && typeof record.notes === 'string' ? record.notes : '',
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private transformRadiologyReport(record: RadiologyReport): RadiologyReportResponse {
    return {
      id: record.id,
      userId: record.userId,
      clinicId:
        'clinicId' in record && typeof record.clinicId === 'string' && record.clinicId
          ? record.clinicId
          : '',
      imageType: record.imageType,
      findings: record.findings,
      conclusion: record.conclusion,
      date: record.date.toISOString(),
      doctorId: 'doctorId' in record && typeof record.doctorId === 'string' ? record.doctorId : '',
      notes: 'notes' in record && typeof record.notes === 'string' ? record.notes : '',
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private transformSurgicalRecord(record: SurgicalRecord): SurgicalRecordResponse {
    return {
      id: record.id,
      userId: record.userId,
      clinicId:
        'clinicId' in record && typeof record.clinicId === 'string' && record.clinicId
          ? record.clinicId
          : '',
      surgeryName: record.surgeryName,
      surgeon: record.surgeon,
      date: record.date.toISOString(),
      doctorId: 'doctorId' in record && typeof record.doctorId === 'string' ? record.doctorId : '',
      notes: 'notes' in record && typeof record.notes === 'string' ? record.notes : '',
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private transformVital(record: Vital): VitalResponse {
    return {
      id: record.id,
      userId: record.userId,
      clinicId:
        'clinicId' in record && typeof record.clinicId === 'string' && record.clinicId
          ? record.clinicId
          : '',
      type: record.type,
      value: Number(record.value),
      unit: 'unit' in record && typeof record.unit === 'string' ? record.unit : '',
      recordedAt: record.recordedAt.toISOString(),
      doctorId: 'doctorId' in record && typeof record.doctorId === 'string' ? record.doctorId : '',
      notes: 'notes' in record && typeof record.notes === 'string' ? record.notes : '',
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private transformAllergy(record: Allergy): AllergyResponse {
    return {
      id: record.id,
      userId: record.userId,
      clinicId:
        'clinicId' in record && typeof record.clinicId === 'string' && record.clinicId
          ? record.clinicId
          : '',
      allergen: record.allergen,
      severity: record.severity,
      reaction: record.reaction,
      diagnosedDate: record.diagnosedDate.toISOString(),
      doctorId: 'doctorId' in record && typeof record.doctorId === 'string' ? record.doctorId : '',
      notes: 'notes' in record && typeof record.notes === 'string' ? record.notes : '',
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private transformMedication(record: Medication): MedicationResponse {
    return {
      id: record.id,
      userId: record.userId,
      clinicId:
        'clinicId' in record && typeof record.clinicId === 'string' && record.clinicId
          ? record.clinicId
          : '',
      name: record.name,
      dosage: record.dosage,
      frequency: record.frequency,
      startDate: record.startDate.toISOString(),
      ...(record.endDate && { endDate: record.endDate.toISOString() }),
      doctorId: 'doctorId' in record && typeof record.doctorId === 'string' ? record.doctorId : '',
      prescribedBy:
        'prescribedBy' in record && typeof record.prescribedBy === 'string'
          ? record.prescribedBy
          : '',
      purpose: 'purpose' in record && typeof record.purpose === 'string' ? record.purpose : '',
      sideEffects:
        'sideEffects' in record && typeof record.sideEffects === 'string' ? record.sideEffects : '',
      isActive:
        'isActive' in record && typeof record.isActive === 'boolean' ? record.isActive : false,
      notes: 'notes' in record && typeof record.notes === 'string' ? record.notes : '',
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private transformImmunization(record: Immunization): ImmunizationResponse {
    return {
      id: record.id,
      userId: record.userId,
      clinicId:
        'clinicId' in record && typeof record.clinicId === 'string' && record.clinicId
          ? record.clinicId
          : '',
      vaccineName: record.vaccineName,
      dateAdministered: record.dateAdministered.toISOString(),
      doctorId: 'doctorId' in record && typeof record.doctorId === 'string' ? record.doctorId : '',
      ...(record.nextDueDate && {
        nextDueDate: record.nextDueDate.toISOString(),
      }),
      batchNumber:
        'batchNumber' in record && typeof record.batchNumber === 'string' ? record.batchNumber : '',
      administrator:
        'administrator' in record && typeof record.administrator === 'string'
          ? record.administrator
          : '',
      location: 'location' in record && typeof record.location === 'string' ? record.location : '',
      notes: 'notes' in record && typeof record.notes === 'string' ? record.notes : '',
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  private transformFamilyHistory(record: FamilyHistory): FamilyHistoryResponse {
    const result: FamilyHistoryResponse = {
      id: record.id,
      userId: record.userId,
      clinicId:
        'clinicId' in record && typeof record.clinicId === 'string' && record.clinicId
          ? record.clinicId
          : '',
      relation: 'relation' in record && typeof record.relation === 'string' ? record.relation : '',
      condition: record.condition,
      doctorId: 'doctorId' in record && typeof record.doctorId === 'string' ? record.doctorId : '',
      notes: 'notes' in record && typeof record.notes === 'string' ? record.notes : '',
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
    if ('diagnosedAge' in record && typeof record.diagnosedAge === 'number') {
      result.diagnosedAge = record.diagnosedAge;
    }
    return result;
  }

  private transformLifestyleAssessment(record: LifestyleAssessment): LifestyleAssessmentResponse {
    const result: LifestyleAssessmentResponse = {
      id: record.id,
      userId: record.userId,
      clinicId:
        'clinicId' in record && typeof record.clinicId === 'string' && record.clinicId
          ? record.clinicId
          : '',
      doctorId: 'doctorId' in record && typeof record.doctorId === 'string' ? record.doctorId : '',
      notes: 'notes' in record && typeof record.notes === 'string' ? record.notes : '',
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
    if ('diet' in record && typeof record.diet === 'string') {
      result.diet = record.diet;
    }
    if ('exercise' in record && typeof record.exercise === 'string') {
      result.exercise = record.exercise;
    }
    if ('smoking' in record && typeof record.smoking === 'string') {
      result.smoking = record.smoking;
    }
    if ('alcohol' in record && typeof record.alcohol === 'string') {
      result.alcohol = record.alcohol;
    }
    if ('sleep' in record && typeof record.sleep === 'string') {
      result.sleep = record.sleep;
    }
    if ('stress' in record && typeof record.stress === 'string') {
      result.stress = record.stress;
    }
    return result;
  }
}
