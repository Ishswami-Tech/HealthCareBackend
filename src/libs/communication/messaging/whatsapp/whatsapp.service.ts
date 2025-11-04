import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { WhatsAppConfig } from '@communication/messaging/whatsapp/whatsapp.config';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

/**
 * WhatsApp Business API service for sending messages and notifications
 *
 * @class WhatsAppService
 */
@Injectable()
export class WhatsAppService {
  constructor(
    private readonly configService: ConfigService,
    private readonly whatsAppConfig: WhatsAppConfig,
    private readonly loggingService: LoggingService
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
   * @param phoneNumber - Recipient phone number (with country code)
   * @param otp - OTP code to send
   * @param expiryMinutes - OTP expiry time in minutes (default: 10)
   * @param maxRetries - Maximum retry attempts (default: 2)
   * @returns Promise resolving to true if message was sent successfully
   */
  async sendOTP(
    phoneNumber: string,
    otp: string,
    expiryMinutes: number = 10,
    maxRetries: number = 2
  ): Promise<boolean> {
    if (!this.whatsAppConfig.enabled) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'WhatsApp service is disabled. Skipping OTP send.',
        'WhatsAppService'
      );
      return false;
    }

    let retries = 0;
    let success = false;

    while (retries <= maxRetries && !success) {
      try {
        const formattedPhone = this.formatPhoneNumber(phoneNumber);

        await this.sendTemplateMessage(formattedPhone, this.whatsAppConfig.otpTemplateId, [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: otp },
              { type: 'text', text: `${expiryMinutes}` },
            ],
          },
        ]);

        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          `OTP sent to ${phoneNumber} via WhatsApp${retries > 0 ? ` (after ${retries} retries)` : ''}`,
          'WhatsAppService'
        );
        success = true;
        return true;
      } catch (error) {
        retries++;
        const retryMsg = retries <= maxRetries ? `, retrying (${retries}/${maxRetries})...` : '';
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.ERROR,
          `Failed to send OTP via WhatsApp: ${error instanceof Error ? error.message : 'Unknown error'}${retryMsg}`,
          'WhatsAppService',
          { stack: (error as Error)?.stack }
        );

        if (retries <= maxRetries) {
          // Exponential backoff: wait longer between each retry
          const backoffMs = 1000 * Math.pow(2, retries - 1); // 1s, 2s, 4s, etc.
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
    }

    return false;
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
   * @param phoneNumber - Recipient phone number (with country code)
   * @param patientName - Patient name for personalization
   * @param doctorName - Doctor name
   * @param appointmentDate - Appointment date
   * @param appointmentTime - Appointment time
   * @param location - Appointment location
   * @returns Promise resolving to true if message was sent successfully
   */
  async sendAppointmentReminder(
    phoneNumber: string,
    patientName: string,
    doctorName: string,
    appointmentDate: string,
    appointmentTime: string,
    location: string
  ): Promise<boolean> {
    if (!this.whatsAppConfig.enabled) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'WhatsApp service is disabled. Skipping appointment reminder.',
        'WhatsAppService'
      );
      return false;
    }

    try {
      const formattedPhone = this.formatPhoneNumber(phoneNumber);

      await this.sendTemplateMessage(formattedPhone, this.whatsAppConfig.appointmentTemplateId, [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: patientName },
            { type: 'text', text: doctorName },
            { type: 'text', text: appointmentDate },
            { type: 'text', text: appointmentTime },
            { type: 'text', text: location },
          ],
        },
      ]);

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
   * Send prescription notification via WhatsApp
   * @param phoneNumber - The recipient's phone number
   * @param patientName - Patient's name
   * @param doctorName - Doctor's name
   * @param medicationDetails - Medication details
   * @param prescriptionUrl - URL to download prescription
   * @returns Promise<boolean> - Success status
   */
  /**
   * Sends prescription notification via WhatsApp
   * @param phoneNumber - Recipient phone number (with country code)
   * @param patientName - Patient name for personalization
   * @param doctorName - Doctor name who prescribed
   * @param medicationDetails - Details about prescribed medications
   * @param prescriptionUrl - Optional prescription document URL
   * @returns Promise resolving to true if message was sent successfully
   */
  async sendPrescriptionNotification(
    phoneNumber: string,
    patientName: string,
    doctorName: string,
    medicationDetails: string,
    prescriptionUrl?: string
  ): Promise<boolean> {
    if (!this.whatsAppConfig.enabled) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'WhatsApp service is disabled. Skipping prescription notification.',
        'WhatsAppService'
      );
      return false;
    }

    try {
      const formattedPhone = this.formatPhoneNumber(phoneNumber);

      await this.sendTemplateMessage(formattedPhone, this.whatsAppConfig.prescriptionTemplateId, [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: patientName },
            { type: 'text', text: doctorName },
            { type: 'text', text: medicationDetails },
          ],
        },
      ]);

      // If prescription URL is provided, send the document
      if (prescriptionUrl) {
        await this.sendDocumentMessage(formattedPhone, prescriptionUrl, 'Your Prescription');
      }

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Prescription notification sent to ${phoneNumber} via WhatsApp`,
        'WhatsAppService'
      );
      return true;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to send prescription notification via WhatsApp: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
   * @param phoneNumber - Recipient phone number (with country code)
   * @param message - Message text to send
   * @returns Promise resolving to true if message was sent successfully
   */
  async sendCustomMessage(phoneNumber: string, message: string): Promise<boolean> {
    if (!this.whatsAppConfig.enabled) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'WhatsApp service is disabled. Skipping custom message.',
        'WhatsAppService'
      );
      return false;
    }

    try {
      const formattedPhone = this.formatPhoneNumber(phoneNumber);

      await axios.post(
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
   * @param to - Recipient phone number
   * @param templateName - Template name to use
   * @param components - Template components with parameters
   * @returns Promise resolving to API response
   * @private
   */
  private async sendTemplateMessage(
    to: string,
    templateName: string,
    components: Array<{
      type: string;
      parameters: Array<{ type: string; text: string }>;
    }>
  ): Promise<unknown> {
    try {
      const response = await axios.post(
        `${this.whatsAppConfig.apiUrl}/${this.whatsAppConfig.phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'template',
          template: {
            name: templateName,
            language: {
              code: 'en',
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
        { stack: (error as Error)?.stack }
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
      const response = await axios.post(
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

  /**
   * Send invoice via WhatsApp
   * @param phoneNumber - The recipient's phone number
   * @param userName - User's name
   * @param invoiceNumber - Invoice number
   * @param amount - Invoice amount
   * @param dueDate - Invoice due date
   * @param invoiceUrl - URL to download invoice PDF
   * @returns Promise<boolean> - Success status
   */
  /**
   * Sends invoice notification via WhatsApp
   * @param phoneNumber - Recipient phone number (with country code)
   * @param userName - User name for personalization
   * @param invoiceNumber - Invoice number
   * @param amount - Invoice amount
   * @param dueDate - Payment due date
   * @param invoiceUrl - Invoice document URL
   * @returns Promise resolving to true if message was sent successfully
   */
  async sendInvoice(
    phoneNumber: string,
    userName: string,
    invoiceNumber: string,
    amount: number,
    dueDate: string,
    invoiceUrl: string
  ): Promise<boolean> {
    if (!this.whatsAppConfig.enabled) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'WhatsApp service is disabled. Skipping invoice delivery.',
        'WhatsAppService'
      );
      return false;
    }

    try {
      const formattedPhone = this.formatPhoneNumber(phoneNumber);

      // Send invoice notification message
      await this.sendCustomMessage(
        formattedPhone,
        `Hello ${userName},\n\n` +
          `Your invoice ${invoiceNumber} for ₹${amount} has been generated.\n` +
          `Due Date: ${dueDate}\n\n` +
          `Please find your invoice attached below. You can also download it from: ${invoiceUrl}\n\n` +
          `Thank you for your business!`
      );

      // Send invoice PDF as document
      await this.sendDocumentMessage(formattedPhone, invoiceUrl, `Invoice ${invoiceNumber}`);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Invoice sent to ${phoneNumber} via WhatsApp`,
        'WhatsAppService'
      );
      return true;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to send invoice via WhatsApp: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
        'WhatsApp service is disabled. Skipping subscription confirmation.',
        'WhatsAppService'
      );
      return false;
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
}
