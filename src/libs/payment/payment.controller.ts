/**
 * Payment Controller
 * ==================
 * Handles payment webhooks and callbacks
 *
 * @module PaymentController
 * @description Payment webhook and callback endpoints
 */

import { Controller, Post, Body, Headers, Query, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { PaymentService } from './payment.service';
// Use direct import to avoid TDZ issues with barrel exports
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel, PaymentProvider } from '@core/types';

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
    const enabledProviders = (
      process.env['PAYMENT_ENABLED_PROVIDERS'] || PaymentProvider.CASHFREE
    )
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

  /**
   * Razorpay webhook handler
   */
  @Post('razorpay/webhook')
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

      if (!clinicId) {
        throw new Error('Clinic ID is required');
      }
      if (!signature) {
        throw new Error('Razorpay webhook signature is required');
      }

      // Verify webhook signature
      const isValid = await this.paymentService.verifyWebhook(
        clinicId,
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
          { clinicId }
        );
        return { success: false };
      }

      // Extract payment details from webhook payload
      const event = body['event'] as string;
      const payload = body['payload'] as Record<string, unknown>;
      const paymentEntity = payload?.['payment'] as Record<string, unknown>;
      const orderEntity = payload?.['order'] as Record<string, unknown>;

      if (event === 'payment.captured' || event === 'payment.failed') {
        const paymentId = typeof paymentEntity?.['id'] === 'string' ? paymentEntity['id'] : '';
        const orderId = typeof orderEntity?.['id'] === 'string' ? orderEntity['id'] : '';

        if (paymentId && orderId) {
          await this.getBillingService().handlePaymentCallback(
            clinicId,
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
        { clinicId, event }
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
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Handle Cashfree webhook' })
  @ApiHeader({ name: 'x-cf-signature', description: 'Cashfree webhook signature' })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  async handleCashfreeWebhook(
    @Body() body: Record<string, unknown>,
    @Headers('x-cf-signature') signature: string,
    @Query('clinicId') clinicId: string
  ): Promise<{ success: boolean }> {
    try {
      if (!clinicId) {
        throw new Error('Clinic ID is required');
      }
      if (!signature) {
        throw new Error('Cashfree webhook signature is required');
      }

      const isValid = await this.paymentService.verifyWebhook(
        clinicId,
        {
          payload: body,
          signature: signature || '',
        },
        PaymentProvider.CASHFREE
      );

      if (!isValid) {
        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'Invalid Cashfree webhook signature',
          'PaymentController',
          { clinicId }
        );
        return { success: false };
      }

      // Parse orderId and orderStatus - support top-level and nested data (appointment/video payments)
      const dataObj = (
        typeof body['data'] === 'object' && body['data'] !== null ? body['data'] : body
      ) as Record<string, unknown>;
      const orderIdRaw =
        dataObj['orderId'] ?? dataObj['order_id'] ?? body['orderId'] ?? body['order_id'];
      const paymentIdRaw =
        dataObj['paymentId'] ??
        dataObj['payment_id'] ??
        dataObj['cf_payment_id'] ??
        body['paymentId'] ??
        body['payment_id'] ??
        body['cf_payment_id'] ??
        orderIdRaw;
      const orderStatusRaw =
        dataObj['orderStatus'] ??
        dataObj['order_status'] ??
        body['orderStatus'] ??
        body['order_status'] ??
        '';
      const orderId = typeof orderIdRaw === 'string' ? orderIdRaw : '';
      const paymentId = typeof paymentIdRaw === 'string' ? paymentIdRaw : '';
      const orderStatus =
        typeof orderStatusRaw === 'string' ? orderStatusRaw.toUpperCase() : '';
      if (
        orderId &&
        paymentId &&
        (orderStatus === 'PAID' ||
          orderStatus === 'SUCCESS' ||
          orderStatus === 'FAILED' ||
          orderStatus === 'CANCELLED')
      ) {
        await this.getBillingService().handlePaymentCallback(
          clinicId,
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
        { clinicId }
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

      if (!clinicId) {
        throw new Error('Clinic ID is required');
      }
      if (!signature) {
        throw new Error('PhonePe webhook signature is required');
      }

      // Verify webhook signature
      const isValid = await this.paymentService.verifyWebhook(
        clinicId,
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
          { clinicId }
        );
        return { success: false };
      }

      // Extract payment details from webhook payload
      const base64Payload = body['request'] as string;
      if (base64Payload) {
        const decodedPayload = Buffer.from(base64Payload, 'base64').toString('utf-8');
        const paymentData = JSON.parse(decodedPayload) as Record<string, unknown>;

        const merchantTransactionId =
          typeof paymentData['merchantTransactionId'] === 'string'
            ? paymentData['merchantTransactionId']
            : '';
        const transactionId =
          typeof paymentData['transactionId'] === 'string' ? paymentData['transactionId'] : '';

        if (merchantTransactionId && transactionId) {
          // Handle payment callback
          await this.getBillingService().handlePaymentCallback(
            clinicId,
            transactionId,
            merchantTransactionId,
            PaymentProvider.PHONEPE
          );
        }
      }

      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'PhonePe webhook processed',
        'PaymentController',
        { clinicId }
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
      if (!clinicId || !paymentId || !orderId) {
        throw new Error('Clinic ID, Payment ID, and Order ID are required');
      }

      const paymentProvider = this.parsePaymentProvider(provider);

      await this.getBillingService().handlePaymentCallback(
        clinicId,
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
