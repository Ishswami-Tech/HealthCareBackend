import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  IsUUID,
  IsNotEmpty,
  IsEnum,
  ValidateNested,
  Min,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Gender enumeration for patients
 */
export enum PatientGender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  OTHER = 'OTHER',
}

/**
 * Nested DTO for patient emergency contact
 */
export class PatientEmergencyContactDto {
  @ApiProperty({ example: 'Jane Doe', description: 'Emergency contact name' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiProperty({ example: 'Spouse', description: 'Relationship to patient' })
  @IsString()
  @IsNotEmpty()
  relationship!: string;

  @ApiProperty({ example: '+919876543210', description: 'Emergency contact phone' })
  @IsString()
  @IsNotEmpty()
  phone!: string;
}

/**
 * Nested DTO for patient insurance info
 */
export class PatientInsuranceDto {
  @ApiProperty({ example: 'Star Health', description: 'Insurance provider' })
  @IsString()
  @IsNotEmpty()
  provider!: string;

  @ApiProperty({ example: 'POL-12345', description: 'Insurance policy number' })
  @IsString()
  @IsNotEmpty()
  policyNumber!: string;

  @ApiPropertyOptional({ example: 'GRP-001', description: 'Group number' })
  @IsOptional()
  @IsString()
  groupNumber?: string;

  @ApiProperty({ example: 'John Doe', description: 'Primary insurance holder name' })
  @IsString()
  @IsNotEmpty()
  primaryHolder!: string;

  @ApiProperty({ example: '2024-01-01', description: 'Coverage start date (YYYY-MM-DD)' })
  @IsDateString()
  @IsNotEmpty()
  coverageStartDate!: string;

  @ApiPropertyOptional({ example: '2025-01-01', description: 'Coverage end date (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  coverageEndDate?: string;

  @ApiProperty({ example: 'Medical', description: 'Type of coverage (e.g., Medical, Dental)' })
  @IsString()
  @IsNotEmpty()
  coverageType!: string;
}

/**
 * Data Transfer Object for creating/updating a patient profile
 * @class CreatePatientDto
 */
export class CreatePatientDto {
  @ApiProperty({
    example: 'user-uuid-123',
    description: 'User ID to associate with patient profile',
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
    example: '1990-01-15',
    description: 'Date of birth (YYYY-MM-DD)',
  })
  @IsOptional()
  @IsString()
  dateOfBirth?: string;

  @ApiPropertyOptional({
    example: 'MALE',
    description: 'Patient gender',
    enum: PatientGender,
  })
  @IsOptional()
  @IsEnum(PatientGender, { message: 'Gender must be MALE, FEMALE, or OTHER' })
  gender?: PatientGender;

  @ApiPropertyOptional({
    example: 'O+',
    description: 'Blood group',
  })
  @IsOptional()
  @IsString()
  bloodGroup?: string;

  @ApiPropertyOptional({
    example: 170,
    description: 'Height in cm',
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  height?: number;

  @ApiPropertyOptional({
    example: 65,
    description: 'Weight in kg',
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  weight?: number;

  @ApiPropertyOptional({
    example: ['Peanuts', 'Penicillin'],
    description: 'Known allergies',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allergies?: string[];

  @ApiPropertyOptional({
    example: ['Diabetes', 'Hypertension'],
    description: 'Medical history',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  medicalHistory?: string[];

  @ApiPropertyOptional({
    type: PatientEmergencyContactDto,
    description: 'Emergency contact details',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PatientEmergencyContactDto)
  emergencyContact?: PatientEmergencyContactDto;

  @ApiPropertyOptional({
    type: PatientInsuranceDto,
    description: 'Insurance information',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PatientInsuranceDto)
  insurance?: PatientInsuranceDto;
}

/**
 * Data Transfer Object for updating a patient profile (all fields optional)
 * @class UpdatePatientDto
 */
export class UpdatePatientDto {
  @ApiPropertyOptional({ example: '1990-01-15' })
  @IsOptional()
  @IsString()
  dateOfBirth?: string;

  @ApiPropertyOptional({ example: 'MALE', enum: PatientGender })
  @IsOptional()
  @IsEnum(PatientGender)
  gender?: PatientGender;

  @ApiPropertyOptional({ example: 'O+' })
  @IsOptional()
  @IsString()
  bloodGroup?: string;

  @ApiPropertyOptional({ example: 170, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  height?: number;

  @ApiPropertyOptional({ example: 65, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  weight?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allergies?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  medicalHistory?: string[];

  @ApiPropertyOptional({ type: PatientEmergencyContactDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PatientEmergencyContactDto)
  emergencyContact?: PatientEmergencyContactDto;

  @ApiPropertyOptional({ type: PatientInsuranceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PatientInsuranceDto)
  insurance?: PatientInsuranceDto;
}
