/**
 * Payment Controller
 * ==================
 * Handles payment webhooks and callbacks
 *
 * @module PaymentController
 * @description Payment webhook and callback endpoints
 */

import {
  Controller,
  Post,
  Body,
  Headers,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
  UnauthorizedException,
  Req,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { DatabaseService } from '@infrastructure/database';
import { PaymentService } from './payment.service';
import { PaymentHandoffTokenService } from './payment.handoff-token.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel, PaymentProvider } from '@core/types';
import { Public } from '@core/decorators/public.decorator';
import type { FastifyRequest } from 'fastify';

type BillingServiceLike = {
  handlePaymentCallback: (
    clinicId: string,
    paymentId: string,
    orderId: string,
    provider?: PaymentProvider
  ) => Promise<unknown>;
  handleRefundCallback: (
    clinicId: string,
    paymentId: string,
    refundId: string,
    orderId?: string,
    provider?: PaymentProvider,
    callbackState?: string,
    callbackAmount?: number
  ) => Promise<unknown>;
};

@ApiTags('payments')
@Controller('payments')
export class PaymentController {
  private billingServiceRef: BillingServiceLike | null = null;
  private readonly supportedProviders = new Set<string>(
    Object.values(PaymentProvider).map(value => value.trim().toLowerCase())
  );

  constructor(
    private readonly paymentService: PaymentService,
    private readonly handoffTokenService: PaymentHandoffTokenService,
    private readonly databaseService: DatabaseService,
    private readonly moduleRef: ModuleRef,
    private readonly loggingService: LoggingService
  ) {}

  private getBillingService(): BillingServiceLike {
    if (!this.billingServiceRef) {
      this.billingServiceRef = this.moduleRef.get<BillingServiceLike>('BILLING_SERVICE', {
        strict: false,
      });
    }
    if (!this.billingServiceRef) {
      throw new Error('BILLING_SERVICE is not available');
    }
    return this.billingServiceRef;
  }

  private parsePaymentProvider(provider?: string): PaymentProvider | undefined {
    if (!provider) {
      return undefined;
    }

    const normalizedProvider = provider.trim().toLowerCase();
    if (!this.supportedProviders.has(normalizedProvider)) {
      throw new BadRequestException(
        `Payment provider '${provider}' is not supported. Supported providers: ${Array.from(
          this.supportedProviders
        ).join(', ')}`
      );
    }

    return normalizedProvider as PaymentProvider;
  }

  private isProviderEnabled(provider: PaymentProvider): boolean {
    return this.supportedProviders.has(provider);
  }

  private getRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private getStringAtPath(source: unknown, path: string[]): string {
    let current: unknown = source;
    for (const segment of path) {
      const record = this.getRecord(current);
      if (!record) {
        return '';
      }
      current = record[segment];
    }

    return typeof current === 'string' ? current : '';
  }

  private getFirstStringAtPath(source: unknown, paths: string[][]): string {
    for (const path of paths) {
      const value = this.getStringAtPath(source, path);
      if (value) {
        return value;
      }
    }
    return '';
  }

  private asMetadata(value: unknown): Record<string, unknown> {
    return this.getRecord(value) || {};
  }

  private getFirstArrayRecordAtPath(source: unknown, path: string[]): Record<string, unknown> {
    const value = path.reduce<unknown>((current, segment) => {
      if (Array.isArray(current)) {
        return current[Number(segment) || 0];
      }
      return this.getRecord(current)?.[segment];
    }, source);

    return this.getRecord(value) || {};
  }

  private async resolveClinicIdFromPaymentReferences(
    paymentId?: string,
    orderId?: string
  ): Promise<string | null> {
    const references = [paymentId, orderId].filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0
    );

    for (const reference of references) {
      // 1. Try by DB payment UUID / transactionId
      const payment =
        (await this.databaseService.findPaymentByIdSafe(reference)) ??
        (await this.databaseService.findPaymentsSafe({ transactionId: reference }))[0] ??
        null;

      const metadata = this.asMetadata(payment?.metadata);
      const resolvedClinicId =
        payment?.clinicId ||
        payment?.invoice?.clinicId ||
        (typeof metadata['clinicId'] === 'string' ? metadata['clinicId'] : '');

      if (resolvedClinicId) {
        return resolvedClinicId;
      }
    }

    // 2. Fallback: the Cashfree orderId is formatted as `${invoiceNumber}${alphanumericSuffix}`.
    //    The suffix is generated from the gateway reference and is 8 alphanumeric chars.
    //    Try the stripped invoice number first, then the full orderId verbatim.
    if (orderId) {
      const invoiceNumberCandidate =
        orderId.startsWith('INV-') && orderId.length > 8 ? orderId.slice(0, -8) : orderId;
      const candidates = [
        invoiceNumberCandidate, // e.g. "INV-2026-000008" from "INV-2026-00000840ab9a6c"
        orderId, // try full orderId verbatim as invoiceNumber
      ].filter((v): v is string => typeof v === 'string' && v.length > 0);

      for (const candidate of candidates) {
        try {
          const invoices = await this.databaseService.findInvoicesSafe({
            invoiceNumber: candidate,
          });
          const invoiceClinicId = invoices[0]?.clinicId;
          if (invoiceClinicId) {
            await this.loggingService.log(
              LogType.PAYMENT,
              LogLevel.INFO,
              'Resolved clinicId from invoice number fallback',
              'PaymentController',
              { orderId, candidate, clinicId: invoiceClinicId }
            );
            return invoiceClinicId;
          }
        } catch {
          // Non-fatal: try next candidate
        }
      }
    }

    return null;
  }

  private async resolveClinicIdFromAppointment(appointmentId?: string): Promise<string | null> {
    if (!appointmentId || !appointmentId.trim()) {
      return null;
    }

    try {
      const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);
      return appointment?.clinicId ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Razorpay webhook handler
   */
  @Post('razorpay/webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle Razorpay webhook' })
  @ApiHeader({ name: 'X-Razorpay-Signature', description: 'Razorpay webhook signature' })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  async handleRazorpayWebhook(
    @Req() request: FastifyRequest & { rawBody?: string | Buffer },
    @Body() body: Record<string, unknown>,
    @Headers('x-razorpay-signature') signature: string,
    @Query('clinicId') clinicId: string
  ): Promise<{ success: boolean }> {
    try {
      if (!this.isProviderEnabled(PaymentProvider.RAZORPAY)) {
        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'Razorpay webhook received but provider is disabled',
          'PaymentController',
          { clinicId }
        );
        return { success: false };
      }

      const event = body['event'] as string;
      const rawPayload =
        typeof request.rawBody === 'string'
          ? request.rawBody
          : Buffer.isBuffer(request.rawBody)
            ? request.rawBody.toString('utf8')
            : JSON.stringify(body);
      const paymentId = this.getFirstStringAtPath(body, [
        ['payload', 'payment', 'entity', 'id'],
        ['payload', 'payment', 'id'],
      ]);
      const orderId = this.getFirstStringAtPath(body, [
        ['payload', 'payment', 'entity', 'order_id'],
        ['payload', 'order', 'entity', 'id'],
        ['payload', 'order', 'id'],
      ]);
      const notesClinicId = this.getFirstStringAtPath(body, [
        ['payload', 'payment', 'entity', 'notes', 'clinicId'],
        ['payload', 'order', 'entity', 'notes', 'clinicId'],
        ['notes', 'clinicId'],
      ]);
      const resolvedClinicId =
        clinicId ||
        notesClinicId ||
        (await this.resolveClinicIdFromPaymentReferences(paymentId, orderId));

      if (!resolvedClinicId) {
        throw new Error('Clinic ID is required');
      }
      if (!signature) {
        throw new Error('Razorpay webhook signature is required');
      }

      const isValid = await this.paymentService.verifyWebhook(
        resolvedClinicId,
        {
          payload: rawPayload,
          signature: signature || '',
        },
        PaymentProvider.RAZORPAY
      );

      if (!isValid) {
        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'Invalid Razorpay webhook signature',
          'PaymentController',
          { clinicId: resolvedClinicId }
        );
        return { success: false };
      }

      if (event === 'payment.captured' || event === 'payment.failed') {
        if (paymentId && orderId) {
          await this.getBillingService().handlePaymentCallback(
            resolvedClinicId,
            paymentId,
            orderId,
            PaymentProvider.RAZORPAY
          );
        }
      }

      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'Razorpay webhook processed',
        'PaymentController',
        { clinicId: resolvedClinicId, event }
      );

      return { success: true };
    } catch (error) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        `Failed to process Razorpay webhook: ${error instanceof Error ? error.message : String(error)}`,
        'PaymentController',
        {
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      return { success: false };
    }
  }

  /**
   * Cashfree webhook handler
   */
  @Post('cashfree/webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle Cashfree webhook' })
  @ApiHeader({ name: 'x-webhook-signature', description: 'Cashfree webhook signature' })
  @ApiHeader({ name: 'x-cf-signature', description: 'Cashfree legacy signature' })
  @ApiHeader({ name: 'x-webhook-timestamp', description: 'Cashfree webhook timestamp' })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  async handleCashfreeWebhook(
    @Req() request: FastifyRequest & { rawBody?: string | Buffer },
    @Body() body: Record<string, unknown>,
    @Headers('x-webhook-signature') webhookSignature: string,
    @Headers('x-cf-signature') legacySignature: string,
    @Headers('x-webhook-timestamp') timestamp: string,
    @Query('clinicId') clinicId: string
  ): Promise<{ success: boolean }> {
    try {
      const signature = webhookSignature || legacySignature;
      const rawPayload =
        typeof request.rawBody === 'string'
          ? request.rawBody
          : Buffer.isBuffer(request.rawBody)
            ? request.rawBody.toString('utf8')
            : JSON.stringify(body);
      const dataObj = (
        typeof body['data'] === 'object' && body['data'] !== null ? body['data'] : body
      ) as Record<string, unknown>;
      const orderId = this.getFirstStringAtPath(dataObj, [
        ['order', 'order_id'],
        ['orderId'],
        ['order_id'],
      ]);
      const appointmentId = this.getFirstStringAtPath(dataObj, [
        ['order', 'order_tags', 'appointmentId'],
        ['appointmentId'],
        ['appointment_id'],
      ]);
      const paymentId =
        this.getFirstStringAtPath(dataObj, [
          ['payment', 'cf_payment_id'],
          ['payment', 'payment_id'],
          ['cf_payment_id'],
          ['paymentId'],
          ['payment_id'],
        ]) || orderId;
      const paymentStatus = this.getFirstStringAtPath(dataObj, [
        ['payment', 'payment_status'],
        ['payment_status'],
        ['paymentStatus'],
      ]).toUpperCase();
      const resolvedClinicId =
        clinicId ||
        (await this.resolveClinicIdFromPaymentReferences(paymentId, orderId)) ||
        (await this.resolveClinicIdFromAppointment(appointmentId));

      if (!resolvedClinicId) {
        throw new Error('Clinic ID is required');
      }
      if (!signature) {
        throw new Error('Cashfree webhook signature is required');
      }
      if (!timestamp) {
        throw new Error('Cashfree webhook timestamp is required');
      }

      const isValid = await this.paymentService.verifyWebhook(
        resolvedClinicId,
        {
          payload: rawPayload,
          signature: signature || '',
          timestamp,
        },
        PaymentProvider.CASHFREE
      );

      if (!isValid) {
        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'Invalid Cashfree webhook signature',
          'PaymentController',
          { clinicId: resolvedClinicId }
        );
        return { success: false };
      }

      if (orderId && paymentId && paymentStatus === 'SUCCESS') {
        await this.getBillingService().handlePaymentCallback(
          resolvedClinicId,
          paymentId,
          orderId,
          PaymentProvider.CASHFREE
        );
      }

      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'Cashfree webhook processed',
        'PaymentController',
        { clinicId: resolvedClinicId, paymentStatus, orderId, paymentId }
      );

      return { success: true };
    } catch (error) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        `Failed to process Cashfree webhook: ${error instanceof Error ? error.message : String(error)}`,
        'PaymentController',
        {
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      return { success: false };
    }
  }

  /**
   * PhonePe webhook handler
   */
  @Post('phonepe/webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle PhonePe webhook' })
  @ApiHeader({ name: 'X-VERIFY', description: 'PhonePe webhook signature' })
  @ApiHeader({ name: 'Authorization', description: 'PhonePe webhook SHA256 auth header' })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  async handlePhonePeWebhook(
    @Req() request: FastifyRequest & { rawBody?: string | Buffer },
    @Body() body: Record<string, unknown>,
    @Headers('x-verify') signature: string,
    @Headers('authorization') authorization: string,
    @Query('clinicId') clinicId: string
  ): Promise<{ success: boolean }> {
    try {
      if (!this.isProviderEnabled(PaymentProvider.PHONEPE)) {
        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'PhonePe webhook received but provider is disabled',
          'PaymentController',
          { clinicId }
        );
        return { success: false };
      }

      const base64Payload = (body['response'] || body['request']) as string;
      let callbackType = this.getFirstStringAtPath(body, [['type'], ['event']]);
      let merchantTransactionId = '';
      let transactionId = '';
      let refundId = '';
      let callbackAmount = 0;
      let state = '';

      if (base64Payload) {
        const decodedPayload = Buffer.from(base64Payload, 'base64').toString('utf-8');
        const parsedPayload = JSON.parse(decodedPayload) as Record<string, unknown>;

        callbackType =
          this.getFirstStringAtPath(parsedPayload, [['type'], ['event']]) || callbackType;
        merchantTransactionId = this.getFirstStringAtPath(parsedPayload, [
          ['merchantOrderId'],
          ['merchantTransactionId'],
          ['originalMerchantOrderId'],
        ]);
        transactionId = this.getFirstStringAtPath(parsedPayload, [['transactionId']]);
        refundId = this.getFirstStringAtPath(parsedPayload, [['refundId'], ['merchantRefundId']]);
        callbackAmount = Number(parsedPayload['amount'] || 0);
        state = this.getFirstStringAtPath(parsedPayload, [['state']]).toUpperCase();
      } else {
        const payload = this.getRecord(body['payload']) || {};
        const paymentDetail = this.getFirstArrayRecordAtPath(body, ['payload', 'paymentDetails']);
        callbackType = this.getFirstStringAtPath(body, [['type'], ['event']]);
        merchantTransactionId = this.getFirstStringAtPath(body, [
          ['payload', 'merchantOrderId'],
          ['payload', 'orderId'],
          ['payload', 'originalMerchantOrderId'],
        ]);
        transactionId =
          this.getFirstStringAtPath(paymentDetail, [['transactionId']]) ||
          this.getFirstStringAtPath(body, [['payload', 'orderId']]) ||
          this.getFirstStringAtPath(payload, [['transactionId']]);
        refundId = this.getFirstStringAtPath(body, [
          ['payload', 'refundId'],
          ['payload', 'merchantRefundId'],
          ['payload', 'paymentDetails', '0', 'refundId'],
        ]);
        callbackAmount = Number(
          typeof payload['amount'] === 'number'
            ? payload['amount']
            : typeof payload['amount'] === 'string'
              ? payload['amount']
              : 0
        );
        state = this.getFirstStringAtPath(body, [['payload', 'state']]).toUpperCase();
      }

      const resolvedClinicId =
        clinicId ||
        (await this.resolveClinicIdFromPaymentReferences(transactionId, merchantTransactionId));

      if (!resolvedClinicId) {
        throw new Error('Clinic ID is required');
      }

      const responseBody =
        typeof request.rawBody === 'string'
          ? request.rawBody
          : Buffer.isBuffer(request.rawBody)
            ? request.rawBody.toString('utf8')
            : JSON.stringify(body);
      const isValid = authorization
        ? await this.paymentService.verifyWebhook(
            resolvedClinicId,
            {
              payload: responseBody,
              signature: authorization,
            },
            PaymentProvider.PHONEPE
          )
        : signature
          ? await this.paymentService.verifyWebhook(
              resolvedClinicId,
              {
                payload: body,
                signature: signature || '',
              },
              PaymentProvider.PHONEPE
            )
          : false;

      if (!isValid) {
        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'Invalid PhonePe webhook signature',
          'PaymentController',
          { clinicId: resolvedClinicId }
        );
        return { success: false };
      }

      const normalizedCallbackType = callbackType.trim().toUpperCase();
      const isRefundCallback = normalizedCallbackType.includes('REFUND');
      const isOrderCallback =
        !normalizedCallbackType ||
        normalizedCallbackType.includes('ORDER') ||
        normalizedCallbackType.includes('TRANSACTION');

      if (isRefundCallback && (refundId || merchantTransactionId)) {
        await this.getBillingService().handleRefundCallback(
          resolvedClinicId,
          merchantTransactionId || transactionId || refundId,
          refundId || merchantTransactionId || transactionId,
          merchantTransactionId || transactionId || undefined,
          PaymentProvider.PHONEPE,
          state || normalizedCallbackType,
          callbackAmount
        );
      } else if (isOrderCallback && merchantTransactionId) {
        await this.getBillingService().handlePaymentCallback(
          resolvedClinicId,
          merchantTransactionId,
          merchantTransactionId,
          PaymentProvider.PHONEPE
        );
      }

      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'PhonePe webhook processed',
        'PaymentController',
        {
          clinicId: resolvedClinicId,
          event: callbackType,
          state,
          merchantTransactionId,
          transactionId,
          refundId,
        }
      );

      return { success: true };
    } catch (error) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        `Failed to process PhonePe webhook: ${error instanceof Error ? error.message : String(error)}`,
        'PaymentController',
        {
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      return { success: false };
    }
  }

  /**
   * Easebuzz webhook handler
   */
  @Post('easebuzz/webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle Easebuzz webhook' })
  @ApiHeader({ name: 'X-Easebuzz-Signature', description: 'Easebuzz webhook signature' })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  async handleEasebuzzWebhook(
    @Body() body: Record<string, unknown>,
    @Headers('x-easebuzz-signature') signature: string,
    @Query('clinicId') clinicId: string
  ): Promise<{ success: boolean }> {
    try {
      if (!this.isProviderEnabled(PaymentProvider.EASEBUZZ)) {
        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'Easebuzz webhook received but provider is disabled',
          'PaymentController',
          { clinicId }
        );
        return { success: false };
      }

      const merchantTxnId =
        typeof body['merchant_txnid'] === 'string' ? body['merchant_txnid'] : '';
      const paymentId = typeof body['payment_id'] === 'string' ? body['payment_id'] : '';
      const status = typeof body['status'] === 'string' ? body['status'] : '';
      const resolvedClinicId =
        clinicId || (await this.resolveClinicIdFromPaymentReferences(paymentId, merchantTxnId));

      if (!resolvedClinicId) {
        throw new Error('Clinic ID is required');
      }
      if (!signature) {
        throw new Error('Easebuzz webhook signature is required');
      }

      const isValid = await this.paymentService.verifyWebhook(
        resolvedClinicId,
        {
          payload: body,
          signature: signature || '',
        },
        PaymentProvider.EASEBUZZ
      );

      if (!isValid) {
        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'Invalid Easebuzz webhook signature',
          'PaymentController',
          { clinicId: resolvedClinicId }
        );
        return { success: false };
      }

      if ((status === 'success' || status === 'SUCCESS') && paymentId && merchantTxnId) {
        await this.getBillingService().handlePaymentCallback(
          resolvedClinicId,
          paymentId,
          merchantTxnId,
          PaymentProvider.EASEBUZZ
        );
      }

      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'Easebuzz webhook processed',
        'PaymentController',
        { clinicId: resolvedClinicId, status, merchantTxnId }
      );

      return { success: true };
    } catch (error) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        `Failed to process Easebuzz webhook: ${error instanceof Error ? error.message : String(error)}`,
        'PaymentController',
        {
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      return { success: false };
    }
  }

  /**
   * Paytm Business webhook handler
   */
  @Post('paytm/webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle Paytm Business webhook' })
  @ApiHeader({ name: 'X-Paytm-Signature', description: 'Paytm webhook checksum' })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  async handlePaytmWebhook(
    @Body() body: Record<string, unknown>,
    @Headers('x-paytm-signature') signature: string,
    @Query('clinicId') clinicId: string
  ): Promise<{ success: boolean }> {
    try {
      if (!this.isProviderEnabled(PaymentProvider.PAYTM)) {
        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'Paytm webhook received but provider is disabled',
          'PaymentController',
          { clinicId }
        );
        return { success: false };
      }

      const paytmBody = body['body'] as Record<string, unknown> | undefined;
      const orderId =
        typeof paytmBody?.['orderId'] === 'string' ? String(paytmBody['orderId']) : '';
      const paymentId = typeof paytmBody?.['txnId'] === 'string' ? String(paytmBody['txnId']) : '';
      const resultInfo = paytmBody?.['resultInfo'] as Record<string, unknown> | null | undefined;
      const resultStatus =
        typeof resultInfo?.['resultStatus'] === 'string' ? String(resultInfo['resultStatus']) : '';
      const resolvedClinicId =
        clinicId || (await this.resolveClinicIdFromPaymentReferences(paymentId, orderId));

      if (!resolvedClinicId) {
        throw new Error('Clinic ID is required');
      }
      if (!signature) {
        throw new Error('Paytm webhook signature is required');
      }

      const isValid = await this.paymentService.verifyWebhook(
        resolvedClinicId,
        {
          payload: body,
          signature: signature || '',
        },
        PaymentProvider.PAYTM
      );

      if (!isValid) {
        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'Invalid Paytm webhook signature',
          'PaymentController',
          { clinicId: resolvedClinicId }
        );
        return { success: false };
      }

      if (resultStatus === 'TXN_SUCCESS' && paymentId && orderId) {
        await this.getBillingService().handlePaymentCallback(
          resolvedClinicId,
          paymentId,
          orderId,
          PaymentProvider.PAYTM
        );
      }

      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'Paytm webhook processed',
        'PaymentController',
        { clinicId: resolvedClinicId, resultStatus, orderId }
      );

      return { success: true };
    } catch (error) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        `Failed to process Paytm webhook: ${error instanceof Error ? error.message : String(error)}`,
        'PaymentController',
        {
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      return { success: false };
    }
  }

  /**
   * PayU webhook handler
   */
  @Post('payu/webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle PayU webhook' })
  @ApiHeader({ name: 'X-PayU-Signature', description: 'PayU webhook signature' })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  async handlePayUWebhook(
    @Body() body: Record<string, unknown>,
    @Headers('x-payu-signature') signature: string,
    @Query('clinicId') clinicId: string
  ): Promise<{ success: boolean }> {
    try {
      if (!this.isProviderEnabled(PaymentProvider.PAYU)) {
        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'PayU webhook received but provider is disabled',
          'PaymentController',
          { clinicId }
        );
        return { success: false };
      }

      const orderId = typeof body['orderId'] === 'string' ? body['orderId'] : '';
      const status = typeof body['status'] === 'string' ? body['status'] : '';
      const txnId = typeof body['txnId'] === 'string' ? body['txnId'] : '';
      const resolvedClinicId =
        clinicId || (await this.resolveClinicIdFromPaymentReferences(txnId, orderId));

      if (!resolvedClinicId) {
        throw new Error('Clinic ID is required');
      }
      if (!signature) {
        throw new Error('PayU webhook signature is required');
      }

      const isValid = await this.paymentService.verifyWebhook(
        resolvedClinicId,
        {
          payload: body,
          signature: signature || '',
        },
        PaymentProvider.PAYU
      );

      if (!isValid) {
        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'Invalid PayU webhook signature',
          'PaymentController',
          { clinicId: resolvedClinicId }
        );
        return { success: false };
      }

      if ((status === 'success' || status === 'SUCCESS') && txnId) {
        await this.getBillingService().handlePaymentCallback(
          resolvedClinicId,
          txnId,
          orderId,
          PaymentProvider.PAYU
        );
      }

      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'PayU webhook processed',
        'PaymentController',
        { clinicId: resolvedClinicId, status, orderId }
      );

      return { success: true };
    } catch (error) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        `Failed to process PayU webhook: ${error instanceof Error ? error.message : String(error)}`,
        'PaymentController',
        {
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      return { success: false };
    }
  }

  /**
   * Zoho Payments webhook handler
   */
  @Post('zoho/webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle Zoho Payments webhook' })
  @ApiHeader({
    name: 'X-Zoho-Webhook-Signature',
    description: 'Zoho Payments webhook signature header',
  })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  async handleZohoWebhook(
    @Req() request: FastifyRequest & { rawBody?: string | Buffer },
    @Body() body: Record<string, unknown>,
    @Headers('x-zoho-webhook-signature') signature: string,
    @Query('clinicId') clinicId: string
  ): Promise<{ success: boolean }> {
    try {
      if (!this.isProviderEnabled(PaymentProvider.ZOHO)) {
        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'Zoho webhook received but provider is disabled',
          'PaymentController',
          { clinicId }
        );
        return { success: false };
      }

      const rawPayload =
        typeof request.rawBody === 'string'
          ? request.rawBody
          : Buffer.isBuffer(request.rawBody)
            ? request.rawBody.toString('utf8')
            : JSON.stringify(body);
      const event = this.getFirstStringAtPath(body, [['event'], ['event_type'], ['type']]);
      const paymentSessionId = this.getFirstStringAtPath(body, [
        ['payments_session_id'],
        ['payment_session_id'],
        ['data', 'payments_session_id'],
        ['data', 'payment_session_id'],
        ['payload', 'payments_session_id'],
        ['payload', 'payment_session_id'],
        ['payments_session', 'payments_session_id'],
        ['payments_session', 'payment_session_id'],
      ]);
      const paymentId = this.getFirstStringAtPath(body, [
        ['payment_id'],
        ['paymentId'],
        ['data', 'payment_id'],
        ['data', 'paymentId'],
        ['payload', 'payment_id'],
        ['payload', 'paymentId'],
        ['payments_session', 'payment_id'],
        ['payment', 'payment_id'],
      ]);
      const paymentStatus = this.getFirstStringAtPath(body, [
        ['payment_status'],
        ['paymentStatus'],
        ['payment_session_status'],
        ['paymentSessionStatus'],
        ['data', 'payment_status'],
        ['data', 'payment_session_status'],
        ['payload', 'payment_status'],
        ['payload', 'payment_session_status'],
        ['payments_session', 'payment_status'],
        ['payments_session', 'payment_session_status'],
        ['payment', 'status'],
      ]);
      const resolvedClinicId =
        clinicId ||
        this.getFirstStringAtPath(body, [['udf1'], ['clinicId'], ['clinic_id']]) ||
        (await this.resolveClinicIdFromPaymentReferences(paymentId, paymentSessionId));

      if (!resolvedClinicId) {
        throw new Error('Clinic ID is required');
      }
      if (!signature) {
        throw new Error('Zoho webhook signature is required');
      }

      const isValid = await this.paymentService.verifyWebhook(
        resolvedClinicId,
        {
          payload: rawPayload,
          signature: signature || '',
        },
        PaymentProvider.ZOHO
      );

      if (!isValid) {
        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'Invalid Zoho webhook signature',
          'PaymentController',
          { clinicId: resolvedClinicId }
        );
        return { success: false };
      }

      const callbackPaymentId = paymentId || paymentSessionId;
      const callbackOrderId = paymentSessionId || paymentId;
      if (callbackPaymentId && callbackOrderId) {
        await this.getBillingService().handlePaymentCallback(
          resolvedClinicId,
          callbackPaymentId,
          callbackOrderId,
          PaymentProvider.ZOHO
        );
      }

      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'Zoho webhook processed',
        'PaymentController',
        {
          clinicId: resolvedClinicId,
          event,
          paymentStatus,
          paymentId: callbackPaymentId,
          paymentSessionId: callbackOrderId,
        }
      );

      return { success: true };
    } catch (error) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        `Failed to process Zoho webhook: ${error instanceof Error ? error.message : String(error)}`,
        'PaymentController',
        {
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      return { success: false };
    }
  }

  /**
   * Generic payment callback handler
   */
  @Post('callback')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle payment callback' })
  @ApiResponse({ status: 200, description: 'Callback processed successfully' })
  async handlePaymentCallback(
    @Query('clinicId') clinicId: string,
    @Query('paymentId') paymentId: string,
    @Query('orderId') orderId: string,
    @Query('provider') provider?: string
  ): Promise<{ success: boolean; payment?: unknown; invoice?: unknown; appointment?: unknown }> {
    try {
      if (!paymentId || !orderId) {
        throw new Error('Payment ID and Order ID are required');
      }

      const resolvedClinicId =
        clinicId || (await this.resolveClinicIdFromPaymentReferences(paymentId, orderId));
      if (!resolvedClinicId) {
        throw new Error('Clinic ID is required');
      }

      const paymentProvider = this.parsePaymentProvider(provider);

      const result = (await this.getBillingService().handlePaymentCallback(
        resolvedClinicId,
        paymentId,
        orderId,
        paymentProvider
      )) as {
        payment?: unknown;
        invoice?: unknown;
        appointment?: unknown;
      };

      return {
        success: true,
        ...(result.payment ? { payment: result.payment } : {}),
        ...(result.invoice ? { invoice: result.invoice } : {}),
        ...(result.appointment ? { appointment: result.appointment } : {}),
      };
    } catch (error) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        `Failed to process payment callback: ${error instanceof Error ? error.message : String(error)}`,
        'PaymentController',
        {
          clinicId,
          paymentId,
          orderId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      return { success: false };
    }
  }

  /**
   * Handoff callback handler — verifies the signed token and then
   * forwards to the billing service.
   * Called by the frontend after the payment provider redirects the user back.
   */
  @Post('callback/handoff')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle payment handoff callback with token verification' })
  @ApiResponse({ status: 200, description: 'Handoff processed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or missing token' })
  @ApiResponse({ status: 401, description: 'Token verification failed' })
  async handleHandoffCallback(
    @Query('handoff_token') handoffToken?: string,
    @Query('order_id') orderId?: string,
    @Query('payment_id') paymentId?: string,
    @Query('provider') provider?: string
  ): Promise<{
    success: boolean;
    clinicId?: string;
    orderId?: string;
    paymentId?: string;
    provider?: string;
    appointmentId?: string;
    appointmentType?: string;
    message?: string;
    error?: string;
  }> {
    let verifiedPayload: {
      clinicId: string;
      orderId: string;
      paymentId?: string;
      appointmentId?: string;
      appointmentType?: string;
      provider: string;
      iat: number;
      exp: number;
      jti: string;
      version?: string;
      integrity?: string;
    } | null = null;
    try {
      // 1. Verify the handoff token
      if (!handoffToken || typeof handoffToken !== 'string' || handoffToken.trim().length === 0) {
        throw new BadRequestException('handoff_token is required');
      }

      verifiedPayload = await this.handoffTokenService.verifyHandoffToken(handoffToken.trim());
      if (!verifiedPayload) {
        throw new UnauthorizedException('Invalid or expired handoff token');
      }

      const clinicId = verifiedPayload.clinicId;
      const resolvedOrderId = orderId || verifiedPayload.orderId;
      const resolvedPaymentId = paymentId || verifiedPayload.paymentId;
      const resolvedProvider = (provider || verifiedPayload.provider) as
        | PaymentProvider
        | undefined;
      const verificationPaymentId = resolvedPaymentId || resolvedOrderId;

      // 2. Forward to billing service for payment status update
      if (verificationPaymentId) {
        await this.getBillingService().handlePaymentCallback(
          clinicId,
          verificationPaymentId,
          resolvedOrderId || '',
          resolvedProvider
        );
      }

      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'Payment handoff callback processed',
        'PaymentController',
        {
          clinicId,
          orderId: resolvedOrderId,
          paymentId: verificationPaymentId,
          provider: resolvedProvider,
          jti: verifiedPayload.jti,
        }
      );

      return {
        success: true,
        clinicId,
        orderId: resolvedOrderId,
        ...(verificationPaymentId ? { paymentId: verificationPaymentId } : {}),
        ...(resolvedProvider ? { provider: resolvedProvider } : {}),
        ...(verifiedPayload.appointmentId ? { appointmentId: verifiedPayload.appointmentId } : {}),
        ...(verifiedPayload.appointmentType
          ? { appointmentType: verifiedPayload.appointmentType }
          : {}),
        message: 'Payment callback processed successfully',
      };
    } catch (error) {
      if (verifiedPayload?.jti) {
        await this.handoffTokenService.releaseReplayToken(verifiedPayload.jti);
      }
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        `Failed to process handoff callback: ${error instanceof Error ? error.message : String(error)}`,
        'PaymentController',
        {
          orderId,
          paymentId,
          provider,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }
}
