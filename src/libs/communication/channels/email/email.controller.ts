import { Controller, Post, Body, Get } from '@nestjs/common';
import { EmailService } from '@communication/channels/email/email.service';
import { ConfigService } from '@config/config.service';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { EmailTemplate, EmailContext } from '@core/types';

class SendTestEmailDto {
  to!: string;
  template?: EmailTemplate;
}

@ApiTags('email')
@Controller('email')
export class EmailController {
  constructor(
    private readonly emailService: EmailService,
    private readonly configService: ConfigService
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Get email service status' })
  @ApiResponse({ status: 200, description: 'Email service status' })
  getEmailStatus() {
    try {
      const isHealthy = this.emailService.isHealthy();
      return {
        status: isHealthy ? 'healthy' : 'unhealthy',
        service: 'Email Service',
        timestamp: new Date().toISOString(),
        details: isHealthy
          ? 'Email service is operational'
          : 'Email service is experiencing issues',
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        service: 'Email Service',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  @Get('test')
  @ApiOperation({ summary: 'Send a test email with default template' })
  @ApiResponse({ status: 200, description: 'Test email sent successfully' })
  @ApiResponse({ status: 500, description: 'Failed to send test email' })
  async sendTestEmail() {
    const urlsConfig = this.configService.getUrlsConfig();
    const frontendUrl =
      urlsConfig.frontend || this.configService.getEnv('FRONTEND_URL') || 'http://localhost:3000';

    const result = await this.emailService.sendEmail({
      to: 'aadeshbhujba1@gmail.com', // Your email address
      subject: 'Healthcare App - Email Test',
      template: EmailTemplate.VERIFICATION,
      context: {
        verificationUrl: `${frontendUrl}/verify`,
      },
    });

    return {
      success: result,
      message: result ? 'Test email sent successfully' : 'Failed to send test email',
      details: {
        template: 'VERIFICATION',
        sentTo: 'aadeshbhujbal43@gmail.com',
        checkMailtrap: 'Please check your Mailtrap inbox at https://mailtrap.io',
      },
    };
  }

  @Post('test-custom')
  @ApiOperation({
    summary: 'Send a test email with custom recipient and template',
  })
  @ApiResponse({
    status: 200,
    description: 'Custom test email sent successfully',
  })
  @ApiResponse({ status: 500, description: 'Failed to send custom test email' })
  @ApiBody({ type: SendTestEmailDto })
  async sendCustomTestEmail(@Body() dto: SendTestEmailDto) {
    const urlsConfig = this.configService.getUrlsConfig();
    const frontendUrl =
      urlsConfig.frontend || this.configService.getEnv('FRONTEND_URL') || 'http://localhost:3000';

    const template: EmailTemplate = dto.template || EmailTemplate.VERIFICATION;
    let context: EmailContext = {};

    switch (template) {
      case EmailTemplate.VERIFICATION:
        context = { verificationUrl: `${frontendUrl}/verify` };
        break;
      case EmailTemplate.PASSWORD_RESET:
        context = {
          name: 'Test User',
          resetUrl: `${frontendUrl}/reset-password`,
          expiryTime: '1 hour',
        };
        break;
      case EmailTemplate.OTP_LOGIN:
        context = { otp: '123456' };
        break;
      case EmailTemplate.MAGIC_LINK:
        context = {
          name: 'Test User',
          loginUrl: `${frontendUrl}/magic-login`,
          expiryTime: '15 minutes',
        };
        break;
      case EmailTemplate.WELCOME:
        context = {
          name: 'Test User',
          role: 'Patient',
          loginUrl: `${frontendUrl}/login`,
          dashboardUrl: `${frontendUrl}/patient/dashboard`,
          supportEmail: 'support@healthcareapp.com',
          isGoogleAccount: false,
        };
        break;
      case EmailTemplate.LOGIN_NOTIFICATION:
        context = {
          name: 'Test User',
          time: new Date().toLocaleString(),
          device: 'Desktop',
          browser: 'Chrome',
          operatingSystem: 'Windows',
          ipAddress: '192.168.1.1',
          location: 'New York, USA',
        };
        break;
      case EmailTemplate.SECURITY_ALERT:
        context = {
          name: 'Test User',
          time: new Date().toLocaleString(),
          action: 'All active sessions have been terminated for security.',
        };
        break;
      case EmailTemplate.SUSPICIOUS_ACTIVITY:
        context = {
          name: 'Test User',
          time: new Date().toLocaleString(),
          supportEmail: 'support@healthcareapp.com',
        };
        break;
    }

    const result = await this.emailService.sendEmail({
      to: dto.to,
      subject: `Healthcare App - ${template} Test`,
      template: template,
      context: context,
    });

    return {
      success: result,
      message: result ? 'Custom test email sent successfully' : 'Failed to send custom test email',
      details: {
        template: template,
        sentTo: dto.to,
        context: context,
        checkMailtrap: 'Please check your Mailtrap inbox at https://mailtrap.io',
      },
    };
  }
}
