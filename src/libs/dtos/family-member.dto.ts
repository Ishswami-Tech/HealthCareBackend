/**
 * Family member (dependent) DTOs
 * @module FamilyMemberDTOs
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateFamilyMemberDto {
  @ApiProperty({ example: 'patient-uuid', description: 'Head-of-family Patient.id' })
  @IsString()
  primaryPatientId!: string;

  @ApiProperty({ example: 'Aarav' })
  @IsString()
  @MaxLength(100)
  firstName!: string;

  @ApiProperty({ example: 'Bhujbal' })
  @IsString()
  @MaxLength(100)
  lastName!: string;

  @ApiProperty({ example: 'Son' })
  @IsString()
  @MaxLength(50)
  relation!: string;

  @ApiPropertyOptional({ example: 'MALE' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  gender?: string;

  @ApiPropertyOptional({ example: '2018-04-12' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({
    example: '+919876543210',
    description: 'Contact number for this dependent (usually the head of family)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateFamilyMemberDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) firstName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) lastName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) relation?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) gender?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateOfBirth?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export interface FamilyMemberResponse {
  id: string;
  primaryPatientId: string;
  dependentPatientId: string | null;
  dependentUserId: string | null;
  firstName: string;
  lastName: string;
  name: string;
  relation: string;
  gender: string | null;
  dateOfBirth: string | null;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
