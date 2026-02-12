# Payment Module

**Purpose:** Multi-provider payment processing with clinic-specific
configuration **Location:** `src/libs/payment` **Status:** ✅ Production-ready

---

## Quick Start

```typescript
import { PaymentService } from '@libs/payment';
import { PaymentProvider } from '@types';

@Injectable()
export class MyService {
  constructor(private readonly paymentService: PaymentService) {}

  async processPayment(
    clinicId: string,
    appointmentId: string,
    amount: number
  ) {
    // Create payment intent
    const result = await this.paymentService.createPaymentIntent(clinicId, {
      amount: amount * 100, // Convert to smallest currency unit (paise)
      currency: 'INR',
      appointmentId,
      customerId: 'patient123',
      description: 'Appointment payment',
    });

    return result;
  }
}
```

---

## Key Features

- ✅ **Multi-Provider Support** - Razorpay, Cashfree, PhonePe adapters (same
  pattern as Redis/Dragonfly)
- ✅ **Multi-Tenant Configuration** - Clinic-specific provider settings
- ✅ **Payment Intents** - Create one-time and subscription payments
- ✅ **Payment Verification** - Verify payment status
- ✅ **Refund Processing** - Process full/partial refunds
- ✅ **Webhook Verification** - Verify provider webhook signatures
- ✅ **Event Integration** - Emits payment events
- ✅ **Provider Fallback** - Primary and fallback provider support
- ✅ **Subscription Support** - Recurring payment handling

---

## Payment Providers (3)

1. **Razorpay** - India's leading payment gateway
   - Payment intents, verification, refunds, webhook verification

2. **Cashfree** - Full-stack payment platform (PG API)
   - Payment intents (orders), verification, refunds, webhook verification
     (x-cf-signature)

3. **PhonePe** - UPI and digital payments
   - Payment intents, verification, refunds, webhook verification

---

## Usage Examples

### Create Payment Intent

```typescript
// One-time payment
const result = await this.paymentService.createPaymentIntent(clinicId, {
  amount: 50000,              // ₹500.00 (in paise)
  currency: 'INR',
  appointmentId: 'appt-123',
  appointmentType: 'CONSULTATION',
  customerId: 'patient-123',
  description: 'Consultation fee',
  clinicId,
});

// Result
{
  success: true,
  paymentId: 'pay_abc123xyz',
  paymentUrl: 'https://razorpay.com/checkout/pay_abc123xyz',
  status: 'created',
  metadata: {
    orderId: 'order_xyz789'
  }
}
```

### Create Subscription Payment

```typescript
// Recurring subscription
const result = await this.paymentService.createPaymentIntent(clinicId, {
  amount: 99900, // ₹999.00/month
  currency: 'INR',
  customerId: 'patient-123',
  description: 'Premium subscription',
  isSubscription: true,
  subscriptionPlan: {
    planId: 'plan_premium',
    interval: 'monthly',
    intervalCount: 1,
  },
  clinicId,
});
```

### Verify Payment

```typescript
// Verify payment status after completion
const status = await this.paymentService.verifyPayment(clinicId, {
  paymentId: 'pay_abc123xyz',
  orderId: 'order_xyz789',
  signature: 'webhook_signature_here', // From provider webhook
});

// Result
{
  success: true,
  status: 'captured',        // captured | failed | pending
  amount: 50000,
  currency: 'INR',
  paymentId: 'pay_abc123xyz',
  metadata: {
    method: 'card',          // card | upi | netbanking | wallet
    captured: true,
    refundStatus: null,
  }
}
```

### Process Refund

```typescript
// Full refund
const refund = await this.paymentService.refund(clinicId, {
  paymentId: 'pay_abc123xyz',
  reason: 'Appointment cancelled by patient',
});

// Partial refund
const partialRefund = await this.paymentService.refund(clinicId, {
  paymentId: 'pay_abc123xyz',
  amount: 25000,              // ₹250.00 (partial)
  reason: 'Partial service provided',
});

// Result
{
  success: true,
  refundId: 'rfnd_xyz123',
  amount: 25000,
  status: 'processed',
  metadata: {
    speed: 'normal',          // instant | normal
    processed: true,
  }
}
```

### Verify Webhook

```typescript
// Verify webhook signature from payment provider
const isValid = await this.paymentService.verifyWebhook(clinicId, {
  signature: req.headers['x-razorpay-signature'],
  payload: req.body,
  webhookSecret: 'whsec_xyz123',
});

if (isValid) {
  // Process webhook event
  await this.processPaymentWebhook(req.body);
}
```

### Specify Provider Explicitly

```typescript
// Use specific provider (overrides clinic default)
const result = await this.paymentService.createPaymentIntent(
  clinicId,
  {
    amount: 50000,
    currency: 'INR',
    customerId: 'patient-123',
    description: 'Payment',
  },
  PaymentProvider.PHONEPE // Explicit provider
);
```

---

## Multi-Tenant Configuration

Each clinic can configure their own payment providers:

```typescript
// Clinic payment configuration (stored in database)
{
  clinicId: 'clinic-abc-123',
  payment: {
    primary: {
      provider: 'razorpay',
      apiKey: 'rzp_live_xxx',
      apiSecret: 'encrypted_secret',
      webhookSecret: 'whsec_xxx',
      enabled: true,
    },
    fallback: [
      {
        provider: 'phonepe',
        merchantId: 'M123456',
        saltKey: 'encrypted_salt',
        saltIndex: '1',
        enabled: true,
      }
    ]
  }
}

// Payment service automatically selects provider per clinic
const result = await this.paymentService.createPaymentIntent(
  'clinic-abc-123', // Clinic ID
  options
);
// Uses clinic-abc-123's configured provider (Razorpay)
```

**Provider Selection Logic:**

1. Use explicitly specified provider if provided
2. Otherwise use clinic's primary provider
3. Fallback to clinic's fallback providers if primary fails
4. All credentials are clinic-specific and encrypted

---

## Provider Factory

The factory pattern allows easy provider switching:

```typescript
// PaymentProviderFactory creates adapters
const adapter = await this.paymentProviderFactory.createAdapterWithHttpService(
  {
    provider: 'razorpay',
    apiKey: 'rzp_live_xxx',
    apiSecret: 'secret',
    enabled: true,
  },
  httpService
);

// All adapters implement PaymentProviderAdapter interface
interface PaymentProviderAdapter {
  createPaymentIntent(options: PaymentIntentOptions): Promise<PaymentResult>;
  verifyPayment(options: PaymentStatusOptions): Promise<PaymentStatusResult>;
  refund(options: RefundOptions): Promise<RefundResult>;
  verifyWebhook(options: WebhookVerificationOptions): Promise<boolean>;
}
```

---

## Event Integration

Automatic event emission for payment lifecycle:

```typescript
// Event: payment.intent.created
{
  eventType: 'payment.intent.created',
  category: EventCategory.BILLING,
  priority: EventPriority.HIGH,
  source: 'PaymentService',
  clinicId: 'clinic-abc-123',
  userId: 'patient-123',
  metadata: {
    paymentId: 'pay_abc123xyz',
    amount: 50000,
    currency: 'INR',
    appointmentId: 'appt-123',
    appointmentType: 'CONSULTATION',
    isSubscription: false,
  }
}

// Event: payment.refunded
{
  eventType: 'payment.refunded',
  category: EventCategory.BILLING,
  priority: EventPriority.HIGH,
  source: 'PaymentService',
  clinicId: 'clinic-abc-123',
  metadata: {
    refundId: 'rfnd_xyz123',
    paymentId: 'pay_abc123xyz',
    amount: 25000,
  }
}
```

---

## Webhook Handling

Handle payment provider webhooks:

```typescript
@Controller('webhooks')
export class WebhookController {
  constructor(private readonly paymentService: PaymentService) {}

  @Post('razorpay')
  async handleRazorpayWebhook(@Req() req: Request) {
    const signature = req.headers['x-razorpay-signature'] as string;
    const clinicId = req.body.clinicId; // From webhook payload

    // Verify webhook signature
    const isValid = await this.paymentService.verifyWebhook(clinicId, {
      signature,
      payload: req.body,
      webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
    });

    if (!isValid) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // Process webhook event
    const event = req.body;
    switch (event.event) {
      case 'payment.captured':
        await this.handlePaymentCaptured(event.payload.payment.entity);
        break;
      case 'payment.failed':
        await this.handlePaymentFailed(event.payload.payment.entity);
        break;
      case 'refund.processed':
        await this.handleRefundProcessed(event.payload.refund.entity);
        break;
    }

    return { status: 'ok' };
  }
}
```

---

## Payment Flow

**Standard Payment Flow:**

1. User initiates payment
2. `createPaymentIntent()` called
3. Payment URL/gateway returned to user
4. User completes payment on provider's page
5. Provider sends webhook notification
6. `verifyWebhook()` validates signature
7. `verifyPayment()` confirms payment status
8. Update appointment/billing status
9. Emit `payment.captured` event

**Refund Flow:**

1. Cancellation/refund requested
2. `refund()` called with payment ID
3. Provider processes refund
4. Emit `payment.refunded` event
5. Update billing status

---

## Configuration

Environment variables (per clinic in database):

```env
# Razorpay (example for default/system)
RAZORPAY_KEY_ID=rzp_live_xxx
RAZORPAY_KEY_SECRET=xxx
RAZORPAY_WEBHOOK_SECRET=whsec_xxx

# PhonePe (example for default/system)
PHONEPE_MERCHANT_ID=M123456
PHONEPE_SALT_KEY=xxx
PHONEPE_SALT_INDEX=1
PHONEPE_CALLBACK_URL=https://api.example.com/webhooks/phonepe

# Payment configuration
PAYMENT_CURRENCY=INR
PAYMENT_TIMEOUT_SECONDS=600
```

**Multi-Tenant:** Each clinic's credentials stored encrypted in database via
`CommunicationConfigService`

---

## Troubleshooting

**Issue: Payment intent creation fails**

```typescript
// 1. Check clinic configuration
const config = await this.paymentConfigService.getClinicConfig(clinicId);
if (!config?.payment?.primary) {
  // No payment provider configured for clinic
}

// 2. Check provider credentials
if (!config.payment.primary.enabled) {
  // Provider disabled for clinic
}

// 3. Check logs
// PaymentService logs errors with LogType.PAYMENT
```

**Issue: Webhook verification fails**

```typescript
// 1. Verify webhook secret is correct
const isValid = await this.paymentService.verifyWebhook(clinicId, {
  signature: req.headers['x-razorpay-signature'],
  payload: req.body,
  webhookSecret: config.payment.primary.webhookSecret,
});

// 2. Check signature header format
// Razorpay: x-razorpay-signature
// PhonePe: X-VERIFY (base64 encoded)

// 3. Ensure payload is not modified
// Use raw body for webhook verification
```

**Issue: Refund not processing**

```typescript
// 1. Check payment is captured
const status = await this.paymentService.verifyPayment(clinicId, {
  paymentId,
});
if (status.status !== 'captured') {
  // Can only refund captured payments
}

// 2. Check refund amount
// Amount must be <= payment amount
// Razorpay supports partial refunds
// PhonePe may have restrictions

// 3. Check provider logs
// Providers may reject refunds for various reasons
```

---

## Architecture

```
PaymentService (orchestrator)
├── PaymentProviderFactory
│   ├── RazorpayPaymentAdapter
│   └── PhonePePaymentAdapter
├── PaymentConfigService (multi-tenant config)
├── EventService (event emission)
└── LoggingService (audit logs)
```

**Adapter Pattern:**

- `BasePaymentAdapter` - Common functionality
- `RazorpayPaymentAdapter` - Razorpay-specific implementation
- `PhonePePaymentAdapter` - PhonePe-specific implementation
- `PaymentProviderAdapter` interface - Contract all adapters must implement

---

## Related Documentation

- [Payment & Billing Complete](../../docs/features/PAYMENT_BILLING_COMPLETE.md)
- [Billing Service](../../services/billing/README.md)
- [Razorpay Documentation](https://razorpay.com/docs/)
- [PhonePe Documentation](https://developer.phonepe.com/)

---

## Contributing

See main [README.md](../../README.md) for contribution guidelines.
