/**
 * Payment Handoff Token Service
 * =============================
 * Secure token generation and verification for payment callbacks
 * Implements enhanced security with token integrity and anti-replay protection
 *
 * @module PaymentHandoffTokenService
 * @description Generates and verifies secure payment callback tokens
 */

import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomBytes, timingSafeEqual as nodeTimingSafeEqual } from 'crypto';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@logging';
import { LogType, LogLevel } from '@core/types';
import { PaymentProvider } from '@core/types/payment.types';

export interface PaymentHandoffPayload {
  orderId: string;
  paymentId?: string;
  appointmentId?: string;
  appointmentType?: string;
  clinicId: string;
  provider: string;
  iat: number; // Issued at - standard JWT claim
  exp: number; // Expiration - standard JWT claim
  jti: string; // Unique token ID for idempotency
  version?: string; // Token version for future upgrades
  integrity?: string; // HMAC integrity hash
}

export interface PaymentHandoffTokenResult {
  token: string;
  expiresAt: Date;
  frontendCallbackUrlWithToken: string;
}

/**
 * Token lifetime in seconds (5 minutes)
 * Enough for user to complete payment, short enough to prevent replay
 */
const HANDOFF_TOKEN_TTL_SECONDS = 300;

@Injectable()
export class PaymentHandoffTokenService {
  private readonly SECRET_KEY =
    process.env['PAYMENT_HANDOFF_JWT_SECRET'] || process.env['JWT_SECRET'] || 'fallback-secret';

  constructor(
    private readonly jwtService: JwtService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService
  ) {
    // Validate JWT secret on startup
    if (this.SECRET_KEY === 'fallback-secret') {
      const isProduction = process.env['NODE_ENV'] === 'production';
      if (isProduction) {
        throw new Error('PAYMENT_HANDOFF_JWT_SECRET is required in production environment');
      }
      void this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.WARN,
        'Using fallback JWT secret - configure PAYMENT_HANDOFF_JWT_SECRET',
        'PaymentHandoffTokenService'
      );
    }
  }

  /**
   * Generate a secure payment handoff token
   * Enhanced with integrity checks and anti-replay protection
   */
  async generateHandoffToken(params: {
    orderId: string;
    paymentId?: string;
    appointmentId?: string;
    appointmentType?: string;
    clinicId: string;
    provider?: PaymentProvider;
    frontendCallbackBase: string;
  }): Promise<PaymentHandoffTokenResult> {
    await Promise.resolve();
    const now = Math.floor(Date.now() / 1000);
    const exp = now + HANDOFF_TOKEN_TTL_SECONDS;
    const jti = randomBytes(16).toString('hex');

    const payload: PaymentHandoffPayload = {
      orderId: params.orderId,
      clinicId: params.clinicId,
      provider: params.provider || 'razorpay',
      iat: now,
      exp,
      jti,
      version: '1.0',
      ...(params.paymentId ? { paymentId: params.paymentId } : {}),
      ...(params.appointmentId ? { appointmentId: params.appointmentId } : {}),
      ...(params.appointmentType ? { appointmentType: params.appointmentType } : {}),
    };

    // Generate HMAC integrity signature using all sensitive fields
    const integrityHash = this.generateHmac(payload);
    const payloadWithIntegrity = {
      ...payload,
      integrity: integrityHash,
    };

    // Sign the token with the handoff-specific secret
    const token = this.jwtService.sign(payloadWithIntegrity, {
      expiresIn: HANDOFF_TOKEN_TTL_SECONDS,
      secret: this.SECRET_KEY,
      jwtid: jti,
    });

    // Build callback URL with token
    const callbackUrl = new URL(params.frontendCallbackBase);
    callbackUrl.searchParams.set('handoff_token', token);

    void this.loggingService.log(
      LogType.PAYMENT,
      LogLevel.DEBUG,
      'Generated payment handoff token',
      'PaymentHandoffTokenService',
      {
        orderId: params.orderId,
        appointmentId: params.appointmentId,
        clinicId: params.clinicId,
        expiresAt: new Date(exp * 1000).toISOString(),
        jti,
      }
    );

    return {
      token,
      expiresAt: new Date(exp * 1000),
      frontendCallbackUrlWithToken: callbackUrl.toString(),
    };
  }

  /**
   * Verify and decode a payment handoff token
   * Enhanced with integrity checks and anti-replay protection
   * Returns null if invalid, expired, tampered, or potentially replayed
   */
  async verifyHandoffToken(token: string): Promise<PaymentHandoffPayload | null> {
    try {
      await Promise.resolve();
      const payload = this.jwtService.verify<PaymentHandoffPayload>(token, {
        secret: this.SECRET_KEY,
      });

      // Validate required fields
      if (!payload.orderId || !payload.clinicId || !payload.jti || !payload.iat || !payload.exp) {
        void this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'Payment handoff token missing required fields',
          'PaymentHandoffTokenService',
          { payloadKeys: Object.keys(payload) }
        );
        return null;
      }

      // Check expiration
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp < now) {
        void this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'Payment handoff token expired',
          'PaymentHandoffTokenService',
          { orderId: payload.orderId, expiredAt: new Date(payload.exp * 1000).toISOString() }
        );
        return null;
      }

      // Validate token version
      if (payload.version !== '1.0') {
        void this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'Payment handoff token version not supported',
          'PaymentHandoffTokenService',
          { version: payload.version }
        );
        return null;
      }

      // Validate integrity hash
      if (!payload.integrity) {
        void this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'Payment handoff token missing integrity hash',
          'PaymentHandoffTokenService',
          { orderId: payload.orderId }
        );
        return null;
      }

      const calculatedHash = this.generateHmac(payload);
      if (!this.timingSafeEqual(payload.integrity, calculatedHash)) {
        void this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'Payment handoff token integrity check failed',
          'PaymentHandoffTokenService',
          { orderId: payload.orderId }
        );
        return null;
      }

      const replayKey = `payment-handoff:jti:${payload.jti}`;
      const ttlRemaining = Math.max(payload.exp - now, 1);
      const acquired = await this.cacheService.acquireLock(replayKey, ttlRemaining, '1');
      if (!acquired) {
        void this.loggingService.log(
          LogType.PAYMENT,
          LogLevel.WARN,
          'Payment handoff token replay detected',
          'PaymentHandoffTokenService',
          { orderId: payload.orderId, jti: payload.jti }
        );
        return null;
      }

      return payload;
    } catch (error) {
      void this.loggingService.log(
        LogType.PAYMENT,
        LogLevel.WARN,
        'Payment handoff token verification failed',
        'PaymentHandoffTokenService',
        { error: error instanceof Error ? error.message : 'Unknown error' }
      );
      return null;
    }
  }

  /**
   * Release a replay lock for a token jti.
   * Used only when downstream payment processing fails after the token was consumed.
   */
  async releaseReplayToken(jti: string): Promise<boolean> {
    if (!jti) {
      return false;
    }

    return this.cacheService.releaseLock(`payment-handoff:jti:${jti}`);
  }

  /**
   * Extract payment handoff token from callback URL
   * Supports both query param and hash fragment
   */
  extractTokenFromCallbackParams(params: URLSearchParams | Record<string, string>): string | null {
    // Try query parameter first
    if (params instanceof URLSearchParams) {
      return params.get('handoff_token');
    }
    // Handle Record<string, string>
    return params['handoff_token'] || null;
  }

  /**
   * Generate HMAC integrity hash for sensitive token payload
   * Ensures token hasn't been tampered with
   */
  private generateHmac(payload: PaymentHandoffPayload): string {
    // Extract sensitive fields for HMAC calculation
    const sensitiveData = {
      jti: payload.jti,
      clinicId: payload.clinicId,
      orderId: payload.orderId,
      exp: payload.exp,
      iat: payload.iat,
      paymentId: payload.paymentId,
      appointmentId: payload.appointmentId,
      appointmentType: payload.appointmentType,
    };

    // Create HMAC using all payload fields except the integrity field itself
    const hmac = createHmac('sha256', this.SECRET_KEY);
    hmac.update(JSON.stringify(sensitiveData, Object.keys(sensitiveData).sort()));
    return hmac.digest('hex');
  }

  /**
   * Compare strings in constant time to prevent timing attacks
   */
  private timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    return nodeTimingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  }
}
