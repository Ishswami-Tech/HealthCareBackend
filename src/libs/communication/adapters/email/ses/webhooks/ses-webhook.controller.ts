/**
 * AWS SES Webhook Controller
 * ===========================
 * Handles SNS notifications from AWS SES for bounces, complaints, and deliveries
 * Follows AWS SES best practices for bounce and complaint handling
 *
 * @module SESWebhookController
 * @description AWS SES webhook handler for email events
 */

import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { SESWebhookService } from './ses-webhook.service';

/**
 * SNS Message structure from AWS
 */
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
}

@ApiTags('communication')
@Controller('webhooks/ses')
export class SESWebhookController {
  constructor(private readonly sesWebhookService: SESWebhookService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Handle AWS SES webhook notifications',
    description:
      'Receives SNS notifications from AWS SES for bounces, complaints, and deliveries. This endpoint processes email events and updates the suppression list accordingly.',
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook processed successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid webhook payload',
  })
  @ApiBody({
    description: 'SNS message from AWS SES',
    schema: {
      type: 'object',
      properties: {
        Type: { type: 'string' },
        MessageId: { type: 'string' },
        TopicArn: { type: 'string' },
        Message: { type: 'string' },
        Timestamp: { type: 'string' },
        Signature: { type: 'string' },
      },
    },
  })
  async handleWebhook(
    @Body() snsMessage: SNSMessage
  ): Promise<{ received: boolean; processed: boolean }> {
    try {
      // Handle SNS subscription confirmation
      if (snsMessage.Type === 'SubscriptionConfirmation') {
        await this.sesWebhookService.confirmSubscription(snsMessage);
        return { received: true, processed: true };
      }

      // Handle SNS notification
      if (snsMessage.Type === 'Notification') {
        await this.sesWebhookService.processNotification(snsMessage);
        return { received: true, processed: true };
      }

      // Unknown message type
      await this.sesWebhookService.logUnknownMessageType(snsMessage.Type);
      return { received: true, processed: false };
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      await this.sesWebhookService.logError(errorObj, snsMessage);
      throw errorObj;
    }
  }
}
