import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  PATIENT_DIRECTORY_GENDERS,
  PATIENT_DIRECTORY_PAGE_SIZES,
  PATIENT_DIRECTORY_SORT_FIELDS,
} from '@core/types/patient-directory.types';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_AGE = 130;
const PLACE_MAX_LENGTH = 80;

/** Query-string booleans arrive as text: only the exact words count. */
const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' || value === true ? true : value === 'false' || value === false ? false : value;

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class PatientDirectoryQueryDto {
  @ApiPropertyOptional({
    description: 'Name, UHID, register number, OPD number, phone (any part) or e-mail',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(trimmed)
  search?: string;

  @ApiPropertyOptional({ enum: PATIENT_DIRECTORY_GENDERS })
  @IsOptional()
  @IsIn(PATIENT_DIRECTORY_GENDERS)
  gender?: (typeof PATIENT_DIRECTORY_GENDERS)[number];

  @ApiPropertyOptional({ minimum: 0, maximum: MAX_AGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_AGE)
  ageMin?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: MAX_AGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_AGE)
  ageMax?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(PLACE_MAX_LENGTH)
  @Transform(trimmed)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(PLACE_MAX_LENGTH)
  @Transform(trimmed)
  state?: string;

  @ApiPropertyOptional({ description: 'How the patient found the clinic, e.g. Friend/Relative' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Transform(trimmed)
  referenceSource?: string;

  @ApiPropertyOptional({ description: 'First day of the case date range, YYYY-MM-DD' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'caseDateFrom must be YYYY-MM-DD' })
  caseDateFrom?: string;

  @ApiPropertyOptional({ description: 'Last day of the case date range, YYYY-MM-DD' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'caseDateTo must be YYYY-MM-DD' })
  caseDateTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasMobile?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasDiagnosis?: boolean;

  @ApiPropertyOptional({ minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  minVisits?: number;

  @ApiPropertyOptional({ enum: PATIENT_DIRECTORY_SORT_FIELDS, default: 'registered' })
  @IsOptional()
  @IsIn(PATIENT_DIRECTORY_SORT_FIELDS)
  sort?: (typeof PATIENT_DIRECTORY_SORT_FIELDS)[number];

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page?: number;

  @ApiPropertyOptional({ enum: PATIENT_DIRECTORY_PAGE_SIZES, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn(PATIENT_DIRECTORY_PAGE_SIZES)
  pageSize?: (typeof PATIENT_DIRECTORY_PAGE_SIZES)[number];
}
