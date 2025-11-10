import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@infrastructure/cache/redis/redis.service';
import { EmailService } from '@communication/messaging/email/email.service';
import { ConfigService } from '@config';
import { EmailTemplate } from '@core/types/common.types';

import type { OtpConfig, OtpResult } from '@core/types/auth.types';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly config: OtpConfig;

  constructor(
    private readonly redis: RedisService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService
  ) {
    // ConfigService is global, so it should always be available
    // Use process.env as fallback only if ConfigService.get fails
    const getConfig = <T>(key: string, defaultValue: T): T => {
      try {
        return this.configService.get<T>(key, defaultValue);
      } catch {
        // Fallback to process.env if ConfigService.get fails
        const envValue = process.env[key];
        if (envValue !== undefined) {
          if (typeof defaultValue === 'number') {
            return (parseInt(envValue, 10) || defaultValue) as T;
          }
          if (typeof defaultValue === 'boolean') {
            return (envValue === 'true' || envValue === '1') as T;
          }
          return envValue as T;
        }
        return defaultValue;
      }
    };

    this.config = {
      length: getConfig('OTP_LENGTH', 6),
      expiryMinutes: getConfig('OTP_EXPIRY_MINUTES', 5),
      maxAttempts: getConfig('OTP_MAX_ATTEMPTS', 3),
      cooldownMinutes: getConfig('OTP_COOLDOWN_MINUTES', 1),
    };
  }

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
    purpose: string = 'verification'
  ): Promise<OtpResult> {
    try {
      // Check cooldown
      const cooldownKey = `otp_cooldown:${email}`;
      const cooldown = await this.redis.get(cooldownKey);

      if (cooldown) {
        return {
          success: false,
          message: `Please wait ${this.config.cooldownMinutes} minute(s) before requesting another OTP`,
        };
      }

      // Check attempts
      const attemptsKey = `otp_attempts:${email}`;
      const attempts = await this.redis.get(attemptsKey);
      const attemptCount = attempts ? parseInt(attempts) : 0;

      if (attemptCount >= this.config.maxAttempts) {
        return {
          success: false,
          message: 'Maximum OTP attempts exceeded. Please try again later.',
        };
      }

      // Generate and store OTP
      const otp = this.generateOtp();
      const otpKey = `otp:${email}`;
      const expirySeconds = this.config.expiryMinutes * 60;

      await this.redis.set(otpKey, otp, expirySeconds);
      await this.redis.set(attemptsKey, (attemptCount + 1).toString(), 60 * 60); // 1 hour
      await this.redis.set(cooldownKey, '1', this.config.cooldownMinutes * 60);

      // Send email
      await this.emailService.sendEmail({
        to: email,
        subject: 'Your OTP Code',
        template: EmailTemplate.OTP_LOGIN,
        context: {
          name,
          otp,
        },
      });

      this.logger.log(`OTP sent to ${email} for ${purpose}`);

      return {
        success: true,
        message: 'OTP sent successfully',
        expiresIn: expirySeconds,
        attemptsRemaining: this.config.maxAttempts - attemptCount - 1,
      };
    } catch (_error) {
      this.logger.error(
        `Failed to send OTP to ${email}`,
        _error instanceof Error ? _error.stack : 'No stack trace available'
      );
      return {
        success: false,
        message: 'Failed to send OTP. Please try again.',
      };
    }
  }

  /**
   * Verify OTP
   */
  async verifyOtp(email: string, otp: string): Promise<OtpResult> {
    try {
      const otpKey = `otp:${email}`;
      const storedOtp = await this.redis.get(otpKey);

      if (!storedOtp) {
        return {
          success: false,
          message: 'OTP not found or expired',
        };
      }

      if (storedOtp !== otp) {
        return {
          success: false,
          message: 'Invalid OTP',
        };
      }

      // Remove OTP after successful verification
      await this.redis.del(otpKey);

      this.logger.log(`OTP verified successfully for ${email}`);

      return {
        success: true,
        message: 'OTP verified successfully',
      };
    } catch (_error) {
      this.logger.error(
        `Failed to verify OTP for ${email}`,
        _error instanceof Error ? _error.stack : 'No stack trace available'
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
  async checkOtpStatus(email: string): Promise<{
    exists: boolean;
    expiresIn?: number;
    attemptsRemaining?: number;
  }> {
    try {
      const otpKey = `otp:${email}`;
      const attemptsKey = `otp_attempts:${email}`;
      const cooldownKey = `otp_cooldown:${email}`;

      const [otpData, attempts, cooldownData] = await Promise.all([
        this.redis.get(otpKey),
        this.redis.get(attemptsKey),
        this.redis.get(cooldownKey),
      ]);

      const otpExists = otpData !== null;
      const cooldown = cooldownData !== null;

      const attemptCount = attempts ? parseInt(attempts) : 0;
      const attemptsRemaining = Math.max(0, this.config.maxAttempts - attemptCount);

      return {
        exists: otpExists,
        attemptsRemaining: cooldown ? 0 : attemptsRemaining,
      };
    } catch (_error) {
      this.logger.error(
        `Failed to check OTP status for ${email}`,
        _error instanceof Error ? _error.stack : 'No stack trace available'
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
  async invalidateOtp(email: string): Promise<boolean> {
    try {
      const otpKey = `otp:${email}`;
      await this.redis.del(otpKey);

      this.logger.log(`OTP invalidated for ${email}`);

      return true;
    } catch (_error) {
      this.logger.error(
        `Failed to invalidate OTP for ${email}`,
        _error instanceof Error ? _error.stack : 'No stack trace available'
      );
      return false;
    }
  }

  /**
   * Reset OTP attempts
   */
  async resetOtpAttempts(email: string): Promise<void> {
    try {
      const attemptsKey = `otp_attempts:${email}`;
      const cooldownKey = `otp_cooldown:${email}`;

      await Promise.all([this.redis.del(attemptsKey), this.redis.del(cooldownKey)]);

      this.logger.log(`OTP attempts reset for ${email}`);
    } catch (_error) {
      this.logger.error(
        `Failed to reset OTP attempts for ${email}`,
        _error instanceof Error ? _error.stack : 'No stack trace available'
      );
    }
  }
}
