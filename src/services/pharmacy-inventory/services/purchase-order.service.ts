/**
 * Purchase Order Service
 * @module Pharmacy Inventory
 * @description Purchase order creation, listing, status tracking and supplier routing.
 *              Clinic scoped: every query is filtered by the caller's clinic, and a supplier
 *              or medicine of another clinic can never be referenced.
 */

import { Injectable, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { EventService } from '@infrastructure/events';
import { HealthcareError, ErrorCode } from '@core/errors';
import { formatDateKeyInIST } from '@utils/date-time.util';
import type { CreatePurchaseOrderDto } from '../dto/pharmacy-inventory.dto';

/**
 * Purchase order status lifecycle: DRAFT → SENT → PARTIALLY_RECEIVED → RECEIVED | CANCELLED
 */
export type PurchaseOrderStatus =
  'DRAFT' | 'SENT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';

export interface PurchaseOrderItemView {
  id: string;
  productId: string;
  description: string | null;
  quantity: number;
  receivedQuantity: number;
  unitPrice: number | null;
  lineTotal: number;
}

export interface PurchaseOrderView {
  id: string;
  poNumber: string;
  supplierId: string;
  clinicId: string;
  status: PurchaseOrderStatus;
  notes: string | null;
  expectedDeliveryDate: Date | null;
  sentAt: Date | null;
  totalAmount: number;
  items: PurchaseOrderItemView[];
  createdAt: Date;
}

export interface PurchaseOrderPage {
  data: PurchaseOrderView[];
  total: number;
  limit: number;
  offset: number;
}

interface PurchaseOrderRow {
  id: string;
  poNumber: string;
  supplierId: string;
  clinicId: string;
  status: string;
  notes: string | null;
  expectedDeliveryDate: Date | null;
  sentAt: Date | null;
  totalAmount: number;
  createdAt: Date;
  items: PurchaseOrderItemView[];
}

const toPaise = (rupees: number): number => Math.round(rupees * 100);
const fromPaise = (paise: number): number => paise / 100;

/**
 * Service for pharmacy purchase order management.
 *
 * Responsibilities:
 * - Create purchase orders (money computed in integer paise, stored as rupees)
 * - List / read purchase orders of the caller's clinic
 * - Track PO status through the supplier workflow
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
   * PO number: PO-<IST yyyymmdd>-<8 random hex>, unique per clinic (enforced by the
   * (clinicId, poNumber) unique index).
   */
  private buildPoNumber(now: Date): string {
    const day = formatDateKeyInIST(now).replace(/-/g, '');
    return `PO-${day}-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  }

  /**
   * Creates a purchase order to a supplier of the caller's clinic.
   *
   * @param dto - PO creation data
   * @param userId - ID of the user creating the PO
   * @param clinicId - Clinic context
   * @returns Created PO with items and the paise-safe total
   */
  async createPurchaseOrder(
    dto: CreatePurchaseOrderDto,
    userId: string,
    clinicId: string
  ): Promise<PurchaseOrderView> {
    if (!clinicId) {
      throw new BadRequestException('Clinic context is required to create a purchase order');
    }
    this.logger.info('Creating purchase order', {
      module: 'PurchaseOrder',
      supplierId: dto.supplierId,
      clinicId,
      itemCount: dto.items.length,
    });

    const productIds: string[] = Array.from(
      new Set(dto.items.map((item: (typeof dto.items)[number]) => item.productId))
    );
    const { supplier, medicines } = await this.db.executeHealthcareRead(async client => {
      const loose = client as unknown as {
        supplier: { findFirst: (args: unknown) => Promise<{ id: string } | null> };
        medicine: { findMany: (args: unknown) => Promise<Array<{ id: string; name: string }>> };
      };
      return {
        supplier: await loose.supplier.findFirst({
          where: { id: dto.supplierId, clinicId, deletedAt: null, isActive: true },
          select: { id: true },
        }),
        medicines: await loose.medicine.findMany({
          where: { id: { in: productIds }, clinicId, isActive: true },
          select: { id: true, name: true },
        }),
      };
    });
    if (!supplier) {
      throw new BadRequestException('Supplier not found in this clinic');
    }
    const nameById = new Map<string, string>(
      medicines.map(medicine => [medicine.id, medicine.name])
    );
    if (nameById.size !== productIds.length) {
      throw new BadRequestException('One or more products are not active medicines of this clinic');
    }

    let totalPaise = 0;
    const itemRows = dto.items.map((item: (typeof dto.items)[number]) => {
      const lineTotalPaise =
        item.unitPrice === undefined ? 0 : item.quantity * toPaise(item.unitPrice);
      totalPaise += lineTotalPaise;
      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice ?? null,
        description: item.description ?? nameById.get(item.productId) ?? null,
        lineTotal: fromPaise(lineTotalPaise),
      };
    });

    const now = new Date();
    const po: PurchaseOrderRow & { items: PurchaseOrderItemView[] } =
      await this.db.prisma.purchaseOrder.create({
        data: {
          poNumber: this.buildPoNumber(now),
          supplierId: dto.supplierId,
          clinicId,
          status: 'DRAFT',
          notes: dto.notes ?? null,
          expectedDeliveryDate: dto.expectedDeliveryDate
            ? new Date(dto.expectedDeliveryDate)
            : null,
          totalAmount: fromPaise(totalPaise),
          createdById: userId,
          items: { create: itemRows },
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

    return this.toView(po);
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
   * Lists purchase orders of a clinic (newest first), optional status filter, paginated.
   *
   * @param clinicId - Clinic context
   * @param options - status / limit / offset
   */
  async listPurchaseOrders(
    clinicId: string,
    options: { status?: PurchaseOrderStatus; limit?: number; offset?: number } = {}
  ): Promise<PurchaseOrderPage> {
    if (!clinicId) {
      throw new BadRequestException('Clinic context is required to list purchase orders');
    }
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);
    const where: { clinicId: string; status?: PurchaseOrderStatus } = { clinicId };
    if (options.status) {
      where.status = options.status;
    }

    const [rows, total]: [PurchaseOrderRow[], number] = await Promise.all([
      this.db.prisma.purchaseOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { items: true },
      }),
      this.db.prisma.purchaseOrder.count({ where }),
    ]);

    return { data: rows.map(row => this.toView(row)), total, limit, offset };
  }

  /**
   * Retrieves a single purchase order by ID within clinic scope.
   *
   * @param poId - Purchase order ID
   * @param clinicId - Clinic context
   * @returns PO with full item details
   * @throws {HealthcareError} If PO not found
   */
  async getPurchaseOrderById(poId: string, clinicId: string): Promise<PurchaseOrderView> {
    const po: PurchaseOrderRow | null = await this.db.prisma.purchaseOrder.findFirst({
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

    return this.toView(po);
  }

  private toView(po: PurchaseOrderRow): PurchaseOrderView {
    return {
      id: po.id,
      poNumber: po.poNumber,
      supplierId: po.supplierId,
      clinicId: po.clinicId,
      status: po.status as PurchaseOrderStatus,
      notes: po.notes,
      expectedDeliveryDate: po.expectedDeliveryDate,
      sentAt: po.sentAt,
      totalAmount: po.totalAmount,
      items: po.items.map(item => ({
        id: item.id,
        productId: item.productId,
        description: item.description,
        quantity: item.quantity,
        receivedQuantity: item.receivedQuantity,
        unitPrice: item.unitPrice,
        lineTotal: item.lineTotal,
      })),
      createdAt: po.createdAt,
    };
  }
}
