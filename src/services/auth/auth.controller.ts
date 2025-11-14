import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
  ApiSecurity,
  ApiConsumes,
  ApiProduces,
  ApiExtraModels,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { HealthcareErrorsService } from '@core/errors';
import { HealthcareError } from '@core/errors';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { Public } from '@core/decorators/public.decorator';
import {
  LoginDto,
  RegisterDto,
  AuthResponse,
  PasswordResetRequestDto,
  PasswordResetDto,
  RefreshTokenDto,
  ChangePasswordDto,
  RequestOtpDto,
  VerifyOtpRequestDto,
  LogoutDto,
} from '@dtos/auth.dto';
import { DataResponseDto, SuccessResponseDto } from '@dtos/common-response.dto';
import { AuthTokens } from '@core/types';
import {
  Cache,
  InvalidateCache,
  PatientCache,
  InvalidatePatientCache,
} from '@infrastructure/cache/decorators/cache.decorator';

@ApiTags('auth')
@Controller('auth')
@ApiBearerAuth()
@ApiSecurity('bearer')
@ApiConsumes('application/json')
@ApiProduces('application/json')
@ApiExtraModels(
  LoginDto,
  RegisterDto,
  AuthResponse,
  PasswordResetRequestDto,
  PasswordResetDto,
  RefreshTokenDto,
  ChangePasswordDto,
  RequestOtpDto,
  VerifyOtpRequestDto,
  LogoutDto
)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly errors: HealthcareErrorsService
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Cache({
    keyTemplate: 'auth:register_attempt:{email}:rate_limit',
    ttl: 1800, // 30 minutes rate limiting for registration
    tags: ['auth', 'registration_attempts'],
    priority: 'normal',
    enableSWR: false,
  })
  @InvalidateCache({
    patterns: ['user_profiles', 'auth:login_attempt:*'],
    tags: ['user_profiles', 'login_attempts'],
  })
  @ApiOperation({
    summary: 'Register a new user',
    description:
      'Create a new user account with email and password. Supports multi-tenant registration with clinic/studio context.',
    operationId: 'registerUser',
  })
  @ApiBody({
    type: RegisterDto,
    description:
      'User registration data including personal information and optional clinic/studio context',
    examples: {
      patient: {
        summary: 'Patient Registration',
        description: 'Register a new patient',
        value: {
          email: 'patient@example.com',
          password: 'SecurePassword123!',
          firstName: 'John',
          lastName: 'Doe',
          phone: '+1234567890',
          role: 'PATIENT',
          gender: 'MALE',
          dateOfBirth: '1990-01-01',
          address: '123 Main St, City, State 12345',
        },
      },
      doctor: {
        summary: 'Doctor Registration',
        description: 'Register a new doctor with clinic context',
        value: {
          email: 'doctor@example.com',
          password: 'SecurePassword123!',
          firstName: 'Jane',
          lastName: 'Smith',
          phone: '+1234567890',
          role: 'DOCTOR',
          clinicId: 'clinic-uuid-123',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'User registered successfully',
    type: DataResponseDto<AuthResponse>,
    schema: {
      example: {
        status: 'success',
        message: 'User registered successfully',
        timestamp: '2024-01-01T00:00:00.000Z',
        data: {
          accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          user: {
            id: 'user-123',
            email: 'user@example.com',
            firstName: 'John',
            lastName: 'Doe',
            role: 'PATIENT',
            isVerified: false,
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - validation failed',
    schema: {
      example: {
        status: 'error',
        message: 'Validation failed',
        timestamp: '2024-01-01T00:00:00.000Z',
        errorCode: 'VALIDATION_ERROR',
        details: {
          email: ['Please provide a valid email address'],
          password: ['Password must be at least 8 characters long'],
        },
      },
    },
  })
  @ApiResponse({
    status: 409,
    description: 'User already exists',
    schema: {
      example: {
        status: 'error',
        message: 'User with this email already exists',
        timestamp: '2024-01-01T00:00:00.000Z',
        errorCode: 'USER_EXISTS',
      },
    },
  })
  async register(@Body() registerDto: RegisterDto): Promise<DataResponseDto<AuthResponse>> {
    try {
      const result = await this.authService.register(registerDto);
      return new DataResponseDto(result, 'User registered successfully');
    } catch (_error) {
      if (_error instanceof HealthcareError) {
        this.errors.handleError(_error, 'AuthController');
        throw _error;
      }
      throw _error;
    }
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Cache({
    keyTemplate: 'auth:login_attempt:{email}:rate_limit',
    ttl: 900, // 15 minutes for rate limiting
    tags: ['auth', 'login_attempts'],
    priority: 'high',
    enableSWR: false, // Security: don't serve stale for auth
  })
  @ApiOperation({
    summary: 'Login user',
    description:
      'Authenticate user with email and password. Supports multi-tenant login with clinic/studio context and optional OTP for passwordless authentication.',
    operationId: 'loginUser',
  })
  @ApiBody({
    type: LoginDto,
    description: 'User login credentials with optional multi-tenant context',
    examples: {
      standard: {
        summary: 'Standard Login',
        description: 'Login with email and password',
        value: {
          email: 'user@example.com',
          password: 'SecurePassword123!',
          rememberMe: false,
        },
      },
      clinic: {
        summary: 'Clinic Context Login',
        description: 'Login with clinic context for multi-tenant access',
        value: {
          email: 'doctor@example.com',
          password: 'SecurePassword123!',
          clinicId: 'clinic-uuid-123',
          rememberMe: true,
        },
      },
      otp: {
        summary: 'OTP Login',
        description: 'Passwordless login with OTP',
        value: {
          email: 'user@example.com',
          otp: '123456',
          clinicId: 'clinic-uuid-123',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    type: DataResponseDto<AuthResponse>,
    schema: {
      example: {
        status: 'success',
        message: 'Login successful',
        timestamp: '2024-01-01T00:00:00.000Z',
        data: {
          accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          user: {
            id: 'user-123',
            email: 'user@example.com',
            firstName: 'John',
            lastName: 'Doe',
            role: 'PATIENT',
            isVerified: true,
            clinicId: 'clinic-uuid-123',
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid credentials',
    schema: {
      example: {
        status: 'error',
        message: 'Invalid credentials',
        timestamp: '2024-01-01T00:00:00.000Z',
        errorCode: 'INVALID_CREDENTIALS',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - validation failed',
    schema: {
      example: {
        status: 'error',
        message: 'Validation failed',
        timestamp: '2024-01-01T00:00:00.000Z',
        errorCode: 'VALIDATION_ERROR',
        details: {
          email: ['Please provide a valid email address'],
          password: ['Password is required'],
        },
      },
    },
  })
  async login(@Body() loginDto: LoginDto): Promise<DataResponseDto<AuthResponse>> {
    try {
      const result = await this.authService.login(loginDto);
      return new DataResponseDto(result, 'Login successful');
    } catch (_error) {
      if (_error instanceof HealthcareError) {
        this.errors.handleError(_error, 'AuthController');
        throw _error;
      }
      throw _error;
    }
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Cache({
    keyTemplate: 'auth:refresh_token:{userId}:cache',
    ttl: 300, // 5 minutes cache for refresh tokens
    tags: ['auth', 'refresh_tokens'],
    priority: 'high',
    enableSWR: false, // Security: fresh tokens always
    containsPHI: true,
  })
  @InvalidateCache({
    patterns: ['auth:login_attempt:*', 'user:{userId}:*'],
    tags: ['login_attempts', 'user_sessions'],
  })
  @ApiOperation({
    summary: 'Refresh access token',
    description:
      'Generate new access token using refresh token. Includes enhanced security validation with device fingerprint and user agent tracking.',
    operationId: 'refreshToken',
  })
  @ApiBody({
    type: RefreshTokenDto,
    description: 'Refresh token with optional security context for enhanced validation',
    examples: {
      basic: {
        summary: 'Basic Token Refresh',
        description: 'Refresh token without security context',
        value: {
          refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        },
      },
      secure: {
        summary: 'Secure Token Refresh',
        description: 'Refresh token with security context',
        value: {
          refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          deviceFingerprint: 'fp_1234567890abcdef',
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          ipAddress: '192.168.1.100',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Token refreshed successfully',
    type: DataResponseDto<AuthTokens>,
    schema: {
      example: {
        status: 'success',
        message: 'Token refreshed successfully',
        timestamp: '2024-01-01T00:00:00.000Z',
        data: {
          accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          expiresIn: 900,
          tokenType: 'Bearer',
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid refresh token',
    schema: {
      example: {
        status: 'error',
        message: 'Invalid refresh token',
        timestamp: '2024-01-01T00:00:00.000Z',
        errorCode: 'INVALID_REFRESH_TOKEN',
      },
    },
  })
  async refreshToken(
    @Body() refreshTokenDto: RefreshTokenDto
  ): Promise<DataResponseDto<AuthTokens>> {
    try {
      const tokens = await this.authService.refreshToken(refreshTokenDto);
      return new DataResponseDto(tokens, 'Token refreshed successfully');
    } catch (_error) {
      if (_error instanceof HealthcareError) {
        this.errors.handleError(_error, 'AuthController');
        throw _error;
      }
      throw _error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @InvalidateCache({
    patterns: [
      'auth:refresh_token:{userId}:*',
      'user:{userId}:*',
      'auth:login_attempt:{email}:*',
      'user_sessions:*',
    ],
    tags: ['auth', 'refresh_tokens', 'user_profiles', 'user_sessions'],
  })
  @ApiOperation({
    summary: 'Logout user',
    description:
      'Logout user and invalidate session. Supports logging out from specific session or all devices.',
    operationId: 'logoutUser',
  })
  @ApiBody({
    type: LogoutDto,
    description: 'Logout request with optional session management',
    examples: {
      current: {
        summary: 'Logout Current Session',
        description: 'Logout from current session only',
        value: {},
      },
      specific: {
        summary: 'Logout Specific Session',
        description: 'Logout from a specific session',
        value: {
          sessionId: 'session_123456789',
        },
      },
      all: {
        summary: 'Logout All Devices',
        description: 'Logout from all devices and sessions',
        value: {
          allDevices: true,
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Logout successful',
    type: SuccessResponseDto,
    schema: {
      example: {
        status: 'success',
        message: 'Logout successful',
        timestamp: '2024-01-01T00:00:00.000Z',
        success: true,
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing token',
    schema: {
      example: {
        status: 'error',
        message: 'Unauthorized',
        timestamp: '2024-01-01T00:00:00.000Z',
        errorCode: 'UNAUTHORIZED',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - Session ID required',
    schema: {
      example: {
        status: 'error',
        message: 'Session ID is required',
        timestamp: '2024-01-01T00:00:00.000Z',
        errorCode: 'VALIDATION_ERROR',
      },
    },
  })
  async logout(
    @Body() logoutDto: LogoutDto,
    @Request()
    req: Express.Request & { user?: { id: string; sessionId?: string } }
  ): Promise<SuccessResponseDto> {
    try {
      const sessionId = logoutDto.sessionId || req.user?.sessionId;
      if (!sessionId) {
        throw this.errors.validationError(
          'sessionId',
          'Session ID is required',
          'AuthController.logout'
        );
      }

      const result = await this.authService.logout(sessionId);
      return new SuccessResponseDto(result.message);
    } catch (_error) {
      if (_error instanceof HealthcareError) {
        this.errors.handleError(_error, 'AuthController');
        throw _error;
      }
      throw _error;
    }
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Cache({
    keyTemplate: 'auth:password_reset:{email}:rate_limit',
    ttl: 3600, // 1 hour rate limiting
    tags: ['auth', 'password_reset'],
    priority: 'normal',
    enableSWR: false,
  })
  @ApiOperation({
    summary: 'Request password reset',
    description:
      'Send password reset email to user. Rate limited to prevent abuse. Always returns success to prevent email enumeration.',
    operationId: 'requestPasswordReset',
  })
  @ApiBody({
    type: PasswordResetRequestDto,
    description: 'Password reset request with email and optional clinic context',
    examples: {
      basic: {
        summary: 'Basic Password Reset',
        description: 'Request password reset for email',
        value: {
          email: 'user@example.com',
        },
      },
      clinic: {
        summary: 'Clinic Context Reset',
        description: 'Request password reset with clinic context',
        value: {
          email: 'doctor@example.com',
          clinicId: 'clinic-uuid-123',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Password reset email sent (always returns success for security)',
    type: SuccessResponseDto,
    schema: {
      example: {
        status: 'success',
        message: 'If the email exists, a password reset link has been sent',
        timestamp: '2024-01-01T00:00:00.000Z',
        success: true,
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - validation failed',
    schema: {
      example: {
        status: 'error',
        message: 'Validation failed',
        timestamp: '2024-01-01T00:00:00.000Z',
        errorCode: 'VALIDATION_ERROR',
        details: {
          email: ['Please provide a valid email address'],
        },
      },
    },
  })
  async requestPasswordReset(
    @Body() requestDto: PasswordResetRequestDto
  ): Promise<SuccessResponseDto> {
    try {
      const result = await this.authService.requestPasswordReset(requestDto);
      return new SuccessResponseDto(result.message);
    } catch (_error) {
      if (_error instanceof HealthcareError) {
        this.errors.handleError(_error, 'AuthController');
        throw _error;
      }
      throw _error;
    }
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @InvalidateCache({
    patterns: ['auth:password_reset:*', 'user:{userId}:*', 'auth:refresh_token:{userId}:*'],
    tags: ['auth', 'password_reset', 'user_profiles', 'refresh_tokens'],
  })
  @ApiOperation({
    summary: 'Reset password with token',
    description:
      'Reset user password using the token received via email. Invalidates all existing sessions for security.',
    operationId: 'resetPassword',
  })
  @ApiBody({
    type: PasswordResetDto,
    description: 'Password reset confirmation with token and new password',
    examples: {
      reset: {
        summary: 'Password Reset',
        description: 'Reset password with token from email',
        value: {
          token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          newPassword: 'NewSecurePassword123!',
          confirmPassword: 'NewSecurePassword123!',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Password reset successful',
    type: SuccessResponseDto,
    schema: {
      example: {
        status: 'success',
        message: 'Password reset successful',
        timestamp: '2024-01-01T00:00:00.000Z',
        success: true,
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid or expired token',
    schema: {
      example: {
        status: 'error',
        message: 'Invalid or expired reset token',
        timestamp: '2024-01-01T00:00:00.000Z',
        errorCode: 'INVALID_RESET_TOKEN',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: {
      example: {
        status: 'error',
        message: 'Validation failed',
        timestamp: '2024-01-01T00:00:00.000Z',
        errorCode: 'VALIDATION_ERROR',
        details: {
          newPassword: ['Password must be at least 8 characters long'],
          confirmPassword: ['Passwords do not match'],
        },
      },
    },
  })
  async resetPassword(@Body() resetDto: PasswordResetDto): Promise<SuccessResponseDto> {
    try {
      const result = await this.authService.resetPassword(resetDto);
      return new SuccessResponseDto(result.message);
    } catch (_error) {
      if (_error instanceof HealthcareError) {
        this.errors.handleError(_error, 'AuthController');
        throw _error;
      }
      throw _error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @InvalidatePatientCache({
    patterns: ['user:{userId}:*', 'user_profiles', 'auth'],
    tags: ['user_profiles', 'auth'],
  })
  @ApiOperation({
    summary: 'Change password (authenticated user)',
    description:
      'Change password for authenticated user. Requires current password verification. Invalidates all sessions for security.',
    operationId: 'changePassword',
  })
  @ApiBody({
    type: ChangePasswordDto,
    description: 'Password change request with current and new password',
    examples: {
      change: {
        summary: 'Change Password',
        description: 'Change user password with current password verification',
        value: {
          currentPassword: 'CurrentPassword123!',
          newPassword: 'NewSecurePassword123!',
          confirmPassword: 'NewSecurePassword123!',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Password changed successfully',
    type: SuccessResponseDto,
    schema: {
      example: {
        status: 'success',
        message: 'Password changed successfully',
        timestamp: '2024-01-01T00:00:00.000Z',
        success: true,
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing token',
    schema: {
      example: {
        status: 'error',
        message: 'Unauthorized',
        timestamp: '2024-01-01T00:00:00.000Z',
        errorCode: 'UNAUTHORIZED',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Current password is incorrect',
    schema: {
      example: {
        status: 'error',
        message: 'Current password is incorrect',
        timestamp: '2024-01-01T00:00:00.000Z',
        errorCode: 'INVALID_CURRENT_PASSWORD',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: {
      example: {
        status: 'error',
        message: 'Validation failed',
        timestamp: '2024-01-01T00:00:00.000Z',
        errorCode: 'VALIDATION_ERROR',
        details: {
          newPassword: ['Password must be at least 8 characters long'],
          confirmPassword: ['Passwords do not match'],
        },
      },
    },
  })
  async changePassword(
    @Body() changePasswordDto: ChangePasswordDto,
    @Request() req: Express.Request & { user?: { id: string } }
  ): Promise<SuccessResponseDto> {
    try {
      const result = await this.authService.changePassword(req.user!.id, changePasswordDto);
      return new SuccessResponseDto(result.message);
    } catch (_error) {
      if (_error instanceof HealthcareError) {
        this.errors.handleError(_error, 'AuthController');
        throw _error;
      }
      throw _error;
    }
  }

  @Public()
  @Post('request-otp')
  @HttpCode(HttpStatus.OK)
  @Cache({
    keyTemplate: 'auth:otp_request:{contact}:rate_limit',
    ttl: 1800, // 30 minutes rate limiting
    tags: ['auth', 'otp_requests'],
    priority: 'normal',
    enableSWR: false,
  })
  @ApiOperation({
    summary: 'Request OTP for passwordless login',
    description:
      'Send OTP to user email for passwordless authentication. Rate limited to prevent abuse.',
    operationId: 'requestOtp',
  })
  @ApiBody({
    type: RequestOtpDto,
    description: 'OTP request with user identifier and optional clinic context',
    examples: {
      email: {
        summary: 'Email OTP Request',
        description: 'Request OTP via email',
        value: {
          identifier: 'user@example.com',
        },
      },
      clinic: {
        summary: 'Clinic Context OTP',
        description: 'Request OTP with clinic context',
        value: {
          identifier: 'doctor@example.com',
          clinicId: 'clinic-uuid-123',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'OTP sent successfully',
    type: SuccessResponseDto,
    schema: {
      example: {
        status: 'success',
        message: 'OTP sent successfully',
        timestamp: '2024-01-01T00:00:00.000Z',
        success: true,
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - validation failed or rate limited',
    schema: {
      example: {
        status: 'error',
        message: 'Please wait 1 minute(s) before requesting another OTP',
        timestamp: '2024-01-01T00:00:00.000Z',
        errorCode: 'RATE_LIMITED',
      },
    },
  })
  async requestOtp(@Body() requestDto: RequestOtpDto): Promise<SuccessResponseDto> {
    try {
      const result = await this.authService.requestOtp(requestDto);
      return new SuccessResponseDto(result.message);
    } catch (_error) {
      if (_error instanceof HealthcareError) {
        this.errors.handleError(_error, 'AuthController');
        throw _error;
      }
      throw _error;
    }
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @Cache({
    keyTemplate: 'auth:otp_verify:{contact}:attempts',
    ttl: 900, // 15 minutes for attempt tracking
    tags: ['auth', 'otp_verification'],
    priority: 'high',
    enableSWR: false,
    containsPHI: true,
  })
  @InvalidateCache({
    patterns: ['auth:otp_request:{contact}:*', 'auth:login_attempt:*'],
    tags: ['otp_requests', 'login_attempts'],
  })
  @ApiOperation({
    summary: 'Verify OTP and login',
    description:
      'Verify OTP code and authenticate user. Creates new session and returns access tokens.',
    operationId: 'verifyOtp',
  })
  @ApiBody({
    type: VerifyOtpRequestDto,
    description: 'OTP verification with email, OTP code and optional clinic context',
    examples: {
      verify: {
        summary: 'Verify OTP',
        description: 'Verify OTP code for login',
        value: {
          email: 'user@example.com',
          otp: '123456',
        },
      },
      clinic: {
        summary: 'Clinic Context OTP',
        description: 'Verify OTP with clinic context',
        value: {
          email: 'doctor@example.com',
          otp: '123456',
          clinicId: 'clinic-uuid-123',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'OTP verified successfully',
    type: DataResponseDto<AuthResponse>,
    schema: {
      example: {
        status: 'success',
        message: 'OTP verified successfully',
        timestamp: '2024-01-01T00:00:00.000Z',
        data: {
          accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          user: {
            id: 'user-123',
            email: 'user@example.com',
            firstName: 'John',
            lastName: 'Doe',
            role: 'PATIENT',
            isVerified: true,
            clinicId: 'clinic-uuid-123',
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid or expired OTP',
    schema: {
      example: {
        status: 'error',
        message: 'Invalid or expired OTP',
        timestamp: '2024-01-01T00:00:00.000Z',
        errorCode: 'INVALID_OTP',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: {
      example: {
        status: 'error',
        message: 'Validation failed',
        timestamp: '2024-01-01T00:00:00.000Z',
        errorCode: 'VALIDATION_ERROR',
        details: {
          email: ['Please provide a valid email address'],
          otp: ['OTP is required'],
        },
      },
    },
  })
  async verifyOtp(@Body() verifyDto: VerifyOtpRequestDto): Promise<DataResponseDto<AuthResponse>> {
    try {
      const result = await this.authService.verifyOtp(verifyDto);
      return new DataResponseDto(result, 'OTP verified successfully');
    } catch (_error) {
      if (_error instanceof HealthcareError) {
        this.errors.handleError(_error, 'AuthController');
        throw _error;
      }
      throw _error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  @PatientCache({
    keyTemplate: 'user:{userId}:profile',
    ttl: 1800, // 30 minutes
    tags: ['user_profiles', 'auth'],
    priority: 'high',
    enableSWR: true,
    containsPHI: true,
    compress: true,
  })
  @ApiOperation({
    summary: 'Get current user profile',
    description: 'Retrieve authenticated user profile information. Cached for performance.',
    operationId: 'getUserProfile',
  })
  @ApiResponse({
    status: 200,
    description: 'User profile retrieved successfully',
    type: DataResponseDto<{
      id: string;
      email: string;
      role: string;
      clinicId?: string;
      domain: string;
    }>,
    schema: {
      example: {
        status: 'success',
        message: 'Profile retrieved successfully',
        timestamp: '2024-01-01T00:00:00.000Z',
        data: {
          id: 'user-123',
          email: 'user@example.com',
          role: 'PATIENT',
          clinicId: 'clinic-uuid-123',
          domain: 'healthcare',
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing token',
    schema: {
      example: {
        status: 'error',
        message: 'Unauthorized',
        timestamp: '2024-01-01T00:00:00.000Z',
        errorCode: 'UNAUTHORIZED',
      },
    },
  })
  getProfile(
    @Request()
    req: Express.Request & {
      user?: {
        id: string;
        email: string;
        role: string;
        clinicId?: string;
        domain: string;
      };
    }
  ): DataResponseDto<{
    id: string;
    email: string;
    role: string;
    clinicId?: string;
    domain: string;
  }> {
    try {
      // Return user profile from request (already populated by AuthGuard)
      const profile = {
        id: req.user!.id,
        email: req.user!.email,
        role: req.user!.role,
        domain: req.user!.domain,
        ...(req.user!.clinicId && { clinicId: req.user!.clinicId }),
      };

      return new DataResponseDto(profile, 'Profile retrieved successfully');
    } catch (_error) {
      if (_error instanceof HealthcareError) {
        this.errors.handleError(_error, 'AuthController');
        throw _error;
      }
      throw _error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  @PatientCache({
    keyTemplate: 'user:{userId}:sessions',
    ttl: 600, // 10 minutes
    tags: ['user_sessions', 'auth'],
    priority: 'normal',
    enableSWR: true,
    containsPHI: true,
    compress: true,
  })
  @ApiOperation({
    summary: 'Get user sessions',
    description: 'Retrieve all active sessions for the authenticated user. Cached for performance.',
    operationId: 'getUserSessions',
  })
  @ApiResponse({
    status: 200,
    description: 'Sessions retrieved successfully',
    type: DataResponseDto<never[]>,
    schema: {
      example: {
        status: 'success',
        message: 'Sessions retrieved successfully',
        timestamp: '2024-01-01T00:00:00.000Z',
        data: [],
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing token',
    schema: {
      example: {
        status: 'error',
        message: 'Unauthorized',
        timestamp: '2024-01-01T00:00:00.000Z',
        errorCode: 'UNAUTHORIZED',
      },
    },
  })
  getUserSessions(@Request() _req: Express.Request): DataResponseDto<never[]> {
    try {
      // This would typically get user sessions from the session service
      // For now, return a placeholder response
      const sessions: never[] = [];

      return new DataResponseDto(sessions, 'Sessions retrieved successfully');
    } catch (_error) {
      if (_error instanceof HealthcareError) {
        this.errors.handleError(_error, 'AuthController');
        throw _error;
      }
      throw _error;
    }
  }
}
