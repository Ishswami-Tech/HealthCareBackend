/**
 * PhonePe Payment Adapter
 * =======================
 * PhonePe payment provider adapter
 * Implements PaymentProviderAdapter interface
 *
 * @module PhonePePaymentAdapter
 * @description PhonePe payment adapter for multi-tenant payment processing
 */

import { Injectable } from '@nestjs/common';
import { HttpService } from '@infrastructure/http';
import {
  Env,
  RefundRequest,
  StandardCheckoutClient,
  StandardCheckoutPayRequest,
} from '@phonepe-pg/pg-sdk-node';
import { LoggingService } from '@logging';
import { LogType, LogLevel } from '@core/types';
import { BasePaymentAdapter } from '../base/base-payment-adapter';
import type {
  PaymentIntentOptions,
  PaymentResult,
  PaymentStatusOptions,
  PaymentStatusResult,
  RefundOptions,
  RefundResult,
  WebhookVerificationOptions,
  PaymentProviderConfig,
} from '@core/types/payment.types';

/**
 * PhonePe Payment Adapter
 * Handles payment processing via PhonePe API
 */
@Injectable()
export class PhonePePaymentAdapter extends BasePaymentAdapter {
  private httpService: HttpService | null = null;
  private clientId: string = '';
  private clientSecret: string = '';
  private clientVersion: number = 1;
  private environment: Env = Env.SANDBOX;
  private phonepeClient: StandardCheckoutClient | null = null;

  constructor(loggingService: LoggingService, httpService: HttpService) {
    super(loggingService);
    this.httpService = httpService;
  }

  /**
   * Initialize adapter with clinic-specific configuration
   */
  initialize(config: PaymentProviderConfig): void {
    this.config = config;

    if (!config.credentials || typeof config.credentials !== 'object') {
      throw new Error('PhonePe credentials are required');
    }

    const credentials = config.credentials as Record<string, string>;
    this.clientId = credentials['clientId'] || credentials['client_id'] || '';
    this.clientSecret = credentials['clientSecret'] || credentials['client_secret'] || '';
    this.clientVersion = Number(
      credentials['clientVersion'] || credentials['client_version'] || '1'
    );
    const environment = String(credentials['environment'] || 'sandbox').toLowerCase();
    this.environment = environment === 'production' ? Env.PRODUCTION : Env.SANDBOX;

    if (!this.clientId || !this.clientSecret || !Number.isFinite(this.clientVersion)) {
      throw new Error('PhonePe clientId, clientSecret, and clientVersion are required');
    }

    this.phonepeClient = StandardCheckoutClient.getInstance(
      this.clientId,
      this.clientSecret,
      this.clientVersion,
      this.environment
    );
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return 'phonepe';
  }

  /**
   * Get the PhonePe SDK client
   */
  private getClient(): StandardCheckoutClient {
    if (!this.phonepeClient) {
      throw new Error('PhonePe SDK client not initialized');
    }
    return this.phonepeClient;
  }

  /**
   * Verify PhonePe connection
   */
  async verify(): Promise<boolean> {
    if (!this.clientId || !this.clientSecret || !this.phonepeClient) {
      return false;
    }

    try {
      return this.clientId.length > 0 && this.clientSecret.length > 0;
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.WARN,
        'PhonePe verification failed',
        'PhonePePaymentAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }

  /**
   * Create payment intent (initiate payment) via PhonePe
   */
  async createPaymentIntent(options: PaymentIntentOptions): Promise<PaymentResult> {
    if (!this.phonepeClient) {
      return this.createErrorResult('PhonePe SDK client not initialized');
    }

    try {
      // Validate options
      this.validatePaymentIntentOptions(options);

      // Convert amount to paise (PhonePe uses smallest currency unit)
      const amountInPaise = Math.round(options.amount);

      // Generate unique merchant transaction ID
      const merchantOrderId =
        options.orderId || `TXN_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const redirectUrl =
        (options.metadata?.['redirectUrl'] as string) ||
        (() => {
          const baseUrl =
            (options.metadata?.['baseUrl'] as string) ||
            process.env['FRONTEND_URL'] ||
            'http://localhost:3000';
          return `${baseUrl}/payment/callback`;
        })();
      const paymentRequest = StandardCheckoutPayRequest.builder()
        .merchantOrderId(merchantOrderId)
        .amount(amountInPaise)
        .redirectUrl(redirectUrl)
        .build();

      const response = await this.executeWithRetry(async () => {
        const client = this.getClient();
        return await client.pay(paymentRequest);
      });

      const paymentRedirectUrl = response.redirectUrl;

      if (typeof paymentRedirectUrl !== 'string' || !paymentRedirectUrl) {
        throw new Error('Failed to create payment intent');
      }

      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'PhonePe payment intent created successfully',
        'PhonePePaymentAdapter',
        {
          merchantOrderId,
          amount: options.amount,
          currency: options.currency,
          appointmentId: options.appointmentId,
        }
      );

      // Return pending result with redirect URL in metadata
      return {
        success: true,
        paymentId: merchantOrderId,
        amount: options.amount,
        currency: options.currency,
        status: 'pending',
        provider: this.getProviderName(),
        timestamp: new Date(),
        orderId: merchantOrderId,
        metadata: {
          redirectUrl: paymentRedirectUrl,
          merchantOrderId,
          state: response.state || 'PENDING',
        },
        providerResponse: response,
      };
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to create PhonePe payment intent',
        'PhonePePaymentAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
          amount: options.amount,
          currency: options.currency,
        }
      );

      return this.createErrorResult(error instanceof Error ? error : String(error));
    }
  }

  /**
   * Verify payment status via PhonePe
   */
  async verifyPayment(options: PaymentStatusOptions): Promise<PaymentStatusResult> {
    if (!this.phonepeClient) {
      throw new Error('PhonePe SDK client not initialized');
    }

    try {
      const merchantOrderId = options.paymentId || options.orderId || '';
      if (!merchantOrderId) {
        throw new Error('Payment ID or Order ID is required');
      }

      const response = await this.executeWithRetry(async () => {
        const client = this.getClient();
        return await client.getOrderStatus(merchantOrderId, true);
      });

      if (!response.state) {
        throw new Error('Failed to fetch payment status');
      }

      // Map PhonePe state to our status
      let status: PaymentStatusResult['status'];
      switch (response.state) {
        case 'COMPLETED':
          status = 'completed';
          break;
        case 'FAILED':
          status = 'failed';
          break;
        default:
          status = 'pending';
      }

      const transactionId = response.paymentDetails?.[0]?.transactionId;

      return {
        paymentId: merchantOrderId,
        status,
        amount: (response.amount || 0) / 100, // Convert from paise to currency unit
        currency: 'INR',
        ...(transactionId ? { transactionId } : {}),
        provider: this.getProviderName(),
        timestamp: new Date(),
        metadata: {
          paymentMode: response.paymentDetails?.[0]?.paymentMode,
          state: response.state,
          errorCode: response.errorCode,
          detailedErrorCode: response.detailedErrorCode,
        },
      };
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to verify PhonePe payment',
        'PhonePePaymentAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
          paymentId: options.paymentId,
        }
      );
      throw error;
    }
  }

  /**
   * Process refund via PhonePe
   */
  async refund(options: RefundOptions): Promise<RefundResult> {
    if (!this.phonepeClient) {
      return {
        success: false,
        paymentId: options.paymentId,
        amount: 0,
        status: 'failed',
        provider: this.getProviderName(),
        error: 'PhonePe adapter not initialized',
        timestamp: new Date(),
      };
    }

    try {
      // Validate options
      this.validateRefundOptions(options);

      // Generate unique merchant transaction ID for refund
      const merchantRefundId = `REFUND_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const refundAmount = Math.round(options.amount || 0);
      if (!refundAmount) {
        throw new Error('PhonePe refund amount is required');
      }

      const refundRequest = RefundRequest.builder()
        .merchantRefundId(merchantRefundId)
        .originalMerchantOrderId(options.paymentId)
        .amount(refundAmount)
        .build();

      const response = await this.executeWithRetry(async () => {
        const client = this.getClient();
        return await client.refund(refundRequest);
      });

      if (!response.state) {
        throw new Error('Failed to process refund');
      }

      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'PhonePe refund processed successfully',
        'PhonePePaymentAdapter',
        {
          refundId: response.refundId,
          paymentId: options.paymentId,
          amount: (response.amount || 0) / 100,
        }
      );

      return {
        success: response.state === 'COMPLETED' || response.state === 'CONFIRMED',
        refundId: response.refundId,
        paymentId: options.paymentId,
        amount: (response.amount || 0) / 100, // Convert from paise
        status:
          response.state === 'COMPLETED' || response.state === 'CONFIRMED'
            ? 'completed'
            : 'processing',
        provider: this.getProviderName(),
        timestamp: new Date(),
        providerResponse: response,
      };
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to process PhonePe refund',
        'PhonePePaymentAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
          paymentId: options.paymentId,
        }
      );

      return {
        success: false,
        paymentId: options.paymentId,
        amount: 0,
        status: 'failed',
        provider: this.getProviderName(),
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date(),
      };
    }
  }

  /**
   * Fetch refund status via PhonePe
   */
  async getRefundStatus(refundId: string): Promise<RefundResult> {
    if (!this.phonepeClient) {
      return {
        success: false,
        paymentId: '',
        amount: 0,
        status: 'failed',
        provider: this.getProviderName(),
        error: 'PhonePe adapter not initialized',
        timestamp: new Date(),
      };
    }

    if (!refundId) {
      throw new Error('Refund ID is required');
    }

    try {
      const response = await this.executeWithRetry(async () => {
        const client = this.getClient();
        return await client.getRefundStatus(refundId);
      });

      const state = String(response.state || '').toUpperCase();
      const completed = state === 'COMPLETED' || state === 'CONFIRMED';
      const processing = state === 'ACCEPTED' || state === 'PENDING' || state === 'PROCESSING';

      return {
        success: completed || processing,
        refundId: response.merchantRefundId || refundId,
        paymentId: response.originalMerchantOrderId || '',
        amount: (response.amount || 0) / 100,
        status: completed ? 'completed' : processing ? 'processing' : 'failed',
        provider: this.getProviderName(),
        timestamp: new Date(),
        providerResponse: response,
      };
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to fetch PhonePe refund status',
        'PhonePePaymentAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
          refundId,
        }
      );
      throw error;
    }
  }

  /**
   * Verify webhook signature from PhonePe
   */
  async verifyWebhook(options: WebhookVerificationOptions): Promise<boolean> {
    try {
      if (!this.phonepeClient) {
        return false;
      }

      const authorization = (options.signature || '').trim();
      if (!authorization) {
        return false;
      }

      const responseBody =
        typeof options.payload === 'string' ? options.payload : JSON.stringify(options.payload);
      const username = process.env['PHONEPE_WEBHOOK_USERNAME'] || '';
      const password = process.env['PHONEPE_WEBHOOK_PASSWORD'] || '';
      const configuredHash = process.env['PHONEPE_WEBHOOK_AUTHORIZATION_HASH'] || '';

      if (username && password) {
        const callbackResponse = this.getClient().validateCallback(
          username,
          password,
          authorization,
          responseBody
        );
        return Boolean(callbackResponse?.payload);
      }

      if (configuredHash) {
        return authorization === configuredHash || authorization === configuredHash.trim();
      }

      return false;
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to verify PhonePe webhook',
        'PhonePePaymentAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }
}
