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
@Controller('api/payments')
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
        const paymentId = paymentEntity?.['id'] as string;
        const orderId = orderEntity?.['id'] as string;

        if (paymentId && orderId) {
          // Handle payment callback
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

        const merchantTransactionId = paymentData['merchantTransactionId'] as string;
        const transactionId = paymentData['transactionId'] as string;

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
