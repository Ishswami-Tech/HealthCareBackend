/**
 * Zoho Payments Adapter
 * =====================
 * Zoho Payments adapter for hosted checkout and webhook verification
 *
 * @module ZohoPaymentAdapter
 * @description Zoho Payments adapter for multi-tenant payment processing
 */

import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
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

type ZohoWebhookSignature = {
  t?: string;
  v?: string;
};

type ZohoPaymentsSession = {
  access_key?: string;
  payments_session_id?: string;
  amount?: string;
  currency?: string;
  payment_session_status?: string;
  payment_status?: string;
  payment_id?: string;
  status?: string;
  configurations?: Record<string, unknown>;
  meta_data?: unknown[];
};

type ZohoSessionCreateResponse = {
  code?: number;
  message?: string;
  payments_session?: ZohoPaymentsSession;
  payments_session_id?: string;
  access_key?: string;
};

type ZohoSessionRetrieveResponse = {
  code?: number;
  message?: string;
  payments_session?: ZohoPaymentsSession;
  payments_session_id?: string;
  payment_id?: string;
  payment_status?: string;
  payment_session_status?: string;
  amount?: string;
  currency?: string;
};

type ZohoPaymentRetrieveResponse = {
  code?: number;
  message?: string;
  payment?: {
    payment_id?: string;
    status?: string;
    amount?: string;
    currency?: string;
    transaction_id?: string;
  };
  payment_id?: string;
  status?: string;
  amount?: string;
  currency?: string;
  transaction_id?: string;
};

type ZohoRefundCreateResponse = {
  code?: number;
  message?: string;
  refund?: {
    refund_id?: string;
    status?: string;
    amount?: string;
    payment_id?: string;
  };
  refund_id?: string;
  status?: string;
  amount?: string;
  payment_id?: string;
};

type PaymentReferenceMetadata = {
  invoiceId?: string;
  prescriptionId?: string;
  clinicId?: string;
  appointmentId?: string;
  subscriptionId?: string;
};

@Injectable()
export class ZohoPaymentAdapter extends BasePaymentAdapter {
  private httpService: HttpService | null = null;
  private accountId = '';
  private accessToken = '';
  private authType = 'Zoho-oauthtoken';
  private signingKey = '';
  private apiBaseUrl = 'https://payments.zoho.com';

  constructor(loggingService: LoggingService, httpService: HttpService) {
    super(loggingService);
    this.httpService = httpService;
  }

  initialize(config: PaymentProviderConfig): void {
    this.config = config;

    if (!config.credentials || typeof config.credentials !== 'object') {
      throw new Error('Zoho Payments credentials are required');
    }

    const credentials = config.credentials as Record<string, string>;
    this.accountId = credentials['accountId'] || credentials['account_id'] || '';
    this.accessToken = credentials['accessToken'] || credentials['access_token'] || '';
    this.authType = credentials['authType'] || credentials['auth_type'] || 'Zoho-oauthtoken';
    this.signingKey = credentials['signingKey'] || credentials['signing_key'] || '';
    this.apiBaseUrl = (
      credentials['baseUrl'] ||
      credentials['base_url'] ||
      this.apiBaseUrl
    ).replace(/\/+$/u, '');

    if (!this.accountId || !this.accessToken) {
      throw new Error('Zoho Payments accountId and accessToken are required');
    }
  }

  getProviderName(): string {
    return 'zoho';
  }

  verify(): Promise<boolean> {
    return Promise.resolve(Boolean(this.accountId && this.accessToken && this.apiBaseUrl));
  }

  private buildApiUrl(path: string): string {
    return new URL(path, `${this.apiBaseUrl}/`).toString();
  }

  private getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `${this.authType.trim()} ${this.accessToken.trim()}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private toZohoAmount(amountMinorUnits: number): string {
    return (Math.round(amountMinorUnits) / 100).toFixed(2);
  }

  private toMinorUnits(value: unknown): number {
    const numericValue = typeof value === 'string' ? Number(value) : Number(value ?? 0);
    if (!Number.isFinite(numericValue)) {
      return 0;
    }
    return Math.round(numericValue * 100);
  }

  private getMetadataValue(options: PaymentIntentOptions, key: string): string {
    const value = options.metadata?.[key];
    return typeof value === 'string' ? value : '';
  }

  private getReferenceMetadata(options: PaymentIntentOptions): PaymentReferenceMetadata {
    return {
      clinicId: this.getMetadataValue(options, 'clinicId'),
      appointmentId: this.getMetadataValue(options, 'appointmentId'),
      subscriptionId: this.getMetadataValue(options, 'subscriptionId'),
      invoiceId: this.getMetadataValue(options, 'invoiceId'),
      prescriptionId: this.getMetadataValue(options, 'prescriptionId'),
    };
  }

  private buildFallbackCallbackUrl(options: PaymentIntentOptions): string {
    const configuredBase =
      this.getMetadataValue(options, 'redirectUrl') ||
      this.getMetadataValue(options, 'callbackUrl') ||
      process.env['PAYMENT_RETURN_BASE_URL'] ||
      process.env['PAYMENT_SITE_URL'] ||
      process.env['FRONTEND_URL'] ||
      process.env['NEXT_PUBLIC_APP_URL'] ||
      'http://localhost:3000';

    const normalizedBase = configuredBase.replace(/\/+$/u, '');
    const callbackUrl = new URL(`${normalizedBase}/payment/callback`);
    const clinicId = options.clinicId || this.getMetadataValue(options, 'clinicId');
    const provider = this.getProviderName();
    const referenceMetadata = this.getReferenceMetadata(options);

    if (clinicId) {
      callbackUrl.searchParams.set('clinicId', clinicId);
    }
    callbackUrl.searchParams.set('provider', provider);

    const orderId =
      options.orderId ||
      this.getMetadataValue(options, 'orderId') ||
      options.subscriptionId ||
      referenceMetadata.invoiceId ||
      referenceMetadata.prescriptionId ||
      options.appointmentId ||
      '';
    if (orderId) {
      callbackUrl.searchParams.set('orderId', orderId);
    }

    if (options.appointmentId) {
      callbackUrl.searchParams.set('appointmentId', options.appointmentId);
    }
    if (options.appointmentType) {
      callbackUrl.searchParams.set('appointmentType', options.appointmentType);
    }

    return callbackUrl.toString();
  }

  private buildHostedCheckoutUrl(accessKey: string): string {
    return `${this.apiBaseUrl}/hostedcheckout/${accessKey}`;
  }

  private buildCheckoutPayload(options: PaymentIntentOptions): Record<string, unknown> {
    const redirectUrl =
      this.getMetadataValue(options, 'redirectUrl') || this.buildFallbackCallbackUrl(options);
    const referenceMetadata = this.getReferenceMetadata(options);
    const hostedCheckoutParameters: Record<string, unknown> = {
      success_url: redirectUrl,
      failure_url: redirectUrl,
    };

    if (options.customerPhone) {
      hostedCheckoutParameters['phone'] = options.customerPhone;
    }
    if (options.customerEmail) {
      hostedCheckoutParameters['email'] = options.customerEmail;
    }
    if (options.description) {
      hostedCheckoutParameters['description'] = options.description;
    }

    const udfValues = [
      options.clinicId || this.getMetadataValue(options, 'clinicId'),
      options.appointmentId || this.getMetadataValue(options, 'appointmentId'),
      options.subscriptionId || this.getMetadataValue(options, 'subscriptionId'),
      referenceMetadata.invoiceId,
      referenceMetadata.prescriptionId,
    ];
    udfValues.forEach((value, index) => {
      if (value) {
        hostedCheckoutParameters[`udf${index + 1}`] = value;
      }
    });

    const payload: Record<string, unknown> = {
      amount: this.toZohoAmount(options.amount),
      currency: options.currency.toUpperCase(),
      configurations: {
        hosted_checkout_parameters: hostedCheckoutParameters,
      },
    };

    const allowedPaymentMethods = options.metadata?.['allowedPaymentMethods'];
    if (Array.isArray(allowedPaymentMethods) && allowedPaymentMethods.length > 0) {
      payload['configurations'] = {
        ...(payload['configurations'] as Record<string, unknown>),
        allowed_payment_methods: allowedPaymentMethods.filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0
        ),
      };
    }

    return payload;
  }

  async createPaymentIntent(options: PaymentIntentOptions): Promise<PaymentResult> {
    try {
      this.validatePaymentIntentOptions(options);

      const requestBody = this.buildCheckoutPayload(options);
      const httpService = this.httpService;
      const response = await this.executeWithRetry(async () => {
        if (!httpService) {
          throw new Error('Zoho Payments adapter not initialized');
        }

        return await httpService.post<ZohoSessionCreateResponse>(
          this.buildApiUrl(
            `/api/v1/paymentsessions?account_id=${encodeURIComponent(this.accountId)}`
          ),
          requestBody,
          {
            headers: this.getAuthHeaders(),
            bulkheadKey: `zoho:${this.accountId}`,
          }
        );
      });

      const session = response.data.payments_session || {};
      const accessKey = session.access_key || response.data.access_key || '';
      const paymentSessionId =
        session.payments_session_id || response.data.payments_session_id || '';

      if (!accessKey || !paymentSessionId) {
        throw new Error('Zoho Payments did not return a payment session');
      }

      const checkoutUrl = this.buildHostedCheckoutUrl(accessKey);
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'Zoho Payments payment session created successfully',
        'ZohoPaymentAdapter',
        {
          paymentSessionId,
          accessKey,
          amount: options.amount,
          currency: options.currency,
        }
      );

      return {
        success: true,
        paymentId: paymentSessionId,
        orderId: options.orderId || paymentSessionId,
        amount: options.amount,
        currency: options.currency,
        status: 'pending',
        provider: this.getProviderName(),
        timestamp: new Date(),
        metadata: {
          paymentSessionId,
          accessKey,
          redirectUrl: checkoutUrl,
          gatewayRedirectUrl: checkoutUrl,
          paymentLink: checkoutUrl,
          callbackUrl:
            this.getMetadataValue(options, 'redirectUrl') || this.buildFallbackCallbackUrl(options),
        },
        providerResponse: response.data,
      };
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to create Zoho Payments payment intent',
        'ZohoPaymentAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
          amount: options.amount,
          currency: options.currency,
        }
      );

      return this.createErrorResult(error instanceof Error ? error : String(error));
    }
  }

  async verifyPayment(options: PaymentStatusOptions): Promise<PaymentStatusResult> {
    try {
      if (!this.httpService) {
        throw new Error('Zoho Payments adapter not initialized');
      }

      const sessionCandidates = Array.from(
        new Set(
          [options.orderId, options.paymentId].filter((value): value is string => Boolean(value))
        )
      );
      if (sessionCandidates.length === 0) {
        throw new Error('Order ID or Payment ID is required');
      }

      let sessionResponse: { data: ZohoSessionRetrieveResponse } | null = null;
      let sessionIdUsed = '';
      for (const sessionId of sessionCandidates) {
        try {
          sessionResponse = await this.executeWithRetry(async () => {
            return await this.httpService!.get<ZohoSessionRetrieveResponse>(
              this.buildApiUrl(
                `/api/v1/paymentsessions/${encodeURIComponent(sessionId)}?account_id=${encodeURIComponent(this.accountId)}`
              ),
              {
                headers: this.getAuthHeaders(),
                bulkheadKey: `zoho:${this.accountId}`,
              }
            );
          });
          sessionIdUsed = sessionId;
          break;
        } catch {
          sessionResponse = null;
        }
      }

      if (!sessionResponse) {
        throw new Error('Unable to retrieve Zoho payment session');
      }

      const session = sessionResponse.data.payments_session || {};
      let statusText =
        session.payment_session_status ||
        session.payment_status ||
        session.status ||
        sessionResponse.data.payment_session_status ||
        sessionResponse.data.payment_status ||
        '';
      let paymentId =
        session.payment_id ||
        sessionResponse.data.payment_id ||
        options.paymentId ||
        sessionResponse.data.payments_session_id ||
        sessionIdUsed;
      const amountMinor = this.toMinorUnits(session.amount || sessionResponse.data.amount || 0);
      const currency = (session.currency || sessionResponse.data.currency || 'INR').toUpperCase();

      if (!statusText || /not_found|error/i.test(statusText)) {
        const paymentCandidates = Array.from(
          new Set(
            [options.paymentId, options.orderId].filter((value): value is string => Boolean(value))
          )
        );
        let paymentResponse: { data: ZohoPaymentRetrieveResponse } | null = null;
        for (const paymentIdCandidate of paymentCandidates) {
          try {
            paymentResponse = await this.executeWithRetry(async () => {
              return await this.httpService!.get<ZohoPaymentRetrieveResponse>(
                this.buildApiUrl(
                  `/api/v1/payments/${encodeURIComponent(paymentIdCandidate)}?account_id=${encodeURIComponent(this.accountId)}`
                ),
                {
                  headers: this.getAuthHeaders(),
                  bulkheadKey: `zoho:${this.accountId}`,
                }
              );
            });
            paymentId = paymentIdCandidate;
            break;
          } catch {
            paymentResponse = null;
          }
        }

        if (!paymentResponse) {
          throw new Error('Unable to retrieve Zoho payment details');
        }

        const payment = paymentResponse.data.payment || {};
        statusText = payment.status || paymentResponse.data.status || statusText;
        paymentId = payment.payment_id || paymentResponse.data.payment_id || paymentId;
        const amountSource = payment.amount || paymentResponse.data.amount || amountMinor;
        const currencySource = payment.currency || paymentResponse.data.currency || currency;

        return {
          paymentId,
          status: this.mapStatus(statusText),
          amount: this.toMinorUnits(amountSource),
          currency: String(currencySource || 'INR').toUpperCase(),
          ...(payment.transaction_id ? { transactionId: payment.transaction_id } : {}),
          provider: this.getProviderName(),
          timestamp: new Date(),
          metadata: {
            paymentSessionId: sessionIdUsed,
            paymentStatus: statusText,
            session: session,
            payment: payment,
          },
        };
      }

      return {
        paymentId,
        status: this.mapStatus(statusText),
        amount: amountMinor,
        currency,
        ...(session.payment_id ? { transactionId: session.payment_id } : {}),
        provider: this.getProviderName(),
        timestamp: new Date(),
        metadata: {
          paymentSessionId: sessionIdUsed,
          paymentStatus: statusText,
          session,
        },
      };
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to verify Zoho Payments payment',
        'ZohoPaymentAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
          paymentId: options.paymentId,
          orderId: options.orderId,
        }
      );
      throw error;
    }
  }

  private mapStatus(status?: string): PaymentStatusResult['status'] {
    const normalized = String(status || '')
      .trim()
      .toLowerCase();
    if (normalized === 'succeeded' || normalized === 'success' || normalized === 'paid') {
      return 'completed';
    }
    if (normalized === 'failed' || normalized === 'cancelled' || normalized === 'canceled') {
      return 'failed';
    }
    if (normalized === 'refunded') {
      return 'refunded';
    }
    return 'pending';
  }

  async refund(options: RefundOptions): Promise<RefundResult> {
    try {
      this.validateRefundOptions(options);

      const httpService = this.httpService;
      if (!this.httpService) {
        return {
          success: false,
          paymentId: options.paymentId,
          amount: 0,
          status: 'failed',
          provider: this.getProviderName(),
          error: 'Zoho Payments adapter not initialized',
          timestamp: new Date(),
        };
      }

      const refundAmount = options.amount ? this.toZohoAmount(options.amount) : undefined;
      const response = await this.executeWithRetry(async () => {
        if (!httpService) {
          throw new Error('Zoho Payments adapter not initialized');
        }

        return await httpService.post<ZohoRefundCreateResponse>(
          this.buildApiUrl(`/api/v1/refunds?account_id=${encodeURIComponent(this.accountId)}`),
          {
            payment_id: options.paymentId,
            ...(refundAmount ? { amount: refundAmount } : {}),
            ...(options.reason ? { reason: options.reason } : {}),
          },
          {
            headers: this.getAuthHeaders(),
            bulkheadKey: `zoho:${this.accountId}`,
          }
        );
      });

      const refund = response.data.refund || {};
      const refundId = refund.refund_id || response.data.refund_id || '';

      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'Zoho Payments refund created successfully',
        'ZohoPaymentAdapter',
        {
          refundId,
          paymentId: options.paymentId,
          amount: options.amount,
        }
      );

      return {
        success: true,
        ...(refundId ? { refundId } : {}),
        paymentId: options.paymentId,
        amount: options.amount || 0,
        status: 'processing',
        provider: this.getProviderName(),
        timestamp: new Date(),
        providerResponse: response.data,
      };
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to process Zoho Payments refund',
        'ZohoPaymentAdapter',
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

  async verifyWebhook(options: WebhookVerificationOptions): Promise<boolean> {
    try {
      if (!this.signingKey) {
        return false;
      }

      const parsed = this.parseWebhookSignature(options.signature);
      if (typeof options.payload === 'string') {
        const payload = options.payload;
        if (parsed) {
          const signatureTimestamp = parsed.t ?? '';
          const signatureValue = parsed.v ?? '';
          if (!signatureTimestamp || !signatureValue) {
            return false;
          }
          const message = `${signatureTimestamp}.${payload}`;
          const calculated = this.sign(message);
          return this.timingSafeEqual(signatureValue, calculated);
        }

        return this.timingSafeEqual(this.sign(payload), String(options.signature || '').trim());
      }

      const payload = JSON.stringify(options.payload);
      if (parsed) {
        const signatureTimestamp = parsed.t ?? '';
        const signatureValue = parsed.v ?? '';
        if (!signatureTimestamp || !signatureValue) {
          return false;
        }
        const message = `${signatureTimestamp}.${payload}`;
        const calculated = this.sign(message);
        return this.timingSafeEqual(signatureValue, calculated);
      }

      return this.timingSafeEqual(this.sign(payload), String(options.signature || '').trim());
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to verify Zoho Payments webhook',
        'ZohoPaymentAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }

  private parseWebhookSignature(signature: string): ZohoWebhookSignature | null {
    const raw = String(signature || '').trim();
    if (!raw.includes('t=') || !raw.includes('v=')) {
      return null;
    }

    const pairs = raw.split(',').map(part => part.trim());
    const result: ZohoWebhookSignature = {};
    for (const pair of pairs) {
      const [key, value] = pair.split('=');
      if (!key || typeof value !== 'string') {
        continue;
      }
      if (key === 't') {
        result.t = value.trim();
      } else if (key === 'v') {
        result.v = value.trim();
      }
    }

    return result.t && result.v ? result : null;
  }

  private sign(message: string): string {
    return createHmac('sha256', this.signingKey).update(message).digest('hex');
  }

  private timingSafeEqual(left: string, right: string): boolean {
    const normalizedLeft = left.trim().toLowerCase();
    const normalizedRight = right.trim().toLowerCase();

    if (normalizedLeft.length !== normalizedRight.length) {
      return false;
    }

    return timingSafeEqual(
      Buffer.from(normalizedLeft, 'utf8'),
      Buffer.from(normalizedRight, 'utf8')
    );
  }

  async getRefundStatus(refundId: string): Promise<RefundResult> {
    try {
      const httpService = this.httpService;
      if (!httpService) {
        throw new Error('Zoho Payments adapter not initialized');
      }

      const response = await this.executeWithRetry(async () => {
        return await httpService.get<{
          refund?: { refund_id?: string; status?: string; amount?: string; payment_id?: string };
          refund_id?: string;
          status?: string;
          amount?: string;
          payment_id?: string;
        }>(
          this.buildApiUrl(
            `/api/v1/refunds/${encodeURIComponent(refundId)}?account_id=${encodeURIComponent(this.accountId)}`
          ),
          {
            headers: this.getAuthHeaders(),
            bulkheadKey: `zoho:${this.accountId}`,
          }
        );
      });

      const responseData = response?.data;
      if (!responseData) {
        throw new Error('Zoho refund status response was empty');
      }

      const refund = responseData.refund || {};
      const status = String(refund.status || responseData.status || '').toLowerCase();
      return {
        success: status === 'processing' || status === 'succeeded' || status === 'completed',
        refundId: refund.refund_id || responseData.refund_id || refundId,
        paymentId: refund.payment_id || responseData.payment_id || '',
        amount: this.toMinorUnits(refund.amount || responseData.amount || 0),
        status:
          status === 'succeeded' || status === 'completed'
            ? 'completed'
            : status === 'failed'
              ? 'failed'
              : 'processing',
        provider: this.getProviderName(),
        timestamp: new Date(),
        providerResponse: responseData,
      };
    } catch (error) {
      await this.logger.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        'Failed to fetch Zoho Payments refund status',
        'ZohoPaymentAdapter',
        {
          error: error instanceof Error ? error.message : String(error),
          refundId,
        }
      );
      throw error;
    }
  }
}
