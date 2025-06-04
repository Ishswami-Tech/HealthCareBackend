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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { CreateUserDto, UserResponseDto } from '../../../libs/dtos/user.dto';
import { JwtAuthGuard } from '../../../libs/guards/jwt-auth.guard';
import { Public } from '../../../libs/decorators/public.decorator';
import { AuthService } from '../services/auth.service';
import { LoginDto } from '../../../libs/dtos/login.dto';
import { EmailService } from '../../../shared/messaging/email/email.service';
import { EmailTemplate } from '../../../libs/types/email.types';
import { Logger } from '@nestjs/common';
import { LogoutDto } from '../../../libs/dtos/logout.dto';

@ApiTags('auth')
@Controller('auth')
@ApiBearerAuth()
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly emailService: EmailService
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({ 
    summary: 'Register a new user',
    description: 'Create a new user account with role-specific details'
  })
  @ApiResponse({ 
    status: 201, 
    type: UserResponseDto,
    description: 'User successfully registered'
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Bad request - validation error or user already exists'
  })
  @ApiResponse({ 
    status: 500, 
    description: 'Internal server error'
  })
  async register(@Body() createUserDto: CreateUserDto): Promise<UserResponseDto> {
    try {
      return await this.authService.register(createUserDto);
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
  @Post('register-with-clinic')
  @ApiOperation({ 
    summary: 'Register a new user with clinic association',
    description: 'Create a new user account and associate it with a specific clinic'
  })
  @ApiResponse({ 
    status: 201, 
    type: UserResponseDto,
    description: 'User successfully registered and associated with clinic'
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Bad request - validation error or user already exists'
  })
  @ApiResponse({ 
    status: 404, 
    description: 'Clinic not found'
  })
  @ApiResponse({ 
    status: 500, 
    description: 'Internal server error'
  })
  async registerWithClinic(
    @Body() createUserDto: CreateUserDto,
    @Body('appName') appName: string
  ): Promise<UserResponseDto> {
    try {
      if (!appName) {
        throw new BadRequestException('App name is required for clinic registration');
      }
      
      return await this.authService.registerWithClinic(createUserDto, appName);
    } catch (error) {
      this.logger.error(`Clinic registration failed: ${error.message}`, error.stack);
      
      if (error instanceof HttpException) {
        throw error;
      }
      
      if (error.code === 'P2002') {
        throw new BadRequestException('User with this email already exists');
      }
      
      throw new InternalServerErrorException('Registration failed');
    }
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login with password or OTP',
    description: 'Authenticate using either password or OTP. Returns access token, session ID, and user information.'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email' },
        password: { type: 'string' },
        otp: { type: 'string' }
      },
      required: ['email']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Login successful',
    schema: {
      type: 'object',
      properties: {
        access_token: { type: 'string', description: 'JWT access token' },
        session_id: { type: 'string', description: 'Session ID required for all authenticated requests' },
        token_type: { type: 'string', example: 'Bearer' },
        expires_in: { type: 'number', description: 'Token expiration time in seconds', example: 86400 },
        user: { 
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            role: { type: 'string' }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials or OTP' })
  async login(
    @Body('email') email: string,
    @Body('password') password?: string,
    @Body('otp') otp?: string,
    @Req() request?: any
  ): Promise<any> {
    if (!password && !otp) {
      throw new BadRequestException('Either password or OTP must be provided');
    }
    
    let user: any;
    
    if (password) {
      // Login with password
      user = await this.authService.validateUser(email, password);
      if (!user) {
        throw new UnauthorizedException('Invalid email or password');
      }
    } else {
      // Login with OTP
      const isOtpValid = await this.authService.verifyOTP(email, otp);
      if (!isOtpValid) {
        throw new UnauthorizedException('Invalid or expired OTP');
      }
      user = await this.authService.findUserByEmail(email);
      if (!user) {
        throw new UnauthorizedException('User not found');
      }
    }
    
    return this.authService.login(user, request);
  }

  @Post('logout')
  @ApiOperation({
    summary: 'Logout user',
    description: 'Logs out the user from the current session or all devices. Invalidates the JWT token.'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        sessionId: { 
          type: 'string', 
          description: 'Optional session ID to logout from a specific session',
          example: 'session_123456789'
        },
        allDevices: { 
          type: 'boolean', 
          description: 'Whether to logout from all devices',
          example: false,
          default: false
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'User logged out successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Logged out successfully' }
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Unauthorized - Invalid or missing token' })
  @UseGuards(JwtAuthGuard)
  async logout(
    @Req() req,
    @Body() logoutDto: LogoutDto,
  ): Promise<{ message: string }> {
    const userId = req.user.sub;
    const token = req.headers.authorization?.split(' ')[1];
    
    await this.authService.logout(
      userId,
      logoutDto.sessionId,
      logoutDto.allDevices,
      token,
    );
    
    return { message: 'Logged out successfully' };
  }

  @Post('refresh')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: 'Refresh access token',
    description: 'Generate new access token using refresh token'
  })
  @ApiResponse({ 
    status: 200,
    description: 'New access token generated',
    schema: {
      type: 'object',
      properties: {
        access_token: { type: 'string' },
        refresh_token: { type: 'string' }
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(@Request() req) {
    return this.authService.refreshToken(req.user.sub);
  }

  @Get('verify')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ 
    summary: 'Verify current token',
    description: 'Check if the current JWT token is valid and active'
  })
  @ApiResponse({ 
    status: 200,
    description: 'Token is valid',
    schema: {
      type: 'object',
      properties: {
        isValid: { type: 'boolean' },
        user: { 
          type: 'object',
          properties: {
            id: { type: 'string' },
            role: { type: 'string' }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired token' })
  async verifyToken(@Request() req) {
    const isValid = await this.authService.validateToken(req.user.sub);
    return {
      isValid,
      user: {
        id: req.user.sub,
        role: req.user.role
      }
    };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Forgot password',
    description: 'Initiates the password reset process by sending a reset link to the user\'s email'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email' }
      },
      required: ['email']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Password reset email sent',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Password reset instructions sent to your email' }
      }
    }
  })
  async forgotPassword(@Body('email') email: string): Promise<{ message: string }> {
    await this.authService.forgotPassword(email);
    // Always return success to prevent email enumeration
    return { message: 'Password reset instructions sent to your email' };
  }

  @Public()
  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset password',
    description: 'Reset password using the token received via email'
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['token', 'newPassword'],
      properties: {
        token: { type: 'string' },
        newPassword: { type: 'string' }
      }
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Password reset successful',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Password reset successful' }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  @ApiResponse({ status: 400, description: 'Password does not meet requirements' })
  async resetPassword(
    @Body('token') token: string,
    @Body('newPassword') newPassword: string
  ): Promise<{ message: string }> {
    await this.authService.resetPassword(token, newPassword);
    return { message: 'Password reset successful' };
  }

  @Post('request-otp')
  @ApiOperation({
    summary: 'Request OTP for login',
    description: 'Sends an OTP through all available channels (WhatsApp, SMS, Email) based on the provided identifier',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['identifier'],
      properties: {
        identifier: {
          type: 'string',
          description: 'Email address or phone number',
          example: 'user@example.com or +1234567890',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'OTP sent successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'OTP sent successfully via Email, WhatsApp, SMS' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request',
  })
  async requestOTP(
    @Body('identifier') identifier: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.authService.requestLoginOTP(identifier);
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify OTP and login',
    description: 'Verify the OTP sent to the user and log them in. This endpoint works with OTPs sent via any delivery method (WhatsApp, SMS, or Email).'
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email', 'otp'],
      properties: {
        email: { type: 'string', format: 'email' },
        otp: { type: 'string', minLength: 6, maxLength: 6, pattern: '^[0-9]+$' }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    schema: {
      type: 'object',
      properties: {
        access_token: { type: 'string', description: 'JWT access token' },
        refresh_token: { type: 'string', description: 'JWT refresh token' },
        user: { 
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            role: { type: 'string' },
            name: { type: 'string' },
            firstName: { type: 'string' },
            lastName: { type: 'string' }
          }
        },
        redirectUrl: { type: 'string', description: 'URL to redirect the user to after successful login' }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Bad request - Missing required fields' })
  @ApiResponse({ status: 401, description: 'Invalid OTP or user not found' })
  @ApiResponse({ status: 429, description: 'Too many failed attempts' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async verifyOTP(
    @Body('email') email: string,
    @Body('otp') otp: string,
    @Req() request: any
  ): Promise<any> {
    try {
      // Verify the OTP
      const isOtpValid = await this.authService.verifyOTP(email, otp);
      if (!isOtpValid) {
        throw new UnauthorizedException('Invalid or expired OTP');
      }
      
      // Find the user
      const user = await this.authService.findUserByEmail(email);
      if (!user) {
        throw new UnauthorizedException('User not found');
      }
      
      // Log the user in
      const loginData = await this.authService.login(user, request);
      
      // Add a redirect URL to the response
      const redirectUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      const redirectPath = this.authService.getRedirectPathForRole(user.role);
      
      this.logger.log(`User ${email} successfully logged in using OTP`);
      
      return {
        ...loginData,
        redirectUrl: `${redirectUrl}${redirectPath}`
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (error.message && error.message.includes('Too many attempts')) {
        throw new HttpException('Too many failed OTP attempts', HttpStatus.TOO_MANY_REQUESTS);
      }
      this.logger.error(`Failed to verify OTP for ${email}: ${error.message}`);
      throw new InternalServerErrorException('Failed to verify OTP');
    }
  }

  @Public()
  @Post('check-otp-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check if user has an active OTP',
    description: 'Check if a user has an active OTP that can be used for login'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email' }
      },
      required: ['email']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'OTP status retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        hasActiveOTP: { type: 'boolean', example: true }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'User not found or invalid email' })
  @ApiResponse({ status: 401, description: 'Failed to check OTP status' })
  async checkOTPStatus(@Body('email') email: string): Promise<{ hasActiveOTP: boolean }> {
    try {
      const user = await this.authService.findUserByEmail(email);
      if (!user) {
        throw new BadRequestException('User not found');
      }
      
      const hasActiveOTP = await this.authService.hasActiveOTP(user.id);
      return { hasActiveOTP };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new UnauthorizedException('Failed to check OTP status');
    }
  }

  @Public()
  @Post('invalidate-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Invalidate active OTP',
    description: 'Invalidate any active OTP for a user'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email' }
      },
      required: ['email']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'OTP invalidated successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'OTP invalidated successfully' }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'User not found or invalid email' })
  @ApiResponse({ status: 401, description: 'Failed to invalidate OTP' })
  async invalidateOTP(@Body('email') email: string): Promise<{ message: string }> {
    try {
      const user = await this.authService.findUserByEmail(email);
      if (!user) {
        throw new BadRequestException('User not found');
      }
      
      await this.authService.invalidateOTP(user.id);
      return { message: 'OTP invalidated successfully' };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new UnauthorizedException('Failed to invalidate OTP');
    }
  }

  @Public()
  @Post('magic-link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request magic link for passwordless login',
    description: 'Send a magic link to the user\'s email for passwordless login'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email' }
      },
      required: ['email']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Magic link sent successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Magic link sent to your email' }
      }
    }
  })
  async requestMagicLink(@Body('email') email: string): Promise<{ message: string }> {
    await this.authService.sendMagicLink(email);
    // Always return success to prevent email enumeration
    return { message: 'Magic link sent to your email' };
  }

  @Public()
  @Post('verify-magic-link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify magic link token',
    description: 'Verify a magic link token and log the user in'
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['token'],
      properties: {
        token: { type: 'string' }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    schema: {
      type: 'object',
      properties: {
        access_token: { type: 'string' },
        refresh_token: { type: 'string' },
        user: { 
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            role: { type: 'string' }
          }
        },
        redirectUrl: { type: 'string', description: 'URL to redirect the user to after successful login' }
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Invalid or expired magic link' })
  async verifyMagicLink(
    @Body('token') token: string,
    @Req() request: any
  ): Promise<any> {
    try {
      // Verify the magic link token and get login data
      const loginData = await this.authService.verifyMagicLink(token, request);
      
      // Add a redirect URL to the response
      const redirectUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      
      return {
        ...loginData,
        redirectUrl: `${redirectUrl}/dashboard`
      };
    } catch (error) {
      throw new UnauthorizedException('Invalid or expired magic link');
    }
  }

  @Public()
  @Post('social/google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login with Google',
    description: 'Authenticate using Google OAuth token'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        token: { 
          type: 'string', 
          description: 'Google OAuth ID token' 
        }
      },
      required: ['token']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Login successful',
    schema: {
      type: 'object',
      properties: {
        access_token: { type: 'string' },
        refresh_token: { type: 'string' },
        user: { 
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            role: { type: 'string' }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Invalid Google token' })
  async googleLogin(
    @Body('token') token: string,
    @Req() request: any
  ): Promise<any> {
    try {
      // Verify Google token
      const ticket = await this.authService.verifyGoogleToken(token);
      const payload = ticket.getPayload();
      
      // Handle Google login
      return this.authService.handleGoogleLogin(payload, request);
    } catch (error) {
      throw new UnauthorizedException('Invalid Google token');
    }
  }

  @Public()
  @Post('social/facebook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login with Facebook',
    description: 'Authenticate using Facebook access token'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        token: { 
          type: 'string', 
          description: 'Facebook access token' 
        }
      },
      required: ['token']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Login successful',
    schema: {
      type: 'object',
      properties: {
        access_token: { type: 'string' },
        refresh_token: { type: 'string' },
        user: { 
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            role: { type: 'string' }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Invalid Facebook token' })
  async facebookLogin(
    @Body('token') token: string,
    @Req() request: any
  ): Promise<any> {
    try {
      // Verify Facebook token and get user data
      const userData = await this.authService.verifyFacebookToken(token);
      
      // Handle Facebook login
      return this.authService.handleFacebookLogin(userData, request);
    } catch (error) {
      throw new UnauthorizedException('Invalid Facebook token');
    }
  }

  @Public()
  @Post('social/apple')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login with Apple',
    description: 'Authenticate using Apple ID token'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        token: { 
          type: 'string', 
          description: 'Apple ID token' 
        }
      },
      required: ['token']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Login successful',
    schema: {
      type: 'object',
      properties: {
        access_token: { type: 'string' },
        refresh_token: { type: 'string' },
        user: { 
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            role: { type: 'string' }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Invalid Apple token' })
  async appleLogin(
    @Body('token') token: string,
    @Req() request: any
  ): Promise<any> {
    try {
      // Verify Apple token and get user data
      const userData = await this.authService.verifyAppleToken(token);
      
      // Handle Apple login
      return this.authService.handleAppleLogin(userData, request);
    } catch (error) {
      throw new UnauthorizedException('Invalid Apple token');
    }
  }
} 