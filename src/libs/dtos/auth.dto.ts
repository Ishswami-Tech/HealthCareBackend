import { IsEmail, IsString, IsNotEmpty, IsBoolean, IsOptional, MinLength, IsUUID, IsEnum, IsObject, ValidateNested, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

/**
 * Enhanced login DTO following NestJS best practices
 * Based on AI rules: @nestjs-specific.md and @coding-standards.md
 */
export class LoginDto {
  @ApiProperty({
    description: 'User email address',
    example: 'user@example.com',
    format: 'email'
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  @Transform(({ value }) => value?.toLowerCase().trim())
  email!: string;

  @ApiProperty({
    description: 'User password',
    example: 'SecurePassword123!',
    minLength: 8
  })
  @IsString({ message: 'Password must be a string' })
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password!: string;

  @ApiProperty({
    description: 'OTP for passwordless login',
    example: '123456',
    required: false
  })
  @IsString({ message: 'OTP must be a string' })
  @IsOptional()
  otp?: string;

  @ApiProperty({
    description: 'Clinic ID for multi-tenant context',
    example: 'clinic-uuid-123',
    required: false
  })
  @IsUUID('4', { message: 'Clinic ID must be a valid UUID' })
  @IsOptional()
  clinicId?: string;

  @ApiProperty({
    description: 'Studio ID for multi-tenant context',
    example: 'studio-uuid-123',
    required: false
  })
  @IsUUID('4', { message: 'Studio ID must be a valid UUID' })
  @IsOptional()
  studioId?: string;

  @ApiProperty({
    description: 'Remember me option for extended session',
    example: false,
    required: false,
    default: false
  })
  @IsBoolean({ message: 'Remember me must be a boolean' })
  @IsOptional()
  rememberMe?: boolean = false;
}

/**
 * Enhanced registration DTO extending user creation
 */
export class RegisterDto {
  @ApiProperty({
    description: 'User email address',
    example: 'newuser@example.com',
    format: 'email'
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  @Transform(({ value }) => value?.toLowerCase().trim())
  email!: string;

  @ApiProperty({
    description: 'User password',
    example: 'SecurePassword123!',
    minLength: 8
  })
  @IsString({ message: 'Password must be a string' })
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password!: string;

  @ApiProperty({
    description: 'User first name',
    example: 'John',
    minLength: 2,
    maxLength: 50
  })
  @IsString({ message: 'First name must be a string' })
  @IsNotEmpty({ message: 'First name is required' })
  @Transform(({ value }) => value?.trim())
  firstName!: string;

  @ApiProperty({
    description: 'User last name',
    example: 'Doe',
    minLength: 2,
    maxLength: 50
  })
  @IsString({ message: 'Last name must be a string' })
  @IsNotEmpty({ message: 'Last name is required' })
  @Transform(({ value }) => value?.trim())
  lastName!: string;

  @ApiProperty({
    description: 'User phone number',
    example: '+1234567890',
    pattern: '^\\+?[1-9]\\d{1,14}$'
  })
  @IsString({ message: 'Phone number must be a string' })
  @IsNotEmpty({ message: 'Phone number is required' })
  phone!: string;

  @ApiProperty({
    description: 'Clinic ID for multi-tenant context',
    example: 'clinic-uuid-123',
    required: false
  })
  @IsUUID('4', { message: 'Clinic ID must be a valid UUID' })
  @IsOptional()
  clinicId?: string;

  @ApiProperty({
    description: 'Studio ID for multi-tenant context',
    example: 'studio-uuid-123',
    required: false
  })
  @IsUUID('4', { message: 'Studio ID must be a valid UUID' })
  @IsOptional()
  studioId?: string;
}

/**
 * Logout DTO for session management
 */
export class LogoutDto {
  @ApiProperty({
    description: 'Session ID to logout from',
    example: 'session_123456789',
    required: false
  })
  @IsString({ message: 'Session ID must be a string' })
  @IsOptional()
  sessionId?: string;

  @ApiProperty({
    description: 'Whether to logout from all devices',
    example: false,
    required: false,
    default: false
  })
  @IsBoolean({ message: 'All devices must be a boolean' })
  @IsOptional()
  allDevices?: boolean = false;
}

/**
 * Password reset request DTO
 */
export class PasswordResetRequestDto {
  @ApiProperty({
    description: 'User email address for password reset',
    example: 'user@example.com',
    format: 'email'
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  @Transform(({ value }) => value?.toLowerCase().trim())
  email!: string;

  @ApiProperty({
    description: 'Clinic ID for multi-tenant context',
    example: 'clinic-uuid-123',
    required: false
  })
  @IsUUID('4', { message: 'Clinic ID must be a valid UUID' })
  @IsOptional()
  clinicId?: string;
}

/**
 * Password reset confirmation DTO
 */
export class PasswordResetDto {
  @ApiProperty({
    description: 'Reset token received via email',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  })
  @IsString({ message: 'Reset token must be a string' })
  @IsNotEmpty({ message: 'Reset token is required' })
  token!: string;

  @ApiProperty({
    description: 'New password',
    example: 'NewSecurePassword123!',
    minLength: 8
  })
  @IsString({ message: 'New password must be a string' })
  @IsNotEmpty({ message: 'New password is required' })
  @MinLength(8, { message: 'New password must be at least 8 characters long' })
  newPassword!: string;

  @ApiProperty({
    description: 'Confirm new password',
    example: 'NewSecurePassword123!',
    minLength: 8
  })
  @IsString({ message: 'Confirm password must be a string' })
  @IsNotEmpty({ message: 'Confirm password is required' })
  @MinLength(8, { message: 'Confirm password must be at least 8 characters long' })
  confirmPassword!: string;
}

/**
 * Refresh token DTO
 */
export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token for getting new access token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  })
  @IsString({ message: 'Refresh token must be a string' })
  @IsNotEmpty({ message: 'Refresh token is required' })
  refreshToken!: string;
}

/**
 * Change password DTO for authenticated users
 */
export class ChangePasswordDto {
  @ApiProperty({
    description: 'Current password',
    example: 'CurrentPassword123!'
  })
  @IsString({ message: 'Current password must be a string' })
  @IsNotEmpty({ message: 'Current password is required' })
  currentPassword!: string;

  @ApiProperty({
    description: 'New password',
    example: 'NewSecurePassword123!',
    minLength: 8
  })
  @IsString({ message: 'New password must be a string' })
  @IsNotEmpty({ message: 'New password is required' })
  @MinLength(8, { message: 'New password must be at least 8 characters long' })
  newPassword!: string;

  @ApiProperty({
    description: 'Confirm new password',
    example: 'NewSecurePassword123!',
    minLength: 8
  })
  @IsString({ message: 'Confirm password must be a string' })
  @IsNotEmpty({ message: 'Confirm password is required' })
  @MinLength(8, { message: 'Confirm password must be at least 8 characters long' })
  confirmPassword!: string;
}

/**
 * Forgot password request DTO
 */
export class ForgotPasswordRequestDto {
  @ApiProperty({
    description: 'User email address for password reset',
    example: 'user@example.com',
    format: 'email'
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  @Transform(({ value }) => value?.toLowerCase().trim())
  email!: string;
}

/**
 * Request OTP DTO
 */
export class RequestOtpDto {
  @ApiProperty({
    description: 'User email or phone for OTP',
    example: 'user@example.com'
  })
  @IsString({ message: 'Identifier must be a string' })
  @IsNotEmpty({ message: 'Identifier is required' })
  identifier!: string;
}

/**
 * Verify OTP request DTO
 */
export class VerifyOtpRequestDto {
  @ApiProperty({
    description: 'User email',
    example: 'user@example.com',
    format: 'email'
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  @Transform(({ value }) => value?.toLowerCase().trim())
  email!: string;

  @ApiProperty({
    description: 'OTP code',
    example: '123456'
  })
  @IsString({ message: 'OTP must be a string' })
  @IsNotEmpty({ message: 'OTP is required' })
  otp!: string;
}

/**
 * Check OTP status DTO
 */
export class CheckOtpStatusDto {
  @ApiProperty({
    description: 'User email',
    example: 'user@example.com',
    format: 'email'
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  @Transform(({ value }) => value?.toLowerCase().trim())
  email!: string;
}

/**
 * Invalidate OTP DTO
 */
export class InvalidateOtpDto {
  @ApiProperty({
    description: 'User email',
    example: 'user@example.com',
    format: 'email'
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  @Transform(({ value }) => value?.toLowerCase().trim())
  email!: string;
}
