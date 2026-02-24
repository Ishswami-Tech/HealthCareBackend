import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsUUID,
  IsNotEmpty,
  ValidateNested,
  IsNumber,
  Min,
  Max,
  IsUrl,
  IsBoolean,
  IsObject,
  Matches,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Clinic status enumeration
 * @enum {string} ClinicStatus
 * @description Defines the operational status of a clinic
 * @example ClinicStatus.ACTIVE
 */
export enum ClinicStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SUSPENDED = 'SUSPENDED',
  MAINTENANCE = 'MAINTENANCE',
}

/**
 * Clinic type enumeration
 * @enum {string} ClinicType
 * @description Defines the different types of healthcare clinics
 * @example ClinicType.GENERAL
 */
export enum ClinicType {
  GENERAL = 'GENERAL',
  SPECIALTY = 'SPECIALTY',
  EMERGENCY = 'EMERGENCY',
  URGENT_CARE = 'URGENT_CARE',
  DIAGNOSTIC = 'DIAGNOSTIC',
  SURGICAL = 'SURGERY',
}

// Clinic Location DTOs (defined before CreateClinicDto to avoid forward reference)
export class CreateClinicLocationDto {
  name!: string;
  address!: string;
  city!: string;
  state!: string;
  country!: string;
  zipCode!: string;
  phone!: string;
  email!: string;
  timezone!: string;
  isActive?: boolean;
  latitude?: number;
  longitude?: number;
  workingHours?: Record<string, { start: string; end: string } | null>;
  settings?: Record<string, unknown>;
}

export class UpdateClinicLocationDto {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  zipCode?: string;
  phone?: string;
  email?: string;
  timezone?: string;
  isActive?: boolean;
  latitude?: number;
  longitude?: number;
  workingHours?: Record<string, { start: string; end: string } | null>;
  settings?: Record<string, unknown>;
}

/**
 * Data Transfer Object for creating new clinics
 * @class CreateClinicDto
 * @description Contains all required fields for clinic creation with validation
 * Supports both basic clinic creation and extended clinic creation with subdomain/app_name
 * @example
 * ```typescript
 * const clinic = new CreateClinicDto();
 * clinic.name = "Main Street Medical Center";
 * clinic.type = ClinicType.GENERAL;
 * clinic.address = "123 Main Street";
 * ```
 */
export class CreateClinicDto {
  @ApiProperty({
    example: 'Main Street Medical Center',
    description: 'Clinic name',
    minLength: 2,
    maxLength: 100,
  })
  @IsString({ message: 'Clinic name must be a string' })
  @IsNotEmpty({ message: 'Clinic name is required' })
  @Min(2, { message: 'Clinic name must be at least 2 characters long' })
  @Max(100, { message: 'Clinic name cannot exceed 100 characters' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  name!: string;

  @ApiProperty({
    example: 'GENERAL',
    description: 'Type of clinic',
    enum: ClinicType,
    enumName: 'ClinicType',
  })
  @IsEnum(ClinicType, { message: 'Clinic type must be a valid type' })
  @IsNotEmpty({ message: 'Clinic type is required' })
  type!: ClinicType;

  @ApiProperty({
    example: '123 Main Street',
    description: 'Clinic address',
    minLength: 5,
    maxLength: 200,
  })
  @IsString({ message: 'Address must be a string' })
  @IsNotEmpty({ message: 'Address is required' })
  @Min(5, { message: 'Address must be at least 5 characters long' })
  @Max(200, { message: 'Address cannot exceed 200 characters' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  address!: string;

  @ApiProperty({
    example: 'New York',
    description: 'Clinic city',
    minLength: 2,
    maxLength: 50,
  })
  @IsString({ message: 'City must be a string' })
  @IsNotEmpty({ message: 'City is required' })
  @Min(2, { message: 'City must be at least 2 characters long' })
  @Max(50, { message: 'City cannot exceed 50 characters' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  city!: string;

  @ApiProperty({
    example: 'NY',
    description: 'Clinic state/province',
    minLength: 2,
    maxLength: 50,
  })
  @IsString({ message: 'State must be a string' })
  @IsNotEmpty({ message: 'State is required' })
  @Min(2, { message: 'State must be at least 2 characters long' })
  @Max(50, { message: 'State cannot exceed 50 characters' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  state!: string;

  @ApiProperty({
    example: 'USA',
    description: 'Clinic country',
    minLength: 2,
    maxLength: 50,
  })
  @IsString({ message: 'Country must be a string' })
  @IsNotEmpty({ message: 'Country is required' })
  @Min(2, { message: 'Country must be at least 2 characters long' })
  @Max(50, { message: 'Country cannot exceed 50 characters' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  country!: string;

  @ApiProperty({
    example: '10001',
    description: 'Clinic zip/postal code',
    minLength: 3,
    maxLength: 20,
  })
  @IsString({ message: 'Zip code must be a string' })
  @IsNotEmpty({ message: 'Zip code is required' })
  @Min(3, { message: 'Zip code must be at least 3 characters long' })
  @Max(20, { message: 'Zip code cannot exceed 20 characters' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  zipCode!: string;

  @ApiProperty({
    example: '+1234567890',
    description: 'Clinic phone number',
    pattern: '^\\+?[1-9]\\d{1,14}$',
  })
  @IsString({ message: 'Phone number must be a string' })
  @IsNotEmpty({ message: 'Phone number is required' })
  phone!: string;

  @ApiProperty({
    example: 'info@mainstreetmedical.com',
    description: 'Clinic email address',
    format: 'email',
  })
  @IsString({ message: 'Email must be a string' })
  @IsNotEmpty({ message: 'Email is required' })
  @Transform(({ value }): string =>
    typeof value === 'string' ? value.toLowerCase().trim() : (value as string)
  )
  email!: string;

  @ApiPropertyOptional({
    example: 'https://www.mainstreetmedical.com',
    description: 'Clinic website URL',
  })
  @IsOptional()
  @IsUrl({}, { message: 'Website must be a valid URL' })
  website?: string;

  @IsString({ message: 'Operating hours must be a string' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  operatingHours?: string;

  @ApiPropertyOptional({
    example: 'healthcare',
    description: 'Application domain for multi-domain setup',
    enum: ['healthcare', 'clinic'],
  })
  @IsOptional()
  @IsString({ message: 'App domain must be a string' })
  appDomain?: string;

  // Extended fields for multi-tenant clinic creation
  @ApiPropertyOptional({
    description: 'The subdomain for the clinic app',
    example: 'aadesh',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'Subdomain can only contain lowercase letters, numbers, and hyphens',
  })
  subdomain?: string;

  @ApiPropertyOptional({
    description: 'The app name for the clinic (unique identifier)',
    example: 'aadesh-ayurvedalay',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'App name can only contain lowercase letters, numbers, and hyphens',
  })
  app_name?: string;

  @ApiPropertyOptional({
    description: 'The database connection string for the clinic',
    example: 'postgresql://user:pass@localhost:5432/clinic_db',
  })
  @IsOptional()
  @IsString()
  db_connection_string?: string;

  @ApiPropertyOptional({
    description: 'The main location of the clinic',
    type: CreateClinicLocationDto,
  })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => CreateClinicLocationDto)
  mainLocation?: CreateClinicLocationDto;

  @ApiPropertyOptional({
    description:
      'Identifier of the Clinic Admin (required if Super Admin is creating the clinic). Can be email or ID.',
    example: 'admin@example.com',
  })
  @IsOptional()
  @IsString()
  clinicAdminIdentifier?: string;

  @ApiPropertyOptional({
    description: 'The database name for the clinic',
    example: 'clinic_aadesh_db',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9_]+$/, {
    message: 'Database name can only contain lowercase letters, numbers, and underscores',
  })
  databaseName?: string;

  @ApiPropertyOptional({
    description: 'The logo URL of the clinic',
    example: 'https://ayurvedalay.com/logos/aadesh.png',
  })
  @IsOptional()
  @IsString()
  @IsUrl()
  logo?: string;

  @ApiPropertyOptional({
    description: 'The timezone of the clinic',
    example: 'Asia/Kolkata',
  })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({
    description: 'The currency used by the clinic',
    example: 'INR',
  })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({
    description: 'The language used by the clinic',
    example: 'en',
  })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({
    description: 'Whether the clinic is active',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    description: 'Clinic settings as JSON object',
    example: { theme: 'dark', notifications: true },
  })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Clinic description',
    example: 'A comprehensive healthcare facility providing quality medical services',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Communication configuration (Email, WhatsApp, SMS credentials)',
    example: {
      email: {
        primary: {
          provider: 'zeptomail',
          enabled: true,
          credentials: {
            sendMailToken: 'token_here',
            fromEmail: 'noreply@clinic.com',
            fromName: 'Clinic Name',
          },
        },
      },
      whatsapp: {
        primary: {
          provider: 'meta_business',
          enabled: true,
          credentials: {
            apiKey: 'whatsapp_key',
            phoneNumberId: 'phone_id',
          },
        },
      },
      sms: {
        primary: {
          provider: 'twilio',
          enabled: true,
          credentials: {
            apiKey: 'sms_key',
            apiSecret: 'sms_secret',
            fromNumber: '+1234567890',
          },
        },
      },
    },
  })
  @IsOptional()
  @IsObject()
  communicationConfig?: {
    email?: {
      primary?: {
        provider?: string;
        enabled?: boolean;
        credentials?: Record<string, string>;
        priority?: number;
      };
      fallback?: Array<{
        provider?: string;
        enabled?: boolean;
        credentials?: Record<string, string>;
        priority?: number;
      }>;
      defaultFrom?: string;
      defaultFromName?: string;
    };
    whatsapp?: {
      primary?: {
        provider?: string;
        enabled?: boolean;
        credentials?: Record<string, string>;
        priority?: number;
      };
      fallback?: Array<{
        provider?: string;
        enabled?: boolean;
        credentials?: Record<string, string>;
        priority?: number;
      }>;
      defaultNumber?: string;
    };
    sms?: {
      primary?: {
        provider?: string;
        enabled?: boolean;
        credentials?: Record<string, string>;
        priority?: number;
      };
      fallback?: Array<{
        provider?: string;
        enabled?: boolean;
        credentials?: Record<string, string>;
        priority?: number;
      }>;
      defaultNumber?: string;
    };
  };
}

/**
 * Data Transfer Object for updating existing clinics
 * @class UpdateClinicDto
 * @description Contains optional fields for clinic updates with validation
 * @example
 * ```typescript
 * const update = new UpdateClinicDto();
 * update.name = "Updated Clinic Name";
 * update.status = ClinicStatus.ACTIVE;
 * ```
 */
export class UpdateClinicDto {
  @ApiPropertyOptional({
    example: 'Updated Clinic Name',
    description: 'New clinic name',
  })
  @IsOptional()
  @IsString({ message: 'Clinic name must be a string' })
  @Min(2, { message: 'Clinic name must be at least 2 characters long' })
  @Max(100, { message: 'Clinic name cannot exceed 100 characters' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  name?: string;

  @ApiPropertyOptional({
    example: 'SPECIALTY',
    description: 'New clinic type',
    enum: ClinicType,
    enumName: 'ClinicType',
  })
  @IsOptional()
  @IsEnum(ClinicType, { message: 'Clinic type must be a valid type' })
  type?: ClinicType;

  @ApiPropertyOptional({
    example: '456 New Street',
    description: 'New clinic address',
  })
  @IsOptional()
  @IsString({ message: 'Address must be a string' })
  @Min(5, { message: 'Address must be at least 5 characters long' })
  @Max(200, { message: 'Address cannot exceed 200 characters' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  address?: string;

  @ApiPropertyOptional({
    example: 'Los Angeles',
    description: 'New clinic city',
  })
  @IsOptional()
  @IsString({ message: 'City must be a string' })
  @Min(2, { message: 'City must be at least 2 characters long' })
  @Max(50, { message: 'City cannot exceed 50 characters' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  city?: string;

  @ApiPropertyOptional({
    example: 'CA',
    description: 'New clinic state/province',
  })
  @IsOptional()
  @IsString({ message: 'State must be a string' })
  @Min(2, { message: 'State must be at least 2 characters long' })
  @Max(50, { message: 'State cannot exceed 50 characters' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  state?: string;

  @ApiPropertyOptional({
    example: 'USA',
    description: 'New clinic country',
  })
  @IsOptional()
  @IsString({ message: 'Country must be a string' })
  @Min(2, { message: 'Country must be at least 2 characters long' })
  @Max(50, { message: 'Country cannot exceed 50 characters' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  country?: string;

  @ApiPropertyOptional({
    example: '90210',
    description: 'New clinic zip/postal code',
  })
  @IsOptional()
  @IsString({ message: 'Zip code must be a string' })
  @Min(3, { message: 'Zip code must be at least 3 characters long' })
  @Max(20, { message: 'Zip code cannot exceed 20 characters' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  zipCode?: string;

  @ApiPropertyOptional({
    example: '+1987654321',
    description: 'New clinic phone number',
  })
  @IsOptional()
  @IsString({ message: 'Phone number must be a string' })
  phone?: string;

  @ApiPropertyOptional({
    example: 'newemail@clinic.com',
    description: 'New clinic email address',
  })
  @IsOptional()
  @IsString({ message: 'Email must be a string' })
  @Transform(({ value }): string =>
    typeof value === 'string' ? value.toLowerCase().trim() : (value as string)
  )
  email?: string;

  @ApiPropertyOptional({
    example: 'https://www.newclinic.com',
    description: 'New clinic website URL',
  })
  @IsOptional()
  @IsUrl({}, { message: 'Website must be a valid URL' })
  website?: string;

  @ApiPropertyOptional({
    example: 'Mon-Fri 9AM-7PM, Sat 10AM-3PM',
    description: 'New clinic operating hours',
  })
  @IsOptional()
  @IsString({ message: 'Operating hours must be a string' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  operatingHours?: string;

  @ApiPropertyOptional({
    example: 'ACTIVE',
    description: 'New clinic status',
  })
  @IsOptional()
  @IsEnum(ClinicStatus, { message: 'Status must be a valid clinic status' })
  status?: ClinicStatus;

  @ApiPropertyOptional({
    description: 'Clinic description',
    example: 'A comprehensive healthcare facility providing quality medical services',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'Clinic logo URL',
    example: 'https://clinic.com/logo.png',
  })
  @IsOptional()
  @IsString()
  @IsUrl()
  logo?: string;

  @ApiPropertyOptional({
    description: 'Clinic timezone',
    example: 'Asia/Kolkata',
  })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({
    description: 'Clinic currency',
    example: 'INR',
  })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({
    description: 'Clinic language',
    example: 'en',
  })
  @IsOptional()
  @IsString()
  language?: string;

  @ApiPropertyOptional({
    description: 'Clinic settings as JSON object',
    example: { theme: 'dark', notifications: true },
  })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Communication configuration (Email, WhatsApp, SMS credentials)',
    example: {
      email: {
        primary: {
          provider: 'zeptomail',
          enabled: true,
          credentials: {
            sendMailToken: 'token_here',
            fromEmail: 'noreply@clinic.com',
            fromName: 'Clinic Name',
          },
        },
      },
    },
  })
  @IsOptional()
  @IsObject()
  communicationConfig?: {
    email?: {
      primary?: {
        provider?: string;
        enabled?: boolean;
        credentials?: Record<string, string>;
        priority?: number;
      };
      fallback?: Array<{
        provider?: string;
        enabled?: boolean;
        credentials?: Record<string, string>;
        priority?: number;
      }>;
      defaultFrom?: string;
      defaultFromName?: string;
    };
    whatsapp?: {
      primary?: {
        provider?: string;
        enabled?: boolean;
        credentials?: Record<string, string>;
        priority?: number;
      };
      fallback?: Array<{
        provider?: string;
        enabled?: boolean;
        credentials?: Record<string, string>;
        priority?: number;
      }>;
      defaultNumber?: string;
    };
    sms?: {
      primary?: {
        provider?: string;
        enabled?: boolean;
        credentials?: Record<string, string>;
        priority?: number;
      };
      fallback?: Array<{
        provider?: string;
        enabled?: boolean;
        credentials?: Record<string, string>;
        priority?: number;
      }>;
      defaultNumber?: string;
    };
  };
}

/**
 * Data Transfer Object for clinic responses
 * @class ClinicResponseDto
 * @description Contains clinic data for API responses, excluding sensitive information
 * @example
 * ```typescript
 * const response = new ClinicResponseDto();
 * response.id = "clinic-uuid-123";
 * response.name = "Main Street Medical Center";
 * response.status = ClinicStatus.ACTIVE;
 * ```
 */
export class ClinicResponseDto {
  @ApiProperty({
    example: 'clinic-uuid-123',
    description: 'Unique clinic identifier',
  })
  @IsUUID('4', { message: 'Clinic ID must be a valid UUID' })
  id!: string;

  @ApiProperty({
    example: 'Main Street Medical Center',
    description: 'Clinic name',
  })
  @IsString({ message: 'Clinic name must be a string' })
  name!: string;

  @ApiProperty({
    example: 'GENERAL',
    description: 'Type of clinic',
    enum: ClinicType,
    enumName: 'ClinicType',
  })
  @IsEnum(ClinicType, { message: 'Clinic type must be a valid type' })
  type!: ClinicType;

  @ApiProperty({
    example: '123 Main Street',
    description: 'Clinic address',
  })
  @IsString({ message: 'Address must be a string' })
  address!: string;

  @ApiProperty({
    example: 'New York',
    description: 'Clinic city',
  })
  @IsString({ message: 'City must be a string' })
  city!: string;

  @ApiProperty({
    example: 'NY',
    description: 'Clinic state/province',
  })
  @IsString({ message: 'State must be a string' })
  state!: string;

  @ApiProperty({
    example: 'USA',
    description: 'Clinic country',
  })
  @IsString({ message: 'Country must be a string' })
  country!: string;

  @ApiProperty({
    example: '10001',
    description: 'Clinic zip/postal code',
  })
  @IsString({ message: 'Zip code must be a string' })
  zipCode!: string;

  @ApiProperty({
    example: '+1234567890',
    description: 'Clinic phone number',
  })
  @IsString({ message: 'Phone number must be a string' })
  phone!: string;

  @ApiProperty({
    example: 'info@mainstreetmedical.com',
    description: 'Clinic email address',
  })
  @IsString({ message: 'Email must be a string' })
  email!: string;

  @ApiPropertyOptional({
    example: 'https://www.mainstreetmedical.com',
    description: 'Clinic website URL',
  })
  @IsOptional()
  @IsString({ message: 'Website must be a string' })
  website?: string;

  @ApiPropertyOptional({
    example: 'Mon-Fri 8AM-6PM, Sat 9AM-2PM',
    description: 'Clinic operating hours',
  })
  @IsOptional()
  @IsString({ message: 'Operating hours must be a string' })
  operatingHours?: string;

  @ApiProperty({
    example: 'ACTIVE',
    description: 'Current clinic status',
    enum: ClinicStatus,
    enumName: 'ClinicStatus',
  })
  @IsEnum(ClinicStatus, { message: 'Status must be a valid clinic status' })
  status!: ClinicStatus;

  @ApiProperty({
    example: '2024-01-01T00:00:00.000Z',
    description: 'Clinic creation timestamp',
  })
  @IsString({ message: 'Created at must be a string' })
  createdAt!: string;

  @ApiProperty({
    example: '2024-01-01T00:00:00.000Z',
    description: 'Clinic last update timestamp',
  })
  @IsString({ message: 'Updated at must be a string' })
  updatedAt!: string;

  @ApiPropertyOptional({
    example: 'healthcare',
    description: 'Application domain for multi-domain setup',
  })
  @IsOptional()
  @IsString({ message: 'App domain must be a string' })
  appDomain?: string;
}

/**
 * Data Transfer Object for clinic search and filtering
 * @class ClinicSearchDto
 * @description Contains optional fields for searching and filtering clinics
 * @example
 * ```typescript
 * const search = new ClinicSearchDto();
 * search.search = "medical";
 * search.type = ClinicType.GENERAL;
 * search.status = ClinicStatus.ACTIVE;
 * ```
 */
export class ClinicSearchDto {
  @ApiPropertyOptional({
    example: 'medical',
    description: 'Search by clinic name',
  })
  @IsOptional()
  @IsString({ message: 'Search term must be a string' })
  search?: string;

  @ApiPropertyOptional({
    example: 'GENERAL',
    description: 'Filter by clinic type',
    enum: ClinicType,
    enumName: 'ClinicType',
  })
  @IsOptional()
  @IsEnum(ClinicType, { message: 'Clinic type must be a valid type' })
  type?: ClinicType;

  @ApiPropertyOptional({
    example: 'ACTIVE',
    description: 'Filter by clinic status',
    enum: ClinicStatus,
    enumName: 'ClinicStatus',
  })
  @IsOptional()
  @IsEnum(ClinicStatus, { message: 'Status must be a valid clinic status' })
  status?: ClinicStatus;

  @ApiPropertyOptional({
    example: 'New York',
    description: 'Filter by city',
  })
  @IsOptional()
  @IsString({ message: 'City must be a string' })
  city?: string;

  @ApiPropertyOptional({
    example: 'NY',
    description: 'Filter by state',
  })
  @IsOptional()
  @IsString({ message: 'State must be a string' })
  state?: string;

  @ApiPropertyOptional({
    example: 'healthcare',
    description: 'Filter by application domain',
    enum: ['healthcare', 'clinic'],
  })
  @IsOptional()
  @IsString({ message: 'App domain must be a string' })
  appDomain?: string;
}

/**
 * Data Transfer Object for paginated clinic list responses
 * @class ClinicListResponseDto
 * @description Contains array of clinics and pagination metadata
 * @example
 * ```typescript
 * const list = new ClinicListResponseDto();
 * list.clinics = [clinic1, clinic2];
 * list.total = 100;
 * list.page = 1;
 * ```
 */
export class ClinicListResponseDto {
  @ApiProperty({
    description: 'List of clinics',
    type: [ClinicResponseDto],
  })
  @ValidateNested({ each: true })
  @Type(() => ClinicResponseDto)
  clinics!: ClinicResponseDto[];

  @ApiProperty({
    description: 'Total number of clinics',
  })
  @IsNumber({}, { message: 'Total must be a number' })
  total!: number;

  @ApiProperty({
    description: 'Current page number',
  })
  @IsNumber({}, { message: 'Page must be a number' })
  page!: number;

  @ApiProperty({
    description: 'Items per page',
  })
  @IsNumber({}, { message: 'Limit must be a number' })
  limit!: number;
}

// Additional Clinic DTOs (from services/clinic/dto/)
export class AssignClinicAdminDto {
  @ApiProperty({
    description: 'The ID of the user to assign as clinic admin',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  userId!: string;

  @ApiProperty({ description: 'Clinic ID to assign the admin to' })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  clinicId!: string;

  @ApiProperty({
    description: 'Whether this user is the owner',
    required: false,
  })
  isOwner?: boolean;
}

export class RegisterPatientDto {
  @ApiProperty({
    description: 'The app name of the clinic to register the patient to',
    example: 'cityhealthclinic',
  })
  @IsString()
  @IsNotEmpty()
  appName!: string;
}

// Extended Clinic Response DTO (from services/clinic/dto/clinic-response.dto.ts)
export class ClinicResponseDtoExtended {
  @ApiProperty({ description: 'Clinic ID' })
  id!: string;

  @ApiProperty({ description: 'Clinic name' })
  name!: string;

  @ApiProperty({ description: 'Clinic address' })
  address!: string;

  @ApiProperty({ description: 'Clinic phone number' })
  phone!: string;

  @ApiProperty({ description: 'Clinic email' })
  email!: string;

  @ApiProperty({ description: 'Clinic subdomain' })
  subdomain!: string;

  @ApiProperty({ description: 'Clinic app name' })
  app_name!: string;

  @ApiProperty({ description: 'Clinic logo URL', required: false })
  logo?: string;

  @ApiProperty({ description: 'Clinic website', required: false })
  website?: string;

  @ApiProperty({ description: 'Clinic description', required: false })
  description?: string;

  @ApiProperty({ description: 'Clinic timezone' })
  timezone!: string;

  @ApiProperty({ description: 'Clinic currency' })
  currency!: string;

  @ApiProperty({ description: 'Clinic language' })
  language!: string;

  @ApiProperty({ description: 'Whether clinic is active' })
  isActive!: boolean;

  @ApiProperty({ description: 'Clinic admins', type: [Object] })
  admins!: unknown[];

  @ApiProperty({ description: 'Created at timestamp' })
  createdAt!: Date;

  @ApiProperty({ description: 'Updated at timestamp' })
  updatedAt!: Date;
}

export class AppNameInlineDto {
  @ApiProperty({ description: 'App name (subdomain)', example: 'myclinic' })
  appName!: string;
}

/**
 * Data Transfer Object for clinic statistics
 */
export class ClinicStatsResponseDto {
  @ApiProperty({ example: 150 })
  totalUsers!: number;

  @ApiProperty({ example: 2 })
  totalLocations!: number;

  @ApiProperty({ example: 1250 })
  totalAppointments!: number;

  @ApiProperty({ example: 45 })
  activeDoctors!: number;

  @ApiProperty({ example: 500 })
  activePatients!: number;

  @ApiProperty({ example: 1250 })
  totalEhrRecords!: number;

  @ApiProperty({ example: 5 })
  lowStockAlerts!: number;

  @ApiProperty({ example: 12 })
  todayAppointments!: number;

  @ApiProperty({ example: 25000.5 })
  revenue!: number;
}

/**
 * Data Transfer Object for clinic operating hours
 */
export class ClinicOperatingHoursResponseDto {
  @ApiProperty({ example: 'Main Location' })
  locationName!: string;

  @ApiProperty({ example: 'uuid-123' })
  locationId!: string;

  @ApiProperty({
    example: {
      monday: { start: '09:00', end: '17:00' },
      tuesday: { start: '09:00', end: '17:00' },
    },
  })
  workingHours!: string | Record<string, { start: string; end: string }>;
}
