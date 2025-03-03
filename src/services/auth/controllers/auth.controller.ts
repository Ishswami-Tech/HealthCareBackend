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
    summary: 'Login user',
    description: 'Authenticate user and return access token with role-specific data and permissions'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', example: 'user@example.com' },
        password: { type: 'string', example: 'password123' }
      }
    }
  })
  @ApiResponse({ 
    status: 200,
    description: 'User successfully logged in',
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
            role: { type: 'string', enum: ['SUPER_ADMIN', 'CLINIC_ADMIN', 'DOCTOR', 'PATIENT', 'RECEPTIONIST'] },
            name: { type: 'string' }
          }
        },
        redirectPath: { type: 'string' },
        permissions: { 
          type: 'array',
          items: { type: 'string' }
        }
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() loginDto: LoginDto, @Req() request: any) {
    const user = await this.authService.validateUser(loginDto.email, loginDto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
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

  @Post('forgot-password')
  @Public()
  @ApiOperation({
    summary: 'Request password reset',
    description: 'Initiates the password reset process by sending a reset link to the user\'s email'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          format: 'email',
          example: 'user@example.com'
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Password reset email sent successfully'
  })
  async forgotPassword(@Body('email') email: string): Promise<void> {
    await this.authService.forgotPassword(email);
  }

  @Post('reset-password')
  @Public()
  @ApiOperation({
    summary: 'Reset password',
    description: 'Resets user password using the token received via email'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          description: 'Reset token received via email'
        },
        newPassword: {
          type: 'string',
          description: 'New password (must meet security requirements)'
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Password reset successful'
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid password format or requirements not met'
  })
  async resetPassword(
    @Body('token') token: string,
    @Body('newPassword') newPassword: string
  ): Promise<void> {
    await this.authService.resetPassword(token, newPassword);
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
} 