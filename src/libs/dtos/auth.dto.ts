import {
  IsEmail,
  IsString,
  IsNotEmpty,
  IsBoolean,
  IsOptional,
  MinLength,
  IsUUID,
  IsEnum,
  IsObject,
  IsDateString,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsClinicId } from '@core/decorators/clinic-id.validator';
import { Role } from '@core/types/enums.types';

/**
 * Data Transfer Object for user profile in auth response
 */
export class UserProfileDto {
  @ApiProperty({
    description: 'User ID',
    example: 'user-123',
  })
  @IsString()
  id!: string;

  @ApiProperty({
    description: 'User Email',
    example: 'user@example.com',
  })
  @IsString()
  email!: string;

  @ApiPropertyOptional({
    description: 'First Name',
    example: 'John',
  })
  @IsOptional()
  @IsString()
  firstName?: string | undefined;

  @ApiPropertyOptional({
    description: 'Last Name',
    example: 'Doe',
  })
  @IsOptional()
  @IsString()
  lastName?: string | undefined;

  @ApiPropertyOptional({
    description: 'User Role',
    enum: Role,
    example: Role.PATIENT,
  })
  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @ApiPropertyOptional({
    description: 'Verification status',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;

  @ApiPropertyOptional({
    description: 'Clinic ID',
    example: 'clinic-123',
  })
  @IsOptional()
  @IsString()
  clinicId?: string | undefined;

  @ApiPropertyOptional({
    description: 'Profile Picture URL',
    example: 'https://example.com/pic.jpg',
  })
  @IsOptional()
  @IsString()
  profilePicture?: string | undefined;

  @ApiPropertyOptional({
    description: 'User Phone',
    example: '+1234567890',
  })
  @IsOptional()
  @IsString()
  phone?: string | undefined;

  @ApiPropertyOptional({
    description: 'Is profile complete',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  profileComplete?: boolean;
}

/**
 * Data Transfer Object for user login
 * @class LoginDto
 * @description Contains credentials and optional context for user authentication
 * @example
 * ```typescript
 * const login = new LoginDto();
 * login.email = "user@example.com";
 * login.password = "SecurePassword123!";
 * login.clinicId = "clinic-uuid-123";
 * ```
 */
export class LoginDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  @Transform(({ value }): string =>
    typeof value === 'string' ? value.toLowerCase().trim() : (value as string)
  )
  email!: string;

  @ApiProperty({
    description: 'User password',
    example: 'SecurePassword123!',
    minLength: 8,
  })
  @IsString({ message: 'Password must be a string' })
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password!: string;

  @ApiProperty({
    description: 'OTP for passwordless login',
    example: '123456',
    required: false,
  })
  @IsString({ message: 'OTP must be a string' })
  @IsOptional()
  otp?: string;

  @ApiProperty({
    description: 'Clinic ID for multi-tenant context (UUID or clinic code like CL0001)',
    example: 'CL0001',
    required: false,
  })
  @IsClinicId({ message: 'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001)' })
  @IsOptional()
  clinicId?: string;

  @ApiProperty({
    description: 'Studio ID for multi-tenant context',
    example: 'studio-uuid-123',
    required: false,
  })
  @IsUUID('4', { message: 'Studio ID must be a valid UUID' })
  @IsOptional()
  studioId?: string;

  @ApiProperty({
    description: 'Remember me option for extended session',
    example: false,
    required: false,
    default: false,
  })
  @IsBoolean({ message: 'Remember me must be a boolean' })
  @IsOptional()
  rememberMe?: boolean = false;
}

/**
 * Data Transfer Object for user registration
 * @class RegisterDto
 * @description Contains user information for account creation with validation
 * @example
 * ```typescript
 * const register = new RegisterDto();
 * register.email = "user@example.com";
 * register.firstName = "John";
 * register.lastName = "Doe";
 * ```
 */
export class RegisterDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  @Transform(({ value }): string =>
    typeof value === 'string' ? value.toLowerCase().trim() : (value as string)
  )
  email!: string;

  @ApiProperty({
    description: 'User password',
    example: 'SecurePassword123!',
    minLength: 8,
  })
  @IsString({ message: 'Password must be a string' })
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password!: string;

  @ApiProperty({
    description: 'User first name',
    example: 'John',
    minLength: 2,
    maxLength: 50,
  })
  @IsString({ message: 'First name must be a string' })
  @IsNotEmpty({ message: 'First name is required' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  firstName!: string;

  @ApiProperty({
    description: 'User last name',
    example: 'Doe',
    minLength: 2,
    maxLength: 50,
  })
  @IsString({ message: 'Last name must be a string' })
  @IsNotEmpty({ message: 'Last name is required' })
  @Transform(({ value }): string => (typeof value === 'string' ? value.trim() : (value as string)))
  lastName!: string;

  @ApiProperty({
    description: 'User phone number',
    example: '+1234567890',
    pattern: '^\\+?[1-9]\\d{1,14}$',
  })
  @ApiProperty({
    description: 'User phone number',
    example: '+1234567890',
    pattern: '^\\+?[1-9]\\d{1,14}$',
  })
  @IsString({ message: 'Phone number must be a string' })
  @IsOptional()
  phone?: string;

  @ApiProperty({
    description: 'OTP for verification during registration',
    example: '123456',
    required: false,
  })
  @IsString({ message: 'OTP must be a string' })
  @IsOptional()
  otp?: string;

  @ApiProperty({
    description: 'Clinic ID for multi-tenant context (OPTIONAL - provided via X-Clinic-ID header)',
    example: 'CL0001',
    required: false,
  })
  @IsClinicId({ message: 'Clinic ID must be a valid UUID or clinic code format (e.g., CL0001)' })
  @IsOptional()
  clinicId?: string;

  @ApiProperty({
    description: 'Studio ID for multi-tenant context',
    example: 'studio-uuid-123',
    required: false,
  })
  @IsUUID('4', { message: 'Studio ID must be a valid UUID' })
  @IsOptional()
  studioId?: string;

  @ApiProperty({
    description: 'User role',
    example: 'PATIENT',
    enum: ['PATIENT', 'DOCTOR', 'ADMIN', 'RECEPTIONIST', 'NURSE'],
    required: false,
  })
  @IsEnum(['PATIENT', 'DOCTOR', 'ADMIN', 'RECEPTIONIST', 'NURSE'], {
    message: 'Role must be a valid role',
  })
  @IsOptional()
  role?: string;

  @ApiProperty({
    description: 'User gender',
    example: 'MALE',
    enum: ['MALE', 'FEMALE', 'OTHER'],
    required: false,
  })
  @IsEnum(['MALE', 'FEMALE', 'OTHER'], {
    message: 'Gender must be a valid gender',
  })
  @IsOptional()
  gender?: string;

  @ApiProperty({
    description: 'User date of birth',
    example: '1990-01-01',
    required: false,
  })
  @IsDateString({}, { message: 'Date of birth must be a valid date' })
  @IsOptional()
  dateOfBirth?: string;

  @ApiProperty({
    description: 'User address',
    example: '123 Main St, City, State 12345',
    required: false,
  })
  @IsString({ message: 'Address must be a string' })
  @IsOptional()
  address?: string;

  @ApiProperty({
    description: 'Emergency contact information',
    example: { name: 'John Doe', phone: '+1234567890', relationship: 'Father' },
    required: false,
  })
  @IsObject({ message: 'Emergency contact must be an object' })
  @IsOptional()
  emergencyContact?: {
    name: string;
    phone: string;
    relationship: string;
  };

  @ApiProperty({
    description: 'Google OAuth ID for social registration',
    example: 'google-oauth-id-123456',
    required: false,
  })
  @IsString({ message: 'Google ID must be a string' })
  @IsOptional()
  googleId?: string;
}

/**
 * Data Transfer Object for user logout
 * @class LogoutDto
 * @description Contains session management options for user logout
 * @example
 * ```typescript
 * const logout = new LogoutDto();
 * logout.sessionId = "session_123456789";
 * logout.allDevices = false;
 * ```
 */
export class LogoutDto {
  @ApiProperty({
    description: 'Session ID to logout from',
    example: 'session_123456789',
    required: false,
  })
  @IsString({ message: 'Session ID must be a string' })
  @IsOptional()
  sessionId?: string;

  @ApiProperty({
    description: 'Whether to logout from all devices',
    example: false,
    required: false,
    default: false,
  })
  @IsBoolean({ message: 'All devices must be a boolean' })
  @IsOptional()
  allDevices?: boolean = false;
}

/**
 * Data Transfer Object for password reset confirmation
 * @class PasswordResetDto
 * @description Contains reset token and new password for password reset process
 * @example
 * ```typescript
 * const reset = new PasswordResetDto();
 * reset.token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
 * reset.newPassword = "NewSecurePassword123!";
 * ```
 */
export class PasswordResetDto {
  @ApiProperty({
    description: 'Reset token received via email',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString({ message: 'Reset token must be a string' })
  @IsNotEmpty({ message: 'Reset token is required' })
  token!: string;

  @ApiProperty({
    description: 'New password',
    example: 'NewSecurePassword123!',
    minLength: 8,
  })
  @IsString({ message: 'New password must be a string' })
  @IsNotEmpty({ message: 'New password is required' })
  @MinLength(8, { message: 'New password must be at least 8 characters long' })
  newPassword!: string;

  @ApiProperty({
    description: 'Confirm new password',
    example: 'NewSecurePassword123!',
    minLength: 8,
  })
  @IsString({ message: 'Confirm password must be a string' })
  @IsNotEmpty({ message: 'Confirm password is required' })
  @MinLength(8, {
    message: 'Confirm password must be at least 8 characters long',
  })
  confirmPassword!: string;
}

/**
 * Data Transfer Object for refresh token requests
 * @class RefreshTokenDto
 * @description Contains refresh token and security context for token renewal
 * @example
 * ```typescript
 * const refresh = new RefreshTokenDto();
 * refresh.refreshToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
 * refresh.deviceFingerprint = "fp_1234567890abcdef";
 * ```
 */
export class RefreshTokenDto {
  @ApiProperty({
    description: 'Refresh token for getting new access token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @IsString({ message: 'Refresh token must be a string' })
  @IsNotEmpty({ message: 'Refresh token is required' })
  refreshToken!: string;

  @ApiProperty({
    description: 'Device fingerprint for security validation',
    example: 'fp_1234567890abcdef',
    required: false,
  })
  @IsString()
  @IsOptional()
  deviceFingerprint?: string;

  @ApiProperty({
    description: 'User agent for security tracking',
    example: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    required: false,
  })
  @IsString()
  @IsOptional()
  userAgent?: string;

  @ApiProperty({
    description: 'IP address for security validation',
    example: '192.168.1.100',
    required: false,
  })
  @IsString()
  @IsOptional()
  ipAddress?: string;
}

/**
 * Data Transfer Object for changing user password
 * @class ChangePasswordDto
 * @description Contains current and new password for authenticated password changes
 * @example
 * ```typescript
 * const change = new ChangePasswordDto();
 * change.currentPassword = "CurrentPassword123!";
 * change.newPassword = "NewSecurePassword123!";
 * ```
 */
export class ChangePasswordDto {
  @ApiProperty({
    description: 'Current password',
    example: 'CurrentPassword123!',
  })
  @IsString({ message: 'Current password must be a string' })
  @IsNotEmpty({ message: 'Current password is required' })
  currentPassword!: string;

  @ApiProperty({
    description: 'New password',
    example: 'NewSecurePassword123!',
    minLength: 8,
  })
  @IsString({ message: 'New password must be a string' })
  @IsNotEmpty({ message: 'New password is required' })
  @MinLength(8, { message: 'New password must be at least 8 characters long' })
  newPassword!: string;

  @ApiProperty({
    description: 'Confirm new password',
    example: 'NewSecurePassword123!',
    minLength: 8,
  })
  @IsString({ message: 'Confirm password must be a string' })
  @IsNotEmpty({ message: 'Confirm password is required' })
  @MinLength(8, {
    message: 'Confirm password must be at least 8 characters long',
  })
  confirmPassword!: string;
}

/**
 * Data Transfer Object for password reset requests
 * @class PasswordResetRequestDto
 * @description Contains email and clinic context for password reset initiation
 * @example
 * ```typescript
 * const reset = new PasswordResetRequestDto();
 * reset.email = "user@example.com";
 * reset.clinicId = "clinic-uuid-123";
 * ```
 */
export class PasswordResetRequestDto {
  @ApiProperty({
    description: 'User email address for password reset',
    example: 'user@example.com',
    format: 'email',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  @Transform(({ value }): string =>
    typeof value === 'string' ? value.toLowerCase().trim() : (value as string)
  )
  email!: string;

  @ApiProperty({
    description: 'Clinic ID for multi-tenant context',
    example: 'clinic-uuid-123',
    required: false,
  })
  @IsUUID('4', { message: 'Clinic ID must be a valid UUID' })
  @IsOptional()
  clinicId?: string;
}

/**
 * Data Transfer Object for OTP requests
 * @class RequestOtpDto
 * @description Contains identifier and clinic context for OTP generation
 * @example
 * ```typescript
 * const otp = new RequestOtpDto();
 * otp.identifier = "user@example.com";
 * otp.clinicId = "clinic-uuid-123";
 * ```
 */
export class RequestOtpDto {
  @ApiProperty({
    description: 'User email or phone for OTP',
    example: 'user@example.com',
  })
  @IsString({ message: 'Identifier must be a string' })
  @IsNotEmpty({ message: 'Identifier is required' })
  identifier!: string;

  @ApiProperty({
    description: 'Clinic ID for multi-tenant context',
    example: 'clinic-uuid-123',
    required: false,
  })
  @IsUUID('4', { message: 'Clinic ID must be a valid UUID' })
  @IsOptional()
  clinicId?: string;

  @ApiProperty({
    description: 'Is this for new user registration?',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isRegistration?: boolean;
}

/**
 * Data Transfer Object for OTP verification
 * @class VerifyOtpRequestDto
 * @description Contains email, OTP code, and clinic context for verification
 * @example
 * ```typescript
 * const verify = new VerifyOtpRequestDto();
 * verify.email = "user@example.com";
 * verify.otp = "123456";
 * ```
 */
export class VerifyOtpRequestDto {
  @ApiProperty({
    description: 'User email or phone',
    example: 'user@example.com',
  })
  @IsString({ message: 'Identifier must be a string' })
  @IsNotEmpty({ message: 'Identifier is required' })
  identifier!: string;

  @ApiProperty({
    description: 'OTP code',
    example: '123456',
  })
  @IsString({ message: 'OTP must be a string' })
  @IsNotEmpty({ message: 'OTP is required' })
  otp!: string;

  @ApiProperty({
    description: 'Clinic ID for multi-tenant context',
    example: 'clinic-uuid-123',
    required: false,
  })
  @IsUUID('4', { message: 'Clinic ID must be a valid UUID' })
  @IsOptional()
  clinicId?: string;

  @ApiProperty({
    description: 'Is this for new user registration?',
    example: true,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  isRegistration?: boolean;

  @ApiProperty({
    description: 'First Name (required for registration)',
    example: 'John',
    required: false,
  })
  @IsOptional()
  @IsString()
  firstName?: string;

  @ApiProperty({
    description: 'Last Name (required for registration)',
    example: 'Doe',
    required: false,
  })
  @IsOptional()
  @IsString()
  lastName?: string;

  // Compatibility getters
  get email(): string {
    return this.identifier;
  }
}

/**
 * Data Transfer Object for checking OTP status
 * @class CheckOtpStatusDto
 * @description Contains email for checking OTP verification status
 * @example
 * ```typescript
 * const check = new CheckOtpStatusDto();
 * check.email = "user@example.com";
 * ```
 */
export class CheckOtpStatusDto {
  @ApiProperty({
    description: 'User email',
    example: 'user@example.com',
    format: 'email',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  @Transform(({ value }): string =>
    typeof value === 'string' ? value.toLowerCase().trim() : (value as string)
  )
  email!: string;
}

/**
 * Data Transfer Object for invalidating OTP
 * @class InvalidateOtpDto
 * @description Contains email for invalidating existing OTP
 * @example
 * ```typescript
 * const invalidate = new InvalidateOtpDto();
 * invalidate.email = "user@example.com";
 * ```
 */
export class InvalidateOtpDto {
  @ApiProperty({
    description: 'User email',
    example: 'user@example.com',
    format: 'email',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  @Transform(({ value }): string =>
    typeof value === 'string' ? value.toLowerCase().trim() : (value as string)
  )
  email!: string;
}

/**
 * Data Transfer Object for authentication responses
 * @class AuthResponse
 * @description Contains access token, refresh token, and user information
 * @example
 * ```typescript
 * const auth = new AuthResponse();
 * auth.accessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
 * auth.refreshToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
 * ```
 */
export class AuthResponse {
  @ApiProperty({
    description: 'Access token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Access token must be a string' })
  accessToken?: string;

  @ApiProperty({
    description: 'Refresh token',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'Refresh token must be a string' })
  refreshToken?: string;

  @ApiProperty({
    description: 'User information',
    example: { id: 'user-123', email: 'user@example.com' },
  })
  @ValidateNested()
  @Type(() => UserProfileDto)
  user!: UserProfileDto;

  @ApiPropertyOptional({
    description: 'Indicates if OTP verification is required',
    example: true,
  })
  @IsOptional()
  requiresVerification?: boolean;

  @ApiPropertyOptional({
    description: 'Message to display to the user',
    example: 'Please verify your account.',
  })
  @IsOptional()
  @IsString()
  message?: string;
}

/**
 * Data Transfer Object for login requests (alias for LoginDto)
 * @class LoginRequestDto
 * @description Alias for LoginDto to maintain API consistency
 * @extends LoginDto
 */
export class LoginRequestDto extends LoginDto {}

/**
 * Data Transfer Object for OAuth registration
 * @class RegisterDtoWithOAuth
 * @description Extends RegisterDto with OAuth provider IDs
 * @extends RegisterDto
 * @example
 * ```typescript
 * const oauth = new RegisterDtoWithOAuth();
 * oauth.googleId = "google-oauth-id-123";
 * oauth.facebookId = "facebook-oauth-id-123";
 * ```
 */
export class RegisterDtoWithOAuth extends RegisterDto {
  @ApiProperty({
    description: 'Google ID for OAuth registration',
    example: 'google-oauth-id-123',
    required: false,
  })
  @IsString({ message: 'Google ID must be a string' })
  @IsOptional()
  googleId?: string;

  @ApiProperty({
    description: 'Facebook ID for OAuth registration',
    example: 'facebook-oauth-id-123',
    required: false,
  })
  @IsString({ message: 'Facebook ID must be a string' })
  @IsOptional()
  facebookId?: string;

  @ApiProperty({
    description: 'Apple ID for OAuth registration',
    example: 'apple-oauth-id-123',
    required: false,
  })
  @IsString({ message: 'Apple ID must be a string' })
  @IsOptional()
  appleId?: string;
}

/**
 * Data Transfer Object for OTP verification with clinic context
 * @class VerifyOtpRequestDtoWithClinic
 * @description Extends VerifyOtpRequestDto with additional clinic context
 * @extends VerifyOtpRequestDto
 */
export class VerifyOtpRequestDtoWithClinic extends VerifyOtpRequestDto {
  @ApiProperty({
    description: 'Clinic ID for multi-tenant context',
    example: 'clinic-uuid-123',
    required: false,
  })
  @IsUUID('4', { message: 'Clinic ID must be a valid UUID' })
  @IsOptional()
  clinicId?: string;
}

/**
 * Data Transfer Object for Google OAuth authentication
 * @class GoogleOAuthDto
 * @description Contains Google ID token or access token for OAuth authentication
 * @example
 * ```typescript
 * const googleAuth = new GoogleOAuthDto();
 * googleAuth.token = "eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMzQ1NiIsInR5cCI6IkpXVCJ9...";
 * googleAuth.clinicId = "clinic-uuid-123";
 * ```
 */
export class GoogleOAuthDto {
  @ApiProperty({
    description: 'Google ID token or access token from Google OAuth',
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMzQ1NiIsInR5cCI6IkpXVCJ9...',
    required: true,
  })
  @IsString({ message: 'Google token must be a string' })
  @IsNotEmpty({ message: 'Google token is required' })
  token!: string;

  @ApiProperty({
    description: 'Clinic ID for multi-tenant context',
    example: 'clinic-uuid-123',
    required: false,
  })
  @IsUUID('4', { message: 'Clinic ID must be a valid UUID' })
  @IsOptional()
  clinicId?: string;

  @ApiProperty({
    description: 'Studio ID for multi-tenant context',
    example: 'studio-uuid-123',
    required: false,
  })
  @IsUUID('4', { message: 'Studio ID must be a valid UUID' })
  @IsOptional()
  studioId?: string;
}
