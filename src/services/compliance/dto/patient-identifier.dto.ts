import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { PATIENT_IDENTIFIER_SYSTEMS } from '@core/types/compliance.types';
import type { PatientIdentifierSystem } from '@core/types/compliance.types';

export class SetPatientIdentifierDto {
  @ApiProperty()
  @IsUUID()
  patientId!: string;

  @ApiProperty({ enum: PATIENT_IDENTIFIER_SYSTEMS })
  @IsIn(PATIENT_IDENTIFIER_SYSTEMS)
  system!: PatientIdentifierSystem;

  @ApiProperty({ description: 'Raw value; normalised per system on the server' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  value!: string;
}

export class IssueUhidDto {
  @ApiProperty()
  @IsUUID()
  patientId!: string;
}

export class LookupPatientIdentifierQueryDto {
  @ApiProperty({ enum: PATIENT_IDENTIFIER_SYSTEMS })
  @IsIn(PATIENT_IDENTIFIER_SYSTEMS)
  system!: PatientIdentifierSystem;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  value!: string;
}

export interface PatientIdentifierLookupResponse {
  readonly patientId: string | null;
}
