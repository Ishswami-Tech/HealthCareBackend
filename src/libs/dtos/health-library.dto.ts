/**
 * Health Library DTOs — clinic-authored wellness articles & videos shown to
 * patients in the mobile app's Health Library (`HealthLibraryPost` / schema.prisma).
 *
 * Authoring (create/update/publish/archive/delete) is restricted to
 * DOCTOR / RECEPTIONIST / CLINIC_ADMIN / SUPER_ADMIN. Reading published posts
 * is open to any authenticated, clinic-scoped user (including PATIENT).
 */

import { applyDecorators } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import type { TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const HEALTH_LIBRARY_TABS = ['ARTICLES', 'GUIDES', 'PRACTICES', 'COURSES'] as const;
export type HealthLibraryTabValue = (typeof HEALTH_LIBRARY_TABS)[number];

export const HEALTH_LIBRARY_MEDIA_TYPES = ['ARTICLE', 'VIDEO'] as const;
export type HealthLibraryMediaTypeValue = (typeof HEALTH_LIBRARY_MEDIA_TYPES)[number];

export const HEALTH_LIBRARY_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type HealthLibraryStatusValue = (typeof HEALTH_LIBRARY_STATUSES)[number];

const TITLE_MAX_LENGTH = 200;
const CATEGORY_MAX_LENGTH = 60;
const READ_TIME_MAX_LENGTH = 40;
const SUMMARY_MAX_LENGTH = 500;
const WHEN_TO_SEE_DOCTOR_MAX_LENGTH = 1000;
const SECTION_HEADING_MAX_LENGTH = 150;
const SECTION_BODY_MAX_LENGTH = 4000;
const MAX_SECTIONS = 30;
const MAX_VIDEO_DURATION_SECONDS = 24 * 60 * 60;

/** Video links must be absolute https URLs (no host allow-list; no http/ftp/javascript). */
export const HEALTH_LIBRARY_URL_OPTIONS = {
  protocols: ['https'],
  require_protocol: true,
  require_tld: true,
  max_allowed_length: 500,
};

function trimString({ value }: TransformFnParams): string {
  return typeof value === 'string' ? value.trim() : (value as string);
}

/** Trims strings before validation so whitespace-only values fail `@IsNotEmpty`. */
const TrimString = (): PropertyDecorator => Transform(trimString);

/**
 * PATCH semantics for non-nullable fields: omitted (`undefined`) means "leave
 * unchanged" and skips validation, but an explicit `null` must still reach the
 * validators so it is rejected with a 400 instead of crashing the service.
 * (`@IsOptional()` — which `PartialType` adds to every field — also accepts null.)
 */
const RejectNullWhenPresent = (): PropertyDecorator =>
  ValidateIf((_object, value): boolean => value !== undefined);

const TitleRules = (): PropertyDecorator =>
  applyDecorators(TrimString(), IsString(), IsNotEmpty(), MaxLength(TITLE_MAX_LENGTH));
const CategoryRules = (): PropertyDecorator =>
  applyDecorators(TrimString(), IsString(), IsNotEmpty(), MaxLength(CATEGORY_MAX_LENGTH));
const SummaryRules = (): PropertyDecorator =>
  applyDecorators(TrimString(), IsString(), IsNotEmpty(), MaxLength(SUMMARY_MAX_LENGTH));
const ReadTimeRules = (): PropertyDecorator =>
  applyDecorators(TrimString(), IsString(), MaxLength(READ_TIME_MAX_LENGTH));
const WhenToSeeDoctorRules = (): PropertyDecorator =>
  applyDecorators(TrimString(), IsString(), MaxLength(WHEN_TO_SEE_DOCTOR_MAX_LENGTH));
const VideoUrlRules = (): PropertyDecorator =>
  applyDecorators(TrimString(), IsUrl(HEALTH_LIBRARY_URL_OPTIONS));
const VideoDurationRules = (): PropertyDecorator =>
  applyDecorators(
    Type(() => Number),
    IsInt(),
    Min(1),
    Max(MAX_VIDEO_DURATION_SECONDS)
  );

export class HealthLibrarySectionDto {
  @ApiProperty({ example: 'Move a little, most days' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(SECTION_HEADING_MAX_LENGTH)
  heading!: string;

  @ApiProperty({ example: 'Aim for 30 minutes of brisk walking most days of the week.' })
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(SECTION_BODY_MAX_LENGTH)
  body!: string;
}

export class CreateHealthLibraryPostDto {
  @ApiProperty({ enum: HEALTH_LIBRARY_TABS, example: 'ARTICLES' })
  @IsIn(HEALTH_LIBRARY_TABS)
  tab!: HealthLibraryTabValue;

  @ApiPropertyOptional({ enum: HEALTH_LIBRARY_MEDIA_TYPES, default: 'ARTICLE' })
  @IsOptional()
  @IsIn(HEALTH_LIBRARY_MEDIA_TYPES)
  mediaType?: HealthLibraryMediaTypeValue;

  @ApiProperty({ example: '5 Everyday Habits for a Healthier Heart' })
  @TitleRules()
  title!: string;

  @ApiProperty({ example: 'Heart Health' })
  @CategoryRules()
  category!: string;

  @ApiPropertyOptional({ example: '6 min read' })
  @IsOptional()
  @ReadTimeRules()
  readTime?: string;

  @ApiProperty({ example: 'Small, steady routines add up to real support for your heart.' })
  @SummaryRules()
  summary!: string;

  @ApiPropertyOptional({
    description:
      'Absolute https video URL (YouTube/Vimeo/direct) — required when mediaType is VIDEO (checked in the service). Cover images are uploaded via POST /health-library/:id/cover-image.',
  })
  @IsOptional()
  @VideoUrlRules()
  videoUrl?: string;

  @ApiPropertyOptional({ example: 240 })
  @IsOptional()
  @VideoDurationRules()
  videoDurationSeconds?: number;

  @ApiPropertyOptional({ type: [HealthLibrarySectionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SECTIONS)
  @ValidateNested({ each: true })
  @Type(() => HealthLibrarySectionDto)
  sections?: HealthLibrarySectionDto[];

  @ApiPropertyOptional({
    example: 'Call 112 for chest pain, breathlessness or sudden weakness.',
  })
  @IsOptional()
  @WhenToSeeDoctorRules()
  whenToSeeDoctor?: string;
}

/**
 * PATCH body. Every field is optional (omit = unchanged). Required columns
 * (tab, mediaType, title, category, summary, sections) reject an explicit
 * `null` with a 400; the genuinely optional ones (readTime, videoUrl,
 * videoDurationSeconds, whenToSeeDoctor) accept `null` to clear the value.
 * The cover image is only settable through the upload endpoint, never here.
 */
export class UpdateHealthLibraryPostDto {
  @ApiPropertyOptional({ enum: HEALTH_LIBRARY_TABS })
  @RejectNullWhenPresent()
  @IsIn(HEALTH_LIBRARY_TABS)
  tab?: HealthLibraryTabValue;

  @ApiPropertyOptional({ enum: HEALTH_LIBRARY_MEDIA_TYPES })
  @RejectNullWhenPresent()
  @IsIn(HEALTH_LIBRARY_MEDIA_TYPES)
  mediaType?: HealthLibraryMediaTypeValue;

  @ApiPropertyOptional({ example: '5 Everyday Habits for a Healthier Heart' })
  @RejectNullWhenPresent()
  @TitleRules()
  title?: string;

  @ApiPropertyOptional({ example: 'Heart Health' })
  @RejectNullWhenPresent()
  @CategoryRules()
  category?: string;

  @ApiPropertyOptional({ example: '6 min read', nullable: true })
  @IsOptional()
  @ReadTimeRules()
  readTime?: string | null;

  @ApiPropertyOptional({
    example: 'Small, steady routines add up to real support for your heart.',
  })
  @RejectNullWhenPresent()
  @SummaryRules()
  summary?: string;

  @ApiPropertyOptional({
    description: 'Absolute https video URL; null clears it (not allowed for VIDEO posts)',
    nullable: true,
  })
  @IsOptional()
  @VideoUrlRules()
  videoUrl?: string | null;

  @ApiPropertyOptional({ example: 240, nullable: true })
  @IsOptional()
  @VideoDurationRules()
  videoDurationSeconds?: number | null;

  @ApiPropertyOptional({
    type: [HealthLibrarySectionDto],
    description: 'Replaces all sections; send [] to clear',
  })
  @RejectNullWhenPresent()
  @IsArray()
  @ArrayMaxSize(MAX_SECTIONS)
  @ValidateNested({ each: true })
  @Type(() => HealthLibrarySectionDto)
  sections?: HealthLibrarySectionDto[];

  @ApiPropertyOptional({
    example: 'Call 112 for chest pain, breathlessness or sudden weakness.',
    nullable: true,
  })
  @IsOptional()
  @WhenToSeeDoctorRules()
  whenToSeeDoctor?: string | null;
}

export class ListHealthLibraryQueryDto {
  @ApiPropertyOptional({ enum: HEALTH_LIBRARY_TABS })
  @IsOptional()
  @IsIn(HEALTH_LIBRARY_TABS)
  tab?: HealthLibraryTabValue;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  category?: string;

  @ApiPropertyOptional({ enum: HEALTH_LIBRARY_MEDIA_TYPES })
  @IsOptional()
  @IsIn(HEALTH_LIBRARY_MEDIA_TYPES)
  mediaType?: HealthLibraryMediaTypeValue;

  @ApiPropertyOptional({
    enum: HEALTH_LIBRARY_STATUSES,
    description: 'Staff only — patients and other read-only roles always see PUBLISHED',
  })
  @IsOptional()
  @IsIn(HEALTH_LIBRARY_STATUSES)
  status?: HealthLibraryStatusValue;

  @ApiPropertyOptional({ example: 'sleep' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export interface HealthLibrarySectionResponse {
  heading: string;
  body: string;
}

export interface HealthLibraryPostResponse {
  id: string;
  clinicId: string;
  tab: HealthLibraryTabValue;
  mediaType: HealthLibraryMediaTypeValue;
  status: HealthLibraryStatusValue;
  title: string;
  category: string;
  readTime: string | null;
  summary: string;
  coverImageUrl: string | null;
  videoUrl: string | null;
  videoDurationSeconds: number | null;
  sections: HealthLibrarySectionResponse[];
  whenToSeeDoctor: string | null;
  viewCount: number;
  publishedAt: string | null;
  /** Only returned to author roles — omitted for PATIENT / read-only callers. */
  authorId?: string;
  authorName: string | null;
  authorRole: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HealthLibraryListResponse {
  items: HealthLibraryPostResponse[];
  total: number;
}
