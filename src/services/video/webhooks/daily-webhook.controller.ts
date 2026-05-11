import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@core/decorators/public.decorator';
import { DailyHealthSignalService } from '../services/daily-health-signal.service';

type DailyWebhookEvent = {
  id?: string;
  type?: string;
  version?: string;
  event_ts?: number;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
};

@ApiTags('video')
@Controller('webhooks/daily')
export class DailyWebhookController {
  constructor(private readonly dailyHealthSignalService: DailyHealthSignalService) {}

  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Handle Daily webhook events',
    description:
      'Receives webhook notifications from Daily and updates the cached provider health signal. The endpoint responds quickly to avoid webhook retries.',
  })
  @ApiBody({
    description: 'Daily webhook payload',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        type: { type: 'string' },
        version: { type: 'string' },
        event_ts: { type: 'number' },
        payload: { type: 'object' },
      },
    },
  })
  async handleWebhook(
    @Body() event: DailyWebhookEvent
  ): Promise<{ received: boolean; processed: boolean; eventType?: string }> {
    const eventType = typeof event.type === 'string' ? event.type : 'unknown';
    const payload = event.payload ?? {};

    if (eventType && eventType !== 'unknown') {
      await this.dailyHealthSignalService.recordWebhookEvent(eventType, payload);
    } else {
      await this.dailyHealthSignalService.recordWebhookHealth('ACTIVE', {
        eventId: typeof event.id === 'string' ? event.id : undefined,
        version: typeof event.version === 'string' ? event.version : undefined,
        payload,
      });
    }

    return { received: true, processed: true, eventType };
  }
}
