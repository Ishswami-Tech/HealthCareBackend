import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Claim the record the clinic imported from its old register. The caller's phone is already verified. */
export class ClaimRecordDto {
  @ApiProperty({ description: 'Your full name as the clinic has it on file' })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  @Transform(trimmed)
  fullName!: string;

  @ApiPropertyOptional({ description: 'UHID from a clinic receipt or card, to tell records apart' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Transform(trimmed)
  uhid?: string;

  @ApiPropertyOptional({ description: 'Your patient number from the old register or card' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Transform(trimmed)
  legacyRegistration?: string;
}
