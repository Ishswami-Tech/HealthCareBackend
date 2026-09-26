/**
 * Visit Diet Chart DTOs (Take / Avoid / Occasional per OPD visit) and the
 * clinic-extensible food master used by the picker.
 * @module VisitDietChartDTOs
 *
 * Item labels are SNAPSHOTS: the four name columns are copied from the food
 * master (or typed as free text) when the chart is saved, so later edits to
 * the master never rewrite a chart that was already handed to a patient.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export enum DietAdviceCategory {
  TAKE = 'TAKE',
  AVOID = 'AVOID',
  OCCASIONAL = 'OCCASIONAL',
}

export const DIET_CHART_LANGUAGES = ['en', 'gu', 'hi', 'mr'] as const;
export type DietChartLanguage = (typeof DIET_CHART_LANGUAGES)[number];

const MAX_ITEMS_PER_CHART = 200;
const MAX_LABEL_LENGTH = 200;
const MAX_NOTE_LENGTH = 300;
const MAX_NOTES_LENGTH = 2000;
const MAX_SEARCH_LENGTH = 100;
const MAX_KEY_LENGTH = 100;
const MAX_GROUP_LENGTH = 50;

const trimString = ({ value }: { value: unknown }): string =>
  typeof value === 'string' ? value.trim() : (value as string);

export class DietChartItemInputDto {
  @ApiProperty({ enum: DietAdviceCategory, example: DietAdviceCategory.TAKE })
  @IsEnum(DietAdviceCategory)
  category!: DietAdviceCategory;

  @ApiPropertyOptional({
    example: 'food-uuid',
    description: 'dietChartFood.id when picked from the master; omit for free text',
  })
  @IsOptional()
  @IsUUID()
  foodId?: string;

  @ApiProperty({ example: 'Moong dal' })
  @IsString()
  @MaxLength(MAX_LABEL_LENGTH)
  @Transform(trimString)
  nameEn!: string;

  @ApiPropertyOptional({ example: 'મગની દાળ' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LABEL_LENGTH)
  @Transform(trimString)
  nameGu?: string;

  @ApiPropertyOptional({ example: 'मूंग दाल' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LABEL_LENGTH)
  @Transform(trimString)
  nameHi?: string;

  @ApiPropertyOptional({ example: 'मुगाची डाळ' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LABEL_LENGTH)
  @Transform(trimString)
  nameMr?: string;

  @ApiPropertyOptional({ example: 'Only at lunch, well cooked' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NOTE_LENGTH)
  @Transform(trimString)
  note?: string;

  @ApiPropertyOptional({ example: 0, description: 'Display order within the category' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpsertVisitDietChartDto {
  @ApiPropertyOptional({ enum: DIET_CHART_LANGUAGES, example: 'gu' })
  @IsOptional()
  @IsIn(DIET_CHART_LANGUAGES)
  printLanguage?: DietChartLanguage;

  @ApiPropertyOptional({ example: 'Avoid cold water after meals; dinner before 8 pm.' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_NOTES_LENGTH)
  @Transform(trimString)
  notes?: string;

  @ApiProperty({ type: () => [DietChartItemInputDto], description: 'Full replacement list' })
  @IsArray()
  @ArrayMaxSize(MAX_ITEMS_PER_CHART)
  @ValidateNested({ each: true })
  @Type(() => DietChartItemInputDto)
  items!: DietChartItemInputDto[];
}

export class DietChartFoodSearchQueryDto {
  @ApiPropertyOptional({ example: 'dal', description: 'Matches any of the four name columns' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SEARCH_LENGTH)
  @Transform(trimString)
  q?: string;

  @ApiPropertyOptional({ example: 'pulses' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_GROUP_LENGTH)
  @Transform(trimString)
  group?: string;

  @ApiPropertyOptional({ example: 50, description: '1-100, default 50' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class CreateDietChartFoodDto {
  @ApiPropertyOptional({
    example: 'moong-dal',
    description: 'Stable lowercase slug; derived from nameEn when omitted',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_KEY_LENGTH)
  @Transform(trimString)
  key?: string;

  @ApiProperty({ example: 'Moong dal' })
  @IsString()
  @MaxLength(MAX_LABEL_LENGTH)
  @Transform(trimString)
  nameEn!: string;

  @ApiPropertyOptional({ example: 'મગની દાળ' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LABEL_LENGTH)
  @Transform(trimString)
  nameGu?: string;

  @ApiPropertyOptional({ example: 'मूंग दाल' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LABEL_LENGTH)
  @Transform(trimString)
  nameHi?: string;

  @ApiPropertyOptional({ example: 'मुगाची डाळ' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LABEL_LENGTH)
  @Transform(trimString)
  nameMr?: string;

  @ApiPropertyOptional({ example: 'pulses' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_GROUP_LENGTH)
  @Transform(trimString)
  group?: string;
}

export class UpdateDietChartFoodDto {
  @ApiPropertyOptional({ example: 'moong-dal' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_KEY_LENGTH)
  @Transform(trimString)
  key?: string;

  @ApiPropertyOptional({ example: 'Moong dal' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LABEL_LENGTH)
  @Transform(trimString)
  nameEn?: string;

  @ApiPropertyOptional({ example: 'મગની દાળ' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LABEL_LENGTH)
  @Transform(trimString)
  nameGu?: string;

  @ApiPropertyOptional({ example: 'मूंग दाल' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LABEL_LENGTH)
  @Transform(trimString)
  nameHi?: string;

  @ApiPropertyOptional({ example: 'मुगाची डाळ' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LABEL_LENGTH)
  @Transform(trimString)
  nameMr?: string;

  @ApiPropertyOptional({ example: 'pulses' })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_GROUP_LENGTH)
  @Transform(trimString)
  group?: string;

  @ApiPropertyOptional({ example: false, description: 'Hide from the picker without deleting' })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export interface VisitDietChartItemResponse {
  id: string;
  visitId: string;
  category: DietAdviceCategory;
  foodId: string | null;
  nameEn: string;
  nameGu: string | null;
  nameHi: string | null;
  nameMr: string | null;
  note: string | null;
  sortOrder: number;
  recordedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VisitDietChartResponse {
  visitId: string;
  printLanguage: DietChartLanguage;
  notes: string | null;
  items: VisitDietChartItemResponse[];
  /** null until the chart has been saved once */
  updatedAt: string | null;
}

export interface DietChartFoodResponse {
  id: string;
  /** null = system seed row (read-only), otherwise the owning clinic */
  clinicId: string | null;
  key: string;
  nameEn: string;
  nameGu: string | null;
  nameHi: string | null;
  nameMr: string | null;
  group: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
