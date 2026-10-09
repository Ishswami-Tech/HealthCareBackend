import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';

/** Body of PUT /analytics/doctors/:doctorId/fee-split. Amounts are rupees the doctor earns. */
export class UpdateDoctorFeeSplitDto {
  @ApiPropertyOptional({ example: 1000, description: 'Doctor fee for a video consultation' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  videoDoctorFee?: number;

  @ApiPropertyOptional({ example: 0, description: 'Doctor fee for an in-person visit' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1000000)
  inPersonDoctorFee?: number;
}
