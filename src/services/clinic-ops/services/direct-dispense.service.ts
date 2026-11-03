/**
 * Direct Dispense Service
 * @module ClinicOps
 * @description Hand medicines from clinic stock to a patient without going through the pharmacy
 * counter (doctor / assistant / pharmacist), with FEFO batch consumption, a short undo window and
 * an admin reversal. Also the read-only stock view for the clinical roles.
 *
 * Billing blindness: prices are snapshotted on the row (billing side) but only the billing roles
 * receive them; DOCTOR / ASSISTANT_DOCTOR responses are built without any amount.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UNPUBLISHED_PRESCRIPTION_STATUSES } from '@dtos/pharmacy.dto';
import { EventService } from '@infrastructure/events/event.service';
import { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';
import { InventoryService } from '@services/pharmacy-inventory/services/inventory.service';
import { OpsDbService, type OpsActor } from './ops-db.service';
import { ClinicAuditService } from './audit.service';
import {
  displayName,
  sharedDelegates,
  type DirectDispenseRow,
  type MedicineStockRow,
  type OpsClient,
} from '../clinic-ops.types';
import { assertLocationsInClinic, assertPatientInClinic } from './clinic-scope.util';
import { dispenseLinesSignature } from './ops-integrity.util';
import type {
  CreateDirectDispenseDto,
  ReverseDirectDispenseDto,
  SettleDirectDispenseDto,
} from '../dto/clinic-ops.dto';

const SOURCE = 'DirectDispenseService';
/** The dispenser may undo their own hand-over for this long. */
export const DIRECT_DISPENSE_UNDO_MINUTES = 10;
const BILLING_ROLES = new Set(['CLINIC_ADMIN', 'SUPER_ADMIN', 'PHARMACIST', 'FINANCE_BILLING']);
const REVERSE_ROLES = new Set(['CLINIC_ADMIN', 'SUPER_ADMIN', 'PHARMACIST']);
const STOCK_STATUSES = new Set(['IN_STOCK', 'LOW', 'OUT']);
/** An identical hand-over (same recipient, same lines) inside this window is a double submit. */
export const DIRECT_DISPENSE_DUPLICATE_WINDOW_MS = 60 * 1000;
const NOT_DISPENSABLE_RX_STATUSES = new Set<string>([
  ...UNPUBLISHED_PRESCRIPTION_STATUSES,
  'CANCELLED',
]);

export interface StockViewItem {
  medicineId: string;
  name: string;
  category: string | null;
  unit: string | null;
  manufacturer: string | null;
  quantityOnHand: number;
  minStockThreshold: number;
  status: 'IN_STOCK' | 'LOW' | 'OUT';
  nearestExpiry: string | null;
  expiringSoon: boolean;
  /** Only present for the billing roles. */
  price?: number;
}

export interface DirectDispenseResponse {
  id: string;
  status: string;
  patientId: string | null;
  patientName: string;
  prescriptionId: string | null;
  note: string | null;
  dispensedByUserId: string;
  dispensedByRole: string;
  dispensedByName: string;
  createdAt: string;
  undoUntil: string;
  canUndo: boolean;
  reversedAt: string | null;
  reverseReason: string | null;
  items: Array<{
    medicineId: string;
    medicineName: string;
    quantity: number;
    batches: Array<{ lotNumber: string; quantity: number; expiryDate: string }>;
    /** Billing roles only. */
    unitPrice?: number;
    lineAmount?: number;
  }>;
  /** Billing roles only. */
  totalAmount?: number;
  settledAt?: string | null;
  settledMethod?: string | null;
}

interface BatchAllocation {
  lotNumber: string;
  quantity: number;
  expiryDate: string;
}

export const STOCK_VIEW_DEFAULT_LIMIT = 200;
export const STOCK_VIEW_MAX_LIMIT = 500;

/** Page / limit / skip of the stock view (1-based page; limit clamped to 1..500, default 200). */
export function stockPage(
  page: number | undefined,
  limit: number | undefined
): { page: number; limit: number; skip: number } {
  const size = Math.min(
    Math.max(Math.trunc(limit ?? STOCK_VIEW_DEFAULT_LIMIT) || STOCK_VIEW_DEFAULT_LIMIT, 1),
    STOCK_VIEW_MAX_LIMIT
  );
  const current = Math.max(Math.trunc(page ?? 1) || 1, 1);
  return { page: current, limit: size, skip: (current - 1) * size };
}

@Injectable()
export class DirectDispenseService {
  constructor(
    private readonly ops: OpsDbService,
    private readonly inventoryService: InventoryService,
    private readonly eventService: EventService,
    private readonly loggingService: LoggingService,
    private readonly audit: ClinicAuditService
  ) {}

  // ------------------------------------------------------------------ stock view

  async stockView(
    clinicId: string,
    actor: OpsActor,
    filter: { q?: string; status?: string; limit?: number; page?: number }
  ): Promise<{
    items: StockViewItem[];
    total: number;
    page: number;
    limit: number;
    hasMore: boolean;
  }> {
    // Paged (default page 1 of 200, max 500 per page): `total` counts every match so a caller
    // can see that more rows exist instead of the list being cut off silently.
    const { page, limit, skip } = stockPage(filter.page, filter.limit);
    const canSeePrice = BILLING_ROLES.has(actor.role.toUpperCase());
    const wanted = filter.status?.toUpperCase();
    if (wanted && !STOCK_STATUSES.has(wanted)) {
      throw new BadRequestException('status must be IN_STOCK, LOW or OUT');
    }
    const { medicines, total } = await this.ops.read(async client => {
      // The status filter runs in SQL (before `take`), so the page and the total agree.
      const where = await this.stockWhere(client, clinicId, filter.q, wanted);
      const [rows, count] = await Promise.all([
        client.medicine.findMany({
          where,
          select: {
            id: true,
            name: true,
            category: true,
            unit: true,
            manufacturer: true,
            stock: true,
            price: true,
            minStockThreshold: true,
          },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip,
          take: limit,
        }),
        client.medicine.count({ where }),
      ]);
      return { medicines: rows, total: count };
    });
    const ids = medicines.map(m => m.id);
    const batches = ids.length
      ? await this.ops.read(client =>
          client.stockBatch.findMany({
            where: { clinicId, productId: { in: ids }, quantityOnHand: { gt: 0 } },
            select: { productId: true, expiryDate: true, quantityOnHand: true },
          })
        )
      : [];
    const now = Date.now();
    const soon = now + 60 * 24 * 60 * 60 * 1000;
    const nearest = new Map<string, Date>();
    for (const batch of batches) {
      if (batch.expiryDate.getTime() <= now) continue;
      const current = nearest.get(batch.productId);
      if (!current || batch.expiryDate < current) nearest.set(batch.productId, batch.expiryDate);
    }
    const items = medicines.map((m: MedicineStockRow): StockViewItem => {
      const expiry = nearest.get(m.id) ?? null;
      const status: StockViewItem['status'] =
        m.stock <= 0 ? 'OUT' : m.stock <= m.minStockThreshold ? 'LOW' : 'IN_STOCK';
      return {
        medicineId: m.id,
        name: m.name,
        category: m.category,
        unit: m.unit,
        manufacturer: m.manufacturer,
        quantityOnHand: m.stock,
        minStockThreshold: m.minStockThreshold,
        status,
        nearestExpiry: expiry ? expiry.toISOString().slice(0, 10) : null,
        expiringSoon: expiry ? expiry.getTime() <= soon : false,
        ...(canSeePrice ? { price: m.price } : {}),
      };
    });
    return { items, total, page, limit, hasMore: skip + items.length < total };
  }

  /**
   * Medicine `where` of the stock view. LOW / IN_STOCK compare `stock` with the row's own
   * `minStockThreshold` through a Prisma field reference; when the client exposes none, the ids
   * come from a parameterised raw query (same approach as the pharmacy inventory list).
   */
  private async stockWhere(
    client: OpsClient,
    clinicId: string,
    q: string | undefined,
    status: string | undefined
  ): Promise<Record<string, unknown>> {
    const where: Record<string, unknown> = { clinicId, isActive: true, deletedAt: null };
    if (q?.trim()) where['name'] = { contains: q.trim(), mode: 'insensitive' };
    if (status === 'OUT') {
      where['stock'] = { lte: 0 };
      return where;
    }
    if (status !== 'LOW' && status !== 'IN_STOCK') return where;
    const thresholdRef = (client.medicine as { fields?: Record<string, unknown> }).fields?.[
      'minStockThreshold'
    ];
    if (thresholdRef) {
      where['stock'] = status === 'LOW' ? { gt: 0, lte: thresholdRef } : { gt: thresholdRef };
      return where;
    }
    const raw = sharedDelegates(client);
    const rows =
      status === 'LOW'
        ? await raw.$queryRaw<
            Array<{ id: string }>
          >`SELECT "id" FROM "Medicine" WHERE "clinicId" = ${clinicId} AND "stock" > 0 AND "stock" <= "minStockThreshold"`
        : await raw.$queryRaw<
            Array<{ id: string }>
          >`SELECT "id" FROM "Medicine" WHERE "clinicId" = ${clinicId} AND "stock" > "minStockThreshold"`;
    where['id'] = { in: rows.map(r => r.id) };
    return where;
  }

  // ------------------------------------------------------------------ dispense

  async create(
    dto: CreateDirectDispenseDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<DirectDispenseResponse> {
    if (!dto.patientId && !dto.walkInName?.trim()) {
      throw new BadRequestException('Choose a patient or enter the walk-in name');
    }
    const merged = new Map<string, number>();
    for (const line of dto.items) {
      merged.set(line.medicineId, (merged.get(line.medicineId) ?? 0) + line.quantity);
    }
    const medicineIds = [...merged.keys()];
    const medicines = await this.ops.read(client =>
      client.medicine.findMany({
        where: { id: { in: medicineIds }, clinicId, isActive: true, deletedAt: null },
        select: { id: true, name: true, price: true, stock: true },
      })
    );
    if (medicines.length !== medicineIds.length) {
      throw new BadRequestException('One or more medicines are not available in this clinic');
    }
    await this.assertForeignIds(dto, clinicId);
    const duplicate = await this.findRecentDuplicate(dto, clinicId);
    if (duplicate) {
      if (duplicate.dispensedByUserId === actor.userId) {
        // Double submit (retry / double tap): hand back the first hand-over, move no stock twice.
        return this.get(duplicate.id, clinicId, actor);
      }
      throw new ConflictException(
        'An identical hand-over for this patient was recorded a moment ago - check the list first'
      );
    }

    const byId = new Map(medicines.map(m => [m.id, m]));
    const lines = medicineIds.map(medicineId => {
      const medicine = byId.get(medicineId) as MedicineStockRow;
      const quantity = merged.get(medicineId) as number;
      return {
        medicineId,
        medicineName: medicine.name,
        quantity,
        unitPrice: medicine.price,
        lineAmount: Math.round(medicine.price * quantity * 100) / 100,
      };
    });
    const totalAmount = Math.round(lines.reduce((sum, l) => sum + l.lineAmount, 0) * 100) / 100;
    const undoUntil = new Date(Date.now() + DIRECT_DISPENSE_UNDO_MINUTES * 60 * 1000);

    const created = await this.ops.transaction(async client => {
      const row = await client.directDispense.create({
        data: {
          clinicId,
          locationId: dto.locationId ?? null,
          patientId: dto.patientId ?? null,
          walkInName: dto.patientId ? null : (dto.walkInName?.trim() ?? null),
          walkInPhone: dto.patientId ? null : (dto.walkInPhone?.trim() ?? null),
          prescriptionId: dto.prescriptionId ?? null,
          dispensedByUserId: actor.userId,
          dispensedByRole: actor.role.toUpperCase(),
          note: dto.note?.trim() || null,
          undoUntil,
          totalAmount,
          items: { create: lines },
        },
        include: { items: true },
      });

      // FEFO consumption inside the same transaction: a short batch rolls the whole hand-over back.
      const fefo = await this.inventoryService.dispenseFefo(
        row.id,
        {
          items: (row.items ?? []).map(item => ({
            prescriptionItemId: item.id,
            medicineId: item.medicineId,
            quantity: item.quantity,
          })),
        },
        actor.userId,
        clinicId,
        sharedDelegates(client),
        false,
        'DIRECT_DISPENSE'
      );

      for (const item of row.items ?? []) {
        const result = fefo.find(f => f.prescriptionItemId === item.id);
        const allocations: BatchAllocation[] = (result?.consumedBatches ?? []).map(b => ({
          lotNumber: b.lotNumber,
          quantity: b.quantity,
          expiryDate: b.expiryDate.toISOString().slice(0, 10),
        }));
        await client.directDispenseItem.update({
          where: { id: item.id },
          data: { batchAllocations: allocations },
        });
      }
      return row;
    });

    await this.audit.record(
      clinicId,
      { type: 'DIRECT_DISPENSE', id: created.id },
      'DISPENSE_CREATED',
      actor,
      {
        patientId: dto.patientId ?? null,
        walkIn: !dto.patientId,
        prescriptionId: dto.prescriptionId ?? null,
        items: lines.map(l => ({ medicineId: l.medicineId, quantity: l.quantity })),
      }
    );
    await this.eventService.emit('clinic-ops.direct-dispense.created', {
      directDispenseId: created.id,
      clinicId,
      dispensedByUserId: actor.userId,
      itemCount: lines.length,
    });
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Direct dispense created',
      SOURCE,
      {
        directDispenseId: created.id,
        clinicId,
        role: actor.role,
      }
    );
    return this.get(created.id, clinicId, actor);
  }

  async list(
    clinicId: string,
    actor: OpsActor,
    filter: { status?: string; patientId?: string; mine?: boolean; limit?: number }
  ): Promise<DirectDispenseResponse[]> {
    const where: Record<string, unknown> = { clinicId };
    if (filter.status) where['status'] = filter.status.toUpperCase();
    if (filter.patientId) where['patientId'] = filter.patientId;
    // The clinical roles only ever see hand-overs they made themselves.
    if (filter.mine || ['DOCTOR', 'ASSISTANT_DOCTOR'].includes(actor.role.toUpperCase())) {
      where['dispensedByUserId'] = actor.userId;
    }
    const rows = await this.ops.read(client =>
      client.directDispense.findMany({
        where,
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(filter.limit ?? 50, 1), 200),
      })
    );
    return this.toResponses(rows, actor);
  }

  async get(id: string, clinicId: string, actor: OpsActor): Promise<DirectDispenseResponse> {
    const row = await this.load(id, clinicId);
    this.assertCanSee(row, actor);
    return (await this.toResponses([row], actor))[0] as DirectDispenseResponse;
  }

  /** Dispenser undoes their own hand-over inside the undo window (nothing settled yet). */
  async undo(id: string, clinicId: string, actor: OpsActor): Promise<DirectDispenseResponse> {
    const row = await this.load(id, clinicId);
    const privileged = REVERSE_ROLES.has(actor.role.toUpperCase());
    if (row.dispensedByUserId !== actor.userId && !privileged) {
      throw new ForbiddenException('Only the person who dispensed can undo this hand-over');
    }
    if (row.settledAt) {
      throw new BadRequestException(
        'This hand-over is already settled - ask the clinic admin to reverse it'
      );
    }
    if (row.undoUntil.getTime() < Date.now() && !privileged) {
      throw new BadRequestException(
        'The undo window has passed - ask the clinic admin to reverse it'
      );
    }
    await this.reverseInternal(row, clinicId, actor, 'Undone by dispenser');
    return this.get(id, clinicId, actor);
  }

  /** Clinic admin / pharmacist reverses a hand-over at any time, with a reason. */
  async reverse(
    id: string,
    dto: ReverseDirectDispenseDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<DirectDispenseResponse> {
    const row = await this.load(id, clinicId);
    await this.reverseInternal(row, clinicId, actor, dto.reason.trim());
    return this.get(id, clinicId, actor);
  }

  /** Records that the hand-over was paid for / waived. No payment is processed here. */
  async settle(
    id: string,
    dto: SettleDirectDispenseDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<DirectDispenseResponse> {
    const row = await this.load(id, clinicId);
    if (row.status !== 'DISPENSED') {
      throw new BadRequestException(`A ${row.status.toLowerCase()} hand-over cannot be settled`);
    }
    const claimed = await this.ops.write(
      client =>
        client.directDispense.updateMany({
          where: { id, clinicId, status: 'DISPENSED', settledAt: null },
          data: { settledAt: new Date(), settledMethod: dto.method, settledById: actor.userId },
        }),
      {
        actor,
        clinicId,
        resourceType: 'DIRECT_DISPENSE',
        operation: 'SETTLE',
        resourceId: id,
        details: { method: dto.method },
      }
    );
    if (claimed.count !== 1) throw new BadRequestException('This hand-over is already settled');
    return this.get(id, clinicId, actor);
  }

  // ------------------------------------------------------------------ helpers

  /** Patient, location and prescription sent by the caller must all belong to this clinic. */
  private async assertForeignIds(dto: CreateDirectDispenseDto, clinicId: string): Promise<void> {
    const { patientId, locationId, prescriptionId } = dto;
    await this.ops.read(async client => {
      if (patientId) await assertPatientInClinic(client, patientId, clinicId);
      if (locationId) await assertLocationsInClinic(client, [locationId], clinicId);
      if (!prescriptionId) return;
      if (!patientId) {
        throw new BadRequestException('Choose the patient of this prescription');
      }
      const rx = await client.prescription.findFirst({
        where: { id: prescriptionId, clinicId, patientId },
        select: { id: true, status: true },
      });
      if (!rx) throw new NotFoundException('Prescription not found for this patient');
      if (NOT_DISPENSABLE_RX_STATUSES.has(String(rx.status))) {
        throw new BadRequestException('This prescription cannot be dispensed');
      }
    });
  }

  /** A DISPENSED row for the same recipient with the same lines, created a moment ago. */
  private async findRecentDuplicate(
    dto: CreateDirectDispenseDto,
    clinicId: string
  ): Promise<DirectDispenseRow | null> {
    const recipient = dto.patientId
      ? { patientId: dto.patientId }
      : { patientId: null, walkInName: { equals: dto.walkInName?.trim(), mode: 'insensitive' } };
    const recent = await this.ops.read(client =>
      client.directDispense.findMany({
        where: {
          clinicId,
          status: 'DISPENSED',
          createdAt: { gte: new Date(Date.now() - DIRECT_DISPENSE_DUPLICATE_WINDOW_MS) },
          ...recipient,
        },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      })
    );
    const signature = dispenseLinesSignature(dto.items);
    return recent.find(r => dispenseLinesSignature(r.items ?? []) === signature) ?? null;
  }

  private async reverseInternal(
    row: DirectDispenseRow,
    clinicId: string,
    actor: OpsActor,
    reason: string
  ): Promise<void> {
    if (row.status !== 'DISPENSED') {
      throw new BadRequestException(`This hand-over is already ${row.status.toLowerCase()}`);
    }
    await this.ops.transaction(async client => {
      const claimed = await client.directDispense.updateMany({
        where: { id: row.id, clinicId, status: 'DISPENSED' },
        data: {
          status: 'REVERSED',
          reversedAt: new Date(),
          reversedByUserId: actor.userId,
          reverseReason: reason,
        },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('This hand-over was already reversed');
      }
      await this.inventoryService.restoreDispense(
        row.id,
        (row.items ?? []).map(i => ({ medicineId: i.medicineId, quantity: i.quantity })),
        actor.userId,
        clinicId,
        sharedDelegates(client),
        'DIRECT_DISPENSE'
      );
    });
    await this.audit.record(
      clinicId,
      { type: 'DIRECT_DISPENSE', id: row.id },
      'DISPENSE_REVERSED',
      actor,
      {
        reason,
      }
    );
    await this.eventService.emit('clinic-ops.direct-dispense.reversed', {
      directDispenseId: row.id,
      clinicId,
      reversedByUserId: actor.userId,
    });
  }

  private async load(id: string, clinicId: string): Promise<DirectDispenseRow> {
    const row = await this.ops.read(client =>
      client.directDispense.findFirst({ where: { id, clinicId }, include: { items: true } })
    );
    if (!row) throw new NotFoundException('Direct dispense not found');
    return row;
  }

  private assertCanSee(row: DirectDispenseRow, actor: OpsActor): void {
    if (
      ['DOCTOR', 'ASSISTANT_DOCTOR'].includes(actor.role.toUpperCase()) &&
      row.dispensedByUserId !== actor.userId
    ) {
      throw new NotFoundException('Direct dispense not found');
    }
  }

  private async toResponses(
    rows: DirectDispenseRow[],
    actor: OpsActor
  ): Promise<DirectDispenseResponse[]> {
    const canSeeAmounts = BILLING_ROLES.has(actor.role.toUpperCase());
    const userIds = [...new Set(rows.map(r => r.dispensedByUserId))];
    const patientIds = [...new Set(rows.map(r => r.patientId).filter((v): v is string => !!v))];
    const [users, patients] = await Promise.all([
      userIds.length
        ? this.ops.read(client =>
            client.user.findMany({
              where: { id: { in: userIds } },
              select: { id: true, name: true, firstName: true, lastName: true },
            })
          )
        : Promise.resolve([]),
      patientIds.length
        ? this.ops.read(client =>
            client.patient.findMany({
              where: { id: { in: patientIds } },
              select: {
                id: true,
                user: { select: { name: true, firstName: true, lastName: true } },
              },
            })
          )
        : Promise.resolve([]),
    ]);
    const userNames = new Map(users.map(u => [u.id, displayName(u)]));
    const patientNames = new Map(patients.map(p => [p.id, displayName(p.user)]));

    return rows.map(row => ({
      id: row.id,
      status: row.status,
      patientId: row.patientId,
      patientName: row.patientId
        ? (patientNames.get(row.patientId) ?? 'Patient')
        : (row.walkInName ?? 'Walk-in'),
      prescriptionId: row.prescriptionId,
      note: row.note,
      dispensedByUserId: row.dispensedByUserId,
      dispensedByRole: row.dispensedByRole,
      dispensedByName: userNames.get(row.dispensedByUserId) ?? 'Unknown',
      createdAt: row.createdAt.toISOString(),
      undoUntil: row.undoUntil.toISOString(),
      canUndo: row.status === 'DISPENSED' && !row.settledAt && row.undoUntil.getTime() > Date.now(),
      reversedAt: row.reversedAt ? row.reversedAt.toISOString() : null,
      reverseReason: row.reverseReason,
      items: (row.items ?? []).map(item => ({
        medicineId: item.medicineId,
        medicineName: item.medicineName,
        quantity: item.quantity,
        batches: Array.isArray(item.batchAllocations)
          ? (item.batchAllocations as BatchAllocation[])
          : [],
        ...(canSeeAmounts ? { unitPrice: item.unitPrice, lineAmount: item.lineAmount } : {}),
      })),
      ...(canSeeAmounts
        ? {
            totalAmount: row.totalAmount,
            settledAt: row.settledAt ? row.settledAt.toISOString() : null,
            settledMethod: row.settledMethod,
          }
        : {}),
    }));
  }
}
