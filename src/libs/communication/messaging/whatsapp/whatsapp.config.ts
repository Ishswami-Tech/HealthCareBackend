import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WhatsAppConfig {
  constructor(private configService: ConfigService) {}

  get enabled(): boolean {
    return this.configService.get<string>('WHATSAPP_ENABLED') === 'true';
  }

  get apiUrl(): string {
    return this.configService.get<string>('WHATSAPP_API_URL') || 'https://graph.facebook.com/v17.0';
  }

  get apiKey(): string {
    return this.configService.get<string>('WHATSAPP_API_KEY') || '';
  }

  get phoneNumberId(): string {
    return this.configService.get<string>('WHATSAPP_PHONE_NUMBER_ID') || '';
  }

  get businessAccountId(): string {
    return this.configService.get<string>('WHATSAPP_BUSINESS_ACCOUNT_ID') || '';
  }

  get otpTemplateId(): string {
    return this.configService.get<string>('WHATSAPP_OTP_TEMPLATE_ID') || 'otp_verification';
  }

  get appointmentTemplateId(): string {
    return this.configService.get<string>('WHATSAPP_APPOINTMENT_TEMPLATE_ID') || 'appointment_reminder';
  }

  get prescriptionTemplateId(): string {
    return this.configService.get<string>('WHATSAPP_PRESCRIPTION_TEMPLATE_ID') || 'prescription_notification';
  }
} 