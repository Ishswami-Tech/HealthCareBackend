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
  Headers,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiExcludeEndpoint } from '@nestjs/swagger';
import { ConfigService } from '@config/config.service';
import { OpenViduWebhookService } from './openvidu-webhook.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel, type OpenViduWebhookPayload } from '@core/types';

@ApiTags('Video Webhooks')
@Controller('webhooks/openvidu')
export class OpenViduWebhookController {
  constructor(
    private readonly webhookService: OpenViduWebhookService,
    private readonly configService: ConfigService,
    private readonly loggingService: LoggingService
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
    @Headers('x-openvidu-signature') signature?: string
  ): Promise<{ received: boolean }> {
    try {
      // Validate webhook signature if secret is configured
      const videoConfig = this.configService.get<{ openvidu?: { secret?: string } }>('video');
      const webhookSecret = videoConfig?.openvidu?.secret;

      if (webhookSecret && signature) {
        const rawBody = JSON.stringify(payload);
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

      // Process webhook event
      await this.webhookService.processWebhookEvent(payload);

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
