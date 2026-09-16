/**
 * Ayurveda Diagnosis Service
 * @module Ayurvedic Diagnosis
 * @description Creates and manages comprehensive Ayurvedic diagnoses
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  AyurvedicDiagnosisResponseDto,
  CreateAyurvedicDiagnosisDto,
  DoshaType,
} from '@services/ayurveda/dto';
import { DoshaType as DoshaTypeEnum } from '@services/ayurveda/dto';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { EventService } from '@infrastructure/events';
import { HealthcareError, ErrorCode } from '@core/errors';

/**
 * Cache key prefix for Ayurvedic diagnoses
 */
const DIAGNOSIS_CACHE_PREFIX = 'ayurveda:diagnosis';

type AyurvedicDiagnosisRecord = {
  id: string;
  patientId: string;
  clinicId: string;
  prakritiAssessmentId: string;
  nadiParikshaId: string;
  primaryDisease: string;
  secondaryDiseases?: string[] | null;
  diseaseClassification?: string | null;
  vyadhiType?: string | null;
  clinicalAssessment: string;
  agniStatus?: string | null;
  amaPresence?: string | null;
  srotasAffected?: string | null;
  notes?: string | null;
  confidenceLevel?: string | null;
  status: string;
  createdBy?: string | null;
  diagnosedAt: Date;
};

/**
 * Service for managing comprehensive Ayurvedic diagnoses.
 *
 * Links together:
 * - Prakriti assessment (constitution)
 * - Nadi Pariksha (pulse diagnosis)
 * - Samprapti stages (disease progression)
 * - Dosha imbalances
 *
 * Provides a holistic view of the patient's Ayurvedic health status.
 *
 * @public
 */
@Injectable()
export class AyurvedicDiagnosisService {
  /**
   * Creates an instance of AyurvedicDiagnosisService.
   * @param db - Database service for Prisma access
   * @param cache - Cache service for query result caching
   * @param logger - Structured logging service
   * @param events - Event service for domain event emission
   */
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly logger: LoggingService,
    private readonly events: EventService
  ) {}

  /**
   * Creates a new Ayurvedic diagnosis linking Prakriti, Nadi, and clinical findings.
   *
   * @param dto - Diagnosis creation data
   * @param userId - ID of the diagnosing practitioner
   * @param clinicId - Clinic context
   * @returns Created diagnosis record
   * @throws {NotFoundException} If linked Prakriti or Nadi record not found
   * @throws {HealthcareError} If database operation fails
   */
  async createDiagnosis(
    dto: CreateAyurvedicDiagnosisDto,
    userId: string,
    clinicId: string
  ): Promise<AyurvedicDiagnosisResponseDto> {
    this.logger.info('Creating Ayurvedic diagnosis', {
      module: 'AyurvedicDiagnosis',
      patientId: dto.patientId,
      primaryDisease: dto.primaryDisease,
      clinicId,
    });

    await this.validateLinkedRecords(dto, clinicId);

    const diagnosis = await this.db.prisma.ayurvedicDiagnosis.create({
      data: {
        patientId: dto.patientId,
        clinicId,
        prakritiAssessmentId: dto.prakritiAssessmentId,
        nadiParikshaId: dto.nadiParikshaId,
        primaryDisease: dto.primaryDisease,
        secondaryDiseases: dto.secondaryDiseases,
        diseaseClassification: dto.diseaseClassification,
        vyadhiType: dto.vyadhiType,
        clinicalAssessment: dto.clinicalAssessment,
        agniStatus: dto.agniStatus,
        amaPresence: dto.amaPresence,
        srotasAffected: dto.srotasAffected,
        notes: dto.notes,
        confidenceLevel: dto.confidenceLevel,
        status: 'ACTIVE',
        createdBy: userId,
        diagnosedAt: new Date(),
      },
    });

    await this.invalidatePatientCache(dto.patientId, clinicId);
    await this.events.emit('ayurveda.diagnosis.created', {
      diagnosisId: diagnosis.id,
      patientId: dto.patientId,
      primaryDisease: dto.primaryDisease,
      clinicId,
    });

    this.logger.info('Ayurvedic diagnosis created', {
      module: 'AyurvedicDiagnosis',
      diagnosisId: diagnosis.id,
    });

    return this.mapToResponseDto(diagnosis);
  }

  /**
   * Retrieves a diagnosis by ID.
   *
   * @param id - Diagnosis ID
   * @param clinicId - Clinic context for security
   * @returns Diagnosis details with related data
   * @throws {NotFoundException} If diagnosis not found
   */
  async getDiagnosisById(id: string, clinicId: string): Promise<AyurvedicDiagnosisResponseDto> {
    const cacheKey = `${DIAGNOSIS_CACHE_PREFIX}:${id}`;

    const cached = await this.cache.get<AyurvedicDiagnosisResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const diagnosis = await this.db.prisma.ayurvedicDiagnosis.findFirst({
      where: { id, clinicId },
    });

    if (!diagnosis) {
      throw new HealthcareError('Ayurvedic diagnosis not found', ErrorCode.RESOURCE_NOT_FOUND, {
        diagnosisId: id,
      });
    }

    const result = this.mapToResponseDto(diagnosis);
    await this.cache.set(cacheKey, result, 600);

    return result;
  }

  /**
   * Retrieves all diagnoses for a patient.
   *
   * @param patientId - Patient ID
   * @param clinicId - Clinic context
   * @param limit - Maximum results
   * @param offset - Results to skip
   * @returns Array of diagnoses sorted by date descending
   */
  async getPatientDiagnoses(
    patientId: string,
    clinicId: string,
    limit = 20,
    offset = 0
  ): Promise<AyurvedicDiagnosisResponseDto[]> {
    const cacheKey = `${DIAGNOSIS_CACHE_PREFIX}:patient:${clinicId}:${patientId}:${limit}:${offset}`;

    const cached = await this.cache.get<AyurvedicDiagnosisResponseDto[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const diagnoses = await this.db.prisma.ayurvedicDiagnosis.findMany({
      where: { patientId, clinicId },
      orderBy: { diagnosedAt: 'desc' },
      take: limit,
      skip: offset,
    });

    const result = diagnoses.map((d: AyurvedicDiagnosisRecord) => this.mapToResponseDto(d));
    await this.cache.set(cacheKey, result, 300);

    return result;
  }

  /**
   * Validates that linked Prakriti assessment and Nadi Pariksha exist.
   *
   * @param dto - Diagnosis creation data
   * @param clinicId - Clinic context
   * @throws {NotFoundException} If linked records not found
   */
  private async validateLinkedRecords(
    dto: CreateAyurvedicDiagnosisDto,
    clinicId: string
  ): Promise<void> {
    const [prakriti, nadi] = await Promise.all([
      this.db.prisma.prakritiAssessment.findFirst({
        where: { id: dto.prakritiAssessmentId, clinicId },
        select: { id: true },
      }),
      this.db.prisma.nadiPariksha.findFirst({
        where: { id: dto.nadiParikshaId, clinicId },
        select: { id: true },
      }),
    ]);

    if (!prakriti) {
      throw new HealthcareError(
        'Referenced Prakriti assessment not found',
        ErrorCode.RESOURCE_NOT_FOUND,
        { prakritiAssessmentId: dto.prakritiAssessmentId }
      );
    }

    if (!nadi) {
      throw new HealthcareError(
        'Referenced Nadi Pariksha record not found',
        ErrorCode.RESOURCE_NOT_FOUND,
        { nadiParikshaId: dto.nadiParikshaId }
      );
    }
  }

  /**
   * Invalidates cache entries for a patient's diagnoses.
   *
   * @param patientId - Patient ID
   * @param clinicId - Clinic ID
   */
  private async invalidatePatientCache(patientId: string, clinicId: string): Promise<void> {
    const pattern = `${DIAGNOSIS_CACHE_PREFIX}:patient:${clinicId}:${patientId}:*`;
    await this.cache.invalidatePattern(pattern);
  }

  /**
   * Maps Prisma model to response DTO.
   *
   * @param diagnosis - Prisma AyurvedicDiagnosis model
   * @returns Formatted response DTO
   */
  private mapToResponseDto(diagnosis: AyurvedicDiagnosisRecord): AyurvedicDiagnosisResponseDto {
    return {
      id: diagnosis.id,
      patientId: diagnosis.patientId,
      clinicId: diagnosis.clinicId,
      prakritiAssessmentId: diagnosis.prakritiAssessmentId,
      nadiParikshaId: diagnosis.nadiParikshaId,
      primaryDisease: diagnosis.primaryDisease,
      secondaryDiseases: diagnosis.secondaryDiseases ?? undefined,
      diseaseClassification: diagnosis.diseaseClassification ?? undefined,
      vyadhiType: diagnosis.vyadhiType ?? undefined,
      clinicalAssessment: diagnosis.clinicalAssessment,
      agniStatus: diagnosis.agniStatus ?? undefined,
      amaPresence: diagnosis.amaPresence ?? undefined,
      srotasAffected: diagnosis.srotasAffected ?? undefined,
      notes: diagnosis.notes ?? undefined,
      confidenceLevel: diagnosis.confidenceLevel ?? undefined,
      status: diagnosis.status,
      createdBy: diagnosis.createdBy ?? undefined,
      diagnosedAt: diagnosis.diagnosedAt.toISOString(),
    };
  }
}
