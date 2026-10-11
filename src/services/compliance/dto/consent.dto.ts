import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { CONSENT_PURPOSES, CONSENT_STATUSES } from '@core/types/compliance.types';
import type {
  ConsentPurpose,
  ConsentStatus,
  PatientConsentRecord,
} from '@core/types/compliance.types';

export const CONSENT_LANGUAGES = ['en', 'hi', 'mr'] as const;
export type ConsentLanguage = (typeof CONSENT_LANGUAGES)[number];

export class RecordConsentDto {
  @ApiProperty({ description: 'Patient the consent is about' })
  @IsUUID()
  patientId!: string;

  @ApiProperty({ enum: CONSENT_PURPOSES })
  @IsIn(CONSENT_PURPOSES)
  purpose!: ConsentPurpose;

  @ApiProperty({ example: '2026-01', description: 'Version of the privacy notice shown' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Transform(({ value }: { value: string | number | boolean | null | undefined }) =>
    typeof value === 'string' ? value.trim() : value
  )
  noticeVersion!: string;

  @ApiPropertyOptional({ enum: CONSENT_LANGUAGES })
  @IsOptional()
  @IsIn(CONSENT_LANGUAGES)
  language?: ConsentLanguage;

  @ApiProperty({ enum: CONSENT_STATUSES })
  @IsIn(CONSENT_STATUSES)
  status!: ConsentStatus;

  @ApiPropertyOptional({ description: 'Free-form proof of consent (e.g. form reference)' })
  @IsOptional()
  @IsObject()
  evidence?: Record<string, string | number | boolean | null>;
}

export interface PatientConsentStateResponse {
  readonly patientId: string;
  /** Latest row per purpose. */
  readonly current: readonly PatientConsentRecord[];
  /** Every ledger row, newest first. */
  readonly history: readonly PatientConsentRecord[];
}
