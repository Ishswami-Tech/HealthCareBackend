/**
 * Patient Document (Investigations & Documents uploads) DTOs
 * @module PatientDocumentDTOs
 *
 * Multipart upload fields arrive through `@fastify/multipart` with
 * `attachFieldsToBody: true`, so `UploadPatientDocumentFieldsDto` is validated
 * manually in the service (plainToInstance + validate) rather than via `@Body()`.
 */

import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const PATIENT_DOCUMENT_CATEGORIES = ['INVESTIGATION', 'DOCUMENT'] as const;
export type PatientDocumentCategoryValue = (typeof PATIENT_DOCUMENT_CATEGORIES)[number];

export const PATIENT_DOCUMENT_MEDIA_KINDS = ['IMAGE', 'PDF', 'AUDIO', 'VIDEO', 'OTHER'] as const;
export type PatientDocumentMediaKindValue = (typeof PATIENT_DOCUMENT_MEDIA_KINDS)[number];

export const INVESTIGATION_SUB_TYPES = ['XRAY', 'LAB', 'MRI', 'CT', 'USG', 'ECG', 'OTHER'] as const;
export const DOCUMENT_SUB_TYPES = [
  'ID_PROOF',
  'OLD_PRESCRIPTION',
  'CONSENT',
  'DISCHARGE',
  'REFERRAL',
  'OTHER',
] as const;

export const PATIENT_DOCUMENT_SUB_TYPES: Readonly<
  Record<PatientDocumentCategoryValue, readonly string[]>
> = {
  INVESTIGATION: INVESTIGATION_SUB_TYPES,
  DOCUMENT: DOCUMENT_SUB_TYPES,
};

export type PatientDocumentDisposition = 'inline' | 'attachment';

export class UploadPatientDocumentFieldsDto {
  @ApiPropertyOptional({
    example: 'patient-uuid',
    description: 'Patient.id (must belong to clinic)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  patientId!: string;

  @ApiPropertyOptional({ example: 'visit-uuid', description: 'Link the file to this OPD visit' })
  @IsOptional()
  @IsUUID()
  visitId?: string;

  @ApiPropertyOptional({
    example: 'XRAY',
    description:
      'INVESTIGATION: XRAY|LAB|MRI|CT|USG|ECG|OTHER — DOCUMENT: ID_PROOF|OLD_PRESCRIPTION|CONSENT|DISCHARGE|REFERRAL|OTHER',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  subType?: string;

  @ApiPropertyOptional({ example: 'Chest X-ray PA view', description: 'Defaults to the file name' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ example: 'Taken at City Diagnostics' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ example: '2026-09-20', description: 'Date the report was issued' })
  @IsOptional()
  @IsDateString()
  reportDate?: string;
}

/** Send `null` to clear an optional value; omit a key to leave it unchanged. */
export class UpdatePatientDocumentDto {
  @ApiPropertyOptional({ example: 'Chest X-ray PA view' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ example: 'Taken at City Diagnostics', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @ApiPropertyOptional({ example: 'XRAY', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  subType?: string | null;

  @ApiPropertyOptional({ example: '2026-09-20', nullable: true })
  @IsOptional()
  @IsDateString()
  reportDate?: string | null;

  @ApiPropertyOptional({ example: 'visit-uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  visitId?: string | null;
}

export class ListPatientDocumentsQueryDto {
  @ApiPropertyOptional({ enum: PATIENT_DOCUMENT_CATEGORIES })
  @IsOptional()
  @IsIn(PATIENT_DOCUMENT_CATEGORIES)
  category?: PatientDocumentCategoryValue;

  @ApiPropertyOptional({ example: 'visit-uuid' })
  @IsOptional()
  @IsUUID()
  visitId?: string;

  @ApiPropertyOptional({ example: 'LAB' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  subType?: string;

  @ApiPropertyOptional({ example: 50, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ example: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/** Public shape — never exposes `storageKey`/`storageProvider`. */
export interface PatientDocumentResponse {
  id: string;
  clinicId: string;
  patientId: string;
  visitId: string | null;
  opdNumber: string | null;
  category: PatientDocumentCategoryValue;
  subType: string | null;
  title: string;
  notes: string | null;
  reportDate: string | null;
  fileName: string;
  mimeType: string;
  mediaKind: PatientDocumentMediaKindValue;
  fileSize: number;
  checksum: string | null;
  uploadedBy: string;
  uploadedByRole: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PatientDocumentListResponse {
  documents: PatientDocumentResponse[];
  total: number;
}

export interface PatientDocumentUrlResponse {
  /** Absolute presigned S3 URL, or the relative authenticated `/content` path for local storage. */
  url: string;
  /** ISO timestamp for presigned URLs; null when the URL does not expire (local storage). */
  expiresAt: string | null;
  mimeType: string;
  disposition: PatientDocumentDisposition;
}
