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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { CreateUserDto, UserResponseDto } from '../../../libs/dtos/user.dto';
import { JwtAuthGuard } from '../../../libs/guards/jwt-auth.guard';
import { Public } from '../../../libs/decorators/public.decorator';
import { AuthService } from '../services/auth.service';
import { LoginDto } from '../../../libs/dtos/login.dto';
import { EmailService } from '../../../shared/messaging/email/email.service';
import { EmailTemplate } from '../../../libs/types/email.types';

@ApiTags('auth')
@Controller('auth')
@ApiBearerAuth()
export class AuthController {
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
    description: 'Email already registered or invalid input'
  })
  async register(@Body() createUserDto: CreateUserDto): Promise<UserResponseDto> {
    return this.authService.register(createUserDto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login with password or OTP',
    description: 'Authenticate using either password or OTP'
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
        accessToken: { type: 'string' },
        refreshToken: { type: 'string' },
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
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: 'Logout user',
    description: 'Invalidate current session and refresh token'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Successfully logged out',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Successfully logged out' },
        timestamp: { type: 'string', example: '2025-03-02T12:00:00.000Z' }
      }
    }
  })
  async logout(@Request() req) {
    await this.authService.logout(req.user.sub);
    return {
      message: 'Successfully logged out',
      timestamp: new Date().toISOString()
    };
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
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset password',
    description: 'Resets user password using the token received via email'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        newPassword: { type: 'string', minLength: 8 }
      },
      required: ['token', 'newPassword']
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
  async resetPassword(
    @Body('token') token: string,
    @Body('newPassword') newPassword: string
  ): Promise<{ message: string }> {
    await this.authService.resetPassword(token, newPassword);
    return { message: 'Password reset successful' };
  }

  @Post('test-email')
  @Public()
  @ApiOperation({ summary: 'Test email service' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', example: 'user@example.com' }
      }
    }
  })
  @ApiResponse({ 
    status: 200,
    description: 'Email test result',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        message: { type: 'string' },
        timestamp: { type: 'string' }
      }
    }
  })
  async testEmail(@Body() body: { email: string }) {
    try {
      const result = await this.emailService.sendEmail({
        to: body.email,
        subject: 'Test Email from Healthcare App',
        template: EmailTemplate.VERIFICATION,
        context: {
          verificationUrl: 'https://example.com/verify',
          name: 'Test User'
        }
      });

      return {
        success: result,
        message: result ? 'Email sent successfully' : 'Failed to send email',
        timestamp: new Date()
      };
    } catch (error) {
      return {
        success: false,
        message: `Error sending email: ${error.message}`,
        timestamp: new Date()
      };
    }
  }

  @Public()
  @Post('request-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request OTP for login',
    description: 'Send an OTP to the user\'s email and/or phone for login'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email' },
        deliveryMethod: { 
          type: 'string', 
          enum: ['email', 'sms', 'both'],
          description: 'How to deliver the OTP (email, SMS, or both)',
          default: 'email'
        }
      },
      required: ['email']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'OTP sent successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'OTP sent to your email and/or phone' }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'User not found or invalid email' })
  @ApiResponse({ status: 401, description: 'Failed to send OTP' })
  async requestOTP(
    @Body('email') email: string,
    @Body('deliveryMethod') deliveryMethod: 'email' | 'sms' | 'both' = 'email'
  ): Promise<{ message: string }> {
    try {
      await this.authService.requestLoginOTP(email, deliveryMethod);
      
      let message = 'OTP sent to your ';
      if (deliveryMethod === 'email') {
        message += 'email';
      } else if (deliveryMethod === 'sms') {
        message += 'phone';
      } else {
        message += 'email and phone';
      }
      
      return { message };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new UnauthorizedException('Failed to send OTP');
    }
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify OTP and login',
    description: 'Verify the OTP sent to the user and log them in'
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email', 'otp'],
      properties: {
        email: { type: 'string' },
        otp: { type: 'string' }
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
  @ApiResponse({ status: 401, description: 'Invalid OTP' })
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
      
      return {
        ...loginData,
        redirectUrl: `${redirectUrl}${redirectPath}`
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
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