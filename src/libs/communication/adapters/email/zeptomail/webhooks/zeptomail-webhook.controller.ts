/**
 * ZeptoMail Webhook Controller
 * ===========================
 * Handles webhook notifications from ZeptoMail for bounces, complaints, and deliveries
 *
 * @module ZeptoMailWebhookController
 * @description ZeptoMail webhook handler for email events
 */

import { Controller, Post, Body, HttpCode, HttpStatus, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiHeader } from '@nestjs/swagger';
import { ZeptoMailWebhookService } from './zeptomail-webhook.service';

/**
 * ZeptoMail Webhook Event Structure
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

@ApiTags('Email Webhooks')
@Controller('webhooks/zeptomail')
export class ZeptoMailWebhookController {
  constructor(private readonly zeptoMailWebhookService: ZeptoMailWebhookService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Handle ZeptoMail webhook notifications',
    description:
      'Receives webhook notifications from ZeptoMail for bounces, complaints, deliveries, spam, and unsubscribes. This endpoint processes email events and updates the suppression list accordingly.',
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook processed successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid webhook payload',
  })
  @ApiHeader({
    name: 'X-ZeptoMail-Signature',
    description: 'ZeptoMail webhook signature (optional, for verification)',
    required: false,
  })
  @ApiBody({
    description: 'ZeptoMail webhook event',
    schema: {
      type: 'object',
      properties: {
        event: {
          type: 'string',
          enum: ['bounce', 'complaint', 'delivery', 'spam', 'unsubscribe'],
        },
        timestamp: { type: 'string' },
        message_id: { type: 'string' },
        recipient: { type: 'string' },
        reason: { type: 'string' },
        bounce_type: { type: 'string', enum: ['hard', 'soft', 'transient'] },
        complaint_type: { type: 'string' },
        metadata: { type: 'object' },
      },
    },
  })
  async handleWebhook(
    @Body() event: ZeptoMailWebhookEvent,
    @Headers('x-zeptomail-signature') _signature?: string
  ): Promise<{ received: boolean; processed: boolean }> {
    try {
      // TODO: Verify webhook signature if ZeptoMail provides signature verification
      // For now, process the webhook (in production, add signature verification)

      await this.zeptoMailWebhookService.processWebhook(event);
      return { received: true, processed: true };
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      throw errorObj;
    }
  }
}
