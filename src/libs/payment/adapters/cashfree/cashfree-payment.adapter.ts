/**
 * Cashfree Payment Adapter
 * ========================
 * Cashfree payment provider adapter
 * Implements PaymentProviderAdapter interface
 *
 * @module CashfreePaymentAdapter
 * @description Cashfree payment adapter for multi-tenant payment processing.
 * Follows the same pattern as Redis/Dragonfly: single interface, config-driven provider.
 * API: https://docs.cashfree.com/reference/pg-new-apis-endpoint
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

// Cashfree PG API types (v2025-01-01)
interface CashfreeOrderRequest {
  order_amount: number; // Amount in currency unit (e.g. 100.50 for INR)
  order_currency: string;
  order_id?: string; // Optional; Cashfree generates if not provided
  customer_details: {
    customer_id: string;
    customer_phone: string;
    customer_email?: string;
    customer_name?: string;
  };
  order_meta?: {
    return_url?: string;
    notify_url?: string;
  };
  order_note?: string;
}

interface CashfreeOrderResponse {
  cf_order_id: number;
  order_id: string;
  entity: string;
  order_currency: string;
  order_amount: number;
  order_status: string;
  order_expiry_time: string;
  order_note?: string;
  created_at: string;
}

interface CashfreeOrderStatusResponse {
  cf_order_id: number;
  order_id: string;
  entity: string;
  order_currency: string;
  order_amount: number;
  order_status: string; // ACTIVE, PAID, EXPIRED
  order_payment_status?: string;
  order_expiry_time: string;
  created_at: string;
  order_splits?: unknown;
}

interface CashfreeRefundRequest {
  refund_amount: number; // Currency unit (required)
  refund_id: string;
  refund_note?: string;
  refund_speed?: 'STANDARD' | 'INSTANT';
}

interface CashfreeRefundResponse {
  cf_refund_id: number;
  refund_id: string;
  order_id: string;
  refund_amount: number;
  refund_status: string; // PENDING, SUCCESS, CANCELLED, ONHOLD
  refund_note?: string;
  created_at: string;
}

/**
 * Cashfree Payment Adapter
 * Handles payment processing via Cashfree PG API
 */
@Injectable()
export class CashfreePaymentAdapter extends BasePaymentAdapter {
  private httpService: HttpService | null = null;
  private appId: string = '';
  private secretKey: string = '';
  private baseUrl: string = 'https://sandbox.cashfree.com/pg';
  private apiVersion: string = '2025-01-01';

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
      throw new Error('Cashfree credentials are required');
    }

    const creds = config.credentials;
    if ('encrypted' in creds) {
      throw new Error('Cashfree credentials must be decrypted before use');
    }
    const credentials = creds;
    this.appId = credentials['appId'] || credentials['app_id'] || credentials['x_client_id'] || '';
    this.secretKey =
      credentials['secretKey'] || credentials['secret_key'] || credentials['x_client_secret'] || '';
    this.baseUrl =
      credentials['baseUrl'] ||
      credentials['base_url'] ||
      (credentials['environment'] === 'production'
        ? 'https://api.cashfree.com/pg'
        : 'https://sandbox.cashfree.com/pg');
    this.apiVersion = credentials['apiVersion'] || credentials['api_version'] || '2025-01-01';

    if (!this.appId || !this.secretKey) {
      throw new Error('Cashfree appId and secretKey are required');
    }
  }

  getProviderName(): string {
    return 'cashfree';
  }

  /**
   * Get auth headers for Cashfree API
   */
  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-version': this.apiVersion,
      'x-client-id': this.appId,
      'x-client-secret': this.secretKey,
      Accept: 'application/json',
    };
  }

  async verify(): Promise<boolean> {
    if (!this.httpService || !this.appId || !this.secretKey) {
      return false;
    }
    try {
      return this.appId.length > 0 && this.secretKey.length > 0;
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.WARN,
        'Cashfree verification failed',
        'CashfreePaymentAdapter',
        { error: error instanceof Error ? error.message : String(error) }
      );
      return false;
    }
  }

  /**
   * Create payment intent (order) via Cashfree
   * Amount in options is in smallest unit (paise); Cashfree expects order_amount in currency units (rupees).
   */
  async createPaymentIntent(options: PaymentIntentOptions): Promise<PaymentResult> {
    if (!this.httpService) {
      return this.createErrorResult('Cashfree adapter not initialized');
    }

    try {
      this.validatePaymentIntentOptions(options);

      // Cashfree expects amount in currency units (e.g. rupees), not paise
      const amountInUnits = options.amount / 100;
      const orderId =
        options.orderId || `order_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      const body: CashfreeOrderRequest = {
        order_amount: amountInUnits,
        order_currency: options.currency.toUpperCase(),
        order_id: orderId,
        customer_details: {
          customer_id: options.customerId || `cust_${Date.now()}`,
          customer_phone: options.customerPhone || '9999999999',
          ...(options.customerEmail && { customer_email: options.customerEmail }),
          ...(options.customerName && { customer_name: options.customerName }),
        },
        ...(options.metadata?.['returnUrl'] && {
          order_meta: {
            return_url: options.metadata['returnUrl'] as string,
            ...(options.metadata['notifyUrl'] && {
              notify_url: options.metadata['notifyUrl'] as string,
            }),
          },
        }),
        ...(options.description && { order_note: options.description }),
      };

      const response = await this.executeWithRetry(async () => {
        if (!this.httpService) throw new Error('HTTP service not initialized');
        return await this.httpService.post<CashfreeOrderResponse>(`${this.baseUrl}/orders`, body, {
          headers: this.getHeaders(),
        });
      });

      const data = response.data;
      if (!data?.order_id) {
        throw new Error('Invalid response from Cashfree create order');
      }

      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'Cashfree payment intent created successfully',
        'CashfreePaymentAdapter',
        {
          orderId: data.order_id,
          amount: options.amount,
          currency: options.currency,
          appointmentId: options.appointmentId,
        }
      );

      return this.createPendingResult(
        data.order_id,
        options.amount,
        options.currency,
        data.order_id
      );
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to create Cashfree payment intent',
        'CashfreePaymentAdapter',
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
   * Verify payment status via Cashfree (fetch order status)
   */
  async verifyPayment(options: PaymentStatusOptions): Promise<PaymentStatusResult> {
    if (!this.httpService) {
      throw new Error('Cashfree adapter not initialized');
    }

    try {
      const orderId = options.orderId || options.paymentId;
      if (!orderId) {
        throw new Error('Order ID or Payment ID is required');
      }

      const response = await this.executeWithRetry(async () => {
        if (!this.httpService) throw new Error('HTTP service not initialized');
        return await this.httpService.get<CashfreeOrderStatusResponse>(
          `${this.baseUrl}/orders/${orderId}`,
          { headers: this.getHeaders() }
        );
      });

      const data = response.data;
      if (!data) {
        throw new Error('Failed to fetch order status from Cashfree');
      }

      let status: PaymentStatusResult['status'];
      const orderStatus = (data.order_status || data.order_payment_status || '').toUpperCase();
      if (orderStatus === 'PAID' || orderStatus === 'SUCCESS') {
        status = 'completed';
      } else if (
        orderStatus === 'EXPIRED' ||
        orderStatus === 'FAILED' ||
        orderStatus === 'CANCELLED'
      ) {
        status = orderStatus === 'EXPIRED' ? 'cancelled' : 'failed';
      } else {
        status = 'pending';
      }

      const amountInPaise = Math.round((data.order_amount || 0) * 100);

      return {
        paymentId: data.order_id,
        status,
        amount: amountInPaise,
        currency: data.order_currency || 'INR',
        transactionId: data.order_id,
        provider: this.getProviderName(),
        timestamp: new Date(data.created_at || Date.now()),
        metadata: { order_status: data.order_status },
      };
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to verify Cashfree payment',
        'CashfreePaymentAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
          paymentId: options.paymentId,
        }
      );
      throw error;
    }
  }

  /**
   * Process refund via Cashfree
   * Endpoint: POST /orders/{order_id}/refunds
   */
  async refund(options: RefundOptions): Promise<RefundResult> {
    if (!this.httpService) {
      return {
        success: false,
        paymentId: options.paymentId,
        amount: 0,
        status: 'failed',
        provider: this.getProviderName(),
        error: 'Cashfree adapter not initialized',
        timestamp: new Date(),
      };
    }

    try {
      this.validateRefundOptions(options);

      const refundId = `refund_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      let refundAmountInUnits: number;
      if (options.amount !== undefined && options.amount > 0) {
        refundAmountInUnits = options.amount / 100;
      } else {
        // Full refund: fetch order to get order_amount
        const orderRes = await this.executeWithRetry(async () => {
          if (!this.httpService) throw new Error('HTTP service not initialized');
          return await this.httpService.get<CashfreeOrderStatusResponse>(
            `${this.baseUrl}/orders/${options.paymentId}`,
            { headers: this.getHeaders() }
          );
        });
        if (!orderRes.data?.order_amount) {
          throw new Error('Could not fetch order amount for full refund');
        }
        refundAmountInUnits = orderRes.data.order_amount;
      }

      const body: CashfreeRefundRequest = {
        refund_id: refundId,
        refund_amount: refundAmountInUnits,
        ...(options.reason && { refund_note: options.reason }),
      };

      const response = await this.executeWithRetry(async () => {
        if (!this.httpService) throw new Error('HTTP service not initialized');
        return await this.httpService.post<CashfreeRefundResponse>(
          `${this.baseUrl}/orders/${options.paymentId}/refunds`,
          body,
          { headers: this.getHeaders() }
        );
      });

      const data = response.data;
      if (!data) {
        throw new Error('Invalid refund response from Cashfree');
      }

      const success = data.refund_status === 'SUCCESS' || data.refund_status === 'PENDING';
      const amountRefunded = Math.round((data.refund_amount || 0) * 100);

      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'Cashfree refund processed successfully',
        'CashfreePaymentAdapter',
        {
          refundId: data.refund_id,
          paymentId: options.paymentId,
          amount: amountRefunded,
        }
      );

      return {
        success,
        refundId: data.refund_id,
        paymentId: options.paymentId,
        amount: amountRefunded,
        status: data.refund_status === 'SUCCESS' ? 'completed' : 'processing',
        provider: this.getProviderName(),
        timestamp: new Date(data.created_at || Date.now()),
      };
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to process Cashfree refund',
        'CashfreePaymentAdapter',
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
   * Verify webhook signature (x-cf-signature)
   * Cashfree signs payload with secret: HMAC or SHA256 of body.
   */
  async verifyWebhook(options: WebhookVerificationOptions): Promise<boolean> {
    try {
      const payloadStr =
        typeof options.payload === 'string' ? options.payload : JSON.stringify(options.payload);

      const expectedSignature = crypto
        .createHmac('sha256', this.secretKey)
        .update(payloadStr)
        .digest('base64');

      return crypto.timingSafeEqual(
        Buffer.from(options.signature, 'utf8'),
        Buffer.from(expectedSignature, 'utf8')
      );
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to verify Cashfree webhook',
        'CashfreePaymentAdapter',
        { error: error instanceof Error ? error.message : String(error) }
      );
      return false;
    }
  }
}
