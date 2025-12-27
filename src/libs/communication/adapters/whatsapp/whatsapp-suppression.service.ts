/**
 * WhatsApp Suppression List Service
 * ==================================
 * Manages WhatsApp suppression list for opted-out phone numbers
 * Similar to email suppression list but for WhatsApp
 *
 * @module WhatsAppSuppressionService
 * @description WhatsApp suppression list management service
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';

export enum WhatsAppSuppressionReason {
  OPT_OUT = 'OPT_OUT',
  FAILED = 'FAILED',
  MANUAL = 'MANUAL',
  COMPLAINT = 'COMPLAINT',
}

export enum WhatsAppSuppressionSource {
  META = 'META',
  TWILIO = 'TWILIO',
  USER_ACTION = 'USER_ACTION',
  ADMIN = 'ADMIN',
  SYSTEM = 'SYSTEM',
}

@Injectable()
export class WhatsAppSuppressionService {
  private readonly cacheTTL = 3600; // 1 hour
  private readonly cachePrefix = 'whatsapp:suppression:';

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Check if phone number is suppressed
   */
  async isSuppressed(phoneNumber: string, clinicId?: string): Promise<boolean> {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
    const cacheKey = clinicId
      ? `${this.cachePrefix}${normalizedPhone}:${clinicId}`
      : `${this.cachePrefix}${normalizedPhone}`;

    try {
      // Check cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached === 'true') {
        return true;
      }
      if (cached === 'false') {
        return false;
      }

      // Check database (using email suppression list model for now)
      // TODO: Create dedicated WhatsApp suppression list model if needed
      // For now, we'll use a simple cache-based approach or extend email suppression
      const suppressed = false; // Placeholder - implement when WhatsApp suppression model exists

      // Cache result
      await this.cacheService.set(cacheKey, suppressed ? 'true' : 'false', this.cacheTTL);

      return suppressed;
    } catch (error) {
      await this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.WARN,
        'Failed to check WhatsApp suppression list',
        'WhatsAppSuppressionService',
        {
          error: error instanceof Error ? error.message : String(error),
          phoneNumber: normalizedPhone,
        }
      );
      // Fail open - allow sending if check fails
      return false;
    }
  }

  /**
   * Add phone number to suppression list
   */
  async addSuppression(
    phoneNumber: string,
    reason: WhatsAppSuppressionReason,
    source: WhatsAppSuppressionSource,
    userId?: string,
    messageId?: string,
    clinicId?: string,
    _metadata?: Record<string, unknown>
  ): Promise<void> {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);

    try {
      // TODO: Implement database storage when WhatsApp suppression model exists
      // For now, just cache and log
      const cacheKey = clinicId
        ? `${this.cachePrefix}${normalizedPhone}:${clinicId}`
        : `${this.cachePrefix}${normalizedPhone}`;

      await this.cacheService.set(cacheKey, 'true', this.cacheTTL);

      await this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.INFO,
        `Added WhatsApp number to suppression list: ${normalizedPhone}`,
        'WhatsAppSuppressionService',
        {
          phoneNumber: normalizedPhone,
          reason,
          source,
          userId,
          messageId,
          clinicId,
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.ERROR,
        `Failed to add WhatsApp number to suppression list: ${error instanceof Error ? error.message : String(error)}`,
        'WhatsAppSuppressionService',
        {
          phoneNumber: normalizedPhone,
          reason,
          source,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }

  /**
   * Remove phone number from suppression list
   */
  async removeSuppression(phoneNumber: string, clinicId?: string): Promise<void> {
    const normalizedPhone = this.normalizePhoneNumber(phoneNumber);
    const cacheKey = clinicId
      ? `${this.cachePrefix}${normalizedPhone}:${clinicId}`
      : `${this.cachePrefix}${normalizedPhone}`;

    try {
      await this.cacheService.delete(cacheKey);

      await this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.INFO,
        `Removed WhatsApp number from suppression list: ${normalizedPhone}`,
        'WhatsAppSuppressionService',
        {
          phoneNumber: normalizedPhone,
          clinicId,
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.ERROR,
        `Failed to remove WhatsApp number from suppression list: ${error instanceof Error ? error.message : String(error)}`,
        'WhatsAppSuppressionService',
        {
          phoneNumber: normalizedPhone,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }

  /**
   * Normalize phone number (E.164 format)
   */
  private normalizePhoneNumber(phone: string): string {
    // Remove all non-digit characters except +
    const cleaned = phone.replace(/[^\d+]/g, '');

    // Ensure it starts with +
    if (!cleaned.startsWith('+')) {
      return `+${cleaned}`;
    }

    return cleaned;
  }
}
