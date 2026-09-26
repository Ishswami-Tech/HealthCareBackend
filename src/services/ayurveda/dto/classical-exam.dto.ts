/**
 * Classical Ayurvedic examination finding DTOs (per-visit, per-category).
 * @module ClassicalExamDTOs
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * SAMPRAPTI_GHATAKA is the pathogenesis-*components* checklist recorded at
 * intake. It is intentionally not called SAMPRAPTI so it cannot be confused
 * with the existing `sampraptiStage` model, which tracks Shatkriyakala
 * disease-progression *stages* over time.
 */
export enum ClassicalExamType {
  ASHTAVIDHA_PARIKSHA = 'ASHTAVIDHA_PARIKSHA',
  DASHAVIDHA_PARIKSHA = 'DASHAVIDHA_PARIKSHA',
  SROTAS_PARIKSHA = 'SROTAS_PARIKSHA',
  SAMPRAPTI_GHATAKA = 'SAMPRAPTI_GHATAKA',
  PAIN_ASSESSMENT = 'PAIN_ASSESSMENT',
  PERSONAL_HISTORY = 'PERSONAL_HISTORY',
}

export class UpsertClassicalExamFindingDto {
  @ApiProperty({ enum: ClassicalExamType })
  @IsEnum(ClassicalExamType)
  examType!: ClassicalExamType;

  @ApiProperty({ example: 'jihva', description: 'Category key within the exam type' })
  @IsString()
  @MaxLength(64)
  categoryKey!: string;

  @ApiProperty({
    example: ['साम', 'पिच्छिल'],
    description: 'Selected option labels (single-select sends a 1-element array)',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  selectedOptions!: string[];

  @ApiPropertyOptional({ example: 'Coating heavier on posterior third' })
  @IsOptional()
  @IsString()
  remark?: string;
}

export class UpsertClassicalExamFindingsDto {
  @ApiProperty({ type: () => [UpsertClassicalExamFindingDto] })
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => UpsertClassicalExamFindingDto)
  findings!: UpsertClassicalExamFindingDto[];
}

export interface ClassicalExamFindingResponse {
  id: string;
  visitId: string;
  examType: ClassicalExamType;
  categoryKey: string;
  selectedOptions: string[];
  remark: string | null;
  recordedBy: string | null;
  createdAt: string;
  updatedAt: string;
}
