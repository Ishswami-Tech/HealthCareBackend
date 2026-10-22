import { describe, expect, it } from '@jest/globals';
import {
  buildWebhookEventId,
  webhookJobId,
  webhookProcessedKey,
} from '../../../src/libs/payment/webhook-dedupe.util';

describe('webhook de-duplication keys', () => {
  it('includes the event, so a PENDING delivery never swallows the SUCCESS that follows', () => {
    const pending = buildWebhookEventId({
      provider: 'cashfree',
      paymentId: '5114910',
      orderId: 'order_1',
      eventType: 'PAYMENT_SUCCESS_WEBHOOK:PENDING',
    });
    const success = buildWebhookEventId({
      provider: 'cashfree',
      paymentId: '5114910',
      orderId: 'order_1',
      eventType: 'PAYMENT_SUCCESS_WEBHOOK:SUCCESS',
    });
    expect(pending).not.toBe(success);
    expect(success).toBe('cashfree-PAYMENT_SUCCESS_WEBHOOK_SUCCESS-5114910');
  });

  it('uses the first available reference and is stable', () => {
    expect(buildWebhookEventId({ provider: 'zoho', paymentSessionId: 's1' })).toBe('zoho-ANY-s1');
    expect(buildWebhookEventId({ provider: 'payu', orderId: 'o1', eventType: 'success' })).toBe(
      'payu-SUCCESS-o1'
    );
    expect(buildWebhookEventId({ provider: 'payu' })).toBeNull();
  });

  it('builds cache keys and BullMQ-safe job ids (no ":")', () => {
    const id = buildWebhookEventId({
      provider: 'cashfree',
      paymentId: 'cf:1',
      eventType: 'A:B',
    });
    expect(id).not.toBeNull();
    expect(webhookProcessedKey(id!)).toBe(`webhook:processed:${id}`);
    expect(webhookJobId(id!)).not.toContain(':');
  });
});
