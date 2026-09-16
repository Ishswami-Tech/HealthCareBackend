/**
 * Inventory Service
 * @module Pharmacy Inventory
 * @description Stock level computation, movement recording, and on-hand reconciliation
 */

import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { EventService } from '@infrastructure/events';
import { HealthcareError, ErrorCode } from '@core/errors';
import { MovementType } from '@core/types/enums.types';
import type { PrismaTransactionClientWithDelegates } from '@core/types/prisma.types';
import type {
  RecordStockMovementDto,
  StockAdjustmentDto,
  DispenseFefoDto,
} from '../dto/pharmacy-inventory.dto';

/**
 * Cache key prefix for inventory queries
 */
const INVENTORY_CACHE_PREFIX = 'pharmacy:inventory';

/**
 * Cache TTL in seconds (5 minutes for stock level queries)
 */
const CACHE_TTL = 300;

/**
 * Service for pharmacy inventory stock level tracking and movements.
 *
 * Responsibilities:
 * - Record stock movements (in/out/adjust/transfer/expiry write-off)
 * - Compute current on-hand quantity from batch roll-ups
 * - FEFO-based dispense that consumes earliest-expiring batches first
 * - Audit trail for all movements
 *
 * @public
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly logger: LoggingService,
    private readonly events: EventService
  ) {}

  private async reconcileMedicineStock(
    client: PrismaTransactionClientWithDelegates,
    medicineId: string,
    clinicId: string
  ): Promise<void> {
    const medicine = await client.medicine.findFirst({
      where: { id: medicineId, clinicId },
      select: { id: true },
    });

    if (!medicine) {
      throw new NotFoundException(
        `Medicine ${medicineId} not found in clinic ${clinicId} during inventory reconciliation`
      );
    }

    const aggregate = await client.stockBatch.aggregate({
      where: {
        productId: medicineId,
        clinicId,
        quantityOnHand: { gt: 0 },
        expiryDate: { gt: new Date() },
      },
      _sum: { quantityOnHand: true },
    });

    await client.medicine.update({
      where: { id: medicine.id },
      data: { stock: aggregate._sum.quantityOnHand ?? 0 },
    });
  }

  /**
   * Computes the current on-hand stock for a product at a clinic.
   *
   * Aggregates all active (non-expired, non-fully-depleted) batches.
   *
   * @param productId - Medicine/product ID
   * @param clinicId - Clinic context
   * @returns Total on-hand quantity and batch breakdown
   */
  async getOnHandStock(
    productId: string,
    clinicId: string
  ): Promise<{
    productId: string;
    clinicId: string;
    totalOnHand: number;
    batchCount: number;
  }> {
    const cacheKey = `${INVENTORY_CACHE_PREFIX}:onhand:${clinicId}:${productId}`;
    const cached = await this.cache.get<{
      productId: string;
      clinicId: string;
      totalOnHand: number;
      batchCount: number;
    }>(cacheKey);
    if (cached) {
      return cached;
    }

    const batches = await this.db.prisma.stockBatch.findMany({
      where: {
        productId,
        clinicId,
        quantityOnHand: { gt: 0 },
        expiryDate: { gt: new Date() },
      },
      select: { quantityOnHand: true },
    });

    const totalOnHand = batches.reduce(
      (sum: number, b: (typeof batches)[number]) => sum + (b.quantityOnHand ?? 0),
      0
    );
    const result = {
      productId,
      clinicId,
      totalOnHand,
      batchCount: batches.length,
    };

    await this.cache.set(cacheKey, result, CACHE_TTL);
    return result;
  }

  /**
   * Records a stock movement (in, out, transfer, adjustment, expiry write-off).
   *
   * Validates the resulting batch quantity (cannot go negative) and
   * emits a `pharmacy.movement.recorded` event for downstream consumers
   * (alerting, COGS, reorder evaluation).
   *
   * @param dto - Movement details
   * @param userId - ID of the user performing the movement
   * @param clinicId - Clinic context (source)
   * @returns The persisted movement
   * @throws {HealthcareError} If batch not found or would result in negative stock
   */
  async recordMovement(
    dto: RecordStockMovementDto,
    userId: string,
    clinicId: string
  ): Promise<{ id: string; movementType: MovementType; quantity: number; createdAt: Date }> {
    this.logger.info('Recording stock movement', {
      module: 'Inventory',
      productId: dto.productId,
      batchId: dto.batchId,
      movementType: dto.movementType,
      clinicId,
    });

    const movement = await this.db.prisma.$transaction(async tx => {
      const batch = await tx.stockBatch.findFirst({
        where: { id: dto.batchId, productId: dto.productId, clinicId },
      });

      if (!batch) {
        throw new HealthcareError(
          ErrorCode.PHARMACY_BATCH_NOT_FOUND,
          `Batch ${dto.batchId} not found in clinic ${clinicId}`,
          { productId: dto.productId, batchId: dto.batchId }
        );
      }

      const newQuantity = (batch.quantityOnHand ?? 0) + dto.quantity;

      if (newQuantity < 0) {
        throw new HealthcareError(
          ErrorCode.PHARMACY_STOCK_INSUFFICIENT,
          `Insufficient stock: batch has ${batch.quantityOnHand} on-hand, requested ${Math.abs(dto.quantity)}`,
          { batchId: dto.batchId, onHand: batch.quantityOnHand, requested: Math.abs(dto.quantity) }
        );
      }

      const movement = await tx.stockMovement.create({
        data: {
          productId: dto.productId,
          batchId: dto.batchId,
          clinicId,
          movementType: dto.movementType,
          quantity: dto.quantity,
          reason: dto.reason,
          referenceId: dto.referenceId,
          referenceType: dto.referenceType,
          recordedById: userId,
        },
        select: { id: true, movementType: true, quantity: true, createdAt: true },
      });

      await tx.stockBatch.update({
        where: { id: dto.batchId },
        data: { quantityOnHand: newQuantity },
      });

      await this.reconcileMedicineStock(tx, dto.productId, clinicId);

      return movement;
    });

    await this.events.emit('pharmacy.movement.recorded', {
      movementId: movement.id,
      productId: dto.productId,
      batchId: dto.batchId,
      clinicId,
      movementType: dto.movementType,
      quantity: dto.quantity,
    });

    return movement;
  }

  /**
   * Records a stock adjustment (manual write-off, damage correction).
   *
   * Wraps {@link recordMovement} with `MovementType.ADJUSTMENT`.
   *
   * @param dto - Adjustment details
   * @param userId - ID of the user performing the adjustment
   * @param clinicId - Clinic context
   * @returns The persisted movement
   */
  async adjustStock(
    dto: StockAdjustmentDto,
    userId: string,
    clinicId: string
  ): Promise<{ id: string; movementType: MovementType; quantity: number; createdAt: Date }> {
    if (!dto.batchId) {
      throw new BadRequestException('batchId is required for stock adjustments');
    }

    return this.recordMovement(
      {
        productId: dto.productId,
        batchId: dto.batchId,
        movementType: MovementType.ADJUSTMENT,
        quantity: dto.quantity,
        reason: dto.reason,
        referenceType: 'ADJUSTMENT',
      },
      userId,
      clinicId
    );
  }

  /**
   * FEFO-based dispense: consumes earliest-expiring batches first.
   *
   * For each requested dispense item, picks the earliest-expiring batch
   * with sufficient quantity. Consumes across multiple batches if needed.
   *
   * @param prescriptionId - Source prescription ID
   * @param dto - Dispense items (one entry per prescription line)
   * @param userId - ID of the dispensing pharmacist
   * @param clinicId - Clinic context
   * @returns Array of batches consumed with quantities
   */
  async dispenseFefo(
    prescriptionId: string,
    dto: DispenseFefoDto,
    userId: string,
    clinicId: string,
    tx?: PrismaTransactionClientWithDelegates,
    emitEvent = true
  ): Promise<
    Array<{
      prescriptionItemId: string;
      medicineId: string;
      consumedBatches: Array<{
        batchId: string;
        quantity: number;
        expiryDate: Date;
        lotNumber: string;
      }>;
      totalDispensed: number;
    }>
  > {
    this.logger.info('FEFO dispense initiated', {
      module: 'Inventory',
      prescriptionId,
      clinicId,
      itemCount: dto.items.length,
    });

    const results: Array<{
      prescriptionItemId: string;
      medicineId: string;
      consumedBatches: Array<{
        batchId: string;
        quantity: number;
        expiryDate: Date;
        lotNumber: string;
      }>;
      totalDispensed: number;
    }> = [];

    const consume = async (client: PrismaTransactionClientWithDelegates) => {
      const affectedMedicineIds = new Set<string>();

      for (const item of dto.items) {
        const consumedBatches: Array<{
          batchId: string;
          quantity: number;
          expiryDate: Date;
          lotNumber: string;
        }> = [];

        let remaining = item.quantity;
        const fefoBatches = await client.stockBatch.findMany({
          where: {
            productId: item.medicineId,
            clinicId,
            quantityOnHand: { gt: 0 },
            expiryDate: { gt: new Date() },
          },
          orderBy: { expiryDate: 'asc' },
        });

        for (const batch of fefoBatches) {
          if (remaining <= 0) break;
          const available = batch.quantityOnHand ?? 0;
          const take = Math.min(available, remaining);

          await client.stockBatch.update({
            where: { id: batch.id },
            data: { quantityOnHand: available - take },
          });

          await client.stockMovement.create({
            data: {
              productId: item.medicineId,
              batchId: batch.id,
              clinicId,
              movementType: MovementType.DISPENSE_OUT,
              quantity: -take,
              reason: `FEFO dispense for prescription ${prescriptionId}`,
              referenceId: prescriptionId,
              referenceType: 'PRESCRIPTION',
              recordedById: userId,
            },
          });

          consumedBatches.push({
            batchId: batch.id,
            quantity: take,
            expiryDate: batch.expiryDate,
            lotNumber: batch.lotNumber,
          });
          remaining -= take;
        }

        if (remaining > 0) {
          throw new HealthcareError(
            ErrorCode.PHARMACY_STOCK_INSUFFICIENT,
            `Insufficient stock for medicine ${item.medicineId}: short by ${remaining} units`,
            { medicineId: item.medicineId, shortage: remaining, requested: item.quantity }
          );
        }

        await client.medicine.update({
          where: { id: item.medicineId },
          data: { stock: { decrement: item.quantity } },
        });

        affectedMedicineIds.add(item.medicineId);

        await this.cache.del(`${INVENTORY_CACHE_PREFIX}:onhand:${clinicId}:${item.medicineId}`);

        results.push({
          prescriptionItemId: item.prescriptionItemId,
          medicineId: item.medicineId,
          consumedBatches,
          totalDispensed: consumedBatches.reduce(
            (sum: number, c: (typeof consumedBatches)[number]) => sum + c.quantity,
            0
          ),
        });
      }

      for (const medicineId of affectedMedicineIds) {
        await this.reconcileMedicineStock(client, medicineId, clinicId);
      }

      return results;
    };

    const consumedResults = tx
      ? await consume(tx)
      : await this.db.prisma.$transaction(async transaction => consume(transaction));

    if (emitEvent) {
      await this.events.emit('pharmacy.dispense.fefo', {
        prescriptionId,
        clinicId,
        itemCount: dto.items.length,
        userId,
      });
    }

    return consumedResults;
  }

  /**
   * Lists stock movement history for a clinic with optional filters.
   *
   * @param clinicId - Clinic context
   * @param filters - Optional filters (productId, movementType, limit, offset)
   * @returns Array of movements newest first
   */
  async listMovements(
    clinicId: string,
    filters: {
      productId?: string;
      movementType?: MovementType;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<
    Array<{
      id: string;
      productId: string;
      batchId: string;
      movementType: MovementType;
      quantity: number;
      reason: string | null;
      referenceId: string | null;
      referenceType: string | null;
      recordedById: string;
      createdAt: Date;
    }>
  > {
    const { productId, movementType, limit = 50, offset = 0 } = filters;

    return this.db.prisma.stockMovement.findMany({
      where: {
        clinicId,
        ...(productId ? { productId } : {}),
        ...(movementType ? { movementType } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      skip: offset,
      select: {
        id: true,
        productId: true,
        batchId: true,
        movementType: true,
        quantity: true,
        reason: true,
        referenceId: true,
        referenceType: true,
        recordedById: true,
        createdAt: true,
      },
    });
  }

  /**
   * Retrieves a single movement by ID for audit purposes.
   *
   * @param movementId - Movement ID
   * @param clinicId - Clinic context (enforced for isolation)
   * @returns Movement with batch and product details
   * @throws {NotFoundException} If movement not found in clinic scope
   */
  async getMovementById(
    movementId: string,
    clinicId: string
  ): Promise<{
    id: string;
    productId: string;
    batchId: string;
    clinicId: string;
    movementType: MovementType;
    quantity: number;
    reason: string | null;
    referenceId: string | null;
    referenceType: string | null;
    recordedById: string;
    createdAt: Date;
  }> {
    const movement = await this.db.prisma.stockMovement.findFirst({
      where: { id: movementId, clinicId },
    });

    if (!movement) {
      throw new NotFoundException(`Movement ${movementId} not found in clinic ${clinicId}`);
    }

    return movement;
  }
}
