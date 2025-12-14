import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { InvoicePDFService } from './invoice-pdf.service';
import { BillingEventsListener } from './billing.events';
import { BillingController } from './controllers/billing.controller';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { GuardsModule } from '@core/guards/guards.module';
import { EventsModule } from '@infrastructure/events/events.module';
import { RbacModule } from '@core/rbac/rbac.module';
import { LoggingModule } from '@infrastructure/logging';
import { ErrorsModule } from '@core/errors/errors.module';
import { WhatsAppModule } from '@communication/channels/whatsapp/whatsapp.module';
import { RateLimitModule } from '@security/rate-limit/rate-limit.module';
import { CacheModule } from '@infrastructure/cache/cache.module';
import { PaymentModule } from '@payment/payment.module';

@Module({
  imports: [
    DatabaseModule,
    GuardsModule,
    RateLimitModule,
    EventsModule,
    RbacModule,
    LoggingModule,
    ErrorsModule,
    WhatsAppModule,
    CacheModule,
    PaymentModule,
  ],
  controllers: [BillingController],
  providers: [BillingService, InvoicePDFService, BillingEventsListener],
  exports: [BillingService, InvoicePDFService],
})
export class BillingModule {}
