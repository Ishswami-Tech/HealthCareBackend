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
import { JwtAuthGuard, Public, ClinicId, OptionalClinicId } from '../../../libs/core';
import { RbacGuard } from '../../../libs/core/rbac/rbac.guard';
import { ClinicAuthService } from '../';
import { EmailService } from '../../../libs/communication';
import { Logger } from '@nestjs/common';
import { LoginDto, LogoutDto, PasswordResetDto, AuthResponse, LoginRequestDto, ForgotPasswordRequestDto, VerifyOtpRequestDto, RequestOtpDto, InvalidateOtpDto, CheckOtpStatusDto, RegisterDto } from '../../../libs/dtos/auth.dto';
import { SessionManagementService } from '../../../libs/core/session/session-management.service';
import { RbacService } from '../../../libs/core/rbac/rbac.service';
import { RequireResourcePermission } from '../../../libs/core/rbac/rbac.decorators';

@ApiTags('Clinic Auth')
@Controller('clinic/auth')
@ApiBearerAuth()
export class ClinicAuthController {
  private readonly logger = new Logger(ClinicAuthController.name);

  constructor(
    private readonly clinicAuthService: ClinicAuthService,
    private readonly emailService: EmailService,
    private readonly sessionService: SessionManagementService,
    private readonly rbacService: RbacService,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({ 
    summary: 'Register a new clinic user',
    description: 'Create a new healthcare user account (doctor, nurse, patient, etc.). Clinic ID is required for tenant association.'
  })
  @ApiResponse({ 
    status: 201, 
    type: UserResponseDto,
    description: 'Clinic user successfully registered'
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
  async registerClinicUser(
    @Body() registerDto: RegisterDto,
    @OptionalClinicId() clinicId?: string
  ): Promise<any> {
    if (!clinicId && !registerDto.clinicId) {
      throw new BadRequestException('Clinic ID is required for clinic user registration');
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
        googleId: registerDto.googleId,
        facebookId: registerDto.facebookId,
        appleId: registerDto.appleId,
      }
    };
    
    return await this.clinicAuthService.register(registrationData);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login clinic user with password or OTP',
    description: 'Authenticate healthcare users using either password or OTP. Clinic ID is required for tenant validation.'
  })
  @ApiBody({ type: LoginRequestDto })
  @ApiResponse({ 
    status: 200, 
    description: 'Clinic login successful',
    type: AuthResponse
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials or user not associated with clinic' })
  @ApiResponse({ status: 404, description: 'Clinic not found' })
  async loginClinicUser(
    @Body() loginDto: LoginRequestDto,
    @OptionalClinicId() clinicId?: string
  ): Promise<any> {
    if (!clinicId && !loginDto.clinicId) {
      throw new BadRequestException('Clinic ID is required for clinic user login');
    }

    const loginData = {
      ...loginDto,
      clinicId: clinicId || loginDto.clinicId,
      domain: 'healthcare' // Ensure healthcare domain
    };

    return await this.clinicAuthService.login(loginData);
  }

  @Public()
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Google authentication for clinic users',
    description: 'Authenticate healthcare users using Google OAuth token. Clinic ID is required for tenant validation.'
  })
  @ApiBody({ 
    schema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'Google OAuth token' },
        clinicId: { type: 'string', description: 'Clinic ID for tenant association' }
      },
      required: ['token']
    }
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Google authentication successful',
    type: AuthResponse
  })
  @ApiResponse({ status: 401, description: 'Invalid Google token' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 404, description: 'Clinic not found' })
  async googleAuth(
    @Body() googleAuthDto: { token: string; clinicId?: string },
    @OptionalClinicId() clinicId?: string
  ): Promise<any> {
    if (!clinicId && !googleAuthDto.clinicId) {
      throw new BadRequestException('Clinic ID is required for clinic user Google authentication');
    }

    const authData = {
      token: googleAuthDto.token,
      clinicId: clinicId || googleAuthDto.clinicId,
      domain: 'healthcare' as const
    };

    // Use the plugin manager directly for social auth
    return await this.clinicAuthService.login({
      email: '', // Will be extracted from Google token
      clinicId: authData.clinicId,
      metadata: {
        socialProvider: 'google',
        socialToken: authData.token,
      },
    });
  }

  @Public()
  @Post('login/otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login clinic user with OTP',
    description: 'Authenticate healthcare users using OTP. Clinic ID is required for tenant validation.'
  })
  @ApiBody({ type: RequestOtpDto })
  @ApiResponse({ 
    status: 200, 
    description: 'OTP sent successfully',
    type: Object
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials or user not associated with clinic' })
  @ApiResponse({ status: 404, description: 'Clinic not found' })
  async loginClinicUserWithOtp(
    @Body() requestOtpDto: RequestOtpDto,
    @OptionalClinicId() clinicId?: string
  ): Promise<any> {
    if (!clinicId && !requestOtpDto.clinicId) {
      throw new BadRequestException('Clinic ID is required for clinic user OTP login');
    }

    const loginData = {
      ...requestOtpDto,
      clinicId: clinicId || requestOtpDto.clinicId,
      domain: 'healthcare' as const // Ensure healthcare domain
    };

    return await this.clinicAuthService.requestOTP({
      identifier: loginData.identifier,
      purpose: 'login',
      clinicId: loginData.clinicId,
    });
  }

  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify OTP for clinic user',
    description: 'Verify OTP for healthcare user authentication.'
  })
  @ApiBody({ type: VerifyOtpRequestDto })
  @ApiResponse({ 
    status: 200, 
    description: 'OTP verified successfully',
    type: AuthResponse
  })
  @ApiResponse({ status: 401, description: 'Invalid OTP' })
  async verifyClinicUserOtp(
    @Body() verifyOtpDto: VerifyOtpRequestDto
  ): Promise<any> {
    return await this.clinicAuthService.verifyOTP({
      identifier: verifyOtpDto.email,
      otp: verifyOtpDto.otp,
      clinicId: verifyOtpDto.clinicId,
    });
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Logout clinic user',
    description: 'Logout the currently authenticated healthcare user and invalidate their session.'
  })
  @ApiResponse({ status: 200, description: 'Logout successful' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async logoutClinicUser(
    @Body() logoutDto: LogoutDto,
    @Request() req: any
  ): Promise<any> {
    return await this.clinicAuthService.logout({
      userId: req.user.id,
      sessionId: logoutDto.sessionId,
      clinicId: req.user.clinicId,
    });
  }

  @Public()
  @Post('forgot-password')
  @ApiOperation({
    summary: 'Request password reset for clinic user',
    description: 'Send password reset email to healthcare user.'
  })
  @ApiBody({ type: ForgotPasswordRequestDto })
  @ApiResponse({ status: 200, description: 'Password reset email sent' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async forgotClinicUserPassword(
    @Body() forgotPasswordDto: ForgotPasswordRequestDto,
    @OptionalClinicId() clinicId?: string
  ): Promise<any> {
    return await this.clinicAuthService.forgotPassword({
      email: forgotPasswordDto.email,
      clinicId: clinicId || forgotPasswordDto.clinicId,
    });
  }

  @Public()
  @Post('reset-password')
  @ApiOperation({
    summary: 'Reset clinic user password',
    description: 'Reset healthcare user password using reset token.'
  })
  @ApiBody({ type: PasswordResetDto })
  @ApiResponse({ status: 200, description: 'Password reset successful' })
  @ApiResponse({ status: 400, description: 'Invalid reset token' })
  async resetClinicUserPassword(
    @Body() passwordResetDto: PasswordResetDto
  ): Promise<any> {
    return await this.clinicAuthService.resetPassword({
      token: passwordResetDto.token,
      newPassword: passwordResetDto.newPassword,
    });
  }

  @Get('profile')
  @UseGuards(JwtAuthGuard, RbacGuard)
  @RequireResourcePermission('users', 'read')
  @ApiOperation({
    summary: 'Get clinic user profile',
    description: 'Get the profile of the currently authenticated healthcare user.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Profile retrieved successfully',
    type: UserResponseDto
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - insufficient permissions' })
  async getClinicUserProfile(@Request() req: any): Promise<any> {
    // This would be implemented in the user service, not auth service
    throw new BadRequestException('Profile retrieval should be handled by user service');
  }

  @Post('refresh-token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Refresh clinic user token',
    description: 'Refresh the JWT token for the currently authenticated healthcare user.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Token refreshed successfully',
    type: AuthResponse
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async refreshClinicUserToken(@Request() req: any): Promise<any> {
    // This would be implemented in the session service
    throw new BadRequestException('Token refresh should be handled by session service');
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Change clinic user password',
    description: 'Change the password for the currently authenticated healthcare user.'
  })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid current password' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async changeClinicUserPassword(
    @Body() changePasswordDto: { currentPassword: string; newPassword: string },
    @Request() req: any
  ): Promise<any> {
    // This would be implemented in the user service
    throw new BadRequestException('Password change should be handled by user service');
  }

  @Post('request-otp')
  @Public()
  @ApiOperation({
    summary: 'Request OTP for clinic user',
    description: 'Request OTP for healthcare user authentication.'
  })
  @ApiBody({ type: RequestOtpDto })
  @ApiResponse({ status: 200, description: 'OTP sent successfully' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async requestClinicUserOtp(
    @Body() requestOtpDto: RequestOtpDto,
    @OptionalClinicId() clinicId?: string
  ): Promise<any> {
    return await this.clinicAuthService.requestOTP({
      identifier: requestOtpDto.identifier,
      purpose: 'login',
      clinicId: clinicId || requestOtpDto.clinicId,
    });
  }

  @Post('invalidate-otp')
  @Public()
  @ApiOperation({
    summary: 'Invalidate OTP for clinic user',
    description: 'Invalidate OTP for healthcare user.'
  })
  @ApiBody({ type: InvalidateOtpDto })
  @ApiResponse({ status: 200, description: 'OTP invalidated successfully' })
  async invalidateClinicUserOtp(
    @Body() invalidateOtpDto: InvalidateOtpDto
  ): Promise<any> {
    // OTP invalidation is handled internally by the plugin
    return { success: true, message: 'OTP invalidated successfully' };
  }

  @Post('check-otp-status')
  @Public()
  @ApiOperation({
    summary: 'Check OTP status for clinic user',
    description: 'Check the status of OTP for healthcare user.'
  })
  @ApiBody({ type: CheckOtpStatusDto })
  @ApiResponse({ status: 200, description: 'OTP status retrieved successfully' })
  async checkClinicUserOtpStatus(
    @Body() checkOtpStatusDto: CheckOtpStatusDto
  ): Promise<any> {
    // OTP status checking is handled internally by the plugin
    return { success: true, message: 'OTP status check completed' };
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Get clinic user sessions',
    description: 'Get all active sessions for the currently authenticated healthcare user.'
  })
  @ApiResponse({ status: 200, description: 'Sessions retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getClinicUserSessions(@Request() req: any): Promise<any> {
    return await this.sessionService.getUserSessions(req.user.id);
  }

  @Delete('sessions/:sessionId')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Revoke clinic user session',
    description: 'Revoke a specific session for the currently authenticated healthcare user.'
  })
  @ApiResponse({ status: 200, description: 'Session revoked successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async revokeClinicUserSession(
    @Param('sessionId') sessionId: string,
    @Request() req: any
  ): Promise<any> {
    return await this.sessionService.invalidateSession(sessionId);
  }

  @Delete('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Revoke all clinic user sessions',
    description: 'Revoke all sessions for the currently authenticated healthcare user except the current one.'
  })
  @ApiResponse({ status: 200, description: 'All sessions revoked successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async revokeAllClinicUserSessions(@Request() req: any): Promise<any> {
    return await this.sessionService.revokeAllUserSessions(req.user.id);
  }
}
