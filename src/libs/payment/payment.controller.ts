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
  ForbiddenException,
  UnauthorizedException,
  Req,
  Get,
  Put,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader } from '@nestjs/swagger';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache';
import { PaymentService } from './payment.service';
import { PaymentHandoffTokenService } from './payment.handoff-token.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel, PaymentProvider, ClinicPaymentConfig } from '@core/types';
import { RoleEnum as Role } from '@core/types';
import { Public } from '@core/decorators/public.decorator';
import { Roles } from '@core/decorators/roles.decorator';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { ClinicGuard } from '@core/guards/clinic.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { PaymentConfigService } from '@config/payment-config.service';
import { RateLimit } from '@core/decorators/rate-limit.decorator';
import {
  UpdateClinicPaymentConfigDto,
  ClinicPaymentConfigResponseDto,
  VerifyPaymentProviderDto,
  VerifyPaymentProviderResponseDto,
  PaymentProviderResponseDto,
} from '@dtos';
import type { FastifyRequest } from 'fastify';
import { resolveClinicUUID } from '@utils/clinic.utils';

type BillingServiceLike = {
  handlePaymentCallback: (
    clinicId: string,
    paymentId: string,
    orderId: string,
    provider?: PaymentProvider,
    surchargeData?: { surchargeServiceCharge: number; surchargeServiceTax: number }
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
    private readonly loggingService: LoggingService,
    private readonly paymentConfigService: PaymentConfigService,
    private readonly cacheService: CacheService
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

  private async withBillingTimeout<T>(promise: Promise<T>, timeoutMs = 10_000): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Billing service call timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
      if (typeof clearTimeout !== 'undefined') {
        return () => clearTimeout(timer);
      }
    });

    return Promise.race([promise, timeout]);
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

  private parseNumberAtPath(source: unknown, paths: string[][]): number | undefined {
    for (const path of paths) {
      const value = this.getNumberAtPath(source, path);
      if (value !== undefined && value !== null) {
        return value;
      }
    }
    return undefined;
  }

  private getNumberAtPath(source: unknown, path: string[]): number | undefined {
    let current: unknown = source;
    for (const key of path) {
      if (current && typeof current === 'object' && key in (current as Record<string, unknown>)) {
        current = (current as Record<string, unknown>)[key];
      } else {
        return undefined;
      }
    }
    if (typeof current === 'number') {
      return current;
    }
    if (typeof current === 'string') {
      const parsed = Number(current);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  private asMetadata(value: unknown): Record<string, unknown> {
    return this.getRecord(value) || {};
  }

  private async ensureWebhookNotProcessed(
    provider: string,
    paymentId?: string,
    paymentSessionId?: string,
    orderId?: string
  ): Promise<boolean> {
    const identifier = paymentId || paymentSessionId || orderId;
    if (!identifier) {
      return false;
    }

    const key = `webhook:processed:${provider}:${identifier}`;
    const alreadyProcessed = await this.cacheService.exists(key);

    if (alreadyProcessed) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        `Duplicate ${provider} webhook ignored: ${key}`,
        'PaymentController',
        { provider, paymentId, paymentSessionId, orderId, cacheKey: key }
      );
      return true;
    }

    await this.cacheService.set(key, '1', 86400);
    return false;
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
   * Resolve the paying customer's contact details from the payment target.
   *
   * Runs server-side for the @Public() payment bridge, which has no authenticated
   * user context. Each target (appointment/subscription/invoice/prescription)
   * dereferences to the owning User, whose phone was captured during WhatsApp OTP
   * registration. Returning the phone lets PaymentService avoid skipping
   * phone-required providers (Cashfree) and lets adapters prefill the gateway
   * checkout so the customer is not asked to re-enter their number.
   *
   * All fields are best-effort: a missing target or user simply yields undefined
   * fields rather than throwing, so payment creation can still proceed.
   */
  private async resolvePaymentCustomer(target: {
    appointmentId?: string;
    subscriptionId?: string;
    invoiceId?: string;
    prescriptionId?: string;
  }): Promise<{
    customerId?: string;
    customerPhone?: string;
    customerEmail?: string;
    customerName?: string;
  }> {
    try {
      let userId: string | undefined;

      if (target.appointmentId) {
        const appointment = await this.databaseService.findAppointmentByIdSafe(
          target.appointmentId
        );
        const appt = appointment as { patient?: { userId?: string | null } | null } | null;
        userId = appt?.patient?.userId ?? undefined;
      } else if (target.subscriptionId) {
        const subscription = await this.databaseService.findSubscriptionByIdSafe(
          target.subscriptionId
        );
        userId = (subscription as { userId?: string | null } | null)?.userId ?? undefined;
      } else if (target.invoiceId) {
        const invoice = await this.databaseService.findInvoiceByIdSafe(target.invoiceId);
        userId = (invoice as { userId?: string | null } | null)?.userId ?? undefined;
      } else if (target.prescriptionId) {
        // Prescriptions resolve their user via the patient relation, which is not
        // exposed by a simple id lookup here; leave the customer unresolved so the
        // internal pharmacy flow (which has the relation loaded) remains the owner
        // of prescription payments.
        userId = undefined;
      }

      if (!userId) {
        return {};
      }

      const user = await this.databaseService.findUserByIdSafe(userId);
      if (!user) {
        return { customerId: userId };
      }

      const phone = typeof user.phone === 'string' ? user.phone.trim() : '';
      return {
        customerId: userId,
        ...(phone ? { customerPhone: phone } : {}),
        ...(user.email ? { customerEmail: user.email } : {}),
        ...(user.name ? { customerName: user.name } : {}),
      };
    } catch (error) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.WARN,
        `Failed to resolve payment customer for target: ${error instanceof Error ? error.message : String(error)}`,
        'PaymentController',
        { ...target }
      );
      return {};
    }
  }

  /**
   * Razorpay webhook handler
   *
   * @public
   * @route POST /payments/razorpay/webhook
   * @param {FastifyRequest} request - Raw request with optional `rawBody` for signature verification
   * @param {Record<string, unknown>} body - Parsed webhook payload from Razorpay
   * @param {string} signature - Header `X-Razorpay-Signature` containing HMAC-SHA256 signature
   * @param {string} clinicId - Query parameter `clinicId` for clinic identification
   * @returns {Promise<{ success: boolean; error?: string }>} `{ success: true }` on success, `{ success: false, error: string }` on failure
   * @description Verifies Razorpay webhook signature, idempotency-checks the event, and forwards payment callbacks to billing
   */
  @RateLimit({ max: 30, windowMs: 60000, message: 'Too many payment webhook requests' })
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
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.isProviderEnabled(PaymentProvider.RAZORPAY)) {
        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'Razorpay webhook received but provider is disabled',
          'PaymentController',
          { clinicId }
        );
        return { success: false, error: 'Razorpay provider is disabled' };
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
        return { success: false, error: 'Invalid Razorpay webhook signature' };
      }

      if (
        await this.ensureWebhookNotProcessed(
          PaymentProvider.RAZORPAY,
          paymentId,
          undefined,
          orderId
        )
      ) {
        return { success: true };
      }

      if (event === 'payment.captured' || event === 'payment.failed') {
        if (paymentId && orderId) {
          await this.withBillingTimeout(
            this.getBillingService().handlePaymentCallback(
              resolvedClinicId,
              paymentId,
              orderId,
              PaymentProvider.RAZORPAY
            )
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
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Cashfree webhook handler
   *
   * @public
   * @route POST /payments/cashfree/webhook
   * @param {FastifyRequest} request - Raw request with optional `rawBody` for signature verification
   * @param {Record<string, unknown>} body - Parsed webhook payload from Cashfree
   * @param {string} webhookSignature - Header `x-webhook-signature` (preferred) or legacy `x-cf-signature`
   * @param {string} legacySignature - Header `x-cf-signature` (legacy fallback)
   * @param {string} timestamp - Header `x-webhook-timestamp` containing the event timestamp
   * @param {string} clinicId - Query parameter `clinicId` for clinic identification
   * @returns {Promise<{ success: boolean; error?: string }>} `{ success: true }` on success, `{ success: false, error: string }` on failure
   * @description Verifies Cashfree webhook signature using the timestamp header, idempotency-checks the event, and forwards successful payment callbacks to billing
   */
  @Post('cashfree/webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ max: 30, windowMs: 60000, message: 'Too many payment webhook requests' })
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
  ): Promise<{ success: boolean; error?: string }> {
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
        ['order', 'order_meta', 'appointmentId'],
        ['appointmentId'],
        ['appointment_id'],
      ]);
      const clinicIdFromTags = this.getFirstStringAtPath(dataObj, [
        ['order', 'order_tags', 'clinicId'],
        ['order', 'order_meta', 'clinicId'],
        ['clinicId'],
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
        clinicIdFromTags ||
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
        return { success: false, error: 'Invalid Cashfree webhook signature' };
      }

      if (
        await this.ensureWebhookNotProcessed(
          PaymentProvider.CASHFREE,
          paymentId,
          undefined,
          orderId
        )
      ) {
        return { success: true };
      }

      // Extract Cashfree Dynamic Surcharge (Ticket #8386446)
      const surchargeServiceCharge = this.parseNumberAtPath(dataObj, [
        ['payment', 'payment_surcharge', 'payment_surcharge_service_charge'],
        ['payment_surcharge', 'payment_surcharge_service_charge'],
      ]);
      const surchargeServiceTax = this.parseNumberAtPath(dataObj, [
        ['payment', 'payment_surcharge', 'payment_surcharge_service_tax'],
        ['payment_surcharge', 'payment_surcharge_service_tax'],
      ]);

      if (orderId && paymentId && paymentStatus === 'SUCCESS') {
        await this.withBillingTimeout(
          this.getBillingService().handlePaymentCallback(
            resolvedClinicId,
            paymentId,
            orderId,
            PaymentProvider.CASHFREE,
            {
              surchargeServiceCharge: surchargeServiceCharge ?? 0,
              surchargeServiceTax: surchargeServiceTax ?? 0,
            }
          )
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
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * PhonePe webhook handler
   *
   * @public
   * @route POST /payments/phonepe/webhook
   * @param {FastifyRequest} request - Raw request with optional `rawBody` for signature verification
   * @param {Record<string, unknown>} body - Parsed webhook payload from PhonePe (supports base64-encoded `response` or `request` fields)
   * @param {string} signature - Header `x-verify` containing PhonePe verify response
   * @param {string} authorization - Header `Authorization` containing SHA256 auth token
   * @param {string} clinicId - Query parameter `clinicId` for clinic identification
   * @returns {Promise<{ success: boolean; error?: string }>} `{ success: true }` on success, `{ success: false, error: string }` on failure
   * @description Verifies PhonePe webhook using Authorization header, handles both order and refund callbacks, and forwards to billing service
   */
  @Post('phonepe/webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ max: 30, windowMs: 60000, message: 'Too many payment webhook requests' })
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
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.isProviderEnabled(PaymentProvider.PHONEPE)) {
        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'PhonePe webhook received but provider is disabled',
          'PaymentController',
          { clinicId }
        );
        return { success: false, error: 'PhonePe provider is disabled' };
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
                payload: responseBody,
                signature: signature || '',
              },
              PaymentProvider.PHONEPE
            )
          : false;

      const normalizedCallbackType = callbackType.trim().toUpperCase();
      const isRefundCallback = normalizedCallbackType.includes('REFUND');
      const isOrderCallback =
        !normalizedCallbackType ||
        normalizedCallbackType.includes('ORDER') ||
        normalizedCallbackType.includes('TRANSACTION');
      if (!isValid) {
        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'Invalid PhonePe webhook signature',
          'PaymentController',
          { clinicId: resolvedClinicId }
        );
        return { success: false, error: 'Invalid PhonePe webhook signature' };
      }

      if (
        await this.ensureWebhookNotProcessed(
          PaymentProvider.PHONEPE,
          transactionId,
          merchantTransactionId,
          refundId
        )
      ) {
        return { success: true };
      }

      if (isRefundCallback && (refundId || merchantTransactionId)) {
        await this.withBillingTimeout(
          this.getBillingService().handleRefundCallback(
            resolvedClinicId,
            merchantTransactionId || transactionId || refundId,
            refundId || merchantTransactionId || transactionId,
            merchantTransactionId || transactionId || undefined,
            PaymentProvider.PHONEPE,
            state || normalizedCallbackType,
            callbackAmount
          )
        );
      } else if (isOrderCallback && merchantTransactionId) {
        await this.withBillingTimeout(
          this.getBillingService().handlePaymentCallback(
            resolvedClinicId,
            merchantTransactionId,
            merchantTransactionId,
            PaymentProvider.PHONEPE
          )
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
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Easebuzz webhook handler
   *
   * @public
   * @route POST /payments/easebuzz/webhook
   * @param {Record<string, unknown>} body - Parsed webhook payload from Easebuzz containing `merchant_txnid`, `payment_id`, `status`
   * @param {string} signature - Header `x-easebuzz-signature` containing HMAC signature
   * @param {string} clinicId - Query parameter `clinicId` for clinic identification
   * @returns {Promise<{ success: boolean; error?: string }>} `{ success: true }` on success, `{ success: false, error: string }` on failure
   * @description Verifies Easebuzz webhook signature, checks status equals `success`/`SUCCESS`, and forwards to billing service
   */
  @Post('easebuzz/webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ max: 30, windowMs: 60000, message: 'Too many payment webhook requests' })
  @ApiOperation({ summary: 'Handle Easebuzz webhook' })
  @ApiHeader({ name: 'X-Easebuzz-Signature', description: 'Easebuzz webhook signature' })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  async handleEasebuzzWebhook(
    @Body() body: Record<string, unknown>,
    @Headers('x-easebuzz-signature') signature: string,
    @Query('clinicId') clinicId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.isProviderEnabled(PaymentProvider.EASEBUZZ)) {
        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'Easebuzz webhook received but provider is disabled',
          'PaymentController',
          { clinicId }
        );
        return { success: false, error: 'Easebuzz provider is disabled' };
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
        return { success: false, error: 'Invalid Easebuzz webhook signature' };
      }

      if (
        await this.ensureWebhookNotProcessed(
          PaymentProvider.EASEBUZZ,
          paymentId,
          undefined,
          merchantTxnId
        )
      ) {
        return { success: true };
      }

      if ((status === 'success' || status === 'SUCCESS') && paymentId && merchantTxnId) {
        await this.withBillingTimeout(
          this.getBillingService().handlePaymentCallback(
            resolvedClinicId,
            paymentId,
            merchantTxnId,
            PaymentProvider.EASEBUZZ
          )
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
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Paytm Business webhook handler
   *
   * @public
   * @route POST /payments/paytm/webhook
   * @param {FastifyRequest} request - Raw request with optional `rawBody` for signature verification
   * @param {Record<string, unknown>} body - Parsed webhook payload from Paytm Business (supports nested `body` field)
   * @param {string} signature - Header `x-paytm-signature` containing Paytm checksum
   * @param {string} clinicId - Query parameter `clinicId` for clinic identification
   * @returns {Promise<{ success: boolean; error?: string }>} `{ success: true }` on success, `{ success: false, error: string }` on failure
   * @description Verifies Paytm webhook checksum, checks `resultStatus` equals `TXN_SUCCESS`, and forwards to billing service
   */
  @Post('paytm/webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ max: 30, windowMs: 60000, message: 'Too many payment webhook requests' })
  @ApiOperation({ summary: 'Handle Paytm Business webhook' })
  @ApiHeader({ name: 'X-Paytm-Signature', description: 'Paytm webhook checksum' })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  async handlePaytmWebhook(
    @Req() request: FastifyRequest & { rawBody?: string | Buffer },
    @Body() body: Record<string, unknown>,
    @Headers('x-paytm-signature') signature: string,
    @Query('clinicId') clinicId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.isProviderEnabled(PaymentProvider.PAYTM)) {
        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'Paytm webhook received but provider is disabled',
          'PaymentController',
          { clinicId }
        );
        return { success: false, error: 'Paytm provider is disabled' };
      }

      const rawPayload =
        typeof request.rawBody === 'string'
          ? request.rawBody
          : Buffer.isBuffer(request.rawBody)
            ? request.rawBody.toString('utf8')
            : JSON.stringify(body);
      const paytmBody = body['body'] as Record<string, unknown> | undefined;
      const topLevelBody = body as Record<string, unknown>;
      const orderId =
        typeof paytmBody?.['orderId'] === 'string'
          ? String(paytmBody['orderId'])
          : typeof topLevelBody['orderId'] === 'string'
            ? String(topLevelBody['orderId'])
            : '';
      const paymentId =
        typeof paytmBody?.['txnId'] === 'string'
          ? String(paytmBody['txnId'])
          : typeof topLevelBody['txnId'] === 'string'
            ? String(topLevelBody['txnId'])
            : '';
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
          payload: rawPayload,
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
        return { success: false, error: 'Invalid Paytm webhook signature' };
      }

      if (
        await this.ensureWebhookNotProcessed(PaymentProvider.PAYTM, paymentId, undefined, orderId)
      ) {
        return { success: true };
      }

      if (resultStatus === 'TXN_SUCCESS' && paymentId && orderId) {
        await this.withBillingTimeout(
          this.getBillingService().handlePaymentCallback(
            resolvedClinicId,
            paymentId,
            orderId,
            PaymentProvider.PAYTM
          )
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
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * PayU webhook handler
   *
   * @public
   * @route POST /payments/payu/webhook
   * @param {FastifyRequest} request - Raw request with optional `rawBody` for signature verification
   * @param {Record<string, unknown>} body - Parsed webhook payload from PayU containing `orderId`, `txnId`, `status`
   * @param {string} signature - Header `x-payu-signature` containing HMAC signature
   * @param {string} clinicId - Query parameter `clinicId` for clinic identification
   * @returns {Promise<{ success: boolean; error?: string }>} `{ success: true }` on success, `{ success: false, error: string }` on failure
   * @description Verifies PayU webhook signature, checks status equals `success`/`SUCCESS`, and forwards to billing service
   */
  @Post('payu/webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ max: 30, windowMs: 60000, message: 'Too many payment webhook requests' })
  @ApiOperation({ summary: 'Handle PayU webhook' })
  @ApiHeader({ name: 'X-PayU-Signature', description: 'PayU webhook signature' })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  async handlePayUWebhook(
    @Req() request: FastifyRequest & { rawBody?: string | Buffer },
    @Body() body: Record<string, unknown>,
    @Headers('x-payu-signature') signature: string,
    @Query('clinicId') clinicId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.isProviderEnabled(PaymentProvider.PAYU)) {
        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'PayU webhook received but provider is disabled',
          'PaymentController',
          { clinicId }
        );
        return { success: false, error: 'PayU provider is disabled' };
      }

      const rawPayload =
        typeof request.rawBody === 'string'
          ? request.rawBody
          : Buffer.isBuffer(request.rawBody)
            ? request.rawBody.toString('utf8')
            : JSON.stringify(body);
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
          payload: rawPayload,
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
        return { success: false, error: 'Invalid PayU webhook signature' };
      }

      if (await this.ensureWebhookNotProcessed(PaymentProvider.PAYU, txnId, undefined, orderId)) {
        return { success: true };
      }

      if ((status === 'success' || status === 'SUCCESS') && txnId) {
        await this.withBillingTimeout(
          this.getBillingService().handlePaymentCallback(
            resolvedClinicId,
            txnId,
            orderId,
            PaymentProvider.PAYU
          )
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
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Zoho Payments webhook handler
   *
   * @public
   * @route POST /payments/zoho/webhook
   * @param {FastifyRequest} request - Raw request with optional `rawBody` for signature verification
   * @param {Record<string, unknown>} body - Parsed webhook payload from Zoho Payments
   * @param {string} signature - Header `x-zoho-webhook-signature` containing Zoho webhook signature
   * @param {string} clinicId - Query parameter `clinicId` for clinic identification
   * @returns {Promise<{ success: boolean; error?: string }>} `{ success: true }` on success, `{ success: false, error: string }` on failure
   * @description Verifies Zoho Payments webhook signature, checks payment status, and forwards to billing service
   */
  @Post('zoho/webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  @RateLimit({ max: 30, windowMs: 60000, message: 'Too many payment webhook requests' })
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
  ): Promise<{ success: boolean; error?: string }> {
    try {
      if (!this.isProviderEnabled(PaymentProvider.ZOHO)) {
        await this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'Zoho webhook received but provider is disabled',
          'PaymentController',
          { clinicId }
        );
        return { success: false, error: 'Zoho provider is disabled' };
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
        ['payload', 'payment_id'],
        ['payload', 'paymentId'],
        ['payments_session', 'payment_id'],
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
        return { success: false, error: 'Invalid Zoho webhook signature' };
      }

      if (await this.ensureWebhookNotProcessed(PaymentProvider.ZOHO, paymentId, paymentSessionId)) {
        return { success: true };
      }

      const callbackPaymentId = paymentId || paymentSessionId;
      const callbackOrderId = paymentSessionId || paymentId;
      if (callbackPaymentId && callbackOrderId) {
        await this.withBillingTimeout(
          this.getBillingService().handlePaymentCallback(
            resolvedClinicId,
            callbackPaymentId,
            callbackOrderId,
            PaymentProvider.ZOHO
          )
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
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Generic payment callback handler
   *
   * @public
   * @route POST /payments/callback
   * @param {string} clinicId - Query parameter `clinicId` for clinic identification (optional if resolvable from payment/order references)
   * @param {string} paymentId - Query parameter `paymentId` identifying the payment
   * @param {string} orderId - Query parameter `orderId` identifying the order
   * @param {string} [provider] - Query parameter `provider` - optional payment provider name (e.g. `razorpay`, `cashfree`, `phonepe`, `paytm`, `payu`, `zoho`, `easebuzz`)
   * @returns {Promise<{ success: boolean; payment?: unknown; invoice?: unknown; appointment?: unknown; error?: string }>} On success: `{ success: true, payment?, invoice?, appointment? }`. On failure: `{ success: false, error: string }`
   * @description Frontend-facing callback endpoint. Resolves the clinic from context or payment references, validates the provider, forwards to billing service with timeout protection, and returns updated payment/invoice/appointment data
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
  ): Promise<{
    success: boolean;
    payment?: unknown;
    invoice?: unknown;
    appointment?: unknown;
    error?: string;
  }> {
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

      const result = (await this.withBillingTimeout(
        this.getBillingService().handlePaymentCallback(
          resolvedClinicId,
          paymentId,
          orderId,
          paymentProvider
        )
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
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Create a payment intent — public endpoint for the payment bridge (server-to-server).
   * Uses X-Clinic-ID header for clinic identification instead of JWT.
   *
   * @public
   * @route POST /payments/payment-intents
   * @param {string} clinicIdHeader - X-Clinic-ID header for clinic identification
   * @param {object} body - Request body containing payment details
   * @param {string} [body.appointmentId] - Appointment ID to process payment for
   * @param {string} [body.subscriptionId] - Subscription ID to process payment for
   * @param {string} [body.invoiceId] - Invoice ID to process payment for
   * @param {string} [body.prescriptionId] - Prescription ID to process payment for
   * @param {number} body.amount - Payment amount in minor units (e.g., paise)
   * @param {string} [body.appointmentType] - Appointment type (VIDEO_CALL, IN_PERSON, HOME_VISIT)
   * @param {string} [body.provider] - Optional payment provider override
   * @returns {Promise<{ success: boolean; paymentIntent?: Record<string, unknown>; error?: string }>} On success: `{ success: true, paymentIntent }`. On failure: `{ success: false, error }`
   * @description Creates a payment intent via the clinic's primary provider (or specified override). No user authentication required — clinic is identified by X-Clinic-ID header. Rate limited to prevent abuse.
   */
  @RateLimit({ max: 20, windowMs: 60000, message: 'Too many payment intent requests' })
  @Post('payment-intents')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create payment intent (public, for payment bridge)' })
  @ApiHeader({ name: 'X-Clinic-ID', description: 'Clinic identifier', required: true })
  @ApiResponse({ status: 200, description: 'Payment intent created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 404, description: 'Clinic not found or no payment config' })
  async createPaymentIntentPublic(
    @Headers('x-clinic-id') clinicIdHeader: string | undefined,
    @Body()
    body: {
      appointmentId?: string;
      subscriptionId?: string;
      invoiceId?: string;
      prescriptionId?: string;
      amount: number;
      appointmentType?: 'VIDEO_CALL' | 'IN_PERSON' | 'HOME_VISIT';
      provider?: string;
      currency?: string;
      description?: string;
    }
  ): Promise<{
    success: boolean;
    paymentIntent?: Record<string, unknown>;
    error?: string;
  }> {
    const clinicId = clinicIdHeader
      ? await resolveClinicUUID(this.databaseService, clinicIdHeader)
      : null;
    if (!clinicId) {
      return { success: false, error: 'X-Clinic-ID header is required.' };
    }

    const {
      appointmentId,
      subscriptionId,
      invoiceId,
      prescriptionId,
      amount,
      appointmentType,
      provider,
      currency = 'INR',
      description,
    } = body;

    if (!Number.isFinite(amount) || amount <= 0) {
      return { success: false, error: 'Valid amount is required.' };
    }

    const targetId = subscriptionId || appointmentId || invoiceId || prescriptionId;
    if (!targetId) {
      return {
        success: false,
        error: 'A target (subscription, appointment, invoice, or prescription) is required.',
      };
    }

    // Resolve the paying customer's details SERVER-SIDE from the target entity.
    // The request body deliberately carries no phone/customer fields: this bridge
    // is @Public(), so trusting a client-sent phone would let a caller put an
    // arbitrary number on someone else's payment. Deriving it here also means
    // Cashfree (which requires a phone) is not needlessly skipped, and the phone
    // can be forwarded to the gateway so the checkout does not re-prompt for it.
    const customer = await this.resolvePaymentCustomer({
      ...(appointmentId ? { appointmentId } : {}),
      ...(subscriptionId ? { subscriptionId } : {}),
      ...(invoiceId ? { invoiceId } : {}),
      ...(prescriptionId ? { prescriptionId } : {}),
    });

    if (!customer.customerPhone) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.WARN,
        'Public payment intent: no phone resolved for target; phone-dependent providers may be skipped',
        'PaymentController',
        { clinicId, appointmentId, subscriptionId, invoiceId, prescriptionId }
      );
    }

    try {
      // Use the clinic's payment config (primary provider from DB), not the
      // frontend-provided provider — this prevents clients from forcing
      // providers the clinic hasn't configured (e.g. sending "razorpay"
      // when the clinic's primary is "cashfree").
      const paymentIntent = await this.paymentService.createPaymentIntent(
        clinicId,
        {
          amount,
          currency,
          description: description || 'General payment',
          ...(appointmentId ? { appointmentId } : {}),
          ...(subscriptionId ? { subscriptionId } : {}),
          ...(invoiceId ? { invoiceId } : {}),
          ...(prescriptionId ? { prescriptionId } : {}),
          appointmentType: appointmentType || 'VIDEO_CALL',
          ...(customer.customerId ? { customerId: customer.customerId } : {}),
          ...(customer.customerPhone ? { customerPhone: customer.customerPhone } : {}),
          ...(customer.customerEmail ? { customerEmail: customer.customerEmail } : {}),
          ...(customer.customerName ? { customerName: customer.customerName } : {}),
          clinicId,
        } as import('@core/types').PaymentIntentOptions
        // No provider override — use clinic config
      );

      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.INFO,
        'Public payment intent created via bridge',
        'PaymentController',
        {
          clinicId,
          provider: 'clinic-default',
          appointmentId,
          subscriptionId,
          invoiceId,
          prescriptionId,
          amount,
        }
      );

      return { success: true, paymentIntent: paymentIntent as unknown as Record<string, unknown> };
    } catch (error) {
      await this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.ERROR,
        `Public payment intent creation failed: ${error instanceof Error ? error.message : String(error)}`,
        'PaymentController',
        { clinicId, provider, appointmentId, subscriptionId, invoiceId, prescriptionId, amount }
      );
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create payment intent.',
      };
    }
  }

  /**
   * Handoff callback handler — verifies the signed token and then
   * forwards to the billing service.
   * Called by the frontend after the payment provider redirects the user back.
   *
   * @public
   * @route POST /payments/callback/handoff
   * @param {string} [handoffToken] - Query parameter `handoff_token` - signed handoff JWT token issued during payment intent creation
   * @param {string} [orderId] - Query parameter `order_id` - order identifier (also embedded in handoff token)
   * @param {string} [paymentId] - Query parameter `payment_id` - payment identifier (also embedded in handoff token)
   * @param {string} [provider] - Query parameter `provider` - optional payment provider name
   * @returns {Promise<{ success: boolean; clinicId?: string; orderId?: string; paymentId?: string; provider?: string; appointmentId?: string; appointmentType?: string; message?: string; error?: string }>} On success: `{ success: true, clinicId, orderId, paymentId?, provider?, appointmentId?, appointmentType?, message }`. On auth failure: throws `UnauthorizedException`. On invalid input: throws `BadRequestException`
   * @description Verifies the handoff JWT token, checks for replay attacks using jti, forwards to billing service with timeout protection, and returns payment status with appointment context. Only returns `success: true` when payment status is `completed`
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
      const resolvedOrderId = verifiedPayload.orderId;
      const resolvedPaymentId = verifiedPayload.paymentId;
      const resolvedProvider = verifiedPayload.provider as PaymentProvider | undefined;
      const verificationPaymentId = resolvedPaymentId || resolvedOrderId;

      let paymentResultStatus = 'completed';
      if (verificationPaymentId) {
        const callbackResult = await this.withBillingTimeout(
          this.getBillingService().handlePaymentCallback(
            clinicId,
            verificationPaymentId,
            resolvedOrderId,
            resolvedProvider
          )
        );
        const resultRecord = (callbackResult as { payment?: unknown })?.payment as
          Record<string, unknown> | undefined;
        if (resultRecord?.['status'] && typeof resultRecord['status'] === 'string') {
          paymentResultStatus = String(resultRecord['status']).toLowerCase();
        }
      }

      // Only return success if payment is truly completed
      const isSuccessful = paymentResultStatus === 'completed';

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
          paymentStatus: paymentResultStatus,
          isSuccessful,
        }
      );

      return {
        success: isSuccessful,
        clinicId,
        orderId: resolvedOrderId,
        ...(verificationPaymentId ? { paymentId: verificationPaymentId } : {}),
        ...(resolvedProvider ? { provider: resolvedProvider } : {}),
        ...(verifiedPayload.appointmentId ? { appointmentId: verifiedPayload.appointmentId } : {}),
        ...(verifiedPayload.appointmentType
          ? { appointmentType: verifiedPayload.appointmentType }
          : {}),
        ...(isSuccessful
          ? { message: 'Payment callback processed successfully' }
          : { message: `Payment is ${paymentResultStatus}, not completed` }),
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

  // ===========================
  // Payment Provider Config Endpoints
  // ===========================

  private async assertPaymentConfigClinicScope(
    clinicId: string,
    request: FastifyRequest
  ): Promise<void> {
    const typedRequest = request as FastifyRequest & {
      clinicId?: string;
      user?: { role?: string };
    };
    if (typedRequest.user?.role === Role.SUPER_ADMIN && !typedRequest.clinicId) {
      return;
    }
    if (!typedRequest.clinicId) {
      throw new ForbiddenException('Clinic context is required for payment configuration.');
    }
    const routeClinicUUID = await resolveClinicUUID(this.databaseService, clinicId);
    if (routeClinicUUID !== typedRequest.clinicId) {
      throw new ForbiddenException(
        'Payment configuration clinic does not match the authenticated clinic.'
      );
    }
  }

  /**
   * Get clinic payment configuration
   */
  @Get('config/:clinicId')
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({ summary: 'Get clinic payment provider configuration' })
  @ApiResponse({
    status: 200,
    description: 'Payment config retrieved',
    type: ClinicPaymentConfigResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Clinic not found' })
  async getClinicPaymentConfig(
    @Param('clinicId') clinicId: string,
    @Req() request: FastifyRequest
  ): Promise<ClinicPaymentConfigResponseDto> {
    await this.assertPaymentConfigClinicScope(clinicId, request);
    await this.loggingService.log(
      LogType.PAYMENT,
      LogLevel.INFO,
      'Fetching clinic payment config',
      'PaymentController',
      { clinicId }
    );

    const config = await this.paymentConfigService.getClinicConfig(clinicId);

    if (!config) {
      throw new BadRequestException('Payment configuration not found for clinic');
    }

    return this.mapConfigToResponse(config);
  }

  /**
   * Update clinic payment configuration
   */
  @Put('config/:clinicId')
  @UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, RbacGuard)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({ summary: 'Update clinic payment provider configuration' })
  @ApiResponse({
    status: 200,
    description: 'Payment config updated',
    type: ClinicPaymentConfigResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid configuration' })
  @ApiResponse({ status: 404, description: 'Clinic not found' })
  async updateClinicPaymentConfig(
    @Param('clinicId') clinicId: string,
    @Body() dto: UpdateClinicPaymentConfigDto,
    @Req() request: FastifyRequest
  ): Promise<ClinicPaymentConfigResponseDto> {
    await this.assertPaymentConfigClinicScope(clinicId, request);
    await this.loggingService.log(
      LogType.PAYMENT,
      LogLevel.INFO,
      'Updating clinic payment config',
      'PaymentController',
      { clinicId, primaryProvider: dto.primary?.provider }
    );

    const existingConfig = await this.paymentConfigService.getClinicConfig(clinicId);

    if (!existingConfig) {
      throw new BadRequestException('Payment configuration not found for clinic');
    }

    const mergeCredentials = (
      existing: Record<string, string> | undefined,
      incoming: Record<string, string>
    ): Record<string, string> => {
      const merged = {
        ...(existing || {}),
        ...Object.fromEntries(
          Object.entries(incoming || {}).filter(
            ([, value]) => typeof value === 'string' && value.trim().length > 0
          )
        ),
      };

      // The admin DTO uses provider-specific names while adapters consume
      // provider-neutral names. Normalize once at the persistence boundary.
      if (merged['cashfreeAppId']) merged['appId'] = merged['cashfreeAppId'];
      if (merged['cashfreeSecretKey']) merged['secretKey'] = merged['cashfreeSecretKey'];
      if (merged['phonepeClientId']) merged['clientId'] = merged['phonepeClientId'];
      if (merged['phonepeClientSecret']) merged['clientSecret'] = merged['phonepeClientSecret'];
      return merged;
    };

    const existingPrimary = existingConfig.payment.primary;
    const primary = {
      ...dto.primary,
      credentials: mergeCredentials(
        existingPrimary?.provider === dto.primary.provider
          ? existingPrimary.credentials
          : undefined,
        dto.primary.credentials
      ),
    };
    const existingFallback = existingConfig.payment.fallback || [];
    const fallback = (dto.fallback || []).map(entry => {
      const existing = existingFallback.find(item => item.provider === entry.provider);
      return {
        ...entry,
        credentials: mergeCredentials(existing?.credentials, entry.credentials),
      };
    });

    const updatedConfig = {
      clinicId,
      payment: {
        primary,
        fallback,
        defaultCurrency: dto.defaultCurrency ?? existingConfig.payment.defaultCurrency,
        defaultProvider: dto.defaultProvider ?? existingConfig.payment.defaultProvider,
      },
      createdAt: existingConfig.createdAt,
      updatedAt: new Date(),
    } as unknown as ClinicPaymentConfig;

    await this.paymentConfigService.saveClinicConfig(updatedConfig);

    const freshConfig = await this.paymentConfigService.getClinicConfig(clinicId);
    if (!freshConfig) {
      return this.mapConfigToResponse(updatedConfig);
    }
    return this.mapConfigToResponse(freshConfig);
  }

  /**
   * Verify payment provider credentials
   * Performs a lightweight format/configuration check without hitting provider APIs
   */
  @Post('config/verify')
  @UseGuards(JwtAuthGuard, RolesGuard, RbacGuard)
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({ summary: 'Verify payment provider credentials (format check)' })
  @ApiResponse({
    status: 200,
    description: 'Verification result',
    type: VerifyPaymentProviderResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async verifyPaymentProvider(
    @Body() dto: VerifyPaymentProviderDto
  ): Promise<VerifyPaymentProviderResponseDto> {
    await this.loggingService.log(
      LogType.PAYMENT,
      LogLevel.INFO,
      'Verifying payment provider credentials',
      'PaymentController',
      { provider: dto.provider }
    );

    const { provider, credentials } = dto;
    const missing: string[] = [];

    switch (provider) {
      case PaymentProvider.RAZORPAY:
        if (!credentials['razorpayKeyId']) missing.push('razorpayKeyId');
        if (!credentials['razorpayKeySecret']) missing.push('razorpayKeySecret');
        break;
      case PaymentProvider.CASHFREE:
        if (!credentials['cashfreeAppId']) missing.push('cashfreeAppId');
        if (!credentials['cashfreeSecretKey']) missing.push('cashfreeSecretKey');
        break;
      case PaymentProvider.PHONEPE:
        if (!credentials['phonepeClientId']) missing.push('phonepeClientId');
        if (!credentials['phonepeClientSecret']) missing.push('phonepeClientSecret');
        if (!credentials['phonepeSalt']) missing.push('phonepeSalt');
        break;
      default:
        return { valid: false, error: `Provider ${provider} verification not yet implemented` };
    }

    if (missing.length > 0) {
      return {
        valid: false,
        error: `Missing required fields: ${missing.join(', ')}`,
      };
    }

    return {
      valid: true,
      details: 'Credential format validated successfully',
    };
  }

  /**
   * Map internal config to sanitized response DTO
   */
  private mapConfigToResponse(config: ClinicPaymentConfig): ClinicPaymentConfigResponseDto {
    const mapProvider = (
      p:
        | {
            provider: PaymentProvider;
            enabled: boolean;
            credentials: Record<string, string>;
            priority?: number;
          }
        | undefined
    ): PaymentProviderResponseDto => {
      const result: PaymentProviderResponseDto = {
        provider: p?.provider || PaymentProvider.CASHFREE,
        enabled: p?.enabled || false,
        hasCredentials: !!(p?.credentials && Object.keys(p.credentials).length > 0),
        providerName: p?.provider
          ? p.provider.charAt(0).toUpperCase() + p.provider.slice(1)
          : 'Unknown',
      };
      if (p?.priority) {
        result.priority = p.priority;
      }
      return result;
    };

    const result: ClinicPaymentConfigResponseDto = {
      clinicId: config.clinicId,
      primary: mapProvider(config.payment.primary),
      fallback: (config.payment.fallback || []).map(mapProvider),
    };
    if (config.payment.defaultCurrency) {
      result.defaultCurrency = config.payment.defaultCurrency;
    }
    if (config.payment.defaultProvider) {
      result.defaultProvider = config.payment.defaultProvider;
    }
    return result;
  }
}
