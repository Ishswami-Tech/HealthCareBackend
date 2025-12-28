import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { CacheService } from '@infrastructure/cache/cache.service';
import { EmailService } from '@communication/channels/email/email.service';
import { ConfigService } from '@config/config.service';
import { EmailTemplate } from '@core/types/common.types';

import type { OtpConfig, OtpResult } from '@core/types/auth.types';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly config: OtpConfig;

  constructor(
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService: CacheService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService
  ) {
    // Use ConfigService (which uses dotenv) for all environment variable access
    this.config = {
      length: this.configService.getEnvNumber('OTP_LENGTH', 6),
      expiryMinutes: this.configService.getEnvNumber('OTP_EXPIRY_MINUTES', 5),
      maxAttempts: this.configService.getEnvNumber('OTP_MAX_ATTEMPTS', 3),
      cooldownMinutes: this.configService.getEnvNumber('OTP_COOLDOWN_MINUTES', 1),
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
    purpose: string = 'verification',
    clinicId?: string
  ): Promise<OtpResult> {
    try {
      // Check cooldown
      const cooldownKey = `otp_cooldown:${email}`;
      const cooldown = await this.cacheService.get<string>(cooldownKey);

      if (cooldown) {
        return {
          success: false,
          message: `Please wait ${this.config.cooldownMinutes} minute(s) before requesting another OTP`,
        };
      }

      // Check attempts
      const attemptsKey = `otp_attempts:${email}`;
      const attempts = await this.cacheService.get<string>(attemptsKey);
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

      await this.cacheService.set(otpKey, otp, expirySeconds);
      await this.cacheService.set(attemptsKey, (attemptCount + 1).toString(), 60 * 60); // 1 hour
      await this.cacheService.set(cooldownKey, '1', this.config.cooldownMinutes * 60);

      // Send email
      await this.emailService.sendEmail({
        to: email,
        subject: 'Your OTP Code',
        template: EmailTemplate.OTP_LOGIN,
        context: {
          name,
          otp,
        },
        ...(clinicId && { clinicId }),
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
      const storedOtp = await this.cacheService.get<string>(otpKey);

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
      await this.cacheService.del(otpKey);

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
        this.cacheService.get<string>(otpKey),
        this.cacheService.get<string>(attemptsKey),
        this.cacheService.get<string>(cooldownKey),
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
      await this.cacheService.del(otpKey);

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

      await Promise.all([this.cacheService.del(attemptsKey), this.cacheService.del(cooldownKey)]);

      this.logger.log(`OTP attempts reset for ${email}`);
    } catch (_error) {
      this.logger.error(
        `Failed to reset OTP attempts for ${email}`,
        _error instanceof Error ? _error.stack : 'No stack trace available'
      );
    }
  }
}
