import { nowIso } from '@utils/date-time.util';
/**
 * Payment Service
 * ===============
 * Unified payment processing service
 * Handles payment provider selection, processing, and webhooks
 *
 * @module PaymentService
 * @description Centralized payment processing service
 */

import { Injectable } from '@nestjs/common';
import { HttpService } from '@infrastructure/http';
import { LoggingService } from '@logging';
import { EventService } from '@infrastructure/events/event.service';
import {
  LogType,
  LogLevel,
  EventCategory,
  EventPriority,
  PaymentIntentOptions,
  PaymentResult,
  PaymentStatusOptions,
  PaymentStatusResult,
  RefundOptions,
  RefundResult,
  WebhookVerificationOptions,
  PaymentProviderAdapter,
  PaymentProvider,
  EnterpriseEventPayload,
} from '@core/types';
import { PaymentProviderFactory } from './adapters/factories/payment-provider.factory';
import { PaymentConfigService } from '@config/payment-config.service';
import { formatCurrencyFromMinorUnits } from '../utils/currency.util';

/**
 * Payment Service
 * Handles all payment operations with provider abstraction
 */
@Injectable()
export class PaymentService {
  constructor(
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService,
    private readonly paymentConfigService: PaymentConfigService,
    private readonly paymentProviderFactory: PaymentProviderFactory,
    private readonly httpService: HttpService
  ) {}

  private isDemoPaymentMode(): boolean {
    const explicit = process.env['PAYMENT_DEMO_MODE'];
    if (typeof explicit === 'string' && explicit.trim().length > 0) {
      return explicit.trim().toLowerCase() === 'true';
    }

    const localUrls = [
      process.env['FRONTEND_URL'],
      process.env['API_URL'],
      process.env['BASE_URL'],
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);

    if (localUrls.some(value => /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(value))) {
      return true;
    }

    return process.env['NODE_ENV'] === 'local-prod';
  }

  private createDemoPaymentResult(
    clinicId: string,
    options: PaymentIntentOptions,
    provider: PaymentProvider
  ): PaymentResult {
    const paymentId = `demo_${provider}_${Date.now()}`;
    const orderId = options.orderId || paymentId;
    const metadata = {
      ...(options.metadata || {}),
      clinicId: options.clinicId || clinicId,
      demoMode: true,
      redirectUrl:
        typeof options.metadata?.['redirectUrl'] === 'string'
          ? options.metadata['redirectUrl']
          : undefined,
    };

    return {
      success: true,
      paymentId,
      orderId,
      amount: options.amount,
      currency: options.currency,
      status: 'pending',
      provider,
      paymentMethod: 'demo',
      metadata,
      providerResponse: {
        demoMode: true,
        provider,
        paymentId,
        orderId,
      },
      timestamp: new Date(),
    };
  }

  private createDemoPaymentStatus(
    paymentId: string,
    orderId: string,
    amount: number,
    currency: string,
    provider: PaymentProvider
  ): PaymentStatusResult {
    return {
      paymentId,
      status: 'completed',
      amount,
      currency,
      transactionId: paymentId || orderId,
      provider,
      metadata: {
        demoMode: true,
        orderId,
      },
      timestamp: new Date(),
    };
  }

  /**
   * Get payment provider adapter for a clinic
   */
  private async getProviderAdapter(
    clinicId: string,
    provider?: PaymentProvider
  ): Promise<PaymentProviderAdapter> {
    const config = await this.paymentConfigService.getClinicConfig(clinicId);
    if (!config || !config.payment.primary) {
      throw new Error(`No payment configuration found for clinic: ${clinicId}`);
    }

    // Use specified provider or default from config
    const providerConfig = provider
      ? config.payment.fallback?.find(f => f.provider === provider) || config.payment.primary
      : config.payment.primary;

    if (!providerConfig.enabled) {
      throw new Error(
        `Payment provider ${providerConfig.provider} is disabled for clinic: ${clinicId}`
      );
    }

    // Create adapter with HttpService for PhonePe
    const adapter = await this.paymentProviderFactory.createAdapterWithHttpService(
      providerConfig,
      this.httpService
    );

    return adapter;
  }

  /**
   * Create payment intent (for subscriptions or one-time payments).
   * Uses primary provider from clinic config; on failure tries fallback providers in order.
   * Only one provider at a time - fallback only when primary fails.
   */
  async createPaymentIntent(
    clinicId: string,
    options: PaymentIntentOptions,
    provider?: PaymentProvider
  ): Promise<PaymentResult> {
    const config = await this.paymentConfigService.getClinicConfig(clinicId);
    if (!config || !config.payment.primary) {
      throw new Error(`No payment configuration found for clinic: ${clinicId}`);
    }

    const paymentOptions: PaymentIntentOptions = {
      ...options,
      clinicId: options.clinicId || clinicId,
    };

    if (this.isDemoPaymentMode()) {
      const demoProvider = provider || config.payment.primary.provider;
      const demoResult = this.createDemoPaymentResult(clinicId, paymentOptions, demoProvider);

      const demoEventPayload: EnterpriseEventPayload = {
        eventId: `payment-intent-${demoResult.paymentId}`,
        eventType: 'payment.intent.created',
        category: EventCategory.BILLING,
        priority: EventPriority.HIGH,
        timestamp: nowIso(),
        source: 'PaymentService',
        version: '1.0.0',
        clinicId,
        ...(options.customerId && { userId: options.customerId }),
        metadata: {
          paymentId: demoResult.paymentId,
          amount: options.amount,
          displayAmount: formatCurrencyFromMinorUnits(options.amount, options.currency),
          currency: options.currency,
          appointmentId: options.appointmentId,
          appointmentType: options.appointmentType,
          isSubscription: options.isSubscription,
          demoMode: true,
        },
      };
      void Promise.allSettled([
        this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.INFO,
          `Demo payment intent created with provider: ${demoProvider}`,
          'PaymentService',
          { clinicId, provider: demoProvider, paymentId: demoResult.paymentId }
        ),
        this.eventService.emitEnterprise('payment.intent.created', demoEventPayload),
      ]);

      return demoResult;
    }

    const providersToTry: PaymentProvider[] = provider
      ? [provider]
      : [config.payment.primary.provider, ...(config.payment.fallback?.map(f => f.provider) || [])];

    let lastError: Error | null = null;

    for (const p of providersToTry) {
      try {
        const adapter = await this.getProviderAdapter(clinicId, p);
        const result = await adapter.createPaymentIntent(paymentOptions);

        const eventPayload: EnterpriseEventPayload = {
          eventId: `payment-intent-${result.paymentId || Date.now()}`,
          eventType: 'payment.intent.created',
          category: EventCategory.BILLING,
          priority: EventPriority.HIGH,
          timestamp: nowIso(),
          source: 'PaymentService',
          version: '1.0.0',
          clinicId,
          ...(options.customerId && { userId: options.customerId }),
          metadata: {
            paymentId: result.paymentId,
            amount: options.amount,
            displayAmount: formatCurrencyFromMinorUnits(options.amount, options.currency),
            currency: options.currency,
            appointmentId: options.appointmentId,
            appointmentType: options.appointmentType,
            isSubscription: options.isSubscription,
          },
        };
        void Promise.allSettled([
          this.loggingService.log(
            LogType.PAYMENT,
            LogLevel.INFO,
            `Payment intent created with provider: ${result.provider}`,
            'PaymentService',
            { clinicId, provider: result.provider, paymentId: result.paymentId }
          ),
          this.eventService.emitEnterprise('payment.intent.created', eventPayload),
        ]);

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          `Provider ${p} failed, trying next: ${lastError.message}`,
          'PaymentService',
          { clinicId, provider: p }
        );
      }
    }

    await this.loggingService.log(
      LogType.PAYMENT,
      LogLevel.ERROR,
      `All payment providers failed: ${lastError?.message}`,
      'PaymentService',
      { clinicId }
    );
    throw lastError || new Error('Failed to create payment intent');
  }

  /**
   * Verify payment status
   */
  async verifyPayment(
    clinicId: string,
    options: PaymentStatusOptions,
    provider?: PaymentProvider
  ): Promise<PaymentStatusResult> {
    try {
      if (this.isDemoPaymentMode()) {
        const normalizedProvider = provider || PaymentProvider.CASHFREE;
        return this.createDemoPaymentStatus(
          options.paymentId,
          options.orderId || options.paymentId,
          0,
          'INR',
          normalizedProvider
        );
      }

      const adapter = await this.getProviderAdapter(clinicId, provider);
      return await adapter.verifyPayment(options);
    } catch (error) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        `Failed to verify payment: ${error instanceof Error ? error.message : String(error)}`,
        'PaymentService',
        {
          clinicId,
          paymentId: options.paymentId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Process refund
   */
  async refund(
    clinicId: string,
    options: RefundOptions,
    provider?: PaymentProvider
  ): Promise<RefundResult> {
    try {
      if (this.isDemoPaymentMode()) {
        return {
          success: true,
          refundId: `demo_refund_${Date.now()}`,
          paymentId: options.paymentId,
          amount: options.amount || 0,
          status: 'completed',
          provider: provider || PaymentProvider.CASHFREE,
          timestamp: new Date(),
          providerResponse: {
            demoMode: true,
            reason: options.reason || 'Demo refund',
          },
        };
      }

      const adapter = await this.getProviderAdapter(clinicId, provider);
      const result = await adapter.refund(options);

      // Emit refund event
      if (result.success) {
        const refundEventPayload: EnterpriseEventPayload = {
          eventId: `payment-refund-${result.refundId || Date.now()}`,
          eventType: 'payment.refunded',
          category: EventCategory.BILLING,
          priority: EventPriority.HIGH,
          timestamp: nowIso(),
          source: 'PaymentService',
          version: '1.0.0',
          clinicId,
          metadata: {
            refundId: result.refundId,
            paymentId: options.paymentId,
            amount: result.amount,
          },
        };
        await this.eventService.emitEnterprise('payment.refunded', refundEventPayload);
      }

      return result;
    } catch (error) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        `Failed to process refund: ${error instanceof Error ? error.message : String(error)}`,
        'PaymentService',
        {
          clinicId,
          paymentId: options.paymentId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Verify webhook signature
   */
  async verifyWebhook(
    clinicId: string,
    options: WebhookVerificationOptions,
    provider?: PaymentProvider
  ): Promise<boolean> {
    try {
      if (this.isDemoPaymentMode()) {
        return true;
      }

      const adapter = await this.getProviderAdapter(clinicId, provider);
      return await adapter.verifyWebhook(options);
    } catch (error) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        `Failed to verify webhook: ${error instanceof Error ? error.message : String(error)}`,
        'PaymentService',
        {
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      return false;
    }
  }
}
