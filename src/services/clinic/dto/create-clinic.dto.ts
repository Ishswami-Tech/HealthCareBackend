import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsPhoneNumber, IsOptional, IsUrl, IsBoolean, IsEmail, Matches, ValidateNested, IsObject, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateClinicLocationDto } from './create-clinic-location.dto';

export class CreateClinicDto {
  @ApiProperty({
    description: 'The name of the clinic',
    example: 'Aadesh Ayurvedalay',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'The address of the clinic headquarters',
    example: '123 Main Street, Pune, Maharashtra',
  })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty({
    description: 'The phone number of the clinic',
    example: '+919876543210',
  })
  @IsString()
  @IsNotEmpty()
  @IsPhoneNumber()
  phone: string;

  @ApiProperty({
    description: 'The email of the clinic (will be used for app subdomain)',
    example: 'aadesh@ayurvedalay.com',
  })
  @IsString()
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @ApiProperty({
    description: 'The subdomain for the clinic app',
    example: 'aadesh',
    required: true,
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'Subdomain can only contain lowercase letters, numbers, and hyphens',
  })
  subdomain: string;

  @ApiProperty({
    description: 'The main location of the clinic',
    type: CreateClinicLocationDto,
    required: true,
  })
  @IsObject()
  @ValidateNested()
  @Type(() => CreateClinicLocationDto)
  mainLocation: CreateClinicLocationDto;

  @ApiProperty({
    description: 'Identifier of the Clinic Admin (required if Super Admin is creating the clinic). Can be email or ID.',
    example: 'admin@example.com',
    required: false,
  })
  @IsOptional()
  @IsString()
  clinicAdminIdentifier?: string;

  @ApiProperty({
    description: 'The database name for the clinic',
    example: 'clinic_aadesh_db',
    required: false,
  })
  @IsString()
  @IsOptional()
  @Matches(/^[a-z0-9_]+$/, {
    message: 'Database name can only contain lowercase letters, numbers, and underscores',
  })
  databaseName?: string;

  @ApiProperty({
    description: 'The logo URL of the clinic',
    example: 'https://ayurvedalay.com/logos/aadesh.png',
    required: false,
  })
  @IsString()
  @IsOptional()
  @IsUrl()
  logo?: string;

  @ApiProperty({
    description: 'The website of the clinic',
    example: 'https://aadesh.ayurvedalay.com',
    required: false,
  })
  @IsString()
  @IsOptional()
  @IsUrl()
  website?: string;

  @ApiProperty({
    description: 'The description of the clinic',
    example: 'A leading Ayurvedic clinic providing traditional treatments',
    required: false,
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({
    description: 'The timezone of the clinic',
    example: 'Asia/Kolkata',
    required: false,
  })
  @IsString()
  @IsOptional()
  timezone?: string;

  @ApiProperty({
    description: 'The currency used by the clinic',
    example: 'INR',
    required: false,
  })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiProperty({
    description: 'The language used by the clinic',
    example: 'en',
    required: false,
  })
  @IsString()
  @IsOptional()
  language?: string;

  @ApiProperty({
    description: 'Whether the clinic is active',
    example: true,
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
} 