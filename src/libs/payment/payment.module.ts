/**
 * Payment Module
 * ==============
 * Payment processing module with provider adapters
 *
 * @module PaymentModule
 * @description Payment module for multi-provider payment processing
 */

import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@infrastructure/http';
// Use direct imports to avoid TDZ issues with barrel exports
import { DatabaseModule } from '@infrastructure/database/database.module';
import { CacheModule } from '@infrastructure/cache';
import { LoggingModule } from '@infrastructure/logging';
import { EventsModule } from '@infrastructure/events';
import { PaymentService } from './payment.service';
import { PaymentProviderFactory } from './adapters/factories/payment-provider.factory';
import { PaymentController } from './payment.controller';
import { RazorpayPaymentAdapter } from './adapters/razorpay/razorpay-payment.adapter';
import { PhonePePaymentAdapter } from './adapters/phonepe/phonepe-payment.adapter';
// BillingModule is imported with forwardRef to break circular dependency (BillingModule imports PaymentModule)
import { BillingModule } from '@services/billing/billing.module';

@Module({
  imports: [
    HttpModule,
    DatabaseModule,
    CacheModule,
    LoggingModule,
    EventsModule,
    forwardRef(() => BillingModule), // Use forwardRef to break circular dependency
    // PaymentConfigService is now provided by ConfigModule (Global)
  ],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    // PaymentConfigService is now provided by ConfigModule (Global)
    PaymentProviderFactory,
    RazorpayPaymentAdapter,
    PhonePePaymentAdapter,
  ],
  exports: [PaymentService, PaymentProviderFactory],
})
export class PaymentModule {}
