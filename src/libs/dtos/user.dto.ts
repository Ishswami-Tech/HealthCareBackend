import { ApiProperty } from "@nestjs/swagger";
import { Role, Gender } from '@prisma/client';
import { IsEmail, IsString, IsInt, IsOptional, IsEnum, IsDate, IsBoolean } from 'class-validator';

// Base interface with required fields matching schema
interface BaseUserFields {
  email: string;
  password: string;
  name: string;
  age: number;
  firstName: string;
  lastName: string;
  phone: string;
  role?: Role;
  profilePicture?: string;
  gender?: Gender;
  dateOfBirth?: Date;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  zipCode?: string;
  lastLogin?: Date;
}

// For create operations - same as base
type CreateUserFields = BaseUserFields;

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

  @IsDate()
  @IsOptional()
  dateOfBirth?: Date;

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

  @IsDate()
  @IsOptional()
  dateOfBirth?: Date;

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

  @ApiProperty({ required: false })
  dateOfBirth?: Date;

  @ApiProperty()
  isVerified: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
