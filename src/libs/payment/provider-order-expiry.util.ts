/**
 * Provider order expiry - what each gateway is told about the app-wide payment window.
 *
 * Every order / session the app opens should stop accepting a payment once the payment window
 * (`PAYMENT_WINDOW_MINUTES`) plus the provider buffer (`PROVIDER_EXPIRY_BUFFER_SECONDS`) is over,
 * so a payment can never land on a checkout the backend sweeps have already expired. Not every
 * gateway lets the merchant set that; for those the backend sweeps (invoice payment-window sweep,
 * video payment-window sweep) ask the gateway for the order status after window + buffer and
 * expire it when unpaid, and a later payment is flagged as a late settlement by the finaliser.
 *
 * Per provider (request field, as documented by the provider):
 * - Cashfree  `order_expiry_time` (ISO 8601, at least 15 min ahead)       -> window + buffer
 * - PhonePe   `expireAfter` on the SDK order builder (seconds)            -> window + buffer
 * - Zoho      `expires_in` on POST /paymentsessions (seconds, 300..900)   -> window + buffer, clamped
 * - Razorpay  no expiry on POST /v1/orders; Checkout's `timeout` option (seconds) is a client
 *             hint only, returned in the intent metadata as `checkoutTimeoutSeconds`
 * - Paytm     no expiry on initiateTransaction; the returned txnToken is valid for a fixed
 *             15 minutes (provider-side), so the sweep covers longer windows
 * - PayU      no server-side order (hosted form post), no expiry parameter on `_payment`
 * - Easebuzz  no expiry parameter on the initiate-payment request used by the adapter
 */
import { PaymentProvider } from '@core/types/payment.types';
import { getProviderOrderExpiry, toIstIsoString } from '@config/payment-window.config';

/** Zoho Payments accepts `expires_in` between these bounds (seconds). */
export const ZOHO_SESSION_MIN_EXPIRY_SECONDS = 300;
export const ZOHO_SESSION_MAX_EXPIRY_SECONDS = 900;

export interface ProviderOrderExpiry {
  provider: PaymentProvider;
  /** The gateway itself enforces the expiry on the order / session. */
  enforcedByProvider: boolean;
  /** When the gateway (or, if not enforced, the sweep) stops treating the order as payable. */
  expiresAt: Date;
  /** Request fields to merge into the provider's create request (empty when unsupported). */
  requestFields: Readonly<Record<string, string | number>>;
}

/** Whole seconds from `now` until `expiresAt`, never negative. */
export function secondsUntil(expiresAt: Date, now: Date): number {
  return Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / 1000));
}

/**
 * Builds the expiry of an order opened at `now` for `provider`. Pure apart from reading the
 * configured payment window.
 */
export function buildProviderOrderExpiry(
  provider: PaymentProvider,
  now: Date = new Date()
): ProviderOrderExpiry {
  const expiresAt = getProviderOrderExpiry(now);
  const seconds = secondsUntil(expiresAt, now);

  switch (provider) {
    case PaymentProvider.CASHFREE:
      return {
        provider,
        enforcedByProvider: true,
        expiresAt,
        requestFields: { order_expiry_time: toIstIsoString(expiresAt) },
      };
    case PaymentProvider.PHONEPE:
      return {
        provider,
        enforcedByProvider: true,
        expiresAt,
        requestFields: { expireAfter: seconds },
      };
    case PaymentProvider.ZOHO: {
      // Zoho caps a session at 15 minutes: a clamped session simply closes earlier than our
      // window, which is safe (the gateway never accepts a payment after the sweep).
      const clamped = Math.min(
        Math.max(seconds, ZOHO_SESSION_MIN_EXPIRY_SECONDS),
        ZOHO_SESSION_MAX_EXPIRY_SECONDS
      );
      return {
        provider,
        enforcedByProvider: true,
        expiresAt: new Date(now.getTime() + clamped * 1000),
        requestFields: { expires_in: clamped },
      };
    }
    case PaymentProvider.RAZORPAY:
      // Orders have no expiry; Checkout's `timeout` closes the modal client-side only.
      return {
        provider,
        enforcedByProvider: false,
        expiresAt,
        requestFields: { checkoutTimeoutSeconds: seconds },
      };
    default:
      // Paytm / PayU / Easebuzz: no merchant-settable expiry, the sweep is the guard.
      return { provider, enforcedByProvider: false, expiresAt, requestFields: {} };
  }
}
