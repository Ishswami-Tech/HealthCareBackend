/**
 * Callback binding: a gateway-verified order may only settle the payment it was opened for.
 *
 * The public return-URL callback (and every webhook) names a payment id and an order id. The
 * gateway confirms the ORDER (status, amount); without this check one paid order could confirm
 * any other PENDING payment of the same amount by passing that payment's id ("replay"). A
 * delivery binds to a payment only when:
 *  - the order id is one this payment itself recorded (its order, an order it superseded, its
 *    gateway intent id, its transaction id, its own id / invoice number / appointment id used as
 *    the order id by older flows), or
 *  - the gateway's own order tags (set by us at order creation, returned by the gateway) name
 *    this payment's appointment / subscription (an order opened by the payment bridge);
 * and nothing the gateway returned contradicts the payment (tags naming another appointment /
 * subscription / clinic, an order id other than the one asked for, a non-INR currency).
 */
import {
  asJsonRecord,
  resolveKnownOrderIds,
} from '@services/billing/billing-payment-finalisation.util';

export type CallbackBindingFailure =
  'ORDER_NOT_OF_PAYMENT' | 'GATEWAY_ORDER_MISMATCH' | 'GATEWAY_TAG_MISMATCH' | 'CURRENCY_MISMATCH';

export type CallbackBindingVerdict =
  | { ok: true; via: 'recorded_order' | 'gateway_tags' }
  | { ok: false; reason: CallbackBindingFailure };

export interface CallbackBindingPayment {
  id: string;
  clinicId?: string | null;
  appointmentId?: string | null;
  invoiceId?: string | null;
  subscriptionId?: string | null;
  transactionId?: string | null;
  metadata?: unknown;
}

export interface CallbackBindingGateway {
  currency?: string | null;
  metadata?: unknown;
}

/** The currency the app charges in; any other currency from a gateway is rejected. */
export const CALLBACK_EXPECTED_CURRENCY = 'INR';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Every order id this payment itself recorded. */
export function recordedOrderIds(payment: CallbackBindingPayment): Set<string> {
  const metadata = asJsonRecord(payment.metadata);
  const ids = resolveKnownOrderIds(payment.metadata);
  for (const value of [
    metadata?.['invoiceNumber'],
    metadata?.['gatewayOrderId'],
    metadata?.['paymentSessionId'],
    payment.transactionId,
    payment.id,
    payment.appointmentId,
  ]) {
    const id = text(value);
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

/** A tag the gateway returned that names a DIFFERENT record than the payment's own. */
function conflicts(tagValue: string, ownValue: string | null | undefined): boolean {
  return Boolean(tagValue) && Boolean(ownValue) && tagValue !== ownValue;
}

export function checkCallbackBinding(args: {
  payment: CallbackBindingPayment;
  callbackOrderId: string;
  gateway: CallbackBindingGateway;
}): CallbackBindingVerdict {
  const { payment, gateway } = args;
  const orderId = text(args.callbackOrderId);
  const gatewayMetadata = asJsonRecord(gateway.metadata);

  const currency = text(gateway.currency).toUpperCase();
  if (currency && currency !== CALLBACK_EXPECTED_CURRENCY) {
    return { ok: false, reason: 'CURRENCY_MISMATCH' };
  }

  // The gateway answered for a different order than the one asked about.
  const answeredOrderId = text(gatewayMetadata?.['order_id']);
  if (answeredOrderId && orderId && answeredOrderId !== orderId) {
    return { ok: false, reason: 'GATEWAY_ORDER_MISMATCH' };
  }

  const tags = asJsonRecord(gatewayMetadata?.['order_tags']);
  const taggedAppointmentId = text(tags?.['appointmentId']);
  const taggedSubscriptionId = text(tags?.['subscriptionId']);
  const taggedClinicId = text(tags?.['clinicId']);
  if (
    conflicts(taggedAppointmentId, payment.appointmentId) ||
    conflicts(taggedSubscriptionId, payment.subscriptionId) ||
    conflicts(taggedClinicId, payment.clinicId)
  ) {
    return { ok: false, reason: 'GATEWAY_TAG_MISMATCH' };
  }

  if (orderId && recordedOrderIds(payment).has(orderId)) {
    return { ok: true, via: 'recorded_order' };
  }
  const taggedOrderId = text(tags?.['orderId']);
  if (
    (taggedAppointmentId && taggedAppointmentId === payment.appointmentId) ||
    (taggedSubscriptionId && taggedSubscriptionId === payment.subscriptionId) ||
    (taggedOrderId && recordedOrderIds(payment).has(taggedOrderId))
  ) {
    return { ok: true, via: 'gateway_tags' };
  }
  return { ok: false, reason: 'ORDER_NOT_OF_PAYMENT' };
}
