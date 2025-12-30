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
import { LogType, LogLevel, AuditInfo, getWhatsAppSuppressionDelegate } from '@core/types';

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

      // Check database using WhatsApp suppression list model
      const suppressed: boolean = await this.databaseService.executeHealthcareRead(async client => {
        const whatsappSuppressionDelegate = getWhatsAppSuppressionDelegate(client);
        const result = await whatsappSuppressionDelegate.findFirst({
          where: {
            phoneNumber: normalizedPhone,
            isActive: true,
            ...(clinicId ? { clinicId } : { clinicId: null }),
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        });
        return result !== null;
      });

      // Cache result
      await this.cacheService.set(cacheKey, suppressed ? 'true' : 'false', this.cacheTTL);

      return suppressed;
    } catch (error: unknown) {
      const errorMessage: string = error instanceof Error ? error.message : String(error);
      await this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.WARN,
        'Failed to check WhatsApp suppression list',
        'WhatsAppSuppressionService',
        {
          error: errorMessage,
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
      // Store in database
      await this.databaseService.executeHealthcareWrite(
        async client => {
          const whatsappSuppressionDelegate = getWhatsAppSuppressionDelegate(client);

          // Map WhatsApp suppression reason to Prisma enum
          const prismaReason: 'BOUNCE' | 'COMPLAINT' | 'UNSUBSCRIBE' | 'MANUAL' =
            this.mapToPrismaReason(reason);
          const prismaSource: 'SES' | 'ZEPTOMAIL' | 'USER_ACTION' | 'ADMIN' | 'SYSTEM' =
            this.mapToPrismaSource(source);

          // Check if suppression already exists
          const existing = await whatsappSuppressionDelegate.findFirst({
            where: {
              phoneNumber: normalizedPhone,
              reason: prismaReason,
              clinicId: clinicId ?? null,
            },
          });

          if (existing) {
            // Update existing suppression
            const now: Date = new Date();
            await whatsappSuppressionDelegate.update({
              where: { id: existing.id },
              data: {
                isActive: true,
                suppressedAt: now,
                messageId: messageId ?? null,
                description: _metadata ? JSON.stringify(_metadata) : null,
                metadata: _metadata ?? undefined,
                updatedAt: now,
              },
            });
          } else {
            // Create new suppression
            await whatsappSuppressionDelegate.create({
              data: {
                phoneNumber: normalizedPhone,
                reason: prismaReason,
                source: prismaSource,
                userId: userId ?? null,
                clinicId: clinicId ?? null,
                messageId: messageId ?? null,
                description: _metadata ? JSON.stringify(_metadata) : null,
                metadata: _metadata ?? undefined,
                isActive: true,
              },
            });
          }
        },
        {
          userId: userId ?? 'system',
          userRole: 'SYSTEM',
          clinicId: clinicId ?? '',
          operation: 'CREATE_WHATSAPP_SUPPRESSION',
          resourceType: 'WHATSAPP_SUPPRESSION',
          resourceId: normalizedPhone,
          timestamp: new Date(),
        } as AuditInfo
      );

      // Cache the result
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
    } catch (error: unknown) {
      const errorMessage: string = error instanceof Error ? error.message : String(error);
      const errorStack: string | undefined = error instanceof Error ? error.stack : undefined;
      await this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.ERROR,
        `Failed to add WhatsApp number to suppression list: ${errorMessage}`,
        'WhatsAppSuppressionService',
        {
          phoneNumber: normalizedPhone,
          reason,
          source,
          error: errorStack,
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
      // Remove from database
      await this.databaseService.executeHealthcareWrite(
        async client => {
          const whatsappSuppressionDelegate = getWhatsAppSuppressionDelegate(client);
          await whatsappSuppressionDelegate.updateMany({
            where: {
              phoneNumber: normalizedPhone,
              clinicId: clinicId ?? null,
              isActive: true,
            },
            data: {
              isActive: false,
              updatedAt: new Date(),
            },
          });
        },
        {
          userId: 'system',
          userRole: 'SYSTEM',
          clinicId: clinicId ?? '',
          operation: 'REMOVE_WHATSAPP_SUPPRESSION',
          resourceType: 'WHATSAPP_SUPPRESSION',
          resourceId: normalizedPhone,
          timestamp: new Date(),
        } as AuditInfo
      );

      // Remove from cache
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
    } catch (error: unknown) {
      const errorMessage: string = error instanceof Error ? error.message : String(error);
      const errorStack: string | undefined = error instanceof Error ? error.stack : undefined;
      await this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.ERROR,
        `Failed to remove WhatsApp number from suppression list: ${errorMessage}`,
        'WhatsAppSuppressionService',
        {
          phoneNumber: normalizedPhone,
          error: errorStack,
        }
      );
    }
  }

  /**
   * Normalize phone number (E.164 format)
   */
  private normalizePhoneNumber(phone: string): string {
    // Remove all non-digit characters except +
    const cleaned: string = phone.replace(/[^\d+]/g, '');

    // Ensure it starts with +
    if (!cleaned.startsWith('+')) {
      return `+${cleaned}`;
    }

    return cleaned;
  }

  /**
   * Map WhatsApp suppression reason to Prisma enum
   */
  private mapToPrismaReason(
    reason: WhatsAppSuppressionReason
  ): 'BOUNCE' | 'COMPLAINT' | 'UNSUBSCRIBE' | 'MANUAL' {
    switch (reason) {
      case WhatsAppSuppressionReason.OPT_OUT:
        return 'UNSUBSCRIBE';
      case WhatsAppSuppressionReason.COMPLAINT:
        return 'COMPLAINT';
      case WhatsAppSuppressionReason.MANUAL:
        return 'MANUAL';
      case WhatsAppSuppressionReason.FAILED:
        return 'BOUNCE';
      default:
        return 'MANUAL';
    }
  }

  /**
   * Map WhatsApp suppression source to Prisma enum
   */
  private mapToPrismaSource(
    source: WhatsAppSuppressionSource
  ): 'SES' | 'ZEPTOMAIL' | 'USER_ACTION' | 'ADMIN' | 'SYSTEM' {
    switch (source) {
      case WhatsAppSuppressionSource.META:
      case WhatsAppSuppressionSource.TWILIO:
        return 'SES'; // Use SES as generic provider source
      case WhatsAppSuppressionSource.USER_ACTION:
        return 'USER_ACTION';
      case WhatsAppSuppressionSource.ADMIN:
        return 'ADMIN';
      case WhatsAppSuppressionSource.SYSTEM:
        return 'SYSTEM';
      default:
        return 'SYSTEM';
    }
  }
}
