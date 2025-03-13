import { ApiProperty } from "@nestjs/swagger";
import { Role, Gender } from '@prisma/client';
import { IsEmail, IsString, IsInt, IsOptional, IsEnum, IsDate, IsBoolean, IsUUID } from 'class-validator';

// Base interface with required fields matching schema
interface BaseUserFields {
  email: string;
  password: string;
  name: string;
  age?: number;
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

export class CreateUserDto implements CreateUserFields {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;

  @IsString()
  name!: string;

  @IsInt()
  age!: number;

  @IsString()
  firstName!: string;

  @IsString()
  lastName!: string;

  @IsString()
  phone!: string;

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
  name?: string;

  @IsInt()
  @IsOptional()
  age?: number;

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
  name: string;

  @ApiProperty()
  age: number;

  @ApiProperty()
  firstName: string;

  @ApiProperty()
  lastName: string;

  @ApiProperty()
  phone: string;

  @ApiProperty({ enum: Role })
  role: Role;

  @ApiProperty({ required: false })
  profilePicture?: string;

  @ApiProperty({ enum: Gender, required: false })
  gender?: Gender;

  @ApiProperty({ 
    required: false,
    description: 'Date of birth in ISO format (YYYY-MM-DD)',
    example: '1990-01-01'
  })
  dateOfBirth?: string;

  @ApiProperty()
  isVerified: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
