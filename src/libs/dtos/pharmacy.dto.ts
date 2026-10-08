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
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/** Dosage forms the web UI sends as `type`. Stored in `Medicine.category`. */
export enum MedicineType {
  TABLET = 'TABLET',
  SYRUP = 'SYRUP',
  CAPSULE = 'CAPSULE',
  INJECTION = 'INJECTION',
  CREAM = 'CREAM',
  DROPS = 'DROPS',
  OTHER = 'OTHER',
}

/** The DB enum `MedicineType` (Medicine.type). */
export enum MedicineClassification {
  CLASSICAL = 'CLASSICAL',
  PROPRIETARY = 'PROPRIETARY',
  HERBAL = 'HERBAL',
}

/** Every value accepted for the `type` field of the inventory create/update routes. */
export const MEDICINE_TYPE_INPUT_VALUES: string[] = [
  ...Object.values(MedicineClassification),
  ...Object.values(MedicineType),
];

/**
 * `type` mapping (documented contract):
 * - CLASSICAL | PROPRIETARY | HERBAL  -> stored as `Medicine.type` as-is.
 * - TABLET | SYRUP | CAPSULE | INJECTION | CREAM | DROPS | OTHER (dosage forms the web
 *   sends) -> stored in `Medicine.category`; `Medicine.type` becomes PROPRIETARY (a
 *   packaged dosage form) unless an explicit classification is also given.
 * Anything else is rejected by the DTO validation with a 400.
 */
export function resolveMedicineTypeInput(input: {
  type?: string | undefined;
  classification?: string | undefined;
  category?: string | undefined;
}): { type?: MedicineClassification; category?: string } {
  const classifications: string[] = Object.values(MedicineClassification);
  const forms: string[] = Object.values(MedicineType);
  const rawType = input.type?.trim().toUpperCase();
  const rawClassification = input.classification?.trim().toUpperCase();
  const rawCategory = input.category?.trim().toUpperCase();

  let type: MedicineClassification | undefined;
  let category: string | undefined;

  if (rawClassification && classifications.includes(rawClassification)) {
    type = rawClassification as MedicineClassification;
  }
  if (rawType && classifications.includes(rawType)) {
    type = rawType as MedicineClassification;
  } else if (rawType && forms.includes(rawType)) {
    category = rawType;
    type = type ?? MedicineClassification.PROPRIETARY;
  }
  if (rawCategory && forms.includes(rawCategory)) {
    category = rawCategory;
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

/** `GET /pharmacy/prescriptions` filters and pagination (D9). */
export class ListPrescriptionsQueryDto {
  @ApiPropertyOptional({ description: 'Doctor.id or the doctor User.id (staff only)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  doctorId?: string;

  @ApiPropertyOptional({ description: 'Patient.id or the patient User.id' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  patientId?: string;

  @ApiPropertyOptional({
    enum: PrescriptionStatus,
    description: 'Also accepts pending/processing/ready/dispensed/completed/cancelled',
  })
  @IsOptional()
  @Transform(({ value }) => normalisePrescriptionStatusInput(value))
  @IsIn(Object.values(PrescriptionStatus), {
    message: `status must be one of ${Object.values(PrescriptionStatus).join(', ')} (aliases: pending, processing, ready, dispensed, completed, cancelled)`,
  })
  status?: PrescriptionStatus;

  @ApiPropertyOptional({ description: 'Case-insensitive "contains" match on the patient name' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  patientName?: string;

  @ApiPropertyOptional({ description: 'Prescribed on/after this date (ISO)' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Prescribed on/before this date (ISO)' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, description: 'Page size (default 50)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, description: 'Rows to skip (default 0)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
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
      'SYRUP, CAPSULE, INJECTION, CREAM, DROPS, OTHER); dosage forms are stored as category.',
  })
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

export class CreateSupplierDto {
  @ApiProperty({ example: 'PharmaCorp', description: 'Supplier name' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: 'John Doe', description: 'Contact person' })
  @IsOptional()
  @IsString()
  contactPerson?: string;

  @ApiPropertyOptional({ example: 'contact@pharmacorp.com', description: 'Email' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ example: '+1234567890', description: 'Phone' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: '123 Supply Lane', description: 'Address' })
  @IsOptional()
  @IsString()
  address?: string;
}

export class UpdateSupplierDto {
  @ApiPropertyOptional({ example: 'PharmaCorp Updated' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'Jane Doe' })
  @IsOptional()
  @IsString()
  contactPerson?: string;

  @ApiPropertyOptional({ example: 'new@pharmacorp.com' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ example: '+0987654321' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: '456 Delivery St' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
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

export class PharmacyStatsDto {
  @ApiProperty({ example: 150, description: 'Total medicines in stock' })
  totalMedicines!: number;

  @ApiProperty({ example: 5, description: 'Medicines low in stock' })
  lowStock!: number;

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
