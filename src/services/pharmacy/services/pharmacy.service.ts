import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { DatabaseService } from '@infrastructure/database';
import { EventService } from '@infrastructure/events/event.service';
import { LoggingService } from '@infrastructure/logging';
import { CacheService } from '@infrastructure/cache/cache.service';
import {
  CreateMedicineDto,
  UpdateInventoryDto,
  CreatePharmacyPrescriptionDto,
  UpdatePharmacyPrescriptionDto,
  DispensePrescriptionDto,
  PrescriptionStatus,
  publishedPrescriptionStatusFilter,
  CreateSupplierDto,
  UpdateSupplierDto,
  INVENTORY_DEFAULT_EXPIRING_DAYS,
  INVENTORY_MAX_PAGE_SIZE,
  LOW_STOCK_DEFAULT_LIMIT,
  LOW_STOCK_MAX_LIMIT,
  resolveMedicineTypeInput,
  type InventoryFilters,
} from '@dtos/pharmacy.dto';
import type { Medicine } from '@core/types/database.types';
import { summarizeStockLevels, type StockLevelSummary } from '@utils/stock-level.util';
import {
  duplicateMedicineMessage,
  normalizeMedicineForm,
  normalizeMedicineName,
} from '@services/pharmacy/services/medicine-identity.util';
import { loadDashboardMetrics, loadSalesReport } from './pharmacy-sales.queries';
import {
  findDoctorIdOfUser,
  loadPrescriptionPage,
  loadPrescriptionSummary,
} from '@services/pharmacy/services/prescription-list.queries';
import {
  PrescriptionListRangeError,
  type PrescriptionListFilters,
  type PrescriptionListScope,
  type PrescriptionSummary,
} from '@services/pharmacy/services/prescription-list.util';
import {
  DEFAULT_STATS_PERIOD,
  type SalesGroupBy,
  type SalesReport,
  type StatsPeriod,
} from './pharmacy-sales.util';
import { buildPrescriptionPdf } from './prescription-pdf.util';
import { prescriptionPdfFileName } from '@services/pharmacy/services/prescription-file-name.util';
import {
  cancelRefusal,
  cashSettlesInvoice,
  derivePrescriptionPaymentState,
  dispenseStateOf,
  isUnapprovedPrescription,
  planPrescriptionCash,
  planPrescriptionPaymentAttempt,
  prescriptionBillingRefusal,
  type PrescriptionAttemptRow,
} from '@services/pharmacy/services/prescription-payment.util';
import { PAYMENT_EXPIRES_AT_KEY, paymentWindowEnd } from '@services/billing/payment-window.util';
import {
  IDEMPOTENCY_IN_FLIGHT_TTL_SECONDS,
  IDEMPOTENCY_TTL_SECONDS,
  idempotencyCacheKey,
  parseIdempotencyKey,
  readStoredResponse,
} from '@services/billing/idempotency-key.util';
import {
  buildPharmacyInvoiceDescription,
  prescriptionReference,
} from '@services/billing/invoice-description.util';
import {
  PAST_EXPIRY_MESSAGE,
  isFutureExpiry,
} from '@services/pharmacy/services/medicine-expiry.util';
import { loadPrescriptionPdfContext } from '@services/pharmacy/services/prescription-pdf-context.util';
import {
  EMPTY_HANDOVER_STATE,
  latestHandoverByPrescription,
  readyForHandoverAfter,
  type HandoverStateRow,
  type PrescriptionHandoverState,
} from '@services/pharmacy/services/prescription-handover-state.util';
import {
  isOffMedicineDesk,
  medicineDeskLifecycleStatus,
  type MedicineDeskLifecycleStatus,
} from '@services/pharmacy/services/medicine-desk-status.util';
import {
  LEGACY_PRESCRIPTION_LIST_LIMIT,
  MEDICINE_DESK_ACTIVE_STATUSES,
  sliceLegacyPrescriptionWindow,
  type LegacyPrescriptionList,
} from '@services/pharmacy/services/prescription-legacy-list.util';
import { toSlimPrescriptionListRow } from '@services/pharmacy/services/prescription-list-slim.util';
import { LogLevel, LogType, AppointmentQueueCategory } from '@core/types';
import { PrismaDelegateArgs, PrismaTransactionClientWithDelegates } from '@core/types/prisma.types';
import { PaymentMethod, PaymentStatus, Role } from '@core/types/enums.types';
import { PaymentService } from '@payment/payment.service';
import type { PaymentIntentOptions, PaymentResult } from '@core/types/payment.types';
import { PaymentProvider } from '@core/types/payment.types';
import { AppointmentQueueService } from '@infrastructure/queue';
import { InventoryService } from '@services/pharmacy-inventory/services/inventory.service';
import { ExpiryAlertService } from '@services/pharmacy-inventory/services/expiry-alert.service';
import {
  PHARMACY_SUPPLIER_CACHE_TAGS,
  invalidatePharmacyCacheTags,
} from '@services/pharmacy-inventory/services/pharmacy-cache-invalidation.util';
import {
  isPatientRole,
  isPatientTargetAllowed,
  resolvePatientAccessScope,
} from '@core/guards/patient-self-access.guard';

/** The authenticated caller of a pharmacy write (audit trail + dispensed-by). */
export interface PharmacyActor {
  readonly userId?: string | undefined;
  readonly role?: string | undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Selected columns of the patient's user shown on prescriptions and the pharmacy desk. */
const PATIENT_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  age: true,
  gender: true,
  dateOfBirth: true,
} as const;

/** Relations of a prescription list row (legacy list and paged list share the row shape). */
const PRESCRIPTION_LIST_INCLUDE = {
  items: { include: { medicine: true } },
  patient: { include: { user: { select: PATIENT_USER_SELECT } } },
  doctor: { include: { user: { select: { id: true, name: true } } } },
  location: true,
} as const;

/** Roles that may list DRAFT / RETURNED prescriptions (assistant-doctor review workflow). */
const DRAFT_LISTING_ROLES: ReadonlySet<string> = new Set([
  'DOCTOR',
  'ASSISTANT_DOCTOR',
  'CLINIC_ADMIN',
  'SUPER_ADMIN',
]);

/** Caller of the prescription list / summary. */
export interface PrescriptionListCallerContext {
  readonly role?: string | undefined;
  readonly userId?: string | undefined;
}

/**
 * Deterministic per-clinic prescription number: RX-<IST yyyymmdd>-<first 8 id chars>.
 * The same expression backfills existing rows in the 20261004100000 migration, so the
 * stored column and a computed fallback always agree.
 */
export function buildPrescriptionNumber(prescription: {
  id: string;
  date?: Date | string | null;
}): string {
  return prescriptionReference({ id: prescription.id, date: prescription.date ?? null });
}

/**
 * Batch audit date filter -> inclusive epoch bound in IST.
 * - `YYYY-MM-DD`: the whole IST day (00:00:00.000 .. 23:59:59.999 IST).
 * - A timestamp sitting exactly on midnight UTC or midnight IST (what a date picker sends,
 *   e.g. `new Date('2026-05-31').toISOString()`) is treated as that picked day, so the
 *   "To" day is no longer left out.
 * - Any other timestamp is used as-is.
 */
/**
 * A prescription's validity end. A date-only value means the end of that IST day; a full
 * timestamp is kept as given. Invalid input is rejected so a typo cannot silently create an
 * open-ended prescription.
 */
export function resolveValidUntil(value: string): Date {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(dateOnly ? `${value}T23:59:59.999+05:30` : value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException('validUntil must be a valid date (YYYY-MM-DD or ISO timestamp)');
  }
  return parsed;
}

export function resolveAuditDateBound(
  value: string | undefined,
  edge: 'start' | 'end'
): number | null {
  if (!value) {
    return null;
  }
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const time = new Date(dateOnly ? `${value}T00:00:00.000+05:30` : value).getTime();
  if (Number.isNaN(time)) {
    return null;
  }

  let dayStart: number | null = null;
  if (dateOnly || (time + IST_OFFSET_MS) % DAY_MS === 0) {
    dayStart = time;
  } else if (time % DAY_MS === 0) {
    dayStart = time - IST_OFFSET_MS;
  }
  if (dayStart === null) {
    return time;
  }
  return edge === 'start' ? dayStart : dayStart + DAY_MS - 1;
}

/** Who is asking for a per-patient prescription list (drives clinic scoping). */
export interface PrescriptionListCaller {
  readonly role?: string | undefined;
  readonly clinicId?: string | undefined;
}

type PrescriptionDispenseItem = {
  id?: string;
  prescriptionItemId?: string | null;
  medicineId?: string | null;
  quantity?: number | null;
  dispensedQuantity?: number | null;
  dispensedAt?: Date | string | null;
  dispensedBatchNumber?: string | null;
  dispensedBatchExpiryDate?: Date | string | null;
  dispenseBatchHistory?: PrescriptionDispenseBatchHistoryEntry[] | null;
  dispenseEventHistory?: PrescriptionDispenseBatchHistoryEntry[] | null;
  medicine?: {
    price?: number | null;
    name?: string | null;
    stock?: number | null;
    unit?: string | null;
  } | null;
};

type PrescriptionDispenseBatchHistoryEntry = {
  dispensedById?: string | null;
  dispensedByName?: string | null;
  quantity: number;
  batchNumber?: string | null;
  expiryDate?: string | null;
  dispensedAt: string;
  medicineId?: string | null;
  originalMedicineId?: string | null;
  substituteMedicineId?: string | null;
  eventType?: 'DISPENSE' | 'SUBSTITUTION' | 'REVERSAL';
  reason?: string | null;
  reversedAt?: string | null;
  reversalReason?: string | null;
};

type PrescriptionDispenseRequestItem = {
  medicineId: string;
  prescriptionItemId?: string;
  substituteMedicineId?: string;
  substitutionReason?: string;
  quantity: number;
  lots: Array<{
    quantity: number;
    batchNumber?: string;
    expiryDate?: string;
  }>;
};

type PharmacyBatchAuditEntry = {
  prescriptionId: string;
  prescriptionItemId: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  medicineId: string;
  medicineName: string;
  originalMedicineId: string;
  originalMedicineName: string;
  substituteMedicineId?: string | null;
  substituteMedicineName?: string | null;
  batchNumber?: string | null;
  expiryDate?: string | null;
  quantity: number;
  eventType: 'DISPENSE' | 'SUBSTITUTION' | 'REVERSAL';
  eventAt: string;
  reason?: string | null;
  reversedAt?: string | null;
  reversalReason?: string | null;
  dispensedById?: string | null;
  dispensedByName?: string | null;
};

type LooseRecord = Record<string, unknown>;
type LooseDelegate = {
  findMany: (args: PrismaDelegateArgs) => Promise<LooseRecord[]>;
  findFirst: (args: PrismaDelegateArgs) => Promise<LooseRecord | null>;
  count: (args: PrismaDelegateArgs) => Promise<number>;
};

/** Per-prescription desk data resolved with batched lookups (see loadPrescriptionDeskContext). */
type PrescriptionDeskContext = {
  visitTypeByAppointmentId: Map<string, string>;
  opdNumberByVisitId: Map<string, string>;
  latestOpdByPatientClinic: Map<string, string>;
  /** `<clinicId>:<patientId>` -> the clinic-issued health ID (UHID). */
  uhidByPatientClinic: Map<string, string>;
  /** `<clinicId>:<patientId>` -> a phone kept outside the login (imported patients have no login phone). */
  contactPhoneByPatientClinic: Map<string, string>;
};

/** One page of the inventory list (`page` is 1-based) plus the total of matching rows. */
export interface InventoryPage {
  data: Medicine[];
  total: number;
  page: number;
  limit: number;
}

/**
 * A Prisma field reference (`delegate.fields.<column>`, Prisma >= 5) so a row can be compared
 * with one of its own columns in SQL (`stock <= minStockThreshold`). The loosely typed delegates
 * of this module do not declare `fields`; the raw client handed out by DatabaseService has it.
 * Returns null when the client does not expose field references (the caller falls back to a
 * parameterised raw query).
 */
function medicineFieldRef(
  delegate: unknown,
  column: 'minStockThreshold'
): PrismaDelegateArgs | null {
  const fields = (delegate as { fields?: Record<string, unknown> }).fields;
  const ref = fields?.[column];
  return ref ? (ref as PrismaDelegateArgs) : null;
}

/**
 * Minimal shape of BillingService this module depends on. Resolved lazily
 * via ModuleRef (PharmacyModule does not import BillingModule, to avoid a
 * cross-domain module dependency) instead of constructor-injected.
 */
interface PrescriptionInvoiceRecord {
  id: string;
  invoiceNumber: string;
  status: string;
  totalAmount: number;
  prescriptionId: string | null;
}

type PrescriptionForAccess = Awaited<ReturnType<PharmacyService['getPrescriptionByIdForAccess']>>;

interface BillingServiceLike {
  ensurePrescriptionInvoice: (
    prescriptionId: string,
    clinicId: string,
    actor?: { userId?: string; role?: string }
  ) => Promise<PrescriptionInvoiceRecord>;
  findPrescriptionInvoice: (
    prescriptionId: string,
    clinicId?: string
  ) => Promise<PrescriptionInvoiceRecord | null>;
  findPrescriptionInvoices: (
    clinicId: string,
    prescriptionIds: string[]
  ) => Promise<Map<string, PrescriptionInvoiceRecord>>;
  recordInvoicePayment: (
    invoiceId: string,
    clinicId: string,
    options: {
      method: PaymentMethod;
      amount?: number;
      transactionId?: string;
      note?: string;
      actor?: { userId?: string; role?: string };
    }
  ) => Promise<{ invoice: PrescriptionInvoiceRecord; payment: { id: string } }>;
  markInvoiceAsPaid: (
    id: string,
    requester?: { userId?: string; role?: string; clinicId?: string },
    options?: { skipWhatsApp?: boolean }
  ) => Promise<unknown>;
  generateInvoicePDF?: (invoiceId: string) => Promise<void>;
  /** System void (PENDING-guarded: a PAID invoice is never voided). True when it voided. */
  voidInvoiceInternal: (
    invoiceId: string,
    clinicId: string,
    reason: string,
    extraMetadata?: Record<string, unknown>
  ) => Promise<boolean>;
}

@Injectable()
export class PharmacyService {
  private billingServiceRef: BillingServiceLike | null = null;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly paymentService: PaymentService,
    private readonly eventService: EventService,
    private readonly loggingService: LoggingService,
    private readonly appointmentQueueService: AppointmentQueueService,
    private readonly inventoryService: InventoryService,
    private readonly expiryAlertService: ExpiryAlertService,
    private readonly moduleRef: ModuleRef,
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService: CacheService
  ) {}

  private static readonly COMPLETED_PAYMENT_STATUS = 'COMPLETED';
  private static readonly PAYMENT_FOR_PRESCRIPTION_DISPENSE = 'PRESCRIPTION_DISPENSE';
  private static readonly MEDICINE_QUEUE_DOMAIN = 'medicine-desk';

  /**
   * Lazily resolves BillingService by its DI token instead of importing
   * BillingModule (which would create a cross-domain module dependency).
   * Returns null — rather than throwing — when unavailable so pharmacy
   * payment/dispense flows degrade gracefully (no invoice/printable receipt)
   * instead of hard-failing on a wiring issue.
   */
  private getBillingService(): BillingServiceLike | null {
    if (!this.billingServiceRef) {
      this.billingServiceRef = this.moduleRef.get<BillingServiceLike>('BILLING_SERVICE', {
        strict: false,
      });
    }
    return this.billingServiceRef;
  }

  /**
   * Best-effort: creates (or fetches) the PHARMACY invoice for a
   * prescription. Never throws — a billing hiccup must not block a cash
   * collection or dispense that the pharmacist is actively performing.
   */
  private async ensurePrescriptionInvoiceSafe(
    prescriptionId: string,
    clinicId: string,
    actor?: { userId?: string; role?: string }
  ): Promise<PrescriptionInvoiceRecord | null> {
    const billingService = this.getBillingService();
    if (!billingService) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'BILLING_SERVICE unavailable; skipping pharmacy invoice creation',
        'PharmacyService',
        { prescriptionId, clinicId }
      );
      return null;
    }

    try {
      return await billingService.ensurePrescriptionInvoice(prescriptionId, clinicId, actor);
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to ensure pharmacy invoice for prescription',
        'PharmacyService',
        {
          prescriptionId,
          clinicId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return null;
    }
  }

  private isSupportedPaymentProvider(provider: string): provider is PaymentProvider {
    return (
      provider === 'cashfree' ||
      provider === 'payu' ||
      provider === 'phonepe' ||
      provider === 'zoho' ||
      provider === 'razorpay' ||
      provider === 'stripe'
    );
  }

  private getMetadataStringValue(metadata: unknown, key: string): string | undefined {
    const metadataRecord = this.asRecord(metadata);
    const rawValue = metadataRecord?.[key];

    if (typeof rawValue === 'string') {
      return rawValue;
    }

    if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
      return String(rawValue);
    }

    return undefined;
  }

  private getPrescriptionPaymentMetadata(prescriptionId: string): Record<string, string> {
    return {
      prescriptionId,
      paymentFor: PharmacyService.PAYMENT_FOR_PRESCRIPTION_DISPENSE,
      queueCategory: AppointmentQueueCategory.MEDICINE_DESK,
    };
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private normalizePaymentProvider(provider?: string): PaymentProvider | undefined {
    if (!provider) {
      return undefined;
    }

    const normalized = provider.toLowerCase();
    return this.isSupportedPaymentProvider(normalized) ? normalized : undefined;
  }

  private getPrescriptionTotal(prescription: { items?: PrescriptionDispenseItem[] }): number {
    return Number(
      (prescription.items || [])
        .reduce((sum, item) => {
          const quantity = Number(item.quantity || 0);
          const unitPrice = Number(item.medicine?.price || 0);
          return sum + quantity * unitPrice;
        }, 0)
        .toFixed(2)
    );
  }

  private getPrescriptionPayments(
    payments: Array<{
      amount?: number | null;
      status?: PaymentStatus | string | null;
      metadata?: unknown;
    }>,
    prescriptionId: string
  ) {
    return payments.filter(payment => {
      return (
        this.getMetadataStringValue(payment.metadata, 'paymentFor') ===
          PharmacyService.PAYMENT_FOR_PRESCRIPTION_DISPENSE &&
        this.getMetadataStringValue(payment.metadata, 'prescriptionId') === prescriptionId
      );
    });
  }

  private buildPrescriptionPaymentState(
    prescription: {
      id: string;
      date?: Date | string | null;
      items?: PrescriptionDispenseItem[];
    },
    payments: Array<{
      id: string;
      amount?: number | null;
      status?: PaymentStatus | string | null;
      metadata?: unknown;
      createdAt?: Date | null;
    }>,
    invoiceStatus?: string | null
  ) {
    const totalAmount = this.getPrescriptionTotal(prescription);
    const linkedPayments = this.getPrescriptionPayments(payments, prescription.id);
    const collectedAmount = linkedPayments
      .filter(payment => String(payment.status) === PharmacyService.COMPLETED_PAYMENT_STATUS)
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    // One derivation for amounts + status (paise), so pendingAmount, paymentStatus and the
    // readyForHandover / waitingForPayment flags built from it never disagree.
    return {
      ...derivePrescriptionPaymentState({ totalAmount, collectedAmount, invoiceStatus }),
      payments: linkedPayments,
    };
  }

  /** How a medicine is named in a refusal message (never its UUID). */
  private medicineLabel(name: string | null | undefined): string {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    return trimmed ? trimmed : 'This medicine';
  }

  private getPrescriptionItemRemainingQuantity(item: PrescriptionDispenseItem): number {
    return Math.max(0, Number(item.quantity || 0) - Number(item.dispensedQuantity || 0));
  }

  /**
   * FILLED when nothing remains, PARTIAL while something is dispensed, PENDING when nothing is
   * (a full reverse-dispense goes back to PENDING instead of "PARTIAL with 0 dispensed").
   */
  private getPrescriptionDispenseStatus(items: PrescriptionDispenseItem[]): PrescriptionStatus {
    const state = dispenseStateOf(items);
    if (state === 'FILLED') return PrescriptionStatus.FILLED;
    return state === 'PARTIAL' ? PrescriptionStatus.PARTIAL : PrescriptionStatus.PENDING;
  }

  private normalizeDispenseRequestItems(
    items?: DispensePrescriptionDto['items']
  ): PrescriptionDispenseRequestItem[] {
    if (!items || items.length === 0) {
      return [];
    }

    const aggregated = new Map<string, PrescriptionDispenseRequestItem>();

    for (const item of items) {
      const requestKey = String(item.prescriptionItemId || item.medicineId);
      const current: PrescriptionDispenseRequestItem = aggregated.get(requestKey) || {
        medicineId: item.medicineId,
        ...(item.prescriptionItemId ? { prescriptionItemId: item.prescriptionItemId } : {}),
        quantity: 0,
        lots: [],
      };

      const lotQuantity = Number(item.quantity || 0);
      current.quantity += lotQuantity;
      current.lots.push({
        quantity: lotQuantity,
        ...(item.batchNumber ? { batchNumber: item.batchNumber } : {}),
        ...(item.expiryDate ? { expiryDate: item.expiryDate } : {}),
      });

      aggregated.set(requestKey, current);
    }

    return Array.from(aggregated.values());
  }

  private buildFullDispenseRequestItems(
    prescriptionItems: PrescriptionDispenseItem[]
  ): PrescriptionDispenseRequestItem[] {
    return prescriptionItems
      .filter(item => this.getPrescriptionItemRemainingQuantity(item) > 0 && item.medicineId)
      .map(item => ({
        medicineId: String(item.medicineId),
        quantity: this.getPrescriptionItemRemainingQuantity(item),
        ...(item.id ? { prescriptionItemId: String(item.id) } : {}),
        lots: [
          {
            quantity: this.getPrescriptionItemRemainingQuantity(item),
          },
        ],
      }));
  }

  private normalizeStoredDispenseBatchHistory(
    history: PrescriptionDispenseItem['dispenseBatchHistory']
  ): PrescriptionDispenseBatchHistoryEntry[] {
    if (!Array.isArray(history)) {
      return [];
    }

    return history
      .map((entry): PrescriptionDispenseBatchHistoryEntry | null => {
        const quantity = Number(entry?.quantity || 0);
        if (quantity <= 0) {
          return null;
        }

        return {
          quantity,
          ...(entry?.batchNumber ? { batchNumber: entry.batchNumber } : {}),
          ...(entry?.expiryDate ? { expiryDate: entry.expiryDate } : {}),
          dispensedAt: String(entry?.dispensedAt || new Date().toISOString()),
        } as PrescriptionDispenseBatchHistoryEntry;
      })
      .filter((entry): entry is PrescriptionDispenseBatchHistoryEntry => Boolean(entry));
  }

  private normalizeStoredDispenseEventHistory(
    history: PrescriptionDispenseItem['dispenseEventHistory']
  ): PrescriptionDispenseBatchHistoryEntry[] {
    if (!Array.isArray(history)) {
      return [];
    }

    return history
      .map((entry): PrescriptionDispenseBatchHistoryEntry | null => {
        const quantity = Number(entry?.quantity || 0);
        if (quantity <= 0) {
          return null;
        }

        return {
          quantity,
          ...(entry?.batchNumber ? { batchNumber: entry.batchNumber } : {}),
          ...(entry?.expiryDate ? { expiryDate: entry.expiryDate } : {}),
          ...(entry?.medicineId ? { medicineId: entry.medicineId } : {}),
          ...(entry?.originalMedicineId ? { originalMedicineId: entry.originalMedicineId } : {}),
          ...(entry?.substituteMedicineId
            ? { substituteMedicineId: entry.substituteMedicineId }
            : {}),
          eventType:
            entry?.eventType === 'REVERSAL'
              ? 'REVERSAL'
              : entry?.eventType === 'SUBSTITUTION'
                ? 'SUBSTITUTION'
                : 'DISPENSE',
          dispensedAt: String(entry?.dispensedAt || new Date().toISOString()),
          ...(entry?.reason ? { reason: entry.reason } : {}),
          ...(entry?.reversedAt ? { reversedAt: String(entry.reversedAt) } : {}),
          ...(entry?.reversalReason ? { reversalReason: entry.reversalReason } : {}),
          ...(entry?.dispensedById ? { dispensedById: entry.dispensedById } : {}),
          ...(entry?.dispensedByName ? { dispensedByName: entry.dispensedByName } : {}),
        } as PrescriptionDispenseBatchHistoryEntry;
      })
      .filter((entry): entry is PrescriptionDispenseBatchHistoryEntry => Boolean(entry));
  }

  private buildDispenseEventHistoryEntry(args: {
    dispensedById?: string | null;
    dispensedByName?: string | null;
    quantity: number;
    medicineId: string;
    originalMedicineId: string;
    substituteMedicineId?: string | null;
    batchNumber?: string | null;
    expiryDate?: string | null;
    eventType?: 'DISPENSE' | 'SUBSTITUTION' | 'REVERSAL';
    reason?: string | null;
    dispensedAt?: Date;
    reversedAt?: Date | null;
    reversalReason?: string | null;
  }): PrescriptionDispenseBatchHistoryEntry {
    return {
      quantity: Number(args.quantity || 0),
      medicineId: args.medicineId,
      originalMedicineId: args.originalMedicineId,
      ...(args.substituteMedicineId ? { substituteMedicineId: args.substituteMedicineId } : {}),
      ...(args.batchNumber ? { batchNumber: args.batchNumber } : {}),
      ...(args.expiryDate ? { expiryDate: args.expiryDate } : {}),
      eventType: args.eventType || 'DISPENSE',
      dispensedAt: String(args.dispensedAt?.toISOString() || new Date().toISOString()),
      ...(args.reason ? { reason: args.reason } : {}),
      ...(args.reversedAt ? { reversedAt: args.reversedAt.toISOString() } : {}),
      ...(args.reversalReason ? { reversalReason: args.reversalReason } : {}),
      ...(args.dispensedById ? { dispensedById: args.dispensedById } : {}),
      ...(args.dispensedByName ? { dispensedByName: args.dispensedByName } : {}),
    };
  }

  private appendDispenseHistory(
    existingHistory: PrescriptionDispenseItem['dispenseBatchHistory'],
    entries: PrescriptionDispenseBatchHistoryEntry[]
  ): PrescriptionDispenseBatchHistoryEntry[] {
    return [...this.normalizeStoredDispenseBatchHistory(existingHistory), ...entries];
  }

  private appendDispenseEventHistory(
    existingHistory: PrescriptionDispenseItem['dispenseEventHistory'],
    entries: PrescriptionDispenseBatchHistoryEntry[]
  ): PrescriptionDispenseBatchHistoryEntry[] {
    return [...this.normalizeStoredDispenseEventHistory(existingHistory), ...entries];
  }

  private async recordPharmacyAuditLog(args: {
    userId: string;
    action: string;
    description: string;
    clinicId?: string | null;
    resourceType?: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          auditLog: { create: (input: PrismaDelegateArgs) => Promise<unknown> };
        };

        await typedClient.auditLog.create({
          data: {
            userId: args.userId,
            action: args.action,
            description: args.description,
            clinicId: args.clinicId ?? null,
            resourceType: args.resourceType ?? 'PHARMACY',
            resourceId: args.resourceId ?? null,
            metadata: args.metadata ?? {},
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: args.userId,
        clinicId: args.clinicId ?? 'unknown',
        resourceType: args.resourceType ?? 'PHARMACY',
        operation: 'CREATE',
        resourceId: args.resourceId ?? '',
        userRole: 'system',
        details: {
          action: args.action,
          description: args.description,
          ...(args.metadata || {}),
        },
      }
    );
  }

  private getMedicineDeskQueueOwnerId(clinicId: string): string {
    return `medicine-desk:${clinicId}`;
  }

  private getMedicineDeskQueueLifecycleStatus(args: {
    prescriptionStatus?: PrescriptionStatus | string | null;
    paymentStatus: 'PENDING' | 'PARTIAL' | 'PAID';
    isActiveQueueEntry: boolean;
  }): MedicineDeskLifecycleStatus {
    // Drafts (DRAFT / RETURNED) keep their own status; they are not waiting for payment.
    return medicineDeskLifecycleStatus(
      args.prescriptionStatus ? String(args.prescriptionStatus) : null,
      args.paymentStatus
    );
  }

  private toMedicineDeskQueueResponse<
    T extends {
      id: string;
      clinicId: string;
      patientId?: string;
      doctorId?: string;
      locationId?: string | null;
      status?: PrescriptionStatus | string | null;
      patient?: {
        user?: {
          id?: string | null;
          phone?: string | null;
          email?: string | null;
        } | null;
      } | null;
    },
  >(
    prescription: T,
    context: {
      paymentState: {
        totalAmount: number;
        paidAmount: number;
        pendingAmount: number;
        paymentStatus: 'PENDING' | 'PARTIAL' | 'PAID';
        canDispense: boolean;
      };
      queueOwnerId: string;
      queuePosition: number | null;
      totalInQueue: number;
      patientName: string;
      doctorName: string;
      medicineNames: string[];
      prescribedAt?: Date | string | null;
      locationName?: string | null;
      doctorRole?: string;
      invoice?: { id: string; invoiceNumber: string; status: string } | null;
    }
  ) {
    const queuePosition =
      typeof context.queuePosition === 'number' && context.queuePosition > 0
        ? context.queuePosition
        : null;
    const isActiveQueueEntry = queuePosition !== null;
    const prescriptionStatus = String(prescription.status || '').toUpperCase();
    const lifecycleStatus = this.getMedicineDeskQueueLifecycleStatus({
      prescriptionStatus: prescription.status ?? null,
      paymentStatus: context.paymentState.paymentStatus,
      isActiveQueueEntry,
    });

    return {
      ...prescription,
      ...context.paymentState,
      entryId: prescription.id,
      queueCategory: AppointmentQueueCategory.MEDICINE_DESK,
      queueOwnerId: context.queueOwnerId,
      queueStatus:
        lifecycleStatus === 'DISPENSED' ||
        lifecycleStatus === 'CANCELLED' ||
        lifecycleStatus === 'DRAFT' ||
        lifecycleStatus === 'RETURNED'
          ? lifecycleStatus
          : 'PENDING',
      status: prescriptionStatus === 'PARTIAL' ? 'PARTIAL' : lifecycleStatus,
      position: queuePosition,
      queuePosition,
      activeQueueEntry: isActiveQueueEntry,
      totalInQueue: context.totalInQueue,
      patientName: context.patientName,
      doctorName: context.doctorName,
      invoiceId: context.invoice?.id || null,
      invoiceNumber: context.invoice?.invoiceNumber || null,
      invoiceStatus: context.invoice?.status || null,
      downloadable: Boolean(context.invoice),
      patientUserId: prescription.patient?.user?.id || null,
      patientPhone: prescription.patient?.user?.phone || null,
      patientEmail: prescription.patient?.user?.email || null,
      assignedDoctorId: prescription.doctorId || null,
      primaryDoctorId: prescription.doctorId || null,
      doctorRole: String(context.doctorRole || 'DOCTOR').toUpperCase(),
      locationId: prescription.locationId || null,
      locationName: context.locationName || null,
      prescribedAt: context.prescribedAt || null,
      medicineNames: context.medicineNames,
      itemsCount: context.medicineNames.length,
      waitingForPayment: lifecycleStatus === 'WAITING_FOR_PAYMENT',
      readyForHandover: lifecycleStatus === 'READY_FOR_HANDOVER',
    };
  }

  /**
   * Keeps the medicine-desk queue in step with the given prescriptions.
   *
   * Default (subset) mode is additive: active prescriptions are enqueued and a
   * queue entry is removed only when ITS OWN prescription in the list is FILLED or
   * CANCELLED. Entries of prescriptions that are not in the list are never touched,
   * so single reads / per-patient lists / single-prescription writes can no longer
   * wipe the rest of the clinic's queue.
   *
   * `pruneMissing` additionally removes entries whose prescription is absent from
   * the list. Only pass it when the list is the COMPLETE set of prescriptions for
   * every clinic it spans (clinic-wide list / stats).
   */
  private async syncMedicineDeskQueueEntries<
    T extends {
      id: string;
      clinicId: string;
      patientId?: string;
      doctorId?: string;
      locationId?: string | null;
      status?: PrescriptionStatus | string | null;
      date?: Date | string | null;
    },
  >(prescriptions: T[], options: { pruneMissing?: boolean } = {}): Promise<void> {
    const groupedByClinic = prescriptions.reduce<Record<string, T[]>>(
      (accumulator, prescription) => {
        const clinicPrescriptions = accumulator[prescription.clinicId] || [];
        clinicPrescriptions.push(prescription);
        accumulator[prescription.clinicId] = clinicPrescriptions;
        return accumulator;
      },
      {}
    );

    for (const [clinicId, clinicPrescriptions] of Object.entries(groupedByClinic)) {
      clinicPrescriptions.sort((left, right) => {
        const leftTime = new Date(left.date || 0).getTime();
        const rightTime = new Date(right.date || 0).getTime();
        return leftTime - rightTime;
      });

      const queueOwnerId = this.getMedicineDeskQueueOwnerId(clinicId);
      const existingQueue = await this.appointmentQueueService.getOperationalQueue(
        queueOwnerId,
        clinicId,
        PharmacyService.MEDICINE_QUEUE_DOMAIN
      );
      // Finished, cancelled and still-draft prescriptions never sit in the desk queue.
      const isInactive = (prescription: T): boolean =>
        isOffMedicineDesk(prescription.status ? String(prescription.status) : null);
      const activePrescriptionIds = new Set(
        clinicPrescriptions.filter(prescription => !isInactive(prescription)).map(p => p.id)
      );
      const inactivePrescriptionIds = new Set(
        clinicPrescriptions.filter(isInactive).map(prescription => prescription.id)
      );

      for (const queueEntry of existingQueue) {
        if (!queueEntry.entryId) {
          continue;
        }
        const isStale = options.pruneMissing
          ? !activePrescriptionIds.has(queueEntry.entryId)
          : inactivePrescriptionIds.has(queueEntry.entryId);
        if (isStale) {
          await this.appointmentQueueService.removeOperationalQueueItem(
            queueEntry.entryId,
            queueOwnerId,
            clinicId,
            PharmacyService.MEDICINE_QUEUE_DOMAIN
          );
        }
      }

      for (const prescription of clinicPrescriptions) {
        if (isInactive(prescription)) {
          continue;
        }

        await this.appointmentQueueService.enqueueOperationalItem(
          {
            entryId: prescription.id,
            appointmentId: prescription.id,
            queueOwnerId,
            patientId: prescription.patientId || '',
            clinicId,
            ...(prescription.doctorId ? { assignedDoctorId: prescription.doctorId } : {}),
            ...(prescription.doctorId ? { primaryDoctorId: prescription.doctorId } : {}),
            ...(prescription.locationId ? { locationId: prescription.locationId } : {}),
            queueCategory: AppointmentQueueCategory.MEDICINE_DESK,
            type: AppointmentQueueCategory.MEDICINE_DESK,
          },
          PharmacyService.MEDICINE_QUEUE_DOMAIN
        );
      }
    }
  }

  private async enrichPrescriptionsWithPaymentState<
    T extends {
      id: string;
      clinicId: string;
      patientId?: string;
      doctorId?: string;
      locationId?: string | null;
      date?: Date | string | null;
      status?: PrescriptionStatus | string | null;
      items?: PrescriptionDispenseItem[];
      appointmentId?: string | null;
      visitId?: string | null;
      prescriptionNumber?: string | null;
      patient?: {
        id?: string;
        name?: string | null;
        user?: {
          id?: string | null;
          name?: string | null;
          phone?: string | null;
          email?: string | null;
          age?: number | null;
          gender?: string | null;
          dateOfBirth?: Date | string | null;
        } | null;
      } | null;
      doctor?: {
        id?: string;
        name?: string | null;
        user?: {
          id?: string | null;
          name?: string | null;
          role?: string | null;
        } | null;
      } | null;
      location?: {
        id?: string;
        name?: string | null;
      } | null;
    },
  >(
    prescriptions: T[],
    clinicId?: string,
    options: {
      /**
       * The list is every prescription of the clinic(s) it spans (clinic-wide list /
       * stats). Only then are all of the clinic's payments loaded and stale queue
       * entries pruned. Single reads and per-patient lists leave this unset: they load
       * only the payments of the listed prescriptions and never prune the queue.
       */
      completeClinicSet?: boolean;
      /**
       * The list is every ACTIVE (desk-queue) prescription of the clinic(s) it spans: stale
       * queue entries are pruned (as for a complete set), but only the listed prescriptions'
       * payments are loaded.
       */
      completeActiveDeskSet?: boolean;
    } = {}
  ) {
    if (prescriptions.length === 0) {
      return prescriptions;
    }

    // Payments and invoices are looked up per clinic. With a clinicId every listed prescription
    // belongs to it; without one (a patient's list across the clinics they are registered with)
    // each prescription is matched within its own clinic.
    const prescriptionIdsByClinic = this.groupPrescriptionIdsByClinic(prescriptions, clinicId);
    const payments =
      clinicId && options.completeClinicSet
        ? await this.findClinicPrescriptionDispensePayments(clinicId)
        : options.completeClinicSet
          ? []
          : await this.findPaymentsForClinicPrescriptions(prescriptionIdsByClinic);
    const invoicesByPrescriptionId = await this.findInvoicesForClinicPrescriptions(
      clinicId || !options.completeClinicSet ? prescriptionIdsByClinic : new Map<string, string[]>()
    );
    await this.syncMedicineDeskQueueEntries(prescriptions, {
      pruneMissing: options.completeClinicSet === true || options.completeActiveDeskSet === true,
    });
    const deskContext = await this.loadPrescriptionDeskContext(prescriptions);
    const handoverByPrescriptionId = await this.loadLatestHandovers(prescriptions);

    const queueByClinic = new Map<
      string,
      {
        positions: Map<string, number>;
        totalInQueue: number;
      }
    >();

    const clinicIds = Array.from(new Set(prescriptions.map(prescription => prescription.clinicId)));
    for (const currentClinicId of clinicIds) {
      const queueOwnerId = this.getMedicineDeskQueueOwnerId(currentClinicId);
      const queue = await this.appointmentQueueService.getOperationalQueue(
        queueOwnerId,
        currentClinicId,
        PharmacyService.MEDICINE_QUEUE_DOMAIN
      );

      queueByClinic.set(currentClinicId, {
        positions: new Map(
          queue
            .filter(queueEntry => queueEntry.entryId)
            .map(queueEntry => [String(queueEntry.entryId), Number(queueEntry.position || 0)])
        ),
        totalInQueue: queue.length,
      });
    }

    return prescriptions.map(prescription => {
      const paymentState = this.buildPrescriptionPaymentState(
        prescription,
        payments,
        invoicesByPrescriptionId.get(prescription.id)?.status ?? null
      );
      const queueState = queueByClinic.get(prescription.clinicId);
      const queuePosition = Number(queueState?.positions.get(prescription.id) || 0);
      const totalInQueue = Number(queueState?.totalInQueue || 0);

      const patientName =
        prescription.patient?.user?.name || prescription.patient?.name || 'Unknown Patient';
      const doctorName =
        prescription.doctor?.user?.name || prescription.doctor?.name || 'Unknown Doctor';
      const medicineNames = (prescription.items || [])
        .map(item => item.medicine)
        .filter((medicine): medicine is { price?: number | null; name?: string | null } =>
          Boolean(medicine)
        )
        .map(medicine => medicine.name || 'Medicine');

      const response = this.toMedicineDeskQueueResponse(prescription, {
        paymentState,
        queueOwnerId: this.getMedicineDeskQueueOwnerId(prescription.clinicId),
        queuePosition: queuePosition > 0 ? queuePosition : null,
        totalInQueue,
        patientName,
        doctorName,
        medicineNames,
        prescribedAt: prescription.date || null,
        locationName: prescription.location?.name || null,
        doctorRole: String(prescription.doctor?.user?.role || 'DOCTOR').toUpperCase(),
        invoice: invoicesByPrescriptionId.get(prescription.id) ?? null,
      });
      const handover = handoverByPrescriptionId.get(prescription.id) ?? EMPTY_HANDOVER_STATE;
      return {
        ...response,
        ...this.buildPrescriptionDeskFields(prescription, deskContext),
        readyForHandover: readyForHandoverAfter(response.readyForHandover, handover),
        handover: { ...handover },
      };
    });
  }

  /**
   * Latest counter hand-over per prescription in ONE query (no N+1). Scoped to the clinics of
   * the listed (already authorised) prescriptions. Best-effort: a failure only blanks the field.
   */
  private async loadLatestHandovers(
    prescriptions: Array<{ id: string; clinicId: string }>
  ): Promise<Map<string, PrescriptionHandoverState>> {
    const prescriptionIds = Array.from(new Set(prescriptions.map(rx => rx.id).filter(Boolean)));
    const clinicIds = Array.from(new Set(prescriptions.map(rx => rx.clinicId).filter(Boolean)));
    if (prescriptionIds.length === 0 || clinicIds.length === 0) {
      return new Map();
    }
    try {
      const rows = await this.databaseService.executeHealthcareRead(async client => {
        const delegate = (client as unknown as { dispenseHandover?: LooseDelegate })
          .dispenseHandover;
        if (!delegate) return [];
        return await delegate.findMany({
          where: {
            clinicId: { in: clinicIds },
            prescriptionId: { in: prescriptionIds },
            status: { not: 'SUPERSEDED' },
          } as PrismaDelegateArgs,
          select: {
            prescriptionId: true,
            status: true,
            createdAt: true,
            handedOverAt: true,
          } as PrismaDelegateArgs,
          orderBy: { createdAt: 'desc' } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      });
      return latestHandoverByPrescription(rows as unknown as HandoverStateRow[]);
    } catch (error) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Failed to load prescription hand-over state',
        'PharmacyService',
        { error: error instanceof Error ? error.message : String(error) }
      );
      return new Map();
    }
  }

  /**
   * Batched, best-effort lookups for the pharmacy desk fields: the visit type (from the
   * linked appointment) and the patient number (OPD number of the linked visit, else the
   * patient's latest visit at that clinic). Never throws: a failure only blanks those fields.
   */
  private async loadPrescriptionDeskContext(
    prescriptions: Array<{
      patientId?: string;
      clinicId: string;
      appointmentId?: string | null;
      visitId?: string | null;
    }>
  ): Promise<PrescriptionDeskContext> {
    const context: PrescriptionDeskContext = {
      visitTypeByAppointmentId: new Map(),
      opdNumberByVisitId: new Map(),
      latestOpdByPatientClinic: new Map(),
      uhidByPatientClinic: new Map(),
      contactPhoneByPatientClinic: new Map(),
    };
    const appointmentIds = Array.from(
      new Set(prescriptions.map(rx => rx.appointmentId).filter((id): id is string => Boolean(id)))
    );
    const visitIds = Array.from(
      new Set(prescriptions.map(rx => rx.visitId).filter((id): id is string => Boolean(id)))
    );
    const withoutVisit = prescriptions.filter(rx => !rx.visitId && rx.patientId);
    const patientIds = Array.from(
      new Set(prescriptions.map(rx => rx.patientId).filter((id): id is string => Boolean(id)))
    );
    if (
      appointmentIds.length === 0 &&
      visitIds.length === 0 &&
      withoutVisit.length === 0 &&
      patientIds.length === 0
    ) {
      return context;
    }

    try {
      await this.databaseService.executeHealthcareRead(async client => {
        const loose = client as unknown as {
          appointment?: LooseDelegate;
          patientVisit?: LooseDelegate;
          patientIdentifier?: LooseDelegate;
          patientContactPoint?: LooseDelegate;
        };
        if (patientIds.length > 0 && loose.patientIdentifier) {
          const rows = await loose.patientIdentifier.findMany({
            where: { patientId: { in: patientIds }, system: 'UHID' } as PrismaDelegateArgs,
            select: { patientId: true, clinicId: true, value: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
          for (const row of rows) {
            context.uhidByPatientClinic.set(
              `${String(row['clinicId'])}:${String(row['patientId'])}`,
              String(row['value'])
            );
          }
        }
        if (patientIds.length > 0 && loose.patientContactPoint) {
          const rows = await loose.patientContactPoint.findMany({
            where: { patientId: { in: patientIds }, system: 'phone' } as PrismaDelegateArgs,
            orderBy: { createdAt: 'asc' } as PrismaDelegateArgs,
            select: { patientId: true, clinicId: true, value: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
          for (const row of rows) {
            const key = `${String(row['clinicId'])}:${String(row['patientId'])}`;
            if (!context.contactPhoneByPatientClinic.has(key)) {
              context.contactPhoneByPatientClinic.set(key, String(row['value']));
            }
          }
        }
        if (appointmentIds.length > 0 && loose.appointment) {
          const rows = await loose.appointment.findMany({
            where: { id: { in: appointmentIds } } as PrismaDelegateArgs,
            select: { id: true, type: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
          for (const row of rows) {
            context.visitTypeByAppointmentId.set(String(row['id']), String(row['type']));
          }
        }
        if (loose.patientVisit && visitIds.length > 0) {
          const rows = await loose.patientVisit.findMany({
            where: { id: { in: visitIds } } as PrismaDelegateArgs,
            select: { id: true, opdNumber: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
          for (const row of rows) {
            context.opdNumberByVisitId.set(String(row['id']), String(row['opdNumber']));
          }
        }
        if (loose.patientVisit && withoutVisit.length > 0) {
          const rows = await loose.patientVisit.findMany({
            where: {
              clinicId: { in: Array.from(new Set(withoutVisit.map(rx => rx.clinicId))) },
              patientId: { in: Array.from(new Set(withoutVisit.map(rx => String(rx.patientId)))) },
            } as PrismaDelegateArgs,
            orderBy: { registrationDate: 'desc' } as PrismaDelegateArgs,
            select: { patientId: true, clinicId: true, opdNumber: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
          for (const row of rows) {
            const key = `${String(row['clinicId'])}:${String(row['patientId'])}`;
            if (!context.latestOpdByPatientClinic.has(key)) {
              context.latestOpdByPatientClinic.set(key, String(row['opdNumber']));
            }
          }
        }
      });
    } catch (error) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Failed to load pharmacy desk visit context',
        'PharmacyService',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
    return context;
  }

  private resolvePatientAge(
    user?: {
      age?: number | null;
      dateOfBirth?: Date | string | null;
    } | null
  ): number | null {
    if (user?.dateOfBirth) {
      const dob = new Date(user.dateOfBirth);
      if (!Number.isNaN(dob.getTime())) {
        const now = new Date();
        let years = now.getUTCFullYear() - dob.getUTCFullYear();
        const beforeBirthday =
          now.getUTCMonth() < dob.getUTCMonth() ||
          (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
        if (beforeBirthday) years -= 1;
        return Math.max(0, years);
      }
    }
    return typeof user?.age === 'number' ? user.age : null;
  }

  /** Item view for the desk: unit, batch/expiry actually dispensed and who dispensed it. */
  private toDeskItem(item: PrescriptionDispenseItem): Record<string, unknown> {
    const events = this.normalizeStoredDispenseEventHistory(
      item.dispenseEventHistory || item.dispenseBatchHistory || null
    ).filter(event => event.eventType !== 'REVERSAL' && !event.reversedAt);
    const last = events[events.length - 1];
    return {
      ...item,
      medicineUnit: item.medicine?.unit ?? null,
      batchNumber: item.dispensedBatchNumber ?? null,
      expiryDate: item.dispensedBatchExpiryDate ?? null,
      dispensedById: last?.dispensedById ?? null,
      dispensedByName: last?.dispensedByName ?? null,
    };
  }

  private buildPrescriptionDeskFields(
    prescription: {
      id: string;
      clinicId: string;
      patientId?: string;
      date?: Date | string | null;
      items?: PrescriptionDispenseItem[];
      appointmentId?: string | null;
      visitId?: string | null;
      prescriptionNumber?: string | null;
      patient?: {
        user?: {
          age?: number | null;
          gender?: string | null;
          phone?: string | null;
          dateOfBirth?: Date | string | null;
        } | null;
      } | null;
    },
    context: PrescriptionDeskContext
  ) {
    const items = (prescription.items || []).map(item => this.toDeskItem(item));
    const dispensedItems = items
      .filter(item => typeof item['dispensedByName'] === 'string' && item['dispensedAt'])
      .sort(
        (left, right) =>
          new Date(String(right['dispensedAt'])).getTime() -
          new Date(String(left['dispensedAt'])).getTime()
      );
    const latestDispense = dispensedItems[0];
    const patientNumber =
      (prescription.visitId ? context.opdNumberByVisitId.get(prescription.visitId) : undefined) ??
      context.latestOpdByPatientClinic.get(`${prescription.clinicId}:${prescription.patientId}`) ??
      null;

    const patientKey = `${prescription.clinicId}:${prescription.patientId}`;
    const uhid = context.uhidByPatientClinic.get(patientKey) ?? null;
    const contactPhone = context.contactPhoneByPatientClinic.get(patientKey) ?? null;

    return {
      items,
      // Imported patients have no login phone: fall back to the number kept with their contact points.
      patientPhone: prescription.patient?.user?.phone ?? contactPhone,
      patientUhid: uhid,
      prescriptionNumber: prescription.prescriptionNumber || buildPrescriptionNumber(prescription),
      appointmentId: prescription.appointmentId ?? null,
      pdfUrl: `/pharmacy/prescriptions/${prescription.id}/pdf`,
      patientAge: this.resolvePatientAge(prescription.patient?.user),
      patientGender: prescription.patient?.user?.gender ?? null,
      patientNumber,
      visitType: prescription.appointmentId
        ? (context.visitTypeByAppointmentId.get(prescription.appointmentId) ?? null)
        : null,
      dispensedById: (latestDispense?.['dispensedById'] as string | null | undefined) ?? null,
      dispensedBy: (latestDispense?.['dispensedByName'] as string | null | undefined) ?? null,
    };
  }

  /**
   * Payments linked to the given prescriptions only (metadata.prescriptionId),
   * instead of every payment the clinic ever took. `buildPrescriptionPaymentState`
   * still applies its own `paymentFor` / `prescriptionId` filter on the result, so
   * the computed payment state is identical to the clinic-wide load.
   */
  private async findPaymentsForPrescriptions(
    clinicId: string,
    prescriptionIds: string[]
  ): Promise<
    Array<{
      id: string;
      amount?: number | null;
      status?: PaymentStatus | string | null;
      metadata?: unknown;
      createdAt?: Date | null;
    }>
  > {
    const uniqueIds = Array.from(new Set(prescriptionIds.filter(id => id.length > 0)));
    if (uniqueIds.length === 0) {
      return [];
    }
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return await typedClient.payment.findMany({
        where: {
          clinicId,
          OR: uniqueIds.map(prescriptionId => ({
            metadata: { path: ['prescriptionId'], equals: prescriptionId },
          })),
        } as unknown as PrismaDelegateArgs,
        include: { invoice: true, appointment: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
  }

  /**
   * The clinic's prescription-dispense payments only (`metadata.paymentFor`), not every payment
   * it ever took: `buildPrescriptionPaymentState` ignores the others anyway, so the computed
   * state is identical while appointment / subscription payments stay in the database.
   */
  private async findClinicPrescriptionDispensePayments(
    clinicId: string
  ): ReturnType<PharmacyService['findPaymentsForPrescriptions']> {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return await typedClient.payment.findMany({
        where: {
          clinicId,
          metadata: {
            path: ['paymentFor'],
            equals: PharmacyService.PAYMENT_FOR_PRESCRIPTION_DISPENSE,
          },
        } as unknown as PrismaDelegateArgs,
        select: {
          id: true,
          amount: true,
          status: true,
          metadata: true,
          createdAt: true,
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
  }

  /** Prescription ids keyed by clinic: all under `clinicId` when given, else by their own clinic. */
  private groupPrescriptionIdsByClinic(
    prescriptions: ReadonlyArray<{ id: string; clinicId: string }>,
    clinicId?: string
  ): Map<string, string[]> {
    const grouped = new Map<string, string[]>();
    for (const prescription of prescriptions) {
      const key = clinicId || prescription.clinicId;
      if (!key) continue;
      grouped.set(key, [...(grouped.get(key) ?? []), prescription.id]);
    }
    return grouped;
  }

  /** Payments of the listed prescriptions, each matched within its clinic, in one query. */
  private async findPaymentsForClinicPrescriptions(
    prescriptionIdsByClinic: Map<string, string[]>
  ): ReturnType<PharmacyService['findPaymentsForPrescriptions']> {
    const entries = Array.from(prescriptionIdsByClinic.entries());
    if (entries.length <= 1) {
      const [only] = entries;
      return only ? await this.findPaymentsForPrescriptions(only[0], only[1]) : [];
    }
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return await typedClient.payment.findMany({
        where: {
          OR: entries.flatMap(([clinicId, ids]) =>
            Array.from(new Set(ids)).map(prescriptionId => ({
              clinicId,
              metadata: { path: ['prescriptionId'], equals: prescriptionId },
            }))
          ),
        } as unknown as PrismaDelegateArgs,
        include: { invoice: true, appointment: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
  }

  /** Pharmacy invoices of the listed prescriptions, one batched lookup per clinic. */
  private async findInvoicesForClinicPrescriptions(
    prescriptionIdsByClinic: Map<string, string[]>
  ): Promise<Map<string, PrescriptionInvoiceRecord>> {
    const perClinic = await Promise.all(
      Array.from(prescriptionIdsByClinic.entries()).map(([clinicId, ids]) =>
        this.findPrescriptionInvoicesSafe(clinicId, ids)
      )
    );
    return new Map(perClinic.flatMap(map => Array.from(map.entries())));
  }

  /** Best-effort batched invoice lookup — never throws. */
  private async findPrescriptionInvoicesSafe(
    clinicId: string,
    prescriptionIds: string[]
  ): Promise<Map<string, PrescriptionInvoiceRecord>> {
    const billingService = this.getBillingService();
    if (!billingService) {
      return new Map();
    }
    try {
      return await billingService.findPrescriptionInvoices(clinicId, prescriptionIds);
    } catch {
      return new Map();
    }
  }

  /**
   * Busts the cached prescription lists / summary (tags: prescriptions, pharmacy). Also called by
   * the assistant-doctor draft workflow (return / resubmit / discard), whose status changes do not
   * go through the medicine-desk queue. Never throws: a cache failure is logged.
   */
  async invalidatePrescriptionListCache(context: Record<string, string> = {}): Promise<void> {
    try {
      // With context.clinicId only that clinic's lists are busted (plus clinic-less entries);
      // without it, every clinic's (the old global behaviour).
      await this.cacheService.invalidateCollectionTags(
        ['prescriptions', 'pharmacy'],
        context['clinicId']
      );
    } catch (cacheError) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Failed to invalidate prescription list cache',
        'PharmacyService',
        { ...context, error: (cacheError as Error).message }
      );
    }
  }

  private async emitMedicineDeskQueueUpdated(
    clinicId: string,
    prescriptionId: string,
    action:
      'CREATED' | 'UPDATED' | 'PAYMENT_UPDATED' | 'DISPENSED' | 'PARTIALLY_DISPENSED' | 'CANCELLED'
  ) {
    // GET /pharmacy/prescriptions is cached (tags: pharmacy, prescriptions).
    // Every queue state change must bust it or the Prescription Management
    // page keeps showing "Payment pending" after a payment lands.
    await this.invalidatePrescriptionListCache({ prescriptionId, action, clinicId });

    try {
      const prescription = await this.getPrescriptionByIdForAccess(prescriptionId, clinicId);
      const queue = await this.getMedicineDeskQueue(clinicId);
      const activeEntry = queue.find(
        item => String((item as { id?: string }).id || '') === prescriptionId
      ) as
        | {
            position?: number | null;
            queuePosition?: number | null;
            status?: string;
            paymentStatus?: string;
            pendingAmount?: number;
            queueStatus?: string;
            totalInQueue?: number;
            readyForHandover?: boolean;
          }
        | undefined;
      const patientUser = prescription.patient?.user;
      const doctorUser = prescription.doctor?.user;
      const medicineNames = (prescription.items || [])
        .map(item => item.medicine?.name)
        .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);

      await this.eventService.emit('pharmacy.medicine_desk.updated', {
        clinicId,
        prescriptionId,
        action,
        entryId: prescriptionId,
        patientId: patientUser?.id || prescription.patientId,
        patientProfileId: prescription.patientId,
        patientName: patientUser?.name || undefined,
        doctorId: doctorUser?.id || undefined,
        doctorProfileId: prescription.doctorId,
        doctorName: doctorUser?.name || undefined,
        medicationCount: prescription.items?.length || 0,
        medicationNames: medicineNames,
        queueCategory: AppointmentQueueCategory.MEDICINE_DESK,
        queueOwnerId: this.getMedicineDeskQueueOwnerId(clinicId),
        position: activeEntry?.position ?? activeEntry?.queuePosition ?? null,
        queuePosition: activeEntry?.queuePosition ?? activeEntry?.position ?? null,
        totalInQueue: activeEntry?.totalInQueue ?? 0,
        status: String(activeEntry?.status || 'WAITING_FOR_PAYMENT').toUpperCase(),
        paymentStatus: String(activeEntry?.paymentStatus || 'PENDING').toUpperCase(),
        pendingAmount: Number(activeEntry?.pendingAmount || 0),
        queueStatus: String(activeEntry?.queueStatus || 'PENDING').toUpperCase(),
        readyForHandover: Boolean(activeEntry?.readyForHandover),
      });
    } catch (error) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Failed to emit medicine desk queue update event',
        'PharmacyService',
        {
          clinicId,
          prescriptionId,
          action,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  private async getPrescriptionByIdForAccess(
    prescriptionId: string,
    clinicId?: string
  ): Promise<{
    id: string;
    clinicId: string;
    patientId: string;
    doctorId: string;
    status: PrescriptionStatus | string;
    date?: Date | string | null;
    prescriptionNumber?: string | null;
    items: Array<{
      quantity?: number | null;
      medicineId?: string | null;
      medicine?: { name?: string | null; price?: number | null } | null;
    }>;
    patient?: {
      user?: {
        id?: string | null;
        name?: string | null;
        email?: string | null;
        phone?: string | null;
      } | null;
    } | null;
    doctor?: {
      user?: {
        id?: string | null;
        name?: string | null;
        email?: string | null;
        phone?: string | null;
      } | null;
    } | null;
  }> {
    const prescription = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return await typedClient.prescription.findUnique({
        where: { id: prescriptionId } as PrismaDelegateArgs,
        include: {
          items: {
            include: {
              medicine: true,
            },
          },
          patient: {
            include: {
              user: {
                select: PATIENT_USER_SELECT,
              },
            },
          },
          doctor: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          location: true,
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });

    if (!prescription) {
      throw new NotFoundException('Prescription not found');
    }

    if (clinicId && prescription.clinicId !== clinicId) {
      throw new BadRequestException('Prescription does not belong to this clinic');
    }

    return prescription as {
      id: string;
      clinicId: string;
      patientId: string;
      doctorId: string;
      status: PrescriptionStatus | string;
      items: Array<{
        quantity?: number | null;
        medicineId?: string | null;
        medicine?: { name?: string | null; price?: number | null } | null;
      }>;
      patient?: {
        user?: {
          id?: string | null;
          name?: string | null;
          email?: string | null;
          phone?: string | null;
        } | null;
      } | null;
      doctor?: {
        user?: {
          id?: string | null;
          name?: string | null;
          email?: string | null;
          phone?: string | null;
        } | null;
      } | null;
    };
  }

  /**
   * Strict ownership for payment actions: a PATIENT may only pay / view the payment
   * summary of a prescription of THEIR OWN record. (Dependents are deliberately not
   * included here; they can read the prescription, see `ensurePatientMayReadPrescription`.)
   */
  private ensurePatientOwnsPrescription(
    prescription: {
      patient?: { user?: { id?: string | null } | null } | null;
    },
    actorUserId?: string,
    actorRole?: string
  ) {
    if (actorRole === 'PATIENT' && prescription.patient?.user?.id !== actorUserId) {
      throw new ForbiddenException('Patients can only access their own prescriptions');
    }
  }

  /**
   * Read access to a single prescription: a PATIENT may read their own and those of
   * an ACTIVE dependent they are the primary patient of (User.id or Patient.id,
   * resolved through the shared patient access scope). The request clinic plays no
   * part for a patient (multi-clinic patients), so ownership is the only gate; anyone
   * else gets a 404 (no existence oracle for other patients' prescription ids).
   * Staff are unchanged (scoped by clinic in `getPrescriptionByIdForAccess`).
   */
  private async ensurePatientMayReadPrescription(
    prescription: {
      patientId: string;
      patient?: { user?: { id?: string | null } | null } | null;
    },
    actor?: { userId?: string; role?: string }
  ): Promise<void> {
    if (!isPatientRole(actor?.role)) {
      return;
    }
    const callerUserId = actor?.userId ?? '';
    const ownerUserId = prescription.patient?.user?.id ?? '';
    if (callerUserId.length > 0 && ownerUserId === callerUserId) {
      return;
    }

    const scope =
      callerUserId.length > 0
        ? await resolvePatientAccessScope(this.databaseService, callerUserId)
        : new Set<string>();
    if (
      isPatientTargetAllowed(scope, ownerUserId) ||
      isPatientTargetAllowed(scope, prescription.patientId)
    ) {
      return;
    }
    throw new NotFoundException('Prescription not found');
  }

  /**
   * Every active medicine of the clinic matching the filters, ordered by name: the legacy
   * bare-array response of GET /pharmacy/inventory. Filtering happens in the database (search,
   * dosage form, classification, in stock, low stock through a field reference on the row's
   * own reorder level, expiring window).
   */
  async findAllMedicines(clinicId?: string, filters?: InventoryFilters): Promise<Medicine[]> {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return await typedClient.medicine.findMany({
        where: await this.buildInventoryWhere(typedClient, clinicId, filters),
        orderBy: { name: 'asc' },
      } as PrismaDelegateArgs);
    });
  }

  /** One page of {@link findAllMedicines} plus the total count of the same where clause. */
  async findInventoryPage(
    clinicId: string | undefined,
    filters: InventoryFilters | undefined,
    page: number,
    limit: number
  ): Promise<InventoryPage> {
    const safePage = Math.max(1, Math.trunc(page));
    const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), INVENTORY_MAX_PAGE_SIZE);
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      const where = await this.buildInventoryWhere(typedClient, clinicId, filters);
      const [data, total] = await Promise.all([
        typedClient.medicine.findMany({
          where,
          orderBy: { name: 'asc' },
          skip: (safePage - 1) * safeLimit,
          take: safeLimit,
        } as PrismaDelegateArgs),
        typedClient.medicine.count({ where } as PrismaDelegateArgs),
      ]);
      return { data, total, page: safePage, limit: safeLimit };
    });
  }

  /**
   * Prisma `where` of the inventory list. `lowStock` compares `stock` with the row's own
   * `minStockThreshold` through a field reference, so every filter runs in SQL; when the client
   * exposes no field references the matching ids come from a parameterised raw query instead.
   */
  private async buildInventoryWhere(
    typedClient: PrismaTransactionClientWithDelegates,
    clinicId: string | undefined,
    filters: InventoryFilters | undefined
  ): Promise<PrismaDelegateArgs> {
    const where: Record<string, unknown> = { isActive: true };
    if (clinicId) where['clinicId'] = clinicId;
    if (filters?.search) {
      const contains = { contains: filters.search, mode: 'insensitive' };
      where['OR'] = [{ name: contains }, { manufacturer: contains }, { category: contains }];
    }
    if (filters?.category) where['category'] = filters.category;
    if (filters?.type) where['type'] = filters.type;
    const stock: Record<string, unknown> = filters?.inStock ? { gt: 0 } : {};
    if (filters?.lowStock) {
      const thresholdRef = medicineFieldRef(typedClient.medicine, 'minStockThreshold');
      if (thresholdRef) {
        stock['lte'] = thresholdRef;
      } else {
        where['id'] = { in: await this.findLowStockMedicineIds(typedClient, clinicId) };
      }
    }
    if (Object.keys(stock).length > 0) where['stock'] = stock;
    // No stock left is always at or below the reorder level, so it narrows any stock filter.
    if (filters?.outOfStock) {
      where['stock'] = { lte: 0 };
      delete where['id'];
    }
    if (filters?.expiringSoon) {
      const days = Math.max(1, Math.trunc(filters.expiringDays ?? INVENTORY_DEFAULT_EXPIRING_DAYS));
      where['expiryDate'] = { not: null, lte: new Date(Date.now() + days * DAY_MS) };
    }
    return where as PrismaDelegateArgs;
  }

  /**
   * Fallback for clients without Prisma field references: the ids of the active medicines at or
   * below their reorder level, through a parameterised raw query (clinic-scoped when given).
   */
  private async findLowStockMedicineIds(
    typedClient: PrismaTransactionClientWithDelegates,
    clinicId: string | undefined
  ): Promise<string[]> {
    const rows = clinicId
      ? await typedClient.$queryRaw<
          Array<{ id: string }>
        >`SELECT "id" FROM "Medicine" WHERE "clinicId" = ${clinicId} AND "isActive" = true AND "stock" <= "minStockThreshold"`
      : await typedClient.$queryRaw<
          Array<{ id: string }>
        >`SELECT "id" FROM "Medicine" WHERE "isActive" = true AND "stock" <= "minStockThreshold"`;
    return rows.map(row => row.id);
  }

  async findMedicineById(id: string) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return await typedClient.medicine.findUnique({
        where: { id } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
  }

  private async invalidateInventoryCache(): Promise<void> {
    try {
      await this.cacheService.invalidateCacheByTag('inventory');
      await this.cacheService.invalidateCacheByTag('pharmacy');
    } catch (error) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Failed to invalidate pharmacy inventory cache',
        'PharmacyService',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /** A supplier must belong to the caller's clinic (never link another clinic's supplier). */
  private async assertSupplierInClinic(
    client: unknown,
    supplierId: string,
    clinicId: string
  ): Promise<void> {
    const loose = client as { supplier?: LooseDelegate };
    const supplier = await loose.supplier?.findFirst({
      where: { id: supplierId, clinicId, deletedAt: null } as PrismaDelegateArgs,
      select: { id: true } as PrismaDelegateArgs,
    } as PrismaDelegateArgs);
    if (!supplier) {
      throw new BadRequestException('Supplier does not belong to this clinic');
    }
  }

  private async resolveActorIdentity(actor?: PharmacyActor): Promise<{
    id?: string;
    name?: string;
  }> {
    if (!actor?.userId) {
      return {};
    }
    try {
      const row = await this.databaseService.executeHealthcareRead(async client => {
        const loose = client as unknown as {
          user?: { findUnique: (args: PrismaDelegateArgs) => Promise<LooseRecord | null> };
        };
        return loose.user
          ? await loose.user.findUnique({
              where: { id: actor.userId } as PrismaDelegateArgs,
              select: { name: true } as PrismaDelegateArgs,
            } as PrismaDelegateArgs)
          : null;
      });
      const name = row?.['name'];
      return { id: actor.userId, ...(typeof name === 'string' && name ? { name } : {}) };
    } catch {
      return { id: actor.userId };
    }
  }

  /**
   * Adds a medicine. `type` accepts the DB classification (CLASSICAL, PROPRIETARY, HERBAL)
   * or a dosage form (TABLET, SYRUP, CHURNA, ...). A dosage form alone defaults the
   * classification to CLASSICAL for the classical Ayurvedic forms and PROPRIETARY otherwise,
   * see `resolveMedicineTypeInput`.
   */
  async addMedicine(dto: CreateMedicineDto, clinicId?: string, actor?: PharmacyActor) {
    if (!clinicId) throw new BadRequestException('Clinic ID is required to add medicine');

    const resolved = resolveMedicineTypeInput(
      {
        type: dto.type,
        classification: dto.classification,
        category: dto.category,
      },
      'create'
    );
    if (!resolved.type) {
      throw new BadRequestException(`Invalid medicine type "${dto.type}"`);
    }
    const medicineType = resolved.type;
    const expiry = dto.expiryDate ? new Date(dto.expiryDate) : null;
    if (expiry && Number.isNaN(expiry.getTime())) {
      throw new BadRequestException('Invalid expiryDate');
    }
    if (expiry && !isFutureExpiry(expiry)) {
      throw new BadRequestException(PAST_EXPIRY_MESSAGE);
    }
    // Checked in a read before the write: an HTTP error thrown inside a write is re-wrapped.
    await this.databaseService.executeHealthcareRead(client =>
      this.assertMedicineNameFree(client, clinicId, dto.name, resolved.category ?? null)
    );

    const medicine = await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        if (dto.supplierId) {
          await this.assertSupplierInClinic(client, dto.supplierId, clinicId);
        }
        return await typedClient.medicine.create({
          data: {
            name: normalizeMedicineName(dto.name),
            manufacturer: dto.manufacturer,
            type: medicineType,
            ...(resolved.category ? { category: resolved.category } : {}),
            ...(dto.unit ? { unit: dto.unit } : {}),
            ...(dto.batchNumber ? { batchNumber: dto.batchNumber } : {}),
            ...(dto.notes ? { notes: dto.notes } : {}),
            properties: dto.description, // description -> properties
            dosage: dto.instructions, // usage instructions -> dosage
            stock: dto.quantity, // quantity -> stock
            price: dto.price,
            expiryDate: expiry,
            minStockThreshold: dto.minStockThreshold ?? 10,
            supplierId: dto.supplierId,
            clinicId: clinicId,
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: actor?.userId ?? 'system',
        clinicId: clinicId,
        resourceType: 'MEDICINE',
        operation: 'CREATE',
        resourceId: 'new',
        userRole: actor?.role ?? 'system',
        details: { name: dto.name },
      }
    );
    await this.invalidateInventoryCache();
    return medicine;
  }

  /**
   * Edits a medicine of the caller's clinic: any of name, type/category, manufacturer, unit,
   * price, batch, expiry, reorder level (minStockThreshold), supplier, description, usage
   * instructions, notes, active flag and a relative stock change. A dosage form sent as `type`
   * changes only `category`; the classification (`Medicine.type`) changes only through
   * `classification`. A medicine of another clinic is reported as not found.
   */
  async updateInventory(
    id: string,
    dto: UpdateInventoryDto,
    clinicId?: string,
    actor?: PharmacyActor
  ) {
    if (!clinicId) throw new BadRequestException('Clinic ID is required to update inventory');

    const resolved = resolveMedicineTypeInput(
      {
        type: dto.type,
        classification: dto.classification,
        category: dto.category,
      },
      'update'
    );
    if (dto.type !== undefined && !resolved.type && !resolved.category) {
      throw new BadRequestException(`Invalid medicine type "${dto.type}"`);
    }
    const expiry = dto.expiryDate !== undefined ? new Date(dto.expiryDate) : undefined;
    if (expiry && Number.isNaN(expiry.getTime())) {
      throw new BadRequestException('Invalid expiryDate');
    }
    if (expiry && !isFutureExpiry(expiry)) {
      throw new BadRequestException(PAST_EXPIRY_MESSAGE);
    }
    const changedFields = Object.entries(dto)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key);
    if (dto.name !== undefined || resolved.category) {
      const rename = { name: dto.name, form: resolved.category ?? null };
      await this.databaseService.executeHealthcareRead(client =>
        this.assertRenameFree(client, id, clinicId, rename)
      );
    }

    const medicine = await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;

        const existing = await typedClient.medicine.findUnique({
          where: { id } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);

        if (!existing || existing.clinicId !== clinicId) {
          throw new NotFoundException('Medicine not found');
        }
        const existingRecord = existing as unknown as {
          stock?: number | null;
          isActive?: boolean | null;
        };
        if (existingRecord.isActive === false && dto.isActive !== true) {
          throw new BadRequestException('Medicine is deactivated; re-activate it to edit it');
        }
        if (dto.supplierId) {
          await this.assertSupplierInClinic(client, dto.supplierId, clinicId);
        }
        if (dto.quantityChange !== undefined) {
          const nextStock = Number(existingRecord.stock ?? 0) + dto.quantityChange;
          if (nextStock < 0) {
            throw new BadRequestException('Stock cannot go below zero');
          }
        }

        const data: Record<string, unknown> = {
          ...(dto.quantityChange !== undefined && { stock: { increment: dto.quantityChange } }),
          ...(dto.price !== undefined && { price: dto.price }),
          ...(dto.name !== undefined && { name: normalizeMedicineName(dto.name) }),
          ...(resolved.type && { type: resolved.type }),
          ...(resolved.category && { category: resolved.category }),
          ...(dto.manufacturer !== undefined && { manufacturer: dto.manufacturer }),
          ...(dto.unit !== undefined && { unit: dto.unit }),
          ...(dto.batchNumber !== undefined && { batchNumber: dto.batchNumber }),
          ...(expiry && { expiryDate: expiry }),
          ...(dto.minStockThreshold !== undefined && {
            minStockThreshold: dto.minStockThreshold,
          }),
          ...(dto.supplierId !== undefined && { supplierId: dto.supplierId }),
          ...(dto.description !== undefined && { properties: dto.description }),
          ...(dto.instructions !== undefined && { dosage: dto.instructions }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          ...(dto.isActive !== undefined && {
            isActive: dto.isActive,
            deletedAt: dto.isActive ? null : new Date(),
          }),
        };
        if (Object.keys(data).length === 0) {
          throw new BadRequestException('No editable fields supplied');
        }

        const quantityChange = dto.quantityChange ?? 0;
        if (quantityChange >= 0) {
          return await typedClient.medicine.update({
            where: { id } as PrismaDelegateArgs,
            data: data as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        }
        // A stock reduction is guarded at write time (`stock >= |change|`): the snapshot check
        // above cannot stop two concurrent reductions (or a reduction racing a dispense) from
        // driving the stock below zero.
        const guarded = await typedClient.medicine.updateMany({
          where: { id, clinicId, stock: { gte: Math.abs(quantityChange) } } as PrismaDelegateArgs,
          data: data as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        if (guarded.count !== 1) {
          throw new ConflictException(
            'Stock changed meanwhile and cannot go below zero, reload and retry'
          );
        }
        return await typedClient.medicine.findUnique({
          where: { id } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: actor?.userId ?? 'system',
        clinicId,
        resourceType: 'MEDICINE',
        operation: 'UPDATE',
        resourceId: id,
        userRole: actor?.role ?? 'system',
        details: { fields: changedFields },
      }
    );
    await this.invalidateInventoryCache();
    return medicine;
  }

  /**
   * Soft delete (deactivate). The row is never removed, so prescriptions and the dispense /
   * batch audit history keep resolving the medicine. Refused while an open (PENDING or
   * PARTIAL) prescription still lists it. Idempotent.
   */
  async deleteMedicine(id: string, clinicId?: string, actor?: PharmacyActor) {
    if (!clinicId) throw new BadRequestException('Clinic ID is required to delete a medicine');

    const result = await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        const loose = client as unknown as { prescriptionItem: LooseDelegate };

        const existing = await typedClient.medicine.findUnique({
          where: { id } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        if (!existing || existing.clinicId !== clinicId) {
          throw new NotFoundException('Medicine not found');
        }
        const record = existing as unknown as { isActive?: boolean | null };
        if (record.isActive === false) {
          return { id, isActive: false, alreadyDeleted: true, hasDispenseHistory: true };
        }

        const openPrescriptions = await loose.prescriptionItem.count({
          where: {
            medicineId: id,
            clinicId,
            prescription: { status: { in: ['PENDING', 'PARTIAL'] } },
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        if (openPrescriptions > 0) {
          throw new BadRequestException(
            `Medicine is used by ${openPrescriptions} open prescription item(s); dispense or cancel them first`
          );
        }
        const dispensed = await loose.prescriptionItem.count({
          where: { medicineId: id, clinicId, dispensedQuantity: { gt: 0 } } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);

        await typedClient.medicine.update({
          where: { id } as PrismaDelegateArgs,
          data: { isActive: false, deletedAt: new Date() } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        return { id, isActive: false, alreadyDeleted: false, hasDispenseHistory: dispensed > 0 };
      },
      {
        userId: actor?.userId ?? 'system',
        clinicId,
        resourceType: 'MEDICINE',
        operation: 'DELETE',
        resourceId: id,
        userRole: actor?.role ?? 'system',
        details: { softDelete: true },
      }
    );
    await this.invalidateInventoryCache();
    return result;
  }

  /**
   * Legacy (no `page`) list: the most recent LEGACY_PRESCRIPTION_LIST_LIMIT prescriptions of the
   * clinic (drafts excluded), newest first, instead of every prescription ever written. `total`
   * is only counted when the window is truncated (one extra row is fetched to detect it).
   */
  async findRecentPrescriptions(
    clinicId?: string,
    scope?: { readonly doctorUserId?: string; readonly medicinesOnly?: boolean },
    limit: number = LEGACY_PRESCRIPTION_LIST_LIMIT
  ): Promise<LegacyPrescriptionList<Record<string, unknown>>> {
    // Drafts / returned drafts are an assistant-doctor review workflow, not prescriptions yet.
    const where: Record<string, unknown> = { status: { notIn: ['DRAFT', 'RETURNED'] } };
    if (clinicId) where['clinicId'] = clinicId;
    // A doctor sees the prescriptions they wrote, not every prescription of the clinic.
    if (scope?.doctorUserId) where['doctor'] = { userId: scope.doctorUserId };
    // The pharmacist desk / hand-over lists skip note-only (advice) prescriptions: no medicine.
    if (scope?.medicinesOnly) where['items'] = { some: {} };

    const { rows, truncated, total } = await this.databaseService.executeHealthcareRead(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        const fetched = await typedClient.prescription.findMany({
          where: where as PrismaDelegateArgs,
          include: PRESCRIPTION_LIST_INCLUDE as unknown as PrismaDelegateArgs,
          orderBy: [{ date: 'desc' }, { id: 'desc' }] as unknown as PrismaDelegateArgs,
          take: limit + 1,
        } as PrismaDelegateArgs);
        const window = sliceLegacyPrescriptionWindow(fetched, limit);
        const count = window.truncated
          ? await typedClient.prescription.count({
              where: where as PrismaDelegateArgs,
            } as PrismaDelegateArgs)
          : window.rows.length;
        return { ...window, total: count };
      }
    );

    // Complete set only when nothing was cut off: then (as before) every clinic payment is read
    // and stale queue entries are pruned. A truncated window is a subset: payments of the listed
    // prescriptions only, no pruning (getMedicineDeskQueue / stats keep the queue in step).
    const data = await this.enrichPrescriptionsWithPaymentState(rows, clinicId, {
      completeClinicSet: !scope?.doctorUserId && !scope?.medicinesOnly && !truncated,
    });
    return { data: data as unknown as Array<Record<string, unknown>>, total, truncated };
  }

  /** Every active (desk-queue) prescription of the clinic, via the clinicId+status index. */
  private async findActiveDeskPrescriptions(clinicId?: string) {
    const prescriptions = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      const where: Record<string, unknown> = {
        status: { in: [...MEDICINE_DESK_ACTIVE_STATUSES] },
      };
      if (clinicId) where['clinicId'] = clinicId;
      return await typedClient.prescription.findMany({
        where: where as PrismaDelegateArgs,
        include: PRESCRIPTION_LIST_INCLUDE as unknown as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
    return await this.enrichPrescriptionsWithPaymentState(prescriptions, clinicId, {
      completeActiveDeskSet: true,
    });
  }

  /**
   * Clinic (and, for a DOCTOR, own-prescription) scope of the paged list and the summary.
   * Null when a DOCTOR caller has no doctor profile: they wrote nothing.
   */
  private async resolvePrescriptionListScope(
    clinicId: string | undefined,
    caller: PrescriptionListCallerContext
  ): Promise<PrescriptionListScope | null> {
    if (!clinicId) {
      throw new ForbiddenException('Clinic context required');
    }
    const role = String(caller.role ?? '').toUpperCase();
    const allowDrafts = DRAFT_LISTING_ROLES.has(role);
    if (role !== String(Role.DOCTOR)) {
      // The pharmacist works the medicine desk: a note-only prescription has nothing to dispense.
      return role === String(Role.PHARMACIST)
        ? { clinicId, allowDrafts, medicinesOnly: true }
        : { clinicId, allowDrafts };
    }
    const doctorId = caller.userId
      ? await findDoctorIdOfUser(this.databaseService, caller.userId)
      : null;
    return doctorId ? { clinicId, doctorId, allowDrafts } : null;
  }

  /** A bad dateFrom / dateTo is the caller's mistake (400), anything else propagates. */
  private rethrowRangeError(error: unknown): never {
    if (error instanceof PrescriptionListRangeError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }

  /**
   * One page of prescriptions, filtered, searched and sorted in the database (a doctor writes
   * ~500 a day). Rows have the legacy list shape: only the page is enriched with the payment /
   * medicine-desk state, and only that page's payments are read.
   */
  async findPrescriptionsPage(
    clinicId: string | undefined,
    filters: PrescriptionListFilters,
    caller: PrescriptionListCallerContext
  ) {
    const scope = await this.resolvePrescriptionListScope(clinicId, caller);
    if (!scope) {
      return { data: [], total: 0, page: filters.page, limit: filters.limit };
    }
    let page: Awaited<ReturnType<typeof loadPrescriptionPage>>;
    try {
      page = await loadPrescriptionPage(
        this.databaseService,
        scope,
        filters,
        PRESCRIPTION_LIST_INCLUDE
      );
    } catch (error) {
      this.rethrowRangeError(error);
    }
    const rows = page.rows as unknown as Parameters<
      PharmacyService['enrichPrescriptionsWithPaymentState']
    >[0];
    const data = await this.enrichPrescriptionsWithPaymentState(rows, scope.clinicId);
    // Paged rows keep every top-level field; nested records are reduced to what the clients read.
    return {
      data: data.map(row => toSlimPrescriptionListRow(row)),
      total: page.total,
      page: filters.page,
      limit: filters.limit,
    };
  }

  /** Counters of the doctor / pharmacy prescription screens, computed with groupBy / count. */
  async getPrescriptionSummary(
    clinicId: string | undefined,
    dates: { readonly dateFrom?: string; readonly dateTo?: string },
    caller: PrescriptionListCallerContext
  ): Promise<PrescriptionSummary> {
    const scope = await this.resolvePrescriptionListScope(clinicId, caller);
    if (!scope) {
      return {
        total: 0,
        active: 0,
        completed: 0,
        cancelled: 0,
        drafts: 0,
        today: 0,
        uniquePatients: 0,
      };
    }
    try {
      return await loadPrescriptionSummary(this.databaseService, scope, dates);
    } catch (error) {
      return this.rethrowRangeError(error);
    }
  }

  /** Roles that may see a prescription that is still a draft (or returned for changes). */
  private static readonly DRAFT_VISIBLE_ROLES: ReadonlySet<string> = new Set([
    'DOCTOR',
    'ASSISTANT_DOCTOR',
    'CLINIC_ADMIN',
    'SUPER_ADMIN',
  ]);

  /** A DRAFT / RETURNED prescription is invisible (404) to patients, pharmacy and the front desk. */
  private assertPrescriptionVisibleToRole(status: unknown, role: string | undefined): void {
    const normalized = (typeof status === 'string' ? status : '').toUpperCase();
    if (
      (normalized === 'DRAFT' || normalized === 'RETURNED') &&
      !PharmacyService.DRAFT_VISIBLE_ROLES.has(String(role ?? '').toUpperCase())
    ) {
      throw new NotFoundException('Prescription not found');
    }
  }

  /**
   * Single prescription (same shape as the list endpoints). Patients may only
   * read their own; staff are scoped to the request clinic.
   */
  async findPrescriptionById(
    prescriptionId: string,
    clinicId?: string,
    actor?: { userId?: string; role?: string }
  ) {
    // A PATIENT is scoped by OWNERSHIP (own record / ACTIVE dependent), never by the
    // clinic of the request: a patient who is registered with several clinics must
    // be able to open their own prescription of any of them. Staff stay clinic-scoped.
    const isPatientCaller = isPatientRole(actor?.role);
    const prescription = await this.getPrescriptionByIdForAccess(
      prescriptionId,
      isPatientCaller ? undefined : clinicId
    );
    await this.ensurePatientMayReadPrescription(prescription, actor);
    this.assertPrescriptionVisibleToRole(prescription.status, actor?.role);
    const [enriched] = await this.enrichPrescriptionsWithPaymentState(
      [
        prescription as unknown as {
          id: string;
          clinicId: string;
          patientId?: string;
          doctorId?: string;
          locationId?: string | null;
          date?: Date | string | null;
          status?: PrescriptionStatus | string | null;
          items?: PrescriptionDispenseItem[];
          patient?: {
            id?: string;
            name?: string | null;
            user?: {
              id?: string | null;
              name?: string | null;
              phone?: string | null;
              email?: string | null;
            } | null;
          } | null;
          doctor?: {
            id?: string;
            name?: string | null;
            user?: {
              id?: string | null;
              name?: string | null;
              role?: string | null;
            } | null;
          } | null;
          location?: {
            id?: string;
            name?: string | null;
          } | null;
        },
      ],
      // The payments / queue of a patient's prescription live in ITS clinic, which can
      // differ from the clinic the patient is currently using.
      isPatientCaller
        ? String(prescription.clinicId || '') || undefined
        : clinicId || String(prescription.clinicId || '') || undefined
    );
    return enriched;
  }

  /**
   * Prescriptions of one patient (`userId` = Patient.userId).
   *
   * - PATIENT caller (own / ACTIVE dependent, already vetted by PatientSelfAccessGuard):
   *   every prescription of that patient across clinics.
   * - Staff caller: ONLY the prescriptions of the request clinic, so a clinic can never
   *   read (or enqueue into the medicine-desk queue) another clinic's prescriptions of a
   *   shared patient. A staff caller without clinic context is refused, except SUPER_ADMIN
   *   (platform-wide by design).
   */
  async findPrescriptionsByPatient(userId: string, caller: PrescriptionListCaller) {
    const isPatientCaller = isPatientRole(caller.role);
    const clinicScope = isPatientCaller ? undefined : caller.clinicId;
    if (!isPatientCaller && !clinicScope && caller.role !== String(Role.SUPER_ADMIN)) {
      throw new ForbiddenException('Clinic context required');
    }

    const result = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        patient: { findUnique: (args: PrismaDelegateArgs) => Promise<{ id: string } | null> };
      };

      // Resolve Patient ID from User ID
      const patient = await typedClient.patient.findUnique({
        where: { userId } as PrismaDelegateArgs,
        select: { id: true } as PrismaDelegateArgs,
      });

      if (!patient) {
        return [];
      }

      const canSeeDrafts = PharmacyService.DRAFT_VISIBLE_ROLES.has(
        String(caller.role ?? '').toUpperCase()
      );
      return await typedClient.prescription.findMany({
        where: {
          patientId: patient.id,
          ...(clinicScope ? { clinicId: clinicScope } : {}),
          ...(canSeeDrafts ? {} : { status: { notIn: ['DRAFT', 'RETURNED'] } }),
        } as PrismaDelegateArgs,
        include: {
          items: {
            include: {
              medicine: true,
            },
          },
          doctor: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
          patient: {
            include: {
              user: {
                select: PATIENT_USER_SELECT,
              },
            },
          },
          location: true,
        } as PrismaDelegateArgs,
        orderBy: { date: 'desc' } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });

    // Staff lists hold only the request clinic's rows; a patient's list may span clinics, so
    // its payment state is resolved per prescription clinic (no clinicId passed).
    return await this.enrichPrescriptionsWithPaymentState(result, clinicScope);
  }

  async createPrescription(
    dto: CreatePharmacyPrescriptionDto,
    clinicId?: string,
    actor?: PharmacyActor,
    options?: { idempotencyKey?: string | string[] | undefined }
  ) {
    return this.runIdempotentPrescriptionCreate(
      {
        userId: actor?.userId,
        // The most specific "parent" the prescription is scoped to: a retry of the same visit's
        // prescription must dedupe even if the client's key happens to collide across visits.
        resourceId: dto.visitId || dto.appointmentId || dto.patientId,
        idempotencyKey: options?.idempotencyKey,
      },
      () => this.createPrescriptionUnprotected(dto, clinicId, actor)
    );
  }

  /**
   * Runs a prescription-create at most once per `Idempotency-Key` (see idempotency-key.util,
   * same pattern as `BillingService.runIdempotentPaymentIntent`): a retry with the same key gets
   * the first created prescription back instead of creating a second, independently dispensable
   * one. A retry that arrives while the first one is still being created gets 409. Without a key
   * it just runs — the header is optional, this is a safety net for clients that send it.
   */
  private async runIdempotentPrescriptionCreate<T>(
    args: {
      userId?: string | undefined;
      resourceId: string;
      idempotencyKey?: string | string[] | undefined;
    },
    run: () => Promise<T>
  ): Promise<T> {
    const parsed = parseIdempotencyKey(args.idempotencyKey);
    if (parsed.kind === 'invalid') {
      throw new BadRequestException(
        'Invalid Idempotency-Key header: use 1-128 letters, digits, ".", "_", ":" or "-".'
      );
    }
    if (parsed.kind === 'absent' || !args.userId) {
      return run();
    }
    const cacheKey = idempotencyCacheKey({
      userId: args.userId,
      route: 'pharmacy/prescriptions',
      resourceId: args.resourceId,
      key: parsed.key,
    });
    const stored = readStoredResponse<T>(await this.cacheService.get(cacheKey));
    if (stored !== null) {
      return stored;
    }
    const lockKey = `${cacheKey}:in-flight`;
    const locked = await this.cacheService.acquireLock(lockKey, IDEMPOTENCY_IN_FLIGHT_TTL_SECONDS);
    if (!locked && (await this.cacheService.exists(lockKey))) {
      throw new ConflictException(
        'A prescription is already being created with this Idempotency-Key. Please retry shortly.'
      );
    }
    try {
      const result = await run();
      await this.cacheService.set(cacheKey, JSON.stringify(result), IDEMPOTENCY_TTL_SECONDS);
      return result;
    } finally {
      if (locked) {
        await this.cacheService.releaseLock(lockKey);
      }
    }
  }

  private async createPrescriptionUnprotected(
    dto: CreatePharmacyPrescriptionDto,
    clinicId?: string,
    actor?: PharmacyActor
  ) {
    if (!clinicId) throw new BadRequestException('Clinic ID is required');
    // A note-only prescription (diagnosis / advice, no medicines) needs that note, and with
    // nothing to dispense it is FILLED at once so it never waits in the pharmacy queue.
    const noteOnly = dto.items.length === 0;
    if (noteOnly && !dto.diagnosis?.trim() && !dto.notes?.trim()) {
      throw new BadRequestException('Add a medicine, or a diagnosis or advice for the patient');
    }

    // The assistant doctor only PREPARES prescriptions: they stay DRAFT (invisible to the pharmacy
    // desk) until the doctor approves them (see RxDraftService).
    const isAssistantDraft = String(actor?.role ?? '').toUpperCase() === 'ASSISTANT_DOCTOR';

    const prescription = await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        await this.assertPrescriptionMedicines(
          client,
          dto.items.map(item => item.medicineId),
          clinicId
        );
        if (dto.appointmentId) {
          const loose = client as unknown as { appointment?: LooseDelegate };
          const appointment = await loose.appointment?.findFirst({
            where: { id: dto.appointmentId, clinicId } as PrismaDelegateArgs,
            select: { id: true, patientId: true, doctorId: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
          if (
            !appointment ||
            appointment['patientId'] !== dto.patientId ||
            appointment['doctorId'] !== dto.doctorId
          ) {
            throw new BadRequestException(
              'Appointment does not match the patient, doctor and clinic of this prescription'
            );
          }
        }
        const prescriptionId = randomUUID();
        const prescribedAt = new Date();

        return await typedClient.prescription.create({
          data: {
            id: prescriptionId,
            date: prescribedAt,
            prescriptionNumber: buildPrescriptionNumber({ id: prescriptionId, date: prescribedAt }),
            ...(dto.appointmentId && { appointmentId: dto.appointmentId }),
            patientId: dto.patientId,
            doctorId: dto.doctorId,
            clinicId: clinicId,
            notes: dto.notes,
            diagnosis: dto.diagnosis,
            ...(dto.visitId && { visitId: dto.visitId }),
            ...(dto.validUntil && { validUntil: resolveValidUntil(dto.validUntil) }),
            ...(isAssistantDraft
              ? {
                  status: 'DRAFT',
                  draftedByUserId: actor?.userId ?? null,
                  draftedByRole: 'ASSISTANT_DOCTOR',
                  submittedAt: prescribedAt,
                }
              : noteOnly && { status: 'FILLED' }),
            items: {
              create: dto.items.map(item => ({
                medicineId: item.medicineId,
                quantity: item.quantity,
                dosage: item.dosage,
                frequency: item.frequency,
                duration: item.duration,
                ...(item.instructions !== undefined && { instructions: item.instructions }),
                clinicId: clinicId,
              })),
            },
          } as PrismaDelegateArgs,
          include: {
            items: {
              include: {
                medicine: true,
              },
            },
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: actor?.userId ?? dto.doctorId,
        clinicId: clinicId,
        resourceType: 'PRESCRIPTION',
        operation: 'CREATE',
        resourceId: 'new',
        userRole: actor?.role ?? 'system',
        details: { patientId: dto.patientId },
      }
    );

    if (isAssistantDraft) {
      await this.invalidatePatientEhrCache(dto.patientId);
      return prescription;
    }

    await this.syncMedicineDeskQueueEntries([
      {
        id: String((prescription as { id?: string }).id),
        clinicId,
        patientId: String((prescription as { patientId?: string }).patientId || dto.patientId),
        doctorId: String((prescription as { doctorId?: string }).doctorId || dto.doctorId),
        locationId:
          (prescription as { locationId?: string | null }).locationId ||
          (dto as { locationId?: string | null }).locationId ||
          null,
        status:
          (prescription as { status?: PrescriptionStatus | string }).status ||
          PrescriptionStatus.PENDING,
        date: (prescription as { date?: Date | string | null }).date || new Date(),
      },
    ]);

    await this.invalidatePatientEhrCache(dto.patientId);

    await this.emitMedicineDeskQueueUpdated(
      clinicId,
      String((prescription as { id?: string }).id),
      'CREATED'
    );
    return prescription;
  }

  /**
   * Called after the doctor approves an assistant's DRAFT (status already PENDING): from here on the
   * prescription behaves exactly like one the doctor wrote - it enters the medicine-desk queue and
   * the patient's EHR cache is refreshed.
   */
  async publishApprovedPrescription(prescriptionId: string, clinicId: string): Promise<void> {
    const prescription = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return await typedClient.prescription.findUnique({
        where: { id: prescriptionId } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
    if (!prescription || prescription.clinicId !== clinicId) {
      throw new NotFoundException('Prescription not found');
    }
    await this.syncMedicineDeskQueueEntries([
      {
        id: prescriptionId,
        clinicId,
        patientId: String(prescription.patientId),
        doctorId: String(prescription.doctorId),
        locationId: (prescription as { locationId?: string | null }).locationId ?? null,
        status: (prescription as { status?: PrescriptionStatus | string }).status || 'PENDING',
        date: (prescription as { date?: Date | string | null }).date || new Date(),
      },
    ]);
    await this.invalidatePatientEhrCache(String(prescription.patientId));
    await this.emitMedicineDeskQueueUpdated(clinicId, prescriptionId, 'CREATED');
  }

  /** Every medicine of a prescription must be an ACTIVE medicine of the clinic. */
  private async assertPrescriptionMedicines(
    client: unknown,
    medicineIds: string[],
    clinicId: string
  ): Promise<void> {
    const uniqueIds = Array.from(new Set(medicineIds));
    if (uniqueIds.length === 0) {
      return;
    }
    const loose = client as { medicine?: LooseDelegate };
    const medicines = await loose.medicine?.findMany({
      where: { id: { in: uniqueIds }, clinicId, isActive: true } as PrismaDelegateArgs,
      select: { id: true } as PrismaDelegateArgs,
    } as PrismaDelegateArgs);
    if (!medicines || medicines.length !== uniqueIds.length) {
      throw new BadRequestException(
        'One or more medicines are not part of this clinic inventory or are deactivated'
      );
    }
  }

  /**
   * Edit of a prescription by its PRESCRIBING doctor (same clinic) while it is not yet
   * dispensed (status PENDING, nothing dispensed). Items (replaced as a list), notes and
   * diagnosis can change. Item changes are refused once billing started for the
   * prescription (an invoice exists or a payment was taken), because the invoice total
   * is frozen at that point. Writes an audit entry.
   */
  async updatePrescriptionByDoctor(
    prescriptionId: string,
    dto: UpdatePharmacyPrescriptionDto,
    clinicId: string | undefined,
    actor: PharmacyActor
  ) {
    if (!clinicId) throw new ForbiddenException('Clinic context required');
    if (!actor.userId) throw new ForbiddenException('Authenticated user required');
    if (
      dto.items === undefined &&
      dto.notes === undefined &&
      dto.diagnosis === undefined &&
      dto.validUntil === undefined
    ) {
      throw new BadRequestException('Provide items, notes, diagnosis or validUntil to update');
    }

    const current = (await this.getPrescriptionByIdForAccess(
      prescriptionId,
      clinicId
    )) as unknown as {
      patientId: string;
      status: string;
      draftedByUserId?: string | null;
      doctor?: { user?: { id?: string | null } | null } | null;
      items: Array<{ dispensedQuantity?: number | null }>;
    };
    if (String(actor.role ?? '').toUpperCase() === 'ASSISTANT_DOCTOR') {
      // The assistant only ever edits a draft they prepared themselves, never a live prescription.
      const isOwnOpenDraft =
        current.draftedByUserId === actor.userId &&
        ['DRAFT', 'RETURNED'].includes(String(current.status).toUpperCase());
      if (!isOwnOpenDraft) {
        throw new ForbiddenException('You can only edit your own draft prescriptions');
      }
    } else if (current.doctor?.user?.id !== actor.userId) {
      throw new ForbiddenException('Only the prescribing doctor can edit this prescription');
    }
    this.assertPrescriptionEditable(current);

    if (dto.items !== undefined) {
      const payments = await this.findPaymentsForPrescriptions(clinicId, [prescriptionId]);
      const invoices = await this.findPrescriptionInvoicesSafe(clinicId, [prescriptionId]);
      const hasPayment = this.getPrescriptionPayments(payments, prescriptionId).length > 0;
      if (hasPayment || invoices.has(prescriptionId)) {
        throw new BadRequestException(
          'Medicines cannot be changed after billing has started for this prescription'
        );
      }
    }

    await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        const loose = client as unknown as {
          prescriptionItem: { deleteMany: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        const fresh = (await typedClient.prescription.findUnique({
          where: { id: prescriptionId } as PrismaDelegateArgs,
          include: { items: true } as PrismaDelegateArgs,
        } as PrismaDelegateArgs)) as unknown as {
          clinicId: string;
          status: string;
          items: Array<{ dispensedQuantity?: number | null }>;
        } | null;
        if (!fresh || fresh.clinicId !== clinicId) {
          throw new NotFoundException('Prescription not found');
        }
        this.assertPrescriptionEditable(fresh);

        if (dto.items !== undefined) {
          await this.assertPrescriptionMedicines(
            client,
            dto.items.map(item => item.medicineId),
            clinicId
          );
          await loose.prescriptionItem.deleteMany({
            where: { prescriptionId } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        }

        await typedClient.prescription.update({
          where: { id: prescriptionId } as PrismaDelegateArgs,
          data: {
            ...(dto.notes !== undefined && { notes: dto.notes }),
            ...(dto.diagnosis !== undefined && { diagnosis: dto.diagnosis }),
            ...(dto.validUntil !== undefined && { validUntil: resolveValidUntil(dto.validUntil) }),
            ...(dto.items !== undefined && {
              items: {
                create: dto.items.map(item => ({
                  medicineId: item.medicineId,
                  quantity: item.quantity,
                  dosage: item.dosage,
                  frequency: item.frequency,
                  duration: item.duration,
                  ...(item.instructions !== undefined && { instructions: item.instructions }),
                  clinicId,
                })),
              },
            }),
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: actor.userId,
        clinicId,
        resourceType: 'PRESCRIPTION',
        operation: 'UPDATE',
        resourceId: prescriptionId,
        userRole: actor.role ?? 'DOCTOR',
        details: {
          action: 'DOCTOR_EDIT',
          itemsReplaced: dto.items !== undefined,
          notesChanged: dto.notes !== undefined,
          diagnosisChanged: dto.diagnosis !== undefined,
        },
      }
    );

    await this.recordPharmacyAuditLog({
      userId: actor.userId,
      action: 'PRESCRIPTION_EDITED',
      description: 'Prescription edited by the prescribing doctor',
      clinicId,
      resourceType: 'PRESCRIPTION',
      resourceId: prescriptionId,
      metadata: {
        itemCount: dto.items?.length ?? null,
        notesChanged: dto.notes !== undefined,
        diagnosisChanged: dto.diagnosis !== undefined,
      },
    });
    await this.invalidatePatientEhrCache(current.patientId);
    await this.emitMedicineDeskQueueUpdated(clinicId, prescriptionId, 'UPDATED');

    return await this.findPrescriptionById(prescriptionId, clinicId, this.toReadActor(actor));
  }

  /** exactOptionalPropertyTypes-safe view of an actor for the read helpers. */
  private toReadActor(actor: PharmacyActor): { userId?: string; role?: string } {
    return {
      ...(actor.userId ? { userId: actor.userId } : {}),
      ...(actor.role ? { role: actor.role } : {}),
    };
  }

  private assertPrescriptionEditable(prescription: {
    status: string;
    items: Array<{ dispensedQuantity?: number | null }>;
  }): void {
    if (!['PENDING', 'DRAFT', 'RETURNED'].includes(String(prescription.status).toUpperCase())) {
      throw new BadRequestException(
        'Only prescriptions that have not been dispensed or cancelled can be edited'
      );
    }
    if (prescription.items.some(item => Number(item.dispensedQuantity || 0) > 0)) {
      throw new BadRequestException('A prescription with dispensed items cannot be edited');
    }
  }

  /**
   * Clears the cached comprehensive EHR record for the patient so a new
   * prescription shows up immediately instead of waiting out the cache TTL.
   * Prescription.patientId is a Patient.id, but the EHR cache is keyed by
   * User.id, so the owning user must be resolved first.
   */
  private async invalidatePatientEhrCache(patientId: string): Promise<void> {
    const patient = await this.databaseService.executeHealthcareRead<{
      userId: string;
    } | null>(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return await typedClient.patient.findUnique({
        where: { id: patientId } as PrismaDelegateArgs,
        select: { userId: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });

    if (patient?.userId) {
      // Service-level EHR caches are tagged `ehr:{userId}`; controller-level
      // @PatientCache entries (incl. the comprehensive record) are tagged
      // `user:{userId}`. Both are cleared; the explicit del() is kept as a
      // belt-and-braces guard for entries written before tag indexing existed.
      await Promise.all([
        this.cacheService.invalidateCacheByTag(`ehr:${patient.userId}`),
        this.cacheService.invalidateCacheByTag(`user:${patient.userId}`),
        this.cacheService.del(`ehr:comprehensive:${patient.userId}:getComprehensiveHealthRecord`),
      ]);
    }
  }

  /**
   * Update prescription status (dispense/cancel). Enforces immutability:
   * prescriptions with status FILLED cannot be modified.
   */
  async updatePrescriptionStatus(
    prescriptionId: string,
    status: PrescriptionStatus,
    clinicId?: string,
    notes?: string,
    actor?: PharmacyActor
  ) {
    if (status === PrescriptionStatus.FILLED) {
      return await this.dispensePrescription(
        prescriptionId,
        notes ? { notes } : {},
        clinicId,
        actor
      );
    }

    const prescription = await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;

        const existing = await typedClient.prescription.findUnique({
          where: { id: prescriptionId } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);

        if (!existing) {
          throw new BadRequestException('Prescription not found');
        }

        if (clinicId && existing.clinicId !== clinicId) {
          throw new BadRequestException('Prescription does not belong to this clinic');
        }

        if (['DRAFT', 'RETURNED'].includes(String(existing.status).toUpperCase())) {
          throw new BadRequestException(
            'A draft prescription must be approved by the doctor before its status can change'
          );
        }

        // Immutability: reject updates when already FILLED
        if (String(existing.status) === 'FILLED') {
          throw new BadRequestException(
            'Cannot modify a prescription that has already been dispensed'
          );
        }

        if (String(existing.status) === 'CANCELLED' && String(status) !== 'CANCELLED') {
          throw new BadRequestException('Cannot update a cancelled prescription');
        }

        // Money collected against the prescription is never dropped silently by a cancel: the
        // payment has to be refunded first (no automatic refunds here).
        if (String(status) === 'CANCELLED' && String(existing.status) !== 'CANCELLED') {
          const completed = (await typedClient.payment.findMany({
            where: {
              clinicId: existing.clinicId,
              status: PaymentStatus.COMPLETED,
              metadata: { path: ['prescriptionId'], equals: prescriptionId },
            } as PrismaDelegateArgs,
            select: { amount: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs)) as unknown as Array<{ amount: number | null }>;
          const refusal = cancelRefusal(
            completed.reduce((sum, row) => sum + Number(row.amount ?? 0), 0)
          );
          if (refusal) {
            throw new ConflictException(refusal);
          }
        }

        const updatedPrescription = await typedClient.prescription.update({
          where: { id: prescriptionId } as PrismaDelegateArgs,
          data: {
            status,
            ...(notes ? { notes } : {}),
          } as PrismaDelegateArgs,
          include: {
            items: {
              include: {
                medicine: true,
              },
            },
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);

        return updatedPrescription;
      },
      {
        userId: actor?.userId ?? 'system',
        clinicId: clinicId ?? 'unknown',
        resourceType: 'PRESCRIPTION',
        operation: 'UPDATE',
        resourceId: prescriptionId,
        userRole: actor?.role ?? 'system',
        details: { status, ...(notes ? { notes } : {}) },
      }
    );

    const resolvedClinicId =
      clinicId || String((prescription as { clinicId?: string }).clinicId || '');
    if (resolvedClinicId) {
      await this.syncMedicineDeskQueueEntries([
        {
          id: String((prescription as { id?: string }).id),
          clinicId: resolvedClinicId,
          patientId: String((prescription as { patientId?: string }).patientId || ''),
          doctorId: String((prescription as { doctorId?: string }).doctorId || ''),
          locationId: (prescription as { locationId?: string | null }).locationId || null,
          status: (prescription as { status?: PrescriptionStatus | string }).status || status,
          date: (prescription as { date?: Date | string | null }).date || new Date(),
        },
      ]);
    }

    if (clinicId) {
      if (String(status) === 'CANCELLED') {
        // Nothing was collected (checked above): the bill of a cancelled prescription is void.
        await this.voidPrescriptionInvoiceIfUnpaid(prescriptionId, clinicId);
      }
      await this.emitMedicineDeskQueueUpdated(clinicId, prescriptionId, 'CANCELLED');
    }

    return prescription;
  }

  async dispensePrescription(
    prescriptionId: string,
    dto: DispensePrescriptionDto,
    clinicId?: string,
    actor?: PharmacyActor
  ) {
    const dispenser = await this.resolveActorIdentity(actor);
    const dispenserFields = {
      ...(dispenser.id ? { dispensedById: dispenser.id } : {}),
      ...(dispenser.name ? { dispensedByName: dispenser.name } : {}),
    };
    // executeHealthcareWrite keeps the audit trail and cache invalidation; the work itself runs in
    // ONE SQL transaction, so a refused (409) loser rolls back every stock decrement it made.
    const dispenseSummary = await this.databaseService.executeHealthcareWrite(
      async () =>
        this.databaseService.executeInTransaction(async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;

          const existing = await typedClient.prescription.findUnique({
            where: { id: prescriptionId } as PrismaDelegateArgs,
            include: {
              items: {
                include: {
                  medicine: true,
                },
              },
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);

          if (!existing) {
            throw new NotFoundException('Prescription not found');
          }

          if (clinicId && existing.clinicId !== clinicId) {
            throw new BadRequestException('Prescription does not belong to this clinic');
          }

          const normalizedStatus = String(existing.status || '').toUpperCase();
          if (normalizedStatus === 'DRAFT' || normalizedStatus === 'RETURNED') {
            throw new BadRequestException(
              'A draft prescription must be approved by the doctor before it can be dispensed'
            );
          }
          if (normalizedStatus === 'CANCELLED') {
            throw new BadRequestException('Cancelled prescriptions cannot be dispensed');
          }

          if (normalizedStatus === 'FILLED') {
            throw new BadRequestException(
              'Cannot modify a prescription that has already been dispensed'
            );
          }

          const existingItems = (existing.items || []) as PrescriptionDispenseItem[];
          // Only this prescription's payments, read on the transaction's connection.
          const payments = await typedClient.payment.findMany({
            where: {
              clinicId: existing.clinicId,
              metadata: { path: ['prescriptionId'], equals: prescriptionId },
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
          const paymentState = this.buildPrescriptionPaymentState(
            {
              id: String(existing.id),
              date: existing.date,
              items: existingItems,
            },
            payments
          );

          const requestItems = this.normalizeDispenseRequestItems(dto.items);
          const effectiveRequestItems =
            requestItems.length > 0
              ? requestItems
              : this.buildFullDispenseRequestItems(existingItems);

          if (effectiveRequestItems.length === 0) {
            throw new BadRequestException('Prescription has already been fully dispensed');
          }

          const existingByItemId = new Map(
            existingItems
              .filter(item => Boolean(item.id))
              .map(item => [String(item.id), item] as const)
          );
          const existingByMedicineId = new Map<string, PrescriptionDispenseItem[]>();
          for (const item of existingItems) {
            if (!item.medicineId) {
              continue;
            }

            const key = String(item.medicineId);
            const currentItems = existingByMedicineId.get(key) || [];
            currentItems.push(item);
            existingByMedicineId.set(key, currentItems);
          }

          if (!paymentState.canDispense) {
            // A partial payment unlocks dispensing up to what has already been paid for,
            // instead of refusing the whole request until the prescription is paid in full:
            // what this call would bring the dispensed value to is checked against what's been
            // collected, not the prescription's full total (paymentState.paidAmount already
            // equals collectedAmount here, since canDispense is false).
            const alreadyDispensedValue = existingItems.reduce((sum, item) => {
              const dispensedQty = Number(item.dispensedQuantity || 0);
              const unitPrice = Number(item.medicine?.price || 0);
              return sum + dispensedQty * unitPrice;
            }, 0);
            const unlockedBudget = Math.max(
              0,
              Number(paymentState.paidAmount) - alreadyDispensedValue
            );

            const requestedValue = effectiveRequestItems.reduce((sum, requestItem) => {
              const prescriptionItem = requestItem.prescriptionItemId
                ? existingByItemId.get(requestItem.prescriptionItemId)
                : (existingByMedicineId.get(requestItem.medicineId) || []).find(
                    item => this.getPrescriptionItemRemainingQuantity(item) > 0
                  );
              const unitPrice = Number(prescriptionItem?.medicine?.price || 0);
              return sum + Number(requestItem.quantity || 0) * unitPrice;
            }, 0);

            // Half a paisa of slack absorbs floating-point rounding across the two sums.
            if (requestedValue > unlockedBudget + 0.005) {
              throw new ConflictException(
                `Payment collected so far covers INR ${unlockedBudget.toFixed(2)} of dispensing; this request needs INR ${requestedValue.toFixed(2)}. Collect the remaining balance, or request fewer or smaller quantities.`
              );
            }
          }

          const inventoryMedicineIds = Array.from(
            new Set(
              effectiveRequestItems.flatMap(item =>
                [item.medicineId, item.substituteMedicineId].filter(Boolean)
              )
            )
          ) as string[];
          const inventoryMedicines = inventoryMedicineIds.length
            ? await typedClient.medicine.findMany({
                where: {
                  clinicId: existing.clinicId,
                  id: {
                    in: inventoryMedicineIds,
                  },
                } as PrismaDelegateArgs,
              } as PrismaDelegateArgs)
            : [];
          const medicineById = new Map(
            inventoryMedicines.map(medicine => [String(medicine.id), medicine] as const)
          );
          const dispenseAt = dto.dispensedAt ? new Date(dto.dispensedAt) : new Date();

          if (Number.isNaN(dispenseAt.getTime())) {
            throw new BadRequestException('Invalid dispensedAt value');
          }

          let totalRequestedQuantity = 0;
          let totalDispensedQuantity = 0;
          const plans: Array<{
            requestItem: PrescriptionDispenseRequestItem;
            prescriptionItem: PrescriptionDispenseItem;
            inventoryMedicineId: string;
            prescribedName: string;
          }> = [];

          // 1. Validate every line against the snapshot (no writes yet).
          for (const requestItem of effectiveRequestItems) {
            const inventoryMedicineId = requestItem.substituteMedicineId || requestItem.medicineId;
            const inventoryMedicine = medicineById.get(inventoryMedicineId);

            if (!inventoryMedicine) {
              throw new BadRequestException(
                requestItem.substituteMedicineId
                  ? 'The substitute medicine is not part of this clinic inventory'
                  : 'This medicine is not part of this clinic inventory'
              );
            }

            const prescriptionItem = requestItem.prescriptionItemId
              ? existingByItemId.get(requestItem.prescriptionItemId)
              : (existingByMedicineId.get(requestItem.medicineId) || []).find(
                  item => this.getPrescriptionItemRemainingQuantity(item) > 0
                );

            if (!prescriptionItem) {
              throw new BadRequestException(
                requestItem.prescriptionItemId
                  ? 'A selected item is not part of this prescription'
                  : `${this.medicineLabel(inventoryMedicine.name)} is not part of this prescription`
              );
            }

            const remainingQuantity = this.getPrescriptionItemRemainingQuantity(prescriptionItem);
            const prescribedName = this.medicineLabel(
              prescriptionItem.medicine?.name ?? inventoryMedicine.name
            );
            if (remainingQuantity <= 0) {
              throw new BadRequestException(`${prescribedName} has already been fully dispensed`);
            }

            if (requestItem.quantity > remainingQuantity) {
              throw new BadRequestException(
                `Requested quantity for ${prescribedName} exceeds remaining quantity (${remainingQuantity})`
              );
            }

            const availableStock = Number(inventoryMedicine.stock || 0);
            if (availableStock < requestItem.quantity) {
              throw new ConflictException(
                `Insufficient stock for ${this.medicineLabel(inventoryMedicine.name)}. Available: ${availableStock}, requested: ${requestItem.quantity}`
              );
            }

            plans.push({ requestItem, prescriptionItem, inventoryMedicineId, prescribedName });
          }

          // 2. Claim every line BEFORE touching stock. The guarded UPDATE row-locks the line: a
          // concurrent dispense of the same line waits here, then matches no row (quantity and
          // dispensedAt moved on) and is refused with a 409 having decremented nothing. Lines are
          // claimed in id order so two multi-line dispenses can never deadlock each other.
          for (const plan of [...plans].sort((a, b) =>
            String(a.prescriptionItem.id).localeCompare(String(b.prescriptionItem.id))
          )) {
            const claimedQuantity = Number(plan.prescriptionItem.dispensedQuantity || 0);
            const claim = await typedClient.prescriptionItem.updateMany({
              where: {
                id: String(plan.prescriptionItem.id),
                dispensedQuantity: claimedQuantity,
                dispensedAt: plan.prescriptionItem.dispensedAt
                  ? new Date(plan.prescriptionItem.dispensedAt)
                  : null,
              } as PrismaDelegateArgs,
              data: {
                dispensedQuantity: claimedQuantity + plan.requestItem.quantity,
                dispensedAt: dispenseAt,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
            if (claim.count !== 1) {
              throw new ConflictException(
                `${plan.prescribedName} was dispensed concurrently, please retry`
              );
            }
          }

          // 3. FEFO consumes stock (guarded `stock >= qty` / per-batch UPDATEs) inside this
          // transaction, medicine id order (consistent lock order across dispenses). The history
          // records the real lots so a reversal restores exactly what was taken.
          for (const plan of [...plans].sort((a, b) =>
            a.inventoryMedicineId.localeCompare(b.inventoryMedicineId)
          )) {
            const { requestItem, prescriptionItem, inventoryMedicineId } = plan;
            const [fefoResult] = await this.inventoryService.dispenseFefo(
              prescriptionId,
              {
                items: [
                  {
                    prescriptionItemId: String(prescriptionItem.id),
                    medicineId: inventoryMedicineId,
                    quantity: requestItem.quantity,
                  },
                ],
              },
              dispenser.id ?? 'system',
              existing.clinicId,
              typedClient,
              false
            );
            const consumedBatches = fefoResult?.consumedBatches ?? [];
            const fefoLots = [
              ...consumedBatches.map(batch => ({
                quantity: batch.quantity,
                batchNumber: batch.lotNumber,
                expiryDate: batch.expiryDate.toISOString(),
              })),
              ...(consumedBatches.length > 0 && (fefoResult?.unbatchedQuantity ?? 0) > 0
                ? [{ quantity: fefoResult?.unbatchedQuantity ?? 0 }]
                : []),
            ];
            const appliedRequestItem: PrescriptionDispenseRequestItem = {
              ...requestItem,
              lots: fefoLots.length > 0 ? fefoLots : requestItem.lots,
            };
            const requestLots =
              appliedRequestItem.lots.length > 0
                ? appliedRequestItem.lots
                : [
                    {
                      quantity: requestItem.quantity,
                    },
                  ];
            const lotHistory: PrescriptionDispenseBatchHistoryEntry[] = requestLots.map(lot => ({
              quantity: Number(lot.quantity || 0),
              ...(lot.batchNumber ? { batchNumber: lot.batchNumber } : {}),
              ...(lot.expiryDate ? { expiryDate: lot.expiryDate } : {}),
              medicineId: inventoryMedicineId,
              originalMedicineId: requestItem.medicineId,
              ...(requestItem.substituteMedicineId
                ? { substituteMedicineId: requestItem.substituteMedicineId }
                : {}),
              eventType: requestItem.substituteMedicineId
                ? ('SUBSTITUTION' as const)
                : ('DISPENSE' as const),
              ...(requestItem.substitutionReason ? { reason: requestItem.substitutionReason } : {}),
              dispensedAt: dispenseAt.toISOString(),
              ...dispenserFields,
            }));
            const eventHistory = requestLots.map(lot =>
              this.buildDispenseEventHistoryEntry({
                quantity: Number(lot.quantity || 0),
                medicineId: inventoryMedicineId,
                originalMedicineId: requestItem.medicineId,
                ...(requestItem.substituteMedicineId
                  ? { substituteMedicineId: requestItem.substituteMedicineId }
                  : {}),
                ...(lot.batchNumber ? { batchNumber: lot.batchNumber } : {}),
                ...(lot.expiryDate ? { expiryDate: lot.expiryDate } : {}),
                eventType: requestItem.substituteMedicineId ? 'SUBSTITUTION' : 'DISPENSE',
                ...(requestItem.substitutionReason
                  ? { reason: requestItem.substitutionReason }
                  : {}),
                dispensedAt: dispenseAt,
                ...dispenserFields,
              })
            );
            const latestBatchNumber =
              [...requestLots].reverse().find(lot => Boolean(lot.batchNumber))?.batchNumber || null;
            const latestBatchExpiryDate =
              [...requestLots].reverse().find(lot => Boolean(lot.expiryDate))?.expiryDate || null;

            totalRequestedQuantity += requestItem.quantity;
            totalDispensedQuantity += requestItem.quantity;

            // The line is locked by this transaction's claim: record batches and history on it.
            await typedClient.prescriptionItem.update({
              where: { id: String(prescriptionItem.id) } as PrismaDelegateArgs,
              data: {
                ...(latestBatchNumber ? { dispensedBatchNumber: latestBatchNumber } : {}),
                ...(latestBatchExpiryDate
                  ? { dispensedBatchExpiryDate: new Date(latestBatchExpiryDate) }
                  : {}),
                dispenseBatchHistory: this.appendDispenseHistory(
                  prescriptionItem.dispenseBatchHistory || null,
                  lotHistory
                ),
                dispenseEventHistory: this.appendDispenseEventHistory(
                  prescriptionItem.dispenseEventHistory || null,
                  eventHistory
                ),
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          }

          // 4. Status from the committed lines: lock the prescription row (last, after lines and
          // stock), then re-read every line, so two dispenses of different lines of the same
          // prescription cannot both compute PARTIAL from stale snapshots. A prescription
          // cancelled meanwhile refuses the dispense (and rolls the stock back).
          const prescriptionLock = await typedClient.prescription.updateMany({
            where: {
              id: prescriptionId,
              status: { notIn: ['CANCELLED', 'DRAFT', 'RETURNED'] },
            } as PrismaDelegateArgs,
            data: { status: existing.status } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
          if (prescriptionLock.count !== 1) {
            throw new ConflictException(
              'This prescription was changed while it was being dispensed, please reload and retry'
            );
          }
          const currentItems = (await typedClient.prescriptionItem.findMany({
            where: { prescriptionId } as PrismaDelegateArgs,
            select: { quantity: true, dispensedQuantity: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs)) as unknown as PrescriptionDispenseItem[];
          const nextStatus = this.getPrescriptionDispenseStatus(currentItems);
          const remainingQuantity = currentItems.reduce(
            (sum, item) => sum + this.getPrescriptionItemRemainingQuantity(item),
            0
          );

          await typedClient.prescription.update({
            where: { id: prescriptionId } as PrismaDelegateArgs,
            data: {
              status: nextStatus,
              ...(dto.notes ? { notes: dto.notes } : {}),
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);

          return {
            status: nextStatus,
            dispensedAt: dispenseAt,
            totalRequestedQuantity,
            totalDispensedQuantity,
            remainingQuantity,
          };
        }),
      {
        userId: dispenser.id ?? 'system',
        clinicId: clinicId ?? 'unknown',
        resourceType: 'PRESCRIPTION',
        operation: 'UPDATE',
        resourceId: prescriptionId,
        userRole: actor?.role ?? 'system',
        details: {
          action: 'DISPENSE',
          ...(dto.notes ? { notes: dto.notes } : {}),
        },
      }
    );

    const hydratedPrescription = await this.getPrescriptionByIdForAccess(prescriptionId, clinicId);
    const resolvedClinicId = clinicId || String(hydratedPrescription.clinicId || '');
    const [enrichedPrescription] = await this.enrichPrescriptionsWithPaymentState(
      [
        hydratedPrescription as unknown as {
          id: string;
          clinicId: string;
          patientId?: string;
          doctorId?: string;
          locationId?: string | null;
          date?: Date | string | null;
          status?: PrescriptionStatus | string | null;
          items?: PrescriptionDispenseItem[];
          patient?: {
            id?: string;
            name?: string | null;
            user?: {
              id?: string | null;
              name?: string | null;
              phone?: string | null;
              email?: string | null;
            } | null;
          } | null;
          doctor?: {
            id?: string;
            name?: string | null;
            user?: {
              id?: string | null;
              name?: string | null;
              role?: string | null;
            } | null;
          } | null;
          location?: {
            id?: string;
            name?: string | null;
          } | null;
        },
      ],
      resolvedClinicId || undefined
    );

    if (resolvedClinicId) {
      await this.emitMedicineDeskQueueUpdated(
        resolvedClinicId,
        prescriptionId,
        String(dispenseSummary.status || '').toUpperCase() === 'FILLED'
          ? 'DISPENSED'
          : 'PARTIALLY_DISPENSED'
      );
      await this.eventService.emit('pharmacy.dispense.fefo', {
        prescriptionId,
        clinicId: resolvedClinicId,
        itemCount: dto.items?.length || 0,
        userId: dispenser.id ?? 'system',
      });

      if (String(dispenseSummary.status || '').toUpperCase() === 'FILLED') {
        await this.ensureDispensedPrescriptionInvoiceSettled(
          prescriptionId,
          resolvedClinicId,
          enrichedPrescription as { totalAmount?: number; paidAmount?: number }
        );
      }
    }

    return {
      ...enrichedPrescription,
      dispenseSummary,
    };
  }

  /**
   * Runs after a prescription reaches FILLED: ensures the PHARMACY invoice
   * exists (a fully-dispensed prescription is always billable, even if no
   * online/cash payment was collected up front — e.g. a zero-cost or
   * insurance-covered dispense) and, when completed payments already cover
   * the total, marks it PAID so Bill History and the printable invoice
   * reflect reality immediately instead of waiting on a separate call.
   * Best-effort by design (see `ensurePrescriptionInvoiceSafe`).
   */
  private async ensureDispensedPrescriptionInvoiceSettled(
    prescriptionId: string,
    clinicId: string,
    paymentState: { totalAmount?: number; paidAmount?: number }
  ): Promise<void> {
    const invoice = await this.ensurePrescriptionInvoiceSafe(prescriptionId, clinicId);
    if (!invoice || String(invoice.status).toUpperCase() === 'PAID') {
      return;
    }

    const totalAmount = Number(paymentState.totalAmount ?? invoice.totalAmount ?? 0);
    const paidAmount = Number(paymentState.paidAmount ?? 0);
    if (totalAmount > 0 && paidAmount + 0.005 < totalAmount) {
      return;
    }

    const billingService = this.getBillingService();
    if (!billingService) {
      return;
    }

    try {
      await billingService.markInvoiceAsPaid(invoice.id, { clinicId }, { skipWhatsApp: true });
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to mark pharmacy invoice as paid after dispense',
        'PharmacyService',
        {
          prescriptionId,
          invoiceId: invoice.id,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  async reversePrescriptionDispense(
    prescriptionId: string,
    dto: { reason: string; items?: Array<{ prescriptionItemId?: string; quantity?: number }> },
    clinicId?: string,
    actor?: PharmacyActor
  ) {
    // One SQL transaction (audit + cache invalidation from executeHealthcareWrite): the line is
    // claimed before any stock is restored, so a concurrent second reversal is refused (409)
    // without adding the stock back twice.
    const reversalSummary = await this.databaseService.executeHealthcareWrite(
      async () =>
        this.databaseService.executeInTransaction(async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          const existing = await typedClient.prescription.findUnique({
            where: { id: prescriptionId } as PrismaDelegateArgs,
            include: {
              items: {
                include: {
                  medicine: true,
                },
              },
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);

          if (!existing) {
            throw new NotFoundException('Prescription not found');
          }

          if (clinicId && existing.clinicId !== clinicId) {
            throw new BadRequestException('Prescription does not belong to this clinic');
          }

          // The medicines already left the counter: undoing the dispense would put stock back
          // that the patient took home. A taken-back hand-over (UNDONE) may be reversed again.
          const handoverDelegate = (client as unknown as { dispenseHandover?: LooseDelegate })
            .dispenseHandover;
          const handoverRows = handoverDelegate
            ? await handoverDelegate.findMany({
                where: {
                  prescriptionId,
                  clinicId: existing.clinicId,
                  status: { not: 'SUPERSEDED' },
                } as PrismaDelegateArgs,
                select: {
                  prescriptionId: true,
                  status: true,
                  createdAt: true,
                  handedOverAt: true,
                } as PrismaDelegateArgs,
              } as PrismaDelegateArgs)
            : [];
          const handover = latestHandoverByPrescription(
            handoverRows as unknown as HandoverStateRow[]
          ).get(prescriptionId);
          if (handover?.status === 'HANDED_OVER') {
            throw new ConflictException(
              'Already handed over to the patient — record a return instead of undoing the dispense'
            );
          }

          const existingItems = (existing.items || []) as PrescriptionDispenseItem[];
          const targetItemIds = (dto.items || [])
            .map(item => item.prescriptionItemId)
            .filter((value): value is string => Boolean(value));
          const itemsToReverse =
            targetItemIds.length > 0
              ? existingItems.filter(item => targetItemIds.includes(String(item.id || '')))
              : existingItems.filter(item => Number(item.dispensedQuantity || 0) > 0);

          if (itemsToReverse.length === 0) {
            throw new BadRequestException(
              'No dispensed prescription items are available for reversal'
            );
          }

          const now = new Date();
          const reversedItemIds: string[] = [];
          const restoreByMedicineId = new Map<string, number>();

          // 1. Claim every line BEFORE restoring stock (id order, the same lock order as a
          // dispense). The guarded UPDATE row-locks the line: a concurrent second reversal waits,
          // then matches no row (quantity and dispensedAt moved on) and is refused with a 409
          // having restored nothing.
          for (const item of [...itemsToReverse].sort((a, b) =>
            String(a.id || '').localeCompare(String(b.id || ''))
          )) {
            const requestedReversalQuantity = (dto.items || []).find(
              reversalItem =>
                String(reversalItem.prescriptionItemId || '') === String(item.id || '')
            )?.quantity;
            const currentDispensedQuantity = Number(item.dispensedQuantity || 0);
            if (
              typeof requestedReversalQuantity === 'number' &&
              requestedReversalQuantity > 0 &&
              requestedReversalQuantity !== currentDispensedQuantity
            ) {
              throw new BadRequestException(
                `Reversal quantity for ${this.medicineLabel(item.medicine?.name)} must match the currently dispensed quantity (${currentDispensedQuantity})`
              );
            }

            const eventHistory = this.normalizeStoredDispenseEventHistory(
              item.dispenseEventHistory || item.dispenseBatchHistory || null
            );
            const reversibleEvents = eventHistory.filter(
              entry => entry.eventType !== 'REVERSAL' && !entry.reversedAt
            );

            if (reversibleEvents.length === 0) {
              continue;
            }

            const reversalTotal = reversibleEvents.reduce(
              (sum, entry) => sum + Number(entry.quantity || 0),
              0
            );

            const updatedEventHistory = eventHistory.map(entry => {
              if (entry.eventType === 'REVERSAL' || entry.reversedAt) {
                return entry;
              }

              return {
                ...entry,
                reversedAt: now.toISOString(),
                reversalReason: dto.reason,
              };
            });

            const latestReversibleEvent = reversibleEvents[reversibleEvents.length - 1];
            const originalReversibleEvent = reversibleEvents[0];
            const reversalEvent = this.buildDispenseEventHistoryEntry({
              quantity: reversalTotal,
              medicineId: String(latestReversibleEvent?.medicineId || item.medicineId || ''),
              originalMedicineId: String(
                item.medicineId || originalReversibleEvent?.originalMedicineId || ''
              ),
              eventType: 'REVERSAL',
              reason: dto.reason,
              dispensedAt: now,
              reversedAt: now,
              reversalReason: dto.reason,
            });

            const reversalUpdate = await typedClient.prescriptionItem.updateMany({
              where: {
                id: String(item.id),
                dispensedQuantity: currentDispensedQuantity,
                dispensedAt: item.dispensedAt ? new Date(item.dispensedAt) : null,
              } as PrismaDelegateArgs,
              data: {
                dispensedQuantity: 0,
                dispensedAt: null,
                dispensedBatchNumber: null,
                dispensedBatchExpiryDate: null,
                dispenseBatchHistory: this.appendDispenseHistory(
                  item.dispenseBatchHistory || null,
                  [
                    ...reversibleEvents.map(entry =>
                      this.buildDispenseEventHistoryEntry({
                        quantity: Number(entry.quantity || 0),
                        medicineId: String(entry.medicineId || item.medicineId || ''),
                        originalMedicineId: String(
                          entry.originalMedicineId || item.medicineId || ''
                        ),
                        ...(entry.substituteMedicineId
                          ? { substituteMedicineId: entry.substituteMedicineId }
                          : {}),
                        ...(entry.batchNumber ? { batchNumber: entry.batchNumber } : {}),
                        ...(entry.expiryDate ? { expiryDate: entry.expiryDate } : {}),
                        eventType: 'REVERSAL',
                        ...(entry.reason ? { reason: entry.reason } : {}),
                        dispensedAt: new Date(entry.dispensedAt),
                        reversedAt: now,
                        reversalReason: dto.reason,
                      })
                    ),
                  ]
                ),
                dispenseEventHistory: [...updatedEventHistory, reversalEvent],
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
            if (reversalUpdate.count !== 1) {
              throw new ConflictException(
                `${this.medicineLabel(item.medicine?.name)} was changed concurrently, please retry the reversal`
              );
            }

            for (const entry of reversibleEvents) {
              const medicineId = String(entry.medicineId || item.medicineId || '');
              if (medicineId) {
                restoreByMedicineId.set(
                  medicineId,
                  (restoreByMedicineId.get(medicineId) || 0) + Number(entry.quantity || 0)
                );
              }
            }
            reversedItemIds.push(String(item.id));
          }

          // 2. Restores exactly what the dispense took (same batches via the DISPENSE_OUT
          // movements, legacy un-batched units straight to stock), clinic scoped, inside this
          // transaction, in medicine id order.
          if (restoreByMedicineId.size > 0) {
            await this.inventoryService.restoreDispense(
              prescriptionId,
              Array.from(restoreByMedicineId.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([medicineId, quantity]) => ({ medicineId, quantity })),
              actor?.userId ?? 'system',
              existing.clinicId,
              typedClient
            );
          }

          // 3. Status from the committed lines: lock the prescription row (last), then re-read it.
          await typedClient.prescription.updateMany({
            where: { id: prescriptionId } as PrismaDelegateArgs,
            data: { status: existing.status } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
          const current = (await typedClient.prescription.findUnique({
            where: { id: prescriptionId } as PrismaDelegateArgs,
            select: {
              notes: true,
              items: { select: { quantity: true, dispensedQuantity: true } },
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs)) as unknown as {
            notes?: string | null;
            items?: PrescriptionDispenseItem[];
          } | null;
          const nextStatus = this.getPrescriptionDispenseStatus(current?.items ?? []);
          const currentNotes = current?.notes ?? null;

          await typedClient.prescription.update({
            where: { id: prescriptionId } as PrismaDelegateArgs,
            data: {
              status: nextStatus,
              notes: `${currentNotes ? `${currentNotes}\n` : ''}Reversal: ${dto.reason}`.trim(),
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);

          return {
            reversedItemCount: reversedItemIds.length,
            status: nextStatus,
            reversedAt: now.toISOString(),
          };
        }),
      {
        userId: actor?.userId ?? 'system',
        clinicId: clinicId ?? 'unknown',
        resourceType: 'PRESCRIPTION',
        operation: 'UPDATE',
        resourceId: prescriptionId,
        userRole: actor?.role ?? 'system',
        details: {
          action: 'REVERSE_DISPENSE',
          reason: dto.reason,
        },
      }
    );

    const hydratedPrescription = await this.getPrescriptionByIdForAccess(prescriptionId, clinicId);
    const resolvedClinicId = clinicId || String(hydratedPrescription.clinicId || '');

    if (resolvedClinicId) {
      // A full reverse-dispense goes back to PENDING (see getPrescriptionDispenseStatus) —
      // that's neither DISPENSED nor still-partial, so label it a plain queue update.
      const reversedStatus = String(reversalSummary.status || '').toUpperCase();
      await this.emitMedicineDeskQueueUpdated(
        resolvedClinicId,
        prescriptionId,
        reversedStatus === 'FILLED'
          ? 'DISPENSED'
          : reversedStatus === 'PARTIAL'
            ? 'PARTIALLY_DISPENSED'
            : 'UPDATED'
      );
      await this.eventService.emit('pharmacy.medicine_desk.updated', {
        clinicId: resolvedClinicId,
        prescriptionId,
        action: 'PRESCRIPTION_REVERSED',
      });

      await this.voidPrescriptionInvoiceIfUnpaid(prescriptionId, resolvedClinicId);
    }

    return {
      ...hydratedPrescription,
      reversalSummary,
    };
  }

  /**
   * A dispense reversal means the pharmacy bill is no longer valid as
   * billed. If no COMPLETED payment has been collected against it yet, void
   * it outright; if it was already paid, leave it alone — a paid invoice
   * needs a refund workflow, not a silent void.
   */
  private async voidPrescriptionInvoiceIfUnpaid(
    prescriptionId: string,
    clinicId: string
  ): Promise<void> {
    const billingService = this.getBillingService();
    if (!billingService) {
      return;
    }

    try {
      const invoice = await billingService.findPrescriptionInvoice(prescriptionId, clinicId);
      if (!invoice) {
        return;
      }

      const status = String(invoice.status).toUpperCase();
      if (status === 'PAID' || status === 'VOID') {
        return;
      }

      // Only this prescription's payments (and any booked straight against its invoice).
      const payments = await this.databaseService.executeHealthcareRead(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        return await typedClient.payment.findMany({
          where: {
            clinicId,
            OR: [
              { invoiceId: invoice.id },
              { metadata: { path: ['prescriptionId'], equals: prescriptionId } },
            ],
          } as PrismaDelegateArgs,
          select: { id: true, status: true } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      });
      const hasCompletedPayment = payments.some(
        payment => String(payment.status).toUpperCase() === PharmacyService.COMPLETED_PAYMENT_STATUS
      );
      if (hasCompletedPayment) {
        return;
      }

      // System void: the public invoice edit refuses status changes. The write is guarded on
      // PENDING, so a bill paid in the meantime stays PAID (refunds are a manual step).
      await billingService.voidInvoiceInternal(
        invoice.id,
        clinicId,
        'PRESCRIPTION_DISPENSE_REVERSED',
        {
          prescriptionId,
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to void unpaid pharmacy invoice after dispense reversal',
        'PharmacyService',
        {
          prescriptionId,
          clinicId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  async getPharmacyBatchAudit(
    clinicId?: string,
    filters?: {
      prescriptionId?: string;
      medicineId?: string;
      batchNumber?: string;
      patientId?: string;
      startDate?: string;
      endDate?: string;
    }
  ): Promise<PharmacyBatchAuditEntry[]> {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      // Unapproved assistant drafts were never dispensable: keep them out of the audit.
      const where: Record<string, unknown> = { status: publishedPrescriptionStatusFilter() };
      if (clinicId) where['clinicId'] = clinicId;
      if (filters?.prescriptionId) where['id'] = filters.prescriptionId;

      const prescriptions = (await typedClient.prescription.findMany({
        where: where as PrismaDelegateArgs,
        include: {
          items: {
            include: {
              medicine: true,
            },
          },
          patient: {
            include: {
              user: true,
            },
          },
          doctor: {
            include: {
              user: true,
            },
          },
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as Array<{
        id: string;
        clinicId: string;
        patientId: string;
        doctorId: string;
        patient?: {
          user?: { name?: string | null } | null;
        } | null;
        doctor?: {
          user?: { name?: string | null } | null;
        } | null;
        items?: PrescriptionDispenseItem[];
      }>;

      const medicineIds = new Set<string>();
      for (const prescription of prescriptions) {
        for (const item of prescription.items || []) {
          if (item.medicineId) {
            medicineIds.add(String(item.medicineId));
          }
          for (const event of this.normalizeStoredDispenseEventHistory(
            item.dispenseEventHistory || item.dispenseBatchHistory || null
          )) {
            if (event.medicineId) medicineIds.add(String(event.medicineId));
            if (event.originalMedicineId) medicineIds.add(String(event.originalMedicineId));
            if (event.substituteMedicineId) medicineIds.add(String(event.substituteMedicineId));
          }
        }
      }

      const medicineRecords = medicineIds.size
        ? await typedClient.medicine.findMany({
            where: {
              clinicId: clinicId || undefined,
              id: { in: Array.from(medicineIds) },
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs)
        : [];
      const medicineById = new Map(
        medicineRecords.map(medicine => [String(medicine.id), medicine] as const)
      );

      // Inclusive whole-day bounds in IST (the "To" day used to be cut off at 00:00).
      const startTime = resolveAuditDateBound(filters?.startDate, 'start');
      const endTime = resolveAuditDateBound(filters?.endDate, 'end');

      const entries: PharmacyBatchAuditEntry[] = [];

      for (const prescription of prescriptions) {
        if (filters?.patientId && prescription.patientId !== filters.patientId) {
          continue;
        }

        const patientName =
          prescription.patient?.user?.name || `Patient ${prescription.patientId.slice(0, 8)}`;
        const doctorName =
          prescription.doctor?.user?.name || `Doctor ${prescription.doctorId.slice(0, 8)}`;

        for (const item of prescription.items || []) {
          const normalizedEvents = this.normalizeStoredDispenseEventHistory(
            item.dispenseEventHistory || item.dispenseBatchHistory || null
          );

          for (const event of normalizedEvents) {
            // A dispense that was later reversed keeps its ORIGINAL time (it carries
            // reversedAt/reversalReason); only the separate REVERSAL entry sits at the
            // reversal time.
            const eventAt =
              event.eventType === 'REVERSAL'
                ? event.reversedAt || event.dispensedAt
                : event.dispensedAt;
            const eventTimestamp = new Date(eventAt).getTime();

            if (Number.isNaN(eventTimestamp)) {
              continue;
            }

            if (startTime !== null && eventTimestamp < startTime) {
              continue;
            }

            if (endTime !== null && eventTimestamp > endTime) {
              continue;
            }

            if (filters?.batchNumber && String(event.batchNumber || '') !== filters.batchNumber) {
              continue;
            }

            const medicineId = String(
              event.medicineId || item.medicineId || event.originalMedicineId || ''
            );
            const originalMedicineId = String(
              event.originalMedicineId || item.medicineId || medicineId
            );
            const substituteMedicineId = event.substituteMedicineId || null;

            if (
              filters?.medicineId &&
              ![
                medicineId,
                originalMedicineId,
                substituteMedicineId || '',
                String(item.medicineId || ''),
              ].includes(filters.medicineId)
            ) {
              continue;
            }

            entries.push({
              prescriptionId: prescription.id,
              prescriptionItemId: String(item.id || ''),
              patientId: prescription.patientId,
              patientName,
              doctorId: prescription.doctorId,
              doctorName,
              medicineId,
              medicineName: String(
                medicineById.get(medicineId)?.name || item.medicine?.name || 'Medicine'
              ),
              originalMedicineId,
              originalMedicineName: String(
                medicineById.get(originalMedicineId)?.name || item.medicine?.name || 'Medicine'
              ),
              ...(substituteMedicineId
                ? {
                    substituteMedicineId,
                    substituteMedicineName: String(
                      medicineById.get(substituteMedicineId)?.name || substituteMedicineId
                    ),
                  }
                : {}),
              ...(event.batchNumber ? { batchNumber: event.batchNumber } : {}),
              ...(event.expiryDate ? { expiryDate: event.expiryDate } : {}),
              quantity: Number(event.quantity || 0),
              eventType: event.eventType || 'DISPENSE',
              eventAt,
              ...(event.reason ? { reason: event.reason } : {}),
              ...(event.reversedAt ? { reversedAt: event.reversedAt } : {}),
              ...(event.reversalReason ? { reversalReason: event.reversalReason } : {}),
              ...(event.dispensedById ? { dispensedById: event.dispensedById } : {}),
              ...(event.dispensedByName ? { dispensedByName: event.dispensedByName } : {}),
            });
          }
        }
      }

      return entries.sort(
        (left, right) => new Date(right.eventAt).getTime() - new Date(left.eventAt).getTime()
      );
    });
  }

  /**
   * Prescription PDF. Allowed: the owner patient (or an ACTIVE dependent's primary patient),
   * the PRESCRIBING doctor, and the pharmacist / clinic admin of the prescription's clinic.
   * Everyone else is refused; staff without a clinic context fail closed.
   */
  async getPrescriptionPdf(
    prescriptionId: string,
    clinicId: string | undefined,
    actor: PharmacyActor
  ): Promise<{ fileName: string; buffer: Buffer }> {
    const role = String(actor.role || '').toUpperCase();
    const isPatientCaller = isPatientRole(actor.role);
    if (!isPatientCaller && !clinicId) {
      throw new ForbiddenException('Clinic context required');
    }
    const prescription = (await this.getPrescriptionByIdForAccess(
      prescriptionId,
      isPatientCaller ? undefined : clinicId
    )) as unknown as {
      id: string;
      clinicId: string;
      patientId: string;
      date?: Date | string | null;
      status: string;
      notes?: string | null;
      diagnosis?: string | null;
      prescriptionNumber?: string | null;
      visitId?: string | null;
      appointmentId?: string | null;
      validUntil?: Date | string | null;
      draftedByUserId?: string | null;
      items: Array<
        PrescriptionDispenseItem & {
          dosage?: string | null;
          frequency?: string | null;
          duration?: string | null;
          instructions?: string | null;
          medicine?: {
            name?: string | null;
            unit?: string | null;
            dosage?: string | null;
            category?: string | null;
          } | null;
        }
      >;
      patient?: {
        user?: {
          id?: string | null;
          name?: string | null;
          age?: number | null;
          gender?: string | null;
          dateOfBirth?: Date | string | null;
        } | null;
      } | null;
      doctor?: {
        licenseNumber?: string | null;
        qualification?: string | null;
        specialization?: string | null;
        user?: { id?: string | null; name?: string | null } | null;
      } | null;
    };

    this.assertPrescriptionVisibleToRole(prescription.status, actor.role);
    if (isPatientCaller) {
      await this.ensurePatientMayReadPrescription(prescription, this.toReadActor(actor));
    } else if (role === 'DOCTOR') {
      if (!actor.userId || prescription.doctor?.user?.id !== actor.userId) {
        throw new ForbiddenException('Only the prescribing doctor can download this prescription');
      }
    } else if (role !== 'PHARMACIST' && role !== 'CLINIC_ADMIN') {
      throw new ForbiddenException('Not allowed to download this prescription');
    }

    // Letterhead + optional sections, all from this prescription's clinic / patient / visit.
    const pdfContext = await loadPrescriptionPdfContext(this.databaseService, this.loggingService, {
      clinicId: prescription.clinicId,
      patientId: prescription.patientId,
      patientUserId: prescription.patient?.user?.id ?? null,
      visitId: prescription.visitId ?? null,
      appointmentId: prescription.appointmentId ?? null,
      draftedByUserId: prescription.draftedByUserId ?? null,
    });
    const deskContext = await this.loadPrescriptionDeskContext([prescription]);
    const desk = this.buildPrescriptionDeskFields(prescription, deskContext);

    const buffer = await buildPrescriptionPdf({
      prescriptionNumber: desk.prescriptionNumber,
      prescriptionId: prescription.id,
      clinicName: pdfContext.clinic.name,
      clinicCode: pdfContext.clinic.code,
      clinicAddress: pdfContext.clinic.address,
      clinicPhone: pdfContext.clinic.phone,
      clinicEmail: pdfContext.clinic.email,
      clinicLogo: pdfContext.clinic.logo,
      prescribedAt: prescription.date ?? null,
      patientName: prescription.patient?.user?.name || 'Patient',
      patientAge: desk.patientAge,
      patientGender: desk.patientGender,
      patientNumber: desk.patientNumber,
      patientUhid: desk.patientUhid,
      patientWeight: pdfContext.weight,
      patientAllergies: pdfContext.allergies,
      doctorName: prescription.doctor?.user?.name || 'Doctor',
      doctorRegistrationNumber: prescription.doctor?.licenseNumber?.trim() || null,
      doctorQualification: prescription.doctor?.qualification ?? null,
      doctorSpecialization: prescription.doctor?.specialization ?? null,
      diagnosis: prescription.diagnosis ?? null,
      notes: prescription.notes ?? null,
      status: String(prescription.status),
      validUntil: prescription.validUntil ?? null,
      investigations: pdfContext.investigations,
      followUp: pdfContext.followUp,
      draftedByName: pdfContext.draftedByName,
      items: (prescription.items || []).map(item => ({
        medicineName: item.medicine?.name || 'Medicine',
        quantity: Number(item.quantity || 0),
        dosage: item.dosage ?? null,
        frequency: item.frequency ?? null,
        duration: item.duration ?? null,
        unit: item.medicine?.unit ?? null,
        instructions: item.instructions ?? null,
        strength: item.medicine?.dosage ?? null,
        category: item.medicine?.category ?? null,
      })),
    });
    return {
      fileName: prescriptionPdfFileName(desk.prescriptionNumber, prescription.patient?.user?.name),
      buffer,
    };
  }

  /** Dispensed totals with a per-day or per-medicine breakdown, clinic scoped. */
  async getSalesReport(
    clinicId: string,
    query: { from?: string; to?: string; groupBy?: SalesGroupBy }
  ): Promise<SalesReport> {
    return await loadSalesReport(this.databaseService, clinicId, {
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      groupBy: query.groupBy ?? 'day',
    });
  }

  async getStats(clinicId?: string, period: StatsPeriod = DEFAULT_STATS_PERIOD) {
    const metrics = clinicId
      ? await loadDashboardMetrics(this.databaseService, clinicId, period)
      : { totalRevenue: 0, topSellingMedicine: null, monthlyDispensed: 0 };
    const counts = await this.getStatCounts(clinicId);
    return { ...counts, ...metrics };
  }

  private async getStatCounts(clinicId?: string) {
    // Simple count stats
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;

      const where: Record<string, unknown> = {};
      if (clinicId) where['clinicId'] = clinicId;
      // Same rows as the inventory list (active medicines only).
      const medicineWhere = { ...where, isActive: true };

      // Note-only prescriptions (diagnosis / advice, no items) are not desk work: leave them out.
      // Unapproved assistant drafts are not desk work either.
      const prescriptionWhere = { ...where, status: publishedPrescriptionStatusFilter() };
      const totalPrescriptions = await typedClient.prescription.count({
        where: { ...prescriptionWhere, items: { some: {} } } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);

      const prescriptions = await typedClient.prescription.findMany({
        where: prescriptionWhere as PrismaDelegateArgs,
        include: {
          items: {
            include: {
              medicine: true,
            },
          },
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);

      const enrichedPrescriptions = await this.enrichPrescriptionsWithPaymentState(
        prescriptions as Array<{
          id: string;
          clinicId: string;
          date?: Date | string | null;
          status?: PrescriptionStatus | string | null;
          items?: PrescriptionDispenseItem[];
        }>,
        clinicId,
        { completeClinicSet: true }
      );

      // NOTE: getStats and findLowStock read Medicine.stock (the total on-hand kept in sync
      // by the inventory layer) directly; findExpiringSoon delegates to pharmacy-inventory
      // for the stockBatch-level expiry scan.
      const medicines = await typedClient.medicine.findMany({
        where: medicineWhere as PrismaDelegateArgs,
        select: { stock: true, minStockThreshold: true, price: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
      // One stock-level definition everywhere: low = 0 < stock <= reorder level, out = stock <= 0.
      const stockLevels = summarizeStockLevels(medicines);

      return {
        totalMedicines: stockLevels.total,
        lowStock: stockLevels.lowStock,
        outOfStock: stockLevels.outOfStock,
        inventoryValue: stockLevels.totalValue,
        totalPrescriptions,
        pendingPrescriptions: enrichedPrescriptions.filter(prescription =>
          Boolean((prescription as { activeQueueEntry?: boolean }).activeQueueEntry)
        ).length,
        awaitingPaymentPrescriptions: enrichedPrescriptions.filter(
          prescription =>
            Boolean((prescription as { activeQueueEntry?: boolean }).activeQueueEntry) &&
            String(
              (prescription as { paymentStatus?: string }).paymentStatus || 'PENDING'
            ).toUpperCase() !== 'PAID'
        ).length,
        readyToDispensePrescriptions: enrichedPrescriptions.filter(
          prescription =>
            Boolean((prescription as { activeQueueEntry?: boolean }).activeQueueEntry) &&
            String(
              (prescription as { paymentStatus?: string }).paymentStatus || 'PENDING'
            ).toUpperCase() === 'PAID'
        ).length,
      };
    });
  }

  async getMedicineDeskQueue(clinicId?: string) {
    const prescriptions = await this.findActiveDeskPrescriptions(clinicId);
    return prescriptions
      .filter(prescription =>
        Boolean((prescription as { activeQueueEntry?: boolean }).activeQueueEntry)
      )
      .sort((left, right) => {
        const leftPosition = Number(
          (left as { position?: number | null; queuePosition?: number | null }).position ||
            (left as { queuePosition?: number | null }).queuePosition ||
            0
        );
        const rightPosition = Number(
          (right as { position?: number | null; queuePosition?: number | null }).position ||
            (right as { queuePosition?: number | null }).queuePosition ||
            0
        );
        return leftPosition - rightPosition;
      });
  }

  // ============ Supplier Management ============

  async findAllSuppliers(clinicId?: string) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        supplier: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
      };
      const where: Record<string, unknown> = { isActive: true };
      if (clinicId) where['clinicId'] = clinicId;

      return await typedClient.supplier.findMany({
        where: where as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
  }

  /**
   * Supplier names are unique per clinic, compared without case and outer spaces (deleted
   * suppliers excluded; `excludeId` is the supplier being renamed). A clash is a 409.
   */
  /**
   * 409 when an active medicine of the clinic already has this name (strength is part of the
   * name) and dosage form, case-insensitive with spaces normalised (`excludeId`: the one edited).
   */
  private async assertMedicineNameFree(
    client: unknown,
    clinicId: string,
    name: string,
    form: string | null,
    excludeId?: string
  ): Promise<void> {
    const typedClient = client as {
      medicine: { findFirst: (args: PrismaDelegateArgs) => Promise<unknown> };
    };
    const normalizedForm = normalizeMedicineForm(form);
    const clash = await typedClient.medicine.findFirst({
      where: {
        clinicId,
        isActive: true,
        name: { equals: normalizeMedicineName(name), mode: 'insensitive' },
        category: normalizedForm ? { equals: normalizedForm, mode: 'insensitive' } : null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      } as PrismaDelegateArgs,
      select: { id: true } as PrismaDelegateArgs,
    } as PrismaDelegateArgs);
    if (clash) {
      throw new ConflictException(duplicateMedicineMessage(name, normalizedForm));
    }
  }

  /** Duplicate check of an edit: the medicine's next name / form against the clinic's others. */
  private async assertRenameFree(
    client: unknown,
    id: string,
    clinicId: string,
    next: { name: string | undefined; form: string | null }
  ): Promise<void> {
    const typedClient = client as {
      medicine: {
        findFirst: (
          args: PrismaDelegateArgs
        ) => Promise<{ name?: string | null; category?: string | null } | null>;
      };
    };
    const current = await typedClient.medicine.findFirst({
      where: { id, clinicId } as PrismaDelegateArgs,
      select: { name: true, category: true } as PrismaDelegateArgs,
    } as PrismaDelegateArgs);
    if (!current) return; // the write reports "Medicine not found"
    const name = next.name ?? current.name ?? '';
    if (!name.trim()) return;
    await this.assertMedicineNameFree(
      client,
      clinicId,
      name,
      next.form ?? current.category ?? null,
      id
    );
  }

  private async assertSupplierNameFree(
    client: unknown,
    clinicId: string,
    name: string,
    excludeId?: string
  ): Promise<void> {
    const typedClient = client as {
      supplier: { findFirst: (args: PrismaDelegateArgs) => Promise<unknown> };
    };
    const clash = await typedClient.supplier.findFirst({
      where: {
        clinicId,
        deletedAt: null,
        name: { equals: name.trim(), mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      } as PrismaDelegateArgs,
      select: { id: true } as PrismaDelegateArgs,
    } as PrismaDelegateArgs);
    if (clash) {
      throw new ConflictException(`A supplier named "${name.trim()}" already exists`);
    }
  }

  async addSupplier(dto: CreateSupplierDto, clinicId: string) {
    // Checked in a read before the write: an HTTP error thrown inside a write is re-wrapped.
    await this.databaseService.executeHealthcareRead(client =>
      this.assertSupplierNameFree(client, clinicId, dto.name)
    );
    const created = await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          supplier: { create: (args: PrismaDelegateArgs) => Promise<unknown> };
        };
        return await typedClient.supplier.create({
          data: {
            ...(dto as unknown as Record<string, unknown>),
            clinicId,
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: 'system',
        clinicId,
        resourceType: 'SUPPLIER',
        operation: 'CREATE',
        resourceId: 'new',
        userRole: 'system',
        details: { name: (dto as unknown as Record<string, unknown>)['name'] },
      }
    );
    // GET /pharmacy/suppliers is cached for an hour: show the new supplier at once.
    await this.invalidateSupplierCache('supplier-created');
    return created;
  }

  private async invalidateSupplierCache(reason: string): Promise<void> {
    await invalidatePharmacyCacheTags(
      this.cacheService,
      this.loggingService,
      PHARMACY_SUPPLIER_CACHE_TAGS,
      reason
    );
  }

  async updateSupplier(id: string, dto: UpdateSupplierDto, clinicId: string) {
    if (dto.name !== undefined) {
      const name = dto.name;
      await this.databaseService.executeHealthcareRead(client =>
        this.assertSupplierNameFree(client, clinicId, name, id)
      );
    }
    const updatedSupplier = await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          supplier: {
            updateMany: (args: PrismaDelegateArgs) => Promise<{ count: number }>;
            findFirst: (args: PrismaDelegateArgs) => Promise<unknown>;
          };
        };
        // Clinic scoped: a supplier id of another clinic matches nothing.
        const updated = await typedClient.supplier.updateMany({
          where: { id, clinicId, deletedAt: null } as PrismaDelegateArgs,
          data: dto as unknown as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        if (updated.count !== 1) {
          throw new NotFoundException('Supplier not found');
        }
        return await typedClient.supplier.findFirst({
          where: { id, clinicId } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: 'system',
        clinicId,
        resourceType: 'SUPPLIER',
        operation: 'UPDATE',
        resourceId: id,
        userRole: 'system',
        details: dto as unknown as Record<string, unknown>,
      }
    );
    await this.invalidateSupplierCache('supplier-updated');
    return updatedSupplier;
  }

  /**
   * Whole-inventory stock counts and value of the clinic's active medicines (not the page on
   * screen, not the active filter): low = 0 < stock <= reorder level, out = stock <= 0, plus how
   * many expire within the default window. One definition for every tile that counts stock.
   */
  async getInventorySummary(
    clinicId?: string
  ): Promise<StockLevelSummary & { expiringSoon: number }> {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      const where = await this.buildInventoryWhere(typedClient, clinicId, undefined);
      const medicines = await typedClient.medicine.findMany({
        where,
        select: { stock: true, minStockThreshold: true, price: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
      const expiringSoon = await typedClient.medicine.count({
        where: await this.buildInventoryWhere(typedClient, clinicId, { expiringSoon: true }),
      } as PrismaDelegateArgs);
      return { ...summarizeStockLevels(medicines), expiringSoon };
    });
  }

  /**
   * Active medicines at or below their reorder level, lowest stock first then by name. One
   * query (`stock <= minStockThreshold` through a Prisma field reference; Medicine.stock is the
   * total on-hand kept in sync by the inventory layer), capped at `limit`.
   */
  async findLowStock(
    clinicId?: string,
    limit: number = LOW_STOCK_DEFAULT_LIMIT
  ): Promise<Medicine[]> {
    const take = Math.min(Math.max(1, Math.trunc(limit)), LOW_STOCK_MAX_LIMIT);
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return await typedClient.medicine.findMany({
        where: await this.buildInventoryWhere(typedClient, clinicId, { lowStock: true }),
        orderBy: [{ stock: 'asc' }, { name: 'asc' }],
        take,
      } as PrismaDelegateArgs);
    });
  }

  async findExpiringSoon(clinicId?: string, expiringDays: number = 90) {
    if (!clinicId) {
      return await this.findAllMedicines(clinicId, { expiringSoon: true, expiringDays });
    }

    // Delegate expiry scan to pharmacy-inventory (scans stockBatch.expiryDate).
    const expiringBatches = await this.expiryAlertService.scanExpiringBatches(
      clinicId,
      expiringDays
    );
    const productIds = Array.from(new Set(expiringBatches.map(b => b.productId)));

    if (productIds.length === 0) {
      return [];
    }

    const medicines = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return typedClient.medicine.findMany({
        where: {
          clinicId,
          id: { in: productIds },
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });

    return medicines;
  }

  async getPrescriptionPaymentSummary(
    prescriptionId: string,
    clinicId?: string,
    actor?: { userId?: string; role?: string }
  ) {
    const prescription = await this.getPrescriptionByIdForAccess(prescriptionId, clinicId);
    this.ensurePatientOwnsPrescription(prescription, actor?.userId, actor?.role);
    // A draft is still with the doctor: nothing to bill. A patient does not learn it exists.
    if (isUnapprovedPrescription(String(prescription.status))) {
      if (isPatientRole(actor?.role)) {
        throw new NotFoundException('Prescription not found');
      }
      throw new ConflictException(prescriptionBillingRefusal(String(prescription.status)));
    }

    const payments = await this.findPrescriptionLinkedPayments(
      prescription.clinicId,
      prescription.id
    );
    const invoice = await this.findPrescriptionInvoiceSafe(prescription.id, clinicId);
    const paymentState = this.buildPrescriptionPaymentState(
      prescription,
      payments,
      invoice?.status ?? null
    );

    return {
      prescriptionId: prescription.id,
      status: prescription.status,
      totalAmount: paymentState.totalAmount,
      paidAmount: paymentState.paidAmount,
      pendingAmount: paymentState.pendingAmount,
      paymentStatus: paymentState.paymentStatus,
      canDispense: paymentState.canDispense,
      ...(invoice && {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoiceStatus: invoice.status,
      }),
    };
  }

  /** Best-effort read-only invoice lookup — never throws. */
  private async findPrescriptionInvoiceSafe(
    prescriptionId: string,
    clinicId?: string
  ): Promise<PrescriptionInvoiceRecord | null> {
    if (!clinicId) {
      return null;
    }
    const billingService = this.getBillingService();
    if (!billingService) {
      return null;
    }
    try {
      return await billingService.findPrescriptionInvoice(prescriptionId, clinicId);
    } catch {
      return null;
    }
  }

  async createPrescriptionPaymentIntent(
    prescriptionId: string,
    clinicId?: string,
    actor?: { userId?: string; role?: string },
    provider?: string
  ) {
    const prescription = await this.getPrescriptionByIdForAccess(prescriptionId, clinicId);
    this.ensurePatientOwnsPrescription(prescription, actor?.userId, actor?.role);
    this.assertPrescriptionBillable(String(prescription.status), actor?.role);

    const paymentState = await this.getPrescriptionPaymentSummary(prescriptionId, clinicId, actor);

    if (paymentState.pendingAmount <= 0) {
      return {
        alreadyPaid: true,
        ...paymentState,
        prescriptionId,
      };
    }

    // One "Pay" at a time per prescription: a double press (or a retry racing the first request)
    // gets a 409 instead of opening a second gateway order and a second PENDING row.
    const lockKey = `lock:pharmacy:rx-payment-intent:${prescription.id}`;
    if (!(await this.cacheService.acquireLock(lockKey, 30))) {
      throw new ConflictException(
        'A payment for this prescription is already being started. Please wait a moment.'
      );
    }
    try {
      return await this.openPrescriptionPaymentAttempt(prescription, paymentState, actor, provider);
    } finally {
      await this.cacheService.releaseLock(lockKey).catch(() => false);
    }
  }

  /** Reuses the live open attempt (same amount, inside its window) or opens a new one. */
  private async openPrescriptionPaymentAttempt(
    prescription: PrescriptionForAccess,
    paymentState: { pendingAmount: number; totalAmount: number },
    actor?: { userId?: string; role?: string },
    provider?: string
  ) {
    const invoice = await this.ensurePrescriptionInvoiceSafe(
      prescription.id,
      prescription.clinicId,
      actor
    );
    const invoiceFields = invoice
      ? {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          invoice: {
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            clinicId: prescription.clinicId,
          },
        }
      : {};
    const linked = await this.findPrescriptionLinkedPayments(
      prescription.clinicId,
      prescription.id
    );
    const plan = planPrescriptionPaymentAttempt(linked, paymentState.pendingAmount);

    if (plan.reuseId) {
      const reused = linked.find(row => row.id === plan.reuseId);
      const checkout = this.asRecord(this.asRecord(reused?.metadata)?.['checkout']) ?? {};
      return {
        ...paymentState,
        prescriptionId: prescription.id,
        clinicId: prescription.clinicId,
        paymentId: plan.reuseId,
        reused: true,
        paymentIntent: {
          ...checkout,
          success: true,
          metadata: {
            ...(this.asRecord(checkout['metadata']) ?? {}),
            paymentRecordId: plan.reuseId,
            prescriptionId: prescription.id,
            clinicId: prescription.clinicId,
          },
        },
        ...invoiceFields,
      };
    }

    const normalizedProvider = this.normalizePaymentProvider(provider);
    const customerId = prescription.patient?.user?.id || actor?.userId;
    const paymentIntentOptions: PaymentIntentOptions = {
      amount: Math.round(paymentState.pendingAmount * 100),
      currency: 'INR',
      ...(typeof customerId === 'string' && customerId ? { customerId } : {}),
      ...(prescription.patient?.user?.email && { customerEmail: prescription.patient.user.email }),
      ...(prescription.patient?.user?.phone && { customerPhone: prescription.patient.user.phone }),
      ...(prescription.patient?.user?.name && { customerName: prescription.patient.user.name }),
      description: buildPharmacyInvoiceDescription(prescriptionReference(prescription)),
      clinicId: prescription.clinicId,
      metadata: this.getPrescriptionPaymentMetadata(prescription.id),
    };

    const paymentIntentResult: PaymentResult = await this.paymentService.createPaymentIntent(
      prescription.clinicId,
      paymentIntentOptions,
      normalizedProvider
    );
    if (!paymentIntentResult.success) {
      // Never record an attempt for an order the gateway did not open.
      throw new BadRequestException(
        paymentIntentResult.error || 'The payment could not be started. Please try again.'
      );
    }

    // Older open attempts can no longer be paid usefully: close them so only one stays live.
    await this.supersedePrescriptionAttempts(
      plan.supersedeIds,
      linked,
      prescription.clinicId,
      actor
    );

    const checkout = {
      paymentId: paymentIntentResult.paymentId ?? null,
      orderId: paymentIntentResult.orderId ?? null,
      provider: paymentIntentResult.provider,
      amount: paymentIntentResult.amount,
      currency: paymentIntentResult.currency,
      status: paymentIntentResult.status,
      metadata: this.asRecord(paymentIntentResult.metadata) ?? {},
    };
    const paymentRecord = await this.databaseService.createPaymentSafe({
      amount: paymentState.pendingAmount,
      clinicId: prescription.clinicId,
      ...(prescription.patient?.user?.id && { userId: prescription.patient.user.id }),
      ...(invoice && { invoiceId: invoice.id }),
      status: PaymentStatus.PENDING,
      ...(paymentIntentResult.paymentId || paymentIntentResult.orderId
        ? { transactionId: paymentIntentResult.paymentId || paymentIntentResult.orderId }
        : {}),
      description: buildPharmacyInvoiceDescription(prescriptionReference(prescription)),
      metadata: {
        ...(this.asRecord(paymentIntentResult.metadata) || {}),
        ...this.getPrescriptionPaymentMetadata(prescription.id),
        ...(paymentIntentResult.orderId ? { orderId: paymentIntentResult.orderId } : {}),
        [PAYMENT_EXPIRES_AT_KEY]: paymentWindowEnd(new Date()).toISOString(),
        checkout,
      },
    });

    paymentIntentResult.metadata = {
      ...(this.asRecord(paymentIntentResult.metadata) || {}),
      paymentRecordId: paymentRecord.id,
      prescriptionId: prescription.id,
      clinicId: prescription.clinicId,
    };

    return {
      ...paymentState,
      prescriptionId: prescription.id,
      // The mobile payment callback needs the clinic (top level or invoice.clinicId).
      clinicId: prescription.clinicId,
      paymentId: paymentRecord.id,
      paymentIntent: paymentIntentResult,
      ...invoiceFields,
    };
  }

  private async supersedePrescriptionAttempts(
    ids: readonly string[],
    rows: readonly PrescriptionAttemptRow[],
    clinicId: string,
    actor?: { userId?: string; role?: string }
  ): Promise<void> {
    const closedAt = new Date().toISOString();
    for (const id of ids) {
      const row = rows.find(candidate => candidate.id === id);
      await this.databaseService.executeHealthcareWrite(
        async client =>
          (client as unknown as PrismaTransactionClientWithDelegates).payment.updateMany({
            where: { id, status: PaymentStatus.PENDING } as PrismaDelegateArgs,
            data: {
              status: PaymentStatus.CANCELLED,
              metadata: {
                ...(this.asRecord(row?.metadata) ?? {}),
                closedReason: 'SUPERSEDED_BY_NEW_ATTEMPT',
                closedAt,
              },
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs),
        {
          userId: actor?.userId ?? 'system',
          userRole: actor?.role ?? 'system',
          clinicId,
          resourceType: 'PAYMENT',
          operation: 'SUPERSEDE_ATTEMPT',
          resourceId: id,
          timestamp: new Date(),
        }
      );
    }
  }

  /**
   * 409 when the prescription cannot be billed now (draft with the doctor, cancelled, or already
   * dispensed). A patient gets a 404 for a draft: it is not theirs to see yet.
   */
  private assertPrescriptionBillable(status: string, role?: string): void {
    const refusal = prescriptionBillingRefusal(status);
    if (!refusal) return;
    if (isUnapprovedPrescription(status) && isPatientRole(role)) {
      throw new NotFoundException('Prescription not found');
    }
    throw new ConflictException(refusal);
  }

  /** Payments recorded for one prescription (metadata.prescriptionId), any status, newest first. */
  private async findPrescriptionLinkedPayments(
    clinicId: string,
    prescriptionId: string
  ): Promise<Array<PrescriptionAttemptRow & { createdAt: Date }>> {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return (await typedClient.payment.findMany({
        where: {
          clinicId,
          metadata: { path: ['prescriptionId'], equals: prescriptionId },
        } as PrismaDelegateArgs,
        orderBy: { createdAt: 'desc' } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as unknown as Array<PrescriptionAttemptRow & { createdAt: Date }>;
    });
  }

  /**
   * Records an over-the-counter cash payment so the medicine desk can
   * dispense. Skips the online gateway entirely: the dispense gate
   * (`buildPrescriptionPaymentState`) only looks for COMPLETED payments
   * linked to the prescription, regardless of how they were collected.
   */
  async recordCashPrescriptionPayment(
    prescriptionId: string,
    clinicId: string | undefined,
    actor: { userId?: string; role?: string },
    amount?: number
  ) {
    if (!clinicId) throw new BadRequestException('Clinic ID is required');

    const prescription = await this.getPrescriptionByIdForAccess(prescriptionId, clinicId);
    this.assertPrescriptionBillable(String(prescription.status), actor?.role);

    const paymentState = await this.getPrescriptionPaymentSummary(prescriptionId, clinicId, actor);
    if (paymentState.pendingAmount <= 0) {
      return { alreadyPaid: true, ...paymentState, prescriptionId };
    }

    const invoice = await this.ensurePrescriptionInvoiceSafe(prescription.id, clinicId, actor);
    const outcome = await this.insertCashPaymentLocked(
      prescription,
      paymentState.totalAmount,
      invoice?.id ?? null,
      actor,
      amount
    );
    if (outcome.kind === 'refused') throw new ConflictException(outcome.message);
    if (outcome.kind === 'invalid') throw new BadRequestException(outcome.message);

    await this.cacheService.invalidateCacheByTag('payments').catch(() => 0);
    if (outcome.invoiceSettled && invoice) {
      await this.afterCashSettledInvoice(invoice.id, clinicId);
    }
    await this.emitMedicineDeskQueueUpdated(clinicId, prescription.id, 'PAYMENT_UPDATED');

    const updatedState = await this.getPrescriptionPaymentSummary(prescriptionId, clinicId, actor);
    return {
      ...updatedState,
      prescriptionId: prescription.id,
      paymentId: outcome.paymentId,
      method: PaymentMethod.CASH,
      ...(invoice && {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoiceStatus: outcome.invoiceSettled ? 'PAID' : String(invoice.status),
      }),
    };
  }

  /**
   * Post-commit side effects of a cash settlement (best effort): drop the invoice caches and
   * rebuild the PDF so the receipt reads PAID. No WhatsApp receipt is sent from the counter.
   */
  private async afterCashSettledInvoice(invoiceId: string, clinicId: string): Promise<void> {
    await this.databaseService
      .invalidateEntityCache('invoice', invoiceId, clinicId)
      .catch(() => undefined);
    await Promise.all(
      ['invoices', `invoice:${invoiceId}`].map(tag =>
        this.cacheService.invalidateCacheByTag(tag).catch(() => 0)
      )
    );
    const billingService = this.getBillingService();
    if (!billingService?.generateInvoicePDF) return;
    try {
      await billingService.generateInvoicePDF(invoiceId);
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        'Failed to regenerate pharmacy invoice PDF after cash settlement',
        'PharmacyService',
        { invoiceId, error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  /**
   * Re-reads the balance and inserts the cash payment under row locks (the prescription, then
   * its invoice: the same invoice row the billing desk's record-payment locks), so two clicks
   * can never both collect the balance.
   */
  private async insertCashPaymentLocked(
    prescription: PrescriptionForAccess,
    totalAmount: number,
    invoiceId: string | null,
    actor: { userId?: string; role?: string },
    amount?: number
  ): Promise<
    | { kind: 'refused'; message: string }
    | { kind: 'invalid'; message: string }
    | { kind: 'created'; paymentId: string; invoiceSettled: boolean }
  > {
    return await this.databaseService.executeInTransaction(async client => {
      const tx = client as unknown as PrismaTransactionClientWithDelegates;
      const locked = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT "status"::text AS "status" FROM "Prescription" WHERE "id" = ${prescription.id} FOR UPDATE`;
      const lockedInvoice = invoiceId
        ? (
            await tx.$queryRaw<
              Array<{ status: string; totalAmount: number | null; metadata: object | null }>
            >`SELECT "status"::text AS "status", "totalAmount", "metadata" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`
          )[0]
        : undefined;
      const refusal = prescriptionBillingRefusal(locked[0]?.status);
      if (refusal) return { kind: 'refused' as const, message: refusal };

      const completed = (await tx.payment.findMany({
        where: {
          clinicId: prescription.clinicId,
          status: PaymentStatus.COMPLETED,
          metadata: { path: ['prescriptionId'], equals: prescription.id },
        } as PrismaDelegateArgs,
        select: { amount: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as unknown as Array<{ amount: number | null }>;
      const paidPaise = completed.reduce(
        (sum, row) => sum + Math.round(Number(row.amount ?? 0) * 100),
        0
      );
      const pendingPaise = Math.max(0, Math.round(totalAmount * 100) - paidPaise);
      const plan = planPrescriptionCash(
        pendingPaise / 100,
        amount !== undefined ? Number(amount) : undefined
      );
      if (!plan.ok) return { kind: 'invalid' as const, message: plan.message };

      const created = (await tx.payment.create({
        data: {
          amount: plan.amount,
          clinicId: prescription.clinicId,
          ...(prescription.patient?.user?.id && { userId: prescription.patient.user.id }),
          ...(invoiceId && { invoiceId }),
          status: PaymentStatus.COMPLETED,
          method: PaymentMethod.CASH,
          description: `Cash payment — ${buildPharmacyInvoiceDescription(prescriptionReference(prescription))}`,
          metadata: {
            ...this.getPrescriptionPaymentMetadata(prescription.id),
            paymentMethod: PaymentMethod.CASH,
            collectedBy: actor.userId ?? null,
            collectedByRole: actor.role ?? null,
            collectedAt: new Date().toISOString(),
          },
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as unknown as { id: string };

      const invoiceSettled = await this.settleInvoiceForCashLocked(
        tx,
        invoiceId,
        lockedInvoice,
        prescription,
        created.id
      );
      return { kind: 'created' as const, paymentId: created.id, invoiceSettled };
    });
  }

  /**
   * N3: once the collected total covers the PHARMACY invoice, it moves to PAID (paidAt) inside
   * the cash-payment transaction, exactly like an online payment settles it. Dispensing stays a
   * separate step. Counts every COMPLETED payment on the invoice or linked to the prescription
   * (the new cash row included), so billing-desk partials are not double counted or missed.
   */
  private async settleInvoiceForCashLocked(
    tx: PrismaTransactionClientWithDelegates,
    invoiceId: string | null,
    lockedInvoice:
      { status: string; totalAmount: number | null; metadata: object | null } | undefined,
    prescription: PrescriptionForAccess,
    paymentId: string
  ): Promise<boolean> {
    if (!invoiceId || !lockedInvoice) return false;
    const status = String(lockedInvoice.status).toUpperCase();
    if (status === 'PAID' || status === 'REFUNDED' || status === 'VOID') return false;

    const rows = (await tx.payment.findMany({
      where: {
        clinicId: prescription.clinicId,
        status: PaymentStatus.COMPLETED,
        OR: [{ invoiceId }, { metadata: { path: ['prescriptionId'], equals: prescription.id } }],
      } as PrismaDelegateArgs,
      select: { id: true, amount: true } as PrismaDelegateArgs,
    } as PrismaDelegateArgs)) as unknown as Array<{ id: string; amount: number | null }>;
    const paidPaise = rows.reduce((sum, row) => sum + Math.round(Number(row.amount ?? 0) * 100), 0);
    const totalPaise = Math.round(Number(lockedInvoice.totalAmount ?? 0) * 100);
    if (!cashSettlesInvoice(paidPaise, 0, totalPaise)) return false;

    const metadata =
      lockedInvoice.metadata && typeof lockedInvoice.metadata === 'object'
        ? (lockedInvoice.metadata as Record<string, unknown>)
        : {};
    const result = (await tx.invoice.updateMany({
      where: { id: invoiceId, status: { not: 'PAID' } } as PrismaDelegateArgs,
      data: {
        status: 'PAID',
        paidAt: new Date(),
        metadata: { ...metadata, settledByPaymentId: paymentId },
      } as PrismaDelegateArgs,
    } as PrismaDelegateArgs)) as unknown as { count: number };
    return result.count === 1;
  }
}
