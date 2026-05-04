/**
 * OpenVidu Webhook Controller
 * @class OpenViduWebhookController
 * @description Receives webhook events from OpenVidu and processes them
 *
 * This controller implements the optimized architecture:
 * - OpenVidu sends HTTP webhooks → This controller → OpenViduWebhookService → Socket.IO
 * - Reduces Socket.IO load by using webhooks for video session events
 * - Maintains real-time UX by forwarding events via Socket.IO
 */

import {
  Controller,
  Post,
  Body,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiExcludeEndpoint } from '@nestjs/swagger';
import { ConfigService } from '@config/config.service';
import { OpenViduWebhookService } from './openvidu-webhook.service';
import { LoggingService } from '@infrastructure/logging';
import { CacheService } from '@infrastructure/cache';
import { LogType, LogLevel, type OpenViduWebhookPayload } from '@core/types';
import type { FastifyRequest } from 'fastify';

@ApiTags('Video Webhooks')
@Controller('webhooks/openvidu')
export class OpenViduWebhookController {
  constructor(
    private readonly webhookService: OpenViduWebhookService,
    private readonly configService: ConfigService,
    private readonly loggingService: LoggingService,
    private readonly cacheService: CacheService
  ) {}

  /**
   * Handle OpenVidu webhook events
   * @see https://docs.openvidu.io/en/stable/developing/webhooks/
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint() // Hide from Swagger (internal endpoint)
  @ApiOperation({
    summary: 'OpenVidu webhook endpoint',
    description:
      'Receives webhook events from OpenVidu server. Internal endpoint, not exposed in API docs.',
  })
  @ApiResponse({
    status: 200,
    description: 'Webhook processed successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid webhook signature',
  })
  async handleWebhook(
    @Body() payload: OpenViduWebhookPayload,
    @Headers('x-openvidu-signature') signature?: string,
    @Req() request?: FastifyRequest & { rawBody?: string | Buffer }
  ): Promise<{ received: boolean }> {
    try {
      // Validate webhook signature if secret is configured
      const videoConfig = this.configService.get<{ openvidu?: { secret?: string } }>('video');
      const webhookSecret = videoConfig?.openvidu?.secret;

      if (webhookSecret && signature) {
        const rawBody =
          typeof request?.rawBody === 'string'
            ? request.rawBody
            : Buffer.isBuffer(request?.rawBody)
              ? request.rawBody.toString('utf8')
              : '';

        if (!rawBody) {
          await this.loggingService.log(
            LogType.SECURITY,
            LogLevel.WARN,
            'OpenVidu webhook raw body unavailable for signature validation',
            'OpenViduWebhookController',
            { sessionId: payload.sessionId, event: payload.event }
          );
          throw new UnauthorizedException('Webhook raw body required');
        }

        const isValid = await this.webhookService.validateWebhookSignature(
          rawBody,
          signature,
          webhookSecret
        );

        if (!isValid) {
          await this.loggingService.log(
            LogType.SECURITY,
            LogLevel.WARN,
            'Invalid OpenVidu webhook signature',
            'OpenViduWebhookController',
            { sessionId: payload.sessionId, event: payload.event }
          );
          throw new UnauthorizedException('Invalid webhook signature');
        }
      } else if (webhookSecret && !signature) {
        // Secret is configured but no signature provided
        await this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'OpenVidu webhook secret configured but no signature provided',
          'OpenViduWebhookController',
          { sessionId: payload.sessionId, event: payload.event }
        );
        throw new UnauthorizedException('Webhook signature required');
      }

      const dedupeKey = `webhook:openvidu:processed:${payload.sessionId}:${payload.event}:${payload.timestamp}:${payload.participantId || 'none'}:${payload.connectionId || 'none'}`;
      const alreadyProcessed = await this.cacheService.get<string>(dedupeKey);
      if (alreadyProcessed) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.DEBUG,
          `Skipping duplicate OpenVidu webhook event: ${payload.event}`,
          'OpenViduWebhookController',
          {
            event: payload.event,
            sessionId: payload.sessionId,
          }
        );
        return { received: true };
      }

      // Process webhook event
      await this.webhookService.processWebhookEvent(payload);
      await this.cacheService.set(dedupeKey, '1', 86400);

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        `OpenVidu webhook received: ${payload.event}`,
        'OpenViduWebhookController',
        {
          event: payload.event,
          sessionId: payload.sessionId,
        }
      );

      return { received: true };
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to handle OpenVidu webhook: ${error instanceof Error ? error.message : String(error)}`,
        'OpenViduWebhookController',
        {
          error: error instanceof Error ? error.message : String(error),
          payload,
        }
      );

      // Re-throw authentication errors
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      // For other errors, return success to prevent OpenVidu from retrying
      // (we'll handle errors internally)
      return { received: true };
    }
  }
}
