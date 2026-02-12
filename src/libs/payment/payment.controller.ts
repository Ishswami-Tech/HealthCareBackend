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
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { PaymentService } from './payment.service';
import { BillingService } from '@services/billing/billing.service';
// Use direct import to avoid TDZ issues with barrel exports
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel, PaymentProvider } from '@core/types';

@ApiTags('payments')
@Controller('payments')
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    @Inject(forwardRef(() => BillingService))
    private readonly billingService: BillingService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

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
      if (!clinicId) {
        throw new Error('Clinic ID is required');
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
          await this.billingService.handlePaymentCallback(
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
      const orderStatusRaw =
        dataObj['orderStatus'] ??
        dataObj['order_status'] ??
        body['orderStatus'] ??
        body['order_status'] ??
        '';
      const orderId = typeof orderIdRaw === 'string' ? orderIdRaw : '';
      const orderStatus = typeof orderStatusRaw === 'string' ? orderStatusRaw : '';
      if (orderId && (orderStatus === 'PAID' || orderStatus === 'SUCCESS')) {
        await this.billingService.handlePaymentCallback(
          clinicId,
          orderId,
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
      if (!clinicId) {
        throw new Error('Clinic ID is required');
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
          await this.billingService.handlePaymentCallback(
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

      // Convert provider string to PaymentProvider enum
      let paymentProvider: PaymentProvider | undefined;
      if (provider) {
        const normalizedProvider = provider.toLowerCase();
        if (normalizedProvider === 'razorpay') {
          paymentProvider = PaymentProvider.RAZORPAY;
        } else if (normalizedProvider === 'cashfree') {
          paymentProvider = PaymentProvider.CASHFREE;
        } else if (normalizedProvider === 'phonepe') {
          paymentProvider = PaymentProvider.PHONEPE;
        }
      }

      await this.billingService.handlePaymentCallback(
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
