/**
 * Payment Module
 * ==============
 * Payment processing module with provider adapters
 *
 * @module PaymentModule
 * @description Payment module for multi-provider payment processing
 */

import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DatabaseModule } from '@infrastructure/database';
import { CacheModule } from '@infrastructure/cache';
import { LoggingModule } from '@infrastructure/logging';
import { EventsModule } from '@infrastructure/events';
import { PaymentService } from './payment.service';
import { PaymentProviderFactory } from './adapters/factories/payment-provider.factory';
import { PaymentController } from './payment.controller';
import { RazorpayPaymentAdapter } from './adapters/razorpay/razorpay-payment.adapter';
import { PhonePePaymentAdapter } from './adapters/phonepe/phonepe-payment.adapter';

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
    RazorpayPaymentAdapter,
    PhonePePaymentAdapter,
  ],
  exports: [PaymentService, PaymentProviderFactory],
})
export class PaymentModule {}
