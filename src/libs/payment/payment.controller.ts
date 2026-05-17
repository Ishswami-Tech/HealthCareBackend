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
  Req,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { DatabaseService } from '@infrastructure/database';
import { PaymentService } from './payment.service';
// Use direct import to avoid TDZ issues with barrel exports
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
};

@ApiTags('payments')
@Controller('payments')
export class PaymentController {
  private billingServiceRef: BillingServiceLike | null = null;
  private readonly enabledProviders = (
    process.env['PAYMENT_ENABLED_PROVIDERS'] || PaymentProvider.CASHFREE
  )
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);

  constructor(
    private readonly paymentService: PaymentService,
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
    const enabledProviders = (process.env['PAYMENT_ENABLED_PROVIDERS'] || PaymentProvider.CASHFREE)
      .split(',')
      .map(value => value.trim().toLowerCase())
      .filter(Boolean);

    if (!enabledProviders.includes(normalizedProvider)) {
      throw new BadRequestException(
        `Payment provider '${provider}' is not enabled. Enabled providers: ${enabledProviders.join(', ')}`
      );
    }

    return normalizedProvider as PaymentProvider;
  }

  private isProviderEnabled(provider: PaymentProvider): boolean {
    return this.enabledProviders.includes(provider);
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

      const resolvedClinicId =
        payment?.clinicId ||
        payment?.invoice?.clinicId ||
        (typeof payment?.metadata === 'object' &&
        payment?.metadata !== null &&
        !Array.isArray(payment.metadata) &&
        typeof (payment.metadata as Record<string, unknown>)['clinicId'] === 'string'
          ? String((payment.metadata as Record<string, unknown>)['clinicId'])
          : '');

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

      // Extract payment details from webhook payload
      const event = body['event'] as string;
      const payload = body['payload'] as Record<string, unknown>;
      const paymentEntity = payload?.['payment'] as Record<string, unknown>;
      const orderEntity = payload?.['order'] as Record<string, unknown>;
      const paymentId = typeof paymentEntity?.['id'] === 'string' ? paymentEntity['id'] : '';
      const orderId = typeof orderEntity?.['id'] === 'string' ? orderEntity['id'] : '';
      const resolvedClinicId =
        clinicId || (await this.resolveClinicIdFromPaymentReferences(paymentId, orderId));

      if (!resolvedClinicId) {
        throw new Error('Clinic ID is required');
      }
      if (!signature) {
        throw new Error('Razorpay webhook signature is required');
      }

      // Verify webhook signature
      const isValid = await this.paymentService.verifyWebhook(
        resolvedClinicId,
        {
          payload: body,
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
      // Cashfree final status is payment_status=SUCCESS and cf_payment_id is unique per attempt.
      const dataObj = (
        typeof body['data'] === 'object' && body['data'] !== null ? body['data'] : body
      ) as Record<string, unknown>;
      const orderIdRaw =
        dataObj['orderId'] ?? dataObj['order_id'] ?? body['orderId'] ?? body['order_id'];
      const paymentIdRaw =
        dataObj['cf_payment_id'] ??
        dataObj['paymentId'] ??
        dataObj['payment_id'] ??
        body['paymentId'] ??
        body['payment_id'] ??
        body['cf_payment_id'] ??
        orderIdRaw;
      const paymentStatusRaw =
        dataObj['payment_status'] ??
        dataObj['paymentStatus'] ??
        body['payment_status'] ??
        body['paymentStatus'] ??
        '';
      const orderId = typeof orderIdRaw === 'string' ? orderIdRaw : '';
      const paymentId = typeof paymentIdRaw === 'string' ? paymentIdRaw : '';
      const paymentStatus =
        typeof paymentStatusRaw === 'string' ? paymentStatusRaw.toUpperCase() : '';
      const resolvedClinicId =
        clinicId || (await this.resolveClinicIdFromPaymentReferences(paymentId, orderId));

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
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  async handlePhonePeWebhook(
    @Body() body: Record<string, unknown>,
    @Headers('x-verify') signature: string,
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

      // Extract payment details from webhook payload first so we can resolve the clinic
      const base64Payload = body['request'] as string;
      let merchantTransactionId = '';
      let transactionId = '';
      if (base64Payload) {
        const decodedPayload = Buffer.from(base64Payload, 'base64').toString('utf-8');
        const paymentData = JSON.parse(decodedPayload) as Record<string, unknown>;

        merchantTransactionId =
          typeof paymentData['merchantTransactionId'] === 'string'
            ? paymentData['merchantTransactionId']
            : '';
        transactionId =
          typeof paymentData['transactionId'] === 'string' ? paymentData['transactionId'] : '';
      }

      const resolvedClinicId =
        clinicId ||
        (await this.resolveClinicIdFromPaymentReferences(transactionId, merchantTransactionId));

      if (!resolvedClinicId) {
        throw new Error('Clinic ID is required');
      }
      if (!signature) {
        throw new Error('PhonePe webhook signature is required');
      }

      // Verify webhook signature
      const isValid = await this.paymentService.verifyWebhook(
        resolvedClinicId,
        {
          payload: body,
          signature: signature || '',
        },
        PaymentProvider.PHONEPE
      );

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

      if (merchantTransactionId && transactionId) {
        // Handle payment callback
        await this.getBillingService().handlePaymentCallback(
          resolvedClinicId,
          transactionId,
          merchantTransactionId,
          PaymentProvider.PHONEPE
        );
      }

      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'PhonePe webhook processed',
        'PaymentController',
        { clinicId: resolvedClinicId }
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
  ): Promise<{ success: boolean }> {
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

      await this.getBillingService().handlePaymentCallback(
        resolvedClinicId,
        paymentId,
        orderId,
        paymentProvider
      );

      return { success: true };
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
}
