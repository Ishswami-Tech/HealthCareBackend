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
import * as crypto from 'crypto';

// PhonePe API types
interface PhonePePaymentRequest {
  merchantId: string;
  merchantTransactionId: string;
  merchantUserId: string;
  amount: number; // Amount in paise
  redirectUrl: string;
  redirectMode: 'REDIRECT' | 'POST';
  callbackUrl: string;
  mobileNumber?: string;
  paymentInstrument?: {
    type: 'PAY_PAGE';
  };
}

interface PhonePePaymentResponse {
  success: boolean;
  code: string;
  message: string;
  data?: {
    merchantId: string;
    merchantTransactionId: string;
    instrumentResponse?: {
      type: string;
      redirectInfo?: {
        url: string;
        method: string;
      };
    };
  };
}

interface PhonePeStatusResponse {
  success: boolean;
  code: string;
  message: string;
  data?: {
    merchantId: string;
    merchantTransactionId: string;
    transactionId: string;
    amount: number;
    state: 'PENDING' | 'COMPLETED' | 'FAILED';
    responseCode: string;
    paymentInstrument?: {
      type: string;
    };
  };
}

interface PhonePeRefundRequest {
  merchantId: string;
  merchantUserId: string;
  originalTransactionId: string;
  merchantTransactionId: string;
  amount?: number; // Amount in paise (optional for full refund)
  callbackUrl: string;
}

interface PhonePeRefundResponse {
  success: boolean;
  code: string;
  message: string;
  data?: {
    merchantId: string;
    merchantTransactionId: string;
    transactionId: string;
    amount: number;
    state: 'PENDING' | 'COMPLETED' | 'FAILED';
  };
}

/**
 * PhonePe Payment Adapter
 * Handles payment processing via PhonePe API
 */
@Injectable()
export class PhonePePaymentAdapter extends BasePaymentAdapter {
  private httpService: HttpService | null = null;
  private merchantId: string = '';
  private saltKey: string = '';
  private saltIndex: string = '1';
  private baseUrl: string = 'https://api.phonepe.com/apis/hermes';

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
    this.merchantId = credentials['merchantId'] || credentials['merchant_id'] || '';
    this.saltKey = credentials['saltKey'] || credentials['salt_key'] || '';
    this.saltIndex = credentials['saltIndex'] || credentials['salt_index'] || '1';
    this.baseUrl =
      credentials['baseUrl'] ||
      credentials['base_url'] ||
      (credentials['environment'] === 'production'
        ? 'https://api.phonepe.com/apis/hermes'
        : 'https://api-preprod.phonepe.com/apis/pg-sandbox');

    if (!this.merchantId || !this.saltKey) {
      throw new Error('PhonePe merchantId and saltKey are required');
    }
  }

  /**
   * Type guard for PaymentProviderConfig
   */
  private isPaymentProviderConfig(
    config: PaymentProviderConfig | Record<string, unknown>
  ): config is PaymentProviderConfig {
    return (
      typeof config === 'object' &&
      config !== null &&
      'provider' in config &&
      'enabled' in config &&
      'credentials' in config
    );
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return 'phonepe';
  }

  /**
   * Generate X-VERIFY header for PhonePe API
   */
  private generateXVerify(payload: string): string {
    const stringToHash = `${payload}/pg/v1/pay${this.saltKey}`;
    const hash = crypto.createHash('sha256').update(stringToHash).digest('hex');
    return `${hash}###${this.saltIndex}`;
  }

  /**
   * Generate X-VERIFY header for status check
   */
  private generateStatusXVerify(merchantId: string, merchantTransactionId: string): string {
    const stringToHash = `/pg/v1/status/${merchantId}/${merchantTransactionId}${this.saltKey}`;
    const hash = crypto.createHash('sha256').update(stringToHash).digest('hex');
    return `${hash}###${this.saltIndex}`;
  }

  /**
   * Generate X-VERIFY header for refund
   */
  private generateRefundXVerify(payload: string): string {
    const stringToHash = `${payload}/pg/v1/refund${this.saltKey}`;
    const hash = crypto.createHash('sha256').update(stringToHash).digest('hex');
    return `${hash}###${this.saltIndex}`;
  }

  /**
   * Verify PhonePe connection
   */
  async verify(): Promise<boolean> {
    if (!this.httpService || !this.merchantId || !this.saltKey) {
      return false;
    }

    try {
      // PhonePe doesn't have a simple verify endpoint
      // We'll just check if the configuration is valid
      return this.merchantId.length > 0 && this.saltKey.length > 0;
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
    if (!this.httpService) {
      return this.createErrorResult('PhonePe adapter not initialized');
    }

    try {
      // Validate options
      this.validatePaymentIntentOptions(options);

      // Convert amount to paise (PhonePe uses smallest currency unit)
      const amountInPaise = Math.round(options.amount);

      // Generate unique merchant transaction ID
      const merchantTransactionId =
        options.orderId || `TXN_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      // Create payment request
      const paymentRequest: PhonePePaymentRequest = {
        merchantId: this.merchantId,
        merchantTransactionId,
        merchantUserId: options.customerId || 'USER_' + Date.now(),
        amount: amountInPaise,
        redirectUrl:
          (options.metadata?.['redirectUrl'] as string) ||
          `${(options.metadata?.['baseUrl'] as string) || 'https://your-app.com'}/payment/callback`,
        redirectMode: 'REDIRECT',
        callbackUrl:
          (options.metadata?.['callbackUrl'] as string) ||
          `${(options.metadata?.['baseUrl'] as string) || 'https://your-app.com'}/api/payments/phonepe/webhook`,
        ...(options.customerPhone && { mobileNumber: options.customerPhone }),
        paymentInstrument: {
          type: 'PAY_PAGE',
        },
      };

      // Base64 encode the request payload
      const base64Payload = Buffer.from(JSON.stringify(paymentRequest)).toString('base64');

      // Generate X-VERIFY header
      const xVerify = this.generateXVerify(base64Payload);

      // Make API call with retry
      const response = await this.executeWithRetry(async () => {
        if (!this.httpService) {
          throw new Error('HTTP service not initialized');
        }
        return await this.httpService.post<PhonePePaymentResponse>(
          `${this.baseUrl}/pg/v1/pay`,
          { request: base64Payload },
          {
            headers: {
              'Content-Type': 'application/json',
              'X-VERIFY': xVerify,
              Accept: 'application/json',
            },
          }
        );
      });

      if (!response.data.success || !response.data.data?.instrumentResponse?.redirectInfo) {
        throw new Error(response.data.message || 'Failed to create payment intent');
      }

      const redirectUrl = response.data.data.instrumentResponse.redirectInfo.url;

      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'PhonePe payment intent created successfully',
        'PhonePePaymentAdapter',
        {
          merchantTransactionId,
          amount: options.amount,
          currency: options.currency,
          appointmentId: options.appointmentId,
        }
      );

      // Return pending result with redirect URL in metadata
      return {
        success: true,
        paymentId: merchantTransactionId,
        amount: options.amount,
        currency: options.currency,
        status: 'pending',
        provider: this.getProviderName(),
        timestamp: new Date(),
        orderId: merchantTransactionId,
        metadata: {
          redirectUrl,
          merchantTransactionId,
        },
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
    if (!this.httpService) {
      throw new Error('PhonePe adapter not initialized');
    }

    try {
      const merchantTransactionId = options.paymentId || options.orderId || '';
      if (!merchantTransactionId) {
        throw new Error('Payment ID or Order ID is required');
      }

      // Generate X-VERIFY header for status check
      const xVerify = this.generateStatusXVerify(this.merchantId, merchantTransactionId);

      // Fetch payment status from PhonePe
      const response = await this.executeWithRetry(async () => {
        if (!this.httpService) {
          throw new Error('HTTP service not initialized');
        }
        return await this.httpService.get<PhonePeStatusResponse>(
          `${this.baseUrl}/pg/v1/status/${this.merchantId}/${merchantTransactionId}`,
          {
            headers: {
              'Content-Type': 'application/json',
              'X-VERIFY': xVerify,
              'X-MERCHANT-ID': this.merchantId,
              Accept: 'application/json',
            },
          }
        );
      });

      if (!response.data.success || !response.data.data) {
        throw new Error(response.data.message || 'Failed to fetch payment status');
      }

      const paymentData = response.data.data;

      // Map PhonePe state to our status
      let status: PaymentStatusResult['status'];
      switch (paymentData.state) {
        case 'COMPLETED':
          status = 'completed';
          break;
        case 'FAILED':
          status = 'failed';
          break;
        default:
          status = 'pending';
      }

      return {
        paymentId: merchantTransactionId,
        status,
        amount: paymentData.amount / 100, // Convert from paise to currency unit
        currency: 'INR',
        transactionId: paymentData.transactionId,
        provider: this.getProviderName(),
        timestamp: new Date(),
        metadata: {
          responseCode: paymentData.responseCode,
          state: paymentData.state,
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
    if (!this.httpService) {
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
      const merchantTransactionId = `REFUND_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      // Create refund request
      const refundRequest: PhonePeRefundRequest = {
        merchantId: this.merchantId,
        merchantUserId: 'SYSTEM',
        originalTransactionId: options.paymentId,
        merchantTransactionId,
        ...(options.amount && { amount: Math.round(options.amount) }), // Only include amount if specified (full refund if omitted)
        callbackUrl:
          (options.metadata?.['callbackUrl'] as string) ||
          `${(options.metadata?.['baseUrl'] as string) || 'https://your-app.com'}/api/payments/phonepe/refund-webhook`,
      };

      // Base64 encode the request payload
      const base64Payload = Buffer.from(JSON.stringify(refundRequest)).toString('base64');

      // Generate X-VERIFY header for refund
      const xVerify = this.generateRefundXVerify(base64Payload);

      // Make API call with retry
      const response = await this.executeWithRetry(async () => {
        if (!this.httpService) {
          throw new Error('HTTP service not initialized');
        }
        return await this.httpService.post<PhonePeRefundResponse>(
          `${this.baseUrl}/pg/v1/refund`,
          { request: base64Payload },
          {
            headers: {
              'Content-Type': 'application/json',
              'X-VERIFY': xVerify,
              Accept: 'application/json',
            },
          }
        );
      });

      if (!response.data.success || !response.data.data) {
        throw new Error(response.data.message || 'Failed to process refund');
      }

      const refundData = response.data.data;

      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'PhonePe refund processed successfully',
        'PhonePePaymentAdapter',
        {
          refundId: refundData.merchantTransactionId,
          paymentId: options.paymentId,
          amount: refundData.amount / 100,
        }
      );

      return {
        success: refundData.state === 'COMPLETED',
        refundId: refundData.merchantTransactionId,
        paymentId: options.paymentId,
        amount: refundData.amount / 100, // Convert from paise
        status: refundData.state === 'COMPLETED' ? 'completed' : 'processing',
        provider: this.getProviderName(),
        timestamp: new Date(),
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
   * Verify webhook signature from PhonePe
   */
  async verifyWebhook(options: WebhookVerificationOptions): Promise<boolean> {
    try {
      // PhonePe webhook verification
      // The signature is in X-VERIFY header
      // We need to verify it matches the payload
      if (typeof options.payload === 'string') {
        const payload = JSON.parse(options.payload) as Record<string, unknown>;
        const base64Payload = payload['request'] as string;
        if (!base64Payload) {
          return false;
        }

        // Decode the payload
        const decodedPayload = Buffer.from(base64Payload, 'base64').toString('utf-8');
        // Payment data is parsed but not used in verification - only signature matters
        JSON.parse(decodedPayload) as Record<string, unknown>;

        // Verify signature
        const stringToHash = `${base64Payload}/pg/v1/status${this.saltKey}`;
        const hash = crypto.createHash('sha256').update(stringToHash).digest('hex');
        const expectedSignature = `${hash}###${this.saltIndex}`;

        return options.signature === expectedSignature;
      } else {
        const payload = options.payload;
        const base64Payload = payload['request'] as string;
        if (!base64Payload) {
          return false;
        }

        // Verify signature
        const stringToHash = `${base64Payload}/pg/v1/status${this.saltKey}`;
        const hash = crypto.createHash('sha256').update(stringToHash).digest('hex');
        const expectedSignature = `${hash}###${this.saltIndex}`;

        return options.signature === expectedSignature;
      }
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
