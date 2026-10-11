import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

/** Query of GET /analytics/doctor/me/earnings. Both days are IST calendar days, inclusive. */
export class DoctorEarningsQueryDto {
  @ApiPropertyOptional({
    example: '2026-10-01',
    description: 'First day, default 1st of this month',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-31', description: 'Last day, default today' })
  @IsOptional()
  @IsDateString()
  to?: string;
}
