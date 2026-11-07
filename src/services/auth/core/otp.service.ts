import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { randomInt } from 'crypto';
import { nowIso } from '@utils/date-time.util';
import { CacheService } from '@infrastructure/cache/cache.service';
import { WhatsAppService } from '@communication/channels/whatsapp/whatsapp.service';
import { EmailService } from '@communication/channels/email/email.service';
import { CHANNEL_DISABLED_REASON } from '@communication/services/notification-delivery-plan.util';
import { ConfigService } from '@config/config.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { EventService } from '@infrastructure/events/event.service';
import { LogType, LogLevel } from '@core/types';
import { EmailTemplate } from '@core/types/common.types';
import { QueueService } from '@infrastructure/queue';
import { normalizeAuthPhoneNumber } from './phone-normalizer.util';
import { ReviewLoginService } from './review-login.service';

import type { OtpConfig, OtpResult } from '@core/types/auth.types';
import { withRetryWait } from '@security/rate-limit/retry-wait.util';

type OtpCacheEntry = {
  otp: string;
  createdAt: string;
};

type VerifiedOtpCacheEntry = {
  otp: string;
  verifiedAt: string;
};

@Injectable()
export class OtpService {
  private readonly config: OtpConfig;
  private readonly otpDebugEnabled: boolean;
  private readonly isDevelopment: boolean;
  private readonly REQUESTS_PER_STAGE = 3;
  private readonly VERIFIED_OTP_TTL_SECONDS = 60;
  /**
   * Per-identifier brute-force lockout (audit P0-6): after `maxAttempts` wrong codes within
   * `lockoutSeconds`, the current OTP is deleted and the identifier can neither verify nor
   * request a new code until the lockout expires. Keyed by the normalised phone/email only, so
   * changing IP or User-Agent does not reset it.
   */
  private readonly lockoutSeconds: number;

  /**
   * Progressive cooldown schedule (seconds) indexed by stage count.
   * Each stage allows 3 OTP requests, then applies the next cooldown.
   * Stages:
   *   0 -> 0 min
   *   1 -> 3 min
   *   2 -> 5 min
   *   3 -> 10 min
   *   4 -> 15 min
   *   5 -> 25 min
   *   6 -> 30 min
   *   7 -> 45 min
   *   8 -> 60 min
   * The final value is repeated for all later stages.
   */
  private readonly PROGRESSIVE_COOLDOWNS = [0, 180, 300, 600, 900, 1500, 1800, 2700, 3600];

  constructor(
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => EmailService))
    private readonly emailService: EmailService,
    @Inject(forwardRef(() => QueueService))
    private readonly queueService: QueueService,
    @Inject(forwardRef(() => WhatsAppService))
    private readonly whatsAppService: WhatsAppService,
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => EventService))
    private readonly eventService: EventService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => ReviewLoginService))
    private readonly reviewLoginService: ReviewLoginService
  ) {
    // Use ConfigService (which uses dotenv) for all environment variable access
    this.config = {
      length: this.configService.getEnvNumber('OTP_LENGTH', 6),
      expiryMinutes: this.configService.getEnvNumber('OTP_EXPIRY_MINUTES', 10),
      maxAttempts: this.configService.getEnvNumber('OTP_MAX_ATTEMPTS', 5),
      cooldownMinutes: this.configService.getEnvNumber('OTP_COOLDOWN_MINUTES', 3),
    };
    this.lockoutSeconds = Math.max(
      60,
      this.configService.getEnvNumber('OTP_LOCKOUT_MINUTES', 15) * 60
    );

    this.otpDebugEnabled =
      this.configService.getEnvBoolean('ENABLE_OTP_DEBUG', false) ||
      this.configService.getEnvBoolean('DEBUG_MODE', false);

    this.isDevelopment = this.configService.isDevelopment();
  }

  private normalizeIdentifier(identifier: string): string {
    const trimmed = identifier.trim();

    if (trimmed.includes('@')) {
      return trimmed.toLowerCase();
    }

    return normalizeAuthPhoneNumber(trimmed);
  }

  private normalizeOtpValue(otp: string): string {
    return otp.trim().replace(/\D/g, '');
  }

  private debugOtp(message: string, context: Record<string, unknown> = {}): void {
    if (!this.otpDebugEnabled) {
      return;
    }

    // Use structured logging instead of console.warn for HIPAA compliance
    void this.loggingService.log(
      LogType.AUTH,
      LogLevel.DEBUG,
      `[OTP DEBUG] ${message}`,
      'OtpService',
      context
    );
  }

  private logOtp(message: string, context: Record<string, unknown> = {}): void {
    if (!this.otpDebugEnabled) {
      return;
    }

    void this.loggingService.log(LogType.AUTH, LogLevel.DEBUG, message, 'OtpService', context);
    void this.eventService.emit('auth.otp.diagnostic', {
      source: 'OtpService',
      message,
      context,
      timestamp: nowIso(),
    });
  }

  /**
   * Log full OTP for local testing. Active ONLY when ENABLE_OTP_DEBUG=true AND
   * NODE_ENV=development (a stray ENABLE_OTP_DEBUG in staging / prod must never print OTPs; the
   * LoggingService also drops `[OTP DEV]` lines outside development as a second guard).
   *
   * The line format `identifier=<phone> OTP=<code>` is read by the local QA tooling from the
   * terminal (docker logs), so it stays verbatim there; the LoggingService masks the phone and
   * the code in every stored copy, and the metadata below carries neither.
   */
  private logDevOtp(identifier: string, otp: string, channel: string, purpose: string): void {
    if (!this.isDevOtpLogEnabled()) {
      return;
    }

    void this.loggingService.log(
      LogType.AUTH,
      LogLevel.WARN,
      `[OTP DEV] channel=${channel} purpose=${purpose} identifier=${identifier} OTP=${otp}`,
      'OtpService',
      { channel, purpose }
    );
  }

  private isDevOtpLogEnabled(): boolean {
    return (
      this.configService.getEnvBoolean('ENABLE_OTP_DEBUG', false) &&
      this.configService.isDevelopment()
    );
  }

  /**
   * The channel's provider is switched off in this environment: the OTP is NOT delivered (it
   * stays in the cache, so login still works with the code from the `[OTP DEV]` log line in
   * development). Logged as a distinct "not sent" outcome, never as a successful send.
   */
  private logOtpChannelDisabled(channel: 'WhatsApp' | 'Email', purpose: string): void {
    const outcome = this.isDevOtpLogEnabled()
      ? 'available in dev log only'
      : 'enable the provider to deliver it';
    void this.loggingService.log(
      LogType.AUTH,
      LogLevel.INFO,
      `OTP not delivered: ${channel} disabled; ${outcome}`,
      'OtpService',
      {
        channel: channel.toLowerCase(),
        purpose,
        skipped: true,
        skipReason: CHANNEL_DISABLED_REASON,
      }
    );
  }

  private buildOtpCacheEntry(otp: string): OtpCacheEntry {
    return {
      otp,
      createdAt: nowIso(),
    };
  }

  private buildVerifiedOtpCacheEntry(otp: string): VerifiedOtpCacheEntry {
    return {
      otp,
      verifiedAt: nowIso(),
    };
  }

  private extractOtpValue(value: unknown): string | null {
    if (typeof value === 'string') {
      return value.length > 0 ? value : null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      const otpValue = record['otp'] ?? record['value'] ?? record['code'];
      if (typeof otpValue === 'string') {
        const trimmed = otpValue.trim();
        return trimmed.length > 0 ? trimmed : null;
      }
      if (typeof otpValue === 'number' && Number.isFinite(otpValue)) {
        return String(otpValue);
      }
    }

    return null;
  }

  private maskOtpValue(otp: string | null): string | null {
    if (!otp) {
      return null;
    }

    return otp.length > 1
      ? `${otp.slice(0, 1)}${'*'.repeat(Math.max(otp.length - 2, 0))}${otp.slice(-1)}`
      : otp;
  }

  /**
   * Get progressive cooldown duration in seconds based on successful request count.
   * Every 3 requests advance to the next cooldown stage.
   */
  private getProgressiveCooldown(requestCount: number): number {
    const stageIndex = Math.min(
      Math.max(0, Math.floor(Math.max(0, requestCount - 1) / this.REQUESTS_PER_STAGE)),
      this.PROGRESSIVE_COOLDOWNS.length - 1
    );
    const index = stageIndex;
    return this.PROGRESSIVE_COOLDOWNS[index] || 0;
  }

  private getRequestsRemainingInStage(requestCount: number): number {
    if (requestCount <= 0) {
      return this.REQUESTS_PER_STAGE;
    }

    const positionInStage = ((requestCount - 1) % this.REQUESTS_PER_STAGE) + 1;
    return Math.max(0, this.REQUESTS_PER_STAGE - positionInStage);
  }

  private otpFailuresKey(normalizedIdentifier: string): string {
    return `otp_verify_failures:${normalizedIdentifier}`;
  }

  private otpLockoutKey(normalizedIdentifier: string): string {
    return `otp_lockout:${normalizedIdentifier}`;
  }

  /**
   * Run raw commands on the cache connection. The failure counter and the lockout flag use
   * raw keys on purpose: CacheService.get/set/del/ttl version their keys (`<key>:v1`) while
   * incr/expire do not, so mixing them (as the previous counter did) read and deleted a
   * different key than the one INCR wrote, and the counter never took effect.
   */
  private async rawCommands(
    commands: Array<{ command: string; args: Array<string | number> }>
  ): Promise<Array<number | string | null>> {
    const results = await this.cacheService.multi(commands);
    return results.map(([error, value]) => {
      if (error || value === undefined || value === null) {
        return null;
      }
      return typeof value === 'number' || typeof value === 'string' ? value : null;
    });
  }

  /**
   * Atomically counts a wrong code for this identifier (INCR) inside one pipeline with TTL,
   * re-applying the TTL whenever the key has none, so a crash between INCR and EXPIRE can never
   * leave a counter that never expires. The window is the lockout length and is NOT reset by
   * requesting a new OTP, so re-sending cannot be used to get fresh guesses.
   */
  private async recordOtpVerifyFailure(normalizedIdentifier: string): Promise<number> {
    const key = this.otpFailuresKey(normalizedIdentifier);
    const [count, ttl] = await this.rawCommands([
      { command: 'incr', args: [key] },
      { command: 'ttl', args: [key] },
    ]);
    if (typeof ttl === 'number' && ttl < 0) {
      await this.rawCommands([{ command: 'expire', args: [key, this.lockoutSeconds] }]);
    }
    return typeof count === 'number' ? count : Number.parseInt(String(count ?? '0'), 10) || 0;
  }

  /** Seconds left on this identifier's lockout, 0 when not locked. */
  async getOtpLockoutRemainingSeconds(identifier: string): Promise<number> {
    const normalizedIdentifier = this.normalizeIdentifier(identifier);
    const key = this.otpLockoutKey(normalizedIdentifier);
    const [ttl] = await this.rawCommands([{ command: 'ttl', args: [key] }]);
    if (typeof ttl !== 'number' || ttl === -2) {
      return 0;
    }
    if (ttl === -1) {
      // Lockout flag without TTL (should never happen): repair it rather than lock forever.
      await this.rawCommands([{ command: 'expire', args: [key, this.lockoutSeconds] }]);
      return this.lockoutSeconds;
    }
    return ttl;
  }

  private buildLockoutResult(remainingSeconds: number): OtpResult {
    return {
      success: false,
      // Says when the patient may retry, not just "later".
      message: withRetryWait('Too many incorrect codes', remainingSeconds),
      rateLimited: true,
      attemptsRemaining: 0,
    };
  }

  /** Lock the identifier and burn the current code (and any just-verified replay entry). */
  private async lockOutIdentifier(normalizedIdentifier: string): Promise<void> {
    await Promise.all([
      this.rawCommands([
        {
          command: 'set',
          args: [this.otpLockoutKey(normalizedIdentifier), '1', 'EX', this.lockoutSeconds],
        },
        { command: 'del', args: [this.otpFailuresKey(normalizedIdentifier)] },
      ]),
      this.cacheService.del(`otp:${normalizedIdentifier}`),
      this.cacheService.del(`otp_verified:${normalizedIdentifier}`),
    ]);
  }

  async peekOtp(identifier: string): Promise<string | null> {
    const normalizedIdentifier = this.normalizeIdentifier(identifier);
    const otpKey = `otp:${normalizedIdentifier}`;
    const storedOtp = this.extractOtpValue(await this.cacheService.get<unknown>(otpKey));
    const cacheExists = await this.cacheService.exists(otpKey);
    const cacheTtl = await this.cacheService.ttl(otpKey);
    const hasValidOtp = typeof storedOtp === 'string' && storedOtp.length > 0;

    this.logOtp('OTP peek before request', {
      identifier: normalizedIdentifier,
      otpKey,
      cacheExists,
      cacheTtl,
      hasStoredOtp: hasValidOtp,
      storedOtpLength: hasValidOtp ? storedOtp.length : 0,
      storedOtp: this.maskOtpValue(storedOtp),
    });

    return hasValidOtp ? storedOtp : null;
  }

  // ... (generateOtp and sendOtpEmail remain unchanged) ...

  /**
   * Generate OTP
   */
  generateOtp(): string {
    const min = Math.pow(10, this.config.length - 1);
    const max = Math.pow(10, this.config.length);
    // CSPRNG: Math.random() is predictable and must not mint login codes.
    return String(randomInt(min, max));
  }

  /**
   * Send OTP via email
   */
  async sendOtpEmail(
    email: string,
    name: string,
    purpose: string = 'verification',
    clinicId?: string,
    providedOtp?: string
  ): Promise<OtpResult> {
    try {
      const normalizedEmail = this.normalizeIdentifier(email);
      const lockoutRemaining = await this.getOtpLockoutRemainingSeconds(normalizedEmail);
      if (lockoutRemaining > 0) {
        return this.buildLockoutResult(lockoutRemaining);
      }
      // Read cooldown + attempts in parallel to avoid extra round-trips.
      const cooldownKey = `otp_cooldown:${normalizedEmail}`;
      const attemptsKey = `otp_attempts:${normalizedEmail}`;
      const [cooldown, attempts] = await Promise.all([
        this.cacheService.get<string>(cooldownKey),
        this.cacheService.get<string>(attemptsKey),
      ]);

      if (cooldown) {
        const remainingTtl = await this.cacheService.ttl(cooldownKey);
        return {
          success: false,
          message: withRetryWait(
            'A code was just sent. Please wait before requesting another OTP',
            remainingTtl > 0 ? remainingTtl : 60
          ),
          rateLimited: true,
        };
      }

      const attemptCount = attempts ? parseInt(attempts) : 0;

      // Generate and store OTP
      const otp = providedOtp || this.generateOtp();
      const otpKey = `otp:${normalizedEmail}`;
      const expirySeconds = this.config.expiryMinutes * 60;
      const otpEntry = this.buildOtpCacheEntry(otp);

      // Dev-only: log full OTP for testing
      this.logDevOtp(normalizedEmail, otp, 'email', purpose);

      this.logOtp('Email OTP generated and cached', {
        normalizedEmail,
        purpose,
        otpKey,
        otpLength: otp.length,
        otp: otp.length
          ? `${otp.slice(0, 1)}${'*'.repeat(Math.max(otp.length - 2, 0))}${otp.slice(-1)}`
          : null,
      });

      const newAttemptCount = attemptCount + 1;
      const cooldownSeconds = this.getProgressiveCooldown(newAttemptCount);

      await Promise.all([
        this.cacheService.del(`otp_verified:${normalizedEmail}`),
        this.cacheService.del(`otp_verify_attempts:${normalizedEmail}`),
        this.cacheService.set(otpKey, otpEntry, expirySeconds),
        this.cacheService.set(attemptsKey, newAttemptCount.toString(), 60 * 60), // 1 hour
        cooldownSeconds > 0
          ? this.cacheService.set(cooldownKey, '1', cooldownSeconds)
          : Promise.resolve(),
      ]);

      if (this.otpDebugEnabled) {
        const storedOtp = this.extractOtpValue(await this.cacheService.get<unknown>(otpKey));
        this.logOtp('Email OTP stored in cache', {
          normalizedEmail,
          otpKey,
          expirySeconds,
          otpLength: otp.length,
          storedOtp: this.maskOtpValue(storedOtp),
          storedOtpMatches: storedOtp === otp,
        });
      }

      const emailJobData = {
        to: email,
        subject: 'Your OTP Code',
        template: EmailTemplate.OTP_LOGIN,
        context: {
          name,
          otp,
        },
        ...(clinicId && { clinicId }),
      };

      // Send email DIRECTLY (not via queue) - queue workers may not be running in clinic service
      try {
        const sent = this.emailService.isEnabled()
          ? await this.emailService.sendEmail(emailJobData)
          : null;
        if (sent === null) {
          this.logOtpChannelDisabled('Email', purpose);
        } else if (!sent) {
          void this.loggingService.log(
            LogType.ERROR,
            LogLevel.ERROR,
            `Failed to send email OTP for ${email}`,
            'OtpService',
            { email: normalizedEmail }
          );
          // Don't throw - still return success since OTP is in cache
          // User can verify with cached OTP if needed
        } else {
          void this.loggingService.log(
            LogType.AUTH,
            LogLevel.INFO,
            `Email OTP sent directly for ${email}`,
            'OtpService',
            { email: normalizedEmail, purpose }
          );
        }
      } catch (emailError) {
        void this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          `Failed to send email OTP for ${email}: ${emailError instanceof Error ? emailError.message : String(emailError)}`,
          'OtpService',
          { email: normalizedEmail }
        );
        // Don't throw - OTP is in cache, user can still verify
      }

      void this.loggingService.log(
        LogType.AUTH,
        LogLevel.INFO,
        `OTP issued to ${email} for ${purpose}`,
        'OtpService',
        { email: normalizedEmail, purpose }
      );

      return {
        success: true,
        message: 'OTP sent successfully',
        otp,
        expiresIn: expirySeconds,
        attemptsRemaining: this.getRequestsRemainingInStage(newAttemptCount),
      };
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to send OTP to ${email}`,
        'OtpService',
        {
          email,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : 'No stack trace available',
        }
      );
      return {
        success: false,
        message: 'Failed to send OTP. Please try again.',
      };
    }
  }

  /**
   * Send OTP via phone (WhatsApp) for login/registration
   */
  async sendOtpPhone(
    phone: string,
    purpose: string = 'verification',
    clinicId?: string,
    providedOtp?: string
  ): Promise<OtpResult> {
    try {
      const normalizedPhone = this.normalizeIdentifier(phone);
      const lockoutRemaining = await this.getOtpLockoutRemainingSeconds(normalizedPhone);
      if (lockoutRemaining > 0) {
        return this.buildLockoutResult(lockoutRemaining);
      }
      // Read cooldown + attempts in parallel to avoid extra round-trips.
      const cooldownKey = `otp_cooldown:${normalizedPhone}`;
      const attemptsKey = `otp_attempts:${normalizedPhone}`;
      const [cooldown, attempts] = await Promise.all([
        this.cacheService.get<string>(cooldownKey),
        this.cacheService.get<string>(attemptsKey),
      ]);

      if (cooldown) {
        const remainingTtl = await this.cacheService.ttl(cooldownKey);
        return {
          success: false,
          message: withRetryWait(
            'A code was just sent. Please wait before requesting another OTP',
            remainingTtl > 0 ? remainingTtl : 60
          ),
          rateLimited: true,
        };
      }

      const attemptCount = attempts ? parseInt(attempts) : 0;

      // Generate and store OTP (reusing email logic logic but with phone key)
      const otp = providedOtp || this.generateOtp();
      const otpKey = `otp:${normalizedPhone}`;
      const expirySeconds = this.config.expiryMinutes * 60;
      const otpEntry = this.buildOtpCacheEntry(otp);

      // Dev-only: log full OTP for testing
      this.logDevOtp(normalizedPhone, otp, 'whatsapp', purpose);

      this.logOtp('WhatsApp OTP generated and cached', {
        normalizedPhone,
        purpose,
        otpKey,
        otpLength: otp.length,
        otp: otp.length
          ? `${otp.slice(0, 1)}${'*'.repeat(Math.max(otp.length - 2, 0))}${otp.slice(-1)}`
          : null,
      });

      const newAttemptCount = attemptCount + 1;
      const cooldownSeconds = this.getProgressiveCooldown(newAttemptCount);

      await Promise.all([
        this.cacheService.del(`otp_verified:${normalizedPhone}`),
        this.cacheService.del(`otp_verify_attempts:${normalizedPhone}`),
        this.cacheService.set(otpKey, otpEntry, expirySeconds),
        this.cacheService.set(attemptsKey, newAttemptCount.toString(), 60 * 60), // 1 hour
        cooldownSeconds > 0
          ? this.cacheService.set(cooldownKey, '1', cooldownSeconds)
          : Promise.resolve(),
      ]);

      if (this.otpDebugEnabled) {
        const storedOtp = this.extractOtpValue(await this.cacheService.get<unknown>(otpKey));
        this.logOtp('WhatsApp OTP stored in cache', {
          normalizedPhone,
          otpKey,
          expirySeconds,
          otpLength: otp.length,
          storedOtp: this.maskOtpValue(storedOtp),
          storedOtpMatches: storedOtp === otp,
        });
      }

      // WhatsApp switched off in this environment: nothing is scheduled, so log the real
      // outcome (not delivered) instead of a misleading "delivery scheduled" line.
      if (!this.whatsAppService.isEnabled()) {
        this.logOtpChannelDisabled('WhatsApp', purpose);
        return this.buildPhoneOtpSuccess(otp, expirySeconds, newAttemptCount);
      }

      // Fire-and-forget delivery so the request can complete immediately after
      // the OTP is persisted. This prevents the login UI from hanging on slow
      // WhatsApp/provider responses while still keeping the OTP available for
      // verification as soon as the request succeeds.
      void this.dispatchOtpSmsDelivery(normalizedPhone, otp, clinicId, purpose).catch(error => {
        void this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          `Background WhatsApp OTP delivery failed for ${normalizedPhone}`,
          'OtpService',
          {
            phone: normalizedPhone,
            purpose,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : 'No stack trace available',
          }
        );
      });

      void this.loggingService.log(
        LogType.AUTH,
        LogLevel.INFO,
        `OTP delivery scheduled via WhatsApp for ${normalizedPhone}`,
        'OtpService',
        { phone: normalizedPhone, purpose }
      );

      return this.buildPhoneOtpSuccess(otp, expirySeconds, newAttemptCount);
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to send WhatsApp OTP to ${phone}`,
        'OtpService',
        {
          phone,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : 'No stack trace available',
        }
      );
      return {
        success: false,
        message: 'Failed to send WhatsApp message. Please try again later.',
      };
    }
  }

  /** Success result for a phone OTP that is issued and cached (delivery is logged separately). */
  private buildPhoneOtpSuccess(
    otp: string,
    expirySeconds: number,
    attemptCount: number
  ): OtpResult {
    return {
      success: true,
      message: 'OTP sent successfully',
      otp,
      expiresIn: expirySeconds,
      attemptsRemaining: this.getRequestsRemainingInStage(attemptCount),
    };
  }

  /**
   * Stores the review code when `phone` is the live review number (set by a super admin), without
   * sending anything. Returns null for any other number or when the review login is off, so the
   * caller delivers a normal OTP. Verification is the ordinary verifyOtp path, so the wrong-code
   * lockout still applies. The request cooldown is skipped because nothing is delivered and
   * reviewers may retry from several devices.
   */
  async issueReviewLoginOtp(phone: string): Promise<OtpResult | null> {
    const normalizedPhone = this.normalizeIdentifier(phone);
    let reviewLogin: { phone: string; otp: string } | null = null;
    try {
      reviewLogin = await this.reviewLoginService.getActive();
    } catch (error) {
      // Never block a real login on this lookup: fall back to normal OTP delivery.
      void this.loggingService.log(
        LogType.SECURITY,
        LogLevel.WARN,
        'Review login lookup failed; sending a normal OTP',
        'OtpService',
        { error: error instanceof Error ? error.message : String(error) }
      );
    }
    if (!reviewLogin || normalizedPhone !== reviewLogin.phone) {
      return null;
    }

    const lockoutRemaining = await this.getOtpLockoutRemainingSeconds(normalizedPhone);
    if (lockoutRemaining > 0) {
      return this.buildLockoutResult(lockoutRemaining);
    }

    const expirySeconds = this.config.expiryMinutes * 60;
    await Promise.all([
      this.cacheService.del(`otp_verified:${normalizedPhone}`),
      this.cacheService.set(
        `otp:${normalizedPhone}`,
        this.buildOtpCacheEntry(reviewLogin.otp),
        expirySeconds
      ),
    ]);

    void this.loggingService.log(
      LogType.SECURITY,
      LogLevel.INFO,
      'Review login code issued; no OTP delivered',
      'OtpService',
      { purpose: 'review_login' }
    );

    return { success: true, message: 'OTP sent successfully', expiresIn: expirySeconds };
  }

  private async dispatchOtpSmsDelivery(
    normalizedPhone: string,
    otp: string,
    clinicId: string | undefined,
    purpose: string
  ): Promise<void> {
    const sent = await this.whatsAppService.sendOTP(
      normalizedPhone,
      otp,
      this.config.expiryMinutes,
      2,
      clinicId,
      purpose
    );

    if (sent) {
      void this.loggingService.log(
        LogType.AUTH,
        LogLevel.INFO,
        `OTP sent via WhatsApp to ${normalizedPhone}`,
        'OtpService',
        { phone: normalizedPhone, purpose }
      );
      return;
    }

    void this.loggingService.log(
      LogType.AUTH,
      LogLevel.WARN,
      `WhatsApp OTP send returned false for ${normalizedPhone}`,
      'OtpService',
      { phone: normalizedPhone, purpose }
    );
  }

  /**
   * Verify OTP
   */
  async verifyOtp(identifier: string, otp: string): Promise<OtpResult> {
    try {
      const normalizedIdentifier = this.normalizeIdentifier(identifier);
      const normalizedOtp = this.normalizeOtpValue(otp);
      const otpKey = `otp:${normalizedIdentifier}`;
      const verifiedKey = `otp_verified:${normalizedIdentifier}`;

      // Lockout first: a locked identifier is refused even with the right code (the code was
      // burnt when the lockout started), so the attacker learns nothing during the cooldown.
      const lockoutRemaining = await this.getOtpLockoutRemainingSeconds(normalizedIdentifier);
      if (lockoutRemaining > 0) {
        void this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'OTP verification refused: identifier is locked out',
          'OtpService',
          { lockoutRemainingSeconds: lockoutRemaining }
        );
        return this.buildLockoutResult(lockoutRemaining);
      }

      const storedOtp = this.extractOtpValue(await this.cacheService.get<unknown>(otpKey));
      const recentlyVerifiedOtp = this.extractOtpValue(
        await this.cacheService.get<unknown>(verifiedKey)
      );
      const cacheExists = await this.cacheService.exists(otpKey);
      const cacheTtl = await this.cacheService.ttl(otpKey);
      const hasValidStoredOtp = typeof storedOtp === 'string' && storedOtp.length > 0;

      this.logOtp('OTP verification lookup', {
        identifier: normalizedIdentifier,
        otpKey,
        cacheExists,
        cacheTtl,
        hasStoredOtp: hasValidStoredOtp,
        providedOtpLength: normalizedOtp.length,
        storedOtpLength: hasValidStoredOtp ? storedOtp.length : 0,
        providedOtp: this.maskOtpValue(normalizedOtp),
        storedOtp: this.maskOtpValue(storedOtp),
        recentlyVerifiedOtp: this.maskOtpValue(recentlyVerifiedOtp),
        otpMatches: hasValidStoredOtp && storedOtp === normalizedOtp,
      });

      if (!hasValidStoredOtp) {
        if (recentlyVerifiedOtp === normalizedOtp) {
          this.logOtp('OTP verification replay accepted', {
            identifier: normalizedIdentifier,
            otpKey,
            verifiedKey,
            providedOtp: this.maskOtpValue(normalizedOtp),
          });

          return {
            success: true,
            message: 'OTP already verified',
          };
        }

        return {
          success: false,
          message: 'OTP not found or expired',
        };
      }

      if (storedOtp !== normalizedOtp) {
        const newFailedAttempts = await this.recordOtpVerifyFailure(normalizedIdentifier);
        const attemptsRemaining = Math.max(0, this.config.maxAttempts - newFailedAttempts);

        if (newFailedAttempts >= this.config.maxAttempts) {
          await this.lockOutIdentifier(normalizedIdentifier);
          void this.loggingService.log(
            LogType.SECURITY,
            LogLevel.WARN,
            `OTP locked out after ${newFailedAttempts} wrong codes; code invalidated`,
            'OtpService',
            { failedAttempts: newFailedAttempts, lockoutSeconds: this.lockoutSeconds }
          );
          return this.buildLockoutResult(this.lockoutSeconds);
        }

        this.logOtp('OTP verification mismatch', {
          identifier: normalizedIdentifier,
          otpKey,
          providedOtp: this.maskOtpValue(normalizedOtp),
          storedOtp: this.maskOtpValue(storedOtp),
          failedAttempts: newFailedAttempts,
          attemptsRemaining,
        });
        return {
          success: false,
          message: 'Invalid OTP',
          attemptsRemaining,
        };
      }

      // NOTE: OTP is NOT deleted here. Deletion is deferred to the caller via consumeOtp()
      // This allows retry if downstream operations (e.g., user creation) fail.
      // The caller MUST call consumeOtp() after confirming the operation succeeded.

      this.logOtp('OTP verification succeeded', {
        identifier: normalizedIdentifier,
        otpKey,
        verifiedKey,
      });

      await Promise.all([
        this.cacheService.set(
          verifiedKey,
          this.buildVerifiedOtpCacheEntry(normalizedOtp),
          this.VERIFIED_OTP_TTL_SECONDS
        ),
        this.rawCommands([{ command: 'del', args: [this.otpFailuresKey(normalizedIdentifier)] }]),
      ]);

      void this.loggingService.log(
        LogType.AUTH,
        LogLevel.INFO,
        `OTP verified successfully for ${normalizedIdentifier}`,
        'OtpService',
        { identifier: normalizedIdentifier }
      );

      return {
        success: true,
        message: 'OTP verified successfully',
      };
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to verify OTP for ${identifier}`,
        'OtpService',
        {
          identifier,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : 'No stack trace available',
        }
      );
      return {
        success: false,
        message: 'Failed to verify OTP. Please try again.',
      };
    }
  }

  /**
   * Check OTP status
   */
  async checkOtpStatus(identifier: string): Promise<{
    exists: boolean;
    expiresIn?: number;
    attemptsRemaining?: number;
  }> {
    try {
      const normalizedIdentifier = this.normalizeIdentifier(identifier);
      const otpKey = `otp:${normalizedIdentifier}`;
      const attemptsKey = `otp_attempts:${normalizedIdentifier}`;
      const cooldownKey = `otp_cooldown:${normalizedIdentifier}`;

      const [otpData, attempts, cooldownData] = await Promise.all([
        this.cacheService.get<unknown>(otpKey),
        this.cacheService.get<string>(attemptsKey),
        this.cacheService.get<string>(cooldownKey),
      ]);
      const cacheExists = await this.cacheService.exists(otpKey);
      const cacheTtl = await this.cacheService.ttl(otpKey);

      const storedOtp = this.extractOtpValue(otpData);
      const otpExists = cacheExists && typeof storedOtp === 'string' && storedOtp.length > 0;
      const cooldown = cooldownData !== null;

      const attemptCount = attempts ? parseInt(attempts) : 0;
      const attemptsRemaining = this.getRequestsRemainingInStage(attemptCount + 1);

      return {
        exists: otpExists,
        ...(cacheTtl > 0 ? { expiresIn: cacheTtl } : {}),
        attemptsRemaining: cooldown ? 0 : attemptsRemaining,
      };
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to check OTP status for ${identifier}`,
        'OtpService',
        {
          identifier,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : 'No stack trace available',
        }
      );
      return {
        exists: false,
        attemptsRemaining: 0,
      };
    }
  }

  /**
   * Invalidate OTP
   */
  async invalidateOtp(identifier: string): Promise<boolean> {
    try {
      const normalizedIdentifier = this.normalizeIdentifier(identifier);
      const otpKey = `otp:${normalizedIdentifier}`;
      await Promise.all([
        this.cacheService.del(otpKey),
        this.cacheService.del(`otp_verify_attempts:${normalizedIdentifier}`),
      ]);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `OTP invalidated for ${normalizedIdentifier}`,
        'OtpService'
      );

      return true;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to invalidate OTP for ${identifier}`,
        'OtpService',
        {
          identifier,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : 'No stack trace available',
        }
      );
      return false;
    }
  }

  /**
   * Consume (delete) OTP after successful downstream operation
   * This is the deferred deletion counterpart to verifyOtp().
   * MUST be called by the auth service after user creation/login succeeds.
   */
  async consumeOtp(identifier: string): Promise<boolean> {
    return this.invalidateOtp(identifier);
  }

  /**
   * Reset OTP attempts
   */
  async resetOtpAttempts(identifier: string): Promise<void> {
    try {
      const normalizedIdentifier = this.normalizeIdentifier(identifier);
      const attemptsKey = `otp_attempts:${normalizedIdentifier}`;
      const cooldownKey = `otp_cooldown:${normalizedIdentifier}`;

      await Promise.all([
        this.cacheService.del(attemptsKey),
        this.cacheService.del(cooldownKey),
        // Administrative reset also clears the brute-force lockout and its failure counter.
        this.rawCommands([
          { command: 'del', args: [this.otpLockoutKey(normalizedIdentifier)] },
          { command: 'del', args: [this.otpFailuresKey(normalizedIdentifier)] },
        ]),
      ]);

      void this.loggingService.log(
        LogType.AUTH,
        LogLevel.INFO,
        `OTP attempts reset for ${normalizedIdentifier}`,
        'OtpService',
        { identifier: normalizedIdentifier }
      );
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to reset OTP attempts for ${identifier}`,
        'OtpService',
        {
          identifier,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : 'No stack trace available',
        }
      );
    }
  }
}
