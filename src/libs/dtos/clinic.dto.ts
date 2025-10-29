import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
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
} from "class-validator";
import { Transform, Type } from "class-transformer";

/**
 * Clinic status enumeration
 * @enum {string} ClinicStatus
 * @description Defines the operational status of a clinic
 * @example ClinicStatus.ACTIVE
 */
export enum ClinicStatus {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
  SUSPENDED = "SUSPENDED",
  MAINTENANCE = "MAINTENANCE",
}

/**
 * Clinic type enumeration
 * @enum {string} ClinicType
 * @description Defines the different types of healthcare clinics
 * @example ClinicType.GENERAL
 */
export enum ClinicType {
  GENERAL = "GENERAL",
  SPECIALTY = "SPECIALTY",
  EMERGENCY = "EMERGENCY",
  URGENT_CARE = "URGENT_CARE",
  DIAGNOSTIC = "DIAGNOSTIC",
  SURGICAL = "SURGERY",
}

/**
 * Data Transfer Object for creating new clinics
 * @class CreateClinicDto
 * @description Contains all required fields for clinic creation with validation
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
    example: "Main Street Medical Center",
    description: "Clinic name",
    minLength: 2,
    maxLength: 100,
  })
  @IsString({ message: "Clinic name must be a string" })
  @IsNotEmpty({ message: "Clinic name is required" })
  @Min(2, { message: "Clinic name must be at least 2 characters long" })
  @Max(100, { message: "Clinic name cannot exceed 100 characters" })
  @Transform(({ value }): string =>
    typeof value === "string" ? value.trim() : (value as string),
  )
  name!: string;

  @ApiProperty({
    example: "GENERAL",
    description: "Type of clinic",
    enum: ClinicType,
  })
  @IsEnum(ClinicType, { message: "Clinic type must be a valid type" })
  @IsNotEmpty({ message: "Clinic type is required" })
  type!: ClinicType;

  @ApiProperty({
    example: "123 Main Street",
    description: "Clinic address",
    minLength: 5,
    maxLength: 200,
  })
  @IsString({ message: "Address must be a string" })
  @IsNotEmpty({ message: "Address is required" })
  @Min(5, { message: "Address must be at least 5 characters long" })
  @Max(200, { message: "Address cannot exceed 200 characters" })
  @Transform(({ value }): string =>
    typeof value === "string" ? value.trim() : (value as string),
  )
  address!: string;

  @ApiProperty({
    example: "New York",
    description: "Clinic city",
    minLength: 2,
    maxLength: 50,
  })
  @IsString({ message: "City must be a string" })
  @IsNotEmpty({ message: "City is required" })
  @Min(2, { message: "City must be at least 2 characters long" })
  @Max(50, { message: "City cannot exceed 50 characters" })
  @Transform(({ value }): string =>
    typeof value === "string" ? value.trim() : (value as string),
  )
  city!: string;

  @ApiProperty({
    example: "NY",
    description: "Clinic state/province",
    minLength: 2,
    maxLength: 50,
  })
  @IsString({ message: "State must be a string" })
  @IsNotEmpty({ message: "State is required" })
  @Min(2, { message: "State must be at least 2 characters long" })
  @Max(50, { message: "State cannot exceed 50 characters" })
  @Transform(({ value }): string =>
    typeof value === "string" ? value.trim() : (value as string),
  )
  state!: string;

  @ApiProperty({
    example: "USA",
    description: "Clinic country",
    minLength: 2,
    maxLength: 50,
  })
  @IsString({ message: "Country must be a string" })
  @IsNotEmpty({ message: "Country is required" })
  @Min(2, { message: "Country must be at least 2 characters long" })
  @Max(50, { message: "Country cannot exceed 50 characters" })
  @Transform(({ value }): string =>
    typeof value === "string" ? value.trim() : (value as string),
  )
  country!: string;

  @ApiProperty({
    example: "10001",
    description: "Clinic zip/postal code",
    minLength: 3,
    maxLength: 20,
  })
  @IsString({ message: "Zip code must be a string" })
  @IsNotEmpty({ message: "Zip code is required" })
  @Min(3, { message: "Zip code must be at least 3 characters long" })
  @Max(20, { message: "Zip code cannot exceed 20 characters" })
  @Transform(({ value }): string =>
    typeof value === "string" ? value.trim() : (value as string),
  )
  zipCode!: string;

  @ApiProperty({
    example: "+1234567890",
    description: "Clinic phone number",
    pattern: "^\\+?[1-9]\\d{1,14}$",
  })
  @IsString({ message: "Phone number must be a string" })
  @IsNotEmpty({ message: "Phone number is required" })
  phone!: string;

  @ApiProperty({
    example: "info@mainstreetmedical.com",
    description: "Clinic email address",
    format: "email",
  })
  @IsString({ message: "Email must be a string" })
  @IsNotEmpty({ message: "Email is required" })
  @Transform(({ value }): string =>
    typeof value === "string" ? value.toLowerCase().trim() : (value as string),
  )
  email!: string;

  @ApiPropertyOptional({
    example: "https://www.mainstreetmedical.com",
    description: "Clinic website URL",
  })
  @IsOptional()
  @IsUrl({}, { message: "Website must be a valid URL" })
  website?: string;

  @IsString({ message: "Operating hours must be a string" })
  @Transform(({ value }): string =>
    typeof value === "string" ? value.trim() : (value as string),
  )
  operatingHours?: string;

  @ApiPropertyOptional({
    example: "healthcare",
    description: "Application domain for multi-domain setup",
    enum: ["healthcare", "clinic"],
  })
  @IsOptional()
  @IsString({ message: "App domain must be a string" })
  appDomain?: string;
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
    example: "Updated Clinic Name",
    description: "New clinic name",
  })
  @IsOptional()
  @IsString({ message: "Clinic name must be a string" })
  @Min(2, { message: "Clinic name must be at least 2 characters long" })
  @Max(100, { message: "Clinic name cannot exceed 100 characters" })
  @Transform(({ value }): string =>
    typeof value === "string" ? value.trim() : (value as string),
  )
  name?: string;

  @ApiPropertyOptional({
    example: "SPECIALTY",
    description: "New clinic type",
  })
  @IsOptional()
  @IsEnum(ClinicType, { message: "Clinic type must be a valid type" })
  type?: ClinicType;

  @ApiPropertyOptional({
    example: "456 New Street",
    description: "New clinic address",
  })
  @IsOptional()
  @IsString({ message: "Address must be a string" })
  @Min(5, { message: "Address must be at least 5 characters long" })
  @Max(200, { message: "Address cannot exceed 200 characters" })
  @Transform(({ value }): string =>
    typeof value === "string" ? value.trim() : (value as string),
  )
  address?: string;

  @ApiPropertyOptional({
    example: "Los Angeles",
    description: "New clinic city",
  })
  @IsOptional()
  @IsString({ message: "City must be a string" })
  @Min(2, { message: "City must be at least 2 characters long" })
  @Max(50, { message: "City cannot exceed 50 characters" })
  @Transform(({ value }): string =>
    typeof value === "string" ? value.trim() : (value as string),
  )
  city?: string;

  @ApiPropertyOptional({
    example: "CA",
    description: "New clinic state/province",
  })
  @IsOptional()
  @IsString({ message: "State must be a string" })
  @Min(2, { message: "State must be at least 2 characters long" })
  @Max(50, { message: "State cannot exceed 50 characters" })
  @Transform(({ value }): string =>
    typeof value === "string" ? value.trim() : (value as string),
  )
  state?: string;

  @ApiPropertyOptional({
    example: "USA",
    description: "New clinic country",
  })
  @IsOptional()
  @IsString({ message: "Country must be a string" })
  @Min(2, { message: "Country must be at least 2 characters long" })
  @Max(50, { message: "Country cannot exceed 50 characters" })
  @Transform(({ value }): string =>
    typeof value === "string" ? value.trim() : (value as string),
  )
  country?: string;

  @ApiPropertyOptional({
    example: "90210",
    description: "New clinic zip/postal code",
  })
  @IsOptional()
  @IsString({ message: "Zip code must be a string" })
  @Min(3, { message: "Zip code must be at least 3 characters long" })
  @Max(20, { message: "Zip code cannot exceed 20 characters" })
  @Transform(({ value }): string =>
    typeof value === "string" ? value.trim() : (value as string),
  )
  zipCode?: string;

  @ApiPropertyOptional({
    example: "+1987654321",
    description: "New clinic phone number",
  })
  @IsOptional()
  @IsString({ message: "Phone number must be a string" })
  phone?: string;

  @ApiPropertyOptional({
    example: "newemail@clinic.com",
    description: "New clinic email address",
  })
  @IsOptional()
  @IsString({ message: "Email must be a string" })
  @Transform(({ value }): string =>
    typeof value === "string" ? value.toLowerCase().trim() : (value as string),
  )
  email?: string;

  @ApiPropertyOptional({
    example: "https://www.newclinic.com",
    description: "New clinic website URL",
  })
  @IsOptional()
  @IsUrl({}, { message: "Website must be a valid URL" })
  website?: string;

  @ApiPropertyOptional({
    example: "Mon-Fri 9AM-7PM, Sat 10AM-3PM",
    description: "New clinic operating hours",
  })
  @IsOptional()
  @IsString({ message: "Operating hours must be a string" })
  @Transform(({ value }): string =>
    typeof value === "string" ? value.trim() : (value as string),
  )
  operatingHours?: string;

  @ApiPropertyOptional({
    example: "ACTIVE",
    description: "New clinic status",
  })
  @IsOptional()
  @IsEnum(ClinicStatus, { message: "Status must be a valid clinic status" })
  status?: ClinicStatus;
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
    example: "clinic-uuid-123",
    description: "Unique clinic identifier",
  })
  @IsUUID("4", { message: "Clinic ID must be a valid UUID" })
  id!: string;

  @ApiProperty({
    example: "Main Street Medical Center",
    description: "Clinic name",
  })
  @IsString({ message: "Clinic name must be a string" })
  name!: string;

  @ApiProperty({
    example: "GENERAL",
    description: "Type of clinic",
  })
  @IsEnum(ClinicType, { message: "Clinic type must be a valid type" })
  type!: ClinicType;

  @ApiProperty({
    example: "123 Main Street",
    description: "Clinic address",
  })
  @IsString({ message: "Address must be a string" })
  address!: string;

  @ApiProperty({
    example: "New York",
    description: "Clinic city",
  })
  @IsString({ message: "City must be a string" })
  city!: string;

  @ApiProperty({
    example: "NY",
    description: "Clinic state/province",
  })
  @IsString({ message: "State must be a string" })
  state!: string;

  @ApiProperty({
    example: "USA",
    description: "Clinic country",
  })
  @IsString({ message: "Country must be a string" })
  country!: string;

  @ApiProperty({
    example: "10001",
    description: "Clinic zip/postal code",
  })
  @IsString({ message: "Zip code must be a string" })
  zipCode!: string;

  @ApiProperty({
    example: "+1234567890",
    description: "Clinic phone number",
  })
  @IsString({ message: "Phone number must be a string" })
  phone!: string;

  @ApiProperty({
    example: "info@mainstreetmedical.com",
    description: "Clinic email address",
  })
  @IsString({ message: "Email must be a string" })
  email!: string;

  @ApiPropertyOptional({
    example: "https://www.mainstreetmedical.com",
    description: "Clinic website URL",
  })
  @IsOptional()
  @IsString({ message: "Website must be a string" })
  website?: string;

  @ApiPropertyOptional({
    example: "Mon-Fri 8AM-6PM, Sat 9AM-2PM",
    description: "Clinic operating hours",
  })
  @IsOptional()
  @IsString({ message: "Operating hours must be a string" })
  operatingHours?: string;

  @ApiProperty({
    example: "ACTIVE",
    description: "Current clinic status",
  })
  @IsEnum(ClinicStatus, { message: "Status must be a valid clinic status" })
  status!: ClinicStatus;

  @ApiProperty({
    example: "2024-01-01T00:00:00.000Z",
    description: "Clinic creation timestamp",
  })
  @IsString({ message: "Created at must be a string" })
  createdAt!: string;

  @ApiProperty({
    example: "2024-01-01T00:00:00.000Z",
    description: "Clinic last update timestamp",
  })
  @IsString({ message: "Updated at must be a string" })
  updatedAt!: string;

  @ApiPropertyOptional({
    example: "healthcare",
    description: "Application domain for multi-domain setup",
  })
  @IsOptional()
  @IsString({ message: "App domain must be a string" })
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
    example: "medical",
    description: "Search by clinic name",
  })
  @IsOptional()
  @IsString({ message: "Search term must be a string" })
  search?: string;

  @ApiPropertyOptional({
    example: "GENERAL",
    description: "Filter by clinic type",
    enum: ClinicType,
  })
  @IsOptional()
  @IsEnum(ClinicType, { message: "Clinic type must be a valid type" })
  type?: ClinicType;

  @ApiPropertyOptional({
    example: "ACTIVE",
    description: "Filter by clinic status",
    enum: ClinicStatus,
  })
  @IsOptional()
  @IsEnum(ClinicStatus, { message: "Status must be a valid clinic status" })
  status?: ClinicStatus;

  @ApiPropertyOptional({
    example: "New York",
    description: "Filter by city",
  })
  @IsOptional()
  @IsString({ message: "City must be a string" })
  city?: string;

  @ApiPropertyOptional({
    example: "NY",
    description: "Filter by state",
  })
  @IsOptional()
  @IsString({ message: "State must be a string" })
  state?: string;

  @ApiPropertyOptional({
    example: "healthcare",
    description: "Filter by application domain",
    enum: ["healthcare", "clinic"],
  })
  @IsOptional()
  @IsString({ message: "App domain must be a string" })
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
    description: "List of clinics",
    type: [ClinicResponseDto],
  })
  @ValidateNested({ each: true })
  @Type(() => ClinicResponseDto)
  clinics!: ClinicResponseDto[];

  @ApiProperty({
    description: "Total number of clinics",
  })
  @IsNumber({}, { message: "Total must be a number" })
  total!: number;

  @ApiProperty({
    description: "Current page number",
  })
  @IsNumber({}, { message: "Page must be a number" })
  page!: number;

  @ApiProperty({
    description: "Items per page",
  })
  @IsNumber({}, { message: "Limit must be a number" })
  limit!: number;
}
