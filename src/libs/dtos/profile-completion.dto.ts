import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsDateString,
  IsEnum,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Role } from '@core/types/enums.types';

/**
 * Emergency Contact DTO
 */
export class EmergencyContactDto {
  @ApiProperty({
    description: 'Contact name',
    example: 'John Doe',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({
    description: 'Contact phone number',
    example: '+1234567890',
  })
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @ApiProperty({
    description: 'Relationship to contact',
    example: 'Father',
  })
  @IsString()
  @IsNotEmpty()
  relationship!: string;
}

/**
 * Complete Profile Request DTO
 */
export class CompleteProfileRequestDto {
  @ApiProperty({
    description: 'User ID to complete profile for',
    example: 'user-123',
  })
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @ApiProperty({
    description: 'First name',
    example: 'John',
  })
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @ApiProperty({
    description: 'Last name',
    example: 'Doe',
  })
  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @ApiProperty({
    description: 'Phone number',
    example: '+1234567890',
  })
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @ApiProperty({
    description: 'Date of birth',
    example: '1990-01-01',
  })
  @IsDateString()
  @IsNotEmpty()
  dateOfBirth!: string;

  @ApiProperty({
    description: 'Gender',
    enum: ['MALE', 'FEMALE', 'OTHER'],
    example: 'MALE',
  })
  @IsEnum(['MALE', 'FEMALE', 'OTHER'])
  @IsNotEmpty()
  gender!: string;

  @ApiProperty({
    description: 'Address',
    example: '123 Main St, City, State 12345',
  })
  @IsString()
  @IsNotEmpty()
  address!: string;

  @ApiPropertyOptional({
    description: 'Emergency contact information',
    type: EmergencyContactDto,
  })
  @IsObject()
  @ValidateNested()
  @Type(() => EmergencyContactDto)
  @IsOptional()
  emergencyContact?: EmergencyContactDto;

  @ApiPropertyOptional({
    description: 'Specialization (required for medical staff)',
    example: 'Cardiology',
  })
  @IsString()
  @IsOptional()
  specialization?: string;

  @ApiPropertyOptional({
    description: 'Years of experience (required for medical staff)',
    example: 5,
  })
  @IsNumber()
  @IsOptional()
  experience?: number;

  @ApiPropertyOptional({
    description: 'Clinic name (required for clinic admin)',
    example: 'City Clinic',
  })
  @IsString()
  @IsOptional()
  clinicName?: string;

  @ApiPropertyOptional({
    description: 'Clinic address (required for clinic admin)',
    example: '456 Clinic Ave, Healthcare City, HC 67890',
  })
  @IsString()
  @IsOptional()
  clinicAddress?: string;
}

/**
 * Profile Completion Status DTO
 */
export class ProfileCompletionStatusDto {
  @ApiProperty({
    description: 'Whether profile is complete',
    example: true,
  })
  @IsBoolean()
  isComplete!: boolean;

  @ApiProperty({
    description: 'Completion percentage (0-100)',
    example: 100,
  })
  @IsNumber()
  completionPercentage!: number;

  @ApiPropertyOptional({
    description: 'Timestamp when profile was completed',
    example: '2024-01-01T00:00:00.000Z',
  })
  @IsDateString()
  @IsOptional()
  profileCompletedAt?: string | null;
}

/**
 * Profile Completion Fields DTO
 */
export class ProfileCompletionFieldsDto {
  @ApiProperty({
    description: 'User role',
    enum: Role,
    example: Role.PATIENT,
  })
  @IsEnum(Role)
  role!: Role;

  @ApiProperty({
    description: 'List of required fields for this role',
    example: ['firstName', 'lastName', 'phone', 'dateOfBirth', 'gender', 'address'],
    type: [String],
  })
  @IsString({ each: true })
  requiredFields!: string[];
}

/**
 * Profile Completion Response DTO
 */
export class ProfileCompletionDto {
  @ApiProperty({
    description: 'Whether operation was successful',
    example: true,
  })
  @IsBoolean()
  success!: boolean;

  @ApiProperty({
    description: 'Response message',
    example: 'Profile completed successfully',
  })
  @IsString()
  message!: string;

  @ApiPropertyOptional({
    description: 'Updated user data',
    example: {
      id: 'user-123',
      email: 'user@example.com',
      firstName: 'John',
      lastName: 'Doe',
      role: 'PATIENT',
    },
  })
  @IsObject()
  @IsOptional()
  user?: object;
}

/**
 * Profile Validation Error DTO
 */
export class ProfileValidationErrorDto {
  @ApiProperty({
    description: 'Whether validation passed',
    example: false,
  })
  @IsBoolean()
  isValid!: boolean;

  @ApiProperty({
    description: 'List of missing required fields',
    example: ['phone', 'dateOfBirth'],
    type: [String],
  })
  @IsString({ each: true })
  missingFields!: string[];

  @ApiProperty({
    description: 'List of validation errors',
    example: [
      { field: 'phone', message: 'Phone number format is invalid' },
      { field: 'dateOfBirth', message: 'Invalid date of birth' },
    ],
    type: Array,
  })
  @IsObject({ each: true })
  errors!: Array<{ field: string; message: string }>;
}
