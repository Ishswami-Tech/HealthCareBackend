/**
 * Email Suppression List Service
 * ===============================
 * Manages email suppression list for bounced, complained, and unsubscribed emails
 * Follows AWS SES best practices for maintaining sender reputation
 *
 * @module SuppressionListService
 * @description Email suppression list management service
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';

export enum SuppressionReason {
  BOUNCE = 'BOUNCE',
  COMPLAINT = 'COMPLAINT',
  UNSUBSCRIBE = 'UNSUBSCRIBE',
  MANUAL = 'MANUAL',
}

export enum SuppressionSource {
  SES = 'SES',
  ZEPTOMAIL = 'ZEPTOMAIL',
  USER_ACTION = 'USER_ACTION',
  ADMIN = 'ADMIN',
  SYSTEM = 'SYSTEM',
}

export interface SuppressionListEntry {
  id: string;
  email: string;
  reason: SuppressionReason;
  source: SuppressionSource;
  userId?: string | null;
  messageId?: string | null;
  bounceType?: string | null;
  bounceSubType?: string | null;
  complaintType?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  suppressedAt: Date;
  expiresAt?: Date | null;
  isActive: boolean;
}

@Injectable()
export class SuppressionListService {
  private readonly cacheTTL = 3600; // 1 hour
  private readonly cachePrefix = 'email:suppression:';

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {}

  /**
   * Check if email is suppressed
   * @param email - Email address to check
   * @param clinicId - Optional clinic ID for clinic-specific suppression lists
   *                   If provided, checks both clinic-specific and global suppressions
   */
  async isSuppressed(email: string, clinicId?: string): Promise<boolean> {
    const normalizedEmail = email.toLowerCase();
    const cacheKey = clinicId
      ? `${this.cachePrefix}${normalizedEmail}:${clinicId}`
      : `${this.cachePrefix}${normalizedEmail}`;

    try {
      // Check cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached === 'true') {
        return true;
      }
      if (cached === 'false') {
        return false;
      }

      // Check database
      // If clinicId is provided, check both clinic-specific and global (null clinicId) suppressions
      const suppressed = await this.databaseService.executeHealthcareRead(async client => {
        const emailSuppressionClient = client as unknown as {
          emailSuppressionList: {
            findFirst: (args: {
              where: {
                email: string;
                isActive: boolean;
                AND?: Array<{
                  OR?: Array<{ expiresAt: null } | { expiresAt: { gt: Date } }>;
                }>;
                OR?: Array<{ clinicId: string | null }>;
              };
            }) => Promise<unknown>;
          };
        };
        const entry = await emailSuppressionClient.emailSuppressionList.findFirst({
          where: {
            email: normalizedEmail,
            isActive: true,
            AND: [
              {
                OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
              },
            ],
            ...(clinicId
              ? {
                  OR: [
                    { clinicId: clinicId },
                    { clinicId: null }, // Also check global suppressions
                  ],
                }
              : { clinicId: null }), // If no clinicId provided, only check global
          },
        });
        return entry !== null;
      });

      // Cache result
      await this.cacheService.set(cacheKey, suppressed ? 'true' : 'false', this.cacheTTL);

      return suppressed;
    } catch (error) {
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        `Failed to check suppression list: ${error instanceof Error ? error.message : String(error)}`,
        'SuppressionListService',
        {
          email: normalizedEmail,
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      // On error, allow sending (fail open) but log the error
      return false;
    }
  }

  /**
   * Add email to suppression list
   */
  async addToSuppressionList(
    email: string,
    reason: SuppressionReason,
    source: SuppressionSource,
    options?: {
      userId?: string;
      messageId?: string;
      bounceType?: string;
      bounceSubType?: string;
      complaintType?: string;
      description?: string;
      metadata?: Record<string, unknown>;
      expiresAt?: Date;
      clinicId?: string;
    }
  ): Promise<void> {
    const normalizedEmail = email.toLowerCase();

    try {
      await this.databaseService.executeHealthcareWrite(
        async client => {
          const emailSuppressionClient = client as unknown as {
            emailSuppressionList: {
              findFirst: (args: {
                where: {
                  email: string;
                  reason: string;
                  clinicId: string | null;
                };
              }) => Promise<{ id: string } | null>;
              update: (args: {
                where: { id: string };
                data: {
                  source: string;
                  userId?: string | null;
                  clinicId?: string | null;
                  messageId?: string | null;
                  bounceType?: string | null;
                  bounceSubType?: string | null;
                  complaintType?: string | null;
                  description?: string | null;
                  metadata?: unknown;
                  expiresAt?: Date | null;
                  isActive: boolean;
                  updatedAt: Date;
                };
              }) => Promise<unknown>;
              create: (args: {
                data: {
                  email: string;
                  reason: string;
                  source: string;
                  userId?: string | null;
                  clinicId?: string | null;
                  messageId?: string | null;
                  bounceType?: string | null;
                  bounceSubType?: string | null;
                  complaintType?: string | null;
                  description?: string | null;
                  metadata?: unknown;
                  expiresAt?: Date | null;
                  isActive: boolean;
                };
              }) => Promise<unknown>;
            };
          };
          // Use upsert to handle duplicates (with clinicId in unique constraint)
          // For null clinicId, we need to use findFirst + create/update pattern
          const existing = await emailSuppressionClient.emailSuppressionList.findFirst({
            where: {
              email: normalizedEmail,
              reason: reason,
              clinicId: options?.clinicId || null,
            },
          });

          if (existing) {
            await emailSuppressionClient.emailSuppressionList.update({
              where: { id: existing.id },
              data: {
                source: source,
                userId: options?.userId ?? null,
                clinicId: options?.clinicId ?? null,
                messageId: options?.messageId ?? null,
                bounceType: options?.bounceType ?? null,
                bounceSubType: options?.bounceSubType ?? null,
                complaintType: options?.complaintType ?? null,
                description: options?.description ?? null,
                metadata: options?.metadata ?? null,
                expiresAt: options?.expiresAt ?? null,
                isActive: true,
                updatedAt: new Date(),
              },
            });
          } else {
            await emailSuppressionClient.emailSuppressionList.create({
              data: {
                email: normalizedEmail,
                reason: reason,
                source: source,
                userId: options?.userId ?? null,
                clinicId: options?.clinicId ?? null,
                messageId: options?.messageId ?? null,
                bounceType: options?.bounceType ?? null,
                bounceSubType: options?.bounceSubType ?? null,
                complaintType: options?.complaintType ?? null,
                description: options?.description ?? null,
                metadata: options?.metadata ?? null,
                expiresAt: options?.expiresAt ?? null,
                isActive: true,
              },
            });
          }
        },
        {
          userId: options?.userId || 'system',
          userRole: 'SYSTEM',
          clinicId: options?.clinicId || '',
          operation: 'ADD_TO_SUPPRESSION_LIST',
          resourceType: 'EMAIL_SUPPRESSION',
          resourceId: normalizedEmail,
          timestamp: new Date(),
        }
      );

      // Invalidate cache
      const cacheKey = `${this.cachePrefix}${normalizedEmail}`;
      await this.cacheService.delete(cacheKey);

      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.INFO,
        `Added email to suppression list: ${normalizedEmail}`,
        'SuppressionListService',
        {
          email: normalizedEmail,
          reason,
          source,
          userId: options?.userId,
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        `Failed to add email to suppression list: ${error instanceof Error ? error.message : String(error)}`,
        'SuppressionListService',
        {
          email: normalizedEmail,
          reason,
          source,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Remove email from suppression list
   */
  async removeFromSuppressionList(email: string, reason?: SuppressionReason): Promise<void> {
    const normalizedEmail = email.toLowerCase();

    try {
      await this.databaseService.executeHealthcareWrite(
        async client => {
          const emailSuppressionClient = client as unknown as {
            emailSuppressionList: {
              updateMany: (args: {
                where: {
                  email: string;
                  reason?: string;
                  isActive: boolean;
                };
                data: {
                  isActive: boolean;
                  updatedAt: Date;
                };
              }) => Promise<unknown>;
            };
          };
          if (reason) {
            await emailSuppressionClient.emailSuppressionList.updateMany({
              where: {
                email: normalizedEmail,
                reason: reason,
                isActive: true,
              },
              data: {
                isActive: false,
                updatedAt: new Date(),
              },
            });
          } else {
            await emailSuppressionClient.emailSuppressionList.updateMany({
              where: {
                email: normalizedEmail,
                isActive: true,
              },
              data: {
                isActive: false,
                updatedAt: new Date(),
              },
            });
          }
        },
        {
          userId: 'system',
          userRole: 'SYSTEM',
          clinicId: '',
          operation: 'REMOVE_FROM_SUPPRESSION_LIST',
          resourceType: 'EMAIL_SUPPRESSION',
          resourceId: normalizedEmail,
          timestamp: new Date(),
        }
      );

      // Invalidate cache
      const cacheKey = `${this.cachePrefix}${normalizedEmail}`;
      await this.cacheService.delete(cacheKey);

      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.INFO,
        `Removed email from suppression list: ${normalizedEmail}`,
        'SuppressionListService',
        {
          email: normalizedEmail,
          reason,
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        `Failed to remove email from suppression list: ${error instanceof Error ? error.message : String(error)}`,
        'SuppressionListService',
        {
          email: normalizedEmail,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Get suppression list entry
   */
  async getSuppressionEntry(email: string): Promise<SuppressionListEntry | null> {
    const normalizedEmail = email.toLowerCase();

    try {
      const entry = await this.databaseService.executeHealthcareRead(async client => {
        const emailSuppressionClient = client as unknown as {
          emailSuppressionList: {
            findFirst: (args: {
              where: {
                email: string;
                isActive: boolean;
              };
              orderBy: {
                suppressedAt: 'desc';
              };
            }) => Promise<{
              id: string;
              email: string;
              reason: string;
              source: string;
              userId: string | null;
              messageId: string | null;
              bounceType: string | null;
              bounceSubType: string | null;
              complaintType: string | null;
              description: string | null;
              metadata: unknown;
              suppressedAt: Date;
              expiresAt: Date | null;
              isActive: boolean;
            } | null>;
          };
        };
        return await emailSuppressionClient.emailSuppressionList.findFirst({
          where: {
            email: normalizedEmail,
            isActive: true,
          },
          orderBy: {
            suppressedAt: 'desc',
          },
        });
      });

      if (!entry) {
        return null;
      }

      return {
        id: entry.id,
        email: entry.email,
        reason: entry.reason as SuppressionReason,
        source: entry.source as SuppressionSource,
        userId: entry.userId,
        messageId: entry.messageId,
        bounceType: entry.bounceType,
        bounceSubType: entry.bounceSubType,
        complaintType: entry.complaintType,
        description: entry.description,
        metadata: entry.metadata as Record<string, unknown> | null,
        suppressedAt: entry.suppressedAt,
        expiresAt: entry.expiresAt,
        isActive: entry.isActive,
      };
    } catch (error) {
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        `Failed to get suppression entry: ${error instanceof Error ? error.message : String(error)}`,
        'SuppressionListService',
        {
          email: normalizedEmail,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      return null;
    }
  }

  /**
   * Handle bounce - add to suppression list
   */
  async handleBounce(
    email: string,
    bounceType: string,
    bounceSubType: string,
    messageId?: string,
    userId?: string,
    metadata?: Record<string, unknown>,
    clinicId?: string
  ): Promise<void> {
    // Only suppress permanent bounces
    if (bounceType === 'Permanent') {
      await this.addToSuppressionList(email, SuppressionReason.BOUNCE, SuppressionSource.SES, {
        ...(userId && { userId }),
        ...(messageId && { messageId }),
        bounceType,
        bounceSubType,
        description: `Permanent bounce: ${bounceSubType}`,
        ...(metadata && { metadata }),
        ...(clinicId && { clinicId }),
      });

      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.WARN,
        `Permanent bounce detected, email suppressed: ${email}`,
        'SuppressionListService',
        {
          email,
          bounceType,
          bounceSubType,
          messageId,
          userId,
          clinicId,
        }
      );
    } else {
      // Log transient bounces but don't suppress
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.WARN,
        `Transient bounce detected: ${email}`,
        'SuppressionListService',
        {
          email,
          bounceType,
          bounceSubType,
          messageId,
          userId,
          clinicId,
        }
      );
    }
  }

  /**
   * Handle complaint - add to suppression list
   */
  async handleComplaint(
    email: string,
    complaintType: string,
    messageId?: string,
    userId?: string,
    metadata?: Record<string, unknown>,
    clinicId?: string
  ): Promise<void> {
    await this.addToSuppressionList(email, SuppressionReason.COMPLAINT, SuppressionSource.SES, {
      ...(userId && { userId }),
      ...(messageId && { messageId }),
      complaintType,
      description: `Spam complaint: ${complaintType}`,
      ...(metadata && { metadata }),
      ...(clinicId && { clinicId }),
    });

    await this.loggingService.log(
      LogType.EMAIL,
      LogLevel.WARN,
      `Spam complaint detected, email suppressed: ${email}`,
      'SuppressionListService',
      {
        email,
        complaintType,
        messageId,
        userId,
        clinicId,
      }
    );
  }

  /**
   * Handle unsubscribe - add to suppression list
   */
  async handleUnsubscribe(
    email: string,
    userId?: string,
    metadata?: Record<string, unknown>,
    clinicId?: string
  ): Promise<void> {
    await this.addToSuppressionList(
      email,
      SuppressionReason.UNSUBSCRIBE,
      SuppressionSource.USER_ACTION,
      {
        ...(userId && { userId }),
        description: 'User unsubscribed from emails',
        ...(metadata && { metadata }),
        ...(clinicId && { clinicId }),
      }
    );

    await this.loggingService.log(
      LogType.EMAIL,
      LogLevel.INFO,
      `User unsubscribed, email suppressed: ${email}`,
      'SuppressionListService',
      {
        email,
        userId,
        clinicId,
      }
    );
  }

  /**
   * Get suppression statistics
   */
  async getSuppressionStats(): Promise<{
    total: number;
    byReason: Record<string, number>;
    bySource: Record<string, number>;
  }> {
    try {
      const stats = await this.databaseService.executeHealthcareRead(async client => {
        const emailSuppressionClient = client as unknown as {
          emailSuppressionList: {
            count: (args: {
              where: {
                isActive: boolean;
              };
            }) => Promise<number>;
            groupBy: (args: {
              by: string[];
              where: {
                isActive: boolean;
              };
              _count: {
                id: boolean;
              };
            }) => Promise<
              Array<{
                reason?: string;
                source?: string;
                _count: { id: number };
              }>
            >;
          };
        };
        const total = await emailSuppressionClient.emailSuppressionList.count({
          where: {
            isActive: true,
          },
        });

        const byReason = await emailSuppressionClient.emailSuppressionList.groupBy({
          by: ['reason'],
          where: {
            isActive: true,
          },
          _count: {
            id: true,
          },
        });

        const bySource = await emailSuppressionClient.emailSuppressionList.groupBy({
          by: ['source'],
          where: {
            isActive: true,
          },
          _count: {
            id: true,
          },
        });

        return {
          total,
          byReason: byReason.reduce(
            (acc: Record<string, number>, item: { reason?: string; _count: { id: number } }) => {
              if (item.reason) {
                acc[item.reason] = item._count.id;
              }
              return acc;
            },
            {} as Record<string, number>
          ),
          bySource: bySource.reduce(
            (acc: Record<string, number>, item: { source?: string; _count: { id: number } }) => {
              if (item.source) {
                acc[item.source] = item._count.id;
              }
              return acc;
            },
            {} as Record<string, number>
          ),
        };
      });

      return stats;
    } catch (error) {
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        `Failed to get suppression stats: ${error instanceof Error ? error.message : String(error)}`,
        'SuppressionListService',
        {
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      return {
        total: 0,
        byReason: {},
        bySource: {},
      };
    }
  }
}
