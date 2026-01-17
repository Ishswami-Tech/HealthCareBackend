/**
 * ZeptoMail Webhook Controller
 * ===========================
 * Handles webhook notifications from ZeptoMail for bounces, complaints, and deliveries
 *
 * @module ZeptoMailWebhookController
 * @description ZeptoMail webhook handler for email events
 */

import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiHeader } from '@nestjs/swagger';
import { ZeptoMailWebhookService } from './zeptomail-webhook.service';
import { ConfigService } from '@config/config.service';
import * as crypto from 'crypto';

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

@ApiTags('communication')
@Controller('webhooks/zeptomail')
export class ZeptoMailWebhookController {
  constructor(
    private readonly zeptoMailWebhookService: ZeptoMailWebhookService,
    private readonly configService: ConfigService
  ) {}

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
    @Headers('x-zeptomail-signature') signature?: string
  ): Promise<{ received: boolean; processed: boolean }> {
    try {
      // Verify webhook signature if provided (production security)
      // Note: ZeptoMail may use different signature methods - adjust based on their documentation
      if (signature && process.env['NODE_ENV'] === 'production') {
        const webhookSecret = this.configService.getEnv('ZEPTOMAIL_WEBHOOK_SECRET');
        if (webhookSecret) {
          // ZeptoMail typically uses HMAC SHA256 for webhook signatures
          const rawBody = JSON.stringify(event);
          const expectedSignature = crypto
            .createHmac('sha256', webhookSecret)
            .update(rawBody)
            .digest('hex');

          // Remove any prefix (e.g., "sha256=") if present
          const providedSignature = signature.replace(/^(sha256=|sha256:)/i, '');

          if (expectedSignature !== providedSignature) {
            throw new UnauthorizedException('Invalid ZeptoMail webhook signature');
          }
        }
      }

      await this.zeptoMailWebhookService.processWebhook(event);
      return { received: true, processed: true };
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      throw errorObj;
    }
  }
}
