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
import { EventService } from '@infrastructure/events';
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
   * Create payment intent (for subscriptions or one-time payments)
   */
  async createPaymentIntent(
    clinicId: string,
    options: PaymentIntentOptions,
    provider?: PaymentProvider
  ): Promise<PaymentResult> {
    try {
      const adapter = await this.getProviderAdapter(clinicId, provider);

      // Add clinicId to options if not present
      const paymentOptions: PaymentIntentOptions = {
        ...options,
        clinicId: options.clinicId || clinicId,
      };

      const result = await adapter.createPaymentIntent(paymentOptions);

      // Emit payment event
      const eventPayload: EnterpriseEventPayload = {
        eventId: `payment-intent-${result.paymentId || Date.now()}`,
        eventType: 'payment.intent.created',
        category: EventCategory.BILLING,
        priority: EventPriority.HIGH,
        timestamp: new Date().toISOString(),
        source: 'PaymentService',
        version: '1.0.0',
        clinicId,
        ...(options.customerId && { userId: options.customerId }),
        metadata: {
          paymentId: result.paymentId,
          amount: options.amount,
          currency: options.currency,
          appointmentId: options.appointmentId,
          appointmentType: options.appointmentType,
          isSubscription: options.isSubscription,
        },
      };
      await this.eventService.emitEnterprise('payment.intent.created', eventPayload);

      return result;
    } catch (error) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        `Failed to create payment intent: ${error instanceof Error ? error.message : String(error)}`,
        'PaymentService',
        {
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
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
      const adapter = await this.getProviderAdapter(clinicId, provider);
      const result = await adapter.refund(options);

      // Emit refund event
      if (result.success) {
        const refundEventPayload: EnterpriseEventPayload = {
          eventId: `payment-refund-${result.refundId || Date.now()}`,
          eventType: 'payment.refunded',
          category: EventCategory.BILLING,
          priority: EventPriority.HIGH,
          timestamp: new Date().toISOString(),
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
