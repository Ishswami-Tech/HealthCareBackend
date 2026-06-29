/**
 * Easebuzz Payment Adapter
 * ======================
 * Easebuzz payment provider adapter
 * Implements PaymentProviderAdapter interface
 *
 * @module EasebuzzPaymentAdapter
 * @description Easebuzz payment adapter for multi-tenant payment processing
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

// Easebuzz API types
interface EasebuzzPaymentRequest {
  env: 'TEST' | 'PROD';
  merchant_txnid: string;
  order_amount: number; // Amount in INR (not paise)
  customer_name: string;
  customer_email: string;
  customer_mobile: string;
  description?: string;
  redirect_url: string;
  webhook_url?: string;
  payment_methods?: string[];
}

interface EasebuzzPaymentResponse {
  status: number;
  code: string;
  message: string;
  data?: {
    result: string;
    payment_link?: string;
    payment_id?: string;
    txn_id?: string;
  };
}

interface EasebuzzStatusResponse {
  status: number;
  code: string;
  message: string;
  data?: {
    result: string;
    transaction_status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'REFUNDED';
    amount?: number;
    txnid?: string;
    paymentid?: string;
    message?: string;
  };
}

interface EasebuzzRefundRequest {
  env: 'TEST' | 'PROD';
  merchant_refundid: string;
  paymentid: string;
  amount?: number; // Optional for full refund
  refund_mode: 'BANK' | 'NEFT' | 'RTGS' | 'CHEQUE';
}

interface EasebuzzRefundResponse {
  status: number;
  code: string;
  message: string;
  data?: {
    result: string;
    refundid?: string;
    paymentid?: string;
    amount?: number;
    status?: 'SUCCESS' | 'FAILED' | 'PENDING';
  };
}

/**
 * Easebuzz Payment Adapter
 * Handles payment processing via Easebuzz API
 */
@Injectable()
export class EasebuzzPaymentAdapter extends BasePaymentAdapter {
  private httpService: HttpService | null = null;
  private merchantKey: string = '';
  private merchantSalt: string = '';
  private environment: 'TEST' | 'PROD' = 'TEST';
  private baseUrl: string = 'https://test.easebuzz.in';
  private webhookSecret: string = '';

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
      throw new Error('Easebuzz credentials are required');
    }

    const credentials = config.credentials as Record<string, string>;
    this.merchantKey = credentials['merchantKey'] || credentials['merchant_key'] || '';
    this.merchantSalt = credentials['merchantSalt'] || credentials['merchant_salt'] || '';
    this.webhookSecret = credentials['webhookSecret'] || credentials['webhook_secret'] || '';
    this.environment = (credentials['environment'] || 'TEST') as 'TEST' | 'PROD';

    this.baseUrl =
      this.environment === 'PROD' ? 'https://www.easebuzz.in' : 'https://test.easebuzz.in';

    if (!this.merchantKey || !this.merchantSalt) {
      throw new Error('Easebuzz merchantKey and merchantSalt are required');
    }
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return 'easebuzz';
  }

  /**
   * Generate signature for Easebuzz API
   */
  private generateSignature(data: Record<string, unknown>): string {
    const sortedData = Object.keys(data)
      .sort()
      .map(key => {
        const value = data[key];
        if (value === null || value === undefined) {
          return `${key}=`;
        }
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          return `${key}=${value}`;
        }
        return `${key}=${JSON.stringify(value)}`;
      })
      .join('|');

    return Buffer.from(sortedData, 'utf8')
      .toString('base64')
      .replace(/[^A-Za-z0-9+/]/g, '');
  }

  /**
   * Verify connection
   */
  async verify(): Promise<boolean> {
    if (!this.httpService || !this.merchantKey || !this.merchantSalt) {
      return false;
    }

    try {
      // Check basic configuration
      return this.merchantKey.length > 0 && this.merchantSalt.length > 0;
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.WARN,
        'Easebuzz verification failed',
        'EasebuzzPaymentAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }

  /**
   * Create payment intent (payment request) via Easebuzz
   */
  async createPaymentIntent(options: PaymentIntentOptions): Promise<PaymentResult> {
    if (!this.httpService) {
      return this.createErrorResult('Easebuzz adapter not initialized');
    }

    try {
      // Validate options
      this.validatePaymentIntentOptions(options);

      // Generate unique transaction ID
      const merchantTxnId =
        options.orderId || `TXN_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      // Create payment request
      const paymentRequest: EasebuzzPaymentRequest = {
        env: this.environment,
        merchant_txnid: merchantTxnId,
        order_amount: options.amount / 100, // Convert paise to INR (₹100 = 10000 paise)
        customer_name: options.customerName || 'Customer',
        customer_email: options.customerEmail || '',
        customer_mobile: options.customerPhone || '',
        description: options.description || 'Healthcare Payment',
        redirect_url: this.getRedirectUrl(options),
        webhook_url: this.getWebhookUrl(options),
      };

      // Add payment methods if specified
      const pm = options.metadata?.['paymentMethods'];
      if (typeof pm === 'string') {
        paymentRequest.payment_methods = pm.split(',');
      }

      // Generate signature
      const signature = this.generateSignature({
        env: this.environment,
        merchant_key: this.merchantKey,
        redirect_url: paymentRequest.redirect_url,
        customer_email: paymentRequest.customer_email,
        order_amount: paymentRequest.order_amount,
        merchant_txnid: paymentRequest.merchant_txnid,
        customer_mobile: paymentRequest.customer_mobile,
      });

      // Make API call with retry
      const response = await this.executeWithRetry(async () => {
        if (!this.httpService) {
          throw new Error('HTTP service not initialized');
        }
        return await this.httpService.post<EasebuzzPaymentResponse>(
          `${this.baseUrl}/payment/initiate_payment`,
          {
            merchant_key: this.merchantKey,
            signature,
            redirect_url: paymentRequest.redirect_url,
            env: this.environment,
            order_amount: paymentRequest.order_amount,
            customer_email: paymentRequest.customer_email,
            customer_mobile: paymentRequest.customer_mobile,
            customer_name: paymentRequest.customer_name,
            merchant_txnid: paymentRequest.merchant_txnid,
            ...(paymentRequest.description && { description: paymentRequest.description }),
            ...(paymentRequest.payment_methods && {
              payment_methods: paymentRequest.payment_methods,
            }),
            ...(paymentRequest.webhook_url && { webhook_url: paymentRequest.webhook_url }),
          }
        );
      });

      if (response.data.status !== 1 || !response.data.data?.payment_link) {
        throw new Error(response.data.message || 'Failed to create payment intent');
      }

      const paymentLink = response.data.data.payment_link;

      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'Easebuzz payment intent created successfully',
        'EasebuzzPaymentAdapter',
        {
          merchantTxnId,
          amount: options.amount,
          currency: options.currency,
          appointmentId: options.appointmentId,
        }
      );

      // Return pending result with redirect URL in metadata
      return {
        success: true,
        paymentId: response.data.data.payment_id || merchantTxnId,
        amount: options.amount,
        currency: options.currency,
        status: 'pending',
        provider: this.getProviderName(),
        timestamp: new Date(),
        orderId: merchantTxnId,
        metadata: {
          redirectUrl: paymentLink,
          merchantTxnId,
          paymentId: response.data.data.payment_id,
        },
      };
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to create Easebuzz payment intent',
        'EasebuzzPaymentAdapter',
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
   * Verify payment status via Easebuzz
   */
  async verifyPayment(options: PaymentStatusOptions): Promise<PaymentStatusResult> {
    if (!this.httpService) {
      throw new Error('Easebuzz adapter not initialized');
    }

    try {
      const merchantTxnId = options.paymentId || options.orderId || '';
      if (!merchantTxnId) {
        throw new Error('Payment ID or Order ID is required');
      }

      // Generate signature for status check
      const signature = this.generateSignature({
        env: this.environment,
        merchant_key: this.merchantKey,
        merchant_txnid: merchantTxnId,
      });

      // Fetch payment status from Easebuzz
      const response = await this.executeWithRetry(async () => {
        if (!this.httpService) {
          throw new Error('HTTP service not initialized');
        }
        return await this.httpService.get<EasebuzzStatusResponse>(
          `${this.baseUrl}/api/v2/merchant/statusTxn`,
          {
            params: {
              merchant_key: this.merchantKey,
              env: this.environment,
              merchant_txnid: merchantTxnId,
              signature,
            },
          }
        );
      });

      if (response.data.status !== 1 || !response.data.data) {
        throw new Error(response.data.message || 'Failed to fetch payment status');
      }

      const paymentData = response.data.data;

      // Map Easebuzz transaction_status to our status
      let status: PaymentStatusResult['status'];
      switch (paymentData.transaction_status) {
        case 'SUCCESS':
          status = 'completed';
          break;
        case 'FAILED':
          status = 'failed';
          break;
        case 'REFUNDED':
          status = 'refunded';
          break;
        default:
          status = 'pending';
      }

      return {
        paymentId: merchantTxnId,
        status,
        amount: (paymentData.amount ?? 0) * 100, // Convert from INR to paise
        currency: 'INR',
        transactionId: paymentData.paymentid ?? '',
        provider: this.getProviderName(),
        timestamp: new Date(),
        metadata: {
          message: paymentData.message,
          transactionStatus: paymentData.transaction_status,
          paymentid: paymentData.paymentid,
        },
      };
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to verify Easebuzz payment',
        'EasebuzzPaymentAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
          paymentId: options.paymentId,
        }
      );
      throw error;
    }
  }

  /**
   * Process refund via Easebuzz
   */
  async refund(options: RefundOptions): Promise<RefundResult> {
    if (!this.httpService) {
      return {
        success: false,
        paymentId: options.paymentId,
        amount: 0,
        status: 'failed',
        provider: this.getProviderName(),
        error: 'Easebuzz adapter not initialized',
        timestamp: new Date(),
      };
    }

    try {
      // Validate options
      this.validateRefundOptions(options);

      // Generate unique merchant refund ID
      const merchantRefundId = `REFUND_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      // Create refund request
      const refundRequest: EasebuzzRefundRequest = {
        env: this.environment,
        merchant_refundid: merchantRefundId,
        paymentid: options.paymentId,
        ...(options.amount && { amount: options.amount / 100 }), // Convert paise to INR
        refund_mode: 'NEFT', // Default refund mode
      };

      // Generate signature
      const signature = this.generateSignature({
        env: this.environment,
        merchant_key: this.merchantKey,
        merchant_refundid: refundRequest.merchant_refundid,
        paymentid: refundRequest.paymentid,
        ...(refundRequest.amount && { amount: refundRequest.amount }),
        refund_mode: refundRequest.refund_mode,
      });

      // Make API call with retry
      const response = await this.executeWithRetry(async () => {
        if (!this.httpService) {
          throw new Error('HTTP service not initialized');
        }
        return await this.httpService.post<EasebuzzRefundResponse>(
          `${this.baseUrl}/payment/refund_request`,
          {
            merchant_key: this.merchantKey,
            signature,
            env: this.environment,
            merchant_refundid: refundRequest.merchant_refundid,
            paymentid: refundRequest.paymentid,
            ...(refundRequest.amount && { amount: refundRequest.amount }),
            refund_mode: refundRequest.refund_mode,
          }
        );
      });

      if (response.data.status !== 1 || !response.data.data) {
        throw new Error(response.data.message || 'Failed to process refund');
      }

      const refundData = response.data.data;

      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'Easebuzz refund processed successfully',
        'EasebuzzPaymentAdapter',
        {
          refundId: refundData.refundid,
          paymentId: options.paymentId,
          amount: refundData.amount,
        }
      );

      return {
        success: refundData.status === 'SUCCESS',
        refundId: refundData.refundid ?? '',
        paymentId: options.paymentId,
        amount: (refundData.amount ?? 0) * 100, // Convert from INR to paise
        status: refundData.status === 'SUCCESS' ? 'completed' : 'processing',
        provider: this.getProviderName(),
        timestamp: new Date(),
      };
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to process Easebuzz refund',
        'EasebuzzPaymentAdapter',
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
   * Verify webhook signature from Easebuzz
   */
  async verifyWebhook(options: WebhookVerificationOptions): Promise<boolean> {
    try {
      // Easebuzz webhook verification
      // The payload contains signature in the response headers
      const signature = options.signature;

      if (typeof options.payload === 'string') {
        const payload = JSON.parse(options.payload) as Record<string, unknown>;

        // Generate expected signature
        const signatureData = {
          merchant_key: this.merchantKey,
          merchant_txnid: payload['merchant_txnid'],
          amount: payload['amount'],
          status: payload['status'],
          date: payload['date'],
        };

        const expectedSignature = this.generateSignature(signatureData);

        // Verify signature matches
        return signature === expectedSignature;
      } else {
        const payload = options.payload;

        const signatureData = {
          merchant_key: this.merchantKey,
          merchant_txnid: payload['merchant_txnid'],
          amount: payload['amount'],
          status: payload['status'],
          date: payload['date'],
        };

        const expectedSignature = this.generateSignature(signatureData);

        return signature === expectedSignature;
      }
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to verify Easebuzz webhook',
        'EasebuzzPaymentAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }

  /**
   * Helper method to get redirect URL
   */
  private getRedirectUrl(options: PaymentIntentOptions): string {
    const baseUrl =
      (options.metadata?.['baseUrl'] as string) ||
      process.env['FRONTEND_URL'] ||
      process.env['BASE_URL'] ||
      'http://localhost:3000';

    return `${baseUrl}/payment/callback`;
  }

  /**
   * Helper method to get webhook URL
   */
  private getWebhookUrl(options: PaymentIntentOptions): string {
    const baseUrl =
      (options.metadata?.['baseUrl'] as string) ||
      process.env['API_URL'] ||
      process.env['BASE_URL'] ||
      'http://localhost:8088';

    return `${baseUrl}/api/v1/payments/easebuzz/webhook`;
  }
}
