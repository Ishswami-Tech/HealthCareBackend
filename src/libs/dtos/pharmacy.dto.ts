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
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum MedicineType {
  TABLET = 'TABLET',
  SYRUP = 'SYRUP',
  CAPSULE = 'CAPSULE',
  INJECTION = 'INJECTION',
  CREAM = 'CREAM',
  DROPS = 'DROPS',
  OTHER = 'OTHER',
}

export enum PrescriptionStatus {
  PENDING = 'PENDING',
  PARTIAL = 'PARTIAL',
  FILLED = 'FILLED',
  CANCELLED = 'CANCELLED',
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

  @ApiProperty({ example: 'B123456', description: 'Batch number' })
  @IsString()
  description?: string;

  @ApiProperty({ enum: MedicineType, enumName: 'MedicineType', example: MedicineType.TABLET })
  @IsEnum(MedicineType)
  type!: MedicineType;

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
  dosage?: string;
}

export class CreatePrescriptionDto {
  @ApiProperty({ example: 'patient-uuid', description: 'Patient ID' })
  @IsString()
  patientId!: string;

  @ApiProperty({ example: 'doctor-uuid', description: 'Doctor ID' })
  @IsString()
  doctorId!: string;

  @ApiProperty({ type: [PrescriptionItemDto], description: 'List of medicines' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  items!: PrescriptionItemDto[];

  @ApiPropertyOptional({ example: 'Take rest', description: 'Doctor notes' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdatePrescriptionStatusDto {
  @ApiProperty({
    enum: [PrescriptionStatus.FILLED, PrescriptionStatus.CANCELLED],
    example: PrescriptionStatus.FILLED,
  })
  @IsIn([PrescriptionStatus.FILLED, PrescriptionStatus.CANCELLED])
  status!: PrescriptionStatus;

  @ApiPropertyOptional({ example: 'Prescription cancelled at patient request' })
  @IsOptional()
  @IsString()
  notes?: string;
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
    type: [DispensePrescriptionItemDto],
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
    type: [ReversePrescriptionDispenseItemDto],
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

export class PharmacyStatsDto {
  @ApiProperty({ example: 150, description: 'Total medicines in stock' })
  totalMedicines!: number;

  @ApiProperty({ example: 5, description: 'Medicines low in stock' })
  lowStock!: number;

  @ApiProperty({ example: 12, description: 'Prescriptions pending today' })
  pendingPrescriptions!: number;
}
