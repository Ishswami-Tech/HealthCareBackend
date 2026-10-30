import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsInt,
  IsUUID,
  IsNotEmpty,
  IsBoolean,
  IsArray,
  ArrayMaxSize,
  IsObject,
  IsDefined,
  Matches,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { BadRequestException } from '@nestjs/common';
import {
  LocalizedProfileValidationError,
  normalizeLocalizedProfile,
  type LocalizedProfile,
} from '@services/doctors/localized-profile.util';

/** Allowed slot length range (minutes) for a doctor-specific slot override. */
export const DOCTOR_SLOT_MINUTES_MIN = 5;
export const DOCTOR_SLOT_MINUTES_MAX = 120;

const trimStrings = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value)
    ? (value as unknown[]).map(v => (typeof v === 'string' ? v.trim() : v)).filter(v => v !== '')
    : value;
/** Validates/normalises localizedProfile; invalid input becomes a 400 with a clear message. */
const normalizeLocalizedProfileValue = ({ value }: { value: unknown }): LocalizedProfile | null => {
  try {
    return normalizeLocalizedProfile(value);
  } catch (error) {
    if (error instanceof LocalizedProfileValidationError) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }
};
const trimString = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Optional professional-profile fields shared by create and self/admin update.
 * Money is in INR rupees (same unit as Doctor.consultationFee).
 */
export class DoctorProfileFieldsDto {
  @ApiPropertyOptional({ description: 'Video consultation fee in INR', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Video consultation fee must be a number' })
  @Min(0, { message: 'Video consultation fee cannot be negative' })
  @Max(1000000, { message: 'Video consultation fee is too large' })
  videoConsultationFee?: number;

  /**
   * @deprecated Visit lengths are clinic settings (appointmentSettings.inPersonDurationMinutes /
   * videoDurationMinutes, visit-duration.util): slot generation and booking never read this.
   * Still accepted (and stored) so older clients do not get a 400.
   */
  @ApiPropertyOptional({
    deprecated: true,
    description:
      'Deprecated and ignored for slots and bookings: the visit length is the clinic setting ' +
      '(appointmentSettings.inPersonDurationMinutes / videoDurationMinutes, set by the clinic admin).',
    minimum: DOCTOR_SLOT_MINUTES_MIN,
    maximum: DOCTOR_SLOT_MINUTES_MAX,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Slot length must be a whole number of minutes' })
  @Min(DOCTOR_SLOT_MINUTES_MIN, { message: 'Slot length must be at least 5 minutes' })
  @Max(DOCTOR_SLOT_MINUTES_MAX, { message: 'Slot length cannot exceed 120 minutes' })
  slotDurationMinutes?: number;

  @ApiPropertyOptional({ description: 'Offers video consultations' })
  @IsOptional()
  @IsBoolean()
  videoConsultationEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Offers in-person consultations' })
  @IsOptional()
  @IsBoolean()
  inPersonConsultationEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Medical council registration / licence number' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(64)
  licenseNumber?: string;

  @ApiPropertyOptional({ type: [String], description: 'Languages spoken (max 20)' })
  @IsOptional()
  @Transform(trimStrings)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  languages?: string[];

  @ApiPropertyOptional({ description: 'Education summary' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(1000)
  education?: string;

  @ApiPropertyOptional({ type: [String], description: 'Certifications (max 30)' })
  @IsOptional()
  @Transform(trimStrings)
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  certifications?: string[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description:
      'Public profile text per language, keyed by locale (en, hi, mr): { name?, headline?, highlights?: [{ icon?, text }] }. Send null or {} to clear.',
    example: {
      en: {
        name: 'Dr. A',
        headline: 'Ayurvedacharya',
        highlights: [{ icon: '🏅', text: 'Gold medalist' }],
      },
    },
  })
  @IsOptional()
  @Transform(normalizeLocalizedProfileValue)
  @IsObject()
  localizedProfile?: LocalizedProfile | null;

  @ApiPropertyOptional({ description: 'ABDM Health Professional Registry (HPR) id' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  abdmHprId?: string;
}

/**
 * Data Transfer Object for creating/updating a doctor profile
 * @class CreateDoctorDto
 * @description Contains fields for doctor profile creation/update
 * @example
 * ```typescript
 * const dto = new CreateDoctorDto();
 * dto.userId = "user-uuid-123";
 * dto.specialization = "Ayurveda";
 * dto.experience = 10;
 * ```
 */
export class CreateDoctorDto extends DoctorProfileFieldsDto {
  @ApiProperty({
    example: 'user-uuid-123',
    description: 'User ID to associate with the doctor profile',
  })
  @IsString()
  @IsNotEmpty({ message: 'User ID is required' })
  userId!: string;

  @ApiPropertyOptional({
    example: 'clinic-uuid-123',
    description: 'Associated clinic ID',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Clinic ID must be a valid UUID' })
  clinicId?: string;

  @ApiPropertyOptional({
    example: 'Ayurveda',
    description: 'Medical specialization',
  })
  @IsOptional()
  @IsString({ message: 'Specialization must be a string' })
  specialization?: string;

  @ApiPropertyOptional({
    example: 10,
    description: 'Years of professional experience',
    minimum: 0,
  })
  @IsOptional()
  @IsNumber({}, { message: 'Experience must be a number' })
  @IsInt({ message: 'Experience must be an integer' })
  @Min(0, { message: 'Experience cannot be negative' })
  @Type(() => Number)
  experience?: number;

  @ApiPropertyOptional({
    example: 'MBBS, MD',
    description: 'Professional qualification',
  })
  @IsOptional()
  @IsString({ message: 'Qualification must be a string' })
  qualification?: string;

  @ApiPropertyOptional({
    example: 500,
    description: 'Consultation fee in INR',
    minimum: 0,
  })
  @IsOptional()
  @IsNumber({}, { message: 'Consultation fee must be a number' })
  @Min(0, { message: 'Consultation fee cannot be negative' })
  @Type(() => Number)
  consultationFee?: number;

  @ApiPropertyOptional({
    description: 'Working hours schedule (JSON object)',
    example: { monday: '09:00-17:00', tuesday: '09:00-17:00' },
  })
  @IsOptional()
  workingHours?: unknown;
}

/**
 * Data Transfer Object for doctor query filters
 * @class DoctorFilterDto
 */
export class DoctorFilterDto {
  @ApiPropertyOptional({
    example: 'Ayurveda',
    description: 'Filter by specialization',
  })
  @IsOptional()
  @IsString()
  specialization?: string;

  @ApiPropertyOptional({
    example: 'clinic-uuid-123',
    description: 'Filter by clinic ID',
  })
  @IsOptional()
  @IsString()
  clinicId?: string;
}

/**
 * Partial profile update (PATCH /doctors/:id). All fields optional.
 * @class UpdateDoctorProfileDto
 */
export class UpdateDoctorProfileDto extends DoctorProfileFieldsDto {
  @ApiPropertyOptional({ example: 'Ayurveda' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(120)
  specialization?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(80)
  experience?: number;

  @ApiPropertyOptional({ example: 'MBBS, MD' })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(500)
  qualification?: string;

  @ApiPropertyOptional({ description: 'In-person consultation fee in INR', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  consultationFee?: number;

  @ApiPropertyOptional({
    description:
      'What the doctor earns per video consultation in this clinic (rest is convenience fee). Admins only. null clears it (percentage fee applies).',
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  videoDoctorFee?: number | null;

  @ApiPropertyOptional({
    description: 'What the doctor earns per in-person visit in this clinic. Admins only.',
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  inPersonDoctorFee?: number | null;

  @ApiPropertyOptional({ description: 'Working hours schedule (JSON object)' })
  @IsOptional()
  workingHours?: unknown;
}

/**
 * Create a review for a completed appointment.
 * @class CreateDoctorReviewDto
 */
export class CreateDoctorReviewDto {
  @ApiProperty({ description: 'Completed appointment this review is for' })
  @IsUUID('4', { message: 'appointmentId must be a valid UUID' })
  appointmentId!: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @Type(() => Number)
  @IsInt({ message: 'Rating must be a whole number between 1 and 5' })
  @Min(1, { message: 'Rating must be between 1 and 5' })
  @Max(5, { message: 'Rating must be between 1 and 5' })
  rating!: number;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(1000, { message: 'Comment cannot exceed 1000 characters' })
  comment?: string;
}

/**
 * Pagination for the reviews list.
 * @class DoctorReviewsQueryDto
 */
export class DoctorReviewsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 10, minimum: 1, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

const IST_DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Create (or replace) a dated OPD-window override for one doctor day, on top of the
 * doctor's static weekly workingHours. `sessions: []` means the doctor is closed for
 * the whole day. Times are 24h HH:MM. The service re-validates the blocks (HH:MM,
 * start < end, no overlaps, today-or-later day) and returns 400 on malformed input.
 * @class CreateDayOverrideDto
 */
export class CreateDayOverrideDto {
  @ApiProperty({
    description: 'IST calendar day to override (YYYY-MM-DD), today or later',
    example: '2026-10-30',
  })
  @IsString()
  @Matches(IST_DAY_KEY, { message: 'date must be an IST calendar day YYYY-MM-DD' })
  date!: string;

  @ApiProperty({
    description:
      'Per-day session blocks, the {start,end} shape the slot grid consumes. Use [] to close the day. Accepts an array or its JSON-string form.',
    example: [{ start: '12:00', end: '15:00' }],
    required: false,
  })
  @IsDefined({ message: 'sessions is required (use [] to close the day)' })
  sessions!: unknown;

  @ApiPropertyOptional({
    description: 'Free-text emergency reason (going somewhere, family matter, illness, ...)',
    example: 'Attending a family function',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(1000, { message: 'reason cannot exceed 1000 characters' })
  reason?: string;

  @ApiPropertyOptional({
    description: 'Optional clinic-location id to scope the override; null/omitted = all locations',
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  locationId?: string | null;
}

/**
 * Optional date bounds (IST YYYY-MM-DD, inclusive) when listing a doctor's active day
 * overrides. Omit both to get today through +31 days.
 * @class ListDayOverridesQueryDto
 */
export class ListDayOverridesQueryDto {
  @ApiPropertyOptional({
    description: 'Inclusive start day (IST YYYY-MM-DD); defaults to today',
    example: '2026-10-30',
  })
  @IsOptional()
  @Transform(trimString)
  @Matches(IST_DAY_KEY, { message: 'from must be an IST calendar day YYYY-MM-DD' })
  from?: string;

  @ApiPropertyOptional({
    description: 'Inclusive end day (IST YYYY-MM-DD); defaults to today + 31 days',
    example: '2026-11-15',
  })
  @IsOptional()
  @Transform(trimString)
  @Matches(IST_DAY_KEY, { message: 'to must be an IST calendar day YYYY-MM-DD' })
  to?: string;
}

/**
 * Filters for listing doctor reassignment cascade proposals (L3). A doctor sees only their
 * own proposals; a clinic admin sees the clinic's.
 * @class ListReassignmentProposalsQueryDto
 */
export class ListReassignmentProposalsQueryDto {
  @ApiPropertyOptional({
    description: 'Proposal status filter (PENDING / APPLIED / DEFERRED / DISCARDED)',
    example: 'PENDING',
    required: false,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(32)
  status?: string;

  @ApiPropertyOptional({
    description: 'Restrict to one doctor (Doctor.id or the doctor User.id); default PENDING',
    example: 'b274f231-4b0b-4e3a-8f2f-1c2f5e3d9a11',
    required: false,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  doctorId?: string;
}

/**
 * Body of a confirmed same-time / day move for a PENDING reassignment proposal: either a
 * chosen target doctor (same-time reassign) or a chosen next date+time (reschedule path).
 * @class ApplyReassignmentProposalDto
 */
export class ApplyReassignmentProposalDto {
  @ApiPropertyOptional({
    description: 'Chosen target provider (Doctor.id) for a SAME-time move',
    example: 'b274f231-4b0b-4e3a-8f2f-1c2f5e3d9a11',
    required: false,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  doctorId?: string;

  @ApiPropertyOptional({
    description: 'Chosen next-available date (IST YYYY-MM-DD) for a day move',
    example: '2026-11-01',
    required: false,
  })
  @IsOptional()
  @Transform(trimString)
  @Matches(IST_DAY_KEY, { message: 'date must be an IST calendar day YYYY-MM-DD' })
  date?: string;

  @ApiPropertyOptional({
    description: 'Chosen slot time (HH:MM, 24h) with `date`',
    example: '10:30',
    required: false,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  time?: string;

  @ApiPropertyOptional({
    description: 'Free-text note recorded on the proposal when applied',
    example: 'Moved to Dr. B for 12 Nov',
    required: false,
  })
  @IsOptional()
  @Transform(trimString)
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
