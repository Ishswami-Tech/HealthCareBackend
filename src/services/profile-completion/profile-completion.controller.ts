import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  InternalServerErrorException,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { Role } from '@core/types/enums.types';
import { UsersService } from '@services/users/users.service';
import type { FastifyRequestWithUser } from '@core/types/guard.types';
import {
  ProfileCompletionDto,
  ProfileCompletionStatusDto,
  ProfileCompletionFieldsDto,
  CompleteProfileRequestDto,
} from '@dtos/profile-completion.dto';
import { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';

/**
 * Profile Completion Controller
 *
 * Handles mandatory profile completion flow with backend enforcement.
 * All profile completion validation happens server-side.
 *
 * @class ProfileCompletionController
 * @description Manages user profile completion with role-based validation
 */
@ApiTags('profile-completion')
@Controller('profile/completion')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ProfileCompletionController {
  constructor(
    private readonly usersService: UsersService,
    private readonly logging: LoggingService
  ) {}

  /**
   * Get current profile completion status
   *
   * @returns Current completion status, percentage, and missing fields
   */
  @Get('status')
  @ApiOperation({
    summary: 'Get profile completion status',
    description:
      'Returns current profile completion status, percentage, and missing required fields',
  })
  @ApiResponse({
    status: 200,
    description: 'Profile completion status retrieved successfully',
    type: ProfileCompletionStatusDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async getProfileCompletionStatus(
    @Request() request: FastifyRequestWithUser
  ): Promise<ProfileCompletionStatusDto> {
    try {
      const userId = request.user?.id || request.user?.sub || '';

      if (!userId) {
        throw new BadRequestException('User ID not found in request');
      }

      const result = await this.usersService.checkUserProfileCompletion(userId);

      return {
        isComplete: result.isComplete,
        completionPercentage: result.completionPercentage,
        profileCompletedAt: result.profileCompletedAt
          ? new Date(result.profileCompletedAt).toISOString()
          : null,
      };
    } catch (error) {
      await this.logging.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get profile completion status`,
        'ProfileCompletionController.getProfileCompletionStatus',
        { error: error instanceof Error ? error.message : String(error) }
      );

      throw new InternalServerErrorException('Failed to retrieve profile status');
    }
  }

  /**
   * Get required profile fields for user's role
   *
   * @returns List of required fields based on user role
   */
  @Get('required-fields')
  @ApiOperation({
    summary: 'Get required profile fields',
    description: 'Returns list of required fields based on user role',
  })
  @ApiResponse({
    status: 200,
    description: 'Required fields retrieved successfully',
    type: ProfileCompletionFieldsDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async getRequiredFields(
    @Request() request: FastifyRequestWithUser
  ): Promise<ProfileCompletionFieldsDto> {
    try {
      // Get user role from JWT payload, default to PATIENT if not specified
      const userRole = (request.user?.role as Role) || Role.PATIENT;

      const requiredFields = this.usersService.getRequiredProfileFields(userRole);

      return {
        role: userRole,
        requiredFields,
      };
    } catch (error) {
      await this.logging.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to get required fields`,
        'ProfileCompletionController.getRequiredFields',
        { error: error instanceof Error ? error.message : String(error) }
      );

      throw new InternalServerErrorException('Failed to retrieve required fields');
    }
  }

  /**
   * Complete user profile
   *
   * @param requestDto - Profile completion data
   * @returns Profile completion result with user data
   */
  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete user profile',
    description:
      'Validates and completes user profile. Marks profile as complete in database if all required fields are present.',
  })
  @ApiResponse({
    status: 200,
    description: 'Profile completed successfully',
    type: ProfileCompletionDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid profile data or missing required fields',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async completeProfile(
    @Request() request: FastifyRequestWithUser,
    @Body() requestDto: CompleteProfileRequestDto
  ): Promise<ProfileCompletionDto> {
    try {
      const userId = request.user?.id || request.user?.sub || '';

      if (!userId) {
        throw new BadRequestException('User ID not found in request');
      }

      // Validate profile completion
      const result = await this.usersService.completeUserProfile(
        userId,
        requestDto as unknown as Record<string, unknown>
      );

      if (!result.success) {
        throw new BadRequestException(result.message);
      }

      return {
        success: true,
        message: 'Profile completed successfully',
        ...(result.user && { user: result.user }),
      };
    } catch (error) {
      await this.logging.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to complete profile`,
        'ProfileCompletionController.completeProfile',
        {
          error: error instanceof Error ? error.message : String(error),
          profileData: JSON.stringify(requestDto),
        }
      );

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to complete profile');
    }
  }

  /**
   * Update user profile with validation
   *
   * @param requestDto - Profile update data
   * @returns Updated user data
   */
  @Post('update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update user profile with validation',
    description: 'Updates user profile and auto-completes if all required fields are present',
  })
  @ApiResponse({
    status: 200,
    description: 'Profile updated successfully',
    type: ProfileCompletionDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid profile data',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
  })
  async updateProfile(
    @Request() request: FastifyRequestWithUser,
    @Body() requestDto: CompleteProfileRequestDto
  ): Promise<ProfileCompletionDto> {
    try {
      const userId = request.user?.id || request.user?.sub || '';

      if (!userId) {
        throw new BadRequestException('User ID not found in request');
      }

      // Update profile with validation
      const updatedUser = await this.usersService.updateUserProfileWithValidation(
        userId,
        requestDto as unknown as Record<string, unknown>
      );

      return {
        success: true,
        message: 'Profile updated successfully',
        ...(updatedUser && { user: updatedUser }),
      };
    } catch (error) {
      await this.logging.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to update profile`,
        'ProfileCompletionController.updateProfile',
        {
          error: error instanceof Error ? error.message : String(error),
          profileData: JSON.stringify(requestDto),
        }
      );

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to update profile');
    }
  }
}
