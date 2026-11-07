import { HttpStatus, Inject, Injectable, forwardRef } from '@nestjs/common';
import { randomInt } from 'crypto';
import { ConfigService } from '@config/config.service';
import { DatabaseService } from '@infrastructure/database/database.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { CredentialEncryptionService } from '@communication/config/credential-encryption.service';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { LogLevel, LogType } from '@core/types';
import { nowIso } from '@utils/date-time.util';
import { normalizeAuthPhoneNumber } from './phone-normalizer.util';

/** Row key in "system_settings". */
export const REVIEW_LOGIN_SETTING_KEY = 'auth.review_login';
export const REVIEW_LOGIN_DURATION_DAYS = [7, 14, 30] as const;
export type ReviewLoginDurationDays = (typeof REVIEW_LOGIN_DURATION_DAYS)[number];

type StoredReviewLogin = {
  phone: string;
  otpEncrypted: string;
  expiresAt: string;
  updatedBy: string;
  updatedAt: string;
};

export type ReviewLoginStatus = {
  enabled: boolean;
  phone: string | null;
  expiresAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

/** Returned only when a code is generated; the code is never readable again. */
export type ReviewLoginIssued = { status: ReviewLoginStatus; otp: string };

/**
 * Login for app store reviewers, who cannot receive a real OTP. A super admin turns it on for
 * one phone number for a limited time; the backend generates the code and stores it encrypted
 * in "system_settings". It is read on every OTP request, so enabling, rotating or disabling
 * takes effect immediately on every instance, and it switches itself off at expiresAt.
 */
@Injectable()
export class ReviewLoginService {
  constructor(
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => CredentialEncryptionService))
    private readonly encryption: CredentialEncryptionService,
    @Inject(forwardRef(() => ConfigService))
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

  /** The live review login, or null when off, expired or unreadable. */
  async getActive(): Promise<{ phone: string; otp: string } | null> {
    const stored = await this.readStored();
    if (!stored || !this.isLive(stored)) {
      return null;
    }
    try {
      return { phone: stored.phone, otp: await this.encryption.decrypt(stored.otpEncrypted) };
    } catch {
      void this.loggingService.log(
        LogType.SECURITY,
        LogLevel.WARN,
        'Review login is off: the stored code could not be decrypted',
        'ReviewLoginService'
      );
      return null;
    }
  }

  async getStatus(): Promise<ReviewLoginStatus> {
    return this.toStatus(await this.readStored());
  }

  async enable(
    phone: string,
    days: ReviewLoginDurationDays,
    actorId: string
  ): Promise<ReviewLoginIssued> {
    const normalizedPhone = this.validatePhone(phone);
    if (!REVIEW_LOGIN_DURATION_DAYS.includes(days)) {
      throw new HealthcareError(
        ErrorCode.VALIDATION_NUMBER_OUT_OF_RANGE,
        `Duration must be one of ${REVIEW_LOGIN_DURATION_DAYS.join(', ')} days`,
        HttpStatus.BAD_REQUEST,
        { days },
        'ReviewLoginService.enable'
      );
    }
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    return this.issue(normalizedPhone, expiresAt, actorId, 'enabled');
  }

  /** New code for the current number and expiry; the old code stops working at once. */
  async regenerate(actorId: string): Promise<ReviewLoginIssued> {
    const stored = await this.readStored();
    if (!stored || !this.isLive(stored)) {
      throw new HealthcareError(
        ErrorCode.OPERATION_NOT_ALLOWED,
        'Review login is off. Enable it first.',
        HttpStatus.BAD_REQUEST,
        undefined,
        'ReviewLoginService.regenerate'
      );
    }
    return this.issue(stored.phone, stored.expiresAt, actorId, 'code regenerated');
  }

  async disable(actorId: string): Promise<ReviewLoginStatus> {
    await this.databaseService.executeRawQuery(
      'DELETE FROM "system_settings" WHERE "settingKey" = $1',
      [REVIEW_LOGIN_SETTING_KEY]
    );
    this.audit('disabled', actorId);
    return this.toStatus(null);
  }

  private async issue(
    phone: string,
    expiresAt: string,
    actorId: string,
    action: string
  ): Promise<ReviewLoginIssued> {
    const length = this.configService.getEnvNumber('OTP_LENGTH', 6);
    const otp = String(randomInt(Math.pow(10, length - 1), Math.pow(10, length)));
    const stored: StoredReviewLogin = {
      phone,
      otpEncrypted: await this.encryption.encrypt(otp),
      expiresAt,
      updatedBy: actorId,
      updatedAt: nowIso(),
    };
    await this.databaseService.executeRawQuery(
      `
        INSERT INTO "system_settings" ("settingKey", "settingValue", "createdAt", "updatedAt")
        VALUES ($1, $2, NOW(), NOW())
        ON CONFLICT ("settingKey")
        DO UPDATE SET "settingValue" = EXCLUDED."settingValue", "updatedAt" = NOW()
      `,
      [REVIEW_LOGIN_SETTING_KEY, JSON.stringify(stored)]
    );
    this.audit(action, actorId, { expiresAt });
    return { status: this.toStatus(stored), otp };
  }

  private async readStored(): Promise<StoredReviewLogin | null> {
    const rows = await this.databaseService.executeRawQuery<Array<{ settingValue: string }>>(
      'SELECT "settingValue" FROM "system_settings" WHERE "settingKey" = $1 LIMIT 1',
      [REVIEW_LOGIN_SETTING_KEY]
    );
    const raw = rows?.[0]?.settingValue;
    if (!raw) {
      return null;
    }
    try {
      const parsed = JSON.parse(raw) as Partial<StoredReviewLogin>;
      if (!parsed.phone || !parsed.otpEncrypted || !parsed.expiresAt) {
        return null;
      }
      return {
        phone: parsed.phone,
        otpEncrypted: parsed.otpEncrypted,
        expiresAt: parsed.expiresAt,
        updatedBy: parsed.updatedBy ?? '',
        updatedAt: parsed.updatedAt ?? '',
      };
    } catch {
      return null;
    }
  }

  private isLive(stored: StoredReviewLogin): boolean {
    const expires = Date.parse(stored.expiresAt);
    return Number.isFinite(expires) && expires > Date.now();
  }

  private toStatus(stored: StoredReviewLogin | null): ReviewLoginStatus {
    const live = stored !== null && this.isLive(stored);
    return {
      enabled: live,
      phone: stored?.phone ?? null,
      expiresAt: stored?.expiresAt ?? null,
      updatedAt: stored?.updatedAt || null,
      updatedBy: stored?.updatedBy || null,
    };
  }

  private validatePhone(phone: string): string {
    const normalized = phone && !phone.includes('@') ? normalizeAuthPhoneNumber(phone) : '';
    if (!/^\+\d{10,15}$/.test(normalized)) {
      throw new HealthcareError(
        ErrorCode.VALIDATION_INVALID_PHONE,
        'Enter a valid phone number',
        HttpStatus.BAD_REQUEST,
        undefined,
        'ReviewLoginService.validatePhone'
      );
    }
    return normalized;
  }

  /** Audit trail for every change. Never includes the code. */
  private audit(action: string, actorId: string, extra: Record<string, unknown> = {}): void {
    void this.loggingService.log(
      LogType.AUDIT,
      LogLevel.INFO,
      `Review login ${action}`,
      'ReviewLoginService',
      { actorId, ...extra }
    );
  }
}
