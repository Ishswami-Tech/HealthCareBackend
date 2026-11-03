/**
 * Batch Actions Service (expiry screen)
 * @module ClinicOps
 * @description Return an expiring / expired batch (or part of it) to the supplier, or discard it,
 * with a mandatory reason, and read the batch audit trail (every movement on the batch).
 */

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InventoryService } from '@services/pharmacy-inventory/services/inventory.service';
import { MovementType } from '@core/types/enums.types';
import { OpsDbService, type OpsActor } from './ops-db.service';
import { ClinicAuditService } from './audit.service';
import { assertSupplierInClinic } from './clinic-scope.util';
import { displayName } from '../clinic-ops.types';
import type { BatchActionDto } from '../dto/clinic-ops.dto';

export interface BatchActionResponse {
  batchId: string;
  action: 'RETURN_TO_SUPPLIER' | 'DISCARD';
  quantity: number;
  remainingQuantity: number;
  reason: string;
  movementId: string;
  at: string;
}

export interface BatchAuditEntry {
  id: string;
  at: string;
  movementType: string;
  quantity: number;
  reason: string | null;
  referenceType: string | null;
  recordedById: string;
  recordedByName: string;
}

@Injectable()
export class BatchActionsService {
  constructor(
    private readonly ops: OpsDbService,
    private readonly inventory: InventoryService,
    private readonly audit: ClinicAuditService
  ) {}

  returnToSupplier(
    batchId: string,
    dto: BatchActionDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<BatchActionResponse> {
    return this.act('RETURN_TO_SUPPLIER', batchId, dto, clinicId, actor);
  }

  discard(
    batchId: string,
    dto: BatchActionDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<BatchActionResponse> {
    return this.act('DISCARD', batchId, dto, clinicId, actor);
  }

  async trail(batchId: string, clinicId: string): Promise<BatchAuditEntry[]> {
    const batch = await this.ops.read(client =>
      client.stockBatch.findFirst({ where: { id: batchId, clinicId } })
    );
    if (!batch) throw new NotFoundException('Batch not found');
    const movements = await this.ops.read(client =>
      client.stockMovement.findMany({
        where: { batchId, clinicId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      })
    );
    const ids = [...new Set(movements.map(m => m.recordedById))];
    const users = ids.length
      ? await this.ops.read(client =>
          client.user.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true, firstName: true, lastName: true },
          })
        )
      : [];
    const names = new Map(users.map(u => [u.id, displayName(u)]));
    return movements.map(m => ({
      id: m.id,
      at: m.createdAt.toISOString(),
      movementType: m.movementType,
      quantity: m.quantity,
      reason: m.reason,
      referenceType: m.referenceType,
      recordedById: m.recordedById,
      recordedByName: names.get(m.recordedById) ?? 'Unknown',
    }));
  }

  private async act(
    action: BatchActionResponse['action'],
    batchId: string,
    dto: BatchActionDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<BatchActionResponse> {
    const batch = await this.ops.read(client =>
      client.stockBatch.findFirst({ where: { id: batchId, clinicId } })
    );
    if (!batch) throw new NotFoundException('Batch not found');
    if (!Number.isInteger(dto.quantity) || dto.quantity < 1) {
      throw new BadRequestException('quantity must be a positive whole number');
    }
    if (dto.quantity > batch.quantityOnHand) {
      throw new BadRequestException(`Only ${batch.quantityOnHand} left in this batch`);
    }
    const { supplierId } = dto;
    if (supplierId) {
      await this.ops.read(client => assertSupplierInClinic(client, supplierId, clinicId));
    }
    const movement = await this.inventory.recordMovement(
      {
        productId: batch.productId,
        batchId,
        movementType:
          action === 'RETURN_TO_SUPPLIER'
            ? MovementType.RETURN_TO_SUPPLIER
            : MovementType.DISCARD_WRITE_OFF,
        quantity: -dto.quantity,
        reason: dto.reason.trim(),
        ...(action === 'RETURN_TO_SUPPLIER' && dto.supplierId
          ? { referenceId: dto.supplierId, referenceType: 'SUPPLIER_RETURN' }
          : { referenceType: action === 'DISCARD' ? 'DISCARD' : 'SUPPLIER_RETURN' }),
      } as Parameters<InventoryService['recordMovement']>[0],
      actor.userId,
      clinicId
    );
    await this.audit.record(clinicId, { type: 'STOCK_BATCH', id: batchId }, action, actor, {
      quantity: dto.quantity,
      reason: dto.reason,
      lotNumber: batch.lotNumber,
      supplierId: dto.supplierId ?? null,
    });
    return {
      batchId,
      action,
      quantity: dto.quantity,
      remainingQuantity: batch.quantityOnHand - dto.quantity,
      reason: dto.reason.trim(),
      movementId: movement.id,
      at: movement.createdAt.toISOString(),
    };
  }
}
