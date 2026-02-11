import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsInt, IsUUID, IsNotEmpty, Min } from 'class-validator';
import { Type } from 'class-transformer';

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
export class CreateDoctorDto {
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
