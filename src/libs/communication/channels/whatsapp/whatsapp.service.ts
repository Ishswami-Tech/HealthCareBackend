import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { HttpService } from '@infrastructure/http';
import { ConfigService } from '@config/config.service';
import { WhatsAppConfig } from '@communication/channels/whatsapp/whatsapp.config';
// Use direct import to avoid TDZ issues with barrel exports
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';
import { ProviderFactory } from '@communication/adapters/factories/provider.factory';
import { CommunicationConfigService } from '@communication/config/communication-config.service';
import { DatabaseService } from '@infrastructure/database';
import { ClinicTemplateService } from '@communication/services/clinic-template.service';
import {
  formatOTPTemplateParams,
  formatAppointmentConfirmationTemplateParams,
  formatAppointmentReminderTemplateParams,
  formatPaymentReceiptTemplateParams,
} from '@communication/templates/WhatsappTemplates/template-helpers';

/**
 * WhatsApp Business API service for sending messages and notifications
 *
 * @class WhatsAppService
 */
@Injectable()
export class WhatsAppService {
  private readonly TEMPLATE_LANGUAGE_CODE = 'en_US';

  constructor(
    private readonly configService: ConfigService,
    private readonly whatsAppConfig: WhatsAppConfig,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    private readonly httpService: HttpService,
    @Inject(forwardRef(() => ProviderFactory))
    private readonly providerFactory: ProviderFactory,
    @Inject(forwardRef(() => CommunicationConfigService))
    private readonly communicationConfigService: CommunicationConfigService,
    @Inject(forwardRef(() => ClinicTemplateService))
    private readonly clinicTemplateService: ClinicTemplateService,
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService
  ) {}
  /**
   * Creates an instance of WhatsAppService
   * @param configService - Configuration service for environment variables
   * @param whatsAppConfig - WhatsApp configuration service
   */

  /**
   * Send OTP via WhatsApp
   * @param phoneNumber - The recipient's phone number (with country code)
   * @param otp - The OTP code
   * @param expiryMinutes - OTP expiry time in minutes
   * @param maxRetries - Maximum number of retry attempts
   * @returns Promise<boolean> - Success status
   */
  /**
   * Sends OTP via WhatsApp template message
   * Supports multi-tenant communication via clinicId
   * @param phoneNumber - Recipient phone number (with country code)
   * @param otp - OTP code to send
   * @param expiryMinutes - OTP expiry time in minutes (default: 10)
   * @param maxRetries - Maximum retry attempts (default: 2)
   * @param clinicId - Optional clinic ID for multi-tenant template and provider routing
   * @param purpose - OTP purpose label used in the template body
   * @returns Promise resolving to true if message was sent successfully
   */
  async sendOTP(
    phoneNumber: string,
    otp: string,
    _expiryMinutes: number = 10,
    _maxRetries: number = 2,
    clinicId?: string,
    purpose: string = 'verification'
  ): Promise<boolean> {
    if (!this.whatsAppConfig.enabled && !clinicId) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'WhatsApp service is disabled. Simulating successful OTP send.',
        'WhatsAppService'
      );
      return true;
    }

    const appName =
      this.configService.getEnv('APP_NAME') ||
      this.configService.getEnv('DEFAULT_FROM_NAME') ||
      'Healthcare App';
    let clinicName = appName;
    let templateId = this.whatsAppConfig.otpTemplateId;

    if (clinicId) {
      // Resolve clinicId to UUID if it's a clinic code (e.g., "CL0002")
      let resolvedClinicId = clinicId;
      try {
        const { resolveClinicUUID } = await import('@utils/clinic.utils');
        resolvedClinicId = await resolveClinicUUID(this.databaseService, clinicId);
      } catch (_error) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Failed to resolve clinic code to UUID in WhatsApp service: ${clinicId}. Using original value.`,
          'WhatsAppService'
        );
      }

      const clinicData = await this.clinicTemplateService.getClinicTemplateData(resolvedClinicId);
      if (clinicData) {
        clinicName = clinicData.whatsappName || clinicData.clinicName || appName;
        templateId = clinicData.templateIds.otp || this.whatsAppConfig.otpTemplateId;
      }
    }

    try {
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      await this.sendTemplateMessage(
        formattedPhone,
        templateId,
        formatOTPTemplateParams(
          this.resolveOtpPurposeLabel(purpose),
          this.resolveOtpTargetLabel(purpose),
          clinicName || appName,
          otp,
          'Support',
          templateId === 'verify_account' ? this.resolveOtpButtonSuffix(purpose) : undefined
        ),
        clinicId
      );

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `OTP sent to ${phoneNumber} via WhatsApp template ${templateId}`,
        'WhatsAppService'
      );
      return true;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Template OTP send failed for ${phoneNumber}; attempting direct WhatsApp text fallback: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        'WhatsAppService',
        { stack: (error as Error)?.stack, clinicId, purpose }
      );

      try {
        const formattedPhone = this.formatPhoneNumber(phoneNumber);
        const fallbackBody = this.buildOtpFallbackText(
          this.resolveOtpPurposeLabel(purpose),
          this.resolveOtpTargetLabel(purpose),
          clinicName || appName,
          otp
        );

        await this.sendDirectTextMessage(formattedPhone, fallbackBody);

        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `OTP delivered via direct WhatsApp text fallback for ${phoneNumber}`,
          'WhatsAppService',
          { clinicId, purpose }
        );

        return true;
      } catch (fallbackError) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.ERROR,
          `Direct WhatsApp text fallback failed for ${phoneNumber}: ${
            fallbackError instanceof Error ? fallbackError.message : 'Unknown error'
          }`,
          'WhatsAppService',
          { stack: (fallbackError as Error)?.stack, clinicId, purpose }
        );
        return false;
      }
    }
  }

  /**
   * Send appointment reminder via WhatsApp
   * @param phoneNumber - The recipient's phone number
   * @param patientName - Patient's name
   * @param doctorName - Doctor's name
   * @param appointmentDate - Date of appointment
   * @param appointmentTime - Time of appointment
   * @param location - Location of appointment
   * @returns Promise<boolean> - Success status
   */
  /**
   * Sends appointment reminder via WhatsApp
   * Supports multi-tenant communication via clinicId
   * @param phoneNumber - Recipient phone number (with country code)
   * @param patientName - Patient name for personalization
   * @param doctorName - Doctor name
   * @param appointmentDate - Appointment date
   * @param appointmentTime - Appointment time
   * @param location - Appointment location
   * @param clinicId - Optional clinic ID for multi-tenant template and provider routing
   * @returns Promise resolving to true if message was sent successfully
   */
  async sendAppointmentReminder(
    phoneNumber: string,
    patientName: string,
    doctorName: string,
    appointmentDate: string,
    appointmentTime: string,
    location: string,
    clinicId?: string,
    detailsUrl?: string,
    appointmentType: string = 'in-person'
  ): Promise<boolean> {
    if (!this.whatsAppConfig.enabled && !clinicId) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'WhatsApp service is disabled. Simulating successful appointment reminder.',
        'WhatsAppService'
      );
      return true;
    }

    try {
      const formattedPhone = this.formatPhoneNumber(phoneNumber);

      // Get clinic name and template ID if clinicId provided
      let templateId = this.whatsAppConfig.appointmentReminderTemplateId;

      if (clinicId) {
        const clinicData = await this.clinicTemplateService.getClinicTemplateData(clinicId);
        if (clinicData) {
          templateId =
            clinicData.templateIds.appointmentReminder ||
            this.whatsAppConfig.appointmentReminderTemplateId;
        }
      }

      await this.sendTemplateMessage(
        formattedPhone,
        templateId,
        formatAppointmentReminderTemplateParams(
          patientName,
          appointmentType,
          doctorName,
          `${appointmentDate} at ${appointmentTime}`,
          detailsUrl
        ),
        clinicId
      );

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Appointment reminder sent to ${phoneNumber} via WhatsApp`,
        'WhatsAppService'
      );
      return true;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to send appointment reminder via WhatsApp: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'WhatsAppService',
        { stack: (error as Error)?.stack }
      );
      return false;
    }
  }

  /**
   * Send appointment confirmation via WhatsApp
   */
  async sendAppointmentConfirmation(
    phoneNumber: string,
    patientName: string,
    doctorName: string,
    appointmentDate: string,
    appointmentTime: string,
    location: string,
    clinicId?: string,
    detailsUrl?: string,
    appointmentType: string = 'in-person',
    recipientRole: 'patient' | 'doctor' = 'patient'
  ): Promise<boolean> {
    if (!this.whatsAppConfig.enabled && !clinicId) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'WhatsApp service is disabled. Simulating successful appointment confirmation.',
        'WhatsAppService'
      );
      return true;
    }

    try {
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      const normalizedAppointmentType = appointmentType.trim() || 'in-person';
      let templateId = this.whatsAppConfig.appointmentConfirmationTemplateId;

      if (clinicId) {
        const clinicData = await this.clinicTemplateService.getClinicTemplateData(clinicId);
        if (clinicData) {
          templateId =
            clinicData.templateIds.appointmentConfirmation ||
            this.whatsAppConfig.appointmentConfirmationTemplateId;
        }
      }

      const templateParams =
        recipientRole === 'doctor'
          ? formatAppointmentConfirmationTemplateParams(
              doctorName,
              normalizedAppointmentType,
              patientName,
              appointmentDate,
              appointmentTime,
              detailsUrl
            )
          : formatAppointmentConfirmationTemplateParams(
              patientName,
              normalizedAppointmentType,
              doctorName,
              appointmentDate,
              appointmentTime,
              detailsUrl
            );

      await this.sendTemplateMessage(formattedPhone, templateId, templateParams, clinicId);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Appointment confirmation sent to ${phoneNumber} via WhatsApp`,
        'WhatsAppService'
      );
      return true;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to send appointment confirmation via WhatsApp: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'WhatsAppService',
        { stack: (error as Error)?.stack }
      );
      return false;
    }
  }

  /**
   * Send a custom message via WhatsApp
   * @param phoneNumber - The recipient's phone number
   * @param message - The message to send
   * @returns Promise<boolean> - Success status
   */
  /**
   * Sends a custom text message via WhatsApp
   * Supports multi-tenant communication via clinicId
   * @param phoneNumber - Recipient phone number (with country code)
   * @param message - Message text to send
   * @param clinicId - Optional clinic ID for multi-tenant provider selection
   * @returns Promise resolving to true if message was sent successfully
   */
  async sendCustomMessage(
    phoneNumber: string,
    message: string,
    clinicId?: string
  ): Promise<boolean> {
    try {
      const formattedPhone = this.formatPhoneNumber(phoneNumber);

      // If clinicId is provided, use multi-tenant provider adapter
      if (clinicId) {
        try {
          const adapter = await this.providerFactory.getWhatsAppProviderWithFallback(clinicId);
          if (adapter) {
            const result = await adapter.send({
              to: formattedPhone,
              message,
            });

            if (result.success) {
              void this.loggingService.log(
                LogType.SYSTEM,
                LogLevel.INFO,
                `Custom message sent to ${phoneNumber} via WhatsApp (clinic: ${clinicId})`,
                'WhatsAppService'
              );
              return true;
            } else {
              void this.loggingService.log(
                LogType.SYSTEM,
                LogLevel.WARN,
                `Failed to send WhatsApp message via clinic adapter, falling back to global: ${result.error}`,
                'WhatsAppService',
                { clinicId }
              );
              // Fall through to global provider
            }
          }
        } catch (error) {
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Failed to use clinic-specific WhatsApp provider, falling back to global: ${error instanceof Error ? error.message : String(error)}`,
            'WhatsAppService',
            { clinicId }
          );
          // Fall through to global provider
        }
      }

      // Fallback to global provider (existing behavior)
      if (!this.whatsAppConfig.enabled) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'WhatsApp service is disabled. Simulating successful custom message.',
          'WhatsAppService'
        );
        return true;
      }

      await this.httpService.post(
        `${this.whatsAppConfig.apiUrl}/${this.whatsAppConfig.phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: formattedPhone,
          type: 'text',
          text: {
            body: message,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.whatsAppConfig.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Custom message sent to ${phoneNumber} via WhatsApp`,
        'WhatsAppService'
      );
      return true;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to send custom message via WhatsApp: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'WhatsAppService',
        { stack: (error as Error)?.stack }
      );
      return false;
    }
  }

  /**
   * Send a template message via WhatsApp
   * @param to - The recipient's phone number
   * @param templateName - The template name
   * @param components - Template components
   * @returns Promise<unknown> - API response
   */
  /**
   * Sends a template message via WhatsApp Business API
   * Supports multi-tenant communication via clinicId
   * @param to - Recipient phone number
   * @param templateName - Template name to use
   * @param components - Template components with parameters
   * @param clinicId - Optional clinic ID for multi-tenant provider routing
   * @returns Promise resolving to API response
   * @private
   */
  private async sendTemplateMessage(
    to: string,
    templateName: string,
    components: Array<{
      type: string;
      parameters: Array<{ type: string; text: string }>;
      sub_type?: string;
      index?: number;
    }>,
    clinicId?: string
  ): Promise<unknown> {
    try {
      // If clinicId is provided, use multi-tenant provider adapter
      if (clinicId) {
        try {
          const adapter = await this.providerFactory.getWhatsAppProviderWithFallback(clinicId);
          if (adapter) {
            const result = await adapter.send({
              to,
              templateId: templateName,
              templateParams:
                components[0]?.parameters?.reduce(
                  (acc, param, index) => {
                    acc[`${index}`] = param.text;
                    return acc;
                  },
                  {} as Record<string, string>
                ) ?? {},
              templateComponents: components,
              language: this.TEMPLATE_LANGUAGE_CODE,
            });

            if (result.success) {
              return result;
            } else {
              void this.loggingService.log(
                LogType.SYSTEM,
                LogLevel.WARN,
                `Failed to send template via clinic adapter, falling back to global: ${result.error}`,
                'WhatsAppService',
                { clinicId, templateName }
              );
              // Fall through to global provider
            }
          }
        } catch (error) {
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Failed to use clinic-specific WhatsApp provider, falling back to global: ${error instanceof Error ? error.message : String(error)}`,
            'WhatsAppService',
            { clinicId, templateName }
          );
          // Fall through to global provider
        }
      }

      // Fallback to global provider (existing behavior)
      if (!this.whatsAppConfig.enabled) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'WhatsApp service is disabled. Simulating successful template message.',
          'WhatsAppService'
        );
        return { success: true, simulated: true };
      }

      const response = await this.httpService.post(
        `${this.whatsAppConfig.apiUrl}/${this.whatsAppConfig.phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'template',
          template: {
            name: templateName,
            language: {
              code: this.TEMPLATE_LANGUAGE_CODE,
            },
            components,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.whatsAppConfig.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `WhatsApp template message error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'WhatsAppService',
        { stack: (error as Error)?.stack, clinicId, templateName }
      );
      throw error;
    }
  }

  /**
   * Send a document message via WhatsApp
   * @param to - The recipient's phone number
   * @param documentUrl - URL of the document
   * @param caption - Caption for the document
   * @returns Promise<unknown> - API response
   */
  /**
   * Sends a document message via WhatsApp Business API
   * @param to - Recipient phone number
   * @param documentUrl - URL of the document to send
   * @param caption - Document caption
   * @returns Promise resolving to API response
   * @private
   */
  private async sendDocumentMessage(
    to: string,
    documentUrl: string,
    caption: string
  ): Promise<unknown> {
    try {
      const response = await this.httpService.post(
        `${this.whatsAppConfig.apiUrl}/${this.whatsAppConfig.phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'document',
          document: {
            link: documentUrl,
            caption,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.whatsAppConfig.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `WhatsApp document message error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'WhatsAppService',
        { stack: (error as Error)?.stack }
      );
      throw error;
    }
  }

  private async sendDirectTextMessage(to: string, body: string): Promise<unknown> {
    try {
      const response = await this.httpService.post(
        `${this.whatsAppConfig.apiUrl}/${this.whatsAppConfig.phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: {
            body,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.whatsAppConfig.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `WhatsApp direct text message error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'WhatsAppService',
        { stack: (error as Error)?.stack }
      );
      throw error;
    }
  }

  /**
   * Sends receipt notification via WhatsApp
   * @param phoneNumber - Recipient phone number (with country code)
   * @param userName - User name for personalization
   * @param invoiceNumber - Invoice number
   * @param amount - Receipt amount
   * @param paymentDate - Paid on / payment date
   * @param invoiceUrl - Receipt document URL
   * @returns Promise resolving to true if message was sent successfully
   */
  async sendReceipt(
    phoneNumber: string,
    userName: string,
    invoiceNumber: string,
    amount: number,
    paymentDate: string,
    invoiceUrl: string,
    clinicId?: string
  ): Promise<boolean> {
    if (!this.whatsAppConfig.enabled) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'WhatsApp service is disabled. Simulating successful receipt delivery.',
        'WhatsAppService'
      );
      return true;
    }

    try {
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      let templateId = this.whatsAppConfig.receiptTemplateId;

      if (clinicId) {
        const clinicData = await this.clinicTemplateService.getClinicTemplateData(clinicId);
        if (clinicData) {
          templateId = clinicData.templateIds.receipt || templateId;
        }
      }

      await this.sendTemplateMessage(
        formattedPhone,
        templateId,
        formatPaymentReceiptTemplateParams(
          userName,
          invoiceNumber,
          `INR ${amount}`,
          paymentDate,
          invoiceUrl
        ),
        clinicId
      );

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Receipt sent to ${phoneNumber} via WhatsApp`,
        'WhatsAppService'
      );
      return true;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to send receipt via WhatsApp: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'WhatsAppService',
        { stack: (error as Error)?.stack }
      );
      return false;
    }
  }

  /**
   * Send subscription confirmation via WhatsApp
   * @param phoneNumber - The recipient's phone number
   * @param userName - User's name
   * @param planName - Subscription plan name
   * @param amount - Subscription amount
   * @param startDate - Subscription start date
   * @param endDate - Subscription end date
   * @returns Promise<boolean> - Success status
   */
  /**
   * Sends subscription confirmation via WhatsApp
   * @param phoneNumber - Recipient phone number (with country code)
   * @param userName - User name for personalization
   * @param planName - Subscription plan name
   * @param amount - Subscription amount
   * @param startDate - Subscription start date
   * @param endDate - Subscription end date
   * @returns Promise resolving to true if message was sent successfully
   */
  async sendSubscriptionConfirmation(
    phoneNumber: string,
    userName: string,
    planName: string,
    amount: number,
    startDate: string,
    endDate: string
  ): Promise<boolean> {
    if (!this.whatsAppConfig.enabled) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'WhatsApp service is disabled. Simulating successful subscription confirmation.',
        'WhatsAppService'
      );
      return true;
    }

    try {
      const formattedPhone = this.formatPhoneNumber(phoneNumber);

      await this.sendCustomMessage(
        formattedPhone,
        `🎉 Subscription Confirmed!\n\n` +
          `Hello ${userName},\n\n` +
          `Thank you for subscribing to ${planName}!\n\n` +
          `Amount: ₹${amount}\n` +
          `Start Date: ${startDate}\n` +
          `End Date: ${endDate}\n\n` +
          `Your invoice will be sent shortly.\n\n` +
          `Thank you for choosing us!`
      );

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Subscription confirmation sent to ${phoneNumber} via WhatsApp`,
        'WhatsAppService'
      );
      return true;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to send subscription confirmation via WhatsApp: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'WhatsAppService',
        { stack: (error as Error)?.stack }
      );
      return false;
    }
  }

  /**
   * Format phone number to international format
   * @param phoneNumber - The phone number to format
   * @returns string - Formatted phone number
   */
  /**
   * Formats phone number for WhatsApp API
   * @param phoneNumber - Raw phone number
   * @returns Formatted phone number with country code
   * @private
   */
  private formatPhoneNumber(phoneNumber: string): string {
    // Remove any non-digit characters
    let cleaned = phoneNumber.replace(/\D/g, '');

    // Ensure it has a country code (default to India +91 if none)
    if (!cleaned.startsWith('91') && cleaned.length === 10) {
      cleaned = '91' + cleaned;
    }

    // Ensure it starts with a plus sign
    if (!cleaned.startsWith('+')) {
      cleaned = '+' + cleaned;
    }

    return cleaned;
  }

  private resolveOtpPurposeLabel(purpose: string): string {
    const normalizedPurpose = purpose.trim().toLowerCase();

    if (
      normalizedPurpose.includes('login') ||
      normalizedPurpose.includes('signin') ||
      normalizedPurpose.includes('sign in') ||
      normalizedPurpose.includes('verify') ||
      normalizedPurpose.includes('verification')
    ) {
      return 'verifying';
    }

    if (
      normalizedPurpose.includes('register') ||
      normalizedPurpose.includes('registration') ||
      normalizedPurpose.includes('create') ||
      normalizedPurpose.includes('signup') ||
      normalizedPurpose.includes('sign up')
    ) {
      return 'creating';
    }

    if (normalizedPurpose.includes('reset') || normalizedPurpose.includes('forgot')) {
      return 'resetting';
    }

    return normalizedPurpose || 'verifying';
  }

  private resolveOtpTargetLabel(purpose: string): string {
    const normalizedPurpose = purpose.trim().toLowerCase();

    if (
      normalizedPurpose.includes('password') ||
      normalizedPurpose.includes('reset') ||
      normalizedPurpose.includes('forgot')
    ) {
      return 'password';
    }

    if (normalizedPurpose.includes('account')) {
      return 'account';
    }

    if (normalizedPurpose.includes('email')) {
      return 'email';
    }

    return 'phone no';
  }

  private resolveOtpButtonSuffix(purpose: string): string {
    const normalizedPurpose = purpose.trim().toLowerCase();

    if (
      normalizedPurpose.includes('reset') ||
      normalizedPurpose.includes('forgot') ||
      normalizedPurpose.includes('password')
    ) {
      return 'reset-password';
    }

    if (
      normalizedPurpose.includes('register') ||
      normalizedPurpose.includes('registration') ||
      normalizedPurpose.includes('signup') ||
      normalizedPurpose.includes('sign up')
    ) {
      return 'register';
    }

    return 'login';
  }

  private buildOtpFallbackText(
    purposeLabel: string,
    targetLabel: string,
    clinicName: string,
    otp: string
  ): string {
    return `This OTP code is for ${purposeLabel} your ${targetLabel} account and linking it to ${clinicName}. OTP: ${otp} Do not share it with anyone, even to WhatsApp Support, or they'll be able to access your account. For your security, do not share this code.`;
  }
}
