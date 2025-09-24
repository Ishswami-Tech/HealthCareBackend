import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsString,
  IsOptional,
  IsEnum,
  IsUUID,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsNumber,
  Min,
  Max,
  IsBoolean,
  IsUrl,
  IsPhoneNumber,
} from "class-validator";
import { Transform, Type } from "class-transformer";

// Clinic status enum
export enum ClinicStatus {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
  SUSPENDED = "SUSPENDED",
  MAINTENANCE = "MAINTENANCE",
}

// Clinic type enum
export enum ClinicType {
  GENERAL = "GENERAL",
  SPECIALTY = "SPECIALTY",
  EMERGENCY = "EMERGENCY",
  URGENT_CARE = "URGENT_CARE",
  DIAGNOSTIC = "DIAGNOSTIC",
  SURGICAL = "SURGERY",
}

/**
 * Base clinic DTO following NestJS best practices
 * Based on AI rules: @nestjs-specific.md and @coding-standards.md
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
  @Transform(({ value }) => value?.trim())
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
  @Transform(({ value }) => value?.trim())
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
  @Transform(({ value }) => value?.trim())
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
  @Transform(({ value }) => value?.trim())
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
  @Transform(({ value }) => value?.trim())
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
  @Transform(({ value }) => value?.trim())
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
  @Transform(({ value }) => value?.toLowerCase().trim())
  email!: string;

  @ApiPropertyOptional({
    example: "https://www.mainstreetmedical.com",
    description: "Clinic website URL",
  })
  @IsOptional()
  @IsUrl({}, { message: "Website must be a valid URL" })
  website?: string;

  @ApiPropertyOptional({
    example: "Mon-Fri 8AM-6PM, Sat 9AM-2PM",
    description: "Clinic operating hours",
  })
  @IsOptional()
  @IsString({ message: "Operating hours must be a string" })
  @Transform(({ value }) => value?.trim())
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
 * Clinic update DTO - all fields optional
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
  @Transform(({ value }) => value?.trim())
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
  @Transform(({ value }) => value?.trim())
  address?: string;

  @ApiPropertyOptional({
    example: "Los Angeles",
    description: "New clinic city",
  })
  @IsOptional()
  @IsString({ message: "City must be a string" })
  @Min(2, { message: "City must be at least 2 characters long" })
  @Max(50, { message: "City cannot exceed 50 characters" })
  @Transform(({ value }) => value?.trim())
  city?: string;

  @ApiPropertyOptional({
    example: "CA",
    description: "New clinic state/province",
  })
  @IsOptional()
  @IsString({ message: "State must be a string" })
  @Min(2, { message: "State must be at least 2 characters long" })
  @Max(50, { message: "State cannot exceed 50 characters" })
  @Transform(({ value }) => value?.trim())
  state?: string;

  @ApiPropertyOptional({
    example: "USA",
    description: "New clinic country",
  })
  @IsOptional()
  @IsString({ message: "Country must be a string" })
  @Min(2, { message: "Country must be at least 2 characters long" })
  @Max(50, { message: "Country cannot exceed 50 characters" })
  @Transform(({ value }) => value?.trim())
  country?: string;

  @ApiPropertyOptional({
    example: "90210",
    description: "New clinic zip/postal code",
  })
  @IsOptional()
  @IsString({ message: "Zip code must be a string" })
  @Min(3, { message: "Zip code must be at least 3 characters long" })
  @Max(20, { message: "Zip code cannot exceed 20 characters" })
  @Transform(({ value }) => value?.trim())
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
  @Transform(({ value }) => value?.toLowerCase().trim())
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
  @Transform(({ value }) => value?.trim())
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
 * Clinic response DTO - excludes sensitive information
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
 * Clinic search/filter DTO
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
 * Clinic list response DTO for pagination
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
