import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  IsInt,
  IsOptional,
  IsEnum,
  IsDate,
  IsBoolean,
  IsUUID,
  IsNumber,
  MinLength,
  IsArray,
  IsNotEmpty,
  IsDateString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PartialType, OmitType } from '@nestjs/mapped-types';
import { ValidateNested } from 'class-validator';
import { IsClinicId } from '@core/decorators/clinic-id.validator';

/**
 * Gender enumeration
 * @enum {string} Gender
 * @description Defines the gender options for users
 * @example Gender.MALE
 */
export enum Gender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  OTHER = 'OTHER',
}

// Import Role type from centralized types
import { Role } from '@core/types/enums.types';

/**
 * Base interface with required fields matching schema
 * Following SOLID principles from AI rules
 */
// interface BaseUserFields {
//   email: string;
//   password: string;
//   firstName: string;
//   lastName: string;
//   phone: string;
//   role?: Role;
//   profilePicture?: string;
//   gender?: Gender;
//   dateOfBirth?: string;
//   address?: string;
//   city?: string;
//   state?: string;
//   country?: string;
//   zipCode?: string;
//   lastLogin?: Date;
//   // Multi-tenant fields
//   primaryClinicId?: string;
//   primaryStudioId?: string;
//   appName?: string;
//   // Social login fields
//   googleId?: string;
//   facebookId?: string;
//   appleId?: string;
//   // Medical fields
//   medicalConditions?: string[];
//   emergencyContact?: string;
// }

// Role-specific fields
// interface RoleSpecificFields {
//   specialization?: string;
//   experience?: number;
//   clinicId?: string;
//   studioId?: string;
// }

// For create operations - same as base plus role-specific fields
// type CreateUserFields = BaseUserFields & RoleSpecificFields;

// For update operations - all fields optional
// type UpdateUserFields = Partial<BaseUserFields>;

/**
 * Data Transfer Object for simple user registration
 * @class SimpleCreateUserDto
 * @description Contains minimal required fields for user registration
 * @example
 * ```typescript
 * const user = new SimpleCreateUserDto();
 * user.email = "john.doe@example.com";
 * user.firstName = "John";
 * user.lastName = "Doe";
 * ```
 */
export class SimpleCreateUserDto {
  @ApiProperty({
    example: 'john.doe@example.com',
    description: 'User email address',
    format: 'email',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @Transform(({ value }): string =>
    typeof value === 'string' ? value.toLowerCase().trim() : (value as string)
  )
  email: string = '';

  @ApiProperty({
    example: 'SecurePassword123!',
    description:
      'User password (min 8 chars, must include uppercase, lowercase, number, special char)',
    minLength: 8,
  })
  @IsString({ message: 'Password must be a string' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/, {
    message:
      'Password must contain at least one uppercase letter, one lowercase letter, one number and one special character',
  })
  password: string = '';

  @ApiProperty({
    example: 'John',
    description: 'User first name',
    minLength: 2,
    maxLength: 50,
  })
  @IsString({ message: 'First name must be a string' })
  @IsNotEmpty({ message: 'First name is required' })
  @MinLength(2, { message: 'First name must be at least 2 characters long' })
  @MaxLength(50, { message: 'First name cannot exceed 50 characters' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  firstName: string = '';

  @ApiProperty({
    example: 'Doe',
    description: 'User last name',
    minLength: 2,
    maxLength: 50,
  })
  @IsString({ message: 'Last name must be a string' })
  @IsNotEmpty({ message: 'Last name is required' })
  @MinLength(2, { message: 'Last name must be at least 2 characters long' })
  @MaxLength(50, { message: 'Last name cannot exceed 50 characters' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  lastName: string = '';

  @ApiProperty({
    example: '+1234567890',
    description: 'User phone number (international format)',
    pattern: '^\\+?[1-9]\\d{1,14}$',
  })
  @IsString({ message: 'Phone number must be a string' })
  @IsNotEmpty({ message: 'Phone number is required' })
  @Matches(/^\+?[1-9]\d{1,14}$/, { message: 'Invalid phone number format' })
  phone: string = '';

  @ApiPropertyOptional({
    example: 'MALE',
    description: 'User gender',
    enum: Gender,
  })
  @IsEnum(Gender, { message: 'Gender must be one of: MALE, FEMALE, OTHER' })
  @IsOptional()
  gender?: Gender;

  @ApiPropertyOptional({
    example: 30,
    description: 'User age (calculated from date of birth)',
    minimum: 0,
    maximum: 150,
  })
  @IsOptional()
  @IsNumber({}, { message: 'Age must be a number' })
  @IsInt({ message: 'Age must be an integer' })
  age?: number;

  @ApiPropertyOptional({
    example: 'profile.jpg',
    description: 'User profile picture URL',
  })
  @IsOptional()
  @IsString({ message: 'Profile picture must be a string' })
  profilePicture?: string;

  @ApiPropertyOptional({
    example: '1990-01-01',
    description: 'User date of birth (YYYY-MM-DD format)',
    format: 'date',
  })
  @IsOptional()
  @IsDateString({}, { message: 'Date of birth must be a valid date string' })
  dateOfBirth?: string;

  @ApiPropertyOptional({
    example: '123 Main St',
    description: 'User address',
  })
  @IsOptional()
  @IsString({ message: 'Address must be a string' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  address?: string;

  @ApiPropertyOptional({
    example: 'New York',
    description: 'User city',
  })
  @IsOptional()
  @IsString({ message: 'City must be a string' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  city?: string;

  @ApiPropertyOptional({
    example: 'NY',
    description: 'User state/province',
  })
  @IsOptional()
  @IsString({ message: 'State must be a string' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  state?: string;

  @ApiPropertyOptional({
    example: 'USA',
    description: 'User country',
  })
  @IsOptional()
  @IsString({ message: 'Country must be a string' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  country?: string;

  @ApiPropertyOptional({
    example: '10001',
    description: 'User zip/postal code',
  })
  @IsOptional()
  @IsString({ message: 'Zip code must be a string' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  zipCode?: string;

  @ApiPropertyOptional({
    example: 'clinic-uuid-123',
    description: 'Primary clinic ID for multi-tenant context',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Primary clinic ID must be a valid UUID' })
  primaryClinicId?: string;

  @ApiPropertyOptional({
    example: 'studio-uuid-123',
    description: 'Primary studio ID for multi-tenant context',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Primary studio ID must be a valid UUID' })
  primaryStudioId?: string;
}

/**
 * Data Transfer Object for enhanced user creation
 * @class CreateUserDto
 * @description Extends SimpleCreateUserDto with additional user fields
 * @extends SimpleCreateUserDto
 * @example
 * ```typescript
 * const user = new CreateUserDto();
 * user.role = Role.DOCTOR;
 * user.specialization = "Cardiology";
 * user.experience = 5;
 * ```
 */
export class CreateUserDto extends SimpleCreateUserDto {
  @ApiPropertyOptional({
    example: 'DOCTOR',
    description: 'User role in the system',
    enum: Role,
  })
  @IsOptional()
  @IsEnum(Role, { message: 'Role must be a valid system role' })
  role?: Role;

  @ApiPropertyOptional({
    example: 'Cardiology',
    description: 'Professional specialization (for doctors/nurses)',
  })
  @IsOptional()
  @IsString({ message: 'Specialization must be a string' })
  specialization?: string;

  @ApiPropertyOptional({
    example: 5,
    description: 'Years of professional experience',
    minimum: 0,
  })
  @IsOptional()
  @IsNumber({}, { message: 'Experience must be a number' })
  @IsInt({ message: 'Experience must be an integer' })
  experience?: number;

  @ApiPropertyOptional({
    example: 'CL0001',
    description: 'Associated clinic ID (UUID or clinic code like CL0001)',
  })
  @IsOptional()
  @IsClinicId({ message: 'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001)' })
  clinicId?: string;

  @ApiPropertyOptional({
    example: 'location-uuid-123',
    description: 'Associated clinic location ID (required for staff roles)',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Location ID must be a valid UUID' })
  locationId?: string;

  @ApiPropertyOptional({
    example: 'studio-uuid-123',
    description: 'Associated studio ID',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Studio ID must be a valid UUID' })
  studioId?: string;

  @ApiPropertyOptional({
    example: ['diabetes', 'hypertension'],
    description: 'Medical conditions (for patients)',
    type: [String],
  })
  @IsOptional()
  @IsArray({ message: 'Medical conditions must be an array' })
  @IsString({ each: true, message: 'Each medical condition must be a string' })
  medicalConditions?: string[];

  @ApiPropertyOptional({
    example: '+1987654321',
    description: 'Emergency contact phone number',
  })
  @IsOptional()
  @IsString({ message: 'Emergency contact must be a string' })
  @Matches(/^\+?[1-9]\d{1,14}$/, {
    message: 'Invalid emergency contact phone number format',
  })
  emergencyContact?: string;

  @ApiPropertyOptional({
    example: 'google-oauth-id-123',
    description: 'Google OAuth ID for social login',
  })
  @IsOptional()
  @IsString({ message: 'Google ID must be a string' })
  googleId?: string;

  @ApiPropertyOptional({
    example: 'facebook-oauth-id-123',
    description: 'Facebook OAuth ID for social login',
  })
  @IsOptional()
  @IsString({ message: 'Facebook ID must be a string' })
  facebookId?: string;

  @ApiPropertyOptional({
    example: 'apple-oauth-id-123',
    description: 'Apple OAuth ID for social login',
  })
  @IsOptional()
  @IsString({ message: 'Apple ID must be a string' })
  appleId?: string;
}

/**
 * Data Transfer Object for updating user information
 * @class UpdateUserDto
 * @description Contains optional fields for user updates
 * @extends PartialType(CreateUserDto)
 * @example
 * ```typescript
 * const update = new UpdateUserDto();
 * update.firstName = "Updated Name";
 * update.lastLogin = new Date();
 * ```
 */
export class UpdateUserDto extends PartialType(CreateUserDto) {
  @ApiPropertyOptional({
    example: '2024-01-01T00:00:00.000Z',
    description: 'Last login timestamp',
  })
  @IsOptional()
  @IsDate({ message: 'Last login must be a valid date' })
  @Type(() => Date)
  lastLogin?: Date;
}

/**
 * Data Transfer Object for user responses
 * @class UserResponseDto
 * @description Contains user data for API responses, excluding sensitive information
 * @extends OmitType(CreateUserDto, ["password"])
 * @example
 * ```typescript
 * const response = new UserResponseDto();
 * response.id = "user-uuid-123";
 * response.email = "user@example.com";
 * response.isVerified = true;
 * ```
 */
export class UserResponseDto extends OmitType(CreateUserDto, ['password'] as const) {
  @ApiProperty({
    example: 'user-uuid-123',
    description: 'Unique user identifier',
  })
  @IsUUID('4', { message: 'User ID must be a valid UUID' })
  id!: string;

  @ApiProperty({
    example: '2024-01-01T00:00:00.000Z',
    description: 'User creation timestamp',
  })
  @IsDate({ message: 'Created at must be a valid date' })
  @Type(() => Date)
  createdAt!: Date;

  @ApiProperty({
    example: '2024-01-01T00:00:00.000Z',
    description: 'User last update timestamp',
  })
  @IsDate({ message: 'Updated at must be a valid date' })
  @Type(() => Date)
  updatedAt!: Date;

  @ApiProperty({
    example: true,
    description: 'Whether user email is verified',
  })
  @IsBoolean({ message: 'Is verified must be a boolean' })
  isVerified!: boolean;

  @ApiProperty({
    example: true,
    description: 'Whether user account is active',
  })
  @IsBoolean({ message: 'Is active must be a boolean' })
  isActive!: boolean;

  @ApiPropertyOptional({
    example: 'clinic-token-123',
    description: 'Clinic-specific token for multi-tenant access',
  })
  @IsOptional()
  @IsString({ message: 'Clinic token must be a string' })
  clinicToken?: string;
}

/**
 * Data Transfer Object for paginated user list responses
 * @class UserListResponseDto
 * @description Contains array of users and pagination metadata
 * @example
 * ```typescript
 * const list = new UserListResponseDto();
 * list.users = [user1, user2];
 * list.total = 100;
 * list.page = 1;
 * ```
 */
export class UserListResponseDto {
  @ApiProperty({
    description: 'List of users',
    type: [UserResponseDto],
  })
  @ValidateNested({ each: true })
  @Type(() => UserResponseDto)
  users!: UserResponseDto[];

  @ApiProperty({
    description: 'Total number of users',
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

/**
 * Data Transfer Object for user search and filtering
 * @class UserSearchDto
 * @description Contains optional fields for searching and filtering users
 * @example
 * ```typescript
 * const search = new UserSearchDto();
 * search.search = "john";
 * search.role = Role.DOCTOR;
 * search.isVerified = true;
 * ```
 */
export class UserSearchDto {
  @ApiPropertyOptional({
    example: 'john',
    description: 'Search by name (first or last)',
  })
  @IsOptional()
  @IsString({ message: 'Search term must be a string' })
  search?: string;

  @ApiPropertyOptional({
    example: 'DOCTOR',
    description: 'Filter by role',
    enum: Role,
  })
  @IsOptional()
  @IsEnum(Role, { message: 'Role must be a valid system role' })
  role?: Role;

  @ApiPropertyOptional({
    example: 'clinic-uuid-123',
    description: 'Filter by clinic ID',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Clinic ID must be a valid UUID' })
  clinicId?: string;

  @ApiPropertyOptional({
    example: 'studio-uuid-123',
    description: 'Filter by studio ID',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Studio ID must be a valid UUID' })
  studioId?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Filter by verification status',
  })
  @IsOptional()
  @IsBoolean({ message: 'Is verified must be a boolean' })
  isVerified?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: 'Filter by active status',
  })
  @IsOptional()
  @IsBoolean({ message: 'Is active must be a boolean' })
  isActive?: boolean;
}

/**
 * Data Transfer Object for user profile updates
 * @class UpdateUserProfileDto
 * @description Contains fields that users can update in their own profile
 * @example
 * ```typescript
 * const profile = new UpdateUserProfileDto();
 * profile.firstName = "Updated Name";
 * profile.phone = "+1234567890";
 * profile.address = "123 New Street";
 * ```
 */
export class UpdateUserProfileDto {
  @ApiPropertyOptional({
    example: 'John',
    description: 'User first name',
  })
  @IsOptional()
  @IsString({ message: 'First name must be a string' })
  @MinLength(2, { message: 'First name must be at least 2 characters long' })
  @MaxLength(50, { message: 'First name cannot exceed 50 characters' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  firstName?: string;

  @ApiPropertyOptional({
    example: 'Doe',
    description: 'User last name',
  })
  @IsOptional()
  @IsString({ message: 'Last name must be a string' })
  @MinLength(2, { message: 'Last name must be at least 2 characters long' })
  @MaxLength(50, { message: 'Last name cannot exceed 50 characters' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  lastName?: string;

  @ApiPropertyOptional({
    example: '+1234567890',
    description: 'User phone number',
  })
  @IsOptional()
  @IsString({ message: 'Phone number must be a string' })
  @Matches(/^\+?[1-9]\d{1,14}$/, { message: 'Invalid phone number format' })
  phone?: string;

  @ApiPropertyOptional({
    example: 'profile.jpg',
    description: 'User profile picture URL',
  })
  @IsOptional()
  @IsString({ message: 'Profile picture must be a string' })
  profilePicture?: string;

  @ApiPropertyOptional({
    example: 'MALE',
    description: 'User gender',
  })
  @IsOptional()
  @IsEnum(Gender, { message: 'Gender must be one of: MALE, FEMALE, OTHER' })
  gender?: Gender;

  @ApiPropertyOptional({
    example: '1990-01-01',
    description: 'User date of birth',
  })
  @IsOptional()
  @IsDateString({}, { message: 'Date of birth must be a valid date string' })
  dateOfBirth?: string;

  @ApiPropertyOptional({
    example: '123 Main St',
    description: 'User address',
  })
  @IsOptional()
  @IsString({ message: 'Address must be a string' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  address?: string;

  @ApiPropertyOptional({
    example: 'New York',
    description: 'User city',
  })
  @IsOptional()
  @IsString({ message: 'City must be a string' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  city?: string;

  @ApiPropertyOptional({
    example: 'NY',
    description: 'User state/province',
  })
  @IsOptional()
  @IsString({ message: 'State must be a string' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  state?: string;

  @ApiPropertyOptional({
    example: 'USA',
    description: 'User country',
  })
  @IsOptional()
  @IsString({ message: 'Country must be a string' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  country?: string;

  @ApiPropertyOptional({
    example: '10001',
    description: 'User zip/postal code',
  })
  @IsOptional()
  @IsString({ message: 'Zip code must be a string' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  zipCode?: string;

  @ApiPropertyOptional({
    example: '+1987654321',
    description: 'Emergency contact phone number',
  })
  @IsOptional()
  @IsString({ message: 'Emergency contact must be a string' })
  @Matches(/^\+?[1-9]\d{1,14}$/, {
    message: 'Invalid emergency contact phone number format',
  })
  emergencyContact?: string;
}

/**
 * Data Transfer Object for updating user roles (admin only)
 * @class UpdateUserRoleDto
 * @description Contains role and clinic context for role updates
 * @example
 * ```typescript
 * const role = new UpdateUserRoleDto();
 * role.role = Role.DOCTOR;
 * role.clinicId = "clinic-uuid-123";
 * ```
 */
export class UpdateUserRoleDto {
  @ApiProperty({
    enum: Role,
    example: Role.DOCTOR,
    description: 'New role to assign to the user',
  })
  @IsEnum(Role, { message: 'Role must be a valid role' })
  @IsNotEmpty({ message: 'Role is required' })
  role!: Role;

  @ApiPropertyOptional({
    example: 'clinic-id-123',
    description: 'Clinic ID for clinic-specific roles',
  })
  @IsOptional()
  @IsUUID(4, { message: 'Clinic ID must be a valid UUID' })
  clinicId?: string;

  @ApiPropertyOptional({
    example: 'location-id-123',
    description:
      'Clinic location ID for location-specific staff roles (required for all staff except patient)',
  })
  @IsOptional()
  @IsUUID(4, { message: 'Location ID must be a valid UUID' })
  locationId?: string;
}
