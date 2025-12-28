/**
 * Clinic Communication Configuration Controller
 * =============================================
 * Handles API endpoints for managing clinic communication provider configurations
 * Supports multi-tenant SES, SMTP, SendGrid, WhatsApp, and SMS configurations
 *
 * @module ClinicCommunicationController
 * @description Clinic communication configuration management
 */

import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/guards';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { Roles } from '@core/decorators/roles.decorator';
import {
  CommunicationConfigService,
  ClinicCommunicationConfig,
  EmailProvider,
  ProviderConfig,
} from '@communication/config';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';

/**
 * Update Communication Config DTO
 */
class UpdateCommunicationConfigDto {
  email?: {
    primary?: {
      provider?: string;
      enabled?: boolean;
      credentials?: Record<string, string>;
      priority?: number;
    };
    fallback?: Array<{
      provider?: string;
      enabled?: boolean;
      credentials?: Record<string, string>;
      priority?: number;
    }>;
    defaultFrom?: string;
    defaultFromName?: string;
  };
  whatsapp?: {
    primary?: {
      provider?: string;
      enabled?: boolean;
      credentials?: Record<string, string>;
      priority?: number;
    };
    fallback?: Array<{
      provider?: string;
      enabled?: boolean;
      credentials?: Record<string, string>;
      priority?: number;
    }>;
    defaultNumber?: string;
  };
  sms?: {
    primary?: {
      provider?: string;
      enabled?: boolean;
      credentials?: Record<string, string>;
      priority?: number;
    };
    fallback?: Array<{
      provider?: string;
      enabled?: boolean;
      credentials?: Record<string, string>;
      priority?: number;
    }>;
    defaultNumber?: string;
  };
}

/**
 * Test Email Config DTO
 */
class TestEmailConfigDto {
  testEmail!: string;
}

/**
 * Update SES Config DTO (Simplified for SES setup)
 */
class UpdateSESConfigDto {
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  fromEmail?: string;
  fromName?: string;
  enabled?: boolean;
}

@ApiTags('Clinic Communication')
@ApiBearerAuth()
@Controller('clinics/:clinicId/communication')
@UseGuards(JwtAuthGuard, RbacGuard)
export class ClinicCommunicationController {
  constructor(
    private readonly communicationConfigService: CommunicationConfigService,
    private readonly loggingService: LoggingService
  ) {}

  @Get('config')
  @Roles('SUPER_ADMIN', 'CLINIC_ADMIN')
  @ApiOperation({
    summary: 'Get clinic communication configuration',
    description: 'Retrieves the communication provider configuration for a clinic',
  })
  @ApiParam({
    name: 'clinicId',
    description: 'Clinic ID',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Communication configuration retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Clinic not found',
  })
  async getConfig(@Param('clinicId') clinicId: string): Promise<ClinicCommunicationConfig | null> {
    return await this.communicationConfigService.getClinicConfig(clinicId);
  }

  @Put('config')
  @Roles('SUPER_ADMIN', 'CLINIC_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update clinic communication configuration',
    description:
      'Updates the communication provider configuration for a clinic. Credentials are automatically encrypted.',
  })
  @ApiParam({
    name: 'clinicId',
    description: 'Clinic ID',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Communication configuration updated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid configuration',
  })
  async updateConfig(
    @Param('clinicId') clinicId: string,
    @Body() dto: UpdateCommunicationConfigDto
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Get existing config or create default
      const existingConfig = await this.communicationConfigService.getClinicConfig(clinicId);

      // Convert DTO to ClinicCommunicationConfig with proper type handling
      // Handle optional properties correctly with exactOptionalPropertyTypes
      const emailConfig: ClinicCommunicationConfig['email'] = dto.email
        ? {
            ...(dto.email.primary &&
              dto.email.primary.provider && {
                primary: {
                  provider: dto.email.primary.provider as EmailProvider,
                  enabled: dto.email.primary.enabled ?? true,
                  credentials: dto.email.primary.credentials ?? {},
                  ...(dto.email.primary.priority !== undefined && {
                    priority: dto.email.primary.priority,
                  }),
                } as ProviderConfig,
              }),
            ...(dto.email.fallback && { fallback: dto.email.fallback as ProviderConfig[] }),
            ...(dto.email.defaultFrom && { defaultFrom: dto.email.defaultFrom }),
            ...(dto.email.defaultFromName && { defaultFromName: dto.email.defaultFromName }),
          }
        : (existingConfig?.email ?? {});

      const whatsappConfig: ClinicCommunicationConfig['whatsapp'] = dto.whatsapp
        ? {
            ...(dto.whatsapp.primary &&
              dto.whatsapp.primary.provider && {
                primary: {
                  provider: dto.whatsapp.primary.provider as ProviderConfig['provider'],
                  enabled: dto.whatsapp.primary.enabled ?? true,
                  credentials: dto.whatsapp.primary.credentials ?? {},
                  ...(dto.whatsapp.primary.priority !== undefined && {
                    priority: dto.whatsapp.primary.priority,
                  }),
                } as ProviderConfig,
              }),
            ...(dto.whatsapp.fallback && { fallback: dto.whatsapp.fallback as ProviderConfig[] }),
            ...(dto.whatsapp.defaultNumber && { defaultNumber: dto.whatsapp.defaultNumber }),
          }
        : (existingConfig?.whatsapp ?? {});

      const smsConfig: ClinicCommunicationConfig['sms'] = dto.sms
        ? {
            ...(dto.sms.primary &&
              dto.sms.primary.provider && {
                primary: {
                  provider: dto.sms.primary.provider as ProviderConfig['provider'],
                  enabled: dto.sms.primary.enabled ?? true,
                  credentials: dto.sms.primary.credentials ?? {},
                  ...(dto.sms.primary.priority !== undefined && {
                    priority: dto.sms.primary.priority,
                  }),
                } as ProviderConfig,
              }),
            ...(dto.sms.fallback && { fallback: dto.sms.fallback as ProviderConfig[] }),
            ...(dto.sms.defaultNumber && { defaultNumber: dto.sms.defaultNumber }),
          }
        : (existingConfig?.sms ?? {});

      const config: ClinicCommunicationConfig = {
        clinicId,
        email: emailConfig,
        whatsapp: whatsappConfig,
        sms: smsConfig,
        createdAt: existingConfig?.createdAt ?? new Date(),
        updatedAt: new Date(),
      };

      await this.communicationConfigService.saveClinicConfig(config);

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Clinic communication configuration updated: ${clinicId}`,
        'ClinicCommunicationController',
        { clinicId }
      );

      return {
        success: true,
        message: 'Communication configuration updated successfully',
      };
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update clinic communication config: ${error instanceof Error ? error.message : String(error)}`,
        'ClinicCommunicationController',
        {
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );

      throw error;
    }
  }

  @Put('ses')
  @Roles('SUPER_ADMIN', 'CLINIC_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update clinic SES configuration',
    description: 'Quick endpoint to update only SES email configuration for a clinic',
  })
  @ApiParam({
    name: 'clinicId',
    description: 'Clinic ID',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'SES configuration updated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid SES configuration',
  })
  async updateSESConfig(
    @Param('clinicId') clinicId: string,
    @Body() dto: UpdateSESConfigDto
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Get existing config
      const existingConfig = await this.communicationConfigService.getClinicConfig(clinicId);

      // Validate required fields
      if (!dto.region || !dto.accessKeyId || !dto.secretAccessKey || !dto.fromEmail) {
        return {
          success: false,
          message: 'Missing required fields: region, accessKeyId, secretAccessKey, fromEmail',
        };
      }

      // Update email configuration with SES
      const config: ClinicCommunicationConfig = {
        clinicId,
        email: {
          primary: {
            provider: EmailProvider.AWS_SES,
            enabled: dto.enabled !== false,
            credentials: {
              region: dto.region,
              accessKeyId: dto.accessKeyId,
              secretAccessKey: dto.secretAccessKey,
              fromEmail: dto.fromEmail,
              fromName: dto.fromName || '',
            },
            priority: 1,
          },
          fallback: existingConfig?.email.fallback || [],
          defaultFrom: dto.fromEmail,
          defaultFromName: dto.fromName || '',
        },
        whatsapp: existingConfig?.whatsapp || {},
        sms: existingConfig?.sms || {},
        createdAt: existingConfig?.createdAt || new Date(),
        updatedAt: new Date(),
      };

      await this.communicationConfigService.saveClinicConfig(config);

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Clinic SES configuration updated: ${clinicId}`,
        'ClinicCommunicationController',
        { clinicId, fromEmail: dto.fromEmail }
      );

      return {
        success: true,
        message: 'SES configuration updated successfully',
      };
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update clinic SES config: ${error instanceof Error ? error.message : String(error)}`,
        'ClinicCommunicationController',
        {
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );

      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to update SES configuration',
      };
    }
  }

  @Post('test-email')
  @Roles('SUPER_ADMIN', 'CLINIC_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Test clinic email configuration',
    description: 'Sends a test email to verify the clinic email configuration is working correctly',
  })
  @ApiParam({
    name: 'clinicId',
    description: 'Clinic ID',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Test email sent successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Test email failed',
  })
  async testEmailConfig(
    @Param('clinicId') clinicId: string,
    @Body() dto: TestEmailConfigDto
  ): Promise<{ success: boolean; message: string; error?: string }> {
    return await this.communicationConfigService.testEmailConfig(clinicId, dto.testEmail);
  }

  @Post('test-whatsapp')
  @Roles('SUPER_ADMIN', 'CLINIC_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Test clinic WhatsApp configuration',
    description:
      'Sends a test WhatsApp message to verify the clinic WhatsApp configuration is working correctly',
  })
  @ApiParam({
    name: 'clinicId',
    description: 'Clinic ID',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Test WhatsApp message sent successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Test WhatsApp message failed',
  })
  async testWhatsAppConfig(
    @Param('clinicId') clinicId: string,
    @Body() dto: { phoneNumber: string }
  ): Promise<{ success: boolean; message: string; error?: string }> {
    return await this.communicationConfigService.testWhatsAppConfig(clinicId, dto.phoneNumber);
  }

  @Post('test-sms')
  @Roles('SUPER_ADMIN', 'CLINIC_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Test clinic SMS configuration',
    description: 'Sends a test SMS to verify the clinic SMS configuration is working correctly',
  })
  @ApiParam({
    name: 'clinicId',
    description: 'Clinic ID',
    type: String,
  })
  @ApiResponse({
    status: 200,
    description: 'Test SMS sent successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Test SMS failed',
  })
  async testSMSConfig(
    @Param('clinicId') clinicId: string,
    @Body() dto: { phoneNumber: string }
  ): Promise<{ success: boolean; message: string; error?: string }> {
    const result = await this.communicationConfigService.testSMSConfig(clinicId, dto.phoneNumber);
    return result;
  }
}
