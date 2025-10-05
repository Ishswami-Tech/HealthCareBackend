import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../libs/infrastructure/database/prisma/prisma.service';
import { CacheService } from '../../libs/infrastructure/cache';
import { LoggingService } from '../../libs/infrastructure/logging/logging.service';
import { EventService } from '../../libs/infrastructure/events/event.service';
import { LogLevel, LogType } from '../../libs/infrastructure/logging/types/logging.types';
import { addDateRangeFilter, addStringFilter, USER_SELECT_FIELDS } from '../../libs/utils/query';
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

@Injectable()
export class EHRService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService,
  ) {}

  // ============ Comprehensive Health Record ============

  async getComprehensiveHealthRecord(userId: string, clinicId?: string): Promise<HealthRecordSummaryDto> {
    const cacheKey = `ehr:comprehensive:${userId}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const [
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
        ] = await Promise.all([
          this.prisma.medicalHistory.findMany({ where: { userId }, orderBy: { date: 'desc' } }),
          this.prisma.labReport.findMany({ where: { userId }, orderBy: { date: 'desc' } }),
          this.prisma.radiologyReport.findMany({ where: { userId }, orderBy: { date: 'desc' } }),
          this.prisma.surgicalRecord.findMany({ where: { userId }, orderBy: { date: 'desc' } }),
          this.prisma.vital.findMany({ where: { userId }, orderBy: { recordedAt: 'desc' } }),
          this.prisma.allergy.findMany({ where: { userId }, orderBy: { diagnosedDate: 'desc' } }),
          this.prisma.medication.findMany({
            where: { userId },
            orderBy: { startDate: 'desc' },
          }),
          this.prisma.immunization.findMany({
            where: { userId },
            orderBy: { dateAdministered: 'desc' },
          }),
          this.prisma.familyHistory.findMany({ where: { userId } }),
          this.prisma.lifestyleAssessment.findFirst({
            where: { userId },
            orderBy: { createdAt: 'desc' },
          }),
        ]);

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
      },
    );
  }

  async invalidateUserEHRCache(userId: string) {
    await this.cacheService.invalidateCacheByTag(`ehr:${userId}`);
  }

  // ============ Medical History ============

  async createMedicalHistory(data: CreateMedicalHistoryDto) {
    const record = await this.prisma.medicalHistory.create({
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
      'Medical history record created',
      'EHRService',
      { recordId: record.id, userId: data.userId, clinicId: data.clinicId },
    );

    await this.eventService.emit('ehr.medical_history.created', { recordId: record.id });
    await this.invalidateUserEHRCache(data.userId);
    if (data.clinicId) {
      await this.cacheService.invalidateCacheByTag(`clinic:${data.clinicId}`);
    }

    return record;
  }

  async getMedicalHistory(userId: string, clinicId?: string) {
    const where: { userId: string; clinicId?: string } = { userId };
    if (clinicId) {
      where.clinicId = clinicId;
    }

    return this.prisma.medicalHistory.findMany({
      where,
      orderBy: { date: 'desc' },
    });
  }

  async updateMedicalHistory(id: string, data: UpdateMedicalHistoryDto) {
    const record = await this.prisma.medicalHistory.update({
      where: { id },
      data: {
        ...data,
        date: data.date ? new Date(data.date) : undefined,
      },
    });

    await this.eventService.emit('ehr.medical_history.updated', { recordId: id });
    await this.invalidateUserEHRCache(record.userId);

    return record;
  }

  async deleteMedicalHistory(id: string) {
    const record = await this.prisma.medicalHistory.findUnique({ where: { id } });
    if (!record) throw new NotFoundException(`Medical history record with ID ${id} not found`);

    await this.prisma.medicalHistory.delete({ where: { id } });
    await this.eventService.emit('ehr.medical_history.deleted', { recordId: id });
    await this.invalidateUserEHRCache(record.userId);
  }

  // ============ Lab Reports ============

  async createLabReport(data: CreateLabReportDto) {
    const report = await this.prisma.labReport.create({
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
      'Lab report created',
      'EHRService',
      { reportId: report.id, userId: data.userId },
    );

    await this.eventService.emit('ehr.lab_report.created', { reportId: report.id });
    await this.invalidateUserEHRCache(data.userId);

    return report;
  }

  async getLabReports(userId: string) {
    return this.prisma.labReport.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
    });
  }

  async updateLabReport(id: string, data: UpdateLabReportDto) {
    const report = await this.prisma.labReport.update({
      where: { id },
      data: {
        ...data,
        date: data.date ? new Date(data.date) : undefined,
      },
    });

    await this.eventService.emit('ehr.lab_report.updated', { reportId: id });
    await this.invalidateUserEHRCache(report.userId);

    return report;
  }

  async deleteLabReport(id: string) {
    const report = await this.prisma.labReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundException(`Lab report with ID ${id} not found`);

    await this.prisma.labReport.delete({ where: { id } });
    await this.eventService.emit('ehr.lab_report.deleted', { reportId: id });
    await this.invalidateUserEHRCache(report.userId);
  }

  // ============ Radiology Reports ============

  async createRadiologyReport(data: CreateRadiologyReportDto) {
    const report = await this.prisma.radiologyReport.create({
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
      'Radiology report created',
      'EHRService',
      { reportId: report.id, userId: data.userId },
    );

    await this.eventService.emit('ehr.radiology_report.created', { reportId: report.id });
    await this.invalidateUserEHRCache(data.userId);

    return report;
  }

  async getRadiologyReports(userId: string) {
    return this.prisma.radiologyReport.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
    });
  }

  async updateRadiologyReport(id: string, data: UpdateRadiologyReportDto) {
    const report = await this.prisma.radiologyReport.update({
      where: { id },
      data: {
        ...data,
        date: data.date ? new Date(data.date) : undefined,
      },
    });

    await this.eventService.emit('ehr.radiology_report.updated', { reportId: id });
    await this.invalidateUserEHRCache(report.userId);

    return report;
  }

  async deleteRadiologyReport(id: string) {
    const report = await this.prisma.radiologyReport.findUnique({ where: { id } });
    if (!report) throw new NotFoundException(`Radiology report with ID ${id} not found`);

    await this.prisma.radiologyReport.delete({ where: { id } });
    await this.eventService.emit('ehr.radiology_report.deleted', { reportId: id });
    await this.invalidateUserEHRCache(report.userId);
  }

  // ============ Surgical Records ============

  async createSurgicalRecord(data: CreateSurgicalRecordDto) {
    const record = await this.prisma.surgicalRecord.create({
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
      'Surgical record created',
      'EHRService',
      { recordId: record.id, userId: data.userId },
    );

    await this.eventService.emit('ehr.surgical_record.created', { recordId: record.id });
    await this.invalidateUserEHRCache(data.userId);

    return record;
  }

  async getSurgicalRecords(userId: string) {
    return this.prisma.surgicalRecord.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
    });
  }

  async updateSurgicalRecord(id: string, data: UpdateSurgicalRecordDto) {
    const record = await this.prisma.surgicalRecord.update({
      where: { id },
      data: {
        ...data,
        date: data.date ? new Date(data.date) : undefined,
      },
    });

    await this.eventService.emit('ehr.surgical_record.updated', { recordId: id });
    await this.invalidateUserEHRCache(record.userId);

    return record;
  }

  async deleteSurgicalRecord(id: string) {
    const record = await this.prisma.surgicalRecord.findUnique({ where: { id } });
    if (!record) throw new NotFoundException(`Surgical record with ID ${id} not found`);

    await this.prisma.surgicalRecord.delete({ where: { id } });
    await this.eventService.emit('ehr.surgical_record.deleted', { recordId: id });
    await this.invalidateUserEHRCache(record.userId);
  }

  // ============ Vitals ============

  async createVital(data: CreateVitalDto) {
    const vital = await this.prisma.vital.create({
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
      'Vital record created',
      'EHRService',
      { vitalId: vital.id, userId: data.userId, type: data.type },
    );

    await this.eventService.emit('ehr.vital.created', { vitalId: vital.id });
    await this.invalidateUserEHRCache(data.userId);

    return vital;
  }

  async getVitals(userId: string, type?: string) {
    return this.prisma.vital.findMany({
      where: {
        userId,
        ...(type && { type }),
      },
      orderBy: { recordedAt: 'desc' },
    });
  }

  async updateVital(id: string, data: UpdateVitalDto) {
    const vital = await this.prisma.vital.update({
      where: { id },
      data: {
        ...data,
        recordedAt: data.recordedAt ? new Date(data.recordedAt) : undefined,
      },
    });

    await this.eventService.emit('ehr.vital.updated', { vitalId: id });
    await this.invalidateUserEHRCache(vital.userId);

    return vital;
  }

  async deleteVital(id: string) {
    const vital = await this.prisma.vital.findUnique({ where: { id } });
    if (!vital) throw new NotFoundException(`Vital record with ID ${id} not found`);

    await this.prisma.vital.delete({ where: { id } });
    await this.eventService.emit('ehr.vital.deleted', { vitalId: id });
    await this.invalidateUserEHRCache(vital.userId);
  }

  // ============ Allergies ============

  async createAllergy(data: CreateAllergyDto) {
    const allergy = await this.prisma.allergy.create({
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
      'Allergy record created',
      'EHRService',
      { allergyId: allergy.id, userId: data.userId },
    );

    await this.eventService.emit('ehr.allergy.created', { allergyId: allergy.id });
    await this.invalidateUserEHRCache(data.userId);

    return allergy;
  }

  async getAllergies(userId: string) {
    return this.prisma.allergy.findMany({
      where: { userId },
      orderBy: { diagnosedDate: 'desc' },
    });
  }

  async updateAllergy(id: string, data: UpdateAllergyDto) {
    const allergy = await this.prisma.allergy.update({
      where: { id },
      data: {
        ...data,
        diagnosedDate: data.diagnosedDate ? new Date(data.diagnosedDate) : undefined,
      },
    });

    await this.eventService.emit('ehr.allergy.updated', { allergyId: id });
    await this.invalidateUserEHRCache(allergy.userId);

    return allergy;
  }

  async deleteAllergy(id: string) {
    const allergy = await this.prisma.allergy.findUnique({ where: { id } });
    if (!allergy) throw new NotFoundException(`Allergy record with ID ${id} not found`);

    await this.prisma.allergy.delete({ where: { id } });
    await this.eventService.emit('ehr.allergy.deleted', { allergyId: id });
    await this.invalidateUserEHRCache(allergy.userId);
  }

  // ============ Medications ============

  async createMedication(data: CreateMedicationDto) {
    const medication = await this.prisma.medication.create({
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
      'Medication record created',
      'EHRService',
      { medicationId: medication.id, userId: data.userId },
    );

    await this.eventService.emit('ehr.medication.created', { medicationId: medication.id });
    await this.invalidateUserEHRCache(data.userId);

    return medication;
  }

  async getMedications(userId: string, activeOnly: boolean = false) {
    return this.prisma.medication.findMany({
      where: {
        userId,
        ...(activeOnly && { isActive: true }),
      },
      orderBy: { startDate: 'desc' },
    });
  }

  async updateMedication(id: string, data: UpdateMedicationDto) {
    const medication = await this.prisma.medication.update({
      where: { id },
      data: {
        ...data,
        startDate: data.startDate ? new Date(data.startDate) : undefined,
        endDate: data.endDate ? new Date(data.endDate) : undefined,
      },
    });

    await this.eventService.emit('ehr.medication.updated', { medicationId: id });
    await this.invalidateUserEHRCache(medication.userId);

    return medication;
  }

  async deleteMedication(id: string) {
    const medication = await this.prisma.medication.findUnique({ where: { id } });
    if (!medication) throw new NotFoundException(`Medication record with ID ${id} not found`);

    await this.prisma.medication.delete({ where: { id } });
    await this.eventService.emit('ehr.medication.deleted', { medicationId: id });
    await this.invalidateUserEHRCache(medication.userId);
  }

  // ============ Immunizations ============

  async createImmunization(data: CreateImmunizationDto) {
    const immunization = await this.prisma.immunization.create({
      data: {
        userId: data.userId,
        vaccineName: data.vaccineName,
        dateAdministered: new Date(data.dateAdministered),
        nextDueDate: data.nextDueDate ? new Date(data.nextDueDate) : undefined,
        batchNumber: data.batchNumber,
        administrator: data.administrator,
        location: data.location,
        notes: data.notes,
      },
    });

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Immunization record created',
      'EHRService',
      { immunizationId: immunization.id, userId: data.userId },
    );

    await this.eventService.emit('ehr.immunization.created', {
      immunizationId: immunization.id,
    });
    await this.invalidateUserEHRCache(data.userId);

    return immunization;
  }

  async getImmunizations(userId: string) {
    return this.prisma.immunization.findMany({
      where: { userId },
      orderBy: { dateAdministered: 'desc' },
    });
  }

  async updateImmunization(id: string, data: UpdateImmunizationDto) {
    const immunization = await this.prisma.immunization.update({
      where: { id },
      data: {
        ...data,
        dateAdministered: data.dateAdministered ? new Date(data.dateAdministered) : undefined,
        nextDueDate: data.nextDueDate ? new Date(data.nextDueDate) : undefined,
      },
    });

    await this.eventService.emit('ehr.immunization.updated', { immunizationId: id });
    await this.invalidateUserEHRCache(immunization.userId);

    return immunization;
  }

  async deleteImmunization(id: string) {
    const immunization = await this.prisma.immunization.findUnique({ where: { id } });
    if (!immunization)
      throw new NotFoundException(`Immunization record with ID ${id} not found`);

    await this.prisma.immunization.delete({ where: { id } });
    await this.eventService.emit('ehr.immunization.deleted', { immunizationId: id });
    await this.invalidateUserEHRCache(immunization.userId);
  }

  // ============ Analytics ============

  async getHealthTrends(userId: string, vitalType: string, startDate?: Date, endDate?: Date) {
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

    const vitals = await this.prisma.vital.findMany({
      where,
      orderBy: { recordedAt: 'asc' },
    });

    return {
      vitalType,
      data: vitals,
      count: vitals.length,
    };
  }

  async getMedicationAdherence(userId: string) {
    const medications = await this.prisma.medication.findMany({
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
  ) {
    type RecordWithUser = Array<{
      id: string;
      user: { id: string; firstName: string; lastName: string; email: string | null } | null;
      [key: string]: unknown;
    }>;

    let records: RecordWithUser = [];

    interface BaseWhereClause {
      clinicId: string;
      createdAt?: {
        gte?: Date;
        lte?: Date;
      };
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
        records = await this.prisma.medicalHistory.findMany({
          where,
          include: { user: { select: USER_SELECT_FIELDS } },
          orderBy: { date: 'desc' },
        });
        break;
      }

      case 'lab_report': {
        let where: BaseWhereClause = { clinicId };
        where = addDateRangeFilter(where, filters?.dateFrom, filters?.dateTo);
        records = await this.prisma.labReport.findMany({
          where,
          include: { user: { select: USER_SELECT_FIELDS } },
          orderBy: { date: 'desc' },
        });
        break;
      }

      case 'vital': {
        let where: BaseWhereClause = { clinicId };
        where = addDateRangeFilter(where, filters?.dateFrom, filters?.dateTo);
        records = await this.prisma.vital.findMany({
          where,
          include: { user: { select: USER_SELECT_FIELDS } },
          orderBy: { recordedAt: 'desc' },
        });
        break;
      }

      case 'allergy': {
        let where: AllergyWhere = { clinicId };
        where = addStringFilter(where, 'allergen', filters.hasAllergy);
        where = addDateRangeFilter(where, filters?.dateFrom, filters?.dateTo);
        records = await this.prisma.allergy.findMany({
          where,
          include: { user: { select: USER_SELECT_FIELDS } },
          orderBy: { diagnosedDate: 'desc' },
        });
        break;
      }

      case 'medication': {
        let where: MedicationWhere = { clinicId };
        where = addStringFilter(where, 'name', filters.onMedication);
        where = addDateRangeFilter(where, filters?.dateFrom, filters?.dateTo);
        records = await this.prisma.medication.findMany({
          where,
          include: { user: { select: USER_SELECT_FIELDS } },
          orderBy: { startDate: 'desc' },
        });
        break;
      }

      default: {
        // Get summary of all record types
        let baseWhere: BaseWhereClause = { clinicId };
        baseWhere = addDateRangeFilter(baseWhere, filters?.dateFrom, filters?.dateTo);
        const [medHistory, labRep, vit, aller, meds] = await Promise.all([
          this.prisma.medicalHistory.count({ where: baseWhere }),
          this.prisma.labReport.count({ where: baseWhere }),
          this.prisma.vital.count({ where: baseWhere }),
          this.prisma.allergy.count({ where: baseWhere }),
          this.prisma.medication.count({ where: baseWhere }),
        ]);

        return {
          clinicId,
          summary: {
            medicalHistory: medHistory,
            labReports: labRep,
            vitals: vit,
            allergies: aller,
            medications: meds,
            total: medHistory + labRep + vit + aller + meds,
          },
        };
      }
    }

    return {
      clinicId,
      recordType: filters?.recordType,
      count: records.length,
      records,
    };
  }

  /**
   * Get clinic EHR analytics
   */
  async getClinicEHRAnalytics(clinicId: string) {
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
          this.prisma.medicalHistory.findMany({
            where: { clinicId },
            select: { userId: true },
            distinct: ['userId'],
          }),
          this.prisma.medicalHistory.count({ where: { clinicId } }),
          this.prisma.labReport.count({ where: { clinicId } }),
          this.prisma.vital.count({ where: { clinicId } }),
          this.prisma.allergy.count({ where: { clinicId } }),
          this.prisma.medication.count({ where: { clinicId, isActive: true } }),
          Promise.all([
            this.prisma.medicalHistory.count({
              where: {
                clinicId,
                createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
              },
            }),
            this.prisma.labReport.count({
              where: {
                clinicId,
                createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
              },
            }),
          ]),
          this.prisma.medicalHistory.groupBy({
            by: ['condition'],
            where: { clinicId },
            _count: { condition: true },
            orderBy: { _count: { condition: 'desc' } },
            take: 10,
          }),
          this.prisma.allergy.groupBy({
            by: ['allergen'],
            where: { clinicId },
            _count: { allergen: true },
            orderBy: { _count: { allergen: 'desc' } },
            take: 10,
          }),
        ]);

        type ConditionGroup = typeof commonConditions[number];
        type AllergyGroup = typeof commonAllergies[number];

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
            commonConditions: commonConditions.map((c: ConditionGroup) => ({
              condition: c.condition,
              count: c._count.condition,
            })),
            commonAllergies: commonAllergies.map((a: AllergyGroup) => ({
              allergen: a.allergen,
              count: a._count.allergen,
            })),
          },
        };
      },
      {
        ttl: 3600,
        tags: [`clinic:${clinicId}`, 'analytics'],
        priority: 'normal',
      },
    );
  }

  /**
   * Get clinic patients summary for dashboard
   */
  async getClinicPatientsSummary(clinicId: string) {
    return this.cacheService.cache(
      `ehr:patients:summary:${clinicId}`,
      async () => {
        const patientsWithRecords = await this.prisma.user.findMany({
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

        type PatientWithRecords = typeof patientsWithRecords[number];
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
              ? Math.floor((Date.now() - patient.dateOfBirth.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
              : null,
            gender: patient.gender,
            lastVisit: patient.medicalHistories[0]?.date || null,
            activeAllergies: patient.allergies.length,
            activeMedications: patient.medications.length,
            criticalAllergies: patient.allergies.filter((a: AllergyRecord) => a.severity === 'Severe'),
          })),
        };
      },
      {
        ttl: 1800,
        tags: [`clinic:${clinicId}`, 'patients_summary'],
        priority: 'high',
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
  ) {
    type SearchResultItem = {
      id: string;
      user: { id: string; firstName: string; lastName: string } | null;
      [key: string]: unknown;
    };

    const results: {
      conditions?: SearchResultItem[];
      allergies?: SearchResultItem[];
      medications?: SearchResultItem[];
      procedures?: SearchResultItem[];
    } = {};
    const types = searchTypes || ['conditions', 'allergies', 'medications', 'procedures'];

    if (types.includes('conditions')) {
      results.conditions = await this.prisma.medicalHistory.findMany({
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
    }

    if (types.includes('allergies')) {
      results.allergies = await this.prisma.allergy.findMany({
        where: {
          clinicId,
          allergen: { contains: searchTerm, mode: 'insensitive' },
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
        },
        take: 20,
      });
    }

    if (types.includes('medications')) {
      results.medications = await this.prisma.medication.findMany({
        where: {
          clinicId,
          name: { contains: searchTerm, mode: 'insensitive' },
        },
        include: {
          user: { select: { id: true, firstName: true, lastName: true } },
        },
        take: 20,
      });
    }

    if (types.includes('procedures')) {
      results.procedures = await this.prisma.surgicalRecord.findMany({
        where: {
          clinicId,
          surgeryName: { contains: searchTerm, mode: 'insensitive' },
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
  async getClinicCriticalAlerts(clinicId: string) {
    return this.cacheService.cache(
      `ehr:alerts:${clinicId}`,
      async () => {
        const [severeAllergies, criticalVitals] = await Promise.all([
          this.prisma.allergy.findMany({
            where: {
              clinicId,
              severity: 'Severe',
            },
            include: {
              user: {
                select: { id: true, firstName: true, lastName: true, phone: true },
              },
            },
          }),
          this.prisma.vital.findMany({
            where: {
              clinicId,
              type: { in: ['blood_pressure', 'heart_rate', 'temperature'] },
              recordedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            },
            include: {
              user: {
                select: { id: true, firstName: true, lastName: true, phone: true },
              },
            },
            orderBy: { recordedAt: 'desc' },
          }),
        ]);

        type VitalRecord = typeof criticalVitals[number];
        type AllergyRecord = typeof severeAllergies[number];

        const criticalVitalAlerts = criticalVitals.filter((vital: VitalRecord) => {
          if (vital.type === 'blood_pressure') {
            const [systolic] = vital.value.split('/').map(Number);
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
              patients: severeAllergies.map((a: AllergyRecord) => ({
                patientId: a.userId,
                patientName: a.user ? `${a.user.firstName} ${a.user.lastName}` : 'Unknown',
                allergen: a.allergen,
                reaction: a.reaction,
                diagnosedDate: a.diagnosedDate,
              })),
            },
            criticalVitals: {
              count: criticalVitalAlerts.length,
              readings: criticalVitalAlerts.map((v: VitalRecord) => ({
                patientId: v.userId,
                patientName: v.user ? `${v.user.firstName} ${v.user.lastName}` : 'Unknown',
                vitalType: v.type,
                value: v.value,
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
      },
    );
  }
}
