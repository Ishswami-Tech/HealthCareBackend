# Payment Gateway Integration - Complete Guide

## Overview

The healthcare backend supports **three payment providers** with automatic
failover:

1. **Cashfree** - Primary provider (default)
2. **Razorpay** - Secondary provider
3. **PhonePe** - Tertiary provider (Business Gateway)

## Quick Start

### 1. Enable Payment Providers

In your `.env.local`, set:

```bash
PAYMENT_ENABLED_PROVIDERS=cashfree,razorpay,phonepe
```

### 2. Configure Provider Credentials

**Cashfree (Primary):**

```bash
CASHFREE_ENVIRONMENT=sandbox
CASHFREE_APP_ID=your_cashfree_app_id
CASHFREE_SECRET_KEY=your_cashfree_secret_key
```

**Razorpay:**

```bash
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
```

**PhonePe (Business Gateway):**

```bash
PHONEPE_MERCHANT_ID=your_merchant_id
PHONEPE_SALT_KEY=your_salt_key
PHONEPE_SALT_INDEX=1
PHONEPE_ENVIRONMENT=sandbox
```

### 3. Get Credentials

| Provider | Sign Up                        | Documentation                 |
| -------- | ------------------------------ | ----------------------------- |
| Cashfree | https://merchant.cashfree.com  | https://docs.cashfree.com     |
| Razorpay | https://dashboard.razorpay.com | https://razorpay.com/docs     |
| PhonePe  | https://business.phonepe.com   | https://developer.phonepe.com |

## Webhook Endpoints

All providers have webhook endpoints configured:

| Provider | Webhook URL                              |
| -------- | ---------------------------------------- |
| Cashfree | `POST /api/v1/payments/cashfree/webhook` |
| Razorpay | `POST /api/v1/payments/razorpay/webhook` |
| PhonePe  | `POST /api/v1/payments/phonepe/webhook`  |

## API Usage

### Create Payment Intent

```typescript
import { PaymentService } from '@payment/payment.service';
import { PaymentProvider } from '@core/types';

@Controller('appointments')
export class AppointmentController {
  constructor(private readonly paymentService: PaymentService) {}

  async createPayment(
    clinicId: string,
    amount: number,
    provider?: PaymentProvider
  ): Promise<PaymentResult> {
    return await this.paymentService.createPaymentIntent(
      clinicId,
      {
        amount: amount * 100, // Convert to paise (₹1 = 100 paise)
        currency: 'INR',
        orderId: `INV-${Date.now()}`,
        customerId: 'user-123',
        description: 'Appointment Booking',
        metadata: {
          appointmentId: 'apt-456',
          clinicId: clinicId,
        },
      },
      provider // Optional: specify provider, or uses primary from config
    );
  }
}
```

### Process Refund

```typescript
const refundResult = await this.paymentService.refund(
  clinicId,
  {
    paymentId: 'payment_123',
    amount: 50000, // Partial refund in paise (optional)
    reason: 'Patient cancelled appointment',
  },
  PaymentProvider.RAZORPAY // Optional: specify provider
);
```

## Provider Selection

### Automatic Selection

The system automatically uses the **primary provider** from clinic config. If it
fails, it automatically falls back to the next provider.

### Manual Selection

```typescript
// Use specific provider
const result = await paymentService.createPaymentIntent(
  clinicId,
  options,
  PaymentProvider.RAZORPAY
);
```

## Testing

### Sandbox/Test Mode

1. Use sandbox credentials from each provider
2. Test payment flows with test cards/UPI IDs
3. Verify webhooks are received

### Test Cards

**Razorpay Test Cards:**

- Success: `4111 1111 1111 1111`, any future expiry, any CVV
- Failure: `4012 1111 1111 1111`

**Cashfree Test:**

- Use test mode credentials

**PhonePe Test:**

- Use sandbox environment

## Production Checklist

### Before Going Live:

1. **Credentials**
   - [ ] Replace sandbox credentials with production credentials
   - [ ] Verify all API keys are correct

2. **Webhooks**
   - [ ] Configure webhook URLs in each provider dashboard
   - [ ] Add webhook secrets to environment variables
   - [ ] Verify webhook signature verification is working

3. **Domain**
   - [ ] Update webhook URLs to production domain
   - [ ] Ensure webhook endpoints are publicly accessible
   - [ ] Enable HTTPS

4. **Testing**
   - [ ] Test with real cards (use minimal amounts)
   - [ ] Test refund flow
   - [ ] Test payment failure scenarios
   - [ ] Verify email/SMS notifications

## Security

- All credentials are encrypted in database
- Webhook signatures are verified before processing
- Clinic isolation ensures data security
- No sensitive data logged

## Monitoring

Check logs for payment events:

```bash
# View payment logs
tail -f logs/payment.log

# Or via API health check
curl http://localhost:8088/health
```

## Error Handling

Common issues:

| Error                       | Solution                                   |
| --------------------------- | ------------------------------------------ |
| `Provider not enabled`      | Check `PAYMENT_ENABLED_PROVIDERS` env var  |
| `Webhook signature invalid` | Verify webhook secret in config            |
| `Credentials not found`     | Check environment variables are set        |
| `Payment failed`            | Check provider dashboard for error details |
