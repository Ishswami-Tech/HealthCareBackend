/**
 * Webhook de-duplication keys.
 *
 * A delivery is identified by the provider, its first available reference (gateway payment id,
 * then session id, then order id) AND the event / status it reports: the same gateway payment
 * sends several events (PENDING, then SUCCESS ...), and a key without the event let the first
 * one swallow the confirmation that followed. The key is only written once the delivery was
 * processed (or durably enqueued), so a delivery that failed is processed again on retry.
 */

/** How long a processed delivery is remembered (provider retries stop well before this). */
export const WEBHOOK_PROCESSED_TTL_SECONDS = 24 * 60 * 60;

function normalisePart(value: string | undefined | null): string {
  return String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .slice(0, 120);
}

/** The delivery's identity, or null when it carries no usable reference. */
export function buildWebhookEventId(args: {
  provider: string;
  paymentId?: string | undefined;
  paymentSessionId?: string | undefined;
  orderId?: string | undefined;
  eventType?: string | undefined;
}): string | null {
  const reference = [args.paymentId, args.paymentSessionId, args.orderId]
    .map(normalisePart)
    .find(part => part.length > 0);
  if (!reference) {
    return null;
  }
  const eventType = normalisePart(args.eventType).toUpperCase() || 'ANY';
  return `${normalisePart(args.provider).toLowerCase()}-${eventType}-${reference}`;
}

/** Cache key marking a delivery as processed. */
export function webhookProcessedKey(eventId: string): string {
  return `webhook:processed:${eventId}`;
}

/** Deterministic queue job id for a delivery: a duplicate enqueue is a no-op in BullMQ. */
export function webhookJobId(eventId: string): string {
  return `webhook-${eventId}`;
}
