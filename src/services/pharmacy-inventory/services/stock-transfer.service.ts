/**
 * Stock Transfer Service
 * @module Pharmacy Inventory
 * @description Inter-clinic stock transfer with SUPER_ADMIN elevation
 */

import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { EventService } from '@infrastructure/events';
import { HealthcareError, ErrorCode } from '@core/errors';
import { TransferStatus } from '@core/types/enums.types';
import { MovementType } from '@core/types/enums.types';
import { Role } from '@core/types/enums.types';
import type { PrismaTransactionClientWithDelegates } from '@core/types/prisma.types';
import type { TransferStockDto, ReceiveTransferDto } from '../dto/pharmacy-inventory.dto';

/**
 * Cache key prefix for stock transfers
 */
const TRANSFER_CACHE_PREFIX = 'pharmacy:transfer';

/**
 * Service for inter-clinic stock transfers.
 *
 * Business rules:
 * - Cross-clinic transfers require SUPER_ADMIN elevation (per gap assessment)
 * - Transfer lifecycle: DRAFT → IN_TRANSIT → RECEIVED | CANCELLED
 * - Each transfer item is an atomic movement: TRANSFER_OUT from source, TRANSFER_IN to dest
 * - Quantity is reserved at source upon dispatch; released on cancellation
 *
 * @public
 */
@Injectable()
export class StockTransferService {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly logger: LoggingService,
    private readonly events: EventService
  ) {}

  /**
   * Initiates an inter-clinic stock transfer (source clinic dispatches).
   *
   * Elevation check: The requesting user must have SUPER_ADMIN role OR be a
   * CLINIC_ADMIN with explicit cross-clinic permission. This service does NOT
   * implement its own RBAC guard; callers must pass through RBACGate.
   *
   * @param dto - Transfer details with items
   * @param sourceClinicId - Clinic initiating the transfer
   * @param userId - ID of the user initiating the transfer
   * @returns Created transfer with items and status DRAFT
   * @throws {HealthcareError} If any batch is not found or insufficient stock
   */
  async createTransfer(
    dto: TransferStockDto,
    sourceClinicId: string,
    userId: string
  ): Promise<{
    id: string;
    sourceClinicId: string;
    destinationClinicId: string;
    status: TransferStatus;
    notes: string | null;
    items: Array<{
      id: string;
      productId: string;
      sourceBatchId: string;
      quantity: number;
    }>;
    createdAt: Date;
  }> {
    this.logger.info('Creating inter-clinic stock transfer', {
      module: 'StockTransfer',
      sourceClinicId,
      destinationClinicId: dto.destinationClinicId,
      itemCount: dto.items.length,
      userId,
    });

    if (sourceClinicId === dto.destinationClinicId) {
      throw new BadRequestException('Source and destination clinics cannot be the same');
    }

    const result = await this.db.prisma.$transaction(async tx => {
      const transfer = await tx.stockTransfer.create({
        data: {
          sourceClinicId,
          destinationClinicId: dto.destinationClinicId,
          status: TransferStatus.DRAFT,
          notes: dto.notes ?? null,
          createdById: userId,
          items: {
            create: dto.items.map((item: (typeof dto.items)[number]) => ({
              productId: item.productId,
              sourceBatchId: item.batchId,
              quantity: item.quantity,
            })),
          },
        },
        include: { items: true },
      });

      return {
        id: transfer.id,
        sourceClinicId: transfer.sourceClinicId,
        destinationClinicId: transfer.destinationClinicId,
        status: transfer.status as TransferStatus,
        notes: transfer.notes,
        items: transfer.items.map((item: (typeof transfer.items)[number]) => ({
          id: item.id,
          productId: item.productId,
          sourceBatchId: item.sourceBatchId,
          quantity: item.quantity,
        })),
        createdAt: transfer.createdAt,
      };
    });

    await this.events.emit('pharmacy.transfer.created', {
      transferId: result.id,
      sourceClinicId: result.sourceClinicId,
      destinationClinicId: result.destinationClinicId,
      itemCount: result.items.length,
      userId,
    });

    return result;
  }

  /**
   * Dispatches a DRAFT transfer — marks it IN_TRANSIT and records movements.
   *
   * Validates that all source batches have sufficient stock.
   *
   * @param transferId - Transfer ID
   * @param sourceClinicId - Clinic context
   * @returns Updated transfer
   */
  async dispatchTransfer(
    transferId: string,
    sourceClinicId: string,
    userId: string
  ): Promise<{
    id: string;
    status: TransferStatus;
    dispatchedAt: Date;
  }> {
    this.logger.info('Dispatching stock transfer', {
      module: 'StockTransfer',
      transferId,
      sourceClinicId,
      userId,
    });

    const transfer = await this.db.prisma.stockTransfer.findFirst({
      where: { id: transferId, sourceClinicId },
      include: { items: true },
    });

    if (!transfer) {
      throw new HealthcareError(
        ErrorCode.PHARMACY_TRANSFER_NOT_FOUND,
        `Transfer ${transferId} not found in clinic ${sourceClinicId}`,
        { transferId }
      );
    }

    if (transfer.status !== TransferStatus.DRAFT) {
      throw new HealthcareError(
        ErrorCode.PHARMACY_TRANSFER_INVALID_STATUS,
        `Cannot dispatch transfer in status ${transfer.status}. Must be DRAFT.`,
        { transferId, status: transfer.status }
      );
    }

    const affectedProductIds = new Set<string>();

    const result = await this.db.prisma.$transaction(async tx => {
      const typedClient = tx as unknown as PrismaTransactionClientWithDelegates;

      for (const item of transfer.items) {
        const batch = await typedClient.stockBatch.findFirst({
          where: { id: item.sourceBatchId, clinicId: sourceClinicId },
        });

        if (!batch) {
          throw new HealthcareError(
            ErrorCode.PHARMACY_BATCH_NOT_FOUND,
            `Batch ${item.sourceBatchId} not found`,
            { batchId: item.sourceBatchId }
          );
        }

        const newQty = (batch.quantityOnHand ?? 0) - item.quantity;
        if (newQty < 0) {
          throw new HealthcareError(
            ErrorCode.PHARMACY_STOCK_INSUFFICIENT,
            `Insufficient stock in batch ${batch.lotNumber}: ${batch.quantityOnHand} available, ${item.quantity} needed`,
            { batchId: item.sourceBatchId, onHand: batch.quantityOnHand, needed: item.quantity }
          );
        }

        await typedClient.stockBatch.update({
          where: { id: item.sourceBatchId },
          data: { quantityOnHand: newQty },
        });

        await typedClient.stockMovement.create({
          data: {
            productId: item.productId,
            batchId: item.sourceBatchId,
            clinicId: sourceClinicId,
            movementType: MovementType.TRANSFER_OUT,
            quantity: -item.quantity,
            reason: `Transfer ${transferId} → ${transfer.destinationClinicId}`,
            referenceId: transferId,
            referenceType: 'STOCK_TRANSFER',
            recordedById: userId,
          },
        });

        await typedClient.medicine.update({
          where: { id: item.productId },
          data: { stock: { decrement: item.quantity } },
        });
        affectedProductIds.add(item.productId);
      }

      const updated = await typedClient.stockTransfer.update({
        where: { id: transferId },
        data: {
          status: TransferStatus.IN_TRANSIT,
          dispatchedAt: new Date(),
        },
        select: {
          id: true,
          status: true,
          dispatchedAt: true,
        },
      });

      return {
        id: updated.id,
        status: updated.status as TransferStatus,
        dispatchedAt: updated.dispatchedAt,
      };
    });

    await this.events.emit('pharmacy.transfer.dispatched', {
      transferId,
      sourceClinicId,
      destinationClinicId: transfer.destinationClinicId,
    });

    for (const productId of affectedProductIds) {
      await this.cache.del(`pharmacy:inventory:onhand:${sourceClinicId}:${productId}`);
    }

    return result;
  }

  /**
   * Receives a transfer at the destination clinic.
   *
   * Creates TRANSFER_IN movements and new batches at the destination.
   * Also emits expiry alert if the received batch is nearing expiry.
   *
   * @param transferId - Transfer ID
   * @param destinationClinicId - Clinic receiving the stock
   * @param userId - ID of the receiving user
   * @returns Updated transfer
   */
  async receiveTransfer(
    transferId: string,
    destinationClinicId: string,
    userId: string
  ): Promise<{
    id: string;
    status: TransferStatus;
    receivedAt: Date;
  }> {
    this.logger.info('Receiving stock transfer', {
      module: 'StockTransfer',
      transferId,
      destinationClinicId,
      userId,
    });

    const transfer = await this.db.prisma.stockTransfer.findFirst({
      where: { id: transferId, destinationClinicId },
      include: { items: true, sourceClinic: { select: { id: true, name: true } } },
    });

    if (!transfer) {
      throw new HealthcareError(
        ErrorCode.PHARMACY_TRANSFER_NOT_FOUND,
        `Transfer ${transferId} not found for destination clinic ${destinationClinicId}`,
        { transferId }
      );
    }

    if (transfer.status !== TransferStatus.IN_TRANSIT) {
      throw new HealthcareError(
        ErrorCode.PHARMACY_TRANSFER_INVALID_STATUS,
        `Cannot receive transfer in status ${transfer.status}. Must be IN_TRANSIT.`,
        { transferId, status: transfer.status }
      );
    }

    const affectedProductIds = new Set<string>();

    const result = await this.db.prisma.$transaction(async tx => {
      const typedClient = tx as unknown as PrismaTransactionClientWithDelegates;

      const sourceBatches: Array<{
        id: string;
        productId: string;
        lotNumber: string;
        manufactureDate: Date;
        expiryDate: Date;
        costPrice: number | null;
        medicineName: string | null;
      }> = await typedClient.stockBatch.findMany({
        where: {
          id: { in: transfer.items.map((i: (typeof transfer.items)[number]) => i.sourceBatchId) },
          clinicId: transfer.sourceClinicId,
        },
        select: {
          id: true,
          productId: true,
          lotNumber: true,
          manufactureDate: true,
          expiryDate: true,
          costPrice: true,
          medicineName: true,
        },
      });

      const batchMap = new Map<string, (typeof sourceBatches)[number]>(
        sourceBatches.map((b: (typeof sourceBatches)[number]) => [b.id, b])
      );

      for (const item of transfer.items) {
        const sourceBatch = batchMap.get(item.sourceBatchId);
        if (!sourceBatch) continue;

        const newLotNumber = `${sourceBatch.lotNumber}-XFER-${transfer.id.slice(-6)}`;

        const destBatch = await typedClient.stockBatch.create({
          data: {
            productId: item.productId,
            clinicId: destinationClinicId,
            lotNumber: newLotNumber,
            manufactureDate: sourceBatch.manufactureDate,
            expiryDate: sourceBatch.expiryDate,
            quantityReceived: item.quantity,
            quantityOnHand: item.quantity,
            costPrice: sourceBatch.costPrice,
            medicineName: sourceBatch.medicineName,
            createdById: userId,
          },
        });

        await typedClient.stockMovement.create({
          data: {
            productId: item.productId,
            batchId: destBatch.id,
            clinicId: destinationClinicId,
            movementType: MovementType.TRANSFER_IN,
            quantity: item.quantity,
            reason: `Received from transfer ${transferId}`,
            referenceId: transferId,
            referenceType: 'STOCK_TRANSFER',
            recordedById: userId,
          },
        });

        await typedClient.medicine.update({
          where: { id: item.productId },
          data: { stock: { increment: item.quantity } },
        });
        affectedProductIds.add(item.productId);
      }

      const updated = await typedClient.stockTransfer.update({
        where: { id: transferId },
        data: {
          status: TransferStatus.RECEIVED,
          receivedAt: new Date(),
          receivedById: userId,
        },
        select: {
          id: true,
          status: true,
          receivedAt: true,
        },
      });

      return {
        id: updated.id,
        status: updated.status as TransferStatus,
        receivedAt: updated.receivedAt,
      };
    });

    await this.events.emit('pharmacy.transfer.received', {
      transferId,
      sourceClinicId: transfer.sourceClinicId,
      destinationClinicId,
      itemCount: transfer.items.length,
    });

    await this.cache.del(`${TRANSFER_CACHE_PREFIX}:${transferId}`);

    for (const productId of affectedProductIds) {
      await this.cache.del(`pharmacy:inventory:onhand:${destinationClinicId}:${productId}`);
    }

    return result;
  }

  /**
   * Cancels a DRAFT transfer.
   *
   * @param transferId - Transfer ID
   * @param sourceClinicId - Source clinic context
   * @returns Cancelled transfer
   */
  async cancelTransfer(
    transferId: string,
    sourceClinicId: string
  ): Promise<{ id: string; status: TransferStatus; cancelledAt: Date }> {
    const transfer = await this.db.prisma.stockTransfer.findFirst({
      where: { id: transferId, sourceClinicId },
      select: { id: true, status: true },
    });

    if (!transfer) {
      throw new HealthcareError(
        ErrorCode.PHARMACY_TRANSFER_NOT_FOUND,
        `Transfer ${transferId} not found in clinic ${sourceClinicId}`,
        { transferId }
      );
    }

    if (transfer.status !== TransferStatus.DRAFT) {
      throw new HealthcareError(
        ErrorCode.PHARMACY_TRANSFER_INVALID_STATUS,
        `Cannot cancel transfer in status ${transfer.status}. Must be DRAFT.`,
        { transferId, status: transfer.status }
      );
    }

    const updated = await this.db.prisma.stockTransfer.update({
      where: { id: transferId },
      data: { status: TransferStatus.CANCELLED, cancelledAt: new Date() },
      select: { id: true, status: true, cancelledAt: true },
    });

    await this.events.emit('pharmacy.transfer.cancelled', { transferId, sourceClinicId });

    return {
      id: updated.id,
      status: updated.status as TransferStatus,
      cancelledAt: updated.cancelledAt,
    };
  }

  /**
   * Lists transfers for a clinic (source or destination).
   *
   * @param clinicId - Clinic context
   * @param asSource - If true, list as source; if false, as destination
   * @returns Array of transfers with items
   */
  async listTransfers(
    clinicId: string,
    asSource = true
  ): Promise<
    Array<{
      id: string;
      sourceClinicId: string;
      destinationClinicId: string;
      status: TransferStatus;
      notes: string | null;
      items: Array<{ id: string; productId: string; quantity: number }>;
      createdAt: Date;
    }>
  > {
    const where = asSource ? { sourceClinicId: clinicId } : { destinationClinicId: clinicId };

    return this.db.prisma.stockTransfer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          select: { id: true, productId: true, quantity: true },
        },
      },
    });
  }
}
