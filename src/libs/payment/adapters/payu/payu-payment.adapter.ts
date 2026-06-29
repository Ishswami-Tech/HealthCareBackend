/**
 * PayU Payment Adapter
 * ===================
 * PayU payment provider adapter
 * Implements PaymentProviderAdapter interface
 *
 * @module PayUPaymentAdapter
 * @description PayU payment adapter for multi-tenant payment processing
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

// PayU API types
interface PayUPaymentRequest {
  key: string;
  txnid: string;
  amount: string;
  productinfo: string;
  firstname: string;
  email: string;
  phone?: string;
  surl: string; // Success URL
  furl: string; // Failure URL
  curl?: string; // Cancel URL
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
}

interface PayUStatusResponse {
  status: number;
  message: string;
  data?: {
    result: string;
    mihpayid?: string;
    txnid?: string;
    amount?: string;
    status?: 'success' | 'failure' | 'pending' | 'user cancelled';
    addedon?: string;
    payment_source?: string;
  };
}

interface PayURefundResponse {
  status: number;
  message: string;
  data?: {
    result: string;
    unmappedstatus?: string;
    mihpayid?: string;
    refund_id?: string;
  };
}

/**
 * PayU Payment Adapter
 * Handles payment processing via PayU API
 */
@Injectable()
export class PayUPaymentAdapter extends BasePaymentAdapter {
  private httpService: HttpService | null = null;
  private merchantKey: string = '';
  private merchantSalt: string = '';
  private environment: 'test' | 'production' = 'test';
  private baseUrl: string = 'https://test.payu.in';
  private clientId: string = '';
  private clientSecret: string = '';

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
      throw new Error('PayU credentials are required');
    }

    const credentials = config.credentials as Record<string, string>;
    this.merchantKey = credentials['merchantKey'] || credentials['merchant_key'] || '';
    this.merchantSalt = credentials['merchantSalt'] || credentials['merchant_salt'] || '';
    this.clientId = credentials['clientId'] || credentials['client_id'] || '';
    this.clientSecret = credentials['clientSecret'] || credentials['client_secret'] || '';
    this.environment = (credentials['environment'] || 'test') as 'test' | 'production';

    this.baseUrl =
      this.environment === 'production' ? 'https://secure.payu.in' : 'https://test.payu.in';

    if (!this.merchantKey || !this.merchantSalt) {
      throw new Error('PayU merchantKey and merchantSalt are required');
    }
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return 'payu';
  }

  /**
   * Generate hash for PayU API
   */
  private generateHash(data: string): string {
    return crypto.createHash('sha512').update(data).digest('hex');
  }

  /**
   * Generate payment hash
   */
  private generatePaymentHash(request: PayUPaymentRequest): string {
    const hashString = `${this.merchantKey}|${request.txnid}|${request.amount}|${request.productinfo}|${request.firstname}|${request.email}|${request.udf1 || ''}|${request.udf2 || ''}|${request.udf3 || ''}|${request.udf4 || ''}|${request.udf5 || ''}||||||${this.merchantSalt}`;
    return this.generateHash(hashString);
  }

  /**
   * Verify PayU connection
   */
  async verify(): Promise<boolean> {
    if (!this.httpService || !this.merchantKey || !this.merchantSalt) {
      return false;
    }

    try {
      return this.merchantKey.length > 0 && this.merchantSalt.length > 0;
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.WARN,
        'PayU verification failed',
        'PayUPaymentAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }

  /**
   * Create payment intent (payment request) via PayU
   */
  async createPaymentIntent(options: PaymentIntentOptions): Promise<PaymentResult> {
    if (!this.httpService) {
      return this.createErrorResult('PayU adapter not initialized');
    }

    try {
      this.validatePaymentIntentOptions(options);

      const orderId =
        options.orderId || `TXN_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      const baseUrl =
        (options.metadata?.['baseUrl'] as string) ||
        process.env['FRONTEND_URL'] ||
        'http://localhost:3000';

      const paymentRequest: PayUPaymentRequest = {
        key: this.merchantKey,
        txnid: orderId,
        amount: (options.amount / 100).toFixed(2), // Convert paise to INR
        productinfo: options.description || 'Healthcare Payment',
        firstname: options.customerName || 'Customer',
        email: options.customerEmail || '',
        surl: `${baseUrl}/payment/success`,
        furl: `${baseUrl}/payment/failure`,
        udf1: options.appointmentId || '',
        udf2: options.clinicId || '',
      };

      if (options.customerPhone) {
        paymentRequest.phone = options.customerPhone;
      }

      if (options.metadata?.['udf3']) {
        paymentRequest.udf3 = String(options.metadata['udf3']);
      }
      if (options.metadata?.['udf4']) {
        paymentRequest.udf4 = String(options.metadata['udf4']);
      }
      if (options.metadata?.['udf5']) {
        paymentRequest.udf5 = String(options.metadata['udf5']);
      }

      const hash = this.generatePaymentHash(paymentRequest);

      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'PayU payment intent created successfully',
        'PayUPaymentAdapter',
        {
          orderId,
          amount: options.amount,
          currency: options.currency,
          appointmentId: options.appointmentId,
        }
      );

      return {
        success: true,
        paymentId: orderId,
        amount: options.amount,
        currency: options.currency,
        status: 'pending',
        provider: this.getProviderName(),
        timestamp: new Date(),
        orderId,
        metadata: {
          merchantKey: this.merchantKey,
          hash,
          orderId,
          redirectUrl: `${this.baseUrl}/payments/payu/callback`,
        },
      };
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to create PayU payment intent',
        'PayUPaymentAdapter',
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
   * Verify payment status via PayU
   */
  async verifyPayment(options: PaymentStatusOptions): Promise<PaymentStatusResult> {
    if (!this.httpService) {
      throw new Error('PayU adapter not initialized');
    }

    try {
      const txnid = options.orderId || options.paymentId || '';
      if (!txnid) {
        throw new Error('Order ID or Payment ID is required');
      }

      const hashString = `${this.merchantSalt}|${txnid}`;
      const hash = this.generateHash(hashString);

      const response = await this.executeWithRetry(async () => {
        if (!this.httpService) {
          throw new Error('HTTP service not initialized');
        }
        return await this.httpService.post<PayUStatusResponse>(
          `${this.baseUrl}/merchant/postservice.php?command=order_status_detail&merchant_key=${this.merchantKey}`,
          {
            key: this.merchantKey,
            command: 'order_status_detail',
            var1: txnid,
            hash,
          },
          {
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );
      });

      if (response.data.status !== 1 || !response.data.data) {
        throw new Error(response.data.message || 'Failed to fetch payment status');
      }

      const paymentData = response.data.data;
      const status = paymentData.status?.toLowerCase() || '';

      let mappedStatus: PaymentStatusResult['status'];
      switch (status) {
        case 'success':
          mappedStatus = 'completed';
          break;
        case 'failure':
          mappedStatus = 'failed';
          break;
        default:
          mappedStatus = 'pending';
      }

      return {
        paymentId: txnid,
        status: mappedStatus,
        amount: paymentData.amount ? parseFloat(paymentData.amount) * 100 : 0,
        currency: 'INR',
        transactionId: paymentData.mihpayid ?? '',
        provider: this.getProviderName(),
        timestamp: new Date(),
        metadata: {
          status: paymentData.status,
          paymentSource: paymentData.payment_source,
        },
      };
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to verify PayU payment',
        'PayUPaymentAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
          paymentId: options.paymentId,
        }
      );
      throw error;
    }
  }

  /**
   * Process refund via PayU
   */
  async refund(options: RefundOptions): Promise<RefundResult> {
    if (!this.httpService) {
      return {
        success: false,
        paymentId: options.paymentId,
        amount: 0,
        status: 'failed',
        provider: this.getProviderName(),
        error: 'PayU adapter not initialized',
        timestamp: new Date(),
      };
    }

    try {
      this.validateRefundOptions(options);

      const refundAmount = options.amount ? (options.amount / 100).toFixed(2) : '0';
      const reason = options.reason || 'Refund';

      const hashString = `${this.merchantKey}|${this.merchantSalt}`;
      const hash = this.generateHash(hashString);

      const response = await this.executeWithRetry(async () => {
        if (!this.httpService) {
          throw new Error('HTTP service not initialized');
        }
        return await this.httpService.post<PayURefundResponse>(
          `${this.baseUrl}/merchant/postservice.php?command=refund`,
          {
            key: this.merchantKey,
            command: 'refund',
            var1: options.paymentId,
            var2: refundAmount,
            var3: reason,
            hash,
          },
          {
            headers: {
              'Content-Type': 'application/json',
            },
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
        'PayU refund processed successfully',
        'PayUPaymentAdapter',
        {
          refundId: refundData.refund_id,
          paymentId: options.paymentId,
          amount: refundAmount,
        }
      );

      return {
        success: refundData.unmappedstatus === 'success',
        refundId: refundData.refund_id || `REFUND_${Date.now()}`,
        paymentId: options.paymentId,
        amount: parseFloat(refundAmount) * 100,
        status: refundData.unmappedstatus === 'success' ? 'completed' : 'processing',
        provider: this.getProviderName(),
        timestamp: new Date(),
      };
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to process PayU refund',
        'PayUPaymentAdapter',
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
   * Verify webhook signature from PayU
   */
  async verifyWebhook(options: WebhookVerificationOptions): Promise<boolean> {
    try {
      const signature = options.signature;

      if (typeof options.payload === 'string') {
        const payload = JSON.parse(options.payload) as Record<string, unknown> | string;

        if (typeof payload === 'string') {
          const params = new URLSearchParams(payload);
          const dataToHash = `${this.merchantSalt}|${params.get('status') || ''}|${params.get('mihpayid') || ''}`;
          const expectedHash = this.generateHash(dataToHash);
          return signature === expectedHash;
        }

        const statusValue = typeof payload['status'] === 'string' ? payload['status'] : '';
        const mihpayidValue = typeof payload['mihpayid'] === 'string' ? payload['mihpayid'] : '';
        const dataToHash = `${this.merchantSalt}|${statusValue}|${mihpayidValue}`;
        const expectedHash = this.generateHash(dataToHash);
        return signature === expectedHash;
      } else {
        const payload = options.payload as Record<
          string,
          string | number | boolean | null | undefined
        >;
        const dataToHash = `${this.merchantSalt}|${String(payload['status'] ?? '')}|${String(payload['mihpayid'] ?? '')}`;
        const expectedHash = this.generateHash(dataToHash);
        return signature === expectedHash;
      }
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to verify PayU webhook',
        'PayUPaymentAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }
}
