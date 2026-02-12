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

  @ApiProperty({ enum: MedicineType, example: MedicineType.TABLET })
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

  @ApiPropertyOptional({ example: 'Take after food', description: 'Usage instructions' })
  @IsOptional()
  @IsString()
  instructions?: string;
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
  @ApiProperty({ enum: PrescriptionStatus, example: PrescriptionStatus.FILLED })
  @IsEnum(PrescriptionStatus)
  status!: PrescriptionStatus;
}

export class PharmacyStatsDto {
  @ApiProperty({ example: 150, description: 'Total medicines in stock' })
  totalMedicines!: number;

  @ApiProperty({ example: 5, description: 'Medicines low in stock' })
  lowStock!: number;

  @ApiProperty({ example: 12, description: 'Prescriptions pending today' })
  pendingPrescriptions!: number;
}
