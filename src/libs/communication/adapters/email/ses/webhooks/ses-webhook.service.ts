/**
 * AWS SES Webhook Service
 * ========================
 * Processes SNS notifications from AWS SES
 * Handles bounces, complaints, and deliveries
 *
 * @module SESWebhookService
 * @description AWS SES webhook processing service
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { SuppressionListService } from '@communication/adapters/email/suppression-list.service';
import { ClinicEmailMapperService } from '@communication/adapters/email/clinic-email-mapper.service';
import { DatabaseService } from '@infrastructure/database/database.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';
import * as https from 'https';
import * as url from 'url';

interface SNSMessage {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Subject?: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  UnsubscribeURL: string;
  SubscribeURL?: string;
  Token?: string;
}

interface SESEvent {
  eventType: 'bounce' | 'complaint' | 'delivery' | 'send' | 'reject' | 'open' | 'click';
  mail: {
    timestamp: string;
    source: string;
    messageId: string;
    destination: string[];
    headersTruncated: boolean;
    headers: Array<{ name: string; value: string }>;
    commonHeaders: {
      from: string[];
      to: string[];
      subject: string;
      messageId: string;
    };
  };
  bounce?: {
    bounceType: 'Permanent' | 'Transient' | 'Undetermined';
    bounceSubType: string;
    bouncedRecipients: Array<{
      emailAddress: string;
      action?: string;
      status?: string;
      diagnosticCode?: string;
    }>;
    timestamp: string;
    feedbackId: string;
    reportingMTA?: string;
  };
  complaint?: {
    complainedRecipients: Array<{
      emailAddress: string;
    }>;
    timestamp: string;
    feedbackId: string;
    userAgent?: string;
    complaintFeedbackType?: string;
    arrivalDate?: string;
  };
  delivery?: {
    timestamp: string;
    recipients: string[];
    smtpResponse: string;
    reportingMTA: string;
  };
}

@Injectable()
export class SESWebhookService {
  constructor(
    private readonly configService: ConfigService,
    private readonly suppressionListService: SuppressionListService,
    private readonly clinicEmailMapper: ClinicEmailMapperService,
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Confirm SNS subscription
   */
  async confirmSubscription(snsMessage: SNSMessage): Promise<void> {
    try {
      if (!snsMessage.SubscribeURL || !snsMessage.Token) {
        await this.loggingService.log(
          LogType.EMAIL,
          LogLevel.WARN,
          'SNS subscription confirmation missing SubscribeURL or Token',
          'SESWebhookService',
          { messageId: snsMessage.MessageId }
        );
        return;
      }

      // Confirm subscription by visiting the SubscribeURL
      await this.visitURL(snsMessage.SubscribeURL);

      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.INFO,
        'SNS subscription confirmed successfully',
        'SESWebhookService',
        {
          messageId: snsMessage.MessageId,
          topicArn: snsMessage.TopicArn,
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        'Failed to confirm SNS subscription',
        'SESWebhookService',
        {
          error: error instanceof Error ? error.message : String(error),
          messageId: snsMessage.MessageId,
        }
      );
      throw error;
    }
  }

  /**
   * Process SNS notification
   */
  async processNotification(snsMessage: SNSMessage): Promise<void> {
    try {
      // Parse SES event from SNS message
      const sesEvent = JSON.parse(snsMessage.Message) as SESEvent;

      switch (sesEvent.eventType) {
        case 'bounce':
          await this.handleBounce(sesEvent);
          break;
        case 'complaint':
          await this.handleComplaint(sesEvent);
          break;
        case 'delivery':
          await this.handleDelivery(sesEvent);
          break;
        case 'send':
        case 'reject':
        case 'open':
        case 'click':
          // Log but don't process (tracking events)
          await this.loggingService.log(
            LogType.EMAIL,
            LogLevel.DEBUG,
            `SES ${sesEvent.eventType} event received`,
            'SESWebhookService',
            {
              eventType: sesEvent.eventType,
              messageId: sesEvent.mail.messageId,
            }
          );
          break;
        default:
          await this.loggingService.log(
            LogType.EMAIL,
            LogLevel.WARN,
            `Unknown SES event type: ${String(sesEvent.eventType)}`,
            'SESWebhookService',
            {
              eventType: String(sesEvent.eventType),
              messageId: sesEvent.mail.messageId,
            }
          );
      }
    } catch (error) {
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        'Failed to process SNS notification',
        'SESWebhookService',
        {
          error: error instanceof Error ? error.message : String(error),
          messageId: snsMessage.MessageId,
        }
      );
      throw error;
    }
  }

  /**
   * Handle bounce event
   */
  private async handleBounce(event: SESEvent): Promise<void> {
    if (!event.bounce) {
      return;
    }

    const bounceType = event.bounce.bounceType;
    const bounceSubType = event.bounce.bounceSubType;
    const messageId = event.mail.messageId;

    for (const recipient of event.bounce.bouncedRecipients) {
      const email = recipient.emailAddress.toLowerCase();

      // Identify clinic from source email (multi-tenant support)
      const clinicId = await this.clinicEmailMapper.findClinicBySourceEmail(event.mail.source);

      // Find user by email
      const user = await this.findUserByEmail(email);

      // Add to suppression list (only for permanent bounces)
      if (bounceType === 'Permanent') {
        await this.suppressionListService.handleBounce(
          email,
          bounceType,
          bounceSubType,
          messageId,
          user?.id,
          {
            feedbackId: event.bounce.feedbackId,
            diagnosticCode: recipient.diagnosticCode,
            action: recipient.action,
            status: recipient.status,
          },
          clinicId || undefined
        );
      }

      // Update user's email preference if user found and permanent bounce
      if (user && bounceType === 'Permanent') {
        await this.updateUserEmailPreference(user.id, false);
      }

      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.WARN,
        `SES bounce event processed: ${bounceType} - ${bounceSubType}`,
        'SESWebhookService',
        {
          email,
          bounceType,
          bounceSubType,
          messageId,
          clinicId,
        }
      );
    }
  }

  /**
   * Handle complaint event
   */
  private async handleComplaint(event: SESEvent): Promise<void> {
    if (!event.complaint) {
      return;
    }

    const messageId = event.mail.messageId;
    const complaintType = event.complaint.complaintFeedbackType || 'spam';

    for (const recipient of event.complaint.complainedRecipients) {
      const email = recipient.emailAddress.toLowerCase();

      // Identify clinic from source email (multi-tenant support)
      const clinicId = await this.clinicEmailMapper.findClinicBySourceEmail(event.mail.source);

      // Find user by email
      const user = await this.findUserByEmail(email);

      // Add to suppression list
      await this.suppressionListService.handleComplaint(
        email,
        complaintType,
        messageId,
        user?.id,
        {
          feedbackId: event.complaint.feedbackId,
          userAgent: event.complaint.userAgent,
          arrivalDate: event.complaint.arrivalDate,
        },
        clinicId || undefined
      );

      // Update user's email preference
      if (user) {
        await this.updateUserEmailPreference(user.id, false);
      }

      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.WARN,
        `SES complaint event processed: ${complaintType}`,
        'SESWebhookService',
        {
          email,
          complaintType,
          messageId,
          clinicId,
        }
      );
    }
  }

  /**
   * Handle delivery event
   */
  private async handleDelivery(event: SESEvent): Promise<void> {
    if (!event.delivery) {
      return;
    }

    const messageId = event.mail.messageId;

    for (const recipient of event.delivery.recipients) {
      const email = recipient.toLowerCase();

      // Identify clinic from source email (multi-tenant support)
      const clinicId = await this.clinicEmailMapper.findClinicBySourceEmail(event.mail.source);

      // Update delivery status in database if notification exists
      await this.updateDeliveryStatus(messageId, 'DELIVERED', email);

      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.INFO,
        'SES email delivered successfully',
        'SESWebhookService',
        {
          messageId,
          email,
          clinicId,
        }
      );
    }
  }

  /**
   * Find user by email
   */
  private async findUserByEmail(email: string): Promise<{ id: string } | null> {
    try {
      const user = await this.databaseService.executeHealthcareRead(async client => {
        const userClient = client as unknown as {
          user: {
            findFirst: (args: {
              where: { email: string };
              select: { id: true };
            }) => Promise<{ id: string } | null>;
          };
        };
        return await userClient.user.findFirst({
          where: { email: email.toLowerCase() },
          select: { id: true },
        });
      });

      return user;
    } catch (error) {
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.WARN,
        'Failed to find user by email',
        'SESWebhookService',
        {
          error: error instanceof Error ? error.message : String(error),
          email,
        }
      );
      return null;
    }
  }

  /**
   * Update user email preference
   */
  private async updateUserEmailPreference(userId: string, enabled: boolean): Promise<void> {
    try {
      await this.databaseService.executeHealthcareWrite(
        async client => {
          const preferenceClient = client as unknown as {
            notificationPreference: {
              upsert: (args: {
                where: { userId: string };
                update: { emailEnabled: boolean; updatedAt: Date };
                create: { userId: string; emailEnabled: boolean };
              }) => Promise<unknown>;
            };
          };
          await preferenceClient.notificationPreference.upsert({
            where: { userId },
            update: { emailEnabled: enabled, updatedAt: new Date() },
            create: { userId, emailEnabled: enabled },
          });
        },
        {
          userId,
          userRole: 'SYSTEM',
          clinicId: '',
          operation: 'UPDATE_EMAIL_PREFERENCE',
          resourceType: 'NOTIFICATION_PREFERENCE',
          resourceId: userId,
          timestamp: new Date(),
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.WARN,
        'Failed to update user email preference',
        'SESWebhookService',
        {
          error: error instanceof Error ? error.message : String(error),
          userId,
        }
      );
    }
  }

  /**
   * Update delivery status in notification delivery log
   */
  private async updateDeliveryStatus(
    messageId: string,
    status: 'DELIVERED' | 'FAILED' | 'BOUNCED',
    recipient: string
  ): Promise<void> {
    try {
      await this.databaseService.executeHealthcareWrite(
        async client => {
          const notificationClient = client as unknown as {
            notificationDeliveryLog: {
              updateMany: (args: {
                where: {
                  OR?: Array<{ providerResponse: { path: string[]; equals: string } }>;
                  channel: string;
                };
                data: {
                  status: string;
                  deliveredAt?: Date;
                  failedAt?: Date;
                };
              }) => Promise<unknown>;
            };
          };
          await notificationClient.notificationDeliveryLog.updateMany({
            where: {
              OR: [
                {
                  providerResponse: {
                    path: ['messageId'],
                    equals: messageId,
                  },
                },
              ],
              channel: 'email',
            },
            data: {
              status,
              ...(status === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
              ...(status === 'FAILED' || status === 'BOUNCED' ? { failedAt: new Date() } : {}),
            },
          });
        },
        {
          userId: 'system',
          userRole: 'SYSTEM',
          clinicId: '',
          operation: 'UPDATE_DELIVERY_STATUS',
          resourceType: 'NOTIFICATION_DELIVERY_LOG',
          resourceId: messageId,
          timestamp: new Date(),
        }
      );
    } catch (error) {
      // Log but don't throw - delivery status update is not critical
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.DEBUG,
        'Failed to update delivery status (non-critical)',
        'SESWebhookService',
        {
          error: error instanceof Error ? error.message : String(error),
          messageId,
          recipient,
        }
      );
    }
  }

  /**
   * Visit URL (for SNS subscription confirmation)
   */
  private visitURL(urlString: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const parsedUrl = url.parse(urlString);
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || 443,
        path: parsedUrl.path,
        method: 'GET',
      };

      const req = https.request(options, res => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });

      req.on('error', reject);
      req.end();
    });
  }

  /**
   * Log unknown message type
   */
  async logUnknownMessageType(messageType: string): Promise<void> {
    await this.loggingService.log(
      LogType.EMAIL,
      LogLevel.WARN,
      `Unknown SNS message type: ${messageType}`,
      'SESWebhookService',
      { messageType }
    );
  }

  /**
   * Log error
   */
  async logError(error: Error, snsMessage: SNSMessage): Promise<void> {
    await this.loggingService.log(
      LogType.EMAIL,
      LogLevel.ERROR,
      'SES webhook processing error',
      'SESWebhookService',
      {
        error: error.message,
        stack: error.stack,
        messageId: snsMessage.MessageId,
        messageType: snsMessage.Type,
      }
    );
  }
}
