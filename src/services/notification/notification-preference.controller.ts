import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  HttpStatus,
  UseGuards,
  UsePipes,
  ValidationPipe,
  Request,
} from '@nestjs/common';
import type { ClinicAuthenticatedRequest } from '@core/types/clinic.types';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
  ApiSecurity,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';
import { NotificationPreferenceService } from './notification-preference.service';
import {
  CreateNotificationPreferenceDto,
  UpdateNotificationPreferenceDto,
  NotificationPreferenceResponseDto,
} from '@dtos';

@ApiTags('notification-preferences')
@Controller('notification-preferences')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@ApiBearerAuth()
@ApiSecurity('bearer')
export class NotificationPreferenceController {
  constructor(private readonly preferenceService: NotificationPreferenceService) {}

  @Get('me')
  @Roles(Role.PATIENT, Role.DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Get my notification preferences',
    description: 'Get notification preferences for the authenticated user',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Notification preferences retrieved successfully',
    type: NotificationPreferenceResponseDto as unknown as new () => NotificationPreferenceResponseDto,
  })
  async getMyPreferences(
    @Request() req: ClinicAuthenticatedRequest
  ): Promise<NotificationPreferenceResponseDto> {
    const userId = req.user?.sub || req.user?.id;
    if (!userId) {
      throw new Error('User ID not found in token');
    }
    return await this.preferenceService.getPreferences(userId);
  }

  @Get(':userId')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({
    summary: 'Get user notification preferences',
    description: 'Get notification preferences for a specific user (admin only)',
  })
  @ApiParam({
    name: 'userId',
    description: 'User ID',
    example: 'user-123',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Notification preferences retrieved successfully',
    type: NotificationPreferenceResponseDto as unknown as new () => NotificationPreferenceResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'User not found',
  })
  async getPreferences(
    @Param('userId') userId: string
  ): Promise<NotificationPreferenceResponseDto> {
    return await this.preferenceService.getPreferences(userId);
  }

  @Post()
  @Roles(Role.PATIENT, Role.DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Create notification preferences',
    description: 'Create notification preferences for the authenticated user',
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Notification preferences created successfully',
    type: NotificationPreferenceResponseDto as unknown as new () => NotificationPreferenceResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Preferences already exist for this user',
  })
  async createPreferences(
    @Request() req: ClinicAuthenticatedRequest,
    @Body() createDto: Omit<CreateNotificationPreferenceDto, 'userId'>
  ): Promise<NotificationPreferenceResponseDto> {
    const userId = req.user?.sub || req.user?.id;
    if (!userId) {
      throw new Error('User ID not found in token');
    }
    return await this.preferenceService.createPreferences({ ...createDto, userId });
  }

  @Put('me')
  @Roles(Role.PATIENT, Role.DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Update my notification preferences',
    description: 'Update notification preferences for the authenticated user',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Notification preferences updated successfully',
    type: NotificationPreferenceResponseDto as unknown as new () => NotificationPreferenceResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Notification preferences not found',
  })
  async updateMyPreferences(
    @Request() req: ClinicAuthenticatedRequest,
    @Body() updateDto: UpdateNotificationPreferenceDto
  ): Promise<NotificationPreferenceResponseDto> {
    const userId = req.user?.sub || req.user?.id;
    if (!userId) {
      throw new Error('User ID not found in token');
    }
    return await this.preferenceService.updatePreferences(userId, updateDto);
  }

  @Put(':userId')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({
    summary: 'Update user notification preferences',
    description: 'Update notification preferences for a specific user (admin only)',
  })
  @ApiParam({
    name: 'userId',
    description: 'User ID',
    example: 'user-123',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Notification preferences updated successfully',
    type: NotificationPreferenceResponseDto as unknown as new () => NotificationPreferenceResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Notification preferences not found',
  })
  async updatePreferences(
    @Param('userId') userId: string,
    @Body() updateDto: UpdateNotificationPreferenceDto
  ): Promise<NotificationPreferenceResponseDto> {
    return await this.preferenceService.updatePreferences(userId, updateDto);
  }

  @Delete('me')
  @Roles(Role.PATIENT, Role.DOCTOR, Role.NURSE, Role.CLINIC_ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Delete my notification preferences',
    description: 'Delete notification preferences for the authenticated user (resets to defaults)',
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Notification preferences deleted successfully',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Notification preferences not found',
  })
  async deleteMyPreferences(@Request() req: ClinicAuthenticatedRequest): Promise<void> {
    const userId = req.user?.sub || req.user?.id;
    if (!userId) {
      throw new Error('User ID not found in token');
    }
    return this.preferenceService.deletePreferences(userId);
  }

  @Delete(':userId')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({
    summary: 'Delete user notification preferences',
    description:
      'Delete notification preferences for a specific user (admin only, resets to defaults)',
  })
  @ApiParam({
    name: 'userId',
    description: 'User ID',
    example: 'user-123',
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Notification preferences deleted successfully',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Notification preferences not found',
  })
  async deletePreferences(@Param('userId') userId: string): Promise<void> {
    return this.preferenceService.deletePreferences(userId);
  }
}
