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
import { LoginDto, LogoutDto, PasswordResetDto, AuthResponse, LoginRequestDto, ForgotPasswordRequestDto, VerifyOtpRequestDto, RequestOtpDto, InvalidateOtpDto, CheckOtpStatusDto } from '../../../libs/dtos/auth.dtos';
import { Role } from '@prisma/client';
import * as crypto from 'crypto';
import { SessionService } from '../services/session.service';

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
    description: 'Create a new user account with basic details and default PATIENT role'
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
  async register(@Body() createUserDto: SimpleCreateUserDto): Promise<UserResponseDto> {
    try {
      // Convert SimpleCreateUserDto to CreateUserDto with default role
      const fullCreateUserDto = {
        ...createUserDto,
        role: Role.PATIENT,
        gender: undefined // Make gender optional
      };
      
      return await this.authService.register(fullCreateUserDto);
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

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login with password or OTP',
    description: 'Authenticate using either password or OTP'
  })
  @ApiBody({ type: LoginRequestDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Login successful',
    type: AuthResponse
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() body: LoginRequestDto,
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
    return this.authService.login(user, request);
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
    description: 'New access token generated'
  })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  async refresh(@Request() req) {
    const deviceFingerprint = crypto
      .createHash('sha256')
      .update(JSON.stringify({
        userAgent: req.headers['user-agent'],
        acceptLanguage: req.headers['accept-language'],
        secChUa: req.headers['sec-ch-ua'],
        platform: req.headers['sec-ch-ua-platform'],
        ipAddress: req.ip || req.headers['x-forwarded-for']
      }))
      .digest('hex');
    return this.authService.refreshToken(req.user.sub, deviceFingerprint);
  }

  @Get('verify')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ 
    summary: 'Verify current token',
    description: 'Check if the current JWT token is valid'
  })
  @ApiResponse({ 
    status: 200,
    description: 'Token is valid'
  })
  @ApiResponse({ status: 401, description: 'Invalid token' })
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
    description: 'Initiates the password reset process'
  })
  @ApiBody({ type: ForgotPasswordRequestDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Password reset email sent'
  })
  async forgotPassword(@Body() body: ForgotPasswordRequestDto): Promise<{ message: string }> {
    await this.authService.forgotPassword(body.email);
    return { message: 'Password reset instructions sent to your email' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset password',
    description: 'Reset password using the token received via email'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Password reset successful'
  })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async resetPassword(
    @Body() passwordResetDto: PasswordResetDto
  ): Promise<{ message: string }> {
    await this.authService.resetPassword(
      passwordResetDto.token,
      passwordResetDto.newPassword
    );
    return { message: 'Password reset successful' };
  }

  @Public()
  @Post('request-otp')
  @ApiOperation({
    summary: 'Request OTP for login',
    description: 'Sends an OTP through available channels'
  })
  @ApiBody({ type: RequestOtpDto })
  @ApiResponse({
    status: 200,
    description: 'OTP sent successfully'
  })
  async requestOTP(
    @Body() body: RequestOtpDto,
  ): Promise<{ success: boolean; message: string }> {
    return this.authService.requestLoginOTP(body.identifier);
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify OTP and login',
    description: 'Verify the OTP and log the user in'
  })
  @ApiBody({ type: VerifyOtpRequestDto })
  @ApiResponse({
    status: 200,
    description: 'Login successful'
  })
  @ApiResponse({ status: 401, description: 'Invalid OTP' })
  async verifyOTP(
    @Body() body: VerifyOtpRequestDto,
    @Req() request: any
  ): Promise<any> {
    const { email, otp } = body;
    try {
      const isOtpValid = await this.authService.verifyOTP(email, otp);
      if (!isOtpValid) {
        throw new UnauthorizedException('Invalid or expired OTP');
      }
      const user = await this.authService.findUserByEmail(email);
      if (!user) {
        throw new UnauthorizedException('User not found');
      }
      const loginData = await this.authService.login(user, request);
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
      this.logger.error(`Failed to verify OTP for ${email}: ${error.message}`);
      throw new InternalServerErrorException('Failed to verify OTP');
    }
  }

  @Public()
  @Post('check-otp-status')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check if user has an active OTP',
    description: 'Check if a user has an active OTP'
  })
  @ApiBody({ type: CheckOtpStatusDto })
  @ApiResponse({ 
    status: 200, 
    description: 'OTP status retrieved'
  })
  async checkOTPStatus(@Body() body: CheckOtpStatusDto): Promise<{ hasActiveOTP: boolean }> {
    const { email } = body;
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
  @ApiBody({ type: InvalidateOtpDto })
  @ApiResponse({ 
    status: 200, 
    description: 'OTP invalidated successfully'
  })
  async invalidateOTP(@Body() body: InvalidateOtpDto): Promise<{ message: string }> {
    const { email } = body;
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
    summary: 'Login with Google (ID token or OAuth code)',
    description: 'Authenticate using Google OAuth ID token (popup/credential flow) or OAuth 2.0 code (redirect)'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Google OAuth ID token (popup/credential flow)' },
        code: { type: 'string', description: 'Google OAuth 2.0 code (redirect flow)' },
        redirectUri: { type: 'string', description: 'Redirect URI used in Google OAuth (required if using code)' }
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
        session_id: { type: 'string' },
        user: { 
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            role: { type: 'string' },
            isVerified: { type: 'boolean' },
            googleId: { type: 'string' },
            profileComplete: { type: 'boolean' },
            profilePicture: { type: 'string' }
          }
        },
        isNew: { type: 'boolean' },
        redirectUrl: { type: 'string' }
      }
    }
  })
  @ApiResponse({ status: 401, description: 'Invalid Google token or code' })
  async googleLogin(
    @Body() body: { token?: string; code?: string; redirectUri?: string },
    @Req() request: any
  ): Promise<any> {
    try {
      let googleUser: any;
      let payload: any;

      if (body.token) {
        this.logger.debug('Starting Google login process (ID token flow)');
        this.logger.debug('Received token:', body.token.substring(0, 10) + '...');
        // Existing logic: verify ID token
        const ticket = await this.authService.verifyGoogleToken(body.token);
        payload = ticket.getPayload();
        if (!payload) throw new UnauthorizedException('Invalid Google token');
        this.logger.debug('Google token verified successfully');
        this.logger.debug('Token payload email:', payload.email);
        googleUser = payload;
      } else if (body.code && body.redirectUri) {
        this.logger.debug('Starting Google login process (OAuth code flow)');
        this.logger.debug('Received code:', body.code.substring(0, 10) + '...');
        googleUser = await this.authService.exchangeGoogleOAuthCode(body.code, body.redirectUri);
        payload = googleUser;
        this.logger.debug('Google OAuth code exchanged successfully');
        this.logger.debug('OAuth user email:', googleUser.email);
      } else {
        throw new BadRequestException('Either token or code+redirectUri must be provided');
      }

      // Use your existing handler
      const response = await this.authService.handleGoogleLogin(googleUser, request);
      this.logger.debug('Google login handled successfully');

      // Ensure response includes name fields
      const enhancedResponse = {
        ...response,
        user: {
          ...response.user,
          firstName: response.user.firstName || payload.given_name,
          lastName: response.user.lastName || payload.family_name,
          name: response.user.name || `${payload.given_name || ''} ${payload.family_name || ''}`.trim(),
          profilePicture: response.user.profilePicture || payload.picture
        },
        isNew: !response.user.googleId, // Indicate if this is a new Google login
        redirectUrl: this.authService.getRedirectPathForRole(response.user.role)
      };

      return enhancedResponse;
    } catch (error) {
      this.logger.error('Google login failed:', error);
      throw new UnauthorizedException(
        error instanceof Error ? `Invalid Google login: ${error.message}` : 'Invalid Google login'
      );
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

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List all active sessions for the current user' })
  @ApiResponse({ status: 200, description: 'List of active sessions' })
  async getActiveSessions(@Request() req) {
    const userId = req.user.sub;
    return this.sessionService.getActiveSessions(userId);
  }

  @Delete('sessions/:sessionId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Terminate a specific session by sessionId' })
  @ApiResponse({ status: 200, description: 'Session terminated' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async terminateSession(@Request() req, @Param('sessionId') sessionId: string) {
    const userId = req.user.sub;
    await this.sessionService.terminateSession(userId, sessionId);
    return { message: 'Session terminated' };
  }

  @Delete('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Terminate all sessions except the current one' })
  @ApiResponse({ status: 200, description: 'All other sessions terminated' })
  async terminateAllOtherSessions(@Request() req) {
    const userId = req.user.sub;
    const currentSessionId = req.user.sessionId;
    const sessions = await this.sessionService.getActiveSessions(userId);
    const toTerminate = sessions.filter(s => s.sessionId !== currentSessionId);
    await Promise.all(toTerminate.map(s => this.sessionService.terminateSession(userId, s.sessionId)));
    return { message: 'All other sessions terminated' };
  }
} 