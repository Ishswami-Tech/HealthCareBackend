import { ApiProperty } from "@nestjs/swagger";
import { Role, Gender } from '@prisma/client';
import { IsEmail, IsString, IsInt, IsOptional, IsEnum, IsDate, IsBoolean, IsUUID, IsNumber, MinLength, IsArray, IsNotEmpty } from 'class-validator';

// Base interface with required fields matching schema
interface BaseUserFields {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  role?: Role;
  profilePicture?: string;
  gender?: Gender;
  dateOfBirth?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  zipCode?: string;
  lastLogin?: Date;
}

// Role-specific fields
interface RoleSpecificFields {
  specialization?: string;
  experience?: number;
  clinicId?: string;
}

// For create operations - same as base plus role-specific fields
type CreateUserFields = BaseUserFields & RoleSpecificFields;

// For update operations - all fields optional
type UpdateUserFields = Partial<BaseUserFields>;

// Simple registration DTO with minimal required fields
export class SimpleCreateUserDto {
  @ApiProperty({ example: 'john.doe@example.com', description: 'User email address' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123', description: 'User password' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'John', description: 'User first name' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Doe', description: 'User last name' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ example: '+1234567890', description: 'User phone number' })
  @IsString()
  phone: string;

  @ApiProperty({ example: 'MALE', description: 'User gender', enum: Gender, required: false })
  @IsEnum(Gender)
  @IsOptional()
  gender?: Gender;

  @ApiProperty({ example: 30, description: 'User age', required: false })
  @IsOptional()
  @IsNumber()
  age?: number;

  @ApiProperty({ example: 'profile.jpg', description: 'User profile picture URL', required: false })
  @IsOptional()
  @IsString()
  profilePicture?: string;

  @ApiProperty({ example: '1990-01-01', description: 'User date of birth', required: false })
  @IsOptional()
  @IsString()
  dateOfBirth?: string;

  @ApiProperty({ example: '123 Main St', description: 'User address', required: false })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ example: 'New York', description: 'User city', required: false })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiProperty({ example: 'NY', description: 'User state', required: false })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiProperty({ example: 'USA', description: 'User country', required: false })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiProperty({ example: '10001', description: 'User zip code', required: false })
  @IsOptional()
  @IsString()
  zipCode?: string;

  @ApiProperty({ example: ['allergies', 'diabetes'], description: 'User medical conditions', required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  medicalConditions?: string[];
}

export class CreateUserDto implements CreateUserFields {
  @ApiProperty({ example: 'john.doe@example.com', description: 'User email address' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123', description: 'User password' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'John', description: 'User first name' })
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @ApiProperty({ example: 'Doe', description: 'User last name' })
  @IsString()
  @IsNotEmpty()
  lastName: string;

  @ApiProperty({ example: 'MALE', description: 'User gender', enum: Gender, required: false })
  @IsEnum(Gender)
  @IsOptional()
  gender?: Gender;

  @ApiProperty({ example: 'PATIENT', description: 'User role', enum: Role })
  @IsEnum(Role)
  role: Role;

  @ApiProperty({ example: 30, description: 'User age', required: false })
  @IsOptional()
  @IsNumber()
  age?: number;

  @ApiProperty({ example: '+1234567890', description: 'User phone number' })
  @IsString()
  phone: string;

  @ApiProperty({ example: 'profile.jpg', description: 'User profile picture URL', required: false })
  @IsOptional()
  @IsString()
  profilePicture?: string;

  @ApiProperty({ example: '1990-01-01', description: 'User date of birth', required: false })
  @IsOptional()
  @IsString()
  dateOfBirth?: string;

  @ApiProperty({ example: '123 Main St', description: 'User address', required: false })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ example: 'New York', description: 'User city', required: false })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiProperty({ example: 'NY', description: 'User state', required: false })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiProperty({ example: 'USA', description: 'User country', required: false })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiProperty({ example: '10001', description: 'User zip code', required: false })
  @IsOptional()
  @IsString()
  zipCode?: string;

  @ApiProperty({ example: 'myapp', description: 'Application name for clinic registration', required: false })
  @IsOptional()
  @IsString()
  appName?: string;

  @ApiProperty({ example: true, description: 'Whether user is verified', required: false })
  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  @ApiProperty({ example: ['allergies', 'diabetes'], description: 'User medical conditions', required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  medicalConditions?: string[];

  @IsDate()
  @IsOptional()
  lastLogin?: Date;

  @IsString()
  @IsOptional()
  specialization?: string;

  @IsInt()
  @IsOptional()
  experience?: number;

  @IsUUID()
  @IsOptional()
  clinicId?: string;
}

export class UpdateUserDto implements UpdateUserFields {
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  password?: string;

  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEnum(Role)
  @IsOptional()
  role?: Role;

  @IsString()
  @IsOptional()
  profilePicture?: string;

  @IsEnum(Gender)
  @IsOptional()
  gender?: Gender;

  @ApiProperty({
    description: 'Date of birth in ISO format (YYYY-MM-DD)',
    example: '1990-01-01',
    required: false
  })
  @IsString()
  @IsOptional()
  dateOfBirth?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsOptional()
  country?: string;

  @IsString()
  @IsOptional()
  zipCode?: string;

  @IsDate()
  @IsOptional()
  lastLogin?: Date;
}

export class UserResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;

  @ApiProperty()
  role: Role;

  @ApiProperty()
  isVerified: boolean;

  @ApiProperty({ required: false })
  profilePicture?: string;

  @ApiProperty({ required: false })
  phone?: string;

  @ApiProperty({ required: false })
  address?: string;

  @ApiProperty({ required: false })
  city?: string;

  @ApiProperty({ required: false })
  state?: string;

  @ApiProperty({ required: false })
  country?: string;

  @ApiProperty({ required: false })
  zipCode?: string;

  @ApiProperty({ required: false })
  dateOfBirth?: Date;

  @ApiProperty({ required: false })
  age?: number;

  @ApiProperty({ required: false })
  gender?: string;

  @ApiProperty({ required: false })
  medicalConditions?: string[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ required: false })
  clinicToken?: string;

  @ApiProperty({ required: false })
  clinic?: {
    id: string;
    name: string;
    role?: string;
    locations?: any[];
  };
}
