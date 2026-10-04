/**
 * Family member (dependent) DTOs
 * @module FamilyMemberDTOs
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OmitType } from '@nestjs/mapped-types';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';

/** Gender values the mobile family sheet and the web OPD dialog send (app/components FamilyMemberSheet). */
export const FAMILY_MEMBER_GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;

/** An empty string is how the mobile edit sheet clears gender; the service stores null. */
const FAMILY_MEMBER_GENDER_INPUTS: readonly string[] = [...FAMILY_MEMBER_GENDERS, ''];

export const FAMILY_MEMBER_NOTES_MAX_LENGTH = 500;

const EARLIEST_BIRTH_DATE_MS = Date.parse('1900-01-01T00:00:00.000Z');
/** Date-only strings are parsed as UTC midnight; one day of slack covers timezones ahead of UTC. */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

/** Pure rule: not before 1900-01-01 and not in the future. */
export function isPlausibleBirthDate(value: unknown, nowMs: number = Date.now()): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    return false;
  }
  return time >= EARLIEST_BIRTH_DATE_MS && time <= nowMs + FUTURE_TOLERANCE_MS;
}

function IsPlausibleBirthDate(validationOptions?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyKey: string | symbol): void => {
    registerDecorator({
      name: 'isPlausibleBirthDate',
      target: target.constructor,
      propertyName: String(propertyKey),
      options: {
        message: 'dateOfBirth must be between 1900-01-01 and today',
        ...validationOptions,
      },
      validator: {
        validate: (value: unknown): boolean => isPlausibleBirthDate(value),
      },
    });
  };
}

const normaliseGender = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

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

  @ApiPropertyOptional({ example: 'MALE', enum: FAMILY_MEMBER_GENDERS })
  @IsOptional()
  @Transform(normaliseGender)
  @IsIn(FAMILY_MEMBER_GENDER_INPUTS)
  gender?: string;

  @ApiPropertyOptional({ example: '2018-04-12', description: 'Between 1900-01-01 and today' })
  @IsOptional()
  @IsDateString()
  @IsPlausibleBirthDate()
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
  @MaxLength(FAMILY_MEMBER_NOTES_MAX_LENGTH)
  notes?: string;
}

/**
 * Patient self-service variant (POST /family-members/me): the head of family is
 * always the authenticated patient, so `primaryPatientId` is not accepted.
 */
export class CreateMyFamilyMemberDto extends OmitType(CreateFamilyMemberDto, [
  'primaryPatientId',
] as const) {}

export class UpdateFamilyMemberDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) firstName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) lastName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) relation?: string;

  @ApiPropertyOptional({ enum: FAMILY_MEMBER_GENDERS })
  @IsOptional()
  @Transform(normaliseGender)
  @IsIn(FAMILY_MEMBER_GENDER_INPUTS)
  gender?: string;

  @ApiPropertyOptional({ description: 'Between 1900-01-01 and today' })
  @IsOptional()
  @IsDateString()
  @IsPlausibleBirthDate()
  dateOfBirth?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(FAMILY_MEMBER_NOTES_MAX_LENGTH)
  notes?: string;
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
