/**
 * WhatsApp Webhook Controller
 * ===========================
 * Handles webhook notifications from WhatsApp providers (Meta and Twilio)
 * for delivery status, read receipts, and failures
 *
 * @module WhatsAppWebhookController
 * @description WhatsApp webhook handler for message events
 */

import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Headers,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiHeader, ApiQuery } from '@nestjs/swagger';
import { WhatsAppWebhookService } from './whatsapp-webhook.service';
import { ConfigService } from '@config/config.service';
import * as crypto from 'crypto';

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

@ApiTags('WhatsApp Webhooks')
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(
    private readonly whatsAppWebhookService: WhatsAppWebhookService,
    private readonly configService: ConfigService
  ) {}

  @Post('meta')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Handle Meta WhatsApp webhook notifications',
    description:
      'Receives webhook notifications from Meta WhatsApp Business API for message status updates (sent, delivered, read, failed).',
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
    name: 'X-Hub-Signature-256',
    description: 'Meta webhook signature (for verification)',
    required: false,
  })
  @ApiQuery({
    name: 'hub.mode',
    description: 'Webhook verification mode',
    required: false,
  })
  @ApiQuery({
    name: 'hub.verify_token',
    description: 'Webhook verification token',
    required: false,
  })
  @ApiQuery({
    name: 'hub.challenge',
    description: 'Webhook verification challenge',
    required: false,
  })
  @ApiBody({
    description: 'Meta WhatsApp webhook event',
    schema: {
      type: 'object',
      properties: {
        object: { type: 'string' },
        entry: {
          type: 'array',
          items: {
            type: 'object',
          },
        },
      },
    },
  })
  async handleMetaWebhook(
    @Body() event: MetaWhatsAppWebhookEvent,
    @Headers('x-hub-signature-256') signature?: string,
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') verifyToken?: string,
    @Query('hub.challenge') challenge?: string
  ): Promise<string | { received: boolean; processed: boolean }> {
    try {
      // Handle webhook verification (Meta requires this for initial setup)
      if (mode === 'subscribe' && verifyToken) {
        // Verify token matches configured token
        const configuredToken = this.configService.getEnv('META_WHATSAPP_WEBHOOK_VERIFY_TOKEN');
        if (configuredToken && verifyToken !== configuredToken) {
          throw new UnauthorizedException('Invalid webhook verification token');
        }
        // Return challenge for webhook verification
        if (challenge) {
          return challenge;
        }
      }

      // Verify webhook signature if provided (production security)
      if (signature && process.env['NODE_ENV'] === 'production') {
        const appSecret = this.configService.getEnv('META_WHATSAPP_APP_SECRET');
        if (appSecret) {
          const rawBody = JSON.stringify(event);
          const expectedSignature = crypto
            .createHmac('sha256', appSecret)
            .update(rawBody)
            .digest('hex');
          const providedSignature = signature.replace('sha256=', '');

          if (expectedSignature !== providedSignature) {
            throw new UnauthorizedException('Invalid webhook signature');
          }
        }
      }

      await this.whatsAppWebhookService.processMetaWebhook(event);
      return { received: true, processed: true };
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      throw errorObj;
    }
  }

  @Post('twilio')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Handle Twilio WhatsApp webhook notifications',
    description:
      'Receives webhook notifications from Twilio WhatsApp API for message status updates (queued, sent, delivered, read, failed, undelivered).',
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
    name: 'X-Twilio-Signature',
    description: 'Twilio webhook signature (for verification)',
    required: false,
  })
  @ApiBody({
    description: 'Twilio WhatsApp webhook event',
    schema: {
      type: 'object',
      properties: {
        MessageSid: { type: 'string' },
        MessageStatus: {
          type: 'string',
          enum: ['queued', 'sent', 'delivered', 'read', 'failed', 'undelivered'],
        },
        To: { type: 'string' },
        From: { type: 'string' },
        ErrorCode: { type: 'string' },
        ErrorMessage: { type: 'string' },
      },
    },
  })
  async handleTwilioWebhook(
    @Body() event: TwilioWhatsAppWebhookEvent,
    @Headers('x-twilio-signature') signature?: string,
    @Headers('host') host?: string,
    @Headers('x-forwarded-proto') protocol?: string
  ): Promise<{ received: boolean; processed: boolean }> {
    try {
      // Verify Twilio webhook signature if provided (production security)
      if (signature && process.env['NODE_ENV'] === 'production') {
        const authToken = this.configService.getEnv('TWILIO_AUTH_TOKEN');
        if (authToken) {
          // Twilio signature verification
          // Build the URL that Twilio requested
          const url = `${protocol || 'https'}://${host || ''}/webhooks/whatsapp/twilio`;

          // Create the signature string
          const signatureString = url + JSON.stringify(event);

          // Create HMAC SHA1 signature
          const expectedSignature = crypto
            .createHmac('sha1', authToken)
            .update(signatureString)
            .digest('base64');

          if (expectedSignature !== signature) {
            throw new UnauthorizedException('Invalid Twilio webhook signature');
          }
        }
      }

      await this.whatsAppWebhookService.processTwilioWebhook(event);
      return { received: true, processed: true };
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      throw errorObj;
    }
  }
}
