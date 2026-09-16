/**
 * Ayurveda Prakriti Assessment Service
 * @module Prakriti Assessment
 * @description Handles Prakriti (constitution) assessment questionnaire and scoring
 */

import { Injectable } from '@nestjs/common';
import type {
  PrakritiAssessmentResponseDto,
  CreatePrakritiAssessmentDto,
  UpdatePrakritiAssessmentDto,
  DoshaType,
} from '@services/ayurveda/dto';
import { DoshaType as DoshaTypeEnum } from '@services/ayurveda/dto';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { EventService } from '@infrastructure/events';
import { HealthcareError, ErrorCode } from '@core/errors';
import { HealthcareErrorsService } from '@core/errors/healthcare-errors.service';

/**
 * Threshold constants for Prakriti scoring.
 * Each score range maps to a dosha dominance level.
 */
const DOSHA_SCORE_THRESHOLDS = {
  VATA_HIGH: 21,
  PITTA_HIGH: 21,
  KAPHA_HIGH: 21,
  MIN_QUESTIONS: 10,
  MAX_QUESTIONS: 50,
} as const;

/**
 * Cache key prefix for Prakriti assessments
 */
const PRAKRITI_CACHE_PREFIX = 'ayurveda:prakriti';

/**
 * Service for managing Ayurvedic Prakriti (constitution) assessments.
 *
 * Prakriti is the fundamental Ayurvedic concept of individual constitution,
 * determined by the relative dominance of the three doshas: Vata, Pitta, Kapha.
 *
 * @public
 */
@Injectable()
export class PrakritiAssessmentService {
  /**
   * Creates an instance of PrakritiAssessmentService.
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
   * Submits a new Prakriti assessment questionnaire and computes the dominant dosha.
   *
   * Scoring methodology:
   * - Each questionnaire answer is scored 0-3
   * - Scores are summed per dosha category
   * - Highest score determines dominant dosha
   * - Second highest determines secondary dosha (if significantly different)
   *
   * @param dto - Assessment submission data
   * @param userId - ID of the user submitting the assessment
   * @param clinicId - Clinic context
   * @returns Computed Prakriti assessment result
   * @throws {BadRequestException} If questionnaire answers are invalid
   * @throws {HealthcareError} If database operation fails
   */
  async createAssessment(
    dto: CreatePrakritiAssessmentDto,
    userId: string,
    clinicId: string
  ): Promise<PrakritiAssessmentResponseDto> {
    this.logger.info('Creating Prakriti assessment', {
      module: 'PrakritiAssessment',
      patientId: dto.patientId,
      clinicId,
    });

    this.validateQuestionnaireAnswers(dto.questionnaireAnswers);

    const scores = this.computeDoshaScores(dto.questionnaireAnswers);
    const { primaryDosha, secondaryDosha } = this.determineDominantDosha(scores);

    const assessment = await this.db.prisma.prakritiAssessment.create({
      data: {
        patientId: dto.patientId,
        clinicId,
        primaryDosha: primaryDosha,
        secondaryDosha: secondaryDosha ?? undefined,
        vataScore: scores.vata,
        pittaScore: scores.pitta,
        kaphaScore: scores.kapha,
        questionnaireAnswers: dto.questionnaireAnswers,
        patientNotes: dto.patientNotes,
        isConfirmed: false,
        assessedAt: new Date(),
        createdBy: userId,
      },
    });

    await this.invalidatePatientCache(dto.patientId, clinicId);
    await this.events.emit('ayurveda.prakriti.assessed', {
      assessmentId: assessment.id,
      patientId: dto.patientId,
      primaryDosha: primaryDosha,
      clinicId,
    });

    this.logger.info('Prakriti assessment created', {
      module: 'PrakritiAssessment',
      assessmentId: assessment.id,
      primaryDosha,
    });

    return this.mapToResponseDto(assessment);
  }

  /**
   * Retrieves paginated assessment history for a patient.
   *
   * @param patientId - Patient to fetch history for
   * @param clinicId - Clinic context
   * @param limit - Maximum number of results
   * @param offset - Number of results to skip
   * @returns Array of Prakriti assessments sorted by date descending
   */
  async getAssessmentHistory(
    patientId: string,
    clinicId: string,
    limit = 20,
    offset = 0
  ): Promise<PrakritiAssessmentResponseDto[]> {
    const cacheKey = `${PRAKRITI_CACHE_PREFIX}:history:${clinicId}:${patientId}:${limit}:${offset}`;

    const cached = await this.cache.get<PrakritiAssessmentResponseDto[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const assessments = await this.db.prisma.prakritiAssessment.findMany({
      where: { patientId, clinicId },
      orderBy: { assessedAt: 'desc' },
      take: limit,
      skip: offset,
    });

    const result = assessments.map((a: (typeof assessments)[number]) => this.mapToResponseDto(a));
    await this.cache.set(cacheKey, result, 300);

    return result;
  }

  /**
   * Retrieves a single assessment by ID.
   *
   * @param id - Assessment ID
   * @param clinicId - Clinic context for security
   * @returns Prakriti assessment details
   * @throws {NotFoundException} If assessment not found
   */
  async getAssessmentById(id: string, clinicId: string): Promise<PrakritiAssessmentResponseDto> {
    const cacheKey = `${PRAKRITI_CACHE_PREFIX}:${id}`;

    const cached = await this.cache.get<PrakritiAssessmentResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const assessment = await this.db.prisma.prakritiAssessment.findFirst({
      where: { id, clinicId },
    });

    if (!assessment) {
      throw new HealthcareError('Prakriti assessment not found', ErrorCode.RESOURCE_NOT_FOUND, {
        assessmentId: id,
      });
    }

    const result = this.mapToResponseDto(assessment);
    await this.cache.set(cacheKey, result, 600);

    return result;
  }

  /**
   * Updates practitioner notes on an existing assessment.
   *
   * @param id - Assessment ID
   * @param dto - Update data
   * @param clinicId - Clinic context
   * @returns Updated assessment
   * @throws {NotFoundException} If assessment not found
   */
  async updateAssessment(
    id: string,
    dto: UpdatePrakritiAssessmentDto,
    clinicId: string
  ): Promise<PrakritiAssessmentResponseDto> {
    const existing = await this.db.prisma.prakritiAssessment.findFirst({
      where: { id, clinicId },
      select: { patientId: true },
    });

    if (!existing) {
      throw new HealthcareError('Prakriti assessment not found', ErrorCode.RESOURCE_NOT_FOUND, {
        assessmentId: id,
      });
    }

    const updateData: any = {};
    if (dto.practitionerNotes !== undefined) updateData.practitionerNotes = dto.practitionerNotes;
    if (dto.isConfirmed !== undefined) updateData.isConfirmed = dto.isConfirmed;
    if (dto.recommendations !== undefined) updateData.recommendations = dto.recommendations;

    const updated = await this.db.prisma.prakritiAssessment.update({
      where: { id },
      data: updateData,
    });

    await this.invalidateCaches(id, existing.patientId, clinicId);

    this.logger.info('Prakriti assessment updated', {
      module: 'PrakritiAssessment',
      assessmentId: id,
    });

    return this.mapToResponseDto(updated);
  }

  /**
   * Validates questionnaire answers for correctness and completeness.
   *
   * @param answers - Questionnaire answer map
   * @throws {BadRequestException} If answers are invalid
   */
  private validateQuestionnaireAnswers(answers: Record<string, number>): void {
    const keys = Object.keys(answers);

    if (keys.length < DOSHA_SCORE_THRESHOLDS.MIN_QUESTIONS) {
      throw this.errorsService.ayurvedaInvalidAssessment(
        `Questionnaire requires at least ${DOSHA_SCORE_THRESHOLDS.MIN_QUESTIONS} answers`,
        'PrakritiAssessmentService.validateQuestionnaireAnswers'
      );
    }

    if (keys.length > DOSHA_SCORE_THRESHOLDS.MAX_QUESTIONS) {
      throw this.errorsService.ayurvedaInvalidAssessment(
        `Questionnaire accepts maximum ${DOSHA_SCORE_THRESHOLDS.MAX_QUESTIONS} answers`,
        'PrakritiAssessmentService.validateQuestionnaireAnswers'
      );
    }

    for (const [key, value] of Object.entries(answers)) {
      if (!Number.isInteger(value) || value < 0 || value > 3) {
        throw this.errorsService.ayurvedaInvalidAssessment(
          `Question "${key}" has invalid score "${value}". Scores must be integers 0-3.`,
          'PrakritiAssessmentService.validateQuestionnaireAnswers'
        );
      }
    }
  }

  /**
   * Computes dosha scores from questionnaire answers.
   * Each question key is categorized into Vata/Pitta/Kapha buckets.
   *
   * @param answers - Questionnaire answer map
   * @returns Computed scores per dosha
   */
  private computeDoshaScores(answers: Record<string, number>): {
    vata: number;
    pitta: number;
    kapha: number;
  } {
    const scores = { vata: 0, pitta: 0, kapha: 0 };

    for (const [key, value] of Object.entries(answers)) {
      if (key.toLowerCase().includes('vata') || key.toLowerCase().startsWith('v')) {
        scores.vata += value;
      } else if (key.toLowerCase().includes('pitta') || key.toLowerCase().startsWith('p')) {
        scores.pitta += value;
      } else if (key.toLowerCase().includes('kapha') || key.toLowerCase().startsWith('k')) {
        scores.kapha += value;
      }
    }

    return scores;
  }

  /**
   * Determines dominant and secondary doshas from computed scores.
   *
   * @param scores - Computed dosha scores
   * @returns Primary and secondary dosha types
   */
  private determineDominantDosha(scores: { vata: number; pitta: number; kapha: number }): {
    primaryDosha: DoshaType;
    secondaryDosha?: DoshaType;
  } {
    const entries = [
      { dosha: DoshaTypeEnum.VATA, score: scores.vata },
      { dosha: DoshaTypeEnum.PITTA, score: scores.pitta },
      { dosha: DoshaTypeEnum.KAPHA, score: scores.kapha },
    ].sort((a, b) => b.score - a.score);

    const primary = entries[0];
    const secondary = entries[1];
    if (!primary || !secondary) {
      return { primaryDosha: DoshaTypeEnum.VATA };
    }

    const isSignificantSecondary = secondary.score >= primary.score * 0.7;

    const result: { primaryDosha: DoshaType; secondaryDosha?: DoshaType } = {
      primaryDosha: primary.dosha,
    };

    if (isSignificantSecondary) {
      result.secondaryDosha = secondary.dosha;
    }

    return result;
  }

  /**
   * Maps Prisma model to response DTO.
   *
   * @param assessment - Prisma PrakritiAssessment model
   * @returns Formatted response DTO
   */
  private mapToResponseDto(assessment: any): PrakritiAssessmentResponseDto {
    return {
      id: assessment.id as string,
      patientId: assessment.patientId as string,
      clinicId: assessment.clinicId as string,
      primaryDosha: assessment.primaryDosha as DoshaType,
      secondaryDosha: assessment.secondaryDosha as DoshaType | undefined,
      vataScore: assessment.vataScore as number,
      pittaScore: assessment.pittaScore as number,
      kaphaScore: assessment.kaphaScore as number,
      questionnaireAnswers: assessment.questionnaireAnswers as Record<string, number>,
      patientNotes: assessment.patientNotes as string | undefined,
      practitionerNotes: assessment.practitionerNotes as string | undefined,
      isConfirmed: assessment.isConfirmed as boolean,
      recommendations: assessment.recommendations as string | undefined,
      assessedAt: (assessment.assessedAt as Date).toISOString(),
      createdBy: assessment.createdBy as string,
    };
  }

  /**
   * Invalidates cache entries for a patient's Prakriti assessments.
   *
   * @param patientId - Patient ID
   * @param clinicId - Clinic ID
   */
  private async invalidatePatientCache(patientId: string, clinicId: string): Promise<void> {
    const pattern = `${PRAKRITI_CACHE_PREFIX}:history:${clinicId}:${patientId}:*`;
    await this.cache.invalidatePattern(pattern);
  }

  /**
   * Invalidates specific and pattern-based caches.
   *
   * @param assessmentId - Assessment ID
   * @param patientId - Patient ID
   * @param clinicId - Clinic ID
   */
  private async invalidateCaches(
    assessmentId: string,
    patientId: string,
    clinicId: string
  ): Promise<void> {
    await this.cache.del(`${PRAKRITI_CACHE_PREFIX}:${assessmentId}`);
    await this.invalidatePatientCache(patientId, clinicId);
  }
}
