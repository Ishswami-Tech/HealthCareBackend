/**
 * Visit Therapy (Therapy / Panchakarma) DTOs
 * @module VisitTherapyDTOs
 * @description Per-visit therapy plans (doctor-authored) and the sessions a
 * therapist performs against them. Backed by `visit_therapy_plans` /
 * `visit_therapy_sessions`.
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TreatmentType } from '@core/types/enums.types';

/**
 * Mirrors the Prisma `TherapyStatus` enum. The shared TS mirror in
 * `@core/types` still lists the legacy `RESCHEDULED` value and lacks `PAUSED`,
 * so the therapy module keeps its own string union rather than editing the
 * shared file.
 */
export const VISIT_THERAPY_STATUSES = [
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'PAUSED',
] as const;
export type VisitTherapyStatus = (typeof VISIT_THERAPY_STATUSES)[number];

const FREE_TEXT_MAX = 2000;
const LABEL_MAX = 200;
const MAX_PLANNED_SESSIONS = 60;
const MAX_SESSION_MINUTES = 600;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateVisitTherapyPlanDto {
  @ApiProperty({ enum: TreatmentType, example: TreatmentType.ABHYANGA })
  @IsEnum(TreatmentType)
  procedure!: TreatmentType;

  @ApiPropertyOptional({
    example: 'Sarvanga Abhyanga with Dhanwantharam taila',
    description: 'Free-text label shown instead of the enum name',
  })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(LABEL_MAX)
  procedureLabel?: string;

  @ApiProperty({ example: 7, description: 'Number of sessions planned (1-60)' })
  @IsInt()
  @Min(1)
  @Max(MAX_PLANNED_SESSIONS)
  plannedSessions!: number;

  @ApiPropertyOptional({ example: 'Daily', description: 'e.g. Daily, Alternate days, Weekly' })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(LABEL_MAX)
  frequency?: string;

  @ApiProperty({ example: '2026-09-26' })
  @IsDateString()
  startDate!: string;

  @ApiPropertyOptional({ example: '2026-10-03' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ example: 'user-uuid', description: 'User.id of the assigned therapist' })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(LABEL_MAX)
  therapistUserId?: string;

  @ApiPropertyOptional({ example: 'Dhanwantharam taila, Bala taila' })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(FREE_TEXT_MAX)
  medicinesUsed?: string;

  @ApiPropertyOptional({ example: 'Mild pressure over lumbar region' })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(FREE_TEXT_MAX)
  notes?: string;
}

export class UpdateVisitTherapyPlanDto {
  @ApiPropertyOptional({ enum: TreatmentType })
  @IsOptional()
  @IsEnum(TreatmentType)
  procedure?: TreatmentType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(LABEL_MAX)
  procedureLabel?: string;

  @ApiPropertyOptional({ example: 7 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PLANNED_SESSIONS)
  plannedSessions?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(LABEL_MAX)
  frequency?: string;

  @ApiPropertyOptional({ example: '2026-09-26' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ example: '2026-10-03', description: 'Send an empty string to clear' })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(LABEL_MAX)
  endDate?: string;

  @ApiPropertyOptional({ description: 'Send an empty string to unassign' })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(LABEL_MAX)
  therapistUserId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(FREE_TEXT_MAX)
  medicinesUsed?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(FREE_TEXT_MAX)
  notes?: string;

  @ApiPropertyOptional({ enum: VISIT_THERAPY_STATUSES, example: 'PAUSED' })
  @IsOptional()
  @IsIn(VISIT_THERAPY_STATUSES)
  status?: VisitTherapyStatus;
}

export class RecordTherapySessionDto {
  @ApiPropertyOptional({
    example: '2026-09-26T10:30:00.000Z',
    description: 'Defaults to now',
  })
  @IsOptional()
  @IsDateString()
  sessionDate?: string;

  @ApiPropertyOptional({ example: 45, description: 'Minutes (1-600)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_SESSION_MINUTES)
  durationMinutes?: number;

  @ApiPropertyOptional({ example: 'Good sweating, no discomfort' })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(FREE_TEXT_MAX)
  observations?: string;

  @ApiPropertyOptional({ example: 'Felt relaxed; pain reduced' })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(FREE_TEXT_MAX)
  patientResponse?: string;

  @ApiPropertyOptional({ example: 3, description: '0-10' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  painScore?: number;
}

export class UpdateTherapySessionDto {
  @ApiPropertyOptional({ example: '2026-09-26T10:30:00.000Z' })
  @IsOptional()
  @IsDateString()
  sessionDate?: string;

  @ApiPropertyOptional({ example: 45 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_SESSION_MINUTES)
  durationMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(FREE_TEXT_MAX)
  observations?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(FREE_TEXT_MAX)
  patientResponse?: string;

  @ApiPropertyOptional({ example: 3, description: '0-10' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  painScore?: number;

  @ApiPropertyOptional({ enum: VISIT_THERAPY_STATUSES })
  @IsOptional()
  @IsIn(VISIT_THERAPY_STATUSES)
  status?: VisitTherapyStatus;
}

export interface VisitTherapySessionResponse {
  id: string;
  planId: string;
  visitId: string;
  clinicId: string;
  sessionNumber: number;
  sessionDate: string;
  durationMinutes: number | null;
  observations: string | null;
  patientResponse: string | null;
  painScore: number | null;
  status: VisitTherapyStatus;
  performedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TherapistRef {
  userId: string;
  name: string;
}

export interface VisitTherapyPlanResponse {
  id: string;
  visitId: string;
  opdNumber: string | null;
  patientId: string;
  clinicId: string;
  procedure: TreatmentType;
  procedureLabel: string | null;
  plannedSessions: number;
  completedSessions: number;
  frequency: string | null;
  startDate: string;
  endDate: string | null;
  therapistUserId: string | null;
  therapist: TherapistRef | null;
  medicinesUsed: string | null;
  notes: string | null;
  status: VisitTherapyStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  sessions: VisitTherapySessionResponse[];
}

/** A plan on a therapist's work list, with the patient it belongs to. */
export interface TherapyWorkItemResponse extends VisitTherapyPlanResponse {
  patientName: string | null;
  patientPhone: string | null;
}

export interface TherapyProgressVitalsPoint {
  visitId: string;
  opdNumber: string;
  date: string;
  painScore: number | null;
  weightKg: number | null;
  bmi: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
}

export interface TherapyProgressResponse {
  plans: VisitTherapyPlanResponse[];
  totals: { planned: number; completed: number };
  vitalsSeries: TherapyProgressVitalsPoint[];
}

export interface TherapistOptionResponse {
  userId: string;
  name: string;
  phone?: string | null;
}
