/**
 * WhatsApp Webhook Service
 * ========================
 * Processes webhook notifications from WhatsApp providers (Meta and Twilio)
 * Handles delivery status, read receipts, and failures
 *
 * @module WhatsAppWebhookService
 * @description WhatsApp webhook processing service
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database/database.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';

/**
 * Meta WhatsApp Webhook Event Structure
 */
interface MetaWhatsAppWebhookEvent {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product?: string;
        metadata?: {
          display_phone_number?: string;
          phone_number_id?: string;
        };
        statuses?: Array<{
          id: string;
          status: 'sent' | 'delivered' | 'read' | 'failed';
          timestamp: string;
          recipient_id?: string;
          errors?: Array<{
            code: number;
            title: string;
            message?: string;
          }>;
        }>;
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: string;
        }>;
      };
      field: string;
    }>;
  }>;
}

/**
 * Twilio WhatsApp Webhook Event Structure
 */
interface TwilioWhatsAppWebhookEvent {
  MessageSid: string;
  MessageStatus: 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'undelivered';
  To: string;
  From: string;
  ErrorCode?: string;
  ErrorMessage?: string;
}

@Injectable()
export class WhatsAppWebhookService {
  constructor(
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Process Meta WhatsApp webhook event
   */
  async processMetaWebhook(event: MetaWhatsAppWebhookEvent): Promise<void> {
    try {
      if (event.object !== 'whatsapp_business_account') {
        await this.loggingService.log(
          LogType.NOTIFICATION,
          LogLevel.WARN,
          'Invalid Meta WhatsApp webhook object type',
          'WhatsAppWebhookService',
          { object: event.object }
        );
        return;
      }

      for (const entry of event.entry) {
        for (const change of entry.changes) {
          if (change.field === 'messages') {
            // Handle message status updates
            if (change.value.statuses) {
              for (const status of change.value.statuses) {
                await this.handleMetaStatusUpdate(status);
              }
            }
          }
        }
      }
    } catch (error) {
      await this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.ERROR,
        'Failed to process Meta WhatsApp webhook',
        'WhatsAppWebhookService',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      throw error;
    }
  }

  /**
   * Process Twilio WhatsApp webhook event
   */
  async processTwilioWebhook(event: TwilioWhatsAppWebhookEvent): Promise<void> {
    try {
      await this.handleTwilioStatusUpdate(event);
    } catch (error) {
      await this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.ERROR,
        'Failed to process Twilio WhatsApp webhook',
        'WhatsAppWebhookService',
        {
          error: error instanceof Error ? error.message : String(error),
          messageSid: event.MessageSid,
        }
      );
      throw error;
    }
  }

  /**
   * Handle Meta WhatsApp status update
   */
  private async handleMetaStatusUpdate(status: {
    id: string;
    status: 'sent' | 'delivered' | 'read' | 'failed';
    timestamp: string;
    recipient_id?: string;
    errors?: Array<{ code: number; title: string; message?: string }>;
  }): Promise<void> {
    const messageId = status.id;
    const recipient = status.recipient_id || 'unknown';
    const statusValue = status.status;

    // Map Meta status to our delivery status
    let deliveryStatus: 'SENT' | 'DELIVERED' | 'FAILED' = 'SENT';
    if (statusValue === 'delivered' || statusValue === 'read') {
      deliveryStatus = 'DELIVERED';
    } else if (statusValue === 'failed') {
      deliveryStatus = 'FAILED';
    }

    // Update delivery status in database
    await this.updateDeliveryStatus(
      messageId,
      deliveryStatus,
      recipient,
      'whatsapp',
      status.errors?.[0]?.message || status.errors?.[0]?.title
    );

    await this.loggingService.log(
      LogType.NOTIFICATION,
      statusValue === 'failed' ? LogLevel.WARN : LogLevel.INFO,
      `Meta WhatsApp message ${statusValue}`,
      'WhatsAppWebhookService',
      {
        messageId,
        status: statusValue,
        recipient,
        ...(status.errors && { errors: status.errors }),
      }
    );
  }

  /**
   * Handle Twilio WhatsApp status update
   */
  private async handleTwilioStatusUpdate(event: TwilioWhatsAppWebhookEvent): Promise<void> {
    const messageId = event.MessageSid;
    const recipient = event.To;
    const statusValue = event.MessageStatus;

    // Map Twilio status to our delivery status
    let deliveryStatus: 'SENT' | 'DELIVERED' | 'FAILED' = 'SENT';
    if (statusValue === 'delivered' || statusValue === 'read') {
      deliveryStatus = 'DELIVERED';
    } else if (statusValue === 'failed' || statusValue === 'undelivered') {
      deliveryStatus = 'FAILED';
    }

    // Update delivery status in database
    await this.updateDeliveryStatus(
      messageId,
      deliveryStatus,
      recipient,
      'whatsapp',
      event.ErrorMessage || event.ErrorCode
    );

    await this.loggingService.log(
      LogType.NOTIFICATION,
      statusValue === 'failed' || statusValue === 'undelivered' ? LogLevel.WARN : LogLevel.INFO,
      `Twilio WhatsApp message ${statusValue}`,
      'WhatsAppWebhookService',
      {
        messageId,
        status: statusValue,
        recipient,
        ...(event.ErrorCode && { errorCode: event.ErrorCode }),
        ...(event.ErrorMessage && { errorMessage: event.ErrorMessage }),
      }
    );
  }

  /**
   * Update delivery status in notification delivery log
   */
  private async updateDeliveryStatus(
    messageId: string,
    status: 'SENT' | 'DELIVERED' | 'FAILED',
    recipient: string,
    channel: 'whatsapp',
    failureReason?: string
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
                  failureReason?: string;
                };
              }) => Promise<unknown>;
            };
          };
          const updateData: {
            status: string;
            deliveredAt?: Date;
            failedAt?: Date;
            failureReason?: string;
          } = { status };

          if (status === 'DELIVERED') {
            updateData.deliveredAt = new Date();
          } else if (status === 'FAILED') {
            updateData.failedAt = new Date();
            if (failureReason) {
              updateData.failureReason = failureReason;
            }
          }

          await notificationClient.notificationDeliveryLog.updateMany({
            where: {
              OR: [
                {
                  providerResponse: {
                    path: ['messageId'],
                    equals: messageId,
                  },
                },
                {
                  providerResponse: {
                    path: ['sid'],
                    equals: messageId,
                  },
                },
              ],
              channel,
            },
            data: updateData,
          });
        },
        {
          userId: 'system',
          userRole: 'SYSTEM',
          clinicId: '',
          operation: 'UPDATE_WHATSAPP_DELIVERY_STATUS',
          resourceType: 'NOTIFICATION_DELIVERY_LOG',
          resourceId: messageId,
          timestamp: new Date(),
        }
      );
    } catch (error) {
      // Log but don't throw - delivery status update is not critical
      await this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.DEBUG,
        'Failed to update delivery status (non-critical)',
        'WhatsAppWebhookService',
        {
          error: error instanceof Error ? error.message : String(error),
          messageId,
          recipient,
          channel,
        }
      );
    }
  }
}
