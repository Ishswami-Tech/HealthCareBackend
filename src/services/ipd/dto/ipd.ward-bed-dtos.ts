/**
 * Ward and Bed Response DTOs
 * @module IPD Ward/Bed Response DTOs
 * @description Response DTOs for ward and bed data
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Ward response data
 * @interface WardResponseDto
 */
export class WardResponseDto {
  /** Unique identifier */
  @ApiProperty()
  id!: string;

  /** Clinic ID */
  @ApiProperty()
  clinicId!: string;

  /** Clinic location ID */
  @ApiProperty()
  clinicLocationId!: string;

  /** Ward name */
  @ApiProperty()
  name!: string;

  /** Ward type */
  @ApiProperty()
  wardType!: string;

  /** Location or floor */
  @ApiPropertyOptional()
  location?: string;

  /** Total bed capacity */
  @ApiPropertyOptional()
  totalBeds?: number;

  /** Whether ward is active */
  @ApiProperty()
  isActive!: boolean;

  /** Current occupied beds count */
  @ApiPropertyOptional()
  occupiedBeds?: number | undefined;

  /** Current available beds count */
  @ApiPropertyOptional()
  availableBeds?: number | undefined;

  /** Total bed count */
  @ApiPropertyOptional()
  totalBedCount?: number | undefined;

  /** Default daily rate */
  @ApiPropertyOptional()
  defaultDailyRate?: number | undefined;

  /** Ward notes */
  @ApiPropertyOptional()
  notes?: string | undefined;

  /** Creation timestamp */
  @ApiPropertyOptional()
  createdAt?: string | undefined;

  /** Update timestamp */
  @ApiPropertyOptional()
  updatedAt?: string | undefined;
}

/**
 * Bed response data
 * @interface BedResponseDto
 */
export class BedResponseDto {
  /** Unique identifier */
  @ApiProperty()
  id!: string;

  /** Clinic ID */
  @ApiProperty()
  clinicId!: string;

  /** Clinic location ID */
  @ApiProperty()
  clinicLocationId!: string;

  /** Ward ID */
  @ApiProperty()
  wardId!: string;

  /** Ward name (denormalized) */
  @ApiPropertyOptional()
  wardName?: string | undefined;

  /** Ward type (denormalized) */
  @ApiPropertyOptional()
  wardType?: string | undefined;

  /** Bed number */
  @ApiProperty()
  bedNumber!: string;

  /** Room number */
  @ApiPropertyOptional()
  roomNumber?: string | undefined;

  /** Bed type */
  @ApiPropertyOptional()
  bedType?: string | undefined;

  /** Bed status */
  @ApiProperty()
  status!: string;

  /** Daily rate */
  @ApiPropertyOptional()
  dailyRate?: number | undefined;

  /** Has oxygen supply */
  @ApiProperty()
  hasOxygen!: boolean;

  /** Has ventilator */
  @ApiProperty()
  hasVentilator!: boolean;

  /** Additional features */
  @ApiPropertyOptional({ type: 'object' })
  features?: Record<string, boolean> | undefined;

  /** Bed notes */
  @ApiPropertyOptional()
  notes?: string | undefined;

  /** Creation timestamp */
  @ApiPropertyOptional()
  createdAt?: string | undefined;

  /** Update timestamp */
  @ApiPropertyOptional()
  updatedAt?: string | undefined;
}
