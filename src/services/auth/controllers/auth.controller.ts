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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { CreateUserDto, UserResponseDto, SimpleCreateUserDto } from '../../../libs/dtos/user.dto';
import { JwtAuthGuard } from '../../../libs/guards/jwt-auth.guard';
import { Public } from '../../../libs/decorators/public.decorator';
import { AuthService } from '../services/auth.service';
import { EmailService } from '../../../shared/messaging/email/email.service';
import { Logger } from '@nestjs/common';
import { LoginDto, LogoutDto, PasswordResetDto, AuthResponse, LoginRequestDto, ForgotPasswordRequestDto, VerifyOtpRequestDto, RequestOtpDto, InvalidateOtpDto, CheckOtpStatusDto, RegisterDto } from '../../../libs/dtos/auth.dtos';
import { Role } from '../../../shared/database/prisma/prisma.types';
import * as crypto from 'crypto';
import { SessionService } from '../services/session.service';
import { ClinicId, OptionalClinicId } from '../../../libs/decorators/clinic.decorator';

@ApiTags('auth')
@Controller('auth')
@ApiBearerAuth()
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly emailService: EmailService,
    private readonly sessionService: SessionService
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
    try {
      // Merge clinicId from decorator with DTO if provided
      const registrationData = clinicId ? { ...registerDto, clinicId } : registerDto;
      return await this.authService.register(registrationData);
    } catch (error) {
      this.logger.error(`Registration failed: ${error.message}`, error.stack);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      if (error.code === 'P2002') {
        throw new BadRequestException('User with this email already exists');
      }
      
      throw new InternalServerErrorException('Registration failed');
    }
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login with password or OTP',
    description: 'Authenticate using either password or OTP. Clinic ID can be provided via X-Clinic-ID header, request body, or query parameter for clinic validation.'
  })
  @ApiBody({ type: LoginRequestDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Login successful',
    type: AuthResponse
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials or user not associated with clinic' })
  @ApiResponse({ status: 404, description: 'Clinic not found' })
  async login(
    @Body() body: LoginRequestDto,
    @OptionalClinicId() clinicId?: string,
    @Req() request?: any
  ): Promise<any> {
    const { email, password, otp } = body;
    
    if (!password && !otp) {
      throw new BadRequestException('Either password or OTP must be provided');
    }

    let user: any;
    if (password) {
      user = await this.authService.validateUser(email, password);
      if (!user) {
        throw new UnauthorizedException('Invalid email or password');
      }
    } else {
      const isOtpValid = await this.authService.verifyOTP(email, otp);
      if (!isOtpValid) {
        throw new UnauthorizedException('Invalid or expired OTP');
      }
      user = await this.authService.findUserByEmail(email);
      if (!user) {
        throw new UnauthorizedException('User not found');
      }
      if (!user.isVerified) {
        user = await this.authService.markUserAsVerified(user.id);
      }
    }

    return this.authService.login(user, request, undefined, clinicId);
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
  async logout(
    @Req() req,
    @Body() logoutDto: LogoutDto
  ): Promise<{ message: string }> {
    try {
      const { sessionId, allDevices } = logoutDto;
      const token = req.headers.authorization?.replace('Bearer ', '');
      
      await this.authService.logout(
        req.user.id,
        sessionId,
        allDevices,
        token
      );

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
  async refresh(@Request() req) {
    try {
      const deviceFingerprint = this.authService['generateDeviceFingerprint'](req);
      return await this.authService.refreshToken(req.user.id, deviceFingerprint);
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
  async verifyToken(@Request() req) {
    try {
      const isValid = await this.authService.validateToken(req.user.id);
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
      await this.authService.forgotPassword(body.email);
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
      await this.authService.resetPassword(passwordResetDto.token, passwordResetDto.newPassword);
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
      return await this.authService.requestLoginOTP(body.identifier);
    } catch (error) {
      this.logger.error(`OTP request failed: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to send OTP');
    }
  }

  @Public()
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
      
      const isOtpValid = await this.authService.verifyOTP(email, otp);
      if (!isOtpValid) {
        throw new UnauthorizedException('Invalid or expired OTP');
      }
      
      const user = await this.authService.findUserByEmail(email);
      if (!user) {
        throw new UnauthorizedException('User not found');
      }
      
      if (!user.isVerified) {
        await this.authService.markUserAsVerified(user.id);
      }
      
      return this.authService.login(user, request, undefined, clinicId);
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
      const user = await this.authService.findUserByEmail(body.email);
      if (!user) {
        return { hasActiveOTP: false };
      }
      
      const hasActiveOTP = await this.authService.hasActiveOTP(user.id);
      return { hasActiveOTP };
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
      const user = await this.authService.findUserByEmail(body.email);
      if (!user) {
        return { message: 'OTP invalidated' };
      }
      
      await this.authService.invalidateOTP(user.id);
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
  async requestMagicLink(@Body('email') email: string): Promise<{ message: string }> {
    try {
      await this.authService.sendMagicLink(email);
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
  async verifyMagicLink(
    @Body('token') token: string,
    @Req() request: any
  ): Promise<any> {
    try {
      return await this.authService.verifyMagicLink(token, request);
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
  async googleLogin(
    @Body() body: { token?: string; code?: string; redirectUri?: string },
    @Req() request: any,
    @OptionalClinicId() clinicId?: string
  ): Promise<any> {
    try {
      let googleUser: any;
      
      if (body.code && body.redirectUri) {
        // Exchange OAuth code for tokens and get user info
        googleUser = await this.authService.exchangeGoogleOAuthCode(body.code, body.redirectUri);
      } else if (body.token) {
        // Verify Google ID token
        const ticket = await this.authService.verifyGoogleToken(body.token);
        googleUser = ticket.getPayload();
      } else {
        throw new BadRequestException('Either token or code with redirectUri must be provided');
      }
      
      if (!googleUser || !googleUser.email) {
        throw new UnauthorizedException('Invalid Google user data');
      }
      
      // Handle Google login with clinic context
      const response = await this.authService.handleGoogleLogin(googleUser, request);
      
      // If clinicId is provided, add clinic context to response
      if (clinicId) {
        const clinic = await this.authService['prisma'].clinic.findUnique({
          where: { id: clinicId }
        });
        
        if (clinic) {
          return {
            ...response,
            clinic: {
              id: clinic.id,
              name: clinic.name,
              appName: clinic.app_name
            }
          };
        }
      }
      
      return response;
    } catch (error) {
      this.logger.error(`Google login failed: ${error.message}`, error.stack);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      throw new InternalServerErrorException('Google login failed');
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
      const facebookUser = await this.authService.verifyFacebookToken(token);
      
      if (!facebookUser || !facebookUser.email) {
        throw new UnauthorizedException('Invalid Facebook user data');
      }
      
      // Handle Facebook login with clinic context
      const response = await this.authService.handleFacebookLogin(facebookUser, request);
      
      // If clinicId is provided, add clinic context to response
      if (clinicId) {
        const clinic = await this.authService['prisma'].clinic.findUnique({
          where: { id: clinicId }
        });
        
        if (clinic) {
          return {
            ...response,
            clinic: {
              id: clinic.id,
              name: clinic.name,
              appName: clinic.app_name
            }
          };
        }
      }
      
      return response;
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
      const appleUser = await this.authService.verifyAppleToken(token);
      
      if (!appleUser || !appleUser.email) {
        throw new UnauthorizedException('Invalid Apple user data');
      }
      
      // Handle Apple login with clinic context
      const response = await this.authService.handleAppleLogin(appleUser, request);
      
      // If clinicId is provided, add clinic context to response
      if (clinicId) {
        const clinic = await this.authService['prisma'].clinic.findUnique({
          where: { id: clinicId }
        });
        
        if (clinic) {
          return {
            ...response,
            clinic: {
              id: clinic.id,
              name: clinic.name,
              appName: clinic.app_name
            }
          };
        }
      }
      
      return response;
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
    return await this.authService.getUserSessions(req.user.id);
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
    await this.authService.logout(req.user.id, sessionId, false);
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
    await this.authService.logout(req.user.id, undefined, true);
    return { message: 'All other sessions terminated successfully' };
  }
} 