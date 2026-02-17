import { Injectable, NotFoundException, Inject, forwardRef, Optional } from '@nestjs/common';
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
import { QueueService } from '@queue/src/queue.service';
import { LogLevel, LogType, type IEventService, isEventService } from '@core/types';
import { LAB_REPORT_QUEUE, IMAGING_QUEUE } from '@queue/src/queue.constants';

import {
  addDateRangeFilter,
  addStringFilter,
  USER_SELECT_FIELDS,
} from '@infrastructure/database/query';
import type {
  PrismaTransactionClientWithDelegates,
  PrismaDelegateArgs,
} from '@core/types/prisma.types';
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
  EHRAISummaryDto,
  CreatePrescriptionDto,
} from '@dtos/ehr.dto';
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
  MedicalHistoryBase,
  LabReportBase,
  RadiologyReportBase,
  SurgicalRecordBase,
  VitalBase,
  AllergyBase,
  MedicationBase,
  ImmunizationBase,
  FamilyHistoryBase,
  LifestyleAssessmentBase,
} from '@core/types/ehr.types';

@Injectable()
export class EHRService {
  private readonly eventService: IEventService;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => EventService))
    eventService: unknown,
    @Optional()
    @Inject(forwardRef(() => QueueService))
    private readonly queueService?: QueueService
  ) {
    // Type guard ensures type safety when using the service
    // This handles forwardRef circular dependency type resolution issues
    if (!isEventService(eventService)) {
      throw new Error('EventService is not available or invalid');
    }
    this.eventService = eventService;
  }

  // ============ Comprehensive Health Record ============

  async getComprehensiveHealthRecord(
    userId: string,
    clinicId?: string
  ): Promise<HealthRecordSummaryDto> {
    const cacheKey = `ehr:comprehensive:${userId}:${clinicId || 'all'}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        try {
          const getWhere = (base: Record<string, unknown>) =>
            clinicId ? { ...base, clinicId } : base;

          const results = (await Promise.all([
            // Use executeHealthcareRead for all queries with full optimization layers
            this.databaseService.executeHealthcareRead<unknown[]>(async client => {
              const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
                medicalHistory: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
              };
              return await typedClient.medicalHistory.findMany({
                where: getWhere({ userId }) as PrismaDelegateArgs,
                orderBy: { date: 'desc' } as PrismaDelegateArgs,
              } as PrismaDelegateArgs);
            }),
            this.databaseService.executeHealthcareRead<unknown[]>(async client => {
              const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
                labReport: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
              };
              return await typedClient.labReport.findMany({
                where: getWhere({ userId }) as PrismaDelegateArgs,
                orderBy: { date: 'desc' } as PrismaDelegateArgs,
              } as PrismaDelegateArgs);
            }),
            this.databaseService.executeHealthcareRead<unknown[]>(async client => {
              const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
                radiologyReport: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
              };
              return await typedClient.radiologyReport.findMany({
                where: getWhere({ userId }) as PrismaDelegateArgs,
                orderBy: { date: 'desc' } as PrismaDelegateArgs,
              } as PrismaDelegateArgs);
            }),
            this.databaseService.executeHealthcareRead<unknown[]>(async client => {
              const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
                surgicalRecord: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
              };
              return await typedClient.surgicalRecord.findMany({
                where: getWhere({ userId }) as PrismaDelegateArgs,
                orderBy: { date: 'desc' } as PrismaDelegateArgs,
              } as PrismaDelegateArgs);
            }),
            this.databaseService.executeHealthcareRead<unknown[]>(async client => {
              const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
                vital: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
              };
              return await typedClient.vital.findMany({
                where: getWhere({ userId }) as PrismaDelegateArgs,
                orderBy: { recordedAt: 'desc' } as PrismaDelegateArgs,
              } as PrismaDelegateArgs);
            }),
            this.databaseService.executeHealthcareRead<unknown[]>(async client => {
              const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
                allergy: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
              };
              return await typedClient.allergy.findMany({
                where: getWhere({ userId }) as PrismaDelegateArgs,
                orderBy: { diagnosedDate: 'desc' } as PrismaDelegateArgs,
              } as PrismaDelegateArgs);
            }),
            this.databaseService.executeHealthcareRead<unknown[]>(async client => {
              const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
                medication: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
              };
              return await typedClient.medication.findMany({
                where: getWhere({ userId }) as PrismaDelegateArgs,
                orderBy: { startDate: 'desc' } as PrismaDelegateArgs,
              } as PrismaDelegateArgs);
            }),
            this.databaseService.executeHealthcareRead<unknown[]>(async client => {
              const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
                immunization: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
              };
              return await typedClient.immunization.findMany({
                where: getWhere({ userId }) as PrismaDelegateArgs,
                orderBy: { dateAdministered: 'desc' } as PrismaDelegateArgs,
              } as PrismaDelegateArgs);
            }),
            this.databaseService.executeHealthcareRead<unknown[]>(async client => {
              const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
                familyHistory: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
              };
              return await typedClient.familyHistory.findMany({
                where: getWhere({ userId }) as PrismaDelegateArgs,
              } as PrismaDelegateArgs);
            }),
            this.databaseService.executeHealthcareRead<LifestyleAssessmentBase | null>(
              async client => {
                const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
                  lifestyleAssessment: {
                    findFirst: (
                      args: PrismaDelegateArgs
                    ) => Promise<LifestyleAssessmentBase | null>;
                  };
                };
                return await typedClient.lifestyleAssessment.findFirst({
                  where: getWhere({ userId }) as PrismaDelegateArgs,
                  orderBy: { createdAt: 'desc' } as PrismaDelegateArgs,
                } as PrismaDelegateArgs);
              }
            ),
          ])) as [
            MedicalHistoryBase[],
            LabReportBase[],
            RadiologyReportBase[],
            SurgicalRecordBase[],
            VitalBase[],
            AllergyBase[],
            MedicationBase[],
            ImmunizationBase[],
            FamilyHistoryBase[],
            LifestyleAssessmentBase | null,
          ];

          // Type assertions for the results (using Base types to avoid Prisma type errors)
          const medicalHistoryRaw = results[0];
          const labReportsRaw = results[1];
          const radiologyReportsRaw = results[2];
          const surgicalRecordsRaw = results[3];
          const vitalsRaw = results[4];
          const allergiesRaw = results[5];
          const medicationsRaw = results[6];
          const immunizationsRaw = results[7];
          const familyHistoryRaw = results[8];
          const lifestyleAssessmentRaw = results[9];

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
        } catch (error) {
          await this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.ERROR,
            'Failed to fetch comprehensive health record',
            'EHRService',
            { userId, error: error instanceof Error ? error.message : String(error) }
          );
          throw error;
        }
      },
      {
        ttl: 1800,
        tags: [`ehr:${userId}`],
        priority: 'high',
        containsPHI: true,
      }
    );
  }

  /**
   * Generates an AI-powered summary of the patient's health records
   * @param patientId The ID of the patient (user)
   * @returns AI-generated summary and recommendations
   */
  async getEHRAISummary(patientId: string): Promise<EHRAISummaryDto> {
    const records = await this.getComprehensiveHealthRecord(patientId);

    // AI Logic Simulation: In a production environment, this would call an LLM (e.g., OpenAI, Vertex AI)
    // passing the aggregated health records as context.

    const activeMedications = records.medications?.filter(m => m.isActive) || [];
    const recentVitals = records.vitals?.slice(0, 3) || [];
    const medicalHistory = records.medicalHistory || [];

    let summaryText = `Patient has ${medicalHistory.length} medical history records. Current status is focused on ${
      activeMedications.length > 0
        ? activeMedications.map(m => m.name).join(', ')
        : 'no active medications'
    }. `;

    if (recentVitals.length > 0) {
      summaryText += `Latest vital signs show ${recentVitals.map(v => `${v.type}: ${v.value}${v.unit}`).join(', ')}.`;
    }

    const keyFindings = [];
    const firstHistory = medicalHistory[0];
    if (firstHistory) keyFindings.push(`Documented history of ${firstHistory.condition}`);
    if (records.allergies && records.allergies.length > 0) {
      keyFindings.push(`Known allergies: ${records.allergies.map(a => a.allergen).join(', ')}`);
    }

    const recommendations = [
      'Follow up on latest lab results if pending.',
      'Maintain active medication adherence.',
      'Regular monitoring of vitals recommended based on history.',
    ];

    return {
      patientId,
      summary: summaryText,
      keyFindings: keyFindings.length > 0 ? keyFindings : ['No significant findings identified.'],
      recommendations,
      generatedAt: new Date().toISOString(),
      modelName: 'HealthcareAI-Summary-v1 (Simulated)',
    };
  }

  /**
   * Creates a formal prescription, creating multiple medication records and an audit link
   * @param data Prescription data
   */
  async createPrescription(data: CreatePrescriptionDto): Promise<void> {
    // Audit execution as a single unit or transaction
    await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          medication: { create: (args: PrismaDelegateArgs) => Promise<unknown> };
          healthRecord: { create: (args: PrismaDelegateArgs) => Promise<unknown> };
        };

        // 1. Create each medication record
        if (data.medications && data.medications.length > 0) {
          for (const med of data.medications) {
            await typedClient.medication.create({
              data: {
                userId: data.userId,
                clinicId: data.clinicId || '',
                name: med.name,
                dosage: med.dosage,
                frequency: med.frequency,
                startDate: new Date(med.startDate),
                endDate: med.endDate ? new Date(med.endDate) : null,
                prescribedBy: 'DOCTOR', // Default to doctor for prescription
                notes: med.instructions || '',
                isActive: true,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          }
        }

        // 2. Create a generic health record entry for the prescription event
        await typedClient.healthRecord.create({
          data: {
            patientId: data.userId, // In HealthRecord, patientId is the user's ID
            doctorId: 'system', // Should be the actual doctor ID in a real scenario
            clinicId: data.clinicId || '',
            recordType: 'PRESCRIPTION',
            report:
              data.notes || `Prescription generated for ${data.medications?.length || 0} items.`,
            createdAt: new Date(),
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: data.userId,
        clinicId: data.clinicId || '',
        resourceType: 'MEDICATION',
        operation: 'CREATE',
        resourceId: '',
        userRole: 'DOCTOR',
        details: { medicationsCount: data.medications?.length || 0 },
      }
    );

    await this.invalidateUserEHRCache(data.userId);
    await this.eventService.emit('ehr.prescription.created', {
      userId: data.userId,
      count: data.medications?.length || 0,
    });
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
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          medicalHistory: { create: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.medicalHistory.create({
          data: createData as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
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

    const typedRecord = record as MedicalHistoryBase;
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Medical history record created',
      'EHRService',
      { recordId: typedRecord.id, userId: data.userId, clinicId: data.clinicId }
    );

    await this.eventService.emit('ehr.medical_history.created', {
      recordId: typedRecord.id,
    });
    await this.invalidateUserEHRCache(data.userId);
    if (data.clinicId) {
      await this.cacheService.invalidateCacheByTag(`clinic:${data.clinicId}`);
    }

    return this.transformMedicalHistory(typedRecord);
  }

  async getMedicalHistory(userId: string, clinicId?: string): Promise<MedicalHistoryResponse[]> {
    const cacheKey = `ehr:medical-history:${userId}:${clinicId || 'all'}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        const where: { userId: string; clinicId?: string } = { userId };
        if (clinicId) {
          where.clinicId = clinicId;
        }

        // Use executeHealthcareRead for optimized query
        const records = await this.databaseService.executeHealthcareRead<MedicalHistoryBase[]>(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
              medicalHistory: {
                findMany: (args: PrismaDelegateArgs) => Promise<MedicalHistoryBase[]>;
              };
            };
            return await typedClient.medicalHistory.findMany({
              where: where as PrismaDelegateArgs,
              orderBy: { date: 'desc' } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          }
        );

        return records.map(record => this.transformMedicalHistory(record));
      },
      {
        ttl: 1800, // 30 minutes
        tags: [`ehr:${userId}`, 'medical_history'],
        priority: 'high',
        containsPHI: true,
        compress: true,
      }
    );
  }

  async updateMedicalHistory(
    id: string,
    data: UpdateMedicalHistoryDto,
    clinicId?: string
  ): Promise<MedicalHistoryResponse> {
    // Use executeHealthcareWrite for update with audit logging
    const record = await this.databaseService.executeHealthcareWrite(
      async client => {
        // 🔒 TENANT ISOLATION: Validate record belongs to clinic before updating
        if (clinicId) {
          const typedClientCheck = client as unknown as PrismaTransactionClientWithDelegates & {
            medicalHistory: {
              findUnique: (
                args: PrismaDelegateArgs
              ) => Promise<{ clinicId?: string | null } | null>;
            };
          };
          const existing = await typedClientCheck.medicalHistory.findUnique({
            where: { id } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
          if (existing && existing.clinicId && existing.clinicId !== clinicId) {
            throw new NotFoundException(`Medical history record with ID ${id} not found`);
          }
        }
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
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          medicalHistory: { update: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.medicalHistory.update({
          where: { id } as PrismaDelegateArgs,
          data: updateData as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
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

    const typedRecord = record as MedicalHistoryBase;
    await this.eventService.emit('ehr.medical_history.updated', {
      recordId: id,
    });
    await this.invalidateUserEHRCache(typedRecord.userId);

    return this.transformMedicalHistory(typedRecord);
  }

  async deleteMedicalHistory(id: string, clinicId?: string): Promise<void> {
    // Use executeHealthcareRead first to get record for cache invalidation
    const record = await this.databaseService.executeHealthcareRead<{
      userId: string;
      clinicId?: string | null;
    } | null>(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        medicalHistory: {
          findUnique: (
            args: PrismaDelegateArgs
          ) => Promise<{ userId: string; clinicId?: string | null } | null>;
        };
      };
      return await typedClient.medicalHistory.findUnique({
        where: { id } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
    if (!record) throw new NotFoundException(`Medical history record with ID ${id} not found`);

    const typedRecord = record as { userId: string; clinicId?: string | null };

    // 🔒 TENANT ISOLATION: Validate record belongs to clinic before deleting
    if (clinicId && typedRecord.clinicId && typedRecord.clinicId !== clinicId) {
      throw new NotFoundException(`Medical history record with ID ${id} not found`);
    }

    // Use executeHealthcareWrite for delete with audit logging
    await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          medicalHistory: { delete: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.medicalHistory.delete({
          where: { id } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: typedRecord.userId,
        clinicId: typedRecord.clinicId || '',
        resourceType: 'MEDICAL_HISTORY',
        operation: 'DELETE',
        resourceId: id,
        userRole: 'system',
        details: { userId: typedRecord.userId },
      }
    );
    await this.eventService.emit('ehr.medical_history.deleted', {
      recordId: id,
    });
    await this.invalidateUserEHRCache(typedRecord.userId);
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
          fileUrl?: string;
          fileKey?: string;
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
        if (data.fileUrl) {
          createData.fileUrl = data.fileUrl;
        }
        if (data.fileKey) {
          createData.fileKey = data.fileKey;
        }
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          labReport: { create: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.labReport.create({
          data: createData as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
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

    const typedReport = report as LabReportBase;
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Lab report created',
      'EHRService',
      { reportId: typedReport.id, userId: data.userId }
    );

    await this.eventService.emit('ehr.lab_report.created', {
      reportId: typedReport.id,
    });
    await this.invalidateUserEHRCache(data.userId);

    // Queue heavy processing (analysis, image processing) asynchronously
    if (this.queueService) {
      void this.queueService
        .addJob(
          LAB_REPORT_QUEUE,
          'process_analysis',
          {
            reportId: typedReport.id,
            clinicId: 'clinicId' in data && typeof data.clinicId === 'string' ? data.clinicId : '',
            userId: data.userId,
            action: 'process_analysis',
            metadata: {
              testName: data.testName,
              result: data.result,
              unit: data.unit,
            },
          },
          {
            priority: 7, // HIGH priority (QueueService.PRIORITIES.HIGH)
            attempts: 3,
          }
        )
        .catch((error: unknown) => {
          void this.loggingService.log(
            LogType.QUEUE,
            LogLevel.WARN,
            'Failed to queue lab report processing',
            'EHRService',
            {
              reportId: typedReport.id,
              error: error instanceof Error ? error.message : String(error),
            }
          );
        });
    }

    return this.transformLabReport(typedReport);
  }

  async getLabReports(userId: string, clinicId?: string): Promise<LabReportResponse[]> {
    const cacheKey = `ehr:lab-reports:${userId}:${clinicId || 'all'}`;

    return this.cacheService.cache(
      cacheKey,
      async () => {
        // Use executeHealthcareRead for optimized query
        const records = await this.databaseService.executeHealthcareRead<LabReportBase[]>(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
              labReport: { findMany: (args: PrismaDelegateArgs) => Promise<LabReportBase[]> };
            };
            return await typedClient.labReport.findMany({
              where: { userId, ...(clinicId && { clinicId }) } as PrismaDelegateArgs,
              orderBy: { date: 'desc' } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          }
        );

        return records.map(record => this.transformLabReport(record));
      },
      {
        ttl: 1800, // 30 minutes
        tags: [`ehr:${userId}`, 'lab_reports'],
        priority: 'high',
        containsPHI: true,
        compress: true,
      }
    );
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
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          labReport: { update: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.labReport.update({
          where: { id } as PrismaDelegateArgs,
          data: updateData as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
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

    const typedReport = report as LabReportBase;
    await this.eventService.emit('ehr.lab_report.updated', { reportId: id });
    await this.invalidateUserEHRCache(typedReport.userId);

    return this.transformLabReport(typedReport);
  }

  async deleteLabReport(id: string): Promise<void> {
    // Use executeHealthcareRead first to get record for cache invalidation
    const report = await this.databaseService.executeHealthcareRead<{
      userId: string;
      clinicId?: string | null;
    } | null>(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        labReport: {
          findUnique: (
            args: PrismaDelegateArgs
          ) => Promise<{ userId: string; clinicId?: string | null } | null>;
        };
      };
      return await typedClient.labReport.findUnique({
        where: { id } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
    if (!report) throw new NotFoundException(`Lab report with ID ${id} not found`);

    const typedReport = report as { userId: string; clinicId?: string | null };
    // Use executeHealthcareWrite for delete with audit logging
    await this.databaseService.executeHealthcareWrite<unknown>(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          labReport: { delete: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.labReport.delete({
          where: { id } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: typedReport.userId,
        clinicId: typedReport.clinicId || '',
        resourceType: 'LAB_REPORT',
        operation: 'DELETE',
        resourceId: id,
        userRole: 'system',
        details: { userId: typedReport.userId },
      }
    );
    await this.eventService.emit('ehr.lab_report.deleted', { reportId: id });
    await this.invalidateUserEHRCache(typedReport.userId);
  }

  // ============ Radiology Reports ============

  async createRadiologyReport(data: CreateRadiologyReportDto): Promise<RadiologyReportResponse> {
    // Use executeHealthcareWrite for create with audit logging
    const report = await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          radiologyReport: { create: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.radiologyReport.create({
          data: {
            userId: data.userId,
            imageType: data.imageType,
            findings: data.findings,
            conclusion: data.conclusion,
            date: new Date(data.date),
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
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

    const typedReport = report as RadiologyReportBase;
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Radiology report created',
      'EHRService',
      { reportId: typedReport.id, userId: data.userId }
    );

    await this.eventService.emit('ehr.radiology_report.created', {
      reportId: typedReport.id,
    });
    await this.invalidateUserEHRCache(data.userId);

    // Queue imaging processing (transcoding, analysis) asynchronously
    if (this.queueService) {
      void this.queueService
        .addJob(
          IMAGING_QUEUE,
          'process_imaging',
          {
            reportId: typedReport.id,
            clinicId: 'clinicId' in data && typeof data.clinicId === 'string' ? data.clinicId : '',
            userId: data.userId,
            action: 'process_imaging',
            metadata: {
              imageType: data.imageType,
              findings: data.findings,
            },
          },
          {
            priority: 7, // HIGH priority (QueueService.PRIORITIES.HIGH)
            attempts: 3,
          }
        )
        .catch((error: unknown) => {
          void this.loggingService.log(
            LogType.QUEUE,
            LogLevel.WARN,
            'Failed to queue imaging processing',
            'EHRService',
            {
              reportId: typedReport.id,
              error: error instanceof Error ? error.message : String(error),
            }
          );
        });
    }

    return this.transformRadiologyReport(typedReport);
  }

  async getRadiologyReports(userId: string, clinicId?: string): Promise<RadiologyReportResponse[]> {
    // Use executeHealthcareRead for optimized query
    const records = await this.databaseService.executeHealthcareRead<RadiologyReportBase[]>(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          radiologyReport: {
            findMany: (args: PrismaDelegateArgs) => Promise<RadiologyReportBase[]>;
          };
        };
        return await typedClient.radiologyReport.findMany({
          where: { userId, ...(clinicId && { clinicId }) } as PrismaDelegateArgs,
          orderBy: { date: 'desc' } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      }
    );

    return records.map(record => this.transformRadiologyReport(record));
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
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          radiologyReport: { update: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.radiologyReport.update({
          where: { id } as PrismaDelegateArgs,
          data: updateData as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
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

    const typedReport = report as RadiologyReportBase;
    await this.eventService.emit('ehr.radiology_report.updated', {
      reportId: id,
    });
    await this.invalidateUserEHRCache(typedReport.userId);

    return this.transformRadiologyReport(typedReport);
  }

  async deleteRadiologyReport(id: string): Promise<void> {
    // Use executeHealthcareRead first to get record for cache invalidation
    const report = await this.databaseService.executeHealthcareRead<{
      userId: string;
      clinicId?: string | null;
    } | null>(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        radiologyReport: {
          findUnique: (
            args: PrismaDelegateArgs
          ) => Promise<{ userId: string; clinicId?: string | null } | null>;
        };
      };
      return await typedClient.radiologyReport.findUnique({
        where: { id } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
    if (!report) throw new NotFoundException(`Radiology report with ID ${id} not found`);

    const typedReport = report as { userId: string; clinicId?: string | null };
    // Use executeHealthcareWrite for delete with audit logging
    await this.databaseService.executeHealthcareWrite<unknown>(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          radiologyReport: { delete: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.radiologyReport.delete({
          where: { id } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: typedReport.userId,
        clinicId: typedReport.clinicId || '',
        resourceType: 'RADIOLOGY_REPORT',
        operation: 'DELETE',
        resourceId: id,
        userRole: 'system',
        details: { userId: typedReport.userId },
      }
    );
    await this.eventService.emit('ehr.radiology_report.deleted', {
      reportId: id,
    });
    await this.invalidateUserEHRCache(typedReport.userId);
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
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          surgicalRecord: { create: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.surgicalRecord.create({
          data: createData as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
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

    const typedRecord = record as SurgicalRecordBase;
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Surgical record created',
      'EHRService',
      { recordId: typedRecord.id, userId: data.userId }
    );

    await this.eventService.emit('ehr.surgical_record.created', {
      recordId: typedRecord.id,
    });
    await this.invalidateUserEHRCache(data.userId);

    return this.transformSurgicalRecord(typedRecord);
  }

  async getSurgicalRecords(userId: string, clinicId?: string): Promise<SurgicalRecordResponse[]> {
    // Use executeHealthcareRead for optimized query
    const records = await this.databaseService.executeHealthcareRead<SurgicalRecordBase[]>(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          surgicalRecord: { findMany: (args: PrismaDelegateArgs) => Promise<SurgicalRecordBase[]> };
        };
        return await typedClient.surgicalRecord.findMany({
          where: { userId, ...(clinicId && { clinicId }) } as PrismaDelegateArgs,
          orderBy: { date: 'desc' } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      }
    );

    return records.map(record => this.transformSurgicalRecord(record));
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
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          surgicalRecord: { update: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.surgicalRecord.update({
          where: { id } as PrismaDelegateArgs,
          data: updateData as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
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

    const typedRecord = record as SurgicalRecordBase;
    await this.eventService.emit('ehr.surgical_record.updated', {
      recordId: id,
    });
    await this.invalidateUserEHRCache(typedRecord.userId);

    return this.transformSurgicalRecord(typedRecord);
  }

  async deleteSurgicalRecord(id: string): Promise<void> {
    // Use executeHealthcareRead first to get record for cache invalidation
    const record = await this.databaseService.executeHealthcareRead<{
      userId: string;
      clinicId?: string | null;
    } | null>(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        surgicalRecord: {
          findUnique: (
            args: PrismaDelegateArgs
          ) => Promise<{ userId: string; clinicId?: string | null } | null>;
        };
      };
      return await typedClient.surgicalRecord.findUnique({
        where: { id } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
    if (!record) throw new NotFoundException(`Surgical record with ID ${id} not found`);

    const typedRecord = record as { userId: string; clinicId?: string | null };
    // Use executeHealthcareWrite for delete with audit logging
    await this.databaseService.executeHealthcareWrite<unknown>(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          surgicalRecord: { delete: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.surgicalRecord.delete({
          where: { id } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: typedRecord.userId,
        clinicId: typedRecord.clinicId || '',
        resourceType: 'SURGICAL_RECORD',
        operation: 'DELETE',
        resourceId: id,
        userRole: 'system',
        details: { userId: typedRecord.userId },
      }
    );
    await this.eventService.emit('ehr.surgical_record.deleted', {
      recordId: id,
    });
    await this.invalidateUserEHRCache(typedRecord.userId);
  }

  // ============ Vitals ============

  async createVital(data: CreateVitalDto): Promise<VitalResponse> {
    // Use executeHealthcareWrite for create with audit logging
    const vital = await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          vital: { create: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.vital.create({
          data: {
            userId: data.userId,
            type: data.type,
            value: data.value,
            recordedAt: new Date(data.recordedAt),
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
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

    const typedVital = vital as VitalBase;
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Vital record created',
      'EHRService',
      { vitalId: typedVital.id, userId: data.userId, type: data.type }
    );

    await this.eventService.emit('ehr.vital.created', { vitalId: typedVital.id });
    await this.invalidateUserEHRCache(data.userId);

    return this.transformVital(typedVital);
  }

  async getVitals(userId: string, type?: string, clinicId?: string) {
    // Use executeHealthcareRead for optimized query
    return await this.databaseService.executeHealthcareRead<unknown[]>(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        vital: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
      };
      return await typedClient.vital.findMany({
        where: {
          userId,
          ...(type && { type }),
          ...(clinicId && { clinicId }),
        } as PrismaDelegateArgs,
        orderBy: { recordedAt: 'desc' } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
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
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          vital: { update: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.vital.update({
          where: { id } as PrismaDelegateArgs,
          data: updateData as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
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

    const typedVital = vital as VitalBase;
    await this.eventService.emit('ehr.vital.updated', { vitalId: id });
    await this.invalidateUserEHRCache(typedVital.userId);

    return this.transformVital(typedVital);
  }

  async deleteVital(id: string): Promise<void> {
    // Use executeHealthcareRead first to get record for cache invalidation
    const vital = await this.databaseService.executeHealthcareRead<{
      userId: string;
      clinicId?: string | null;
    } | null>(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        vital: {
          findUnique: (
            args: PrismaDelegateArgs
          ) => Promise<{ userId: string; clinicId?: string | null } | null>;
        };
      };
      return await typedClient.vital.findUnique({
        where: { id } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
    if (!vital) throw new NotFoundException(`Vital record with ID ${id} not found`);

    const typedVital = vital as { userId: string; clinicId?: string | null };
    // Use executeHealthcareWrite for delete with audit logging
    await this.databaseService.executeHealthcareWrite<unknown>(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          vital: { delete: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.vital.delete({
          where: { id } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: typedVital.userId,
        clinicId: typedVital.clinicId || '',
        resourceType: 'VITAL',
        operation: 'DELETE',
        resourceId: id,
        userRole: 'system',
        details: { userId: typedVital.userId },
      }
    );
    await this.eventService.emit('ehr.vital.deleted', { vitalId: id });
    await this.invalidateUserEHRCache(typedVital.userId);
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
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          allergy: { create: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.allergy.create({
          data: createData as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
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

    const typedAllergy = allergy as AllergyBase;
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Allergy record created',
      'EHRService',
      { allergyId: typedAllergy.id, userId: data.userId }
    );

    await this.eventService.emit('ehr.allergy.created', {
      allergyId: typedAllergy.id,
    });
    await this.invalidateUserEHRCache(data.userId);

    return this.transformAllergy(typedAllergy);
  }

  async getAllergies(userId: string, clinicId?: string) {
    // Use executeHealthcareRead for optimized query
    return await this.databaseService.executeHealthcareRead<unknown[]>(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        allergy: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
      };
      return await typedClient.allergy.findMany({
        where: { userId, ...(clinicId && { clinicId }) } as PrismaDelegateArgs,
        orderBy: { diagnosedDate: 'desc' } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
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
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          allergy: { update: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.allergy.update({
          where: { id } as PrismaDelegateArgs,
          data: updateData as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
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

    const typedAllergy = allergy as AllergyBase;
    await this.eventService.emit('ehr.allergy.updated', { allergyId: id });
    await this.invalidateUserEHRCache(typedAllergy.userId);

    return this.transformAllergy(typedAllergy);
  }

  async deleteAllergy(id: string): Promise<void> {
    // Use executeHealthcareRead first to get record for cache invalidation
    const allergy = await this.databaseService.executeHealthcareRead<{
      userId: string;
      clinicId?: string | null;
    } | null>(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        allergy: {
          findUnique: (
            args: PrismaDelegateArgs
          ) => Promise<{ userId: string; clinicId?: string | null } | null>;
        };
      };
      return await typedClient.allergy.findUnique({
        where: { id } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
    if (!allergy) throw new NotFoundException(`Allergy record with ID ${id} not found`);

    const typedAllergy = allergy as { userId: string; clinicId?: string | null };
    // Use executeHealthcareWrite for delete with audit logging
    await this.databaseService.executeHealthcareWrite<unknown>(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          allergy: { delete: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.allergy.delete({
          where: { id } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: typedAllergy.userId,
        clinicId: typedAllergy.clinicId || '',
        resourceType: 'ALLERGY',
        operation: 'DELETE',
        resourceId: id,
        userRole: 'system',
        details: { userId: typedAllergy.userId },
      }
    );
    await this.eventService.emit('ehr.allergy.deleted', { allergyId: id });
    await this.invalidateUserEHRCache(typedAllergy.userId);
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
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          medication: { create: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.medication.create({
          data: createData as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
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

    const typedMedication = medication as MedicationBase;
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Medication record created',
      'EHRService',
      { medicationId: typedMedication.id, userId: data.userId }
    );

    await this.eventService.emit('ehr.medication.created', {
      medicationId: typedMedication.id,
    });
    await this.invalidateUserEHRCache(data.userId);

    return this.transformMedication(typedMedication);
  }

  async getMedications(userId: string, activeOnly: boolean = false, clinicId?: string) {
    // Use executeHealthcareRead for optimized query
    return await this.databaseService.executeHealthcareRead<unknown[]>(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        medication: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
      };
      return await typedClient.medication.findMany({
        where: {
          userId,
          ...(activeOnly && { isActive: true }),
          ...(clinicId && { clinicId }),
        } as PrismaDelegateArgs,
        orderBy: { startDate: 'desc' } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
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
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          medication: { update: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.medication.update({
          where: { id } as PrismaDelegateArgs,
          data: updateData as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
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

    const typedMedication = medication as MedicationBase;
    await this.eventService.emit('ehr.medication.updated', {
      medicationId: id,
    });
    await this.invalidateUserEHRCache(typedMedication.userId);

    return this.transformMedication(typedMedication);
  }

  async deleteMedication(id: string): Promise<void> {
    // Use executeHealthcareRead first to get record for cache invalidation
    const medication = await this.databaseService.executeHealthcareRead<{
      userId: string;
      clinicId?: string | null;
    } | null>(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        medication: {
          findUnique: (
            args: PrismaDelegateArgs
          ) => Promise<{ userId: string; clinicId?: string | null } | null>;
        };
      };
      return await typedClient.medication.findUnique({
        where: { id } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
    if (!medication) throw new NotFoundException(`Medication record with ID ${id} not found`);

    const typedMedication = medication as { userId: string; clinicId?: string | null };
    // Use executeHealthcareWrite for delete with audit logging
    await this.databaseService.executeHealthcareWrite<unknown>(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          medication: { delete: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.medication.delete({
          where: { id } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: typedMedication.userId,
        clinicId: typedMedication.clinicId || '',
        resourceType: 'MEDICATION',
        operation: 'DELETE',
        resourceId: id,
        userRole: 'system',
        details: { userId: typedMedication.userId },
      }
    );
    await this.eventService.emit('ehr.medication.deleted', {
      medicationId: id,
    });
    await this.invalidateUserEHRCache(typedMedication.userId);
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
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          immunization: { create: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.immunization.create({
          data: createData as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
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

    const typedImmunization = immunization as ImmunizationBase;
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Immunization record created',
      'EHRService',
      { immunizationId: typedImmunization.id, userId: data.userId }
    );

    await this.eventService.emit('ehr.immunization.created', {
      immunizationId: typedImmunization.id,
    });
    await this.invalidateUserEHRCache(data.userId);

    return this.transformImmunization(typedImmunization);
  }

  async getImmunizations(userId: string, clinicId?: string): Promise<ImmunizationResponse[]> {
    // Use executeHealthcareRead for optimized query
    const records = (await this.databaseService.executeHealthcareRead<ImmunizationBase[]>(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          immunization: { findMany: (args: PrismaDelegateArgs) => Promise<ImmunizationBase[]> };
        };
        return await typedClient.immunization.findMany({
          where: { userId, ...(clinicId && { clinicId }) } as PrismaDelegateArgs,
          orderBy: { dateAdministered: 'desc' } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      }
    )) as unknown as ImmunizationBase[];

    return records.map(record => this.transformImmunization(record));
  }

  async updateImmunization(id: string, data: UpdateImmunizationDto): Promise<ImmunizationResponse> {
    // Use executeHealthcareWrite for update with audit logging
    const immunization = await this.databaseService.executeHealthcareWrite(
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
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          immunization: { update: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.immunization.update({
          where: { id } as PrismaDelegateArgs,
          data: updateData as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
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
    const typedImmunization = immunization as { userId: string };
    await this.invalidateUserEHRCache(typedImmunization.userId);

    return this.transformImmunization(immunization as ImmunizationBase);
  }

  async deleteImmunization(id: string): Promise<void> {
    // Use executeHealthcareRead first to get record for cache invalidation
    const immunization = await this.databaseService.executeHealthcareRead<{
      userId: string;
      clinicId?: string | null;
    } | null>(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        immunization: {
          findUnique: (
            args: PrismaDelegateArgs
          ) => Promise<{ userId: string; clinicId?: string | null } | null>;
        };
      };
      return await typedClient.immunization.findUnique({
        where: { id } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
    if (!immunization) throw new NotFoundException(`Immunization record with ID ${id} not found`);

    const typedImmunization = immunization as { userId: string; clinicId?: string | null };
    // Use executeHealthcareWrite for delete with audit logging
    await this.databaseService.executeHealthcareWrite<unknown>(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          immunization: { delete: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.immunization.delete({
          where: { id } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: typedImmunization.userId,
        clinicId: typedImmunization.clinicId || '',
        resourceType: 'IMMUNIZATION',
        operation: 'DELETE',
        resourceId: id,
        userRole: 'system',
        details: { userId: typedImmunization.userId },
      }
    );
    await this.eventService.emit('ehr.immunization.deleted', {
      immunizationId: id,
    });
    await this.invalidateUserEHRCache(typedImmunization.userId);
  }

  // ============ Analytics ============

  async getHealthTrends(
    userId: string,
    vitalType: string,
    startDate?: Date,
    endDate?: Date,
    clinicId?: string
  ): Promise<{ vitalType: string; data: VitalBase[]; count: number }> {
    const where: {
      userId: string;
      type: string;
      clinicId?: string;
      recordedAt?: {
        gte?: Date;
        lte?: Date;
      };
    } = {
      userId,
      type: vitalType,
    };

    if (clinicId) where.clinicId = clinicId;

    if (startDate || endDate) {
      where.recordedAt = {};
      if (startDate) where.recordedAt.gte = startDate;
      if (endDate) where.recordedAt.lte = endDate;
    }

    // Use executeHealthcareRead for optimized query
    const vitals = await this.databaseService.executeHealthcareRead<VitalBase[]>(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        vital: { findMany: (args: PrismaDelegateArgs) => Promise<VitalBase[]> };
      };
      return await typedClient.vital.findMany({
        where: where as PrismaDelegateArgs,
        orderBy: { recordedAt: 'asc' } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });

    return {
      vitalType,
      data: vitals,
      count: vitals.length,
    };
  }

  async getMedicationAdherence(
    userId: string,
    clinicId?: string
  ): Promise<{ totalActive: number; medications: MedicationBase[] }> {
    // Use executeHealthcareRead for optimized query
    const medications = await this.databaseService.executeHealthcareRead<MedicationBase[]>(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          medication: { findMany: (args: PrismaDelegateArgs) => Promise<MedicationBase[]> };
        };
        return await typedClient.medication.findMany({
          where: {
            userId,
            isActive: true,
            ...(clinicId && { clinicId }),
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
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
      [key: string]:
        | string
        | number
        | boolean
        | Date
        | object
        | null
        | undefined
        | {
            contains?: string;
            mode?: 'insensitive' | 'default';
            gte?: Date;
            lte?: Date;
            in?: Array<string | number>;
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
        // Use executeHealthcareRead for optimized query
        const medicalHistoryRecords = await this.databaseService.executeHealthcareRead<
          Array<{
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
          }>
        >(async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            medicalHistory: {
              findMany: (args: PrismaDelegateArgs) => Promise<
                Array<{
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
                }>
              >;
            };
          };
          return await typedClient.medicalHistory.findMany({
            where: where as PrismaDelegateArgs,
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
            } as PrismaDelegateArgs,
            orderBy: { date: 'desc' } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        });
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
        await this.databaseService.executeHealthcareRead<unknown[]>(async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            labReport: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
          };
          return await typedClient.labReport.findMany({
            where: where as PrismaDelegateArgs,
            include: { user: { select: USER_SELECT_FIELDS } } as PrismaDelegateArgs,
            orderBy: { date: 'desc' } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        });
        // Lab reports don't fit into our current structure, skip for now
        break;
      }

      case 'vital': {
        let where: BaseWhereClause = { clinicId };
        where = addDateRangeFilter(where, filters?.dateFrom, filters?.dateTo);
        // Use executeHealthcareRead for optimized query
        await this.databaseService.executeHealthcareRead<unknown[]>(async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            vital: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
          };
          return await typedClient.vital.findMany({
            where: where as PrismaDelegateArgs,
            include: { user: { select: USER_SELECT_FIELDS } } as PrismaDelegateArgs,
            orderBy: { recordedAt: 'desc' } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        });
        // Vitals don't fit into our current structure, skip for now
        break;
      }

      case 'allergy': {
        let where: AllergyWhere = { clinicId };
        where = addStringFilter(where, 'allergen', filters.hasAllergy);
        where = addDateRangeFilter(where, filters?.dateFrom, filters?.dateTo);
        // Use executeHealthcareRead for optimized query
        const allergyRecords = await this.databaseService.executeHealthcareRead<
          Array<{
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
          }>
        >(async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            allergy: {
              findMany: (args: PrismaDelegateArgs) => Promise<
                Array<{
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
                }>
              >;
            };
          };
          return await typedClient.allergy.findMany({
            where: where as PrismaDelegateArgs,
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
            } as PrismaDelegateArgs,
            orderBy: { diagnosedDate: 'desc' } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
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
        const medicationRecords = await this.databaseService.executeHealthcareRead<
          Array<{
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
          }>
        >(async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            medication: {
              findMany: (args: PrismaDelegateArgs) => Promise<
                Array<{
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
                }>
              >;
            };
          };
          return await typedClient.medication.findMany({
            where: where as PrismaDelegateArgs,
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
            } as PrismaDelegateArgs,
            orderBy: { startDate: 'desc' } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
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
        const [medicalHistoryRecords, allergyRecords, medicationRecords] = (await Promise.all([
          this.databaseService.executeHealthcareRead<
            Array<{
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
            }>
          >(async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
              medicalHistory: {
                findMany: (args: PrismaDelegateArgs) => Promise<
                  Array<{
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
                  }>
                >;
              };
            };
            return await typedClient.medicalHistory.findMany({
              where: { clinicId } as PrismaDelegateArgs,
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
              } as PrismaDelegateArgs,
              orderBy: { date: 'desc' } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          }),
          this.databaseService.executeHealthcareRead<
            Array<{
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
            }>
          >(async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
              allergy: {
                findMany: (args: PrismaDelegateArgs) => Promise<
                  Array<{
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
                  }>
                >;
              };
            };
            return await typedClient.allergy.findMany({
              where: { clinicId } as PrismaDelegateArgs,
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
              } as PrismaDelegateArgs,
              orderBy: { diagnosedDate: 'desc' } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          }),
          this.databaseService.executeHealthcareRead<
            Array<{
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
            }>
          >(async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
              medication: {
                findMany: (args: PrismaDelegateArgs) => Promise<
                  Array<{
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
                  }>
                >;
              };
            };
            return await typedClient.medication.findMany({
              where: { clinicId } as PrismaDelegateArgs,
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
              } as PrismaDelegateArgs,
              orderBy: { startDate: 'desc' } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          }),
        ])) as [
          Array<{
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
          }>,
          Array<{
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
          }>,
          Array<{
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
          }>,
        ];

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
        ] = (await Promise.all([
          // Use executeHealthcareRead for optimized queries
          this.databaseService.executeHealthcareRead<Array<{ userId: string }>>(async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
              medicalHistory: {
                findMany: (args: PrismaDelegateArgs) => Promise<Array<{ userId: string }>>;
              };
            };
            return await typedClient.medicalHistory.findMany({
              where: { clinicId } as PrismaDelegateArgs,
              select: { userId: true } as PrismaDelegateArgs,
              distinct: ['userId'] as unknown as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          }),
          this.databaseService.executeHealthcareRead<number>(async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
              medicalHistory: { count: (args: PrismaDelegateArgs) => Promise<number> };
            };
            return await typedClient.medicalHistory.count({
              where: { clinicId } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          }),
          this.databaseService.executeHealthcareRead<number>(async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
              labReport: { count: (args: PrismaDelegateArgs) => Promise<number> };
            };
            return await typedClient.labReport.count({
              where: { clinicId } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          }),
          this.databaseService.executeHealthcareRead<number>(async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
              vital: { count: (args: PrismaDelegateArgs) => Promise<number> };
            };
            return await typedClient.vital.count({
              where: { clinicId } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          }),
          this.databaseService.executeHealthcareRead<number>(async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
              allergy: { count: (args: PrismaDelegateArgs) => Promise<number> };
            };
            return await typedClient.allergy.count({
              where: { clinicId } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          }),
          this.databaseService.executeHealthcareRead<number>(async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
              medication: { count: (args: PrismaDelegateArgs) => Promise<number> };
            };
            return await typedClient.medication.count({
              where: { clinicId, isActive: true } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          }),
          Promise.all([
            this.databaseService.executeHealthcareRead<number>(async client => {
              const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
                medicalHistory: { count: (args: PrismaDelegateArgs) => Promise<number> };
              };
              return await typedClient.medicalHistory.count({
                where: {
                  clinicId,
                  createdAt: {
                    gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                  },
                } as PrismaDelegateArgs,
              } as PrismaDelegateArgs);
            }),
            this.databaseService.executeHealthcareRead<number>(async client => {
              const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
                labReport: { count: (args: PrismaDelegateArgs) => Promise<number> };
              };
              return await typedClient.labReport.count({
                where: {
                  clinicId,
                  createdAt: {
                    gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                  },
                } as PrismaDelegateArgs,
              } as PrismaDelegateArgs);
            }),
          ]),
          this.databaseService.executeHealthcareRead<
            Array<{ condition: string | null; _count: { condition: number } }>
          >(async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
              medicalHistory: {
                groupBy: (
                  args: PrismaDelegateArgs
                ) => Promise<Array<{ condition: string | null; _count: { condition: number } }>>;
              };
            };
            return await typedClient.medicalHistory.groupBy({
              by: ['condition'] as unknown as PrismaDelegateArgs,
              where: { clinicId } as PrismaDelegateArgs,
              _count: { condition: true } as PrismaDelegateArgs,
              orderBy: { _count: { condition: 'desc' } } as PrismaDelegateArgs,
              take: 10,
            } as PrismaDelegateArgs);
          }),
          this.databaseService.executeHealthcareRead<
            Array<{ allergen: string | null; _count: { allergen: number } }>
          >(async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
              allergy: {
                groupBy: (
                  args: PrismaDelegateArgs
                ) => Promise<Array<{ allergen: string | null; _count: { allergen: number } }>>;
              };
            };
            return await typedClient.allergy.groupBy({
              by: ['allergen'] as unknown as PrismaDelegateArgs,
              where: { clinicId } as PrismaDelegateArgs,
              _count: { allergen: true } as PrismaDelegateArgs,
              orderBy: { _count: { allergen: 'desc' } } as PrismaDelegateArgs,
              take: 10,
            } as PrismaDelegateArgs);
          }),
        ])) as [
          Array<{ userId: string }>,
          number,
          number,
          number,
          number,
          number,
          [number, number],
          Array<{ condition: string | null; _count: { condition: number } }>,
          Array<{ allergen: string | null; _count: { allergen: number } }>,
        ];

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
            commonConditions: commonConditions.map(
              (c: { condition: string | null; _count: { condition: number } }) => ({
                condition: c.condition || '',
                count: c._count?.condition || 0,
              })
            ),
            commonAllergies: commonAllergies.map(
              (a: { allergen: string | null; _count: { allergen: number } }) => ({
                allergen: a.allergen || '',
                count: a._count?.allergen || 0,
              })
            ),
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
        const patientsWithRecords = await this.databaseService.executeHealthcareRead<
          Array<{
            id: string;
            firstName: string | null;
            lastName: string | null;
            email: string | null;
            phone: string | null;
            dateOfBirth: Date | null;
            gender: string | null;
            medicalHistories: Array<{ date: Date }>;
            allergies: Array<{ allergen: string; severity: string }>;
            medications: Array<{ name: string; dosage: string }>;
          }>
        >(async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          const result = await typedClient.user.findMany({
            where: {
              OR: [
                { medicalHistories: { some: { clinicId } } } as PrismaDelegateArgs,
                { labReports: { some: { clinicId } } } as PrismaDelegateArgs,
                { vitals: { some: { clinicId } } } as PrismaDelegateArgs,
                { allergies: { some: { clinicId } } } as PrismaDelegateArgs,
                { medications: { some: { clinicId } } } as PrismaDelegateArgs,
              ],
            } as PrismaDelegateArgs,
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              dateOfBirth: true,
              gender: true,
              medicalHistories: {
                where: { clinicId } as PrismaDelegateArgs,
                orderBy: { date: 'desc' } as PrismaDelegateArgs,
                take: 1,
              } as PrismaDelegateArgs,
              allergies: {
                where: { clinicId } as PrismaDelegateArgs,
                select: { allergen: true, severity: true } as PrismaDelegateArgs,
              } as PrismaDelegateArgs,
              medications: {
                where: { clinicId, isActive: true } as PrismaDelegateArgs,
                select: { name: true, dosage: true } as PrismaDelegateArgs,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
          return result as unknown as Array<{
            id: string;
            firstName: string | null;
            lastName: string | null;
            email: string | null;
            phone: string | null;
            dateOfBirth: Date | null;
            gender: string | null;
            medicalHistories: Array<{ date: Date }>;
            allergies: Array<{ allergen: string; severity: string }>;
            medications: Array<{ name: string; dosage: string }>;
          }>;
        });

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
      results.conditions = await this.databaseService.executeHealthcareRead<
        Array<{
          id: string;
          user: { id: string; firstName: string; lastName: string } | null;
          condition: string;
          date: Date;
          notes?: string;
        }>
      >(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          medicalHistory: {
            findMany: (args: PrismaDelegateArgs) => Promise<
              Array<{
                id: string;
                user: { id: string; firstName: string; lastName: string } | null;
                condition: string;
                date: Date;
                notes?: string;
              }>
            >;
          };
        };
        return await typedClient.medicalHistory.findMany({
          where: {
            clinicId,
            OR: [
              { condition: { contains: searchTerm, mode: 'insensitive' } } as PrismaDelegateArgs,
              { notes: { contains: searchTerm, mode: 'insensitive' } } as PrismaDelegateArgs,
            ],
          } as PrismaDelegateArgs,
          include: {
            user: { select: { id: true, firstName: true, lastName: true } } as PrismaDelegateArgs,
          } as PrismaDelegateArgs,
          take: 20,
        } as PrismaDelegateArgs);
      });
    }

    if (types.includes('allergies')) {
      // Use executeHealthcareRead for optimized query
      results.allergies = await this.databaseService.executeHealthcareRead<
        Array<{
          id: string;
          user: { id: string; firstName: string; lastName: string } | null;
          allergen: string;
          severity: string;
          reaction: string;
          diagnosedDate: Date;
        }>
      >(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          allergy: {
            findMany: (args: PrismaDelegateArgs) => Promise<
              Array<{
                id: string;
                user: { id: string; firstName: string; lastName: string } | null;
                allergen: string;
                severity: string;
                reaction: string;
                diagnosedDate: Date;
              }>
            >;
          };
        };
        return await typedClient.allergy.findMany({
          where: {
            clinicId,
            allergen: { contains: searchTerm, mode: 'insensitive' },
          } as PrismaDelegateArgs,
          include: {
            user: { select: { id: true, firstName: true, lastName: true } } as PrismaDelegateArgs,
          } as PrismaDelegateArgs,
          take: 20,
        } as PrismaDelegateArgs);
      });
    }

    if (types.includes('medications')) {
      // Use executeHealthcareRead for optimized query
      results.medications = await this.databaseService.executeHealthcareRead<
        Array<{
          id: string;
          user: { id: string; firstName: string; lastName: string } | null;
          name: string;
          dosage: string;
          frequency: string;
          startDate: Date;
          isActive: boolean;
        }>
      >(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          medication: {
            findMany: (args: PrismaDelegateArgs) => Promise<
              Array<{
                id: string;
                user: { id: string; firstName: string; lastName: string } | null;
                name: string;
                dosage: string;
                frequency: string;
                startDate: Date;
                isActive: boolean;
              }>
            >;
          };
        };
        return await typedClient.medication.findMany({
          where: {
            clinicId,
            name: { contains: searchTerm, mode: 'insensitive' },
          } as PrismaDelegateArgs,
          include: {
            user: { select: { id: true, firstName: true, lastName: true } } as PrismaDelegateArgs,
          } as PrismaDelegateArgs,
          take: 20,
        } as PrismaDelegateArgs);
      });
    }

    if (types.includes('procedures')) {
      // Use executeHealthcareRead for optimized query
      results.procedures = await this.databaseService.executeHealthcareRead<
        Array<{
          id: string;
          user: { id: string; firstName: string; lastName: string } | null;
          surgeryName: string;
          surgeon: string;
          date: Date;
          notes?: string;
        }>
      >(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          surgicalRecord: {
            findMany: (args: PrismaDelegateArgs) => Promise<
              Array<{
                id: string;
                user: { id: string; firstName: string; lastName: string } | null;
                surgeryName: string;
                surgeon: string;
                date: Date;
                notes?: string;
              }>
            >;
          };
        };
        return await typedClient.surgicalRecord.findMany({
          where: {
            clinicId,
            surgeryName: { contains: searchTerm, mode: 'insensitive' },
          } as PrismaDelegateArgs,
          include: {
            user: { select: { id: true, firstName: true, lastName: true } } as PrismaDelegateArgs,
          } as PrismaDelegateArgs,
          take: 20,
        } as PrismaDelegateArgs);
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
        // Use executeHealthcareRead for optimized queries
        const [severeAllergies, criticalVitals] = await Promise.all([
          this.databaseService.executeHealthcareRead<AllergyBase[]>(async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
              allergy: { findMany: (args: PrismaDelegateArgs) => Promise<AllergyBase[]> };
            };
            return await typedClient.allergy.findMany({
              where: {
                clinicId,
                severity: 'Severe',
              } as PrismaDelegateArgs,
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                  } as PrismaDelegateArgs,
                } as PrismaDelegateArgs,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          }),
          this.databaseService.executeHealthcareRead<VitalBase[]>(async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
              vital: { findMany: (args: PrismaDelegateArgs) => Promise<VitalBase[]> };
            };
            return await typedClient.vital.findMany({
              where: {
                clinicId,
                type: { in: ['blood_pressure', 'heart_rate', 'temperature'] } as PrismaDelegateArgs,
                recordedAt: {
                  gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
                } as PrismaDelegateArgs,
              } as PrismaDelegateArgs,
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                  } as PrismaDelegateArgs,
                } as PrismaDelegateArgs,
              } as PrismaDelegateArgs,
              orderBy: { recordedAt: 'desc' } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          }),
        ]);

        // Define types for records with user relation
        type VitalRecordWithUser = VitalBase & {
          user?: {
            id: string;
            firstName: string | null;
            lastName: string | null;
            phone: string | null;
          } | null;
        };

        type AllergyRecordWithUser = AllergyBase & {
          user?: {
            id: string;
            firstName: string | null;
            lastName: string | null;
            phone: string | null;
          } | null;
        };

        const criticalVitalAlerts = (criticalVitals as unknown as VitalRecordWithUser[]).filter(
          vital => {
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
          }
        );

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

  private transformMedicalHistory(record: MedicalHistoryBase): MedicalHistoryResponse {
    const typedRecord = record as unknown as {
      id: string;
      userId: string;
      clinicId?: string | null;
      condition: string;
      diagnosis?: string | null;
      treatment?: string | null;
      date: Date;
      doctorId?: string | null;
      notes?: string | null;
      createdAt: Date;
      updatedAt: Date;
    };
    return {
      id: typedRecord.id,
      userId: typedRecord.userId,
      clinicId:
        typedRecord.clinicId && typeof typedRecord.clinicId === 'string'
          ? typedRecord.clinicId
          : '',
      condition: typedRecord.condition,
      diagnosis:
        typedRecord.diagnosis && typeof typedRecord.diagnosis === 'string'
          ? typedRecord.diagnosis
          : '',
      treatment:
        typedRecord.treatment && typeof typedRecord.treatment === 'string'
          ? typedRecord.treatment
          : '',
      date: typedRecord.date.toISOString(),
      doctorId:
        typedRecord.doctorId && typeof typedRecord.doctorId === 'string'
          ? typedRecord.doctorId
          : '',
      notes: typedRecord.notes && typeof typedRecord.notes === 'string' ? typedRecord.notes : '',
      createdAt: typedRecord.createdAt.toISOString(),
      updatedAt: typedRecord.updatedAt.toISOString(),
    };
  }

  private transformLabReport(record: LabReportBase): LabReportResponse {
    const typedRecord = record as unknown as {
      id: string;
      userId: string;
      clinicId?: string | null;
      testName: string;
      result: string;
      unit?: string | null;
      normalRange?: string | null;
      date: Date;
      doctorId?: string | null;
      labName?: string | null;
      notes?: string | null;
      fileUrl?: string | null;
      fileKey?: string | null;
      createdAt: Date;
      updatedAt: Date;
    };
    return {
      id: typedRecord.id,
      userId: typedRecord.userId,
      clinicId:
        typedRecord.clinicId && typeof typedRecord.clinicId === 'string'
          ? typedRecord.clinicId
          : '',
      testName: typedRecord.testName,
      result: typedRecord.result,
      unit: typedRecord.unit && typeof typedRecord.unit === 'string' ? typedRecord.unit : '',
      normalRange:
        typedRecord.normalRange && typeof typedRecord.normalRange === 'string'
          ? typedRecord.normalRange
          : '',
      date: typedRecord.date.toISOString(),
      doctorId:
        typedRecord.doctorId && typeof typedRecord.doctorId === 'string'
          ? typedRecord.doctorId
          : '',
      labName:
        typedRecord.labName && typeof typedRecord.labName === 'string' ? typedRecord.labName : '',
      notes: typedRecord.notes && typeof typedRecord.notes === 'string' ? typedRecord.notes : '',
      fileUrl:
        typedRecord.fileUrl && typeof typedRecord.fileUrl === 'string' ? typedRecord.fileUrl : '',
      fileKey:
        typedRecord.fileKey && typeof typedRecord.fileKey === 'string' ? typedRecord.fileKey : '',
      createdAt: typedRecord.createdAt.toISOString(),
      updatedAt: typedRecord.updatedAt.toISOString(),
    };
  }

  private transformRadiologyReport(record: RadiologyReportBase): RadiologyReportResponse {
    const typedRecord = record as unknown as {
      id: string;
      userId: string;
      clinicId?: string | null;
      imageType: string;
      findings: string;
      conclusion: string;
      date: Date;
      doctorId?: string | null;
      notes?: string | null;
      createdAt: Date;
      updatedAt: Date;
    };
    return {
      id: typedRecord.id,
      userId: typedRecord.userId,
      clinicId:
        typedRecord.clinicId && typeof typedRecord.clinicId === 'string'
          ? typedRecord.clinicId
          : '',
      imageType: typedRecord.imageType,
      findings: typedRecord.findings,
      conclusion: typedRecord.conclusion,
      date: typedRecord.date.toISOString(),
      doctorId:
        typedRecord.doctorId && typeof typedRecord.doctorId === 'string'
          ? typedRecord.doctorId
          : '',
      notes: typedRecord.notes && typeof typedRecord.notes === 'string' ? typedRecord.notes : '',
      createdAt: typedRecord.createdAt.toISOString(),
      updatedAt: typedRecord.updatedAt.toISOString(),
    };
  }

  private transformSurgicalRecord(record: SurgicalRecordBase): SurgicalRecordResponse {
    const typedRecord = record as unknown as {
      id: string;
      userId: string;
      clinicId?: string | null;
      surgeryName: string;
      surgeon: string;
      date: Date;
      doctorId?: string | null;
      notes?: string | null;
      createdAt: Date;
      updatedAt: Date;
    };
    return {
      id: typedRecord.id,
      userId: typedRecord.userId,
      clinicId:
        typedRecord.clinicId && typeof typedRecord.clinicId === 'string'
          ? typedRecord.clinicId
          : '',
      surgeryName: typedRecord.surgeryName,
      surgeon: typedRecord.surgeon,
      date: typedRecord.date.toISOString(),
      doctorId:
        typedRecord.doctorId && typeof typedRecord.doctorId === 'string'
          ? typedRecord.doctorId
          : '',
      notes: typedRecord.notes && typeof typedRecord.notes === 'string' ? typedRecord.notes : '',
      createdAt: typedRecord.createdAt.toISOString(),
      updatedAt: typedRecord.updatedAt.toISOString(),
    };
  }

  private transformVital(record: VitalBase): VitalResponse {
    const typedRecord = record as unknown as {
      id: string;
      userId: string;
      clinicId?: string | null;
      type: string;
      value: string | number;
      unit?: string | null;
      recordedAt: Date;
      doctorId?: string | null;
      notes?: string | null;
      createdAt: Date;
      updatedAt: Date;
    };
    return {
      id: typedRecord.id,
      userId: typedRecord.userId,
      clinicId:
        typedRecord.clinicId && typeof typedRecord.clinicId === 'string'
          ? typedRecord.clinicId
          : '',
      type: typedRecord.type,
      value: Number(typedRecord.value),
      unit: typedRecord.unit && typeof typedRecord.unit === 'string' ? typedRecord.unit : '',
      recordedAt: typedRecord.recordedAt.toISOString(),
      doctorId:
        typedRecord.doctorId && typeof typedRecord.doctorId === 'string'
          ? typedRecord.doctorId
          : '',
      notes: typedRecord.notes && typeof typedRecord.notes === 'string' ? typedRecord.notes : '',
      createdAt: typedRecord.createdAt.toISOString(),
      updatedAt: typedRecord.updatedAt.toISOString(),
    };
  }

  private transformAllergy(record: AllergyBase): AllergyResponse {
    const typedRecord = record as unknown as {
      id: string;
      userId: string;
      clinicId?: string | null;
      allergen: string;
      severity: string;
      reaction: string;
      diagnosedDate: Date;
      doctorId?: string | null;
      notes?: string | null;
      createdAt: Date;
      updatedAt: Date;
    };
    return {
      id: typedRecord.id,
      userId: typedRecord.userId,
      clinicId:
        typedRecord.clinicId && typeof typedRecord.clinicId === 'string'
          ? typedRecord.clinicId
          : '',
      allergen: typedRecord.allergen,
      severity: typedRecord.severity,
      reaction: typedRecord.reaction,
      diagnosedDate: typedRecord.diagnosedDate.toISOString(),
      doctorId:
        typedRecord.doctorId && typeof typedRecord.doctorId === 'string'
          ? typedRecord.doctorId
          : '',
      notes: typedRecord.notes && typeof typedRecord.notes === 'string' ? typedRecord.notes : '',
      createdAt: typedRecord.createdAt.toISOString(),
      updatedAt: typedRecord.updatedAt.toISOString(),
    };
  }

  private transformMedication(record: MedicationBase): MedicationResponse {
    const typedRecord = record as unknown as {
      id: string;
      userId: string;
      clinicId?: string | null;
      name: string;
      dosage: string;
      frequency: string;
      startDate: Date;
      endDate?: Date | null;
      doctorId?: string | null;
      prescribedBy?: string | null;
      purpose?: string | null;
      sideEffects?: string | null;
      isActive?: boolean | null;
      notes?: string | null;
      createdAt: Date;
      updatedAt: Date;
    };
    return {
      id: typedRecord.id,
      userId: typedRecord.userId,
      clinicId:
        typedRecord.clinicId && typeof typedRecord.clinicId === 'string'
          ? typedRecord.clinicId
          : '',
      name: typedRecord.name,
      dosage: typedRecord.dosage,
      frequency: typedRecord.frequency,
      startDate: typedRecord.startDate.toISOString(),
      ...(typedRecord.endDate && { endDate: typedRecord.endDate.toISOString() }),
      doctorId:
        typedRecord.doctorId && typeof typedRecord.doctorId === 'string'
          ? typedRecord.doctorId
          : '',
      prescribedBy:
        typedRecord.prescribedBy && typeof typedRecord.prescribedBy === 'string'
          ? typedRecord.prescribedBy
          : '',
      purpose:
        typedRecord.purpose && typeof typedRecord.purpose === 'string' ? typedRecord.purpose : '',
      sideEffects:
        typedRecord.sideEffects && typeof typedRecord.sideEffects === 'string'
          ? typedRecord.sideEffects
          : '',
      isActive:
        typedRecord.isActive && typeof typedRecord.isActive === 'boolean'
          ? typedRecord.isActive
          : false,
      notes: typedRecord.notes && typeof typedRecord.notes === 'string' ? typedRecord.notes : '',
      createdAt: typedRecord.createdAt.toISOString(),
      updatedAt: typedRecord.updatedAt.toISOString(),
    };
  }

  private transformImmunization(record: ImmunizationBase): ImmunizationResponse {
    const typedRecord = record as unknown as {
      id: string;
      userId: string;
      clinicId?: string | null;
      vaccineName: string;
      dateAdministered: Date;
      nextDueDate?: Date | null;
      doctorId?: string | null;
      batchNumber?: string | null;
      administrator?: string | null;
      location?: string | null;
      notes?: string | null;
      createdAt: Date;
      updatedAt: Date;
    };
    return {
      id: typedRecord.id,
      userId: typedRecord.userId,
      clinicId:
        typedRecord.clinicId && typeof typedRecord.clinicId === 'string'
          ? typedRecord.clinicId
          : '',
      vaccineName: typedRecord.vaccineName,
      dateAdministered: typedRecord.dateAdministered.toISOString(),
      doctorId:
        typedRecord.doctorId && typeof typedRecord.doctorId === 'string'
          ? typedRecord.doctorId
          : '',
      ...(typedRecord.nextDueDate && {
        nextDueDate: typedRecord.nextDueDate.toISOString(),
      }),
      batchNumber:
        typedRecord.batchNumber && typeof typedRecord.batchNumber === 'string'
          ? typedRecord.batchNumber
          : '',
      administrator:
        typedRecord.administrator && typeof typedRecord.administrator === 'string'
          ? typedRecord.administrator
          : '',
      location:
        typedRecord.location && typeof typedRecord.location === 'string'
          ? typedRecord.location
          : '',
      notes: typedRecord.notes && typeof typedRecord.notes === 'string' ? typedRecord.notes : '',
      createdAt: typedRecord.createdAt.toISOString(),
      updatedAt: typedRecord.updatedAt.toISOString(),
    };
  }

  private transformFamilyHistory(record: FamilyHistoryBase): FamilyHistoryResponse {
    const typedRecord = record as unknown as {
      id: string;
      userId: string;
      clinicId?: string | null;
      relation?: string | null;
      condition: string;
      diagnosedAge?: number | null;
      doctorId?: string | null;
      notes?: string | null;
      createdAt: Date;
      updatedAt: Date;
    };
    const result: FamilyHistoryResponse = {
      id: typedRecord.id,
      userId: typedRecord.userId,
      clinicId:
        typedRecord.clinicId && typeof typedRecord.clinicId === 'string'
          ? typedRecord.clinicId
          : '',
      relation:
        typedRecord.relation && typeof typedRecord.relation === 'string'
          ? typedRecord.relation
          : '',
      condition: typedRecord.condition,
      doctorId:
        typedRecord.doctorId && typeof typedRecord.doctorId === 'string'
          ? typedRecord.doctorId
          : '',
      notes: typedRecord.notes && typeof typedRecord.notes === 'string' ? typedRecord.notes : '',
      createdAt: typedRecord.createdAt.toISOString(),
      updatedAt: typedRecord.updatedAt.toISOString(),
    };
    if (typedRecord.diagnosedAge && typeof typedRecord.diagnosedAge === 'number') {
      result.diagnosedAge = typedRecord.diagnosedAge;
    }
    return result;
  }

  private transformLifestyleAssessment(
    record: LifestyleAssessmentBase
  ): LifestyleAssessmentResponse {
    const typedRecord = record as unknown as {
      id: string;
      userId: string;
      clinicId?: string | null;
      doctorId?: string | null;
      diet?: string | null;
      exercise?: string | null;
      smoking?: string | null;
      alcohol?: string | null;
      sleep?: string | null;
      stress?: string | null;
      notes?: string | null;
      createdAt: Date;
      updatedAt: Date;
    };
    const result: LifestyleAssessmentResponse = {
      id: typedRecord.id,
      userId: typedRecord.userId,
      clinicId:
        typedRecord.clinicId && typeof typedRecord.clinicId === 'string'
          ? typedRecord.clinicId
          : '',
      doctorId:
        typedRecord.doctorId && typeof typedRecord.doctorId === 'string'
          ? typedRecord.doctorId
          : '',
      notes: typedRecord.notes && typeof typedRecord.notes === 'string' ? typedRecord.notes : '',
      createdAt: typedRecord.createdAt.toISOString(),
      updatedAt: typedRecord.updatedAt.toISOString(),
    };
    if (typedRecord.diet && typeof typedRecord.diet === 'string') {
      result.diet = typedRecord.diet;
    }
    if (typedRecord.exercise && typeof typedRecord.exercise === 'string') {
      result.exercise = typedRecord.exercise;
    }
    if (typedRecord.smoking && typeof typedRecord.smoking === 'string') {
      result.smoking = typedRecord.smoking;
    }
    if (typedRecord.alcohol && typeof typedRecord.alcohol === 'string') {
      result.alcohol = typedRecord.alcohol;
    }
    if (typedRecord.sleep && typeof typedRecord.sleep === 'string') {
      result.sleep = typedRecord.sleep;
    }
    if (typedRecord.stress && typeof typedRecord.stress === 'string') {
      result.stress = typedRecord.stress;
    }
    return result;
  }
}
