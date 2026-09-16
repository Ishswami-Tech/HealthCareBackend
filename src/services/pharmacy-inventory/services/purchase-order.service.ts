/**
 * Purchase Order Service
 * @module Pharmacy Inventory
 * @description Purchase order creation, status tracking, and supplier routing
 */

import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { EventService } from '@infrastructure/events';
import { HealthcareError, ErrorCode } from '@core/errors';
import type { CreatePurchaseOrderDto } from '../dto/pharmacy-inventory.dto';

/**
 * Cache key prefix for purchase orders
 */
const PO_CACHE_PREFIX = 'pharmacy:po';

/**
 * Purchase order status lifecycle: DRAFT → SENT → PARTIALLY_RECEIVED → RECEIVED | CANCELLED
 */
export type PurchaseOrderStatus =
  'DRAFT' | 'SENT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';

/**
 * Service for pharmacy purchase order management.
 *
 * Responsibilities:
 * - Create purchase orders from reorder suggestions
 * - Track PO status through the supplier workflow
 * - Record received quantities against PO line items
 * - Supplier-level PO history
 *
 * @public
 */
@Injectable()
export class PurchaseOrderService {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly logger: LoggingService,
    private readonly events: EventService
  ) {}

  /**
   * Creates a purchase order to a supplier.
   *
   * @param dto - PO creation data
   * @param userId - ID of the user creating the PO
   * @param clinicId - Clinic context
   * @returns Created PO with items
   */
  async createPurchaseOrder(
    dto: CreatePurchaseOrderDto,
    userId: string,
    clinicId: string
  ): Promise<{
    id: string;
    supplierId: string;
    clinicId: string;
    status: PurchaseOrderStatus;
    notes: string | null;
    expectedDeliveryDate: Date | null;
    items: Array<{
      id: string;
      productId: string;
      quantity: number;
      unitPrice: number | null;
      description: string | null;
    }>;
    createdAt: Date;
  }> {
    this.logger.info('Creating purchase order', {
      module: 'PurchaseOrder',
      supplierId: dto.supplierId,
      clinicId,
      itemCount: dto.items.length,
    });

    const po = await this.db.prisma.purchaseOrder.create({
      data: {
        supplierId: dto.supplierId,
        clinicId,
        status: 'DRAFT',
        notes: dto.notes ?? null,
        expectedDeliveryDate: dto.expectedDeliveryDate ? new Date(dto.expectedDeliveryDate) : null,
        createdById: userId,
        items: {
          create: dto.items.map((item: (typeof dto.items)[number]) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice ?? null,
            description: item.description ?? null,
          })),
        },
      },
      include: { items: true },
    });

    await this.events.emit('pharmacy.purchaseOrder.created', {
      poId: po.id,
      supplierId: po.supplierId,
      clinicId,
      itemCount: po.items.length,
      expectedDelivery: po.expectedDeliveryDate,
    });

    return {
      id: po.id,
      supplierId: po.supplierId,
      clinicId: po.clinicId,
      status: po.status as PurchaseOrderStatus,
      notes: po.notes,
      expectedDeliveryDate: po.expectedDeliveryDate,
      items: po.items.map((item: (typeof po.items)[number]) => ({
        id: item.id,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        description: item.description,
      })),
      createdAt: po.createdAt,
    };
  }

  /**
   * Sends a DRAFT purchase order to the supplier.
   *
   * @param poId - Purchase order ID
   * @param clinicId - Clinic context
   * @returns Updated PO
   */
  async sendPurchaseOrder(
    poId: string,
    clinicId: string
  ): Promise<{ id: string; status: PurchaseOrderStatus; sentAt: Date }> {
    const po = await this.db.prisma.purchaseOrder.findFirst({
      where: { id: poId, clinicId },
      select: { id: true, status: true },
    });

    if (!po) {
      throw new HealthcareError(
        ErrorCode.PHARMACY_PURCHASE_ORDER_NOT_FOUND,
        `Purchase order ${poId} not found in clinic ${clinicId}`,
        { poId }
      );
    }

    if (po.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot send PO in status ${po.status}. Must be DRAFT.`);
    }

    const updated = await this.db.prisma.purchaseOrder.update({
      where: { id: poId },
      data: { status: 'SENT', sentAt: new Date() },
      select: { id: true, status: true, sentAt: true },
    });

    await this.events.emit('pharmacy.purchaseOrder.sent', { poId, clinicId });

    return {
      id: updated.id,
      status: updated.status as PurchaseOrderStatus,
      sentAt: updated.sentAt,
    };
  }

  /**
   * Lists purchase orders for a clinic with optional status filter.
   *
   * @param clinicId - Clinic context
   * @param status - Optional status filter
   * @returns Array of POs with items
   */
  async listPurchaseOrders(
    clinicId: string,
    status?: PurchaseOrderStatus
  ): Promise<
    Array<{
      id: string;
      supplierId: string;
      clinicId: string;
      status: PurchaseOrderStatus;
      notes: string | null;
      expectedDeliveryDate: Date | null;
      sentAt: Date | null;
      items: Array<{ id: string; productId: string; quantity: number; receivedQuantity: number }>;
      createdAt: Date;
    }>
  > {
    const where: { clinicId: string; status?: string } = { clinicId };
    if (status) {
      where.status = status;
    }

    return this.db.prisma.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          select: {
            id: true,
            productId: true,
            quantity: true,
            receivedQuantity: true,
          },
        },
      },
    });
  }

  /**
   * Retrieves a single purchase order by ID within clinic scope.
   *
   * @param poId - Purchase order ID
   * @param clinicId - Clinic context
   * @returns PO with full item details
   * @throws {HealthcareError} If PO not found
   */
  async getPurchaseOrderById(
    poId: string,
    clinicId: string
  ): Promise<{
    id: string;
    supplierId: string;
    clinicId: string;
    status: PurchaseOrderStatus;
    notes: string | null;
    expectedDeliveryDate: Date | null;
    items: Array<{
      id: string;
      productId: string;
      quantity: number;
      receivedQuantity: number;
      unitPrice: number | null;
      description: string | null;
    }>;
    createdAt: Date;
  }> {
    const po = await this.db.prisma.purchaseOrder.findFirst({
      where: { id: poId, clinicId },
      include: {
        items: true,
      },
    });

    if (!po) {
      throw new HealthcareError(
        ErrorCode.PHARMACY_PURCHASE_ORDER_NOT_FOUND,
        `Purchase order ${poId} not found in clinic ${clinicId}`,
        { poId }
      );
    }

    return {
      id: po.id,
      supplierId: po.supplierId,
      clinicId: po.clinicId,
      status: po.status as PurchaseOrderStatus,
      notes: po.notes,
      expectedDeliveryDate: po.expectedDeliveryDate,
      items: po.items.map((item: (typeof po.items)[number]) => ({
        id: item.id,
        productId: item.productId,
        quantity: item.quantity,
        receivedQuantity: item.receivedQuantity,
        unitPrice: item.unitPrice,
        description: item.description,
      })),
      createdAt: po.createdAt,
    };
  }
}
