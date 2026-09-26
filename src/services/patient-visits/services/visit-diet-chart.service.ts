/**
 * Visit Diet Chart Service (Take / Avoid / Occasional, en/gu/hi/mr labels)
 * @module PatientVisits
 * @description One chart per OPD visit (`visit_diet_charts` header +
 * `visit_diet_chart_items`) and the clinic-extensible food master
 * (`diet_chart_foods`, clinicId NULL = system seed row).
 *
 * Item labels are snapshots copied from the food master (or typed as free
 * text) at save time, so later edits to the master never rewrite a chart a
 * patient has already been handed.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events/event.service';
import { LogLevel, LogType } from '@core/types';
import type {
  PrismaDelegateArgs,
  PrismaTransactionClientWithDelegates,
} from '@core/types/prisma.types';
import {
  DIET_CHART_LANGUAGES,
  DietAdviceCategory,
  type CreateDietChartFoodDto,
  type DietChartFoodResponse,
  type DietChartItemInputDto,
  type DietChartLanguage,
  type UpdateDietChartFoodDto,
  type UpsertVisitDietChartDto,
  type VisitDietChartItemResponse,
  type VisitDietChartResponse,
} from '@dtos/visit-diet-chart.dto';
import { DIET_CHART_FOOD_SEED } from '@services/patient-visits/data/diet-chart-foods.seed';
import type { VisitActor } from '@services/patient-visits/patient-visits.service';

const SERVICE_NAME = 'VisitDietChartService';
const DEFAULT_LANGUAGE: DietChartLanguage = 'en';
const DEFAULT_SEARCH_LIMIT = 50;
const MAX_SEARCH_LIMIT = 100;
const MAX_KEY_LENGTH = 100;
/**
 * Postgres advisory-lock key that serialises first-time seeding. The
 * `@@unique([clinicId, key])` constraint does NOT protect the seed rows
 * (Postgres treats NULL clinicId values as distinct), so the lock + re-count
 * inside the transaction is what keeps concurrent seeders from duplicating.
 */
const SEED_ADVISORY_LOCK_KEY = 7_361_902_011;
const CATEGORY_ORDER: readonly DietAdviceCategory[] = [
  DietAdviceCategory.TAKE,
  DietAdviceCategory.AVOID,
  DietAdviceCategory.OCCASIONAL,
];

interface DietChartHeaderRow {
  id: string;
  visitId: string;
  patientId: string;
  clinicId: string;
  printLanguage: string;
  notes: string | null;
  recordedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface DietChartItemRow {
  id: string;
  visitId: string;
  category: string;
  foodId: string | null;
  nameEn: string;
  nameGu: string | null;
  nameHi: string | null;
  nameMr: string | null;
  note: string | null;
  sortOrder: number;
  recordedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface DietChartFoodRow {
  id: string;
  clinicId: string | null;
  key: string;
  nameEn: string;
  nameGu: string | null;
  nameHi: string | null;
  nameMr: string | null;
  group: string | null;
  isActive: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Fully normalised item ready to be written (labels already snapshotted). */
interface PreparedItem {
  category: DietAdviceCategory;
  foodId: string | null;
  nameEn: string;
  nameGu: string | null;
  nameHi: string | null;
  nameMr: string | null;
  note: string | null;
  sortOrder: number;
}

interface AuditEntry {
  userId: string;
  clinicId: string;
  resourceType: 'VISIT_DIET_CHART' | 'DIET_CHART_FOOD';
  operation: string;
  resourceId: string;
  userRole: string;
  details: Record<string, unknown>;
}

type DietChartClient = PrismaTransactionClientWithDelegates & {
  patientVisit: {
    findFirst: (args: PrismaDelegateArgs) => Promise<{ id: string; patientId: string } | null>;
  };
  visitDietChart: {
    findUnique: (args: PrismaDelegateArgs) => Promise<DietChartHeaderRow | null>;
    upsert: (args: PrismaDelegateArgs) => Promise<DietChartHeaderRow>;
  };
  visitDietChartItem: {
    findMany: (args: PrismaDelegateArgs) => Promise<DietChartItemRow[]>;
    deleteMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
    createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  };
  dietChartFood: {
    findUnique: (args: PrismaDelegateArgs) => Promise<DietChartFoodRow | null>;
    findFirst: (args: PrismaDelegateArgs) => Promise<DietChartFoodRow | null>;
    findMany: (args: PrismaDelegateArgs) => Promise<DietChartFoodRow[]>;
    create: (args: PrismaDelegateArgs) => Promise<DietChartFoodRow>;
    update: (args: PrismaDelegateArgs) => Promise<DietChartFoodRow>;
    count: (args: PrismaDelegateArgs) => Promise<number>;
    createMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
  };
};

@Injectable()
export class VisitDietChartService {
  /** Set once this instance has confirmed the system seed rows exist. */
  private seedVerified = false;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService
  ) {}

  // ===== Chart =============================================================

  async getChartForVisit(visitId: string, clinicId: string): Promise<VisitDietChartResponse> {
    await this.assertVisitInClinic(visitId, clinicId);

    const bundle = await this.databaseService.executeHealthcareRead<{
      header: DietChartHeaderRow | null;
      items: DietChartItemRow[];
    }>(async client => {
      const tc = client as unknown as DietChartClient;
      const header = await tc.visitDietChart.findUnique({
        where: { visitId } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
      const items = header ? await this.readItems(tc, visitId) : [];
      return { header, items };
    });

    return this.toChartResponse(visitId, bundle.header, bundle.items);
  }

  /**
   * Full-replace save: header upsert + delete-all/insert-all of the items in
   * ONE transaction (executeHealthcareWrite is not transactional), so a chart
   * can never be observed half-replaced.
   */
  async upsertChartForVisit(
    visitId: string,
    clinicId: string,
    dto: UpsertVisitDietChartDto,
    actor: VisitActor
  ): Promise<VisitDietChartResponse> {
    const visit = await this.assertVisitInClinic(visitId, clinicId);
    const printLanguage = dto.printLanguage ?? DEFAULT_LANGUAGE;
    const notes = this.cleanText(dto.notes);
    const items = await this.prepareItems(dto.items, clinicId);
    const recordedBy = actor.userId ?? null;
    const audit: AuditEntry = {
      userId: actor.userId || 'system',
      clinicId,
      resourceType: 'VISIT_DIET_CHART',
      operation: 'UPSERT',
      resourceId: visitId,
      userRole: actor.role || 'system',
      details: { visitId, patientId: visit.patientId, itemCount: items.length, printLanguage },
    };

    let header: DietChartHeaderRow;
    try {
      header = await this.databaseService.executeInTransaction<DietChartHeaderRow>(async tx => {
        const tc = tx as unknown as DietChartClient;
        const row = await tc.visitDietChart.upsert({
          where: { visitId } as PrismaDelegateArgs,
          create: {
            visitId,
            patientId: visit.patientId,
            clinicId,
            printLanguage,
            notes,
            recordedBy,
          } as PrismaDelegateArgs,
          update: { printLanguage, notes, recordedBy } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        await tc.visitDietChartItem.deleteMany({
          where: { visitId } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        if (items.length > 0) {
          await tc.visitDietChartItem.createMany({
            data: items.map(item => ({ ...item, visitId, recordedBy })) as PrismaDelegateArgs[],
          } as PrismaDelegateArgs);
        }
        return row;
      });
    } catch (error) {
      await this.audit(audit, 'FAILURE', error);
      throw error;
    }
    await this.audit(audit, 'SUCCESS');

    const savedItems = await this.databaseService.executeHealthcareRead<DietChartItemRow[]>(
      async client => this.readItems(client as unknown as DietChartClient, visitId)
    );

    await this.eventService.emit('patient-visit.diet-chart.updated', {
      visitId,
      patientId: visit.patientId,
      clinicId,
      printLanguage,
      itemCount: savedItems.length,
    });
    await this.loggingService.log(LogType.SYSTEM, LogLevel.INFO, 'Diet chart saved', SERVICE_NAME, {
      visitId,
      clinicId,
      itemCount: savedItems.length,
      printLanguage,
    });

    return this.toChartResponse(visitId, header, savedItems);
  }

  // ===== Food master =======================================================

  /**
   * System rows (clinicId NULL) plus this clinic's own rows, active only,
   * matched case-insensitively against any of the four name columns.
   */
  async searchFoods(
    clinicId: string,
    q?: string,
    group?: string,
    limit: number = DEFAULT_SEARCH_LIMIT
  ): Promise<DietChartFoodResponse[]> {
    await this.ensureSeeded();

    const take = Math.min(Math.max(Math.trunc(limit) || DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT);
    const term = this.cleanText(q);
    const groupFilter = this.cleanText(group)?.toLowerCase() ?? null;

    const conditions: PrismaDelegateArgs[] = [{ OR: [{ clinicId: null }, { clinicId }] }];
    if (term) {
      conditions.push({
        OR: ['nameEn', 'nameGu', 'nameHi', 'nameMr'].map(column => ({
          [column]: { contains: term, mode: 'insensitive' },
        })),
      });
    }
    if (groupFilter) {
      conditions.push({ group: groupFilter });
    }

    const rows = await this.databaseService.executeHealthcareRead<DietChartFoodRow[]>(
      async client => {
        const tc = client as unknown as DietChartClient;
        return tc.dietChartFood.findMany({
          where: { isActive: true, AND: conditions } as PrismaDelegateArgs,
          orderBy: { nameEn: 'asc' } as PrismaDelegateArgs,
          take,
        } as PrismaDelegateArgs);
      }
    );

    return rows.map(row => this.toFoodResponse(row));
  }

  async createFood(
    clinicId: string,
    dto: CreateDietChartFoodDto,
    actor: VisitActor
  ): Promise<DietChartFoodResponse> {
    const nameEn = this.cleanText(dto.nameEn);
    if (!nameEn) {
      throw new BadRequestException('nameEn is required');
    }
    const key = this.slugify(dto.key ?? nameEn);
    if (!key) {
      throw new BadRequestException(
        'Could not derive a key from the English name; pass an explicit key (a-z, 0-9, -)'
      );
    }
    await this.assertKeyAvailable(clinicId, key);

    const row = await this.databaseService.executeHealthcareWrite<DietChartFoodRow>(
      async client => {
        const tc = client as unknown as DietChartClient;
        return tc.dietChartFood.create({
          data: {
            clinicId,
            key,
            nameEn,
            nameGu: this.cleanText(dto.nameGu),
            nameHi: this.cleanText(dto.nameHi),
            nameMr: this.cleanText(dto.nameMr),
            group: this.cleanText(dto.group)?.toLowerCase() ?? null,
            isActive: true,
            createdBy: actor.userId ?? null,
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: actor.userId || 'system',
        clinicId,
        resourceType: 'DIET_CHART_FOOD',
        operation: 'CREATE',
        resourceId: key,
        userRole: actor.role || 'system',
        details: { key, nameEn },
      }
    );

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Clinic diet-chart food created',
      SERVICE_NAME,
      { clinicId, foodId: row.id, key }
    );
    return this.toFoodResponse(row);
  }

  /** Only this clinic's own rows are editable; system seed rows are read-only. */
  async updateFood(
    foodId: string,
    clinicId: string,
    dto: UpdateDietChartFoodDto,
    actor: VisitActor
  ): Promise<DietChartFoodResponse> {
    const existing = await this.databaseService.executeHealthcareRead<DietChartFoodRow | null>(
      async client => {
        const tc = client as unknown as DietChartClient;
        return tc.dietChartFood.findUnique({
          where: { id: foodId } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      }
    );
    if (!existing || (existing.clinicId !== null && existing.clinicId !== clinicId)) {
      throw new NotFoundException(`Food ${foodId} not found`);
    }
    if (existing.clinicId === null) {
      throw new ForbiddenException(
        'System foods are read-only; add a clinic-specific food instead'
      );
    }

    const data = await this.buildFoodUpdate(existing, dto, clinicId);
    if (Object.keys(data).length === 0) {
      return this.toFoodResponse(existing);
    }

    const row = await this.databaseService.executeHealthcareWrite<DietChartFoodRow>(
      async client => {
        const tc = client as unknown as DietChartClient;
        return tc.dietChartFood.update({
          where: { id: foodId } as PrismaDelegateArgs,
          data: data as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: actor.userId || 'system',
        clinicId,
        resourceType: 'DIET_CHART_FOOD',
        operation: 'UPDATE',
        resourceId: foodId,
        userRole: actor.role || 'system',
        details: { updateFields: Object.keys(data) },
      }
    );

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Clinic diet-chart food updated',
      SERVICE_NAME,
      { clinicId, foodId, updateFields: Object.keys(data) }
    );
    return this.toFoodResponse(row);
  }

  // ===== Seeding ===========================================================

  /**
   * Lazy, idempotent seeding of the system food master. Cheap after the first
   * confirmation per process; the transaction-scoped advisory lock plus the
   * re-count inside the transaction make concurrent first calls safe.
   */
  private async ensureSeeded(): Promise<void> {
    if (this.seedVerified) return;

    const existing = await this.databaseService.executeHealthcareRead<number>(async client =>
      this.countSystemFoods(client as unknown as DietChartClient)
    );
    if (existing > 0) {
      this.seedVerified = true;
      return;
    }

    const inserted = await this.databaseService.executeInTransaction<number>(async tx => {
      const tc = tx as unknown as DietChartClient;
      // pg_advisory_xact_lock returns void; $queryRaw can't deserialize a void
      // column ("Failed to deserialize column of type 'void'"), so this must
      // be $executeRaw, which doesn't attempt to parse a result set.
      await tc.$executeRaw`SELECT pg_advisory_xact_lock(CAST(${SEED_ADVISORY_LOCK_KEY} AS BIGINT))`;
      if ((await this.countSystemFoods(tc)) > 0) {
        return 0;
      }
      const result = await tc.dietChartFood.createMany({
        data: DIET_CHART_FOOD_SEED.map(food => ({
          clinicId: null,
          key: food.key,
          group: food.group,
          nameEn: food.nameEn,
          nameGu: food.nameGu,
          nameHi: food.nameHi,
          nameMr: food.nameMr,
          isActive: true,
        })) as PrismaDelegateArgs[],
        skipDuplicates: true,
      } as PrismaDelegateArgs);
      return result.count;
    });
    this.seedVerified = true;

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Diet-chart food master seeded',
      SERVICE_NAME,
      { inserted, seedSize: DIET_CHART_FOOD_SEED.length }
    );
  }

  private async countSystemFoods(tc: DietChartClient): Promise<number> {
    return tc.dietChartFood.count({ where: { clinicId: null } } as PrismaDelegateArgs);
  }

  // ===== Helpers ===========================================================

  private async assertVisitInClinic(
    visitId: string,
    clinicId: string
  ): Promise<{ id: string; patientId: string }> {
    const visit = await this.databaseService.executeHealthcareRead<{
      id: string;
      patientId: string;
    } | null>(async client => {
      const tc = client as unknown as DietChartClient;
      return tc.patientVisit.findFirst({
        where: { id: visitId, clinicId } as PrismaDelegateArgs,
        select: { id: true, patientId: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
    if (!visit) {
      throw new NotFoundException(`Visit ${visitId} not found`);
    }
    return visit;
  }

  private async readItems(tc: DietChartClient, visitId: string): Promise<DietChartItemRow[]> {
    return tc.visitDietChartItem.findMany({
      where: { visitId } as PrismaDelegateArgs,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    } as PrismaDelegateArgs);
  }

  /**
   * Trims labels, assigns per-category sort order and snapshots any blank
   * label from the food master. Foods must be visible to this clinic (system
   * rows or the clinic's own); an unknown/foreign foodId is rejected rather
   * than silently downgraded to free text.
   */
  private async prepareItems(
    items: DietChartItemInputDto[],
    clinicId: string
  ): Promise<PreparedItem[]> {
    const foodIds = [
      ...new Set(items.map(item => item.foodId).filter((id): id is string => Boolean(id))),
    ];
    const foods =
      foodIds.length > 0
        ? await this.loadFoodsForSnapshot(foodIds, clinicId)
        : new Map<string, DietChartFoodRow>();
    const positions = new Map<DietAdviceCategory, number>();

    return items.map((item, index) => {
      const food = item.foodId ? foods.get(item.foodId) : undefined;
      if (item.foodId && !food) {
        throw new BadRequestException(`Food ${item.foodId} not found`);
      }
      const nameEn = this.cleanText(item.nameEn) ?? food?.nameEn ?? null;
      if (!nameEn) {
        throw new BadRequestException(`items[${index}].nameEn is required`);
      }
      const position = positions.get(item.category) ?? 0;
      positions.set(item.category, position + 1);
      return {
        category: item.category,
        foodId: food?.id ?? null,
        nameEn,
        nameGu: this.cleanText(item.nameGu) ?? food?.nameGu ?? null,
        nameHi: this.cleanText(item.nameHi) ?? food?.nameHi ?? null,
        nameMr: this.cleanText(item.nameMr) ?? food?.nameMr ?? null,
        note: this.cleanText(item.note),
        sortOrder: item.sortOrder ?? position,
      };
    });
  }

  private async loadFoodsForSnapshot(
    foodIds: string[],
    clinicId: string
  ): Promise<Map<string, DietChartFoodRow>> {
    const rows = await this.databaseService.executeHealthcareRead<DietChartFoodRow[]>(
      async client => {
        const tc = client as unknown as DietChartClient;
        return tc.dietChartFood.findMany({
          where: {
            id: { in: foodIds },
            OR: [{ clinicId: null }, { clinicId }],
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      }
    );
    return new Map(rows.map(row => [row.id, row]));
  }

  private async assertKeyAvailable(clinicId: string, key: string): Promise<void> {
    const clash = await this.databaseService.executeHealthcareRead<DietChartFoodRow | null>(
      async client => {
        const tc = client as unknown as DietChartClient;
        return tc.dietChartFood.findFirst({
          where: { clinicId, key } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      }
    );
    if (clash) {
      throw new ConflictException(`A food with key "${key}" already exists in this clinic`);
    }
  }

  private async buildFoodUpdate(
    existing: DietChartFoodRow,
    dto: UpdateDietChartFoodDto,
    clinicId: string
  ): Promise<Record<string, string | boolean | null>> {
    const data: Record<string, string | boolean | null> = {};
    if (dto.key !== undefined) {
      const key = this.slugify(dto.key);
      if (!key) {
        throw new BadRequestException('key must contain at least one letter or digit');
      }
      if (key !== existing.key) {
        await this.assertKeyAvailable(clinicId, key);
        data['key'] = key;
      }
    }
    if (dto.nameEn !== undefined) {
      const nameEn = this.cleanText(dto.nameEn);
      if (!nameEn) {
        throw new BadRequestException('nameEn cannot be blank');
      }
      data['nameEn'] = nameEn;
    }
    if (dto.nameGu !== undefined) data['nameGu'] = this.cleanText(dto.nameGu);
    if (dto.nameHi !== undefined) data['nameHi'] = this.cleanText(dto.nameHi);
    if (dto.nameMr !== undefined) data['nameMr'] = this.cleanText(dto.nameMr);
    if (dto.group !== undefined) data['group'] = this.cleanText(dto.group)?.toLowerCase() ?? null;
    if (dto.isActive !== undefined) data['isActive'] = dto.isActive;
    return data;
  }

  private async audit(
    entry: AuditEntry,
    status: 'SUCCESS' | 'FAILURE',
    error?: unknown
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : undefined;
    await this.loggingService.log(
      LogType.AUDIT,
      status === 'SUCCESS' ? LogLevel.INFO : LogLevel.ERROR,
      `Audit trail: ${entry.operation} - ${status}`,
      SERVICE_NAME,
      {
        ...entry,
        status,
        ...(errorMessage ? { errorMessage } : {}),
        timestamp: new Date().toISOString(),
      }
    );
  }

  private slugify(value: string): string {
    return value
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, MAX_KEY_LENGTH);
  }

  private cleanText(value: string | undefined | null): string | null {
    if (value === undefined || value === null) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private toLanguage(value: string): DietChartLanguage {
    return (DIET_CHART_LANGUAGES as readonly string[]).includes(value)
      ? (value as DietChartLanguage)
      : DEFAULT_LANGUAGE;
  }

  private toChartResponse(
    visitId: string,
    header: DietChartHeaderRow | null,
    items: DietChartItemRow[]
  ): VisitDietChartResponse {
    const ordered = [...items].sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(a.category as DietAdviceCategory) -
          CATEGORY_ORDER.indexOf(b.category as DietAdviceCategory) || a.sortOrder - b.sortOrder
    );
    return {
      visitId,
      printLanguage: header ? this.toLanguage(header.printLanguage) : DEFAULT_LANGUAGE,
      notes: header?.notes ?? null,
      items: ordered.map(row => this.toItemResponse(row)),
      updatedAt: header ? new Date(header.updatedAt).toISOString() : null,
    };
  }

  private toItemResponse(row: DietChartItemRow): VisitDietChartItemResponse {
    return {
      id: row.id,
      visitId: row.visitId,
      category: row.category as DietAdviceCategory,
      foodId: row.foodId ?? null,
      nameEn: row.nameEn,
      nameGu: row.nameGu ?? null,
      nameHi: row.nameHi ?? null,
      nameMr: row.nameMr ?? null,
      note: row.note ?? null,
      sortOrder: row.sortOrder ?? 0,
      recordedBy: row.recordedBy ?? null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }

  private toFoodResponse(row: DietChartFoodRow): DietChartFoodResponse {
    return {
      id: row.id,
      clinicId: row.clinicId ?? null,
      key: row.key,
      nameEn: row.nameEn,
      nameGu: row.nameGu ?? null,
      nameHi: row.nameHi ?? null,
      nameMr: row.nameMr ?? null,
      group: row.group ?? null,
      isActive: row.isActive,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }
}
