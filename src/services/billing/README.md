# Billing Service

**Purpose:** Billing, invoicing, and payment processing
**Location:** `src/services/billing`
**Status:** ✅ Production-ready

---

## Quick Start

```typescript
import { BillingService } from '@services/billing';

@Injectable()
export class MyService {
  constructor(private readonly billingService: BillingService) {}

  async createInvoice(data: CreateInvoiceDto) {
    return await this.billingService.createInvoice(data);
  }
}
```

---

## Key Features

- ✅ **Billing Plans** - Subscription-based billing
- ✅ **Invoicing** - Invoice generation and management
- ✅ **Payment Processing** - Razorpay/PhonePe integration
- ✅ **Invoice PDF** - Automatic PDF generation
- ✅ **WhatsApp Delivery** - Send invoices via WhatsApp
- ✅ **Revenue Analytics** - Financial reporting

---

## API Endpoints

| Category | Endpoints | Description |
|----------|-----------|-------------|
| **Billing Plans** | GET, POST, PUT, DELETE `/billing/plans` | Manage billing plans |
| **Subscriptions** | GET, POST, PUT `/billing/subscriptions` | Manage subscriptions |
| **Invoices** | GET, POST, PUT `/billing/invoices` | Manage invoices |
| **Payments** | GET, POST `/billing/payments` | Process payments |
| **Analytics** | GET `/billing/analytics/revenue` | Revenue reports |

[Full API documentation](../../docs/api/README.md)

---

## Usage Examples

```typescript
// Create invoice
const invoice = await this.billingService.createInvoice({
  patientId: 'patient123',
  items: [{ description: 'Consultation', amount: 500 }],
  total: 500,
});

// Generate PDF
const pdfBuffer = await this.billingService.generateInvoicePDF(invoiceId);

// Send via WhatsApp
await this.billingService.sendInvoiceViaWhatsApp(invoiceId, phoneNumber);

// Process payment
const payment = await this.billingService.processPayment({
  appointmentId: 'appt123',
  amount: 500,
  method: 'razorpay',
});
```

---

## Related Documentation

- [Payment & Billing Complete](../../docs/features/PAYMENT_BILLING_COMPLETE.md)
- [Invoice PDF WhatsApp Feature](../../docs/features/INVOICE_PDF_WHATSAPP_FEATURE.md)
- [API Integration Analysis](../../docs/API_INTEGRATION_ANALYSIS.md)

---

## Contributing

See main [README.md](../../README.md) for contribution guidelines.
