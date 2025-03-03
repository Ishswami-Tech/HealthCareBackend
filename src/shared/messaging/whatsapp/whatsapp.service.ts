import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { WhatsAppConfig } from './whatsapp.config';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly whatsAppConfig: WhatsAppConfig
  ) {}

  /**
   * Send OTP via WhatsApp
   * @param phoneNumber - The recipient's phone number (with country code)
   * @param otp - The OTP code
   * @param expiryMinutes - OTP expiry time in minutes
   * @param maxRetries - Maximum number of retry attempts
   * @returns Promise<boolean> - Success status
   */
  async sendOTP(
    phoneNumber: string, 
    otp: string, 
    expiryMinutes: number = 10,
    maxRetries: number = 2
  ): Promise<boolean> {
    if (!this.whatsAppConfig.enabled) {
      this.logger.log('WhatsApp service is disabled. Skipping OTP send.');
      return false;
    }

    let retries = 0;
    let success = false;

    while (retries <= maxRetries && !success) {
      try {
        const formattedPhone = this.formatPhoneNumber(phoneNumber);
        
        const response = await this.sendTemplateMessage(
          formattedPhone,
          this.whatsAppConfig.otpTemplateId,
          [
            { type: 'body', parameters: [
              { type: 'text', text: otp },
              { type: 'text', text: `${expiryMinutes}` }
            ]}
          ]
        );

        this.logger.log(`OTP sent to ${phoneNumber} via WhatsApp${retries > 0 ? ` (after ${retries} retries)` : ''}`);
        success = true;
        return true;
      } catch (error) {
        retries++;
        const retryMsg = retries <= maxRetries ? `, retrying (${retries}/${maxRetries})...` : '';
        this.logger.error(`Failed to send OTP via WhatsApp: ${error.message}${retryMsg}`, error.stack);
        
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
  async sendAppointmentReminder(
    phoneNumber: string,
    patientName: string,
    doctorName: string,
    appointmentDate: string,
    appointmentTime: string,
    location: string
  ): Promise<boolean> {
    if (!this.whatsAppConfig.enabled) {
      this.logger.log('WhatsApp service is disabled. Skipping appointment reminder.');
      return false;
    }

    try {
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      
      const response = await this.sendTemplateMessage(
        formattedPhone,
        this.whatsAppConfig.appointmentTemplateId,
        [
          { type: 'body', parameters: [
            { type: 'text', text: patientName },
            { type: 'text', text: doctorName },
            { type: 'text', text: appointmentDate },
            { type: 'text', text: appointmentTime },
            { type: 'text', text: location }
          ]}
        ]
      );

      this.logger.log(`Appointment reminder sent to ${phoneNumber} via WhatsApp`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send appointment reminder via WhatsApp: ${error.message}`, error.stack);
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
  async sendPrescriptionNotification(
    phoneNumber: string,
    patientName: string,
    doctorName: string,
    medicationDetails: string,
    prescriptionUrl?: string
  ): Promise<boolean> {
    if (!this.whatsAppConfig.enabled) {
      this.logger.log('WhatsApp service is disabled. Skipping prescription notification.');
      return false;
    }

    try {
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      
      const response = await this.sendTemplateMessage(
        formattedPhone,
        this.whatsAppConfig.prescriptionTemplateId,
        [
          { type: 'body', parameters: [
            { type: 'text', text: patientName },
            { type: 'text', text: doctorName },
            { type: 'text', text: medicationDetails }
          ]}
        ]
      );

      // If prescription URL is provided, send the document
      if (prescriptionUrl) {
        await this.sendDocumentMessage(formattedPhone, prescriptionUrl, 'Your Prescription');
      }

      this.logger.log(`Prescription notification sent to ${phoneNumber} via WhatsApp`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send prescription notification via WhatsApp: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * Send a custom message via WhatsApp
   * @param phoneNumber - The recipient's phone number
   * @param message - The message to send
   * @returns Promise<boolean> - Success status
   */
  async sendCustomMessage(phoneNumber: string, message: string): Promise<boolean> {
    if (!this.whatsAppConfig.enabled) {
      this.logger.log('WhatsApp service is disabled. Skipping custom message.');
      return false;
    }

    try {
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      
      const response = await axios.post(
        `${this.whatsAppConfig.apiUrl}/${this.whatsAppConfig.phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: formattedPhone,
          type: 'text',
          text: {
            body: message
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.whatsAppConfig.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      this.logger.log(`Custom message sent to ${phoneNumber} via WhatsApp`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send custom message via WhatsApp: ${error.message}`, error.stack);
      return false;
    }
  }

  /**
   * Send a template message via WhatsApp
   * @param to - The recipient's phone number
   * @param templateName - The template name
   * @param components - Template components
   * @returns Promise<any> - API response
   */
  private async sendTemplateMessage(
    to: string,
    templateName: string,
    components: any[]
  ): Promise<any> {
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
              code: 'en'
            },
            components
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.whatsAppConfig.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      this.logger.error(`WhatsApp template message error: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Send a document message via WhatsApp
   * @param to - The recipient's phone number
   * @param documentUrl - URL of the document
   * @param caption - Caption for the document
   * @returns Promise<any> - API response
   */
  private async sendDocumentMessage(
    to: string,
    documentUrl: string,
    caption: string
  ): Promise<any> {
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
            caption
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.whatsAppConfig.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;
    } catch (error) {
      this.logger.error(`WhatsApp document message error: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Format phone number to international format
   * @param phoneNumber - The phone number to format
   * @returns string - Formatted phone number
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