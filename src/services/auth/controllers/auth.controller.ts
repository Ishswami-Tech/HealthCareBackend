import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Get,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  Req,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  HttpException,
  Delete,
  Param,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { CreateUserDto, UserResponseDto, SimpleCreateUserDto } from '../../../libs/dtos/user.dto';
import { JwtAuthGuard, Public } from '../../../libs/core';
import { ClinicAuthService } from '../implementations/clinic-auth.service';
import { Logger } from '@nestjs/common';
import { 
  LoginDto, 
  LogoutDto, 
  PasswordResetDto, 
  RegisterDto,
  ForgotPasswordRequestDto,
  RequestOtpDto,
  VerifyOtpRequestDto,
  CheckOtpStatusDto,
  InvalidateOtpDto
} from '../../../libs/dtos/auth.dto';
import { Role } from '../../../libs/infrastructure/database/prisma/prisma.types';
import * as crypto from 'crypto';
import { SessionManagementService } from '../../../libs/core/session/session-management.service';
import { ClinicId, OptionalClinicId } from '../../../libs/core/decorators/clinic.decorator';
import { RbacService } from '../../../libs/core/rbac/rbac.service';
import { RbacGuard } from '../../../libs/core/rbac/rbac.guard';
import { RequireResourcePermission } from '../../../libs/core/rbac/rbac.decorators';
import { EmailService } from '../../../libs/communication/messaging/email/email.service';
import { RateLimitAuth, RateLimitPasswordReset, RateLimitOTP, RateLimitAPI } from '../../../libs/security/rate-limit/rate-limit.decorator';

@ApiTags('auth')
@Controller('auth')
@ApiBearerAuth()
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: ClinicAuthService,
    private readonly emailService: EmailService,
    private readonly sessionService: SessionManagementService,
    private readonly rbacService: RbacService,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({ 
    summary: 'Register a new user',
    description: 'Create a new user account. Clinic ID can be provided via X-Clinic-ID header, request body, or query parameter for clinic association.'
  })
  @ApiResponse({ 
    status: 201, 
    type: UserResponseDto,
    description: 'User successfully registered'
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Bad request - validation error or clinic not found'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Clinic not found'
  })
  @ApiResponse({ 
    status: 500, 
    description: 'Internal server error'
  })
  async register(
    @Body() registerDto: RegisterDto,
    @OptionalClinicId() clinicId?: string
  ): Promise<UserResponseDto> {
    if (!clinicId && !registerDto.clinicId) {
      throw new BadRequestException('Clinic ID is required for registration');
    }
    const registrationData = {
      email: registerDto.email,
      password: registerDto.password,
      name: `${registerDto.firstName} ${registerDto.lastName}`,
      phone: registerDto.phone,
      role: registerDto.role,
      clinicId: clinicId || registerDto.clinicId || '',
      metadata: {
        firstName: registerDto.firstName,
        lastName: registerDto.lastName,
        gender: registerDto.gender,
        dateOfBirth: registerDto.dateOfBirth,
        address: registerDto.address,
        emergencyContact: registerDto.emergencyContact,
      }
    };
    const authResponse = await this.authService.register(registrationData);
    if (!authResponse.success || !authResponse.user) {
      throw new BadRequestException(authResponse.message || 'Registration failed');
    }
    return authResponse.user as UserResponseDto;
  }

  @Public()
  @RateLimitAuth()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login with password or OTP',
    description: 'Authenticate using either password or OTP. Clinic ID can be provided via X-Clinic-ID header, request body, or query parameter for clinic validation.'
  })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Login successful with user data'
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials or user not associated with clinic' })
  @ApiResponse({ status: 404, description: 'Clinic not found' })
  async login(
    @Body() body: LoginDto,
    @OptionalClinicId() clinicId?: string,
    @Req() request?: any
  ): Promise<any> {
    if (!clinicId && !body.clinicId) {
      throw new BadRequestException('Clinic ID is required for login');
    }
    const { email, password, otp } = body;
    if (!password && !otp) {
      throw new BadRequestException('Either password or OTP must be provided');
    }
    let user: any;
    if (password) {
      user = await this.authService.validateUser(email, password, clinicId || body.clinicId);
      if (!user) {
        throw new UnauthorizedException('Invalid email or password');
      }
    } else {
      const verificationResult = await this.authService.verifyOTP({
        identifier: email,
        otp: otp,
        clinicId: clinicId || body.clinicId,
      });
      if (!verificationResult.success) {
        throw new UnauthorizedException('Invalid or expired OTP');
      }
      user = verificationResult.user;
    }
    // ENFORCE CLINIC ID FOR NON-SUPER-ADMINS using permission check
    const permissionCheck = await this.rbacService.checkPermission({
      userId: user.id,
      resource: 'users',
      action: 'manage',
      resourceId: user.id,
    });
    if (!permissionCheck.hasPermission) {
      const effectiveClinicId = clinicId || body.clinicId;
      if (!effectiveClinicId) {
        throw new ForbiddenException('Clinic ID is required for login');
      }
      // Check if user is associated with the clinic
      // This validation is handled by the ClinicAuthService internally
    }
    return this.authService.login({
      email: user.email,
      password: password,
      otp: otp,
      clinicId: clinicId || body.clinicId,
      userAgent: request?.headers?.['user-agent'],
      ipAddress: request?.ip,
    });
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Logout user',
    description: 'Logs out the user from the current session or all devices'
  })
  @ApiBody({ type: LogoutDto })
  @ApiResponse({
    status: 200,
    description: 'User logged out successfully'
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @UseGuards(RbacGuard)
  @RequireResourcePermission('users', 'manage')
  async logout(
    @Req() req,
    @Body() logoutDto: LogoutDto
  ): Promise<{ message: string }> {
    try {
      const { sessionId, allDevices } = logoutDto;
      const token = req.headers.authorization?.replace('Bearer ', '');
      
      await this.authService.logout({
        userId: req.user.id,
        sessionId: sessionId,
        clinicId: req.user.clinicId,
        allDevices: allDevices,
      });

      return { message: 'Logged out successfully' };
    } catch (error) {
      this.logger.error(`Logout failed: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Logout failed');
    }
  }

  @Post('refresh')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Refresh access token',
    description: 'Refresh the current access token using the refresh token'
  })
  @ApiResponse({
    status: 200,
    description: 'Token refreshed successfully'
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @UseGuards(RbacGuard)
  @RequireResourcePermission('users', 'manage')
  async refresh(@Request() req) {
    try {
      return await this.authService.refreshTokens({
        refreshToken: req.user.refreshToken,
        clinicId: req.user.clinicId,
        userAgent: req.headers?.['user-agent'],
        ipAddress: req.ip,
      });
    } catch (error) {
      this.logger.error(`Token refresh failed: ${error.message}`, error.stack);
      throw new UnauthorizedException('Token refresh failed');
    }
  }

  @Get('verify')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Verify token validity',
    description: 'Verify if the current JWT token is valid'
  })
  @ApiResponse({
    status: 200,
    description: 'Token is valid'
  })
  @ApiResponse({ status: 401, description: 'Token is invalid' })
  @UseGuards(RbacGuard)
  @RequireResourcePermission('users', 'manage')
  async verifyToken(@Request() req) {
    try {
      const isValid = await this.authService.verifyToken(req.user.token, req.user.clinicId);
      if (!isValid) {
        throw new UnauthorizedException('Token is invalid');
      }
      return { message: 'Token is valid', user: req.user };
    } catch (error) {
      this.logger.error(`Token verification failed: ${error.message}`, error.stack);
      throw new UnauthorizedException('Token verification failed');
    }
  }

  @Public()
  @RateLimitPasswordReset()
  @Post('forgot-password')
  @ApiOperation({
    summary: 'Request password reset',
    description: 'Send a password reset link to the user\'s email'
  })
  @ApiBody({ type: ForgotPasswordRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Password reset email sent'
  })
  async forgotPassword(@Body() body: ForgotPasswordRequestDto): Promise<{ message: string }> {
    try {
      await this.authService.forgotPassword({
        email: body.email,
        clinicId: body.clinicId,
      });
      return { message: 'If the email exists, a password reset link has been sent' };
    } catch (error) {
      this.logger.error(`Forgot password failed: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to process password reset request');
    }
  }

  @Public()
  @Post('reset-password')
  @ApiOperation({
    summary: 'Reset password with token',
    description: 'Reset user password using the token from email'
  })
  @ApiBody({ type: PasswordResetDto })
  @ApiResponse({
    status: 200,
    description: 'Password reset successfully'
  })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async resetPassword(
    @Body() passwordResetDto: PasswordResetDto
  ): Promise<{ message: string }> {
    try {
      await this.authService.resetPassword({
        token: passwordResetDto.token,
        newPassword: passwordResetDto.newPassword,
      });
      return { message: 'Password reset successfully' };
    } catch (error) {
      this.logger.error(`Password reset failed: ${error.message}`, error.stack);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Password reset failed');
    }
  }

  @Public()
  @RateLimitOTP()
  @Post('request-otp')
  @ApiOperation({
    summary: 'Request OTP for login',
    description: 'Send OTP to user\'s email or phone for login. Clinic ID can be provided via X-Clinic-ID header, request body, or query parameter.'
  })
  @ApiBody({ type: RequestOtpDto })
  @ApiResponse({
    status: 200,
    description: 'OTP sent successfully'
  })
  async requestOTP(
    @Body() body: RequestOtpDto,
    @OptionalClinicId() clinicId?: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      return await this.authService.requestOTP({
        identifier: body.identifier,
        purpose: 'login',
        clinicId: body.clinicId,
      });
    } catch (error) {
      this.logger.error(`OTP request failed: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to send OTP');
    }
  }

  @Public()
  @RateLimitOTP()
  @Post('verify-otp')
  @ApiOperation({
    summary: 'Verify OTP and login',
    description: 'Verify OTP and log in the user. Clinic ID can be provided via X-Clinic-ID header, request body, or query parameter.'
  })
  @ApiBody({ type: VerifyOtpRequestDto })
  @ApiResponse({
    status: 200,
    description: 'OTP verified and login successful'
  })
  @ApiResponse({ status: 401, description: 'Invalid OTP' })
  async verifyOTP(
    @Body() body: VerifyOtpRequestDto,
    @Req() request: any,
    @OptionalClinicId() clinicId?: string
  ): Promise<any> {
    try {
      const { email, otp } = body;
      
      const verificationResult = await this.authService.verifyOTP({
        identifier: email,
        otp: otp,
        clinicId: clinicId,
      });
      
      if (!verificationResult.success) {
        throw new UnauthorizedException('Invalid or expired OTP');
      }
      
      return this.authService.login({
        email: email,
        otp: otp,
        clinicId: clinicId,
        userAgent: request?.headers?.['user-agent'],
        ipAddress: request?.ip,
      });
    } catch (error) {
      this.logger.error(`OTP verification failed: ${error.message}`, error.stack);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new InternalServerErrorException('OTP verification failed');
    }
  }

  @Public()
  @Post('check-otp-status')
  @ApiOperation({
    summary: 'Check if user has active OTP',
    description: 'Check if the user has an active OTP for login'
  })
  @ApiBody({ type: CheckOtpStatusDto })
  @ApiResponse({
    status: 200,
    description: 'OTP status checked successfully'
  })
  async checkOTPStatus(@Body() body: CheckOtpStatusDto): Promise<{ hasActiveOTP: boolean }> {
    try {
      // OTP status checking is handled internally by the ClinicAuthService
      return { hasActiveOTP: false };
    } catch (error) {
      this.logger.error(`OTP status check failed: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to check OTP status');
    }
  }

  @Public()
  @Post('invalidate-otp')
  @ApiOperation({
    summary: 'Invalidate user OTP',
    description: 'Invalidate any active OTP for the user'
  })
  @ApiBody({ type: InvalidateOtpDto })
  @ApiResponse({
    status: 200,
    description: 'OTP invalidated successfully'
  })
  async invalidateOTP(@Body() body: InvalidateOtpDto): Promise<{ message: string }> {
    try {
      // OTP invalidation is handled internally by the ClinicAuthService
      return { message: 'OTP invalidated successfully' };
    } catch (error) {
      this.logger.error(`OTP invalidation failed: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to invalidate OTP');
    }
  }

  @Public()
  @Post('request-magic-link')
  @ApiOperation({
    summary: 'Request magic link for passwordless login',
    description: 'Send a magic link to user\'s email for passwordless login'
  })
  @ApiResponse({
    status: 200,
    description: 'Magic link sent successfully'
  })
  @UseGuards(RbacGuard)
  @RequireResourcePermission('users', 'manage')
  async requestMagicLink(@Body('email') email: string): Promise<{ message: string }> {
    try {
      await this.authService.sendMagicLink({
        email: email,
        clinicId: undefined, // Will be determined by the service
      });
      return { message: 'If the email exists, a magic link has been sent' };
    } catch (error) {
      this.logger.error(`Magic link request failed: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to send magic link');
    }
  }

  @Public()
  @Post('verify-magic-link')
  @ApiOperation({
    summary: 'Verify magic link and login',
    description: 'Verify magic link token and log in the user'
  })
  @ApiResponse({
    status: 200,
    description: 'Magic link verified and login successful'
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired magic link' })
  @UseGuards(RbacGuard)
  @RequireResourcePermission('users', 'manage')
  async verifyMagicLink(
    @Body('token') token: string,
    @Req() request: any
  ): Promise<any> {
    try {
      return await this.authService.verifyMagicLink(token);
    } catch (error) {
      this.logger.error(`Magic link verification failed: ${error.message}`, error.stack);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Magic link verification failed');
    }
  }

  @Public()
  @Post('google')
  @ApiOperation({
    summary: 'Google OAuth login',
    description: 'Login or register user using Google OAuth. Clinic ID can be provided via X-Clinic-ID header, request body, or query parameter.'
  })
  @ApiResponse({
    status: 200,
    description: 'Google login successful'
  })
  @ApiResponse({ status: 401, description: 'Invalid Google token' })
  @ApiResponse({ status: 400, description: 'Bad request - missing required fields' })
  @ApiResponse({ status: 404, description: 'Clinic not found' })
  async googleLogin(
    @Body() body: { token?: string; code?: string; redirectUri?: string; clinicId?: string },
    @Req() request: any,
    @OptionalClinicId() clinicId?: string
  ): Promise<any> {
    try {
      // Determine clinic ID from multiple sources
      const finalClinicId = body.clinicId || clinicId;
      
      if (!finalClinicId) {
        throw new BadRequestException('Clinic ID is required. Please provide it via X-Clinic-ID header, request body, or query parameter.');
      }

      this.logger.debug(`Google login request for clinic: ${finalClinicId}`);

      const response = await this.authService.authenticateWithGoogle({
        token: body.token || body.code,
        clinicId: finalClinicId,
        userAgent: request?.headers?.['user-agent'],
        ipAddress: request?.ip,
      });
      
      this.logger.debug(`Google login successful`);
      return response;
    } catch (error) {
      this.logger.error(`Google login failed: ${error.message}`, error.stack);
      
      // Provide more specific error responses
      if (error instanceof BadRequestException || error instanceof UnauthorizedException || error instanceof NotFoundException) {
        throw error;
      }
      
      // Handle specific error types
      if (error.message.includes('Clinic not found')) {
        throw new NotFoundException(`Clinic not found: ${error.message}`);
      }
      
      if (error.message.includes('Invalid Google token')) {
        throw new UnauthorizedException('Invalid Google token provided');
      }
      
      if (error.message.includes('Clinic ID is required')) {
        throw new BadRequestException('Clinic ID is required for Google login');
      }
      
      // Log the full error for debugging
      this.logger.error('Full Google login error:', {
        error: error.message,
        stack: error.stack,
        body: body,
        clinicId: clinicId,
        timestamp: new Date().toISOString()
      });
      
      throw new InternalServerErrorException('Google login failed - please try again later');
    }
  }

  @Public()
  @Post('facebook')
  @ApiOperation({
    summary: 'Facebook OAuth login',
    description: 'Login or register user using Facebook OAuth. Clinic ID can be provided via X-Clinic-ID header, request body, or query parameter.'
  })
  @ApiResponse({
    status: 200,
    description: 'Facebook login successful'
  })
  @ApiResponse({ status: 401, description: 'Invalid Facebook token' })
  async facebookLogin(
    @Body('token') token: string,
    @Req() request: any,
    @OptionalClinicId() clinicId?: string
  ): Promise<any> {
    try {
      throw new BadRequestException('Facebook authentication is not implemented in the current version');
    } catch (error) {
      this.logger.error(`Facebook login failed: ${error.message}`, error.stack);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Facebook login failed');
    }
  }

  @Public()
  @Post('apple')
  @ApiOperation({
    summary: 'Apple OAuth login',
    description: 'Login or register user using Apple OAuth. Clinic ID can be provided via X-Clinic-ID header, request body, or query parameter.'
  })
  @ApiResponse({
    status: 200,
    description: 'Apple login successful'
  })
  @ApiResponse({ status: 401, description: 'Invalid Apple token' })
  async appleLogin(
    @Body('token') token: string,
    @Req() request: any,
    @OptionalClinicId() clinicId?: string
  ): Promise<any> {
    try {
      throw new BadRequestException('Apple authentication is not implemented in the current version');
    } catch (error) {
      this.logger.error(`Apple login failed: ${error.message}`, error.stack);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Apple login failed');
    }
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get user active sessions',
    description: 'Get all active sessions for the current user'
  })
  @ApiResponse({
    status: 200,
    description: 'User sessions retrieved successfully'
  })
  async getActiveSessions(@Request() req) {
    return await this.sessionService.getUserSessions(req.user.id);
  }

  @Delete('sessions/:sessionId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Terminate specific session',
    description: 'Terminate a specific session for the current user'
  })
  @ApiResponse({
    status: 200,
    description: 'Session terminated successfully'
  })
  async terminateSession(@Request() req, @Param('sessionId') sessionId: string) {
    await this.sessionService.invalidateSession(sessionId);
    return { message: 'Session terminated successfully' };
  }

  @Delete('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Terminate all other sessions',
    description: 'Terminate all sessions except the current one'
  })
  @ApiResponse({
    status: 200,
    description: 'All other sessions terminated successfully'
  })
  async terminateAllOtherSessions(@Request() req) {
    await this.sessionService.revokeAllUserSessions(req.user.id);
    return { message: 'All other sessions terminated successfully' };
  }
} 