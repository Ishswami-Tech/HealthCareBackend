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
  private readonly enabledProviders = (
    process.env['PAYMENT_ENABLED_PROVIDERS'] ||
    [PaymentProvider.CASHFREE, PaymentProvider.RAZORPAY, PaymentProvider.PHONEPE].join(',')
  )
    .split(',')
    .map(provider => provider.trim().toLowerCase())
    .filter(Boolean);

  private assertProviderEnabled(provider: PaymentProvider): void {
    if (!this.enabledProviders.includes(provider)) {
      throw new Error(
        `Payment provider '${provider}' is disabled. Enabled providers: ${this.enabledProviders.join(', ')}`
      );
    }
  }

  /**
   * Create payment provider adapter based on configuration
   */
  async createAdapter(config: PaymentProviderConfig): Promise<PaymentProviderAdapter> {
    this.assertProviderEnabled(config.provider);
    let adapter: PaymentProviderAdapter;

    switch (config.provider) {
      case PaymentProvider.RAZORPAY: {
        const { RazorpayPaymentAdapter } =
          await import('@payment/adapters/razorpay/razorpay-payment.adapter');
        adapter = new RazorpayPaymentAdapter(this.loggingService);
        break;
      }

      case PaymentProvider.CASHFREE: {
        await import('@payment/adapters/cashfree/cashfree-payment.adapter');
        throw new Error(
          'Cashfree adapter requires HttpService. Use createAdapterWithHttpService() method instead.'
        );
      }

      case PaymentProvider.PHONEPE: {
        await import('@nestjs/axios');
        await import('@payment/adapters/phonepe/phonepe-payment.adapter');
        throw new Error(
          'PhonePe adapter requires HttpService. Use createAdapterWithHttpService() method instead.'
        );
      }

      case PaymentProvider.EASEBUZZ: {
        await import('@nestjs/axios');
        await import('@payment/adapters/easebuzz/easebuzz-payment.adapter');
        throw new Error(
          'Easebuzz adapter requires HttpService. Use createAdapterWithHttpService() method instead.'
        );
      }

      case PaymentProvider.PAYTM: {
        await import('@nestjs/axios');
        await import('@payment/adapters/paytm/paytm-payment.adapter');
        throw new Error(
          'Paytm adapter requires HttpService. Use createAdapterWithHttpService() method instead.'
        );
      }

      case PaymentProvider.PAYU: {
        await import('@nestjs/axios');
        await import('@payment/adapters/payu/payu-payment.adapter');
        throw new Error(
          'PayU adapter requires HttpService. Use createAdapterWithHttpService() method instead.'
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
   * Create payment provider adapter with HttpService (for Cashfree, PhonePe, Easebuzz, Paytm)
   */
  async createAdapterWithHttpService(
    config: PaymentProviderConfig,
    httpService: HttpService
  ): Promise<PaymentProviderAdapter> {
    this.assertProviderEnabled(config.provider);
    let adapter: PaymentProviderAdapter;

    switch (config.provider) {
      case PaymentProvider.RAZORPAY: {
        const { RazorpayPaymentAdapter } =
          await import('@payment/adapters/razorpay/razorpay-payment.adapter');
        adapter = new RazorpayPaymentAdapter(this.loggingService);
        break;
      }

      case PaymentProvider.CASHFREE: {
        const { CashfreePaymentAdapter } =
          await import('@payment/adapters/cashfree/cashfree-payment.adapter');
        adapter = new CashfreePaymentAdapter(this.loggingService, httpService);
        break;
      }

      case PaymentProvider.PHONEPE: {
        const { PhonePePaymentAdapter } =
          await import('@payment/adapters/phonepe/phonepe-payment.adapter');
        adapter = new PhonePePaymentAdapter(this.loggingService, httpService);
        break;
      }

      case PaymentProvider.EASEBUZZ: {
        const { EasebuzzPaymentAdapter } =
          await import('@payment/adapters/easebuzz/easebuzz-payment.adapter');
        adapter = new EasebuzzPaymentAdapter(this.loggingService, httpService);
        break;
      }

      case PaymentProvider.PAYTM: {
        const { PaytmBusinessPaymentAdapter } =
          await import('@payment/adapters/paytm/paytm-payment.adapter');
        adapter = new PaytmBusinessPaymentAdapter(this.loggingService, httpService);
        break;
      }

      case PaymentProvider.PAYU: {
        const { PayUPaymentAdapter } = await import('@payment/adapters/payu/payu-payment.adapter');
        adapter = new PayUPaymentAdapter(this.loggingService, httpService);
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
