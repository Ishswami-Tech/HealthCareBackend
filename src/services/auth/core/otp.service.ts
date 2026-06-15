import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { nowIso } from '@utils/date-time.util';
import { CacheService } from '@infrastructure/cache/cache.service';
import { WhatsAppService } from '@communication/channels/whatsapp/whatsapp.service';
import { EmailService } from '@communication/channels/email/email.service';
import { ConfigService } from '@config/config.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { EventService } from '@infrastructure/events/event.service';
import { LogType, LogLevel } from '@core/types';
import { EmailTemplate } from '@core/types/common.types';
import { QueueService } from '@infrastructure/queue';
import { normalizeAuthPhoneNumber } from './phone-normalizer.util';

import type { OtpConfig, OtpResult } from '@core/types/auth.types';

type OtpCacheEntry = {
  otp: string;
  createdAt: string;
};

@Injectable()
export class OtpService {
  private readonly config: OtpConfig;
  private readonly otpDebugEnabled: boolean;
  private readonly REQUESTS_PER_STAGE = 3;

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
    private readonly emailService: EmailService,
    private readonly queueService: QueueService,
    private readonly whatsAppService: WhatsAppService,
    private readonly configService: ConfigService,
    private readonly eventService: EventService,
    private readonly loggingService: LoggingService
  ) {
    // Use ConfigService (which uses dotenv) for all environment variable access
    this.config = {
      length: this.configService.getEnvNumber('OTP_LENGTH', 6),
      expiryMinutes: this.configService.getEnvNumber('OTP_EXPIRY_MINUTES', 10),
      maxAttempts: this.configService.getEnvNumber('OTP_MAX_ATTEMPTS', 5),
      cooldownMinutes: this.configService.getEnvNumber('OTP_COOLDOWN_MINUTES', 3),
    };

    this.otpDebugEnabled =
      this.configService.getEnvBoolean('ENABLE_OTP_DEBUG', false) ||
      this.configService.getEnvBoolean('DEBUG_MODE', false);
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
    void this.loggingService.log(LogType.AUTH, LogLevel.WARN, message, 'OtpService', context);
    void this.eventService.emit('auth.otp.diagnostic', {
      source: 'OtpService',
      message,
      context,
      timestamp: nowIso(),
    });
  }

  private buildOtpCacheEntry(otp: string): OtpCacheEntry {
    return {
      otp,
      createdAt: nowIso(),
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
    const max = Math.pow(10, this.config.length) - 1;
    return Math.floor(Math.random() * (max - min + 1)) + min + '';
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
      // Check cooldown
      const cooldownKey = `otp_cooldown:${normalizedEmail}`;
      const cooldown = await this.cacheService.get<string>(cooldownKey);

      if (cooldown) {
        const remainingTtl = await this.cacheService.ttl(cooldownKey);
        const waitMinutes = Math.ceil((remainingTtl > 0 ? remainingTtl : 60) / 60);
        return {
          success: false,
          message: `Please wait ${waitMinutes} minute(s) before requesting another OTP`,
        };
      }

      // Check attempts
      const attemptsKey = `otp_attempts:${normalizedEmail}`;
      const attempts = await this.cacheService.get<string>(attemptsKey);
      const attemptCount = attempts ? parseInt(attempts) : 0;

      // Generate and store OTP
      const otp = providedOtp || this.generateOtp();
      const otpKey = `otp:${normalizedEmail}`;
      const expirySeconds = this.config.expiryMinutes * 60;
      const otpEntry = this.buildOtpCacheEntry(otp);

      this.logOtp('Email OTP generated and cached', {
        normalizedEmail,
        purpose,
        otpKey,
        otpLength: otp.length,
        otp: otp.length
          ? `${otp.slice(0, 1)}${'*'.repeat(Math.max(otp.length - 2, 0))}${otp.slice(-1)}`
          : null,
      });

      const previousOtp = await this.cacheService.get<string>(otpKey);
      this.logOtp('Email OTP cache snapshot before write', {
        normalizedEmail,
        otpKey,
        previousOtpExists: Boolean(previousOtp),
        previousOtp: previousOtp?.length
          ? `${previousOtp.slice(0, 1)}${'*'.repeat(Math.max(previousOtp.length - 2, 0))}${previousOtp.slice(-1)}`
          : null,
        replacingExistingOtp: Boolean(previousOtp),
      });

      await this.cacheService.set(otpKey, otpEntry, expirySeconds);
      const storedOtp = this.extractOtpValue(await this.cacheService.get<unknown>(otpKey));
      this.logOtp('Email OTP stored in cache', {
        normalizedEmail,
        otpKey,
        expirySeconds,
        otpLength: otp.length,
        storedOtp: this.maskOtpValue(storedOtp),
        storedOtpMatches: storedOtp === otp,
      });
      const newAttemptCount = attemptCount + 1;
      await this.cacheService.set(attemptsKey, newAttemptCount.toString(), 60 * 60); // 1 hour
      const cooldownSeconds = this.getProgressiveCooldown(newAttemptCount);
      if (cooldownSeconds > 0) {
        await this.cacheService.set(cooldownKey, '1', cooldownSeconds);
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
        const sent = await this.emailService.sendEmail(emailJobData);
        if (!sent) {
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
        `OTP sent to ${email} for ${purpose}`,
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
   * Send OTP via WhatsApp (Primary)
   */
  async sendOtpSms(
    phone: string,
    purpose: string = 'verification',
    clinicId?: string,
    providedOtp?: string
  ): Promise<OtpResult> {
    try {
      const normalizedPhone = this.normalizeIdentifier(phone);
      // Check cooldown
      const cooldownKey = `otp_cooldown:${normalizedPhone}`;
      const cooldown = await this.cacheService.get<string>(cooldownKey);

      if (cooldown) {
        const remainingTtl = await this.cacheService.ttl(cooldownKey);
        const waitMinutes = Math.ceil((remainingTtl > 0 ? remainingTtl : 60) / 60);
        return {
          success: false,
          message: `Please wait ${waitMinutes} minute(s) before requesting another OTP`,
        };
      }

      // Check attempts
      const attemptsKey = `otp_attempts:${normalizedPhone}`;
      const attempts = await this.cacheService.get<string>(attemptsKey);
      const attemptCount = attempts ? parseInt(attempts) : 0;

      // Generate and store OTP (reusing email logic logic but with phone key)
      const otp = providedOtp || this.generateOtp();
      const otpKey = `otp:${normalizedPhone}`;
      const expirySeconds = this.config.expiryMinutes * 60;
      const otpEntry = this.buildOtpCacheEntry(otp);

      this.logOtp('WhatsApp OTP generated and cached', {
        normalizedPhone,
        purpose,
        otpKey,
        otpLength: otp.length,
        otp: otp.length
          ? `${otp.slice(0, 1)}${'*'.repeat(Math.max(otp.length - 2, 0))}${otp.slice(-1)}`
          : null,
      });

      const previousOtp = await this.cacheService.get<string>(otpKey);
      this.logOtp('WhatsApp OTP cache snapshot before write', {
        normalizedPhone,
        otpKey,
        previousOtpExists: Boolean(previousOtp),
        previousOtp: previousOtp?.length
          ? `${previousOtp.slice(0, 1)}${'*'.repeat(Math.max(previousOtp.length - 2, 0))}${previousOtp.slice(-1)}`
          : null,
        replacingExistingOtp: Boolean(previousOtp),
      });

      await this.cacheService.set(otpKey, otpEntry, expirySeconds);
      const storedOtp = this.extractOtpValue(await this.cacheService.get<unknown>(otpKey));
      this.logOtp('WhatsApp OTP stored in cache', {
        normalizedPhone,
        otpKey,
        expirySeconds,
        otpLength: otp.length,
        storedOtp: this.maskOtpValue(storedOtp),
        storedOtpMatches: storedOtp === otp,
      });
      const newAttemptCount = attemptCount + 1;
      await this.cacheService.set(attemptsKey, newAttemptCount.toString(), 60 * 60); // 1 hour
      const cooldownSeconds = this.getProgressiveCooldown(newAttemptCount);
      if (cooldownSeconds > 0) {
        await this.cacheService.set(cooldownKey, '1', cooldownSeconds);
      }

      // Send via WhatsApp
      const sent = await this.whatsAppService.sendOTP(
        normalizedPhone,
        otp,
        this.config.expiryMinutes,
        2, // retries
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
      } else {
        // Fallback logging if WhatsApp fails (since sendOTP acts as the primary sender now)
        // Note: WhatsAppService has its own error logging, but we might want to log failure here too
        void this.loggingService.log(
          LogType.AUTH,
          LogLevel.WARN,
          `WhatsApp OTP send returned false for ${normalizedPhone}`,
          'OtpService'
        );
        return {
          success: false,
          message: 'Failed to send WhatsApp message. Please try again later.',
          otp,
          expiresIn: expirySeconds,
          attemptsRemaining: this.getRequestsRemainingInStage(newAttemptCount),
        };
      }

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

  /**
   * Verify OTP
   */
  async verifyOtp(identifier: string, otp: string): Promise<OtpResult> {
    try {
      const normalizedIdentifier = this.normalizeIdentifier(identifier);
      const normalizedOtp = this.normalizeOtpValue(otp);
      const otpKey = `otp:${normalizedIdentifier}`;
      const storedOtp = this.extractOtpValue(await this.cacheService.get<unknown>(otpKey));
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
        otpMatches: hasValidStoredOtp && storedOtp === normalizedOtp,
      });

      if (!hasValidStoredOtp) {
        return {
          success: false,
          message: 'OTP not found or expired',
        };
      }

      if (storedOtp !== normalizedOtp) {
        this.logOtp('OTP verification mismatch', {
          identifier: normalizedIdentifier,
          otpKey,
          providedOtp: this.maskOtpValue(normalizedOtp),
          storedOtp: this.maskOtpValue(storedOtp),
        });
        return {
          success: false,
          message: 'Invalid OTP',
        };
      }

      // NOTE: OTP is NOT deleted here. Deletion is deferred to the caller via consumeOtp()
      // This allows retry if downstream operations (e.g., user creation) fail.
      // The caller MUST call consumeOtp() after confirming the operation succeeded.

      this.logOtp('OTP verification succeeded', {
        identifier: normalizedIdentifier,
        otpKey,
      });

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
      await this.cacheService.del(otpKey);

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

      await Promise.all([this.cacheService.del(attemptsKey), this.cacheService.del(cooldownKey)]);

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
