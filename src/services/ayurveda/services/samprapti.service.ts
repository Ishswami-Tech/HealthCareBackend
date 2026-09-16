/**
 * Ayurveda Samprapti (Disease Pathogenesis) Service
 * @module Samprapti
 * @description Handles disease progression tracking through Ayurvedic pathogenesis stages
 */

import { Injectable } from '@nestjs/common';
import type { CreateSampraptiStageDto, DoshaType } from '@services/ayurveda/dto';
import { DoshaType as DoshaTypeEnum } from '@services/ayurveda/dto';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { EventService } from '@infrastructure/events';
import { HealthcareError, ErrorCode } from '@core/errors';
import { HealthcareErrorsService } from '@core/errors/healthcare-errors.service';

/**
 * Standard Ayurvedic Samprapti (pathogenesis) stages.
 * The five stages of disease progression: Sanchaya, Prakopa, Prasara, Sthanasamsraya, Vyakti.
 */
const STANDARD_SAMPRAVTI_STAGES = [
  { order: 1, name: 'Sanchaya', description: 'Accumulation of dosha in its site' },
  { order: 2, name: 'Prakopa', description: 'Aggravation/irritation of accumulated dosha' },
  { order: 3, name: 'Prasara', description: 'Spread of aggravated dosha to other sites' },
  { order: 4, name: 'Sthanasamsraya', description: 'Localization in specific tissues' },
  { order: 5, name: 'Vyakti', description: 'Full manifestation of disease' },
] as const;

/**
 * Cache key prefix for Samprapti records
 */
const SAMPRAVTI_CACHE_PREFIX = 'ayurveda:samprapti';

/**
 * Service for managing Samprapti (disease pathogenesis) progression tracking.
 *
 * Samprapti describes the six stages of disease development in Ayurveda:
 * 1. Purvarupa (premonitory symptoms)
 * 2. Sanchaya (accumulation)
 * 3. Prakopa (aggravation)
 * 4. Prasara (spread)
 * 5. Sthanasamsraya (localization)
 * 6. Vyakti (manifestation)
 *
 * @public
 */
@Injectable()
export class SampraptiService {
  /**
   * Creates an instance of SampraptiService.
   * @param db - Database service for Prisma access
   * @param cache - Cache service for query result caching
   * @param logger - Structured logging service
   * @param events - Event service for domain event emission
   */
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly logger: LoggingService,
    private readonly events: EventService,
    private readonly errorsService: HealthcareErrorsService
  ) {}

  /**
   * Records a new stage in the disease pathogenesis progression.
   *
   * @param diagnosisId - Diagnosis ID to attach stage to
   * @param dto - Stage data
   * @param userId - ID of the practitioner recording the stage
   * @param clinicId - Clinic context
   * @returns Created Samprapti stage record
   * @throws {NotFoundException} If diagnosis not found
   * @throws {BadRequestException} If stage order conflicts with existing stages
   */
  async recordStage(
    diagnosisId: string,
    dto: CreateSampraptiStageDto,
    userId: string,
    clinicId: string
  ): Promise<Record<string, unknown>> {
    this.logger.info('Recording Samprapti stage', {
      module: 'Samprapti',
      diagnosisId,
      stageName: dto.stageName,
      stageOrder: dto.stageOrder,
      clinicId,
    });

    const diagnosis = await this.db.prisma.ayurvedicDiagnosis.findFirst({
      where: { id: diagnosisId, clinicId },
    });

    if (!diagnosis) {
      throw new HealthcareError('Ayurvedic diagnosis not found', ErrorCode.RESOURCE_NOT_FOUND, {
        diagnosisId,
      });
    }

    await this.validateStageOrder(diagnosisId, dto.stageOrder, dto.isActive);

    const stage = await this.db.prisma.sampraptiStage.create({
      data: {
        diagnosisId,
        stageName: dto.stageName,
        stageOrder: dto.stageOrder,
        doshaInvolved: dto.doshaInvolved,
        dhatuAffected: dto.dhatuAffected,
        description: dto.description,
        symptoms: dto.symptoms,
        clinicalFindings: dto.clinicalFindings,
        isActive: dto.isActive,
        completedAt: dto.isActive ? null : new Date(),
        recordedBy: userId,
      },
    });

    await this.invalidateDiagnosisCache(diagnosisId, clinicId);
    await this.events.emit('ayurveda.samprapti.stage_recorded', {
      stageId: stage.id,
      diagnosisId,
      stageOrder: dto.stageOrder,
      isActive: dto.isActive,
      clinicId,
    });

    this.logger.info('Samprapti stage recorded', {
      module: 'Samprapti',
      stageId: stage.id,
    });

    return stage;
  }

  /**
   * Retrieves all stages for a diagnosis.
   *
   * @param diagnosisId - Diagnosis ID
   * @param clinicId - Clinic context
   * @returns Array of Samprapti stages sorted by order
   */
  async getStagesForDiagnosis(
    diagnosisId: string,
    clinicId: string
  ): Promise<Record<string, unknown>[]> {
    const cacheKey = `${SAMPRAVTI_CACHE_PREFIX}:diagnosis:${diagnosisId}`;

    const cached = await this.cache.get<Record<string, unknown>[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const stages = await this.db.prisma.sampraptiStage.findMany({
      where: { diagnosisId },
      orderBy: { stageOrder: 'asc' },
    });

    await this.cache.set(cacheKey, stages, 600);
    return stages;
  }

  /**
   * Marks a stage as completed.
   *
   * @param stageId - Stage ID
   * @param clinicId - Clinic context
   * @returns Updated stage
   * @throws {NotFoundException} If stage not found
   */
  async completeStage(stageId: string, clinicId: string): Promise<Record<string, unknown>> {
    const stage = await this.db.prisma.sampraptiStage.findFirst({
      where: { id: stageId },
      include: {
        diagnosis: { select: { clinicId: true } },
      },
    });

    if (!stage || stage.diagnosis.clinicId !== clinicId) {
      throw new HealthcareError('Samprapti stage not found', ErrorCode.RESOURCE_NOT_FOUND, {
        stageId,
      });
    }

    const updated = await this.db.prisma.sampraptiStage.update({
      where: { id: stageId },
      data: {
        isActive: false,
        completedAt: new Date(),
      },
    });

    await this.cache.del(`${SAMPRAVTI_CACHE_PREFIX}:diagnosis:${stage.diagnosisId}`);

    this.logger.info('Samprapti stage completed', {
      module: 'Samprapti',
      stageId,
      diagnosisId: stage.diagnosisId,
    });

    return updated;
  }

  /**
   * Validates stage order consistency with existing stages.
   *
   * @param diagnosisId - Diagnosis ID
   * @param newOrder - Proposed stage order number
   * @param isActive - Whether stage is being set as active
   * @throws {BadRequestException} If stage order conflicts
   */
  private async validateStageOrder(
    diagnosisId: string,
    newOrder: number,
    isActive: boolean
  ): Promise<void> {
    const existingStages = await this.db.prisma.sampraptiStage.findMany({
      where: { diagnosisId },
      select: { stageOrder: true, isActive: true },
    });

    const hasHigherActiveStage = existingStages.some(
      (s: { stageOrder: number; isActive: boolean }) => s.stageOrder > newOrder && s.isActive
    );

    if (isActive && hasHigherActiveStage) {
      throw this.errorsService.ayurvedaInvalidSampraptiStage(
        newOrder,
        'SampraptiService.validateStageOrder'
      );
    }
  }

  /**
   * Invalidates cache for a diagnosis's Samprapti stages.
   *
   * @param diagnosisId - Diagnosis ID
   * @param clinicId - Clinic ID
   */
  private async invalidateDiagnosisCache(diagnosisId: string, clinicId: string): Promise<void> {
    await this.cache.del(`${SAMPRAVTI_CACHE_PREFIX}:diagnosis:${diagnosisId}`);
  }
}
