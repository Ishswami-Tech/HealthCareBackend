import { Injectable } from '@nestjs/common';
import { ConfigService } from '@config';

@Injectable()
export class WhatsAppConfig {
  constructor(private readonly configService: ConfigService) {}

  private getConfig<T>(key: string, defaultValue: T): T {
    try {
      return this.configService?.get<T>(key) ?? (process.env[key] as T) ?? defaultValue;
    } catch {
      return (process.env[key] as T) ?? defaultValue;
    }
  }

  get enabled(): boolean {
    return this.getConfig<string>('WHATSAPP_ENABLED', 'false') === 'true';
  }

  get apiUrl(): string {
    return this.getConfig<string>('WHATSAPP_API_URL', 'https://graph.facebook.com/v17.0');
  }

  get apiKey(): string {
    return this.getConfig<string>('WHATSAPP_API_KEY', '');
  }

  get phoneNumberId(): string {
    return this.getConfig<string>('WHATSAPP_PHONE_NUMBER_ID', '');
  }

  get businessAccountId(): string {
    return this.getConfig<string>('WHATSAPP_BUSINESS_ACCOUNT_ID', '');
  }

  get otpTemplateId(): string {
    return this.getConfig<string>('WHATSAPP_OTP_TEMPLATE_ID', 'otp_verification');
  }

  get appointmentTemplateId(): string {
    return this.getConfig<string>('WHATSAPP_APPOINTMENT_TEMPLATE_ID', 'appointment_reminder');
  }

  get prescriptionTemplateId(): string {
    return this.getConfig<string>('WHATSAPP_PRESCRIPTION_TEMPLATE_ID', 'prescription_notification');
  }
}
