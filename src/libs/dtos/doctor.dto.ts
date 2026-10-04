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
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

/** Allowed slot length range (minutes) for a doctor-specific slot override. */
export const DOCTOR_SLOT_MINUTES_MIN = 5;
export const DOCTOR_SLOT_MINUTES_MAX = 120;

const trimStrings = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value)
    ? (value as unknown[]).map(v => (typeof v === 'string' ? v.trim() : v)).filter(v => v !== '')
    : value;
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

  @ApiPropertyOptional({
    description: 'Slot length in minutes (doctor-specific override)',
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
