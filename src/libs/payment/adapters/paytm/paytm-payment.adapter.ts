/**
 * Paytm Business Payment Adapter
 * ===============================
 * Paytm Business payment provider adapter
 * Implements PaymentProviderAdapter interface
 *
 * @module PaytmBusinessPaymentAdapter
 * @description Paytm Business payment adapter for multi-tenant payment processing
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

// Paytm Business API types
interface PaytmInitiateRequest {
  mid: string;
  orderId: string;
  txnAmount: {
    value: string;
    currency: string;
  };
  userInfo?: {
    custId?: string;
    mobile?: string;
    email?: string;
  };
  body?: {
    info?: {
      callbackUrl?: string;
      forwardFeature?: {
        type: string;
        value: number;
      };
    };
  };
  [key: string]: unknown;
}

interface PaytmInitiateResponse {
  body: {
    resultInfo: {
      resultCode: string;
      resultStatus: string;
      resultMsg?: string;
    };
    txnToken?: string;
    isPromoCodeValid?: string;
    bankForm?: Record<string, unknown>;
  };
  head: {
    responseTimestamp: string;
  };
}

interface PaytmStatusRequest {
  mid: string;
  orderId: string;
  [key: string]: unknown;
}

interface PaytmStatusResponse {
  body: {
    resultInfo: {
      resultCode: string;
      resultStatus: string;
      resultMsg?: string;
    };
    txnId?: string;
    orderId?: string;
    txnAmount?: string;
    status?: 'TXN_SUCCESS' | 'TXN_FAILURE' | 'PENDING';
    txnType?: string;
    gatewayName?: string;
    bankTxnId?: string;
  };
  head: {
    responseTimestamp: string;
  };
}

interface PaytmRefundRequest {
  mid: string;
  orderId: string;
  referenceId: string;
  txnId: string;
  refundAmount: string;
  [key: string]: unknown;
}

interface PaytmRefundResponse {
  body: {
    resultInfo: {
      resultCode: string;
      resultStatus: string;
      resultMsg?: string;
    };
    refundId?: string;
    txnId?: string;
    refundAmount?: string;
    status?: string;
  };
  head: {
    responseTimestamp: string;
  };
}

/**
 * Paytm Business Payment Adapter
 * Handles payment processing via Paytm Business API
 */
@Injectable()
export class PaytmBusinessPaymentAdapter extends BasePaymentAdapter {
  private httpService: HttpService | null = null;
  private merchantId: string = '';
  private merchantKey: string = '';
  private website: string = 'WEBSTAGING';
  private industryTypeId: string = 'Retail';
  private environment: 'staging' | 'production' = 'staging';
  private baseUrl: string = 'https://securegw-stage.paytm.in';
  private callbackUrl: string = '';

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
      throw new Error('Paytm Business credentials are required');
    }

    const credentials = config.credentials as Record<string, string>;
    this.merchantId = credentials['merchantId'] || credentials['merchant_id'] || '';
    this.merchantKey = credentials['merchantKey'] || credentials['merchant_key'] || '';
    this.website = credentials['website'] || 'WEBSTAGING';
    this.industryTypeId =
      credentials['industryTypeId'] || credentials['industry_type_id'] || 'Retail';
    this.environment = (credentials['environment'] || 'staging') as 'staging' | 'production';
    this.callbackUrl = credentials['callbackUrl'] || credentials['callback_url'] || '';

    this.baseUrl =
      this.environment === 'production'
        ? 'https://securegw.paytm.in'
        : 'https://securegw-stage.paytm.in';

    if (!this.merchantId || !this.merchantKey) {
      throw new Error('Paytm Business merchantId and merchantKey are required');
    }
  }

  /**
   * Get provider name
   */
  getProviderName(): string {
    return 'paytm';
  }

  /**
   * Generate checksum for Paytm API
   */
  private generateChecksum(body: Record<string, unknown>, merchantKey: string): string {
    const data = Buffer.from(JSON.stringify(body), 'utf-8').toString('base64');
    const checksum = crypto.createHmac('sha256', merchantKey).update(data).digest('base64');
    return checksum;
  }

  /**
   * Verify checksum from Paytm response
   */
  private verifyChecksum(
    body: Record<string, unknown>,
    checksum: string,
    merchantKey: string
  ): boolean {
    const calculatedChecksum = this.generateChecksum(body, merchantKey);
    return calculatedChecksum === checksum;
  }

  /**
   * Verify Paytm connection
   */
  async verify(): Promise<boolean> {
    if (!this.httpService || !this.merchantId || !this.merchantKey) {
      return false;
    }

    try {
      // Check basic configuration
      return this.merchantId.length > 0 && this.merchantKey.length > 0;
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.WARN,
        'Paytm Business verification failed',
        'PaytmBusinessPaymentAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }

  /**
   * Create payment intent (initiate transaction) via Paytm Business
   */
  async createPaymentIntent(options: PaymentIntentOptions): Promise<PaymentResult> {
    if (!this.httpService) {
      return this.createErrorResult('Paytm Business adapter not initialized');
    }

    try {
      // Validate options
      this.validatePaymentIntentOptions(options);

      // Generate unique order ID
      const orderId =
        options.orderId || `TXN_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      // Build webhook URL with clinicId (matches Cashfree pattern)
      const baseUrl =
        (options.metadata?.['baseUrl'] as string) ||
        process.env['API_URL'] ||
        process.env['BASE_URL'] ||
        'http://localhost:8088';
      const clinicId = options.clinicId || (options.metadata?.['clinicId'] as string) || '';
      const callbackUrl = clinicId
        ? `${baseUrl}/payments/paytm/webhook?clinicId=${encodeURIComponent(clinicId)}`
        : `${baseUrl}/payments/paytm/webhook`;

      // Build userInfo object
      const userInfo: PaytmInitiateRequest['userInfo'] = {
        ...(options.customerId && { custId: options.customerId }),
        ...(options.customerPhone && { mobile: options.customerPhone }),
        ...(options.customerEmail && { email: options.customerEmail }),
      };

      // Create payment request
      const paymentRequest: PaytmInitiateRequest = {
        mid: this.merchantId,
        orderId,
        txnAmount: {
          value: (options.amount / 100).toFixed(2), // Convert paise to INR (₹1 = 100 paise)
          currency: options.currency.toUpperCase(),
        },
        ...(Object.keys(userInfo).length > 0 && { userInfo }),
        body: {
          info: {
            callbackUrl,
            forwardFeature: {
              type: 'LINK',
              value: 1,
            },
          },
        },
      };

      // Generate checksum
      const checksum = this.generateChecksum(paymentRequest, this.merchantKey);

      // Make API call with retry
      const response = await this.executeWithRetry(async () => {
        if (!this.httpService) {
          throw new Error('HTTP service not initialized');
        }
        return await this.httpService.post<PaytmInitiateResponse>(
          `${this.baseUrl}/theia/api/v1/initiateTransaction?mid=${this.merchantId}&orderId=${orderId}`,
          {
            body: Buffer.from(JSON.stringify(paymentRequest), 'utf-8').toString('base64'),
            head: {
              signature: checksum,
            },
          }
        );
      });

      if (response.data.body.resultInfo.resultStatus !== 'TXN_SUCCESS') {
        throw new Error(response.data.body.resultInfo.resultMsg || 'Failed to initiate payment');
      }

      const txnToken = response.data.body.txnToken;
      const paymentLink = `${this.baseUrl}/theia/api/v1/showPaymentPage?mid=${this.merchantId}&orderId=${orderId}&txnToken=${txnToken}`;

      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'Paytm Business payment intent created successfully',
        'PaytmBusinessPaymentAdapter',
        {
          orderId,
          amount: options.amount,
          currency: options.currency,
          appointmentId: options.appointmentId,
        }
      );

      // Return pending result with redirect URL in metadata
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
          redirectUrl: paymentLink,
          txnToken,
          orderId,
        },
      };
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to create Paytm Business payment intent',
        'PaytmBusinessPaymentAdapter',
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
   * Verify payment status via Paytm Business
   */
  async verifyPayment(options: PaymentStatusOptions): Promise<PaymentStatusResult> {
    if (!this.httpService) {
      throw new Error('Paytm Business adapter not initialized');
    }

    try {
      const orderId = options.orderId || options.paymentId || '';
      if (!orderId) {
        throw new Error('Order ID is required');
      }

      // Create status request
      const statusRequest: PaytmStatusRequest = {
        mid: this.merchantId,
        orderId,
      };

      // Generate checksum
      const checksum = this.generateChecksum(statusRequest, this.merchantKey);

      // Fetch payment status from Paytm
      const response = await this.executeWithRetry(async () => {
        if (!this.httpService) {
          throw new Error('HTTP service not initialized');
        }
        return await this.httpService.post<PaytmStatusResponse>(`${this.baseUrl}/v3/order/status`, {
          body: Buffer.from(JSON.stringify(statusRequest), 'utf-8').toString('base64'),
          head: {
            signature: checksum,
          },
        });
      });

      if (response.data.body.resultInfo.resultStatus === 'TXN_FAILURE') {
        throw new Error(
          response.data.body.resultInfo.resultMsg || 'Failed to fetch payment status'
        );
      }

      const paymentData = response.data.body;

      // Map Paytm status to our status
      let status: PaymentStatusResult['status'];
      switch (paymentData.status) {
        case 'TXN_SUCCESS':
          status = 'completed';
          break;
        case 'TXN_FAILURE':
          status = 'failed';
          break;
        default:
          status = 'pending';
      }

      return {
        paymentId: orderId,
        status,
        amount: paymentData.txnAmount ? parseFloat(paymentData.txnAmount) * 100 : 0, // Convert from INR to paise
        currency: 'INR',
        transactionId: paymentData.txnId ?? '',
        provider: this.getProviderName(),
        timestamp: new Date(),
        metadata: {
          gatewayName: paymentData.gatewayName,
          bankTxnId: paymentData.bankTxnId,
          status: paymentData.status,
        },
      };
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to verify Paytm Business payment',
        'PaytmBusinessPaymentAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
          paymentId: options.paymentId,
        }
      );
      throw error;
    }
  }

  /**
   * Process refund via Paytm Business
   */
  async refund(options: RefundOptions): Promise<RefundResult> {
    if (!this.httpService) {
      return {
        success: false,
        paymentId: options.paymentId,
        amount: 0,
        status: 'failed',
        provider: this.getProviderName(),
        error: 'Paytm Business adapter not initialized',
        timestamp: new Date(),
      };
    }

    try {
      // Validate options
      this.validateRefundOptions(options);

      // Generate unique reference ID for refund
      const referenceId = `REFUND_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      // Create refund request
      const refundRequest: PaytmRefundRequest = {
        mid: this.merchantId,
        orderId: options.paymentId,
        referenceId,
        txnId: options.paymentId,
        refundAmount: ((options.amount ?? 0) / 100).toFixed(2), // Convert paise to INR
      };

      // Generate checksum
      const checksum = this.generateChecksum(refundRequest, this.merchantKey);

      // Make API call with retry
      const response = await this.executeWithRetry(async () => {
        if (!this.httpService) {
          throw new Error('HTTP service not initialized');
        }
        return await this.httpService.post<PaytmRefundResponse>(`${this.baseUrl}/v3/refund`, {
          body: Buffer.from(JSON.stringify(refundRequest), 'utf-8').toString('base64'),
          head: {
            signature: checksum,
          },
        });
      });

      if (response.data.body.resultInfo.resultStatus === 'TXN_FAILURE') {
        throw new Error(response.data.body.resultInfo.resultMsg || 'Failed to process refund');
      }

      const refundData = response.data.body;

      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'Paytm Business refund processed successfully',
        'PaytmBusinessPaymentAdapter',
        {
          refundId: refundData.refundId || referenceId,
          paymentId: options.paymentId,
          amount: refundData.refundAmount,
        }
      );

      return {
        success: response.data.body.resultInfo.resultStatus === 'TXN_SUCCESS',
        refundId: refundData.refundId || referenceId,
        paymentId: options.paymentId,
        amount: refundData.refundAmount ? parseFloat(refundData.refundAmount) * 100 : 0, // Convert from INR to paise
        status:
          response.data.body.resultInfo.resultStatus === 'TXN_SUCCESS' ? 'completed' : 'processing',
        provider: this.getProviderName(),
        timestamp: new Date(),
      };
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to process Paytm Business refund',
        'PaytmBusinessPaymentAdapter',
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
   * Verify webhook signature from Paytm Business
   */
  async verifyWebhook(options: WebhookVerificationOptions): Promise<boolean> {
    try {
      // Paytm Business webhook verification
      // The payload contains checksum in the headers
      const signature = options.signature;

      if (typeof options.payload === 'string') {
        const payload = JSON.parse(options.payload) as Record<string, unknown>;

        // Verify checksum
        const isValid = this.verifyChecksum(payload, signature, this.merchantKey);

        if (!isValid) {
          await this.logger.log(
            LogType.PAYMENT,
            LogLevel.WARN,
            'Invalid Paytm Business webhook checksum',
            'PaytmBusinessPaymentAdapter',
            {
              orderId: payload['orderId'],
              status: payload['status'],
            }
          );
        }

        return isValid;
      } else {
        const payload = options.payload;

        // Verify checksum
        const isValid = this.verifyChecksum(
          payload as Record<string, unknown>,
          signature,
          this.merchantKey
        );

        if (!isValid) {
          await this.logger.log(
            LogType.PAYMENT,
            LogLevel.WARN,
            'Invalid Paytm Business webhook checksum',
            'PaytmBusinessPaymentAdapter',
            {
              orderId: payload['orderId'],
              status: payload['status'],
            }
          );
        }

        return isValid;
      }
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to verify Paytm Business webhook',
        'PaytmBusinessPaymentAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }
}
