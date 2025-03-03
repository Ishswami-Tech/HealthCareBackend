import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class LogoutDto {
  @ApiProperty({
    description: 'Session ID to logout from (optional)',
    required: false,
    example: 'session_123456789',
  })
  @IsString()
  @IsOptional()
  sessionId?: string;

  @ApiProperty({
    description: 'Whether to logout from all devices',
    required: false,
    default: false,
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  allDevices?: boolean = false;
} 