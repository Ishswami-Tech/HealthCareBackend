/**
 * Payment Provider Factory
 * ========================
 * Factory for creating payment provider adapters
 * Follows the same pattern as communication provider factory
 *
 * @module PaymentProviderFactory
 * @description Factory for instantiating payment provider adapters
 */

import { Injectable } from '@nestjs/common';
import { HttpService } from '@infrastructure/http';
import { LoggingService } from '@logging';
import type { PaymentProviderAdapter, PaymentProviderConfig } from '@core/types/payment.types';
import { PaymentProvider } from '@core/types/payment.types';

/**
 * Payment Provider Factory
 * Creates and initializes payment provider adapters
 */
@Injectable()
export class PaymentProviderFactory {
  constructor(private readonly loggingService: LoggingService) {}

  /**
   * Create payment provider adapter based on configuration
   */
  async createAdapter(config: PaymentProviderConfig): Promise<PaymentProviderAdapter> {
    let adapter: PaymentProviderAdapter;

    switch (config.provider) {
      case PaymentProvider.RAZORPAY: {
        const { RazorpayPaymentAdapter } =
          await import('@payment/adapters/razorpay/razorpay-payment.adapter');
        adapter = new RazorpayPaymentAdapter(this.loggingService);
        break;
      }

      case PaymentProvider.PHONEPE: {
        // PhonePe adapter requires HttpService - handled in createAdapterWithHttpService
        // These imports are for type reference only, not used in this method
        await import('@nestjs/axios');
        await import('@payment/adapters/phonepe/phonepe-payment.adapter');
        throw new Error(
          'PhonePe adapter requires HttpService. Use createAdapterWithHttpService() method instead.'
        );
      }

      default:
        throw new Error(`Unsupported payment provider: ${config.provider}`);
    }

    // Initialize adapter with configuration
    adapter.initialize(config);

    return adapter;
  }

  /**
   * Create payment provider adapter with HttpService (for PhonePe)
   */
  async createAdapterWithHttpService(
    config: PaymentProviderConfig,
    httpService: HttpService
  ): Promise<PaymentProviderAdapter> {
    let adapter: PaymentProviderAdapter;

    switch (config.provider) {
      case PaymentProvider.RAZORPAY: {
        const { RazorpayPaymentAdapter } =
          await import('@payment/adapters/razorpay/razorpay-payment.adapter');
        adapter = new RazorpayPaymentAdapter(this.loggingService);
        break;
      }

      case PaymentProvider.PHONEPE: {
        const { PhonePePaymentAdapter } =
          await import('@payment/adapters/phonepe/phonepe-payment.adapter');
        adapter = new PhonePePaymentAdapter(this.loggingService, httpService);
        break;
      }

      default:
        throw new Error(`Unsupported payment provider: ${config.provider}`);
    }

    // Initialize adapter with configuration
    adapter.initialize(config);

    return adapter;
  }
}
