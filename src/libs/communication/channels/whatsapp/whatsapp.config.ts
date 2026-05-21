import { Injectable } from '@nestjs/common';
import { ConfigService } from '@config/config.service';

@Injectable()
export class WhatsAppConfig {
  /**
   * Fixed receipt template name used by the billing flow.
   * Keep this aligned with the approved WhatsApp template in Meta.
   */
  private static readonly RECEIPT_TEMPLATE_ID = 'payment_reciept';

  constructor(private readonly configService: ConfigService) {}

  // Use ConfigService (which uses dotenv) for all environment variable access
  private getConfig<T>(key: string, defaultValue: T): T {
    try {
      if (typeof defaultValue === 'number') {
        return this.configService.getEnvNumber(key, defaultValue as number) as unknown as T;
      }
      if (typeof defaultValue === 'boolean') {
        return this.configService.getEnvBoolean(key, defaultValue as boolean) as unknown as T;
      }
      return this.configService.getEnv(key, defaultValue as string) as unknown as T;
    } catch {
      // Defensive fallback - should rarely be needed
      return defaultValue;
    }
  }

  get enabled(): boolean {
    return this.getConfig<string>('WHATSAPP_ENABLED', 'false') === 'true';
  }

  get apiUrl(): string {
    return this.getConfig<string>('WHATSAPP_API_URL', 'https://graph.facebook.com/v25.0');
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
    return this.getConfig<string>('WHATSAPP_OTP_TEMPLATE_ID', 'verify');
  }

  get appointmentConfirmationTemplateId(): string {
    return this.getConfig<string>(
      'WHATSAPP_APPOINTMENT_CONFIRMATION_TEMPLATE_ID',
      'appointment_confirmation'
    );
  }

  get appointmentReminderTemplateId(): string {
    return this.getConfig<string>(
      'WHATSAPP_APPOINTMENT_REMINDER_TEMPLATE_ID',
      'appointment_reminder_2'
    );
  }

  get receiptTemplateId(): string {
    return WhatsAppConfig.RECEIPT_TEMPLATE_ID;
  }
}
