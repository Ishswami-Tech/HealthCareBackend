/**
 * ZeptoMail Webhook Service
 * ==========================
 * Processes webhook notifications from ZeptoMail
 * Handles bounces, complaints, and deliveries
 *
 * @module ZeptoMailWebhookService
 * @description ZeptoMail webhook processing service
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { SuppressionListService } from '@communication/adapters/email/suppression-list.service';
import { ClinicEmailMapperService } from '@communication/adapters/email/clinic-email-mapper.service';
import { DatabaseService } from '@infrastructure/database/database.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';

/**
 * ZeptoMail Webhook Event Structure
 * Based on ZeptoMail webhook documentation
 */
interface ZeptoMailWebhookEvent {
  event: 'bounce' | 'complaint' | 'delivery' | 'spam' | 'unsubscribe';
  timestamp: string;
  message_id?: string;
  recipient?: string;
  reason?: string;
  bounce_type?: 'hard' | 'soft' | 'transient';
  complaint_type?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class ZeptoMailWebhookService {
  constructor(
    private readonly suppressionListService: SuppressionListService,
    private readonly clinicEmailMapper: ClinicEmailMapperService,
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Process ZeptoMail webhook event
   */
  async processWebhook(event: ZeptoMailWebhookEvent): Promise<void> {
    try {
      switch (event.event) {
        case 'bounce':
          await this.handleBounce(event);
          break;
        case 'complaint':
          await this.handleComplaint(event);
          break;
        case 'delivery':
          await this.handleDelivery(event);
          break;
        case 'spam':
          await this.handleSpam(event);
          break;
        case 'unsubscribe':
          await this.handleUnsubscribe(event);
          break;
        default:
          await this.loggingService.log(
            LogType.EMAIL,
            LogLevel.WARN,
            `Unknown ZeptoMail webhook event: ${String(event.event)}`,
            'ZeptoMailWebhookService',
            { event: String(event.event), messageId: event.message_id }
          );
      }
    } catch (error) {
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        'Failed to process ZeptoMail webhook',
        'ZeptoMailWebhookService',
        {
          error: error instanceof Error ? error.message : String(error),
          event: event.event,
          messageId: event.message_id,
        }
      );
      throw error;
    }
  }

  /**
   * Handle bounce event
   */
  private async handleBounce(event: ZeptoMailWebhookEvent): Promise<void> {
    if (!event.recipient) {
      return;
    }

    const email = event.recipient.toLowerCase();
    const bounceType = event.bounce_type || 'hard';
    const messageId = event.message_id || 'unknown';
    const reason = event.reason || 'Unknown bounce reason';

    // Identify clinic from recipient email (multi-tenant support)
    const clinicId = await this.clinicEmailMapper.findClinicBySourceEmail(email);

    // Find user by email
    const user = await this.findUserByEmail(email);

    // Map ZeptoMail bounce types to SES-style bounce types
    const sesBounceType =
      bounceType === 'hard' ? 'Permanent' : bounceType === 'soft' ? 'Transient' : 'Undetermined';

    // Add to suppression list (only for permanent/hard bounces)
    if (bounceType === 'hard') {
      await this.suppressionListService.handleBounce(
        email,
        sesBounceType,
        reason,
        messageId,
        user?.id,
        {
          feedbackId: messageId,
          diagnosticCode: reason,
          metadata: event.metadata,
        },
        clinicId || undefined
      );
    }

    // Update user's email preference if user found and permanent bounce
    if (user && bounceType === 'hard') {
      await this.updateUserEmailPreference(user.id, false);
    }

    await this.loggingService.log(
      LogType.EMAIL,
      LogLevel.WARN,
      `ZeptoMail bounce event processed: ${bounceType} - ${reason}`,
      'ZeptoMailWebhookService',
      {
        bounceType,
        reason,
        messageId,
        email,
        clinicId,
      }
    );
  }

  /**
   * Handle complaint event
   */
  private async handleComplaint(event: ZeptoMailWebhookEvent): Promise<void> {
    if (!event.recipient) {
      return;
    }

    const email = event.recipient.toLowerCase();
    const complaintType = event.complaint_type || 'spam';
    const messageId = event.message_id || 'unknown';

    // Identify clinic from recipient email (multi-tenant support)
    const clinicId = await this.clinicEmailMapper.findClinicBySourceEmail(email);

    // Find user by email
    const user = await this.findUserByEmail(email);

    // Add to suppression list
    await this.suppressionListService.handleComplaint(
      email,
      complaintType,
      messageId,
      user?.id,
      {
        feedbackId: messageId,
        metadata: event.metadata,
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
      `ZeptoMail complaint event processed: ${complaintType}`,
      'ZeptoMailWebhookService',
      {
        complaintType,
        messageId,
        email,
        clinicId,
      }
    );
  }

  /**
   * Handle delivery event
   */
  private async handleDelivery(event: ZeptoMailWebhookEvent): Promise<void> {
    if (!event.recipient) {
      return;
    }

    const email = event.recipient.toLowerCase();
    const messageId = event.message_id || 'unknown';

    // Identify clinic from recipient email (multi-tenant support)
    const clinicId = await this.clinicEmailMapper.findClinicBySourceEmail(email);

    // Update delivery status in database if notification exists
    await this.updateDeliveryStatus(messageId, 'DELIVERED', email);

    await this.loggingService.log(
      LogType.EMAIL,
      LogLevel.INFO,
      'ZeptoMail email delivered successfully',
      'ZeptoMailWebhookService',
      {
        messageId,
        email,
        clinicId,
      }
    );
  }

  /**
   * Handle spam event (treated as complaint)
   */
  private async handleSpam(event: ZeptoMailWebhookEvent): Promise<void> {
    // Treat spam as complaint
    await this.handleComplaint({
      ...event,
      event: 'complaint',
      complaint_type: 'spam',
    });
  }

  /**
   * Handle unsubscribe event
   */
  private async handleUnsubscribe(event: ZeptoMailWebhookEvent): Promise<void> {
    if (!event.recipient) {
      return;
    }

    const email = event.recipient.toLowerCase();
    const messageId = event.message_id || 'unknown';

    // Identify clinic from recipient email (multi-tenant support)
    const clinicId = await this.clinicEmailMapper.findClinicBySourceEmail(email);

    // Find user by email
    const user = await this.findUserByEmail(email);

    // Add to suppression list via handleUnsubscribe
    await this.suppressionListService.handleUnsubscribe(
      email,
      user?.id,
      event.metadata,
      clinicId || undefined
    );

    // Update user's email preference
    if (user) {
      await this.updateUserEmailPreference(user.id, false);
    }

    await this.loggingService.log(
      LogType.EMAIL,
      LogLevel.INFO,
      'ZeptoMail unsubscribe event processed',
      'ZeptoMailWebhookService',
      {
        messageId,
        email,
        clinicId,
      }
    );
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
        'ZeptoMailWebhookService',
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
        'ZeptoMailWebhookService',
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
        'ZeptoMailWebhookService',
        {
          error: error instanceof Error ? error.message : String(error),
          messageId,
          recipient,
        }
      );
    }
  }
}
