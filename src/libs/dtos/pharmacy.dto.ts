import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsPositive,
  IsInt,
  IsDateString,
  IsOptional,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsEnum,
  IsIn,
  IsBoolean,
  Min,
  MaxLength,
  ArrayMinSize,
  ArrayMaxSize,
  Max,
  Matches,
  IsUUID,
  IsEmail,
  ValidateIf,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Dosage forms the apps send as `type`. Stored in `Medicine.category` (a plain string, so adding a
 * form needs no migration). Multi-word forms use an underscore: YAVKUT_KWATH.
 */
export enum MedicineType {
  TABLET = 'TABLET',
  CAPSULE = 'CAPSULE',
  SYRUP = 'SYRUP',
  INJECTION = 'INJECTION',
  CREAM = 'CREAM',
  DROPS = 'DROPS',
  BHASMA = 'BHASMA',
  CHURNA = 'CHURNA',
  GEL = 'GEL',
  GHRITA = 'GHRITA',
  GRANULE = 'GRANULE',
  KASHAYAM = 'KASHAYAM',
  YAVKUT_KWATH = 'YAVKUT_KWATH',
  LEPA = 'LEPA',
  VATI = 'VATI',
  DRINK = 'DRINK',
  PARPATI = 'PARPATI',
  PISHTEE = 'PISHTEE',
  GUTIKA = 'GUTIKA',
  ASAVA = 'ASAVA',
  ARISHTA = 'ARISHTA',
  AVALEHA = 'AVALEHA',
  SHAMPOO = 'SHAMPOO',
  LOTION = 'LOTION',
  OIL = 'OIL',
  OINTMENT = 'OINTMENT',
  TOOTHPASTE = 'TOOTHPASTE',
  SOAP = 'SOAP',
  SWARASA = 'SWARASA',
  OTHER = 'OTHER',
}

/** The DB enum `MedicineType` (Medicine.type). */
export enum MedicineClassification {
  CLASSICAL = 'CLASSICAL',
  PROPRIETARY = 'PROPRIETARY',
  HERBAL = 'HERBAL',
}

/** A classification as the plain string literal the Prisma where clause takes. */
export type MedicineClassificationValue = `${MedicineClassification}`;

/** "Yavkut Kwath", "yavkut-kwath" and "YAVKUT_KWATH" are the same form. */
export function normaliseMedicineTypeToken(value: unknown): unknown {
  return typeof value === 'string'
    ? value
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, '_')
    : value;
}

/** Every value accepted for the `type` field of the inventory create/update routes. */
export const MEDICINE_TYPE_INPUT_VALUES: string[] = [
  ...Object.values(MedicineClassification),
  ...Object.values(MedicineType),
];

/**
 * Dosage forms of the classical Ayurvedic pharmacopoeia. A medicine created with only one of
 * these forms is a CLASSICAL preparation by default; every other form defaults to PROPRIETARY.
 */
export const CLASSICAL_DOSAGE_FORMS: ReadonlySet<string> = new Set<string>([
  MedicineType.CHURNA,
  MedicineType.KASHAYAM,
  MedicineType.ARISHTA,
  MedicineType.ASAVA,
  MedicineType.AVALEHA,
  MedicineType.GHRITA,
  MedicineType.LEPA,
  MedicineType.VATI,
  MedicineType.BHASMA,
  MedicineType.GUTIKA,
  MedicineType.PARPATI,
  MedicineType.PISHTEE,
  MedicineType.SWARASA,
  MedicineType.YAVKUT_KWATH,
]);

/** Classification a newly created medicine gets when the caller only named its dosage form. */
export function defaultClassificationForForm(form: string): MedicineClassification {
  return CLASSICAL_DOSAGE_FORMS.has(form)
    ? MedicineClassification.CLASSICAL
    : MedicineClassification.PROPRIETARY;
}

/** Whether the `type` field is being resolved for a new medicine or an edit of an existing one. */
export type MedicineTypeIntent = 'create' | 'update';

/**
 * `type` mapping (documented contract):
 * - CLASSICAL | PROPRIETARY | HERBAL -> stored as `Medicine.type` as-is.
 * - A dosage form (TABLET, SYRUP, CHURNA, VATI, ... OTHER) -> stored in `Medicine.category`.
 *   - On CREATE `Medicine.type` defaults to CLASSICAL for the classical Ayurvedic forms
 *     (see CLASSICAL_DOSAGE_FORMS) and to PROPRIETARY otherwise, unless an explicit
 *     `classification` is also given.
 *   - On UPDATE a dosage form changes only `category`; `Medicine.type` changes only through
 *     `classification` (or a classification value sent as `type`).
 * Anything else is rejected by the DTO validation with a 400.
 */
export function resolveMedicineTypeInput(
  input: {
    type?: string | undefined;
    classification?: string | undefined;
    category?: string | undefined;
  },
  intent: MedicineTypeIntent = 'create'
): { type?: MedicineClassification; category?: string } {
  const classifications: string[] = Object.values(MedicineClassification);
  const forms: string[] = Object.values(MedicineType);
  const normalise = (value: string | undefined): string | undefined =>
    normaliseMedicineTypeToken(value) as string | undefined;
  const rawType = normalise(input.type);
  const rawClassification = normalise(input.classification);
  const rawCategory = normalise(input.category);

  let type: MedicineClassification | undefined;
  let category: string | undefined;

  if (rawClassification && classifications.includes(rawClassification)) {
    type = rawClassification as MedicineClassification;
  }
  if (rawType && classifications.includes(rawType)) {
    type = rawType as MedicineClassification;
  } else if (rawType && forms.includes(rawType)) {
    category = rawType;
  }
  if (rawCategory && forms.includes(rawCategory)) {
    category = rawCategory;
  }
  if (intent === 'create' && !type && category) {
    type = defaultClassificationForForm(category);
  }
  return {
    ...(type ? { type } : {}),
    ...(category ? { category } : {}),
  };
}

export enum PrescriptionStatus {
  PENDING = 'PENDING',
  PARTIAL = 'PARTIAL',
  FILLED = 'FILLED',
  CANCELLED = 'CANCELLED',
  /** Prepared by the assistant doctor, awaiting the doctor's approval (never visible to pharmacy). */
  DRAFT = 'DRAFT',
  /** Sent back by the doctor with a change note (never visible to pharmacy). */
  RETURNED = 'RETURNED',
}

/**
 * Statuses of an assistant-doctor draft that is not a prescription yet (awaiting the
 * doctor's approval, or sent back). They must never reach patients, the pharmacy desk,
 * pharmacy stats or the batch audit.
 */
export const UNPUBLISHED_PRESCRIPTION_STATUSES: readonly PrescriptionStatus[] = Object.freeze([
  PrescriptionStatus.DRAFT,
  PrescriptionStatus.RETURNED,
]);

/** Prisma `status` filter that excludes unpublished drafts (fresh object per call). */
export function publishedPrescriptionStatusFilter(): { notIn: PrescriptionStatus[] } {
  return { notIn: [...UNPUBLISHED_PRESCRIPTION_STATUSES] };
}

/**
 * Status words the mobile pharmacy desk sends (M9) mapped to the stored enum:
 * pending -> PENDING, processing/partial -> PARTIAL, ready/dispensed/completed/filled ->
 * FILLED, cancelled/canceled -> CANCELLED. Case-insensitive; unknown words are returned
 * unchanged so the `@IsIn` validator rejects them with a clear 400.
 */
export const PRESCRIPTION_STATUS_ALIASES: Readonly<Record<string, PrescriptionStatus>> = {
  PENDING: PrescriptionStatus.PENDING,
  PROCESSING: PrescriptionStatus.PARTIAL,
  PARTIAL: PrescriptionStatus.PARTIAL,
  PARTIALLY_DISPENSED: PrescriptionStatus.PARTIAL,
  READY: PrescriptionStatus.FILLED,
  DISPENSED: PrescriptionStatus.FILLED,
  COMPLETED: PrescriptionStatus.FILLED,
  FILLED: PrescriptionStatus.FILLED,
  CANCELLED: PrescriptionStatus.CANCELLED,
  CANCELED: PrescriptionStatus.CANCELLED,
};

export function normalisePrescriptionStatusInput(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const key = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return PRESCRIPTION_STATUS_ALIASES[key] ?? key;
}

export const INVENTORY_DEFAULT_PAGE_SIZE = 50;
export const INVENTORY_MAX_PAGE_SIZE = 500;
export const INVENTORY_DEFAULT_EXPIRING_DAYS = 90;
export const INVENTORY_MAX_EXPIRING_DAYS = 3650;
export const INVENTORY_SEARCH_MAX_LENGTH = 120;
export const LOW_STOCK_DEFAULT_LIMIT = 100;
export const LOW_STOCK_MAX_LIMIT = 500;

const BOOLEAN_QUERY_VALUES: readonly string[] = ['true', 'false'];
const CACHE_BUSTER_MAX_LENGTH = 64;
const trimQueryString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
/** Clamps an already converted integer query value to `max`; anything else is left to the validators. */
const clampQueryInt =
  (max: number) =>
  ({ value }: { value: unknown }): unknown =>
    typeof value === 'number' && value > max ? max : value;

/**
 * Cache-buster query keys the cache interceptor understands (`?bust=1`, `?_t=<now>`, ...).
 * The global ValidationPipe forbids unknown keys, so a whitelisted query DTO has to declare
 * them; they are validated loosely and never read.
 */
export class CacheBusterQueryDto {
  @ApiPropertyOptional({ description: 'Cache buster, ignored' })
  @IsOptional()
  @IsString()
  @MaxLength(CACHE_BUSTER_MAX_LENGTH)
  bust?: string;

  @ApiPropertyOptional({ description: 'Cache buster, ignored' })
  @IsOptional()
  @IsString()
  @MaxLength(CACHE_BUSTER_MAX_LENGTH)
  cacheBust?: string;

  @ApiPropertyOptional({ description: 'Cache buster (timestamp), ignored' })
  @IsOptional()
  @IsString()
  @MaxLength(CACHE_BUSTER_MAX_LENGTH)
  _t?: string;

  @ApiPropertyOptional({ description: 'Cache buster (timestamp), ignored' })
  @IsOptional()
  @IsString()
  @MaxLength(CACHE_BUSTER_MAX_LENGTH)
  ts?: string;
}

// ---------------------------------------------------------------------------
// GET /pharmacy/prescriptions (paged variant) and GET /pharmacy/prescriptions/summary
// ---------------------------------------------------------------------------

/** Page sizes the paged prescription list accepts. */
export const PRESCRIPTION_LIST_PAGE_SIZES: readonly number[] = Object.freeze([10, 25, 50, 100]);
export const PRESCRIPTION_LIST_DEFAULT_PAGE_SIZE = 25;
export const PRESCRIPTION_LIST_SEARCH_MAX_LENGTH = 100;

/**
 * Status filter of the paged list. ACTIVE = PENDING + PARTIAL (still at the medicine desk);
 * COMPLETED (alias of FILLED) = dispensed. The stored PrescriptionStatus values and the M9
 * aliases (pending, processing, ready, dispensed, ...) stay accepted.
 */
export const PRESCRIPTION_LIST_ACTIVE_STATUS = 'ACTIVE' as const;
export type PrescriptionListStatus = typeof PRESCRIPTION_LIST_ACTIVE_STATUS | PrescriptionStatus;
export const PRESCRIPTION_LIST_STATUSES: readonly PrescriptionListStatus[] = Object.freeze([
  PRESCRIPTION_LIST_ACTIVE_STATUS,
  ...Object.values(PrescriptionStatus),
]);

/** Where the prescription is at the medicine desk (the PHARMACY pill of the doctor screen). */
export enum PrescriptionPharmacyStage {
  PAYMENT_PENDING = 'PAYMENT_PENDING',
  READY_TO_DISPENSE = 'READY_TO_DISPENSE',
  DISPENSED = 'DISPENSED',
  /**
   * Waiting at the counter: paid (or zero-priced), dispensed (FILLED, or PARTIAL with units
   * dispensed), has medicines, and never collected (no HANDED_OVER hand-over) - at any age.
   */
  READY_TO_COLLECT = 'READY_TO_COLLECT',
  NOT_SENT = 'NOT_SENT',
}

export enum PrescriptionListSort {
  NEWEST = 'newest',
  OLDEST = 'oldest',
  PATIENT = 'patient',
}

const IST_DAY_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const IST_DAY_KEY_MESSAGE = 'must be an IST calendar day (YYYY-MM-DD)';

function normalisePrescriptionListStatusInput(value: unknown): unknown {
  if (typeof value === 'string' && value.trim().toUpperCase() === PRESCRIPTION_LIST_ACTIVE_STATUS) {
    return PRESCRIPTION_LIST_ACTIVE_STATUS;
  }
  return normalisePrescriptionStatusInput(value);
}

const upperQueryToken = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const lowerQueryToken = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** `dateFrom` / `dateTo`: IST calendar days, inclusive. Shared by the list and the summary. */
export class PrescriptionDateRangeQueryDto extends CacheBusterQueryDto {
  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'First IST calendar day (inclusive, from IST midnight), YYYY-MM-DD',
  })
  @IsOptional()
  @Transform(trimQueryString)
  @Matches(IST_DAY_KEY_PATTERN, { message: `dateFrom ${IST_DAY_KEY_MESSAGE}` })
  dateFrom?: string;

  @ApiPropertyOptional({
    example: '2026-10-21',
    description: 'Last IST calendar day (inclusive, up to the next IST midnight), YYYY-MM-DD',
  })
  @IsOptional()
  @Transform(trimQueryString)
  @Matches(IST_DAY_KEY_PATTERN, { message: `dateTo ${IST_DAY_KEY_MESSAGE}` })
  dateTo?: string;
}

/**
 * `GET /pharmacy/prescriptions` with `page`: server-side filtered and paged list,
 * `{ data, total, page, limit }`. Without `page` the route keeps the legacy bare array and this
 * DTO is not applied (old apps send unvalidated keys such as `search`).
 */
export class ListPrescriptionsQueryDto extends PrescriptionDateRangeQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    description: '1-based page; omit it for the legacy bare array of every prescription',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    enum: PRESCRIPTION_LIST_PAGE_SIZES,
    default: PRESCRIPTION_LIST_DEFAULT_PAGE_SIZE,
    description: 'Page size',
  })
  @IsOptional()
  @Type(() => Number)
  @IsIn(PRESCRIPTION_LIST_PAGE_SIZES, {
    message: `limit must be one of ${PRESCRIPTION_LIST_PAGE_SIZES.join(', ')}`,
  })
  limit?: number;

  @ApiPropertyOptional({
    maxLength: PRESCRIPTION_LIST_SEARCH_MAX_LENGTH,
    description:
      'Case-insensitive "contains" search over patient name / phone, UHID, OPD number, prescription number, medicine name and diagnosis',
  })
  @IsOptional()
  @Transform(trimQueryString)
  @IsString()
  @MaxLength(PRESCRIPTION_LIST_SEARCH_MAX_LENGTH)
  q?: string;

  @ApiPropertyOptional({
    enum: ['ACTIVE', 'COMPLETED', 'CANCELLED', 'DRAFT', 'RETURNED', 'PENDING', 'PARTIAL', 'FILLED'],
    description:
      'ACTIVE = PENDING + PARTIAL, COMPLETED = FILLED. DRAFT / RETURNED only for doctors, assistant doctors and admins. Also accepts pending/processing/ready/dispensed/cancelled',
  })
  @IsOptional()
  @Transform(({ value }) => normalisePrescriptionListStatusInput(value))
  @IsIn(PRESCRIPTION_LIST_STATUSES, {
    message: `status must be one of ACTIVE, COMPLETED, ${Object.values(PrescriptionStatus).join(', ')}`,
  })
  status?: PrescriptionListStatus;

  @ApiPropertyOptional({
    enum: PrescriptionPharmacyStage,
    description:
      'Medicine-desk stage: PAYMENT_PENDING / READY_TO_DISPENSE (PENDING, by payments vs the medicine total; PARTIAL counts as ready), DISPENSED (FILLED), NOT_SENT (DRAFT / RETURNED)',
  })
  @IsOptional()
  @Transform(upperQueryToken)
  @IsEnum(PrescriptionPharmacyStage)
  pharmacyStage?: PrescriptionPharmacyStage;

  @ApiPropertyOptional({ format: 'uuid', description: 'Patient.id' })
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({
    enum: PrescriptionListSort,
    default: PrescriptionListSort.NEWEST,
    description: 'newest / oldest by prescription date, patient = patient name A-Z',
  })
  @IsOptional()
  @Transform(lowerQueryToken)
  @IsEnum(PrescriptionListSort)
  sort?: PrescriptionListSort;
}

/** `GET /pharmacy/prescriptions/summary` (no dates = all time; `today` is always today, IST). */
export class PrescriptionSummaryQueryDto extends PrescriptionDateRangeQueryDto {}

export class PrescriptionSummaryDto {
  @ApiProperty({ description: 'Published prescriptions (no drafts) in the range' })
  total!: number;

  @ApiProperty({ description: 'PENDING + PARTIAL' })
  active!: number;

  @ApiProperty({ description: 'FILLED' })
  completed!: number;

  @ApiProperty({ description: 'CANCELLED' })
  cancelled!: number;

  @ApiProperty({ description: 'DRAFT + RETURNED (0 for roles that never see drafts)' })
  drafts!: number;

  @ApiProperty({ description: 'Published prescriptions written today (IST)' })
  today!: number;

  @ApiProperty({ description: 'Distinct patients among the published prescriptions in the range' })
  uniquePatients!: number;
}

/**
 * `GET /pharmacy/inventory` filters and optional pagination. Without `page` every matching row
 * is returned as the legacy bare array (`limit` is ignored); with `page` the response is
 * `{ data, total, page, limit }`. Filtering happens in the database.
 */
export class InventoryQueryDto extends CacheBusterQueryDto {
  @ApiPropertyOptional({
    maxLength: INVENTORY_SEARCH_MAX_LENGTH,
    description: 'Case-insensitive "contains" match on name, manufacturer or category',
  })
  @IsOptional()
  @Transform(trimQueryString)
  @IsString()
  @MaxLength(INVENTORY_SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({ enum: MedicineType, description: 'Dosage form (Medicine.category)' })
  @IsOptional()
  @Transform(({ value }) => normaliseMedicineTypeToken(value))
  @IsEnum(MedicineType)
  category?: MedicineType;

  @ApiPropertyOptional({
    enum: MedicineClassification,
    description: 'Classification (Medicine.type): CLASSICAL, PROPRIETARY or HERBAL',
  })
  @IsOptional()
  @Transform(({ value }) => normaliseMedicineTypeToken(value))
  @IsIn(Object.values(MedicineClassification))
  type?: MedicineClassificationValue;

  @ApiPropertyOptional({
    enum: BOOLEAN_QUERY_VALUES,
    description: "'true' keeps only medicines with stock above zero",
  })
  @IsOptional()
  @IsIn(BOOLEAN_QUERY_VALUES)
  inStock?: string;

  @ApiPropertyOptional({
    enum: BOOLEAN_QUERY_VALUES,
    description: "'true' keeps only medicines at or below their reorder level",
  })
  @IsOptional()
  @IsIn(BOOLEAN_QUERY_VALUES)
  lowStock?: string;

  @ApiPropertyOptional({
    enum: BOOLEAN_QUERY_VALUES,
    description: "'true' keeps only medicines with no stock left (stock <= 0)",
  })
  @IsOptional()
  @IsIn(BOOLEAN_QUERY_VALUES)
  outOfStock?: string;

  @ApiPropertyOptional({
    enum: BOOLEAN_QUERY_VALUES,
    description: "'true' keeps only medicines expiring within expiringDays",
  })
  @IsOptional()
  @IsIn(BOOLEAN_QUERY_VALUES)
  expiringSoon?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: INVENTORY_MAX_EXPIRING_DAYS,
    description: `Window of expiringSoon in days (default ${INVENTORY_DEFAULT_EXPIRING_DAYS})`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(INVENTORY_MAX_EXPIRING_DAYS)
  expiringDays?: number;

  @ApiPropertyOptional({
    minimum: 1,
    description: '1-based page; omit it for the legacy bare array of every matching row',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: INVENTORY_MAX_PAGE_SIZE,
    description: `Page size (default ${INVENTORY_DEFAULT_PAGE_SIZE}, values above ${INVENTORY_MAX_PAGE_SIZE} are clamped); ignored without page`,
  })
  @IsOptional()
  @Type(() => Number)
  @Transform(clampQueryInt(INVENTORY_MAX_PAGE_SIZE))
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({
    deprecated: true,
    minimum: 0,
    description: 'Legacy parameter of older web builds; accepted and ignored (use page)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/** Filters of GET /pharmacy/inventory once the query is parsed; applied in the database. */
export interface InventoryFilters {
  readonly search?: string;
  readonly category?: string;
  readonly type?: MedicineClassificationValue;
  readonly inStock?: boolean;
  readonly lowStock?: boolean;
  readonly outOfStock?: boolean;
  readonly expiringSoon?: boolean;
  readonly expiringDays?: number;
}

/** The validated query as service filters: string flags become booleans, absent ones vanish. */
export function toInventoryFilters(query: InventoryQueryDto): InventoryFilters {
  return {
    ...(query.search ? { search: query.search } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.inStock === 'true' ? { inStock: true } : {}),
    ...(query.lowStock === 'true' ? { lowStock: true } : {}),
    ...(query.outOfStock === 'true' ? { outOfStock: true } : {}),
    ...(query.expiringSoon === 'true' ? { expiringSoon: true } : {}),
    ...(query.expiringDays !== undefined ? { expiringDays: query.expiringDays } : {}),
  };
}

/** `GET /pharmacy/inventory/low-stock` options. */
export class LowStockQueryDto extends CacheBusterQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: LOW_STOCK_MAX_LIMIT,
    description: `Rows to return, lowest stock first (default ${LOW_STOCK_DEFAULT_LIMIT}, values above ${LOW_STOCK_MAX_LIMIT} are clamped)`,
  })
  @IsOptional()
  @Type(() => Number)
  @Transform(clampQueryInt(LOW_STOCK_MAX_LIMIT))
  @IsInt()
  @Min(1)
  limit?: number;
}

export class CreateMedicineDto {
  @ApiProperty({ example: 'Paracetamol', description: 'Name of the medicine' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'Pfizer', description: 'Manufacturer name' })
  @IsString()
  @IsNotEmpty()
  manufacturer!: string;

  @ApiPropertyOptional({ example: 'Pain relief', description: 'Description / properties' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({
    enum: MEDICINE_TYPE_INPUT_VALUES,
    example: MedicineType.TABLET,
    description:
      'Either the classification (CLASSICAL, PROPRIETARY, HERBAL) or a dosage form (TABLET, ' +
      'SYRUP, CAPSULE, INJECTION, CREAM, DROPS, BHASMA, CHURNA, VATI, ... OTHER); dosage forms are stored as category.',
  })
  @Transform(({ value }) => normaliseMedicineTypeToken(value))
  @IsIn(MEDICINE_TYPE_INPUT_VALUES, {
    message: `type must be one of: ${MEDICINE_TYPE_INPUT_VALUES.join(', ')}`,
  })
  type!: string;

  @ApiPropertyOptional({ enum: MedicineClassification })
  @IsOptional()
  @IsEnum(MedicineClassification)
  classification?: MedicineClassification;

  @ApiPropertyOptional({ enum: MedicineType, description: 'Dosage form' })
  @IsOptional()
  @IsEnum(MedicineType)
  category?: MedicineType;

  @ApiPropertyOptional({ example: 'strip', description: 'Unit of sale (strip, bottle, ...)' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  unit?: string;

  @ApiPropertyOptional({ example: 'B123456', description: 'Batch number' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  batchNumber?: string;

  @ApiPropertyOptional({ description: 'Internal notes' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiProperty({ example: 100, description: 'Quantity in stock' })
  @IsInt()
  @Min(0)
  quantity!: number;

  @ApiProperty({ example: 10.5, description: 'Price per unit' })
  @IsNumber()
  @IsPositive()
  price!: number;

  @ApiProperty({ example: '2025-12-31', description: 'Expiry date' })
  @IsDateString()
  expiryDate!: string;

  @ApiPropertyOptional({ example: 10, description: 'Minimum stock threshold for alerts' })
  @IsOptional()
  @IsInt()
  @Min(0)
  minStockThreshold?: number;

  @ApiPropertyOptional({ example: 'supplier-uuid', description: 'Supplier ID' })
  @IsOptional()
  @IsString()
  supplierId?: string;

  @ApiPropertyOptional({ example: 'Take after food', description: 'Usage instructions' })
  @IsOptional()
  @IsString()
  instructions?: string;
}

/** Trims a string body field (other values pass through to the validators). */
const trimSupplierText = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Supplier email: blank means "no email"; anything else must be a valid address. */
const hasSupplierEmail = (_dto: object, value: unknown): boolean =>
  value !== undefined && value !== null && value !== '';

/** Supplier phone: blank means "no phone"; anything else is 7-15 digits, optional + and spaces / dashes. */
const hasSupplierPhone = (_dto: object, value: unknown): boolean =>
  value !== undefined && value !== null && value !== '';
export const SUPPLIER_PHONE_PATTERN = /^(?=(?:\D*\d){7,15}\D*$)\+?[0-9][0-9 -]*[0-9]$/;
const SUPPLIER_PHONE_MESSAGE =
  'phone must be a valid phone number (7-15 digits, optional +, spaces or dashes)';

export class CreateSupplierDto {
  @ApiProperty({ example: 'PharmaCorp', description: 'Supplier name (unique per clinic)' })
  @Transform(trimSupplierText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: 'John Doe', description: 'Contact person' })
  @IsOptional()
  @IsString()
  contactPerson?: string;

  @ApiPropertyOptional({ example: 'contact@pharmacorp.com', description: 'Email' })
  @IsOptional()
  @Transform(trimSupplierText)
  @IsString()
  @ValidateIf(hasSupplierEmail)
  @IsEmail({}, { message: 'email must be a valid email address' })
  email?: string;

  @ApiPropertyOptional({ example: '+919876543210', description: 'Phone' })
  @IsOptional()
  @Transform(trimSupplierText)
  @IsString()
  @ValidateIf(hasSupplierPhone)
  @Matches(SUPPLIER_PHONE_PATTERN, { message: SUPPLIER_PHONE_MESSAGE })
  phone?: string;

  @ApiPropertyOptional({ example: '123 Supply Lane', description: 'Address' })
  @IsOptional()
  @IsString()
  address?: string;
}

export class UpdateSupplierDto {
  @ApiPropertyOptional({ example: 'PharmaCorp Updated' })
  @IsOptional()
  @Transform(trimSupplierText)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ example: 'Jane Doe' })
  @IsOptional()
  @IsString()
  contactPerson?: string;

  @ApiPropertyOptional({ example: 'new@pharmacorp.com' })
  @IsOptional()
  @Transform(trimSupplierText)
  @IsString()
  @ValidateIf(hasSupplierEmail)
  @IsEmail({}, { message: 'email must be a valid email address' })
  email?: string;

  @ApiPropertyOptional({ example: '+919876543210' })
  @IsOptional()
  @Transform(trimSupplierText)
  @IsString()
  @ValidateIf(hasSupplierPhone)
  @Matches(SUPPLIER_PHONE_PATTERN, { message: SUPPLIER_PHONE_MESSAGE })
  phone?: string;

  @ApiPropertyOptional({ example: '456 Delivery St' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateInventoryDto {
  @ApiPropertyOptional({
    example: 50,
    description: 'Quantity to add (positive) or remove (negative)',
  })
  @IsOptional()
  @IsInt()
  quantityChange?: number;

  @ApiPropertyOptional({ example: 12.0, description: 'New price' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  price?: number;

  @ApiPropertyOptional({ example: 'Paracetamol 500' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ enum: MEDICINE_TYPE_INPUT_VALUES })
  @IsOptional()
  @Transform(({ value }) => normaliseMedicineTypeToken(value))
  @IsIn(MEDICINE_TYPE_INPUT_VALUES, {
    message: `type must be one of: ${MEDICINE_TYPE_INPUT_VALUES.join(', ')}`,
  })
  type?: string;

  @ApiPropertyOptional({ enum: MedicineClassification })
  @IsOptional()
  @IsEnum(MedicineClassification)
  classification?: MedicineClassification;

  @ApiPropertyOptional({ enum: MedicineType, description: 'Dosage form' })
  @IsOptional()
  @IsEnum(MedicineType)
  category?: MedicineType;

  @ApiPropertyOptional({ example: 'Pfizer' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  manufacturer?: string;

  @ApiPropertyOptional({ example: 'strip' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  unit?: string;

  @ApiPropertyOptional({ example: 'B123456' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  batchNumber?: string;

  @ApiPropertyOptional({ example: '2027-12-31' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @ApiPropertyOptional({ example: 10, description: 'Reorder level' })
  @IsOptional()
  @IsInt()
  @Min(0)
  minStockThreshold?: number;

  @ApiPropertyOptional({ example: 'supplier-uuid' })
  @IsOptional()
  @IsString()
  supplierId?: string;

  @ApiPropertyOptional({ example: 'Pain relief' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ example: 'Take after food' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  instructions?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Re-activate a soft-deleted medicine' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class PrescriptionItemDto {
  @ApiProperty({ example: 'med-uuid-123', description: 'Medicine ID' })
  @IsString()
  medicineId!: string;

  @ApiProperty({ example: 2, description: 'Quantity prescribed' })
  @IsInt()
  @IsPositive()
  quantity!: number;

  @ApiPropertyOptional({ example: 'Twice a day', description: 'Dosage instructions' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  dosage?: string;

  @ApiPropertyOptional({ example: 'Twice daily', description: 'How often to take the medicine' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  frequency?: string;

  @ApiPropertyOptional({ example: '5 days', description: 'How long to take the medicine' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  duration?: string;

  @ApiPropertyOptional({
    example: 'After food with warm water',
    description: 'Free-text usage instructions shown to the patient and on the PDF',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  instructions?: string;
}

/**
 * Pharmacy-specific prescription creation DTO.
 *
 * Renamed from `CreatePrescriptionDto` to avoid class-name collision with the
 * EHR version in `ehr.dto.ts`. The two DTOs model different domain entities —
 * this one is pharmacy-inventory oriented and requires
 * `patientId` + `doctorId` + `items[]`, while the EHR version is a clinical
 * note oriented DTO with `userId` + optional clinical fields.
 */
export class CreatePharmacyPrescriptionDto {
  @ApiProperty({ example: 'patient-uuid', description: 'Patient ID' })
  @IsString()
  patientId!: string;

  @ApiProperty({ example: 'doctor-uuid', description: 'Doctor ID' })
  @IsString()
  doctorId!: string;

  @ApiProperty({ type: () => [PrescriptionItemDto], description: 'List of medicines' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  items!: PrescriptionItemDto[];

  @ApiPropertyOptional({ example: 'Take rest', description: 'Doctor notes' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    example: 'Common cold',
    description: 'Primary diagnosis or clinical impression',
  })
  @IsOptional()
  @IsString()
  diagnosis?: string;

  @ApiPropertyOptional({
    example: 'visit-uuid',
    description:
      'PatientVisit.id this prescription was written in, so the pharmacy invoice groups under the OPD visit in Bill History.',
  })
  @IsOptional()
  @IsString()
  visitId?: string;

  @ApiPropertyOptional({
    example: 'appointment-uuid',
    description:
      'Appointment this prescription was written for (same clinic, patient and doctor); drives the visit type at the pharmacy desk.',
  })
  @IsOptional()
  @IsString()
  appointmentId?: string;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description: 'Last day the prescription may be dispensed (ISO date); omit for no expiry',
  })
  @IsOptional()
  @IsDateString()
  validUntil?: string;
}

/** Doctor edit of a not-yet-dispensed prescription. At least one field is required. */
export class UpdatePharmacyPrescriptionDto {
  @ApiPropertyOptional({
    type: () => [PrescriptionItemDto],
    description: 'Replaces the whole item list (medicine, quantity, dosage, frequency, duration)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  items?: PrescriptionItemDto[];

  @ApiPropertyOptional({ example: 'Take rest' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ example: 'Common cold' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  diagnosis?: string;

  @ApiPropertyOptional({
    example: '2026-11-30',
    description: 'Last day the prescription may be dispensed (ISO date)',
  })
  @IsOptional()
  @IsDateString()
  validUntil?: string;
}

export class UpdatePrescriptionStatusDto {
  @ApiProperty({
    enum: [PrescriptionStatus.FILLED, PrescriptionStatus.CANCELLED],
    example: PrescriptionStatus.FILLED,
    description: 'Also accepts the desk words dispensed/completed/ready (FILLED) and canceled',
  })
  @Transform(({ value }) => normalisePrescriptionStatusInput(value))
  @IsIn([PrescriptionStatus.FILLED, PrescriptionStatus.CANCELLED], {
    message: 'status must be FILLED (dispensed/completed) or CANCELLED',
  })
  status!: PrescriptionStatus;

  @ApiPropertyOptional({ example: 'Prescription cancelled at patient request' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class RecordCashPaymentDto {
  @ApiPropertyOptional({
    example: 250,
    description: 'Cash collected. Defaults to the full pending amount when omitted.',
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;
}

export class DispensePrescriptionItemDto {
  @ApiProperty({ example: 'med-uuid-123', description: 'Medicine ID' })
  @IsString()
  medicineId!: string;

  @ApiPropertyOptional({
    example: 'prescription-item-uuid-123',
    description:
      'Specific prescription item ID to dispense against when duplicate medicine lines exist',
  })
  @IsOptional()
  @IsString()
  prescriptionItemId?: string;

  @ApiPropertyOptional({
    example: 'medicine-uuid-substitute-123',
    description:
      'Optional substitute medicine ID to use when the prescribed medicine is unavailable',
  })
  @IsOptional()
  @IsString()
  substituteMedicineId?: string;

  @ApiPropertyOptional({
    example: 'Exact medicine was not available in stock',
    description: 'Reason for using a substitute medicine',
  })
  @IsOptional()
  @IsString()
  substitutionReason?: string;

  @ApiProperty({ example: 1, description: 'Quantity to dispense in this request' })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ example: 'BATCH-2026-04', description: 'Inventory batch number used' })
  @IsOptional()
  @IsString()
  batchNumber?: string;

  @ApiPropertyOptional({ example: '2027-12-31', description: 'Batch expiry date' })
  @IsOptional()
  @IsDateString()
  expiryDate?: string;
}

export class DispensePrescriptionDto {
  @ApiPropertyOptional({
    type: () => [DispensePrescriptionItemDto],
    description:
      'Medicines to dispense in this request. Omit the array to dispense all remaining quantities.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DispensePrescriptionItemDto)
  items?: DispensePrescriptionItemDto[];

  @ApiPropertyOptional({ example: 'Partial dispense completed at pharmacy desk' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ example: '2026-04-30T09:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  dispensedAt?: string;

  @ApiPropertyOptional({
    description:
      'Accepted for compatibility with the mobile desk and IGNORED: the dispensing user is always taken from the JWT.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  dispensedBy?: string;
}

export class ReversePrescriptionDispenseItemDto {
  @ApiPropertyOptional({
    example: 'prescription-item-uuid-123',
    description: 'Specific prescription item ID to reverse',
  })
  @IsOptional()
  @IsString()
  prescriptionItemId?: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'Quantity to reverse from the most recent dispense events',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}

export class ReversePrescriptionDispenseDto {
  @ApiPropertyOptional({
    type: () => [ReversePrescriptionDispenseItemDto],
    description:
      'Dispense items to reverse. Omit to reverse the latest dispense event across items.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReversePrescriptionDispenseItemDto)
  items?: ReversePrescriptionDispenseItemDto[];

  @ApiProperty({ example: 'Incorrect batch selection during dispensing' })
  @IsString()
  reason!: string;
}

export class PharmacyBatchAuditQueryDto {
  @ApiPropertyOptional({ example: 'medicine-uuid-123' })
  @IsOptional()
  @IsString()
  medicineId?: string;

  @ApiPropertyOptional({ example: 'BATCH-2026-04' })
  @IsOptional()
  @IsString()
  batchNumber?: string;

  @ApiPropertyOptional({ example: 'patient-uuid-123' })
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiPropertyOptional({ example: '2026-05-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-05-31T23:59:59.999Z' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class PharmacyStatsQueryDto {
  @ApiPropertyOptional({
    enum: ['day', 'week', 'month', 'year'],
    default: 'month',
    description: 'Window of totalRevenue and topSellingMedicine',
  })
  @IsOptional()
  @IsIn(['day', 'week', 'month', 'year'])
  period?: 'day' | 'week' | 'month' | 'year';
}

export class PharmacySalesQueryDto {
  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'First day (IST), default 1st of this month',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    description: 'Last day (IST, inclusive), default today',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: ['day', 'medicine'], default: 'day' })
  @IsOptional()
  @IsIn(['day', 'medicine'])
  groupBy?: 'day' | 'medicine';
}

/** GET /pharmacy/inventory/summary: whole-inventory counts, independent of any list filter. */
export class InventorySummaryDto {
  @ApiProperty({ example: 40, description: 'Active medicines' })
  total!: number;

  @ApiProperty({ example: 36, description: 'Active medicines with stock above zero' })
  inStock!: number;

  @ApiProperty({ example: 2, description: '0 < stock <= reorder level (out of stock excluded)' })
  lowStock!: number;

  @ApiProperty({ example: 4, description: 'stock <= 0' })
  outOfStock!: number;

  @ApiProperty({ example: 3, description: 'Expiring within the default window' })
  expiringSoon!: number;

  @ApiProperty({ example: 48250.5, description: 'Stock on hand x listed price (rupees)' })
  totalValue!: number;
}

export class PharmacyStatsDto {
  @ApiProperty({ example: 150, description: 'Total medicines in stock' })
  totalMedicines!: number;

  @ApiProperty({
    example: 5,
    description:
      'Active medicines low in stock: 0 < stock <= reorder level (out of stock excluded)',
  })
  lowStock!: number;

  @ApiProperty({ example: 2, description: 'Active medicines out of stock (stock <= 0)' })
  outOfStock!: number;

  @ApiProperty({
    example: 48250.5,
    description: 'Stock on hand x listed price, all active medicines (rupees)',
  })
  inventoryValue!: number;

  @ApiProperty({ example: 12, description: 'Prescriptions pending today' })
  pendingPrescriptions!: number;

  @ApiProperty({ example: 15400.5, description: 'Paid pharmacy invoices in the period (rupees)' })
  totalRevenue!: number;

  @ApiProperty({
    example: 'Paracetamol 500mg',
    nullable: true,
    description: 'Medicine with the most units dispensed in the period',
  })
  topSellingMedicine!: string | null;

  @ApiProperty({ example: 87, description: 'Prescriptions dispensed in the current month' })
  monthlyDispensed!: number;
}
