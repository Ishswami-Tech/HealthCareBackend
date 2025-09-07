import { 
  Controller, 
  Post, 
  Body, 
  Get, 
  UseGuards, 
  Request, 
  HttpCode, 
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../libs/core/guards/jwt-auth.guard';
import { Public } from '../../libs/core/decorators/public.decorator';
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
  LogoutDto
} from '../../libs/dtos/auth.dto';
import { DataResponseDto, SuccessResponseDto } from '../../libs/dtos/common-response.dto';
import { 
  Cache, 
  InvalidateCache, 
  PatientCache, 
  InvalidatePatientCache 
} from '../../libs/infrastructure/cache/decorators/cache.decorator';

@ApiTags('Authentication')
@Controller('auth')
@ApiBearerAuth()
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ 
    status: 201, 
    description: 'User registered successfully',
    type: DataResponseDto<AuthResponse>
  })
  @ApiResponse({ status: 400, description: 'Bad request - validation failed' })
  @ApiResponse({ status: 409, description: 'User already exists' })
  async register(@Body() registerDto: RegisterDto): Promise<DataResponseDto<AuthResponse>> {
    try {
      const result = await this.authService.register(registerDto);
      return new DataResponseDto(result, 'User registered successfully');
    } catch (error) {
      this.logger.error('Registration failed', error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
    }
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login user' })
  @ApiResponse({ 
    status: 200, 
    description: 'Login successful',
    type: DataResponseDto<AuthResponse>
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async login(@Body() loginDto: LoginDto): Promise<DataResponseDto<AuthResponse>> {
    try {
      const result = await this.authService.login(loginDto);
      return new DataResponseDto(result, 'Login successful');
    } catch (error) {
      this.logger.error('Login failed', error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
    }
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ 
    status: 200, 
    description: 'Token refreshed successfully',
    type: DataResponseDto<any>
  })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  async refreshToken(@Body() refreshTokenDto: RefreshTokenDto): Promise<DataResponseDto<any>> {
    try {
      const tokens = await this.authService.refreshToken(refreshTokenDto);
      return new DataResponseDto(tokens, 'Token refreshed successfully');
    } catch (error) {
      this.logger.error('Token refresh failed', error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout user' })
  @ApiResponse({ 
    status: 200, 
    description: 'Logout successful',
    type: SuccessResponseDto
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async logout(@Body() logoutDto: LogoutDto, @Request() req: any): Promise<SuccessResponseDto> {
    try {
      const sessionId = logoutDto.sessionId || req.user?.sessionId;
      if (!sessionId) {
        throw new BadRequestException('Session ID is required');
      }
      
      const result = await this.authService.logout(sessionId);
      return new SuccessResponseDto(result.message);
    } catch (error) {
      this.logger.error('Logout failed', error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
    }
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request password reset' })
  @ApiResponse({ 
    status: 200, 
    description: 'Password reset email sent',
    type: SuccessResponseDto
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async requestPasswordReset(@Body() requestDto: PasswordResetRequestDto): Promise<SuccessResponseDto> {
    try {
      const result = await this.authService.requestPasswordReset(requestDto);
      return new SuccessResponseDto(result.message);
    } catch (error) {
      this.logger.error('Password reset request failed', error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
    }
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password with token' })
  @ApiResponse({ 
    status: 200, 
    description: 'Password reset successful',
    type: SuccessResponseDto
  })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async resetPassword(@Body() resetDto: PasswordResetDto): Promise<SuccessResponseDto> {
    try {
      const result = await this.authService.resetPassword(resetDto);
      return new SuccessResponseDto(result.message);
    } catch (error) {
      this.logger.error('Password reset failed', error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @InvalidatePatientCache({
    patterns: ['user:{userId}:*', 'user_profiles', 'auth'],
    tags: ['user_profiles', 'auth']
  })
  @ApiOperation({ summary: 'Change password (authenticated user)' })
  @ApiResponse({ 
    status: 200, 
    description: 'Password changed successfully',
    type: SuccessResponseDto
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 400, description: 'Current password is incorrect' })
  async changePassword(@Body() changePasswordDto: ChangePasswordDto, @Request() req: any): Promise<SuccessResponseDto> {
    try {
      const result = await this.authService.changePassword(req.user.id, changePasswordDto);
      return new SuccessResponseDto(result.message);
    } catch (error) {
      this.logger.error('Password change failed', error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
    }
  }

  @Public()
  @Post('request-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request OTP for passwordless login' })
  @ApiResponse({ 
    status: 200, 
    description: 'OTP sent successfully',
    type: SuccessResponseDto
  })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async requestOtp(@Body() requestDto: RequestOtpDto): Promise<SuccessResponseDto> {
    try {
      const result = await this.authService.requestOtp(requestDto);
      return new SuccessResponseDto(result.message);
    } catch (error) {
      this.logger.error('OTP request failed', error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
    }
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify OTP and login' })
  @ApiResponse({ 
    status: 200, 
    description: 'OTP verified successfully',
    type: DataResponseDto<AuthResponse>
  })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP' })
  async verifyOtp(@Body() verifyDto: VerifyOtpRequestDto): Promise<DataResponseDto<AuthResponse>> {
    try {
      const result = await this.authService.verifyOtp(verifyDto);
      return new DataResponseDto(result, 'OTP verified successfully');
    } catch (error) {
      this.logger.error('OTP verification failed', error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
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
    compress: true
  })
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ 
    status: 200, 
    description: 'User profile retrieved successfully',
    type: DataResponseDto<any>
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getProfile(@Request() req: any): Promise<DataResponseDto<any>> {
    try {
      // Return user profile from request (already populated by AuthGuard)
      const profile = {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
        clinicId: req.user.clinicId,
        domain: req.user.domain,
      };
      
      return new DataResponseDto(profile, 'Profile retrieved successfully');
    } catch (error) {
      this.logger.error('Profile retrieval failed', error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  @ApiOperation({ summary: 'Get user sessions' })
  @ApiResponse({ 
    status: 200, 
    description: 'Sessions retrieved successfully',
    type: DataResponseDto<any>
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getUserSessions(@Request() req: any): Promise<DataResponseDto<any>> {
    try {
      // This would typically get user sessions from the session service
      // For now, return a placeholder response
      const sessions: any[] = [];
      
      return new DataResponseDto(sessions, 'Sessions retrieved successfully');
    } catch (error) {
      this.logger.error('Session retrieval failed', error instanceof Error ? (error as Error).stack : 'No stack trace available');
      throw error;
    }
  }
}
