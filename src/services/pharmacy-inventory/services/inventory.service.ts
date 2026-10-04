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

/** Result of one FEFO dispense line. */
export interface FefoDispenseResult {
  prescriptionItemId: string;
  medicineId: string;
  consumedBatches: Array<{
    batchId: string;
    quantity: number;
    expiryDate: Date;
    lotNumber: string;
  }>;
  /** Units taken from legacy stock that is not tracked in any batch. */
  unbatchedQuantity: number;
  totalDispensed: number;
}

interface FefoBatchRow {
  id: string;
  lotNumber: string;
  expiryDate: Date;
  quantityOnHand: number | null;
}

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

  /**
   * Computes the sellable on-hand stock for a product at a clinic.
   *
   * `Medicine.stock` is the total on-hand (batched plus legacy un-batched
   * units, e.g. medicines created through the inventory screen with a plain
   * stock number). Sellable stock excludes units sitting in already-expired
   * batches. Always clinic scoped: a product id from another clinic yields 0.
   *
   * @param productId - Medicine/product ID
   * @param clinicId - Clinic context
   * @returns Sellable on-hand quantity and the count of live batches
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

    const now = new Date();
    const medicine = await (
      this.db.prisma as unknown as PrismaTransactionClientWithDelegates
    ).medicine.findFirst({
      where: { id: productId, clinicId },
      select: { stock: true },
    });
    const batches: Array<{ quantityOnHand: number | null; expiryDate: Date }> =
      await this.db.prisma.stockBatch.findMany({
        where: { productId, clinicId, quantityOnHand: { gt: 0 } },
        select: { quantityOnHand: true, expiryDate: true },
      });

    const expiredQuantity = batches
      .filter(b => b.expiryDate.getTime() <= now.getTime())
      .reduce((sum: number, b) => sum + (b.quantityOnHand ?? 0), 0);
    const liveBatchCount = batches.filter(b => b.expiryDate.getTime() > now.getTime()).length;

    const result = {
      productId,
      clinicId,
      totalOnHand: Math.max(0, (medicine?.stock ?? 0) - expiredQuantity),
      batchCount: liveBatchCount,
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
      const client = tx as unknown as PrismaTransactionClientWithDelegates;
      const batch = await client.stockBatch.findFirst({
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

      // Guarded write: the WHERE re-checks the quantity at write time, so two
      // concurrent movements can never drive the batch below zero.
      const batchUpdate = await client.stockBatch.updateMany({
        where: {
          id: dto.batchId,
          clinicId,
          productId: dto.productId,
          ...(dto.quantity < 0 ? { quantityOnHand: { gte: Math.abs(dto.quantity) } } : {}),
        },
        data: { quantityOnHand: { increment: dto.quantity } },
      });
      if (batchUpdate.count !== 1) {
        throw new HealthcareError(
          ErrorCode.PHARMACY_STOCK_INSUFFICIENT,
          `Batch ${dto.batchId} changed concurrently, retry the movement`,
          { batchId: dto.batchId, requested: Math.abs(dto.quantity) }
        );
      }

      await this.applyMedicineStockDelta(client, dto.productId, clinicId, dto.quantity);

      return client.stockMovement.create({
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
    });

    await this.cache.del(`${INVENTORY_CACHE_PREFIX}:onhand:${clinicId}:${dto.productId}`);

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
   * Applies a signed delta to `Medicine.stock` (clinic scoped). A negative
   * delta is guarded (`stock >= |delta|`) so stock can never go negative, even
   * under concurrent writers: the guarded UPDATE row-locks the medicine until
   * the surrounding transaction commits.
   */
  private async applyMedicineStockDelta(
    client: PrismaTransactionClientWithDelegates,
    medicineId: string,
    clinicId: string,
    delta: number
  ): Promise<void> {
    const result = await client.medicine.updateMany({
      where: {
        id: medicineId,
        clinicId,
        ...(delta < 0 ? { stock: { gte: Math.abs(delta) } } : {}),
      },
      data: { stock: { increment: delta } },
    });

    if (result.count === 1) {
      return;
    }

    const medicine = await client.medicine.findFirst({
      where: { id: medicineId, clinicId },
      select: { stock: true },
    });
    if (!medicine) {
      throw new NotFoundException(`Medicine ${medicineId} not found in clinic ${clinicId}`);
    }
    throw new HealthcareError(
      ErrorCode.PHARMACY_STOCK_INSUFFICIENT,
      `Insufficient stock for medicine ${medicineId}: ${medicine.stock ?? 0} on hand, requested ${Math.abs(delta)}`,
      { medicineId, onHand: medicine.stock ?? 0, requested: Math.abs(delta) }
    );
  }

  /**
   * FEFO-based dispense: consumes earliest-expiring batches first.
   *
   * Runs in one transaction (the caller's `tx` when given, so a prescription
   * dispense stays atomic with its status update). For each item:
   * 1. `Medicine.stock` is decremented with a guarded UPDATE (clinic scoped,
   *    `stock >= qty`), which both prevents negative stock and serialises
   *    concurrent dispenses of the same medicine.
   * 2. Non-expired batches are consumed earliest expiry first with guarded
   *    per-batch UPDATEs and one DISPENSE_OUT movement per batch.
   * 3. Anything the batches cannot cover is taken from legacy un-batched stock
   *    (`Medicine.stock` minus every batch, expired ones included). Expired
   *    batches are never dispensed.
   * If any step fails the whole transaction rolls back.
   *
   * @param prescriptionId - Source prescription ID
   * @param dto - Dispense items (one entry per prescription line)
   * @param userId - ID of the dispensing pharmacist
   * @param clinicId - Clinic context
   * @returns Per item: batches consumed (lot, expiry, quantity) and any un-batched quantity
   */
  async dispenseFefo(
    prescriptionId: string,
    dto: DispenseFefoDto,
    userId: string,
    clinicId: string,
    tx?: PrismaTransactionClientWithDelegates,
    emitEvent = true
  ): Promise<FefoDispenseResult[]> {
    this.logger.info('FEFO dispense initiated', {
      module: 'Inventory',
      prescriptionId,
      clinicId,
      itemCount: dto.items.length,
    });

    const consume = async (
      client: PrismaTransactionClientWithDelegates
    ): Promise<FefoDispenseResult[]> => {
      const results: FefoDispenseResult[] = [];

      for (const item of dto.items) {
        if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
          throw new BadRequestException(
            `Dispense quantity for medicine ${item.medicineId} must be a positive whole number`
          );
        }

        await this.applyMedicineStockDelta(client, item.medicineId, clinicId, -item.quantity);

        const medicine = await client.medicine.findFirst({
          where: { id: item.medicineId, clinicId },
          select: { stock: true },
        });
        const stockBeforeDispense = (medicine?.stock ?? 0) + item.quantity;

        const batches: FefoBatchRow[] = await client.stockBatch.findMany({
          where: { productId: item.medicineId, clinicId, quantityOnHand: { gt: 0 } },
          orderBy: { expiryDate: 'asc' },
        });
        const now = Date.now();
        const trackedQuantity = batches.reduce((sum, b) => sum + (b.quantityOnHand ?? 0), 0);
        const unbatchedAvailable = Math.max(0, stockBeforeDispense - trackedQuantity);

        const consumedBatches: FefoDispenseResult['consumedBatches'] = [];
        let remaining = item.quantity;

        for (const batch of batches) {
          if (remaining <= 0) break;
          if (batch.expiryDate.getTime() <= now) continue;

          const take = Math.min(batch.quantityOnHand ?? 0, remaining);
          const updated = await client.stockBatch.updateMany({
            where: { id: batch.id, clinicId, quantityOnHand: { gte: take } },
            data: { quantityOnHand: { decrement: take } },
          });
          if (updated.count !== 1) {
            throw new HealthcareError(
              ErrorCode.PHARMACY_STOCK_INSUFFICIENT,
              `Batch ${batch.lotNumber} changed concurrently, retry the dispense`,
              { medicineId: item.medicineId, batchId: batch.id }
            );
          }

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

        if (remaining > unbatchedAvailable) {
          throw new HealthcareError(
            ErrorCode.PHARMACY_STOCK_INSUFFICIENT,
            `Insufficient stock for medicine ${item.medicineId}: short by ${remaining - unbatchedAvailable} units`,
            {
              medicineId: item.medicineId,
              shortage: remaining - unbatchedAvailable,
              requested: item.quantity,
            }
          );
        }

        results.push({
          prescriptionItemId: item.prescriptionItemId,
          medicineId: item.medicineId,
          consumedBatches,
          unbatchedQuantity: remaining,
          totalDispensed: item.quantity,
        });
      }

      return results;
    };

    const consumedResults = tx
      ? await consume(tx)
      : await this.db.prisma.$transaction(async transaction =>
          consume(transaction as unknown as PrismaTransactionClientWithDelegates)
        );

    for (const result of consumedResults) {
      await this.cache.del(`${INVENTORY_CACHE_PREFIX}:onhand:${clinicId}:${result.medicineId}`);
    }

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
   * Reverses (part of) a prescription dispense, restoring exactly what was
   * taken: every DISPENSE_OUT movement recorded for the prescription is netted
   * against RETURN_IN movements already booked, and the remainder is returned
   * to the same batches (newest dispense first). Units that were taken from
   * legacy un-batched stock go back to `Medicine.stock` only. Never restores
   * more batch units than were taken, so a repeated call cannot inflate stock.
   *
   * Must run inside the caller's transaction (`tx`).
   *
   * @returns Per medicine: batch restores and the un-batched quantity returned
   */
  async restoreDispense(
    prescriptionId: string,
    items: Array<{ medicineId: string; quantity: number }>,
    userId: string,
    clinicId: string,
    tx: PrismaTransactionClientWithDelegates
  ): Promise<
    Array<{
      medicineId: string;
      restoredBatches: Array<{ batchId: string; quantity: number }>;
      unbatchedQuantity: number;
    }>
  > {
    const results: Array<{
      medicineId: string;
      restoredBatches: Array<{ batchId: string; quantity: number }>;
      unbatchedQuantity: number;
    }> = [];

    for (const item of items) {
      if (item.quantity <= 0) continue;

      const movements: Array<{ batchId: string; quantity: number }> =
        await tx.stockMovement.findMany({
          where: {
            clinicId,
            productId: item.medicineId,
            referenceType: 'PRESCRIPTION',
            referenceId: prescriptionId,
            movementType: { in: [MovementType.DISPENSE_OUT, MovementType.RETURN_IN] },
          },
          orderBy: { createdAt: 'desc' },
        });

      const netTakenByBatch = new Map<string, number>();
      for (const movement of movements) {
        netTakenByBatch.set(
          movement.batchId,
          (netTakenByBatch.get(movement.batchId) ?? 0) - movement.quantity
        );
      }

      let remaining = item.quantity;
      const restoredBatches: Array<{ batchId: string; quantity: number }> = [];

      for (const [batchId, netTaken] of netTakenByBatch) {
        if (remaining <= 0) break;
        const restorable = Math.min(netTaken, remaining);
        if (restorable <= 0) continue;

        const updated = await tx.stockBatch.updateMany({
          where: { id: batchId, clinicId, productId: item.medicineId },
          data: { quantityOnHand: { increment: restorable } },
        });
        if (updated.count !== 1) {
          throw new HealthcareError(
            ErrorCode.PHARMACY_BATCH_NOT_FOUND,
            `Batch ${batchId} not found in clinic ${clinicId} while reversing the dispense`,
            { batchId, prescriptionId }
          );
        }

        await tx.stockMovement.create({
          data: {
            productId: item.medicineId,
            batchId,
            clinicId,
            movementType: MovementType.RETURN_IN,
            quantity: restorable,
            reason: `Dispense reversal for prescription ${prescriptionId}`,
            referenceId: prescriptionId,
            referenceType: 'PRESCRIPTION',
            recordedById: userId,
          },
        });

        restoredBatches.push({ batchId, quantity: restorable });
        remaining -= restorable;
      }

      await this.applyMedicineStockDelta(tx, item.medicineId, clinicId, item.quantity);
      await this.cache.del(`${INVENTORY_CACHE_PREFIX}:onhand:${clinicId}:${item.medicineId}`);

      results.push({
        medicineId: item.medicineId,
        restoredBatches,
        unbatchedQuantity: remaining,
      });
    }

    return results;
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
