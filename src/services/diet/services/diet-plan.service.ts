/**
 * Diet Plan Service — CRUD for DietPlan + DietPlanItem
 * @module Diet/DietPlan
 * @description Handles creation, retrieval, update, and deletion of diet plans and their items
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { EventService } from '@infrastructure/events';
import { HealthcareError, ErrorCode } from '@core/errors';
import type {
  CreateDietPlanDto,
  UpdateDietPlanDto,
  DietPlanResponseDto,
  DietPlanItemResponseDto,
  DietPlanStatus,
} from '@services/diet/dto';
import { DietPlanStatus as Status, DietaryGoal, MealSlot } from '@services/diet/dto';

/**
 * Cache key prefix for diet plans
 */
const DIET_PLAN_CACHE_PREFIX = 'diet:plan';

/**
 * Service for managing Diet Plan documents.
 *
 * DietPlan is the "plan-as-document" concept — a header record with
 * embedded DietPlanItem rows describing meals for each slot and day.
 *
 * @public
 */
@Injectable()
export class DietPlanService {
  /**
   * Creates an instance of DietPlanService.
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
   * Creates a new Diet Plan with optional items.
   *
   * @param dto - Plan creation data
   * @param userId - ID of the creating practitioner
   * @param clinicId - Clinic context
   * @returns Created plan with items
   */
  async createDietPlan(
    dto: CreateDietPlanDto,
    userId: string,
    clinicId: string
  ): Promise<DietPlanResponseDto> {
    this.logger.info('Creating diet plan', {
      module: 'DietPlan',
      patientId: dto.patientId,
      goal: dto.goal,
      clinicId,
    });

    const plan = await this.db.prisma.dietPlan.create({
      data: {
        patientId: dto.patientId,
        clinicId,
        title: dto.title,
        goal: dto.goal,
        status: Status.DRAFT,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        summary: dto.summary,
        createdBy: userId,
        items: dto.items
          ? {
              create: dto.items.map(item => ({
                foodItemId: item.foodItemId,
                mealSlot: item.mealSlot,
                quantityGrams: item.quantityGrams,
                preparationNotes: item.preparationNotes,
                rationale: item.rationale,
                dayNumber: item.dayNumber ?? 1,
              })),
            }
          : undefined,
      },
      include: {
        items: true,
      },
    });

    await this.invalidatePatientCache(dto.patientId, clinicId);

    await this.events.emit('diet.plan.created', {
      dietPlanId: plan.id,
      patientId: dto.patientId,
      clinicId,
      goal: dto.goal,
      planTitle: dto.title,
      summary: dto.summary,
      createdByUserId: userId,
      startDate: dto.startDate,
      endDate: dto.endDate,
    });

    return this.mapToResponseDto(plan);
  }

  /**
   * Retrieves paginated diet plan history for a patient.
   *
   * @param patientId - Patient ID
   * @param clinicId - Clinic context
   * @param limit - Max results
   * @param offset - Results to skip
   * @returns Array of DietPlanResponseDto
   */
  async getPlansForPatient(
    patientId: string,
    clinicId: string,
    limit = 20,
    offset = 0
  ): Promise<DietPlanResponseDto[]> {
    const cacheKey = `${DIET_PLAN_CACHE_PREFIX}:patient:${clinicId}:${patientId}:${limit}:${offset}`;

    const cached = await this.cache.get<DietPlanResponseDto[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const plans = await this.db.prisma.dietPlan.findMany({
      where: { patientId, clinicId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: { items: true },
    });

    const result = plans.map((plan: (typeof plans)[number]) => this.mapToResponseDto(plan));
    await this.cache.set(cacheKey, result, 300);

    return result;
  }

  /**
   * Retrieves a single diet plan by ID.
   *
   * @param id - Plan ID
   * @param clinicId - Clinic context
   * @returns Diet plan with items
   * @throws {HealthcareError} If plan not found
   */
  async getPlanById(id: string, clinicId: string): Promise<DietPlanResponseDto> {
    const cacheKey = `${DIET_PLAN_CACHE_PREFIX}:${id}`;

    const cached = await this.cache.get<DietPlanResponseDto>(cacheKey);
    if (cached) {
      return cached;
    }

    const plan = await this.db.prisma.dietPlan.findFirst({
      where: { id, clinicId },
      include: { items: true },
    });

    if (!plan) {
      throw new HealthcareError(
        'Diet plan not found',
        ErrorCode.RESOURCE_NOT_FOUND,
        404,
        { dietPlanId: id },
        'DietPlanService.getPlanById'
      );
    }

    const result = this.mapToResponseDto(plan);
    await this.cache.set(cacheKey, result, 600);

    return result;
  }

  /**
   * Updates a diet plan header.
   * If items are provided, they fully replace existing items.
   *
   * @param id - Plan ID
   * @param dto - Update data
   * @param clinicId - Clinic context
   * @returns Updated plan
   * @throws {HealthcareError} If plan not found
   */
  async updatePlan(
    id: string,
    dto: UpdateDietPlanDto,
    clinicId: string
  ): Promise<DietPlanResponseDto> {
    const existing = await this.db.prisma.dietPlan.findFirst({
      where: { id, clinicId },
      select: { patientId: true },
    });

    if (!existing) {
      throw new HealthcareError(
        'Diet plan not found',
        ErrorCode.RESOURCE_NOT_FOUND,
        404,
        { dietPlanId: id },
        'DietPlanService.updatePlan'
      );
    }

    const updateData: {
      title?: string;
      goal?: string;
      endDate?: Date;
      status?: string;
      summary?: string;
      items?: {
        create: Array<{
          foodItemId: string;
          mealSlot: string;
          quantityGrams: number;
          preparationNotes?: string | undefined;
          rationale?: string | undefined;
          dayNumber: number;
        }>;
      };
    } = {};
    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.goal !== undefined) updateData.goal = dto.goal;
    if (dto.endDate !== undefined) updateData.endDate = new Date(dto.endDate);
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.summary !== undefined) updateData.summary = dto.summary;

    if (dto.items !== undefined) {
      // Replace items atomically
      await this.db.prisma.dietPlanItem.deleteMany({
        where: { dietPlanId: id },
      });
      updateData.items = {
        create: dto.items.map(item => ({
          foodItemId: item.foodItemId,
          mealSlot: item.mealSlot,
          quantityGrams: item.quantityGrams,
          preparationNotes: item.preparationNotes,
          rationale: item.rationale,
          dayNumber: item.dayNumber ?? 1,
        })),
      };
    }

    const updated = await this.db.prisma.dietPlan.update({
      where: { id },
      data: updateData,
      include: { items: true },
    });

    await this.invalidateCaches(id, existing.patientId, clinicId);

    await this.events.emit('diet.plan.updated', {
      dietPlanId: id,
      patientId: existing.patientId,
      clinicId,
    });

    return this.mapToResponseDto(updated);
  }

  /**
   * Deletes a diet plan.
   *
   * @param id - Plan ID
   * @param clinicId - Clinic context
   * @throws {HealthcareError} If plan not found
   */
  async deletePlan(id: string, clinicId: string): Promise<void> {
    const existing = await this.db.prisma.dietPlan.findFirst({
      where: { id, clinicId },
      select: { patientId: true },
    });

    if (!existing) {
      throw new HealthcareError(
        'Diet plan not found',
        ErrorCode.RESOURCE_NOT_FOUND,
        404,
        { dietPlanId: id },
        'DietPlanService.deletePlan'
      );
    }

    // Items are deleted via cascade; explicit delete for safety
    await this.db.prisma.dietPlanItem.deleteMany({ where: { dietPlanId: id } });
    await this.db.prisma.dietPlan.delete({ where: { id } });

    await this.invalidateCaches(id, existing.patientId, clinicId);

    await this.events.emit('diet.plan.deleted', {
      dietPlanId: id,
      patientId: existing.patientId,
      clinicId,
    });
  }

  /**
   * Archives a diet plan (marks as ARCHIVED).
   *
   * @param id - Plan ID
   * @param clinicId - Clinic context
   * @returns Updated plan
   */
  async archivePlan(id: string, clinicId: string): Promise<DietPlanResponseDto> {
    return this.updatePlan(id, { status: Status.ARCHIVED }, clinicId);
  }

  // ============ Cache management ============

  /**
   * Invalidates caches for a patient's diet plans.
   */
  private async invalidatePatientCache(patientId: string, clinicId: string): Promise<void> {
    const pattern = `${DIET_PLAN_CACHE_PREFIX}:patient:${clinicId}:${patientId}:*`;
    await this.cache.invalidatePattern(pattern);
  }

  /**
   * Invalidates caches for a specific plan.
   */
  private async invalidateCaches(
    planId: string,
    patientId: string,
    clinicId: string
  ): Promise<void> {
    await this.cache.del(`${DIET_PLAN_CACHE_PREFIX}:${planId}`);
    await this.invalidatePatientCache(patientId, clinicId);
  }

  // ============ DTO mapping ============

  /**
   * Maps a Prisma DietPlan record to DietPlanResponseDto
   */
  private mapToResponseDto(plan: {
    id: string;
    patientId: string;
    clinicId: string;
    title: string;
    goal: string;
    status: string;
    startDate: Date;
    endDate: Date;
    summary?: string;
    prakritiAnalysisId?: string;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
    items: Array<{
      id: string;
      dietPlanId: string;
      foodItemId: string;
      mealSlot: string;
      quantityGrams: number;
      preparationNotes?: string;
      rationale?: string;
      dayNumber?: number;
      foodItem: { name: string };
    }>;
  }): DietPlanResponseDto {
    return {
      id: plan.id,
      patientId: plan.patientId,
      clinicId: plan.clinicId,
      title: plan.title,
      goal: plan.goal as DietaryGoal,
      status: plan.status as DietPlanStatus,
      startDate: plan.startDate.toISOString(),
      endDate: plan.endDate.toISOString(),
      summary: plan.summary ?? undefined,
      items: plan.items.map(item => ({
        id: item.id,
        dietPlanId: item.dietPlanId,
        foodItemId: item.foodItemId,
        foodName: item.foodItem?.name,
        mealSlot: item.mealSlot as MealSlot,
        quantityGrams: item.quantityGrams,
        ...(item.preparationNotes ? { preparationNotes: item.preparationNotes } : {}),
        ...(item.rationale ? { rationale: item.rationale } : {}),
        ...(item.dayNumber !== undefined ? { dayNumber: item.dayNumber } : {}),
      })),
      prakritiAnalysisId: plan.prakritiAnalysisId ?? undefined,
      createdBy: plan.createdBy,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
    };
  }
}
