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
import { SessionManagementService } from '@core/session/session-management.service';
import { JwtAuthService } from './core/jwt.service';
import type { FastifyRequestWithUser } from '@core/types/guard.types';
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
  GoogleOAuthDto,
} from '@dtos/auth.dto';
import { DataResponseDto, SuccessResponseDto } from '@dtos/common-response.dto';
import { AuthTokens } from '@core/types';
import { Cache, InvalidateCache, PatientCache, InvalidatePatientCache } from '@core/decorators';

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
  LogoutDto,
  GoogleOAuthDto
)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly errors: HealthcareErrorsService,
    private readonly sessionService: SessionManagementService,
    private readonly jwtAuthService: JwtAuthService
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
        description: 'Register a new patient with clinic ID (REQUIRED)',
        value: {
          email: 'patient@example.com',
          password: 'SecurePassword123!',
          firstName: 'John',
          lastName: 'Doe',
          phone: '+1234567890',
          clinicId: 'CL0001', // REQUIRED - Sets primaryClinicId automatically
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
  async register(
    @Body() registerDto: RegisterDto,
    @Request() req: FastifyRequestWithUser
  ): Promise<DataResponseDto<AuthResponse>> {
    try {
      const result = await this.authService.register(registerDto, {
        userAgent: (req.headers['user-agent'] as string) || 'unknown',
        ipAddress: req.ip || '127.0.0.1',
      });

      // Sync session to Fastify session if available
      if (req.session && result.user) {
        const decodedToken = result.accessToken
          ? this.jwtAuthService.decodeToken(result.accessToken)
          : null;
        const sessionId =
          decodedToken && typeof decodedToken === 'object' && decodedToken !== null
            ? (decodedToken as { sessionId?: string }).sessionId
            : undefined;

        if (sessionId) {
          const sessionData = await this.sessionService.getSession(sessionId);
          if (sessionData) {
            this.sessionService.syncToFastifySession(sessionData, req.session);
          }
        }
      }

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
  async login(
    @Body() loginDto: LoginDto,
    @Request() req: FastifyRequestWithUser
  ): Promise<DataResponseDto<AuthResponse>> {
    try {
      const result = await this.authService.login(loginDto, {
        userAgent: (req.headers['user-agent'] as string) || 'unknown',
        ipAddress: req.ip || '127.0.0.1',
      });

      // Sync session to Fastify session if available
      if (req.session && result.user) {
        const decodedToken = result.accessToken
          ? this.jwtAuthService.decodeToken(result.accessToken)
          : null;
        const sessionId =
          decodedToken && typeof decodedToken === 'object' && decodedToken !== null
            ? (decodedToken as { sessionId?: string }).sessionId
            : undefined;

        if (sessionId) {
          const sessionData = await this.sessionService.getSession(sessionId);
          if (sessionData) {
            this.sessionService.syncToFastifySession(sessionData, req.session);
          }
        }
      }

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
    @Body() refreshTokenDto: RefreshTokenDto,
    @Request() req: FastifyRequestWithUser
  ): Promise<DataResponseDto<AuthTokens>> {
    try {
      const tokens = await this.authService.refreshToken(refreshTokenDto, {
        userAgent: (req.headers['user-agent'] as string) || 'unknown',
        ipAddress: req.ip || '127.0.0.1',
      });
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
    @Request() req: FastifyRequestWithUser
  ): Promise<SuccessResponseDto> {
    try {
      // Try to get sessionId from multiple sources
      if (!req.user) {
        throw this.errors.invalidCredentials('AuthController.logout');
      }

      const user = req.user as {
        sessionId?: string;
        sub?: string;
        jti?: string;
        [key: string]: unknown;
      };

      // Priority: 1. Request body, 2. Fastify session, 3. JWT payload sessionId, 4. Extract from token
      let sessionId = logoutDto.sessionId || req.session?.sessionId || user?.sessionId;

      // If still no sessionId, try to extract from token payload using bracket notation
      if (!sessionId && user && typeof user === 'object') {
        sessionId = (user as { sessionId?: string }).sessionId;
      }

      // Invalidate Fastify session if available
      if (req.session) {
        try {
          // Clear Fastify session
          delete req.session.sessionId;
          delete req.session.userId;
          delete req.session.clinicId;
          // Fastify session will be destroyed when response is sent
        } catch (_sessionError) {
          // Log but don't fail - session clearing is best effort
        }
      }

      // If we have a sessionId, use the logout service
      // Otherwise, we can still blacklist the token (best effort)
      if (sessionId) {
        const result = await this.authService.logout(sessionId, {
          userAgent: (req.headers['user-agent'] as string) || 'unknown',
          ipAddress: req.ip || '127.0.0.1',
        });
        return new SuccessResponseDto(result.message);
      } else {
        // No sessionId - try to blacklist the token directly (best effort)
        // Extract token from Authorization header if possible
        const authHeader = req.headers.authorization;
        if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
          const token = authHeader.substring(7);
          try {
            // Try to blacklist the token directly
            await this.authService.logout(token, {
              userAgent: (req.headers['user-agent'] as string) || 'unknown',
              ipAddress: req.ip || '127.0.0.1',
            }); // This will try to blacklist if sessionId is the token itself
          } catch (_blacklistError) {
            // Log but don't fail - logout is best effort
          }
        }
        // Return success even if we couldn't invalidate session
        return new SuccessResponseDto('Logout successful');
      }
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
    @Body() requestDto: PasswordResetRequestDto,
    @Request() req: FastifyRequestWithUser
  ): Promise<SuccessResponseDto> {
    try {
      const result = await this.authService.requestPasswordReset(requestDto, {
        userAgent: (req.headers['user-agent'] as string) || 'unknown',
        ipAddress: req.ip || '127.0.0.1',
      });
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
  async resetPassword(
    @Body() resetDto: PasswordResetDto,
    @Request() req: FastifyRequestWithUser
  ): Promise<SuccessResponseDto> {
    try {
      const result = await this.authService.resetPassword(resetDto, {
        userAgent: (req.headers['user-agent'] as string) || 'unknown',
        ipAddress: req.ip || '127.0.0.1',
      });
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
    @Request() req: FastifyRequestWithUser
  ): Promise<SuccessResponseDto> {
    try {
      const userId = req.user?.sub || (req.user as { id?: string })?.id;
      if (!userId) {
        throw this.errors.invalidCredentials('AuthController.changePassword');
      }
      const result = await this.authService.changePassword(userId, changePasswordDto, {
        userAgent: (req.headers['user-agent'] as string) || 'unknown',
        ipAddress: req.ip || '127.0.0.1',
      });
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
  async requestOtp(
    @Body() requestDto: RequestOtpDto,
    @Request() req: FastifyRequestWithUser
  ): Promise<SuccessResponseDto> {
    try {
      const result = await this.authService.requestOtp(requestDto, {
        userAgent: (req.headers['user-agent'] as string) || 'unknown',
        ipAddress: req.ip || '127.0.0.1',
      });
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
  async verifyOtp(
    @Body() verifyDto: VerifyOtpRequestDto,
    @Request() req: FastifyRequestWithUser
  ): Promise<DataResponseDto<AuthResponse>> {
    try {
      const result = await this.authService.verifyOtp(verifyDto, {
        userAgent: (req.headers['user-agent'] as string) || 'unknown',
        ipAddress: req.ip || '127.0.0.1',
      });

      // Sync session to Fastify session if available
      if (req.session && result.user) {
        const decodedToken = result.accessToken
          ? this.jwtAuthService.decodeToken(result.accessToken)
          : null;
        const sessionId =
          decodedToken && typeof decodedToken === 'object' && decodedToken !== null
            ? (decodedToken as { sessionId?: string }).sessionId
            : undefined;

        if (sessionId) {
          const sessionData = await this.sessionService.getSession(sessionId);
          if (sessionData) {
            this.sessionService.syncToFastifySession(sessionData, req.session);
          }
        }
      }

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
  getUserSessions(@Request() _req: FastifyRequestWithUser): DataResponseDto<never[]> {
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

  @Public()
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Authenticate with Google OAuth',
    description:
      'Authenticate user using Google OAuth ID token or access token. Creates new user if not exists.',
    operationId: 'googleOAuth',
  })
  @ApiBody({
    type: GoogleOAuthDto,
    description: 'Google OAuth token and optional clinic context',
    examples: {
      withIdToken: {
        summary: 'Google ID Token',
        description: 'Using Google ID token from frontend',
        value: {
          token: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMzQ1NiIsInR5cCI6IkpXVCJ9...',
          clinicId: 'clinic-uuid-123',
        },
      },
      withAccessToken: {
        summary: 'Google Access Token',
        description: 'Using Google access token',
        value: {
          token: 'ya29.a0AfH6SMBx...',
          clinicId: 'clinic-uuid-123',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Google OAuth authentication successful',
    type: DataResponseDto<AuthResponse>,
    schema: {
      example: {
        status: 'success',
        message: 'Google OAuth authentication successful',
        timestamp: '2024-01-01T00:00:00.000Z',
        data: {
          accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          user: {
            id: 'user-123',
            email: 'user@gmail.com',
            firstName: 'John',
            lastName: 'Doe',
            role: 'PATIENT',
            isVerified: true,
            clinicId: 'clinic-uuid-123',
            profilePicture: 'https://lh3.googleusercontent.com/...',
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid Google token or authentication failed',
  })
  async googleOAuth(
    @Body() googleOAuthDto: GoogleOAuthDto,
    @Request() req: FastifyRequestWithUser
  ): Promise<DataResponseDto<AuthResponse>> {
    try {
      const result = await this.authService.authenticateWithGoogle(
        googleOAuthDto.token,
        googleOAuthDto.clinicId,
        {
          userAgent: (req.headers['user-agent'] as string) || 'unknown',
          ipAddress: req.ip || '127.0.0.1',
        }
      );

      // Sync session to Fastify session if available
      if (req.session && result.user) {
        const decodedToken = result.accessToken
          ? this.jwtAuthService.decodeToken(result.accessToken)
          : null;
        const sessionId =
          decodedToken && typeof decodedToken === 'object' && decodedToken !== null
            ? (decodedToken as { sessionId?: string }).sessionId
            : undefined;

        if (sessionId) {
          const sessionData = await this.sessionService.getSession(sessionId);
          if (sessionData) {
            this.sessionService.syncToFastifySession(sessionData, req.session);
          }
        }
      }

      return new DataResponseDto(result, 'Google OAuth authentication successful');
    } catch (_error) {
      if (_error instanceof HealthcareError) {
        this.errors.handleError(_error, 'AuthController');
        throw _error;
      }
      throw _error;
    }
  }
}
