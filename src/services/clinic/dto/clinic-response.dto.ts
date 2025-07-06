import { ApiProperty } from '@nestjs/swagger';

export class ClinicResponseDto {
  @ApiProperty({ description: 'Clinic ID' })
  id: string;

  @ApiProperty({ description: 'Clinic name' })
  name: string;

  @ApiProperty({ description: 'Clinic address' })
  address: string;

  @ApiProperty({ description: 'Clinic phone number' })
  phone: string;

  @ApiProperty({ description: 'Clinic email' })
  email: string;

  @ApiProperty({ description: 'Clinic subdomain' })
  subdomain: string;

  @ApiProperty({ description: 'Clinic app name' })
  app_name: string;

  @ApiProperty({ description: 'Clinic logo URL', required: false })
  logo?: string;

  @ApiProperty({ description: 'Clinic website', required: false })
  website?: string;

  @ApiProperty({ description: 'Clinic description', required: false })
  description?: string;

  @ApiProperty({ description: 'Clinic timezone' })
  timezone: string;

  @ApiProperty({ description: 'Clinic currency' })
  currency: string;

  @ApiProperty({ description: 'Clinic language' })
  language: string;

  @ApiProperty({ description: 'Whether clinic is active' })
  isActive: boolean;

  @ApiProperty({ description: 'Clinic admins', type: [Object] })
  admins: any[];

  @ApiProperty({ description: 'Created at timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Updated at timestamp' })
  updatedAt: Date;
}

export class ClinicListResponseDto {
  @ApiProperty({ description: 'List of clinics', type: [ClinicResponseDto] })
  clinics: ClinicResponseDto[];

  @ApiProperty({ description: 'Total count of clinics' })
  total: number;

  @ApiProperty({ description: 'Current page number' })
  page: number;

  @ApiProperty({ description: 'Number of items per page' })
  limit: number;

  @ApiProperty({ description: 'Total number of pages' })
  totalPages: number;
}

export class AppNameInlineDto {
  @ApiProperty({ description: 'App name (subdomain)', example: 'myclinic' })
  appName: string;
} 