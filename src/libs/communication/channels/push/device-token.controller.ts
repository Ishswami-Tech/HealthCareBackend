import {
  Controller,
  Post,
  Delete,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  UsePipes,
  ValidationPipe,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeviceTokenService } from './device-token.service';
import type { ClinicAuthenticatedRequest } from '@core/types/clinic.types';

export class RegisterDeviceTokenDto {
  @ApiProperty({
    description: 'Expo or FCM/APNs push token for the device',
    example: 'ExponentPushToken[abc123def456]',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;

  @ApiProperty({
    description: 'Device platform',
    enum: ['ios', 'android', 'web'],
    example: 'ios',
  })
  @IsEnum(['ios', 'android', 'web'])
  platform!: 'ios' | 'android' | 'web';

  @ApiPropertyOptional({ description: 'App version', example: '1.0.0' })
  @IsOptional()
  @IsString()
  appVersion?: string;

  @ApiPropertyOptional({ description: 'Device model', example: 'iPhone 15 Pro' })
  @IsOptional()
  @IsString()
  deviceModel?: string;

  @ApiPropertyOptional({ description: 'OS version', example: 'iOS 18.0' })
  @IsOptional()
  @IsString()
  osVersion?: string;
}

@ApiTags('devices')
@ApiBearerAuth()
@ApiSecurity('bearer')
@Controller('devices')
@UseGuards(JwtAuthGuard, RolesGuard, RbacGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
export class DeviceTokenController {
  constructor(private readonly deviceTokenService: DeviceTokenService) {}

  @Post('me/token')
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.PATIENT,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.PHARMACIST,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @ApiOperation({
    summary: 'Register mobile push token for the authenticated user',
    description:
      'Stores the Expo/FCM/APNs push token so the backend can send push notifications to this device.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Token registered' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Not authenticated' })
  async registerMyToken(
    @Body() body: RegisterDeviceTokenDto,
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<{ success: boolean; message: string }> {
    const userId = req.user?.sub ?? req.user?.id;
    if (!userId) {
      return { success: false, message: 'User not authenticated' };
    }
    const ok = await this.deviceTokenService.registerDeviceToken({
      userId,
      token: body.token,
      platform: body.platform,
      isActive: true,
      ...(body.appVersion ? { appVersion: body.appVersion } : {}),
      ...(body.deviceModel ? { deviceModel: body.deviceModel } : {}),
      ...(body.osVersion ? { osVersion: body.osVersion } : {}),
    });
    return ok
      ? { success: true, message: 'Push token registered' }
      : { success: false, message: 'Failed to register push token' };
  }

  @Delete('me/token')
  @HttpCode(HttpStatus.OK)
  @Roles(
    Role.PATIENT,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.PHARMACIST,
    Role.RECEPTIONIST,
    Role.CLINIC_ADMIN,
    Role.SUPER_ADMIN
  )
  @ApiOperation({
    summary: 'Unregister mobile push token (e.g. on logout)',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Token unregistered' })
  async unregisterMyToken(
    @Body() body: { token: string },
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<{ success: boolean; message: string }> {
    const userId = req.user?.sub ?? req.user?.id;
    if (!userId) {
      return { success: false, message: 'User not authenticated' };
    }
    const ok = await this.deviceTokenService.deactivateDeviceToken(body.token);
    return ok
      ? { success: true, message: 'Push token unregistered' }
      : { success: false, message: 'Failed to unregister push token' };
  }
}
