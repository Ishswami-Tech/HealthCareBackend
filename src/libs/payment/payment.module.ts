/**
 * Payment Module
 * ==============
 * Payment processing module with provider adapters
 *
 * @module PaymentModule
 * @description Payment module for multi-provider payment processing
 */

import { Module } from '@nestjs/common';
import { HttpModule } from '@infrastructure/http';
// Use direct imports to avoid TDZ issues with barrel exports
import { DatabaseModule } from '@infrastructure/database/database.module';
import { CacheModule } from '@infrastructure/cache/cache.module';
import { LoggingModule } from '@infrastructure/logging';
import { EventsModule } from '@infrastructure/events/events.module';
import { PaymentService } from './payment.service';
import { PaymentProviderFactory } from './adapters/factories/payment-provider.factory';
import { PaymentController } from './payment.controller';

@Module({
  imports: [
    HttpModule,
    DatabaseModule,
    CacheModule,
    LoggingModule,
    EventsModule,
    // PaymentConfigService is now provided by ConfigModule (Global)
  ],
  controllers: [PaymentController],
  providers: [
    PaymentService,
    // PaymentConfigService is now provided by ConfigModule (Global)
    PaymentProviderFactory,
    // Note: CashfreePaymentAdapter, RazorpayPaymentAdapter, PhonePePaymentAdapter are
    // created via manual `new` in PaymentProviderFactory.createAdapterWithHttpService()
    // (dynamic imports + manual construction) — NOT registered as NestJS providers.
  ],
  exports: [PaymentService, PaymentProviderFactory],
})
export class PaymentModule {}
