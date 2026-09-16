/**
 * Expiry Alert Service
 * @module Pharmacy Inventory
 * @description Scans batches for expiry alerts (90/60/30 day thresholds)
 *              and manages alert lifecycle
 */

import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { EventService } from '@infrastructure/events';
import { HealthcareError, ErrorCode } from '@core/errors';
import { AlertType } from '@core/types/enums.types';
import { MovementType } from '@core/types/enums.types';
import type { PrismaTransactionClientWithDelegates } from '@core/types/prisma.types';

/**
 * Cache key prefix for expiry alerts
 */
const ALERT_CACHE_PREFIX = 'pharmacy:alerts';

/**
 * Cache TTL in seconds (10 minutes for alert queries)
 */
const ALERT_CACHE_TTL = 600;

/**
 * Expiry threshold days mapped to alert types
 */
const EXPIRY_THRESHOLDS: Record<string, { alertType: AlertType; days: number }> = {
  CRITICAL: { alertType: AlertType.EXPIRY_CRITICAL, days: 30 },
  WARNING: { alertType: AlertType.EXPIRY_WARNING, days: 90 },
};

/**
 * Service for pharmacy inventory expiry scanning and alert management.
 *
 * Responsibilities:
 * - Daily scan of batches expiring within configurable windows (30/60/90 days)
 * - Idempotent alert generation (does not duplicate within threshold window)
 * - Expiry write-off: auto-mark expired batches with EXPIRED_WRITE_OFF movement
 * - Alert resolution tracking
 *
 * @public
 */
@Injectable()
export class ExpiryAlertService {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly logger: LoggingService,
    private readonly events: EventService
  ) {}

  /**
   * Scans all batches in a clinic for those expiring within a given number of days.
   *
   * This is the primary alerting endpoint. Called by the daily cron job
   * (`pharmacy.expiry.scan`) and by ad-hoc UI queries.
   *
   * @param clinicId - Clinic context
   * @param withinDays - Number of days from now to scan (default 90)
   * @returns Batches expiring within the window with days-remaining info
   */
  async scanExpiringBatches(
    clinicId: string,
    withinDays = 90
  ): Promise<
    Array<{
      batchId: string;
      productId: string;
      lotNumber: string;
      expiryDate: Date;
      quantityOnHand: number;
      daysRemaining: number;
      alertType: AlertType;
    }>
  > {
    this.logger.info('Scanning expiring batches', {
      module: 'ExpiryAlert',
      clinicId,
      withinDays,
    });

    const cutoffDate = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);

    const batches = await this.db.prisma.stockBatch.findMany({
      where: {
        clinicId,
        quantityOnHand: { gt: 0 },
        expiryDate: { gt: new Date(), lte: cutoffDate },
      },
      orderBy: { expiryDate: 'asc' },
      select: {
        id: true,
        productId: true,
        lotNumber: true,
        expiryDate: true,
        quantityOnHand: true,
      },
    });

    const now = new Date();

    return batches.map((batch: (typeof batches)[number]) => {
      const daysRemaining = Math.ceil(
        (batch.expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
      const alertType = daysRemaining <= 30 ? AlertType.EXPIRY_CRITICAL : AlertType.EXPIRY_WARNING;

      return {
        batchId: batch.id,
        productId: batch.productId,
        lotNumber: batch.lotNumber,
        expiryDate: batch.expiryDate,
        quantityOnHand: batch.quantityOnHand,
        daysRemaining,
        alertType,
      };
    });
  }

  /**
   * Generates alerts for batches passing expiry thresholds.
   *
   * Uses idempotent insertion: does not create duplicate alerts for the
   * same batch+alertType within a 24-hour window.
   *
   * @param clinicId - Clinic context
   * @returns Count of new alerts created
   */
  async generateExpiryAlerts(clinicId: string): Promise<{ alertsCreated: number }> {
    const expiringBatches = await this.scanExpiringBatches(clinicId, 90);
    let alertsCreated = 0;

    for (const batch of expiringBatches) {
      const lastAlert = await this.db.prisma.stockAlert.findFirst({
        where: {
          clinicId,
          productId: batch.productId,
          alertType: batch.alertType,
          resolvedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });

      if (lastAlert && Date.now() - lastAlert.createdAt.getTime() < 24 * 60 * 60 * 1000) {
        continue;
      }

      await this.db.prisma.stockAlert.create({
        data: {
          clinicId,
          productId: batch.productId,
          alertType: batch.alertType,
          batchId: batch.batchId,
          message: `Batch ${batch.lotNumber} expires in ${batch.daysRemaining} day(s) (${batch.expiryDate.toISOString().split('T')[0]}). Qty on hand: ${batch.quantityOnHand}.`,
        },
      });

      alertsCreated++;
    }

    if (alertsCreated > 0) {
      this.logger.info('Expiry alerts generated', {
        module: 'ExpiryAlert',
        clinicId,
        alertsCreated,
      });
      await this.events.emit('pharmacy.alerts.expiry', {
        clinicId,
        alertsCreated,
        batchCount: expiringBatches.length,
      });
    }

    return { alertsCreated };
  }

  /**
   * Writes off already-expired batches by recording EXPIRED_WRITE_OFF movements.
   *
   * Sets quantityOnHand to 0 for each expired batch with remaining stock.
   *
   * @param clinicId - Clinic context
   * @param userId - ID of the user performing the write-off (typically SUPER_ADMIN)
   * @returns Number of batches written off
   */
  async writeOffExpired(clinicId: string, userId: string): Promise<{ writtenOff: number }> {
    this.logger.info('Writing off expired batches', {
      module: 'ExpiryAlert',
      clinicId,
      userId,
    });

    const expiredBatches = await this.db.prisma.stockBatch.findMany({
      where: {
        clinicId,
        quantityOnHand: { gt: 0 },
        expiryDate: { lte: new Date() },
      },
    });

    let writtenOff = 0;
    const affectedProductIds = new Set<string>();

    for (const batch of expiredBatches) {
      await this.db.prisma.$transaction(async tx => {
        const typedClient = tx as unknown as PrismaTransactionClientWithDelegates;

        await typedClient.stockMovement.create({
          data: {
            productId: batch.productId,
            batchId: batch.id,
            clinicId,
            movementType: MovementType.EXPIRED_WRITE_OFF,
            quantity: -(batch.quantityOnHand ?? 0),
            reason: `Batch expired on ${batch.expiryDate.toISOString().split('T')[0]}`,
            referenceType: 'EXPIRED_WRITE_OFF',
            recordedById: userId,
          },
        });

        await typedClient.stockBatch.update({
          where: { id: batch.id },
          data: { quantityOnHand: 0 },
        });

        await typedClient.medicine.update({
          where: { id: batch.productId },
          data: { stock: { decrement: batch.quantityOnHand ?? 0 } },
        });
      });

      writtenOff++;
      affectedProductIds.add(batch.productId);
    }

    if (writtenOff > 0) {
      for (const productId of affectedProductIds) {
        await this.cache.del(`pharmacy:inventory:onhand:${clinicId}:${productId}`);
      }

      await this.events.emit('pharmacy.expired.writtenOff', { clinicId, writtenOff, userId });
      this.logger.warn('Expired batches written off', {
        module: 'ExpiryAlert',
        clinicId,
        writtenOff,
      });
    }

    return { writtenOff };
  }

  /**
   * Lists active (unresolved) expiry alerts for a clinic.
   *
   * @param clinicId - Clinic context
   * @param filters - Optional filters (alertTypes, criticalOnly)
   * @returns Array of alerts with batch and product info
   */
  async listAlerts(
    clinicId: string,
    filters: { alertTypes?: AlertType[]; criticalOnly?: boolean } = {}
  ): Promise<
    Array<{
      id: string;
      clinicId: string;
      productId: string;
      alertType: AlertType;
      message: string;
      batchId: string | null;
      resolvedAt: Date | null;
      createdAt: Date;
    }>
  > {
    const { alertTypes, criticalOnly } = filters;

    const where: {
      clinicId: string;
      resolvedAt: null;
      alertType?: AlertType | { in: AlertType[] };
    } = { clinicId, resolvedAt: null };

    if (criticalOnly) {
      where.alertType = AlertType.EXPIRY_CRITICAL;
    } else if (alertTypes && alertTypes.length > 0) {
      where.alertType = { in: alertTypes };
    }

    return this.db.prisma.stockAlert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        clinicId: true,
        productId: true,
        alertType: true,
        message: true,
        batchId: true,
        resolvedAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * Resolves an alert by ID within clinic scope.
   *
   * @param alertId - Alert ID
   * @param clinicId - Clinic context
   * @returns Updated alert
   * @throws {HealthcareError} If alert not found in clinic scope
   */
  async resolveAlert(alertId: string, clinicId: string): Promise<{ id: string; resolvedAt: Date }> {
    const alert = await this.db.prisma.stockAlert.findFirst({
      where: { id: alertId, clinicId },
      select: { id: true, resolvedAt: true },
    });

    if (!alert) {
      throw new HealthcareError(
        ErrorCode.PHARMACY_ALERT_NOT_FOUND,
        `Alert ${alertId} not found in clinic ${clinicId}`,
        { alertId }
      );
    }

    if (alert.resolvedAt) {
      return { id: alert.id, resolvedAt: alert.resolvedAt };
    }

    const updated = await this.db.prisma.stockAlert.update({
      where: { id: alertId },
      data: { resolvedAt: new Date() },
      select: { id: true, resolvedAt: true },
    });

    await this.cache.del(`${ALERT_CACHE_PREFIX}:active:${clinicId}`);
    return updated;
  }
}
