/**
 * Batch Service
 * @module Pharmacy Inventory
 * @description Stock batch/lot tracking, FEFO batch selection, expiry filtering
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { EventService } from '@infrastructure/events';
import { HealthcareError, ErrorCode } from '@core/errors';
import { HealthcareErrorsService } from '@core/errors/healthcare-errors.service';
import type { PrismaTransactionClientWithDelegates } from '@core/types/prisma.types';
import type { CreateStockBatchDto, BatchFilterDto } from '../dto/pharmacy-inventory.dto';

/**
 * Cache key prefix for batch queries
 */
const BATCH_CACHE_PREFIX = 'pharmacy:batch';

/**
 * Cache TTL in seconds (5 minutes)
 */
const CACHE_TTL = 300;

/**
 * Maximum characters for lot numbers
 */
const MAX_LOT_NUMBER_LENGTH = 100;

/**
 * Service for pharmacy stock batch/lot tracking.
 *
 * Responsibilities:
 * - Receive new stock batches with expiry dates
 * - FEFO (First Expiry, First Out) batch selection
 * - Batch filtering by product and expiry window
 * - Batch status updates (active/expired/depleted)
 *
 * @public
 */
@Injectable()
export class BatchService {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly logger: LoggingService,
    private readonly events: EventService,
    private readonly errorsService: HealthcareErrorsService
  ) {}

  /**
   * Creates a new stock batch when receiving inventory.
   *
   * Validates expiry date is in the future and lot number is unique per product+clinic.
   *
   * @param dto - Batch creation data
   * @param userId - ID of the user receiving the stock
   * @param clinicId - Clinic context
   * @returns The created batch
   * @throws {BadRequestException} If expiry date is in the past or lot number duplicate
   */
  async createBatch(
    dto: CreateStockBatchDto,
    userId: string,
    clinicId: string
  ): Promise<{
    id: string;
    productId: string;
    lotNumber: string;
    manufactureDate: Date;
    expiryDate: Date;
    quantityOnHand: number;
    costPrice: number | null;
    medicineName: string | null;
    createdAt: Date;
  }> {
    this.logger.info('Creating stock batch', {
      module: 'Batch',
      productId: dto.productId,
      lotNumber: dto.lotNumber,
      clinicId,
    });

    const now = new Date();
    const manufactureDate = new Date(dto.manufactureDate);
    const expiryDate = new Date(dto.expiryDate);

    if (manufactureDate > now) {
      throw this.errorsService.pharmacyManufactureDateInvalid('BatchService.createBatch');
    }

    if (expiryDate <= now) {
      throw this.errorsService.pharmacyExpiryDateInvalid('BatchService.createBatch');
    }

    const existing = await this.db.prisma.stockBatch.findFirst({
      where: {
        productId: dto.productId,
        clinicId,
        lotNumber: dto.lotNumber,
      },
      select: { id: true },
    });

    if (existing) {
      throw this.errorsService.pharmacyLotNumberDuplicate(
        dto.lotNumber,
        'BatchService.createBatch'
      );
    }

    const batch = await this.db.prisma.$transaction(async tx => {
      const typedClient = tx as unknown as PrismaTransactionClientWithDelegates;

      const medicine = await typedClient.medicine.findFirst({
        where: { id: dto.productId, clinicId },
        select: { id: true },
      });

      if (!medicine) {
        throw new NotFoundException(
          `Medicine ${dto.productId} not found in clinic ${clinicId} while creating a batch`
        );
      }

      const created = await typedClient.stockBatch.create({
        data: {
          productId: dto.productId,
          clinicId,
          lotNumber: dto.lotNumber,
          manufactureDate,
          expiryDate,
          quantityReceived: dto.quantity,
          quantityOnHand: dto.quantity,
          costPrice: dto.costPrice ?? null,
          medicineName: dto.medicineName ?? null,
          createdById: userId,
        },
        select: {
          id: true,
          productId: true,
          lotNumber: true,
          manufactureDate: true,
          expiryDate: true,
          quantityOnHand: true,
          costPrice: true,
          medicineName: true,
          createdAt: true,
        },
      });

      await typedClient.medicine.update({
        where: { id: medicine.id },
        data: { stock: { increment: dto.quantity } },
      });

      return created;
    });

    await this.events.emit('pharmacy.batch.created', {
      batchId: batch.id,
      productId: batch.productId,
      clinicId,
      lotNumber: batch.lotNumber,
      expiryDate: batch.expiryDate.toISOString(),
    });
    await this.cache.del(`pharmacy:inventory:onhand:${clinicId}:${batch.productId}`);

    return batch;
  }

  /**
   * Lists batches with filtering by product and expiry window.
   *
   * @param clinicId - Clinic context
   * @param filters - Optional filters
   * @returns Array of batches with aggregated info
   */
  async listBatches(
    clinicId: string,
    filters: BatchFilterDto = {}
  ): Promise<
    Array<{
      id: string;
      productId: string;
      lotNumber: string;
      manufactureDate: Date;
      expiryDate: Date;
      quantityOnHand: number;
      quantityReceived: number;
      costPrice: number | null;
      medicineName: string | null;
      createdAt: Date;
    }>
  > {
    const { productId, expiringWithinDays, includeZeroStock } = filters;

    const where: {
      clinicId: string;
      productId?: string;
      expiryDate?: { lte?: Date; gt?: Date };
      quantityOnHand?: { gt?: number };
    } = { clinicId };

    if (productId) {
      where.productId = productId;
    }

    if (expiringWithinDays && expiringWithinDays > 0) {
      where.expiryDate = {
        lte: new Date(Date.now() + expiringWithinDays * 24 * 60 * 60 * 1000),
        gt: new Date(),
      };
    }

    if (!includeZeroStock) {
      where.quantityOnHand = { gt: 0 };
    }

    return this.db.prisma.stockBatch.findMany({
      where,
      orderBy: { expiryDate: 'asc' },
      select: {
        id: true,
        productId: true,
        lotNumber: true,
        manufactureDate: true,
        expiryDate: true,
        quantityOnHand: true,
        quantityReceived: true,
        costPrice: true,
        medicineName: true,
        createdAt: true,
      },
    });
  }

  /**
   * Retrieves a single batch by ID within clinic scope.
   *
   * @param batchId - Batch ID
   * @param clinicId - Clinic context
   * @returns Batch details
   * @throws {NotFoundException} If batch not found in clinic scope
   */
  async getBatchById(
    batchId: string,
    clinicId: string
  ): Promise<{
    id: string;
    productId: string;
    lotNumber: string;
    manufactureDate: Date;
    expiryDate: Date;
    quantityOnHand: number;
    quantityReceived: number;
    costPrice: number | null;
    medicineName: string | null;
    createdAt: Date;
  }> {
    const batch = await this.db.prisma.stockBatch.findFirst({
      where: { id: batchId, clinicId },
    });

    if (!batch) {
      throw this.errorsService.pharmacyBatchNotFound(batchId, 'BatchService.getBatchById');
    }

    return batch;
  }

  /**
   * Retrieves batches eligible for FEFO dispense for a product.
   *
   * Returns only non-expired batches with available stock, ordered
   * by expiry date ascending (earliest expiry first).
   *
   * @param productId - Medicine/product ID
   * @param clinicId - Clinic context
   * @param requestedQuantity - Minimum stock required (used for readiness check)
   * @returns Array of FEFO-eligible batches with availability info
   */
  async getFefoCandidates(
    productId: string,
    clinicId: string,
    requestedQuantity?: number
  ): Promise<
    Array<{
      id: string;
      lotNumber: string;
      expiryDate: Date;
      quantityOnHand: number;
      costPrice: number | null;
      daysToExpiry: number;
    }>
  > {
    const now = new Date();

    const batches = await this.db.prisma.stockBatch.findMany({
      where: {
        productId,
        clinicId,
        quantityOnHand: { gt: 0 },
        expiryDate: { gt: now },
      },
      orderBy: { expiryDate: 'asc' },
      select: {
        id: true,
        lotNumber: true,
        expiryDate: true,
        quantityOnHand: true,
        costPrice: true,
      },
    });

    return batches.map((b: (typeof batches)[number]) => ({
      id: b.id,
      lotNumber: b.lotNumber,
      expiryDate: b.expiryDate,
      quantityOnHand: b.quantityOnHand,
      costPrice: b.costPrice,
      daysToExpiry: Math.ceil((b.expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
    }));
  }

  /**
   * Returns the total number of batches for a clinic, optionally filtered.
   *
   * @param clinicId - Clinic context
   * @param productId - Optional product filter
   * @returns Batch count and product breakdown
   */
  async getBatchCount(
    clinicId: string,
    productId?: string
  ): Promise<{ totalBatches: number; totalProducts: number; totalUnits: number }> {
    const where: { clinicId: string; productId?: string } = { clinicId };
    if (productId) {
      where.productId = productId;
    }

    const batches = await this.db.prisma.stockBatch.findMany({
      where,
      select: { quantityOnHand: true, productId: true },
    });

    const totalUnits = batches.reduce(
      (sum: number, b: (typeof batches)[number]) => sum + (b.quantityOnHand ?? 0),
      0
    );
    const uniqueProducts = new Set(batches.map((b: (typeof batches)[number]) => b.productId));

    return {
      totalBatches: batches.length,
      totalProducts: uniqueProducts.size,
      totalUnits,
    };
  }
}
