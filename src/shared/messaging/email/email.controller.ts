import { Controller, Post, Body, Get } from '@nestjs/common';
import { EmailService } from './email.service';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { EmailTemplate } from '../../../libs/types/email.types';

class SendTestEmailDto {
  to: string;
  template?: EmailTemplate;
}

@ApiTags('Email')
@Controller('email')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Get('test')
  @ApiOperation({ summary: 'Send a test email with default template' })
  @ApiResponse({ status: 200, description: 'Test email sent successfully' })
  @ApiResponse({ status: 500, description: 'Failed to send test email' })
  async sendTestEmail() {
    const result = await this.emailService.sendEmail({
      to: 'aadeshbhujba1@gmail.com', // Your email address
      subject: 'Healthcare App - Email Test',
      template: EmailTemplate.VERIFICATION,
      context: {
        verificationUrl: 'https://ishswami.in/verify',
      }
    });

    return {
      success: result,
      message: result ? 'Test email sent successfully' : 'Failed to send test email',
      details: {
        template: 'VERIFICATION',
        sentTo: 'aadeshbhujbal43@gmail.com',
        checkMailtrap: 'Please check your Mailtrap inbox at https://mailtrap.io'
      }
    };
  }

  @Post('test-custom')
  @ApiOperation({ summary: 'Send a test email with custom recipient and template' })
  @ApiResponse({ status: 200, description: 'Custom test email sent successfully' })
  @ApiResponse({ status: 500, description: 'Failed to send custom test email' })
  @ApiBody({ type: SendTestEmailDto })
  async sendCustomTestEmail(@Body() dto: SendTestEmailDto) {
    const template = dto.template || EmailTemplate.VERIFICATION;
    let context = {};

    switch (template) {
      case EmailTemplate.VERIFICATION:
        context = { verificationUrl: 'https://ishswami.in/verify' };
        break;
      case EmailTemplate.PASSWORD_RESET:
        context = { 
          name: 'Test User',
          resetUrl: 'https://ishswami.in/reset-password',
          expiryTime: '1 hour'
        };
        break;
      case EmailTemplate.OTP_LOGIN:
        context = { otp: '123456' };
        break;
      case EmailTemplate.MAGIC_LINK:
        context = {
          name: 'Test User',
          loginUrl: 'https://ishswami.in/magic-login',
          expiryTime: '15 minutes'
        };
        break;
      case EmailTemplate.WELCOME:
        context = {
          name: 'Test User',
          role: 'Patient',
          loginUrl: 'https://ishswami.in/login',
          dashboardUrl: 'https://ishswami.in/patient/dashboard',
          supportEmail: 'support@healthcareapp.com',
          isGoogleAccount: false
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
          location: 'New York, USA'
        };
        break;
      case EmailTemplate.SECURITY_ALERT:
        context = {
          name: 'Test User',
          time: new Date().toLocaleString(),
          action: 'All active sessions have been terminated for security.'
        };
        break;
      case EmailTemplate.SUSPICIOUS_ACTIVITY:
        context = {
          name: 'Test User',
          time: new Date().toLocaleString(),
          supportEmail: 'support@healthcareapp.com'
        };
        break;
    }

    const result = await this.emailService.sendEmail({
      to: dto.to,
      subject: `Healthcare App - ${template} Test`,
      template: template,
      context: context
    });

    return {
      success: result,
      message: result ? 'Custom test email sent successfully' : 'Failed to send custom test email',
      details: {
        template: template,
        sentTo: dto.to,
        context: context,
        checkMailtrap: 'Please check your Mailtrap inbox at https://mailtrap.io'
      }
    };
  }
} 