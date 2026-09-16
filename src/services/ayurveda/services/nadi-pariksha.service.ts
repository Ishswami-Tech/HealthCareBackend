/**
 * Ayurveda Nadi Pariksha Service
 * @module Nadi Pariksha
 * @description Handles Nadi Pariksha (pulse diagnosis) operations
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  NadiParikshaResponseDto,
  CreateNadiParikshaDto,
  DoshaType,
} from '@services/ayurveda/dto';
import { DoshaType as DoshaTypeEnum } from '@services/ayurveda/dto';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { EventService } from '@infrastructure/events';
import { HealthcareError, ErrorCode } from '@core/errors';

/**
 * Cache key prefix for Nadi Pariksha records
 */
const NADI_CACHE_PREFIX = 'ayurveda:nadi';

/**
 * Service for managing Nadi Pariksha (pulse diagnosis) records.
 *
 * Nadi Pariksha is a traditional Ayurvedic diagnostic technique where the
 * practitioner assesses the patient's pulse at the radial artery to determine
 * dosha dominance, overall health status, and disease progression.
 *
 * @public
 */
@Injectable()
export class NadiParikshaService {
  /**
   * Creates an instance of NadiParikshaService.
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
   * Creates a new Nadi Pariksha record.
   *
   * @param dto - Nadi Pariksha assessment data
   * @param userId - ID of the practitioner performing the assessment
   * @param clinicId - Clinic context
   * @returns Created Nadi Pariksha record
   * @throws {HealthcareError} If database operation fails
   */
  async createNadiPariksha(
    dto: CreateNadiParikshaDto,
    userId: string,
    clinicId: string
  ): Promise<NadiParikshaResponseDto> {
    this.logger.info('Creating Nadi Pariksha record', {
      module: 'NadiPariksha',
      patientId: dto.patientId,
      dominantDosha: dto.dominantDosha,
      clinicId,
    });

    const record = await this.db.prisma.nadiPariksha.create({
      data: {
        patientId: dto.patientId,
        clinicId,
        dominantDosha: dto.dominantDosha,
        pulseQuality: dto.pulseQuality,
        regularity: dto.regularity,
        strength: dto.strength,
        abnormalities: dto.abnormalities,
        interpretation: dto.interpretation,
        observations: dto.observations,
        side: dto.side,
        performedBy: userId,
        assessedAt: new Date(),
      },
    });

    await this.invalidatePatientCache(dto.patientId, clinicId);
    await this.events.emit('ayurveda.nadi.assessed', {
      nadiId: record.id,
      patientId: dto.patientId,
      dominantDosha: dto.dominantDosha,
      clinicId,
    });

    this.logger.info('Nadi Pariksha record created', {
      module: 'NadiPariksha',
      nadiId: record.id,
    });

    return this.mapToResponseDto(record);
  }

  /**
   * Retrieves Nadi Pariksha history for a patient.
   *
   * @param patientId - Patient ID
   * @param clinicId - Clinic context
   * @param limit - Maximum results (default 20)
   * @param offset - Results to skip (default 0)
   * @returns Array of Nadi Pariksha records sorted by date descending
   */
  async getNadiHistory(
    patientId: string,
    clinicId: string,
    limit = 20,
    offset = 0
  ): Promise<NadiParikshaResponseDto[]> {
    const cacheKey = `${NADI_CACHE_PREFIX}:history:${clinicId}:${patientId}:${limit}:${offset}`;

    const cached = await this.cache.get<NadiParikshaResponseDto[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const records = await this.db.prisma.nadiPariksha.findMany({
      where: { patientId, clinicId },
      orderBy: { assessedAt: 'desc' },
      take: limit,
      skip: offset,
    });

    const result = records.map((r: (typeof records)[number]) => this.mapToResponseDto(r));
    await this.cache.set(cacheKey, result, 300);

    return result;
  }

  /**
   * Retrieves a single Nadi Pariksha record by ID.
   *
   * @param id - Record ID
   * @param clinicId - Clinic context for security
   * @returns Nadi Pariksha record details
   * @throws {NotFoundException} If record not found
   */
  async getNadiById(id: string, clinicId: string): Promise<NadiParikshaResponseDto> {
    const cacheKey = `${NADI_CACHE_PREFIX}:${id}`;

    const cached = await this.cache.get<NadiParikshaResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const record = await this.db.prisma.nadiPariksha.findFirst({
      where: { id, clinicId },
    });

    if (!record) {
      throw new HealthcareError('Nadi Pariksha record not found', ErrorCode.RESOURCE_NOT_FOUND, {
        nadiId: id,
      });
    }

    const result = this.mapToResponseDto(record);
    await this.cache.set(cacheKey, result, 600);

    return result;
  }

  /**
   * Invalidates cache entries for a patient's Nadi Pariksha records.
   *
   * @param patientId - Patient ID
   * @param clinicId - Clinic ID
   */
  private async invalidatePatientCache(patientId: string, clinicId: string): Promise<void> {
    const pattern = `${NADI_CACHE_PREFIX}:history:${clinicId}:${patientId}:*`;
    await this.cache.invalidatePattern(pattern);
  }

  /**
   * Maps Prisma model to response DTO.
   *
   * @param record - Prisma NadiPariksha model
   * @returns Formatted response DTO
   */
  private mapToResponseDto(record: any): NadiParikshaResponseDto {
    return {
      id: record.id as string,
      patientId: record.patientId as string,
      clinicId: record.clinicId as string,
      dominantDosha: record.dominantDosha as DoshaType,
      pulseQuality: record.pulseQuality as string,
      regularity: record.regularity as string | undefined,
      strength: record.strength as string | undefined,
      abnormalities: record.abnormalities as string | undefined,
      interpretation: record.interpretation as string,
      observations: record.observations as string | undefined,
      side: record.side as string | undefined,
      performedBy: record.performedBy as string,
      assessedAt: (record.assessedAt as Date).toISOString(),
    };
  }
}
