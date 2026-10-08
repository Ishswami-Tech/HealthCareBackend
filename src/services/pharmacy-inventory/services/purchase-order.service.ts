/**
 * Purchase Order Service
 * @module Pharmacy Inventory
 * @description Purchase order creation, listing, status tracking and supplier routing.
 *              Clinic scoped: every query is filtered by the caller's clinic, and a supplier
 *              or medicine of another clinic can never be referenced.
 */

import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { EventService } from '@infrastructure/events';
import { HealthcareError, ErrorCode } from '@core/errors';
import { formatDateKeyInIST } from '@utils/date-time.util';
import type {
  CreatePurchaseOrderDto,
  ReceivePurchaseOrderDto,
} from '../dto/pharmacy-inventory.dto';
import {
  PurchaseOrderReceiptError,
  allocateReceipt,
  isReceivableStatus,
  isUniqueViolation,
  statusAfterReceipt,
} from './purchase-order-receipt.util';

/** The delegates the receipt transaction touches (the generated client types are not loose). */
interface ReceiptTx {
  purchaseOrder: {
    findFirst: (args: unknown) => Promise<ReceiptPoRow | null>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
  purchaseOrderItem: { updateMany: (args: unknown) => Promise<{ count: number }> };
  stockBatch: {
    findFirst: (args: unknown) => Promise<{ id: string; expiryDate: Date } | null>;
    create: (args: unknown) => Promise<{ id: string }>;
    update: (args: unknown) => Promise<unknown>;
  };
  stockMovement: { create: (args: unknown) => Promise<unknown> };
  medicine: { updateMany: (args: unknown) => Promise<{ count: number }> };
}

type ReceiptPoRow = Omit<PurchaseOrderRow, 'items'> & {
  items: Array<PurchaseOrderItemView>;
};

const dayKey = (date: Date): string => date.toISOString().slice(0, 10);

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

  /**
   * Receives goods against a SENT / PARTIALLY_RECEIVED purchase order, all in one transaction:
   * stock batches (a repeat of an existing lot with the same expiry tops that lot up), PURCHASE_IN
   * movements, `Medicine.stock`, the line received quantities and the PO status. Over-receiving a
   * line is refused; the line update is guarded so two concurrent receipts cannot both fit.
   *
   * @param poId - Purchase order ID
   * @param dto - Batches received
   * @param userId - User receiving the goods
   * @param clinicId - Clinic context
   * @returns The purchase order after the receipt
   */
  async receivePurchaseOrder(
    poId: string,
    dto: ReceivePurchaseOrderDto,
    userId: string,
    clinicId: string
  ): Promise<PurchaseOrderView> {
    if (!clinicId) {
      throw new BadRequestException('Clinic context is required to receive a purchase order');
    }
    const now = new Date();

    const result = await this.db.prisma.$transaction(async tx => {
      const client = tx as unknown as ReceiptTx;
      // Serialize receipts of one PO on its row. Two receipts on different lines would otherwise
      // each compute the final status from a snapshot that lacks the other's increment and leave
      // a fully received PO PARTIALLY_RECEIVED. The second receipt waits here until the first
      // commits, and every read below then sees its increments (READ COMMITTED).
      await client.purchaseOrder.updateMany({
        where: { id: poId, clinicId },
        data: { updatedAt: now },
      });
      const po = await client.purchaseOrder.findFirst({
        where: { id: poId, clinicId },
        include: { items: true },
      });
      if (!po) {
        throw new HealthcareError(
          ErrorCode.PHARMACY_PURCHASE_ORDER_NOT_FOUND,
          `Purchase order ${poId} not found in clinic ${clinicId}`,
          { poId }
        );
      }
      if (!isReceivableStatus(po.status)) {
        throw new BadRequestException(
          `Cannot receive goods for a PO in status ${po.status}. It must be SENT or PARTIALLY_RECEIVED.`
        );
      }

      let allocations: Array<{ line: PurchaseOrderItemView; request: (typeof dto.items)[number] }>;
      try {
        allocations = allocateReceipt(po.items, dto.items).map(a => ({
          line: po.items.find(item => item.id === a.line.id) as PurchaseOrderItemView,
          request: a.request,
        }));
      } catch (error) {
        if (error instanceof PurchaseOrderReceiptError) {
          throw new BadRequestException(error.message);
        }
        throw error;
      }

      // Line received quantities first, guarded so a concurrent receipt cannot over-fill a line.
      const perLine = new Map<string, number>();
      for (const { line, request } of allocations) {
        perLine.set(line.id, (perLine.get(line.id) ?? 0) + request.quantityReceived);
      }
      for (const line of po.items) {
        const received = perLine.get(line.id);
        if (!received) continue;
        const moved = await client.purchaseOrderItem.updateMany({
          where: {
            id: line.id,
            purchaseOrderId: poId,
            receivedQuantity: { lte: line.quantity - received },
          },
          data: { receivedQuantity: { increment: received } },
        });
        if (moved.count !== 1) {
          throw new ConflictException(
            `Line ${line.id} was received by someone else meanwhile, reload the purchase order.`
          );
        }
      }

      for (const { line, request } of allocations) {
        const expiryDate = new Date(request.expiryDate);
        const manufactureDate = request.manufactureDate ? new Date(request.manufactureDate) : now;
        if (expiryDate <= now) {
          throw new BadRequestException(`Batch ${request.batchNumber} is already expired.`);
        }
        if (manufactureDate > now) {
          throw new BadRequestException(
            `Batch ${request.batchNumber} has a manufacture date in the future.`
          );
        }

        const lot = await client.stockBatch.findFirst({
          where: { productId: line.productId, clinicId, lotNumber: request.batchNumber },
          select: { id: true, expiryDate: true },
        });
        let batchId: string;
        if (lot) {
          if (dayKey(lot.expiryDate) !== dayKey(expiryDate)) {
            throw new BadRequestException(
              `Batch ${request.batchNumber} already exists with a different expiry date.`
            );
          }
          await client.stockBatch.update({
            where: { id: lot.id },
            data: {
              quantityOnHand: { increment: request.quantityReceived },
              quantityReceived: { increment: request.quantityReceived },
            },
          });
          batchId = lot.id;
        } else {
          // A concurrent first receipt of the same new lot (another PO) loses the unique
          // (clinic, product, lot) race. The transaction is aborted by then, so answer 409 and
          // let the caller retry, which tops the lot up instead of creating it.
          let created: { id: string };
          try {
            created = await client.stockBatch.create({
              data: {
                productId: line.productId,
                clinicId,
                lotNumber: request.batchNumber,
                manufactureDate,
                expiryDate,
                quantityReceived: request.quantityReceived,
                quantityOnHand: request.quantityReceived,
                costPrice: request.unitCost ?? line.unitPrice ?? null,
                medicineName: line.description ?? null,
                createdById: userId,
              },
              select: { id: true },
            });
          } catch (error) {
            if (isUniqueViolation(error)) {
              throw new ConflictException(
                `Batch ${request.batchNumber} was just received by someone else, retry the receipt.`
              );
            }
            throw error;
          }
          batchId = created.id;
        }

        const stock = await client.medicine.updateMany({
          where: { id: line.productId, clinicId },
          data: { stock: { increment: request.quantityReceived } },
        });
        if (stock.count !== 1) {
          throw new BadRequestException(`Medicine ${line.productId} not found in this clinic.`);
        }

        await client.stockMovement.create({
          data: {
            productId: line.productId,
            batchId,
            clinicId,
            movementType: 'PURCHASE_IN',
            quantity: request.quantityReceived,
            reason: `Received against ${po.poNumber}`,
            referenceId: poId,
            referenceType: 'PURCHASE_ORDER',
            recordedById: userId,
          },
        });
      }

      const after = await client.purchaseOrder.findFirst({
        where: { id: poId, clinicId },
        include: { items: true },
      });
      if (!after) {
        throw new ConflictException('The purchase order disappeared during the receipt.');
      }
      const nextStatus = statusAfterReceipt(after.items);
      const closed = await client.purchaseOrder.updateMany({
        where: { id: poId, clinicId, status: { in: ['SENT', 'PARTIALLY_RECEIVED'] } },
        data: { status: nextStatus, ...(nextStatus === 'RECEIVED' ? { receivedAt: now } : {}) },
      });
      if (closed.count !== 1) {
        throw new ConflictException('The purchase order changed during the receipt, retry.');
      }
      return {
        po: { ...after, status: nextStatus },
        productIds: [...new Set(allocations.map(a => a.line.productId))],
      };
    });

    await Promise.all(
      result.productIds.map(productId =>
        this.cache.del(`pharmacy:inventory:onhand:${clinicId}:${productId}`)
      )
    );
    await this.events.emit('pharmacy.purchaseOrder.received', {
      poId,
      clinicId,
      status: result.po.status,
      itemCount: result.productIds.length,
    });

    return this.toView(result.po);
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
