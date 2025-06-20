import { IsEmail, IsString, IsNotEmpty, IsBoolean, IsOptional, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from './user.dto';

export class LoginDto {
  @ApiProperty({
    description: 'User email',
    example: 'user@example.com'
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    description: 'User password',
    example: 'password123'
  })
  @IsString()
  @IsNotEmpty()
  password: string;
}

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

export class PasswordResetDto {
  @ApiProperty({
    description: 'Reset token received via email',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  })
  @IsString()
  token: string;

  @ApiProperty({
    description: 'New password',
    example: 'NewSecurePassword123!',
    minLength: 8
  })
  @IsString()
  @MinLength(8)
  newPassword: string;
}

export class AuthResponse {
  @ApiProperty({
    description: 'JWT access token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  })
  access_token: string;

  @ApiProperty({
    description: 'Session ID required for all authenticated requests',
    example: 'session_123456789'
  })
  session_id: string;

  @ApiProperty({
    description: 'Token type',
    example: 'Bearer'
  })
  token_type: string;

  @ApiProperty({
    description: 'Token expiration time in seconds',
    example: 86400
  })
  expires_in: number;

  @ApiProperty({
    description: 'User information',
    type: UserResponseDto
  })
  user: UserResponseDto;
}

export class LoginRequestDto {
  @ApiProperty({ example: 'user@example.com' })
  email: string;

  @ApiProperty({ example: 'password123', required: false })
  password?: string;

  @ApiProperty({ example: '123456', required: false })
  otp?: string;
}

export class ForgotPasswordRequestDto {
  @ApiProperty({ example: 'user@example.com' })
  email: string;
}

export class VerifyOtpRequestDto {
  @ApiProperty({ example: 'user@example.com' })
  email: string;

  @ApiProperty({ example: '123456' })
  otp: string;
}

export class RequestOtpDto {
  @ApiProperty({ example: 'user@example.com or +1234567890' })
  identifier: string;
}

export class InvalidateOtpDto {
  @ApiProperty({ example: 'user@example.com' })
  email: string;
}

export class CheckOtpStatusDto {
  @ApiProperty({ example: 'user@example.com' })
  email: string;
} 