/**
 * Ayurveda Dosha Imbalance Service
 * @module Dosha Imbalance
 * @description Manages dosha imbalance tracking and intervention planning
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import type { CreateDoshaImbalanceDto, DoshaType } from '@services/ayurveda/dto';
import { DoshaType as DoshaTypeEnum } from '@services/ayurveda/dto';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { EventService } from '@infrastructure/events';
import { HealthcareError, ErrorCode } from '@core/errors';

/**
 * Cache key prefix for Dosha Imbalance records
 */
const DOSHA_IMBALANCE_CACHE_PREFIX = 'ayurveda:dosha-imbalance';

/**
 * Service for managing dosha imbalance tracking.
 *
 * Tracks which doshas are imbalanced in a patient, severity levels,
 * symptoms, root causes, and recommended Ayurvedic interventions.
 *
 * @public
 */
@Injectable()
export class DoshaImbalanceService {
  /**
   * Creates an instance of DoshaImbalanceService.
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
   * Records a new dosha imbalance assessment.
   *
   * @param dto - Imbalance assessment data
   * @param userId - ID of the practitioner recording the assessment
   * @param clinicId - Clinic context
   * @returns Created dosha imbalance record
   * @throws {HealthcareError} If database operation fails
   */
  async recordImbalance(
    dto: CreateDoshaImbalanceDto,
    userId: string,
    clinicId: string
  ): Promise<any> {
    this.logger.info('Recording dosha imbalance', {
      module: 'DoshaImbalance',
      patientId: dto.patientId,
      doshaType: dto.doshaType,
      imbalanceType: dto.imbalanceType,
      severity: dto.severity,
      clinicId,
    });

    const record = await this.db.prisma.doshaImbalance.create({
      data: {
        patientId: dto.patientId,
        clinicId,
        diagnosisId: dto.diagnosisId,
        doshaType: dto.doshaType,
        imbalanceType: dto.imbalanceType,
        severity: dto.severity,
        vitalsAffected: dto.vitalsAffected,
        symptoms: dto.symptoms,
        rootCauses: dto.rootCauses,
        practitionerNotes: dto.practitionerNotes,
        interventions: dto.interventions,
        assessedAt: dto.assessedAt ? new Date(dto.assessedAt) : new Date(),
        assessedBy: userId,
      },
    });

    await this.invalidatePatientCache(dto.patientId, clinicId);
    await this.events.emit('ayurveda.dosha.imbalance_recorded', {
      imbalanceId: record.id,
      patientId: dto.patientId,
      doshaType: dto.doshaType,
      severity: dto.severity,
      clinicId,
    });

    this.logger.info('Dosha imbalance recorded', {
      module: 'DoshaImbalance',
      imbalanceId: record.id,
    });

    return record;
  }

  /**
   * Retrieves the current dosha imbalance status for a patient.
   *
   * Returns the most recent imbalance record per dosha.
   *
   * @param patientId - Patient ID
   * @param clinicId - Clinic context
   * @returns Map of dosha type to latest imbalance record
   */
  async getCurrentImbalances(
    patientId: string,
    clinicId: string
  ): Promise<Record<DoshaTypeEnum, any | null>> {
    const cacheKey = `${DOSHA_IMBALANCE_CACHE_PREFIX}:current:${clinicId}:${patientId}`;

    const cached = await this.cache.get<Record<DoshaTypeEnum, any | null>>(cacheKey);
    if (cached) {
      return cached;
    }

    const result: Record<DoshaTypeEnum, any | null> = {
      [DoshaTypeEnum.VATA]: null,
      [DoshaTypeEnum.PITTA]: null,
      [DoshaTypeEnum.KAPHA]: null,
    };

    for (const doshaType of [DoshaTypeEnum.VATA, DoshaTypeEnum.PITTA, DoshaTypeEnum.KAPHA]) {
      const latest = await this.db.prisma.doshaImbalance.findFirst({
        where: { patientId, clinicId, doshaType },
        orderBy: { assessedAt: 'desc' },
      });
      result[doshaType] = latest ?? null;
    }

    await this.cache.set(cacheKey, result, 300);
    return result;
  }

  /**
   * Retrieves the full imbalance history for a patient.
   *
   * @param patientId - Patient ID
   * @param clinicId - Clinic context
   * @param doshaType - Optional filter by dosha type
   * @param limit - Maximum results
   * @param offset - Results to skip
   * @returns Array of imbalance records sorted by date descending
   */
  async getImbalanceHistory(
    patientId: string,
    clinicId: string,
    doshaType?: DoshaTypeEnum,
    limit = 50,
    offset = 0
  ): Promise<any[]> {
    const cacheKey = `${DOSHA_IMBALANCE_CACHE_PREFIX}:history:${clinicId}:${patientId}:${doshaType ?? 'all'}:${limit}:${offset}`;

    const cached = await this.cache.get<Record<string, unknown>[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const where: any = { patientId, clinicId };
    if (doshaType) {
      where.doshaType = doshaType;
    }

    const records = await this.db.prisma.doshaImbalance.findMany({
      where,
      orderBy: { assessedAt: 'desc' },
      take: limit,
      skip: offset,
    });

    await this.cache.set(cacheKey, records, 300);
    return records;
  }

  /**
   * Invalidates cache entries for a patient's dosha imbalances.
   *
   * @param patientId - Patient ID
   * @param clinicId - Clinic ID
   */
  private async invalidatePatientCache(patientId: string, clinicId: string): Promise<void> {
    const pattern = `${DOSHA_IMBALANCE_CACHE_PREFIX}:*:${clinicId}:${patientId}:*`;
    await this.cache.invalidatePattern(pattern);
  }
}
