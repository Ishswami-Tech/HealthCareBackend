import { Injectable, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
// Use direct import to avoid TDZ issues with barrel exports
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogLevel, LogType } from '@core/types';

export interface SESEmailOptions {
  to: string | string[];
  subject: string;
  body: string;
  isHtml?: boolean;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
}

export interface AppointmentReminderData {
  patientName: string;
  doctorName: string;
  date: string;
  time: string;
  location: string;
  appointmentId?: string;
}

export interface PrescriptionReadyData {
  patientName: string;
  doctorName: string;
  prescriptionId: string;
  medications: string[];
  pickupInstructions?: string;
}

export interface SESEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

@Injectable()
export class SESEmailService implements OnModuleInit {
  private sesClient: SESClient | null = null;
  private isInitialized = false;
  private fromEmail: string = '';
  private fromName: string = '';

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

  onModuleInit(): void {
    this.initializeAWSSES();
  }

  private initializeAWSSES(): void {
    try {
      // Use ConfigService (which uses dotenv) for environment variable access
      const awsRegion = this.configService.getEnv('AWS_REGION');
      const awsAccessKeyId = this.configService.getEnv('AWS_ACCESS_KEY_ID');
      const awsSecretAccessKey = this.configService.getEnv('AWS_SECRET_ACCESS_KEY');
      this.fromEmail =
        this.configService.getEnv('AWS_SES_FROM_EMAIL', 'noreply@healthcare.com') ||
        'noreply@healthcare.com';
      this.fromName =
        this.configService.getEnv('AWS_SES_FROM_NAME', 'Healthcare App') || 'Healthcare App';

      if (!awsRegion || !awsAccessKeyId || !awsSecretAccessKey) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'AWS credentials not provided, SES email service will be disabled',
          'SESEmailService'
        );
        this.isInitialized = false;
        return;
      }

      this.sesClient = new SESClient({
        region: awsRegion,
        credentials: {
          accessKeyId: awsAccessKeyId,
          secretAccessKey: awsSecretAccessKey,
        },
      });

      this.isInitialized = true;
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'AWS SES email service initialized successfully',
        'SESEmailService'
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        'Failed to initialize AWS SES',
        'SESEmailService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      this.isInitialized = false;
    }
  }

  async sendEmail(options: SESEmailOptions): Promise<SESEmailResult> {
    if (!this.isInitialized || !this.sesClient) {
      void this.loggingService.log(
        LogType.EMAIL,
        LogLevel.WARN,
        'SES email service is not initialized, skipping email send',
        'SESEmailService'
      );
      return { success: false, error: 'Service not initialized' };
    }

    try {
      const toAddresses = Array.isArray(options.to) ? options.to : [options.to];

      const command = new SendEmailCommand({
        Source: `${this.fromName} <${this.fromEmail}>`,
        Destination: {
          ToAddresses: toAddresses,
          CcAddresses: options.cc,
          BccAddresses: options.bcc,
        },
        Message: {
          Subject: {
            Data: options.subject,
            Charset: 'UTF-8',
          },
          Body:
            options.isHtml !== false
              ? {
                  Html: {
                    Data: options.body,
                    Charset: 'UTF-8',
                  },
                }
              : {
                  Text: {
                    Data: options.body,
                    Charset: 'UTF-8',
                  },
                },
        },
        ReplyToAddresses: options.replyTo ? [options.replyTo] : undefined,
      });

      const response = await this.sesClient.send(command);

      void this.loggingService.log(
        LogType.EMAIL,
        LogLevel.INFO,
        'SES email sent successfully',
        'SESEmailService',
        {
          messageId: response.MessageId,
          to: toAddresses.join(', '),
          subject: options.subject,
        }
      );

      return {
        success: true,
        ...(response.MessageId && { messageId: response.MessageId }),
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        'Failed to send SES email',
        'SESEmailService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          to: options.to,
          subject: options.subject,
        }
      );

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async sendAppointmentReminder(
    to: string,
    appointmentData: AppointmentReminderData
  ): Promise<SESEmailResult> {
    const subject = `Appointment Reminder - ${appointmentData.date} at ${appointmentData.time}`;
    const htmlBody = this.generateAppointmentReminderTemplate(appointmentData);

    return this.sendEmail({
      to,
      subject,
      body: htmlBody,
      isHtml: true,
    });
  }

  async sendPrescriptionReady(
    to: string,
    prescriptionData: PrescriptionReadyData
  ): Promise<SESEmailResult> {
    const subject = `Prescription Ready - ${prescriptionData.prescriptionId}`;
    const htmlBody = this.generatePrescriptionReadyTemplate(prescriptionData);

    return this.sendEmail({
      to,
      subject,
      body: htmlBody,
      isHtml: true,
    });
  }

  async sendBulkEmails(
    emails: Array<{ to: string; subject: string; body: string }>
  ): Promise<{ successCount: number; failureCount: number; errors: string[] }> {
    if (!this.isInitialized || !this.sesClient) {
      void this.loggingService.log(
        LogType.EMAIL,
        LogLevel.WARN,
        'SES email service is not initialized',
        'SESEmailService'
      );
      return {
        successCount: 0,
        failureCount: emails.length,
        errors: ['Service not initialized'],
      };
    }

    let successCount = 0;
    let failureCount = 0;
    const errors: string[] = [];

    // Send emails in batches to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);
      const batchPromises = batch.map(async email => {
        const result = await this.sendEmail({
          to: email.to,
          subject: email.subject,
          body: email.body,
          isHtml: true,
        });

        if (result.success) {
          successCount++;
        } else {
          failureCount++;
          if (result.error) {
            errors.push(`${email.to}: ${result.error}`);
          }
        }
      });

      await Promise.all(batchPromises);

      // Small delay between batches to respect rate limits
      if (i + batchSize < emails.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    void this.loggingService.log(
      LogType.EMAIL,
      LogLevel.INFO,
      'Bulk email send completed',
      'SESEmailService',
      {
        successCount,
        failureCount,
        totalEmails: emails.length,
      }
    );

    return { successCount, failureCount, errors };
  }

  private generateAppointmentReminderTemplate(data: AppointmentReminderData): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h2 style="color: #2c3e50; margin: 0;">Appointment Reminder</h2>
        </div>

        <p style="font-size: 16px; color: #333;">Dear ${data.patientName},</p>

        <p style="font-size: 14px; color: #555; line-height: 1.6;">
          This is a friendly reminder about your upcoming appointment:
        </p>

        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #4CAF50;">
          <div style="margin-bottom: 10px;"><strong style="color: #2c3e50;">Doctor:</strong> <span style="color: #555;">${data.doctorName}</span></div>
          <div style="margin-bottom: 10px;"><strong style="color: #2c3e50;">Date:</strong> <span style="color: #555;">${data.date}</span></div>
          <div style="margin-bottom: 10px;"><strong style="color: #2c3e50;">Time:</strong> <span style="color: #555;">${data.time}</span></div>
          <div style="margin-bottom: 10px;"><strong style="color: #2c3e50;">Location:</strong> <span style="color: #555;">${data.location}</span></div>
          ${data.appointmentId ? `<div><strong style="color: #2c3e50;">Appointment ID:</strong> <span style="color: #555;">${data.appointmentId}</span></div>` : ''}
        </div>

        <div style="background-color: #e3f2fd; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #2196F3;">
          <p style="margin: 0; font-size: 14px; color: #1976d2;">
            <strong>Please Note:</strong> Arrive 15 minutes early for check-in and bring a valid ID and insurance card.
          </p>
        </div>

        <p style="font-size: 14px; color: #555; line-height: 1.6;">
          If you need to reschedule or have any questions, please contact us as soon as possible.
        </p>

        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
          <p style="margin: 0; font-size: 14px; color: #333;">Best regards,</p>
          <p style="margin: 5px 0 0 0; font-size: 14px; color: #4CAF50; font-weight: bold;">Healthcare Team</p>
        </div>

        <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #888; text-align: center;">
          <p style="margin: 0;">This is an automated reminder. Please do not reply to this email.</p>
        </div>
      </div>
    `;
  }

  private generatePrescriptionReadyTemplate(data: PrescriptionReadyData): string {
    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h2 style="color: #2c3e50; margin: 0;">Prescription Ready for Pickup</h2>
        </div>

        <p style="font-size: 16px; color: #333;">Dear ${data.patientName},</p>

        <p style="font-size: 14px; color: #555; line-height: 1.6;">
          Your prescription is ready for pickup at our pharmacy:
        </p>

        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #FF9800;">
          <div style="margin-bottom: 10px;"><strong style="color: #2c3e50;">Prescription ID:</strong> <span style="color: #555;">${data.prescriptionId}</span></div>
          <div style="margin-bottom: 15px;"><strong style="color: #2c3e50;">Prescribed by:</strong> <span style="color: #555;">${data.doctorName}</span></div>

          <div style="margin-bottom: 10px;"><strong style="color: #2c3e50;">Medications:</strong></div>
          <ul style="margin: 5px 0 0 20px; padding: 0; color: #555;">
            ${data.medications.map(medication => `<li style="margin-bottom: 5px;">${medication}</li>`).join('')}
          </ul>
        </div>

        <div style="background-color: #e8f5e9; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #4CAF50;">
          <p style="margin: 0; font-size: 14px; color: #2e7d32;">
            <strong>Pickup Requirements:</strong> Please bring a valid photo ID when collecting your prescription.
            ${data.pickupInstructions ? ` ${data.pickupInstructions}` : ''}
          </p>
        </div>

        <p style="font-size: 14px; color: #555; line-height: 1.6;">
          If you have any questions about your medication or pickup process, please don't hesitate to contact us.
        </p>

        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0;">
          <p style="margin: 0; font-size: 14px; color: #333;">Best regards,</p>
          <p style="margin: 5px 0 0 0; font-size: 14px; color: #4CAF50; font-weight: bold;">Healthcare Pharmacy Team</p>
        </div>

        <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #e0e0e0; font-size: 12px; color: #888; text-align: center;">
          <p style="margin: 0;">This is an automated notification. Please do not reply to this email.</p>
        </div>
      </div>
    `;
  }

  isHealthy(): boolean {
    return this.isInitialized;
  }
}
