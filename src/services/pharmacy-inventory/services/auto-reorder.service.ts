/**
 * Auto Reorder Service
 * @module Pharmacy Inventory
 * @description Reorder rule management and automatic reorder trigger logic
 */

import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { EventService } from '@infrastructure/events';
import { HealthcareError, ErrorCode } from '@core/errors';
import { ReorderStrategy } from '@core/types/enums.types';
import type { CreateReorderRuleDto } from '../dto/pharmacy-inventory.dto';

/**
 * Cache key prefix for reorder rules
 */
const REORDER_CACHE_PREFIX = 'pharmacy:reorder';

/**
 * Cache TTL in seconds (10 minutes)
 */
const REORDER_CACHE_TTL = 600;

/**
 * Service for pharmacy auto-reorder rule management.
 *
 * Responsibilities:
 * - CRUD for reorder rules per product
 * - Rule evaluation against current stock levels
 * - Automatic reorder suggestion emission
 * - Integration with PurchaseOrderService for PO generation
 *
 * @public
 */
@Injectable()
export class AutoReorderService {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly logger: LoggingService,
    private readonly events: EventService
  ) {}

  /**
   * Creates a new reorder rule for a product.
   *
   * @param dto - Rule data
   * @param userId - ID of the user creating the rule
   * @param clinicId - Clinic context
   * @returns Created rule
   * @throws {BadRequestException} If rule validation fails
   */
  async createRule(
    dto: CreateReorderRuleDto,
    userId: string,
    clinicId: string
  ): Promise<{
    id: string;
    productId: string;
    strategy: ReorderStrategy;
    reorderPoint: number;
    orderQuantity: number | null;
    minLevel: number | null;
    maxLevel: number | null;
    isActive: boolean;
    createdAt: Date;
  }> {
    this.logger.info('Creating reorder rule', {
      module: 'AutoReorder',
      productId: dto.productId,
      strategy: dto.strategy,
      clinicId,
    });

    if (dto.strategy === ReorderStrategy.MIN_MAX) {
      if (dto.minLevel == null || dto.maxLevel == null) {
        throw new BadRequestException('minLevel and maxLevel are required for MIN_MAX strategy');
      }
      if (dto.minLevel >= dto.maxLevel) {
        throw new BadRequestException('minLevel must be less than maxLevel');
      }
    }

    if (dto.strategy === ReorderStrategy.REORDER_POINT && dto.orderQuantity == null) {
      throw new BadRequestException('orderQuantity is required for REORDER_POINT strategy');
    }

    const existing = await this.db.prisma.reorderRule.findFirst({
      where: {
        productId: dto.productId,
        clinicId,
        isActive: { not: false },
      },
      select: { id: true },
    });

    if (existing) {
      throw new BadRequestException(
        `Active reorder rule already exists for product ${dto.productId} in this clinic`
      );
    }

    const rule = await this.db.prisma.reorderRule.create({
      data: {
        productId: dto.productId,
        clinicId,
        strategy: dto.strategy,
        reorderPoint: dto.reorderPoint,
        orderQuantity: dto.orderQuantity ?? null,
        minLevel: dto.minLevel ?? null,
        maxLevel: dto.maxLevel ?? null,
        preferredSupplier: dto.preferredSupplier ?? null,
        isActive: dto.isActive ?? true,
        createdById: userId,
      },
      select: {
        id: true,
        productId: true,
        strategy: true,
        reorderPoint: true,
        orderQuantity: true,
        minLevel: true,
        maxLevel: true,
        isActive: true,
        createdAt: true,
      },
    });

    await this.events.emit('pharmacy.reorder.ruleCreated', {
      ruleId: rule.id,
      productId: dto.productId,
      clinicId,
      strategy: dto.strategy,
    });

    return rule;
  }

  /**
   * Lists reorder rules for a clinic with optional product filter.
   *
   * @param clinicId - Clinic context
   * @param productId - Optional product filter
   * @returns Array of reorder rules
   */
  async listRules(
    clinicId: string,
    productId?: string
  ): Promise<
    Array<{
      id: string;
      productId: string;
      strategy: ReorderStrategy;
      reorderPoint: number;
      orderQuantity: number | null;
      minLevel: number | null;
      maxLevel: number | null;
      preferredSupplier: string | null;
      isActive: boolean;
      createdAt: Date;
      updatedAt: Date;
    }>
  > {
    const where: { clinicId: string; productId?: string } = { clinicId };
    if (productId) {
      where.productId = productId;
    }

    return this.db.prisma.reorderRule.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        productId: true,
        strategy: true,
        reorderPoint: true,
        orderQuantity: true,
        minLevel: true,
        maxLevel: true,
        preferredSupplier: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Evaluates all active reorder rules against current stock levels.
   *
   * Returns products that need reordering, with suggested order quantities
   * based on their configured strategy.
   *
   * @param clinicId - Clinic context
   * @returns Array of products needing reorder with suggestions
   */
  async evaluateAll(clinicId: string): Promise<
    Array<{
      ruleId: string;
      productId: string;
      strategy: ReorderStrategy;
      currentStock: number;
      reorderPoint: number;
      suggestedQuantity: number | null;
      preferredSupplier: string | null;
    }>
  > {
    const rules = await this.db.prisma.reorderRule.findMany({
      where: { clinicId, isActive: true },
    });

    const results: Array<{
      ruleId: string;
      productId: string;
      strategy: ReorderStrategy;
      currentStock: number;
      reorderPoint: number;
      suggestedQuantity: number | null;
      preferredSupplier: string | null;
    }> = [];

    for (const rule of rules) {
      const onHand = await this.getCurrentStock(rule.productId, clinicId);

      if (onHand > rule.reorderPoint) {
        continue;
      }

      let suggestedQuantity: number | null = null;

      switch (rule.strategy) {
        case ReorderStrategy.FIXED_QTY:
          suggestedQuantity = rule.orderQuantity ?? null;
          break;
        case ReorderStrategy.REORDER_POINT:
          suggestedQuantity = rule.orderQuantity ?? null;
          break;
        case ReorderStrategy.MIN_MAX:
          if (rule.maxLevel != null) {
            suggestedQuantity = rule.maxLevel - onHand;
          }
          break;
      }

      results.push({
        ruleId: rule.id,
        productId: rule.productId,
        strategy: rule.strategy,
        currentStock: onHand,
        reorderPoint: rule.reorderPoint,
        suggestedQuantity: suggestedQuantity && suggestedQuantity > 0 ? suggestedQuantity : null,
        preferredSupplier: rule.preferredSupplier,
      });
    }

    if (results.length > 0) {
      await this.events.emit('pharmacy.reorder.evaluated', {
        clinicId,
        productsNeedingReorder: results.length,
      });
    }

    return results;
  }

  /**
   * Updates an existing reorder rule.
   *
   * @param ruleId - Rule ID
   * @param dto - Updated rule data
   * @param clinicId - Clinic context
   * @returns Updated rule
   * @throws {HealthcareError} If rule not found
   */
  async updateRule(
    ruleId: string,
    dto: Partial<CreateReorderRuleDto>,
    clinicId: string
  ): Promise<{
    id: string;
    productId: string;
    strategy: ReorderStrategy;
    reorderPoint: number;
    orderQuantity: number | null;
    isActive: boolean;
    updatedAt: Date;
  }> {
    const rule = await this.db.prisma.reorderRule.findFirst({
      where: { id: ruleId, clinicId },
    });

    if (!rule) {
      throw new HealthcareError(
        ErrorCode.PHARMACY_REORDER_RULE_NOT_FOUND,
        `Reorder rule ${ruleId} not found in clinic ${clinicId}`,
        { ruleId }
      );
    }

    const updated = await this.db.prisma.reorderRule.update({
      where: { id: ruleId },
      data: {
        strategy: dto.strategy ?? rule.strategy,
        reorderPoint: dto.reorderPoint ?? rule.reorderPoint,
        orderQuantity: dto.orderQuantity ?? rule.orderQuantity,
        minLevel: dto.minLevel ?? rule.minLevel,
        maxLevel: dto.maxLevel ?? rule.maxLevel,
        preferredSupplier: dto.preferredSupplier ?? rule.preferredSupplier,
        isActive: dto.isActive ?? rule.isActive,
      },
      select: {
        id: true,
        productId: true,
        strategy: true,
        reorderPoint: true,
        orderQuantity: true,
        minLevel: true,
        maxLevel: true,
        isActive: true,
        updatedAt: true,
      },
    });

    await this.cache.del(`${REORDER_CACHE_PREFIX}:rule:${ruleId}`);
    return updated;
  }

  /**
   * Deletes (soft-deactivates) a reorder rule.
   *
   * @param ruleId - Rule ID
   * @param clinicId - Clinic context
   */
  async deleteRule(ruleId: string, clinicId: string): Promise<void> {
    const rule = await this.db.prisma.reorderRule.findFirst({
      where: { id: ruleId, clinicId },
      select: { id: true },
    });

    if (!rule) {
      throw new HealthcareError(
        ErrorCode.PHARMACY_REORDER_RULE_NOT_FOUND,
        `Reorder rule ${ruleId} not found in clinic ${clinicId}`,
        { ruleId }
      );
    }

    await this.db.prisma.reorderRule.update({
      where: { id: ruleId },
      data: { isActive: false },
    });
  }

  /**
   * Computes current on-hand stock for a product across all batches.
   *
   * @param productId - Product ID
   * @param clinicId - Clinic context
   * @returns Total on-hand quantity
   */
  private async getCurrentStock(productId: string, clinicId: string): Promise<number> {
    const cacheKey = `${REORDER_CACHE_PREFIX}:stock:${clinicId}:${productId}`;
    const cached = await this.cache.get<number>(cacheKey);
    if (cached !== null && cached !== undefined) {
      return cached;
    }

    const result = await this.db.prisma.stockBatch.aggregate({
      where: {
        productId,
        clinicId,
        quantityOnHand: { gt: 0 },
      },
      _sum: { quantityOnHand: true },
    });

    const stock = result._sum.quantityOnHand ?? 0;
    await this.cache.set(cacheKey, stock, REORDER_CACHE_TTL);
    return stock;
  }
}
