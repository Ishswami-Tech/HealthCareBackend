/**
 * IPD Request DTOs
 * @module IPD Request DTOs
 * @description Request DTOs for ward and bed configuration operations
 */

import {
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsObject,
  IsUUID,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WardType, BedStatus } from './ipd.enums';

// ============ Ward DTOs ============

/**
 * Create ward DTO
 * @class CreateWardDto
 */
export class CreateWardDto {
  @ApiProperty({ description: 'Ward name', example: 'General Ward A' })
  @IsString()
  name!: string;

  @ApiProperty({ description: 'Ward type', enum: WardType })
  @IsString()
  wardType!: string;

  @ApiPropertyOptional({ description: 'Clinic ID for the ward' })
  @IsString()
  @IsOptional()
  clinicId?: string;

  @ApiPropertyOptional({ description: 'Location or floor' })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiPropertyOptional({ description: 'Total bed capacity', example: 20 })
  @IsNumber()
  @IsOptional()
  @Min(1)
  totalBeds?: number;

  @ApiPropertyOptional({ description: 'Ward notes' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ description: 'Whether ward is active', default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

/**
 * Update ward DTO
 * @class UpdateWardDto
 */
export class UpdateWardDto {
  @ApiPropertyOptional({ description: 'Ward name' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ description: 'Location or floor' })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiPropertyOptional({ description: 'Ward type' })
  @IsString()
  @IsOptional()
  wardType?: string;

  @ApiPropertyOptional({ description: 'Total bed capacity' })
  @IsNumber()
  @IsOptional()
  @Min(1)
  totalBeds?: number;

  @ApiPropertyOptional({ description: 'Whether ward is active', default: true })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Ward notes' })
  @IsString()
  @IsOptional()
  notes?: string;
}

// ============ Bed DTOs ============

/**
 * Create bed DTO
 * @class CreateBedDto
 */
export class CreateBedDto {
  @ApiProperty({ description: 'Ward ID' })
  @IsString()
  wardId!: string;

  @ApiProperty({ description: 'Bed number', example: 'A-101' })
  @IsString()
  bedNumber!: string;

  @ApiPropertyOptional({ description: 'Room number' })
  @IsString()
  @IsOptional()
  roomNumber?: string;

  @ApiPropertyOptional({ description: 'Bed type', default: 'STANDARD' })
  @IsString()
  @IsOptional()
  bedType?: string;

  @ApiPropertyOptional({ description: 'Daily rate' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  dailyRate?: number;

  @ApiPropertyOptional({ description: 'Has oxygen supply' })
  @IsBoolean()
  @IsOptional()
  hasOxygen?: boolean;

  @ApiPropertyOptional({ description: 'Has ventilator' })
  @IsBoolean()
  @IsOptional()
  hasVentilator?: boolean;

  @ApiPropertyOptional({ description: 'Additional features', type: 'object' })
  @IsObject()
  @IsOptional()
  features?: Record<string, boolean>;

  @ApiPropertyOptional({
    description: 'Initial status',
    enum: BedStatus,
    default: BedStatus.AVAILABLE,
  })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ description: 'Bed notes' })
  @IsString()
  @IsOptional()
  notes?: string;
}

/**
 * Update bed DTO
 * @class UpdateBedDto
 */
export class UpdateBedDto {
  @ApiPropertyOptional({ description: 'Bed number' })
  @IsString()
  @IsOptional()
  bedNumber?: string;

  @ApiPropertyOptional({ description: 'Room number' })
  @IsString()
  @IsOptional()
  roomNumber?: string;

  @ApiPropertyOptional({ description: 'Bed type' })
  @IsString()
  @IsOptional()
  bedType?: string;

  @ApiPropertyOptional({ description: 'Daily rate' })
  @IsNumber()
  @IsOptional()
  @Min(0)
  dailyRate?: number;

  @ApiPropertyOptional({ description: 'Has oxygen supply' })
  @IsBoolean()
  @IsOptional()
  hasOxygen?: boolean;

  @ApiPropertyOptional({ description: 'Has ventilator' })
  @IsBoolean()
  @IsOptional()
  hasVentilator?: boolean;

  @ApiPropertyOptional({ description: 'Bed status', enum: BedStatus })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({ description: 'Additional features', type: 'object' })
  @IsObject()
  @IsOptional()
  features?: Record<string, boolean>;

  @ApiPropertyOptional({ description: 'Bed notes' })
  @IsString()
  @IsOptional()
  notes?: string;
}
