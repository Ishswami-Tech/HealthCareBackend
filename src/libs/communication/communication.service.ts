/**
 * Communication Service
 * =====================
 * Unified communication service for all channels (email, WhatsApp, push, socket, SMS)
 * Integrates with central event system and uses smart channel selection
 *
 * @module CommunicationService
 * @description Single entry point for all communication needs
 */

import { Injectable, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

// Infrastructure services - Use direct imports to avoid TDZ issues with barrel exports
import { EventService } from '@infrastructure/events/event.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { DatabaseService } from '@infrastructure/database/database.service';
import {
  LogType,
  LogLevel,
  EventCategory,
  EventPriority,
  type IEventService,
  isEventService,
} from '@core/types';

// Channel services
import { SocketService } from '@communication/channels/socket/socket.service';
import { PushNotificationService } from '@communication/channels/push/push.service';
import { EmailService } from '@communication/channels/email/email.service';
import { EmailTemplatesService } from '@communication/channels/email/email-templates.service';
import { WhatsAppService } from '@communication/channels/whatsapp/whatsapp.service';
import { SNSBackupService } from '@communication/channels/push/sns-backup.service';
import { CommunicationHealthMonitorService } from './communication-health-monitor.service';

// Types
import {
  CommunicationCategory,
  DeliveryStrategy,
  CommunicationPriority,
  type CommunicationRequest,
  type CommunicationDeliveryResult,
  type ChannelDeliveryResult,
  type CommunicationChannel,
  type CategoryChannelConfig,
  type UserCommunicationPreferences,
} from '@core/types';
import type { EnterpriseEventPayload } from '@core/types';

/**
 * Communication Service
 * Provides unified interface for all communication channels
 */
@Injectable()
export class CommunicationService implements OnModuleInit {
  // Category to channel mapping
  // Primary channels: Email + WhatsApp + Push + Socket (always sent)
  // SMS: Secondary (only on user request)
  private readonly categoryConfig: Map<CommunicationCategory, CategoryChannelConfig> = new Map([
    [
      CommunicationCategory.LOGIN,
      {
        // Auth: Only email + WhatsApp (no push/socket for security)
        defaultChannels: ['email', 'whatsapp'],
        strategy: DeliveryStrategy.IMMEDIATE,
        priority: CommunicationPriority.LOW,
        rateLimit: { limit: 10, windowSeconds: 60 }, // Prevent spam
      },
    ],
    [
      CommunicationCategory.EHR_RECORD,
      {
        defaultChannels: ['socket', 'push', 'email', 'whatsapp'],
        requiredChannels: ['socket'],
        strategy: DeliveryStrategy.IMMEDIATE,
        priority: CommunicationPriority.HIGH,
      },
    ],
    [
      CommunicationCategory.APPOINTMENT,
      {
        defaultChannels: ['socket', 'push', 'email', 'whatsapp'],
        strategy: DeliveryStrategy.IMMEDIATE,
        priority: CommunicationPriority.HIGH,
      },
    ],
    [
      CommunicationCategory.REMINDER,
      {
        defaultChannels: ['push', 'email', 'whatsapp', 'socket'],
        strategy: DeliveryStrategy.SCHEDULED,
        priority: CommunicationPriority.NORMAL,
      },
    ],
    [
      CommunicationCategory.BILLING,
      {
        defaultChannels: ['push', 'email', 'whatsapp', 'socket'],
        strategy: DeliveryStrategy.QUEUED,
        priority: CommunicationPriority.NORMAL,
      },
    ],
    [
      CommunicationCategory.CRITICAL,
      {
        defaultChannels: ['socket', 'push', 'email', 'whatsapp'],
        requiredChannels: ['socket', 'push'],
        fallbackChannels: ['sms'], // SMS only as fallback, requires user preference
        strategy: DeliveryStrategy.IMMEDIATE,
        priority: CommunicationPriority.CRITICAL,
      },
    ],
    [
      CommunicationCategory.SYSTEM,
      {
        defaultChannels: ['socket', 'email', 'whatsapp'],
        strategy: DeliveryStrategy.QUEUED,
        priority: CommunicationPriority.NORMAL,
      },
    ],
    [
      CommunicationCategory.USER_ACTIVITY,
      {
        defaultChannels: ['socket', 'email', 'whatsapp'],
        strategy: DeliveryStrategy.IMMEDIATE,
        priority: CommunicationPriority.LOW,
      },
    ],
    [
      CommunicationCategory.PRESCRIPTION,
      {
        defaultChannels: ['push', 'email', 'whatsapp', 'socket'],
        strategy: DeliveryStrategy.IMMEDIATE,
        priority: CommunicationPriority.HIGH,
      },
    ],
    [
      CommunicationCategory.CHAT,
      {
        defaultChannels: ['socket', 'email', 'whatsapp'],
        strategy: DeliveryStrategy.IMMEDIATE,
        priority: CommunicationPriority.NORMAL,
      },
    ],
  ]);

  // Metrics
  private metrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    channelMetrics: {
      socket: { sent: 0, successful: 0, failed: 0 },
      push: { sent: 0, successful: 0, failed: 0 },
      email: { sent: 0, successful: 0, failed: 0 },
      sms: { sent: 0, successful: 0, failed: 0 },
      whatsapp: { sent: 0, successful: 0, failed: 0 },
    },
  };

  constructor(
    private readonly socketService: SocketService,
    private readonly pushService: PushNotificationService,
    private readonly emailService: EmailService,
    private readonly emailTemplatesService: EmailTemplatesService,
    private readonly whatsAppService: WhatsAppService,
    private readonly snsBackupService: SNSBackupService,

    @Inject(forwardRef(() => EventService))
    private readonly eventService: unknown,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => CommunicationHealthMonitorService))
    private readonly healthMonitor?: CommunicationHealthMonitorService
  ) {}

  private typedEventService?: IEventService;

  async onModuleInit(): Promise<void> {
    // Type guard for EventService
    if (!isEventService(this.eventService)) {
      throw new Error('EventService is not available or invalid');
    }
    this.typedEventService = this.eventService;

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'CommunicationService initialized',
      'CommunicationService',
      {
        categories: Array.from(this.categoryConfig.keys()),
        channelCount: 5, // socket, push, email, sms, whatsapp
      }
    );
  }

  /**
   * Send communication through appropriate channels
   */
  async send(request: CommunicationRequest): Promise<CommunicationDeliveryResult> {
    const requestId = uuidv4();
    this.metrics.totalRequests++;

    try {
      await this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.INFO,
        'Processing communication request',
        'CommunicationService',
        {
          requestId,
          category: request.category,
          recipientCount: request.recipients.length,
          channels: request.channels,
        }
      );

      // Determine channels to use
      const channels = this.determineChannels(request);

      // Apply rate limiting if enabled
      if (request.applyRateLimit !== false) {
        const rateLimited = await this.checkRateLimit(request);
        if (rateLimited) {
          await this.loggingService.log(
            LogType.NOTIFICATION,
            LogLevel.WARN,
            'Communication request rate limited',
            'CommunicationService',
            { requestId, category: request.category }
          );
          return {
            success: false,
            requestId,
            results: [],
            timestamp: new Date(),
            metadata: { rateLimited: true },
          };
        }
      }

      // Fetch phone numbers for recipients with userId (for WhatsApp/SMS)
      const enrichedRecipients = await this.enrichRecipientsWithPhoneNumbers(request.recipients);

      // Get user preferences if enabled
      const preferences =
        request.respectPreferences !== false
          ? await this.getUserPreferences(enrichedRecipients)
          : undefined;

      // Filter channels based on preferences (SMS only if user explicitly enabled)
      const finalChannels = this.filterChannelsByPreferences(
        channels,
        preferences,
        enrichedRecipients,
        request.category
      );

      // Update request with enriched recipients
      request.recipients = enrichedRecipients;

      // Send through each channel and track delivery status
      const results: ChannelDeliveryResult[] = [];
      const sendPromises: Promise<ChannelDeliveryResult>[] = [];
      const notificationIds: Map<string, string> = new Map(); // recipientId -> notificationId

      // Create notification records for each recipient
      for (const recipient of request.recipients) {
        if (recipient.userId) {
          try {
            // Validate user exists before creating notification to avoid foreign key constraint violations
            const userId = recipient.userId;
            if (!userId) {
              continue;
            }

            const userExists = await this.databaseService.executeHealthcareRead<boolean>(
              async prisma => {
                const user = await prisma.user.findUnique({
                  where: { id: userId },
                  select: { id: true },
                });
                return !!user;
              }
            );

            if (!userExists) {
              void this.loggingService.log(
                LogType.DATABASE,
                LogLevel.WARN,
                `Skipping notification creation - user not found: ${recipient.userId}`,
                'CommunicationService',
                { userId: recipient.userId }
              );
              continue;
            }

            const notification = await this.databaseService.executeWrite(
              async prisma => {
                const client = this.databaseService['toTransactionClient'](prisma);
                const notificationClient = client as unknown as {
                  notification: {
                    create: (args: {
                      data: {
                        userId: string;
                        type: string;
                        message: string;
                        status: string;
                        deliveryStatus: string;
                        channel: string;
                        clinicId: string | null;
                      };
                    }) => Promise<{ id: string }>;
                  };
                };
                return await notificationClient.notification.create({
                  data: {
                    userId: recipient.userId!,
                    type: this.mapChannelToNotificationType(finalChannels[0] || 'email'),
                    message: request.body,
                    status: 'PENDING',
                    deliveryStatus: 'PENDING',
                    channel: finalChannels[0] || 'email',
                    clinicId:
                      request.metadata &&
                      typeof request.metadata === 'object' &&
                      'clinicId' in request.metadata
                        ? (request.metadata['clinicId'] as string | undefined) || null
                        : null,
                  },
                });
              },
              {
                userId: 'system',
                userRole: 'system',
                clinicId:
                  request.metadata &&
                  typeof request.metadata === 'object' &&
                  'clinicId' in request.metadata
                    ? (request.metadata['clinicId'] as string | undefined) || ''
                    : '',
                operation: 'createNotification',
                resourceType: 'NOTIFICATION',
                resourceId: 'pending',
                timestamp: new Date(),
              }
            );
            notificationIds.set(recipient.userId, (notification as { id: string }).id);
          } catch (error) {
            void this.loggingService.log(
              LogType.DATABASE,
              LogLevel.WARN,
              'Failed to create notification record',
              'CommunicationService',
              {
                userId: recipient.userId,
                error: error instanceof Error ? error.message : 'Unknown error',
              }
            );
          }
        }
      }

      for (const channel of finalChannels) {
        for (const recipient of request.recipients) {
          // Validate channel can be sent to this recipient (skip if missing required contact info)
          if (!this.canSendChannel(channel, recipient)) {
            const recipientId = recipient.userId || recipient.email || recipient.phoneNumber || 'unknown';
            await this.loggingService.log(
              LogType.NOTIFICATION,
              LogLevel.DEBUG,
              `Skipping ${channel} channel - missing required contact info for recipient`,
              'CommunicationService',
              {
                channel,
                recipientId,
                hasEmail: !!recipient.email,
                hasPhone: !!recipient.phoneNumber,
                hasDeviceToken: !!recipient.deviceToken,
                hasUserId: !!recipient.userId,
              }
            );
            continue;
          }

          const sendPromise = this.sendToChannelWithTracking(
            channel,
            request,
            recipient,
            notificationIds.get(recipient.userId || '')
          );
          sendPromises.push(sendPromise);
        }
      }

      const channelResults = await Promise.allSettled(sendPromises);
      for (const result of channelResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push({
            channel: 'email', // Default fallback
            success: false,
            error: result.reason instanceof Error ? result.reason.message : 'Unknown error',
            timestamp: new Date(),
          });
        }
      }

      // Determine overall success
      const overallSuccess = results.some(r => r.success);

      // Update metrics
      if (overallSuccess) {
        this.metrics.successfulRequests++;
      } else {
        this.metrics.failedRequests++;
      }

      for (const result of results) {
        this.metrics.channelMetrics[result.channel].sent++;
        if (result.success) {
          this.metrics.channelMetrics[result.channel].successful++;
        } else {
          this.metrics.channelMetrics[result.channel].failed++;
        }
      }

      // Emit event
      await this.emitCommunicationEvent(request, results, overallSuccess);

      const deliveryResult: CommunicationDeliveryResult = {
        success: overallSuccess,
        requestId,
        results,
        timestamp: new Date(),
        metadata: {
          category: request.category,
          channelsUsed: finalChannels,
          recipientCount: request.recipients.length,
        },
      };

      await this.loggingService.log(
        LogType.NOTIFICATION,
        overallSuccess ? LogLevel.INFO : LogLevel.WARN,
        'Communication request completed',
        'CommunicationService',
        {
          requestId,
          success: overallSuccess,
          channelsUsed: finalChannels,
          resultCount: results.length,
        }
      );

      return deliveryResult;
    } catch (error) {
      this.metrics.failedRequests++;
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Communication request failed',
        'CommunicationService',
        {
          requestId,
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        }
      );

      return {
        success: false,
        requestId,
        results: [],
        timestamp: new Date(),
        metadata: {
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }

  /**
   * Determine which channels to use based on category and request
   */
  private determineChannels(request: CommunicationRequest): CommunicationChannel[] {
    // If channels are explicitly specified, use them
    if (request.channels && request.channels.length > 0) {
      return request.channels;
    }

    // Get category configuration
    const config = this.categoryConfig.get(request.category);
    if (!config) {
      // Default to email if category not found
      return ['email'];
    }

    // Start with default channels
    const channels = [...config.defaultChannels];

    // Add required channels if any
    if (config.requiredChannels) {
      for (const required of config.requiredChannels) {
        if (!channels.includes(required)) {
          channels.push(required);
        }
      }
    }

    return channels;
  }

  /**
   * Type guard to safely get category channels from preferences
   */
  private getCategoryChannels(
    categoryPreferences: Record<string, CommunicationChannel[]>,
    categoryKey: string
  ): CommunicationChannel[] | undefined {
    const value = categoryPreferences[categoryKey];
    return Array.isArray(value) ? value : undefined;
  }

  /**
   * Enrich recipients with phone numbers and email addresses from database
   * Fetches missing contact information to enable all communication channels
   */
  private async enrichRecipientsWithPhoneNumbers(
    recipients: CommunicationRequest['recipients']
  ): Promise<CommunicationRequest['recipients']> {
    const enriched = await Promise.all(
      recipients.map(async recipient => {
        // If both email and phone already provided, no need to fetch
        if (recipient.email && recipient.phoneNumber) {
          return recipient;
        }

        // If userId provided, fetch email and phone number from database
        if (recipient.userId) {
          try {
            const user = await this.databaseService.executeHealthcareRead(async prisma => {
              return await prisma.user.findUnique({
                where: { id: recipient.userId },
                select: {
                  email: true,
                  phoneNumber: true,
                },
              });
            });

            if (user) {
              return {
                ...recipient,
                // Only add if not already provided
                ...(recipient.email ? {} : { email: user.email || undefined }),
                ...(recipient.phoneNumber ? {} : { phoneNumber: user.phoneNumber || undefined }),
              };
            }
          } catch (error) {
            await this.loggingService.log(
              LogType.ERROR,
              LogLevel.WARN,
              `Failed to fetch user contact info for ${recipient.userId}`,
              'CommunicationService',
              {
                userId: recipient.userId,
                error: error instanceof Error ? error.message : 'Unknown error',
              }
            );
          }
        }

        return recipient;
      })
    );

    return enriched;
  }

  /**
   * Check if SMS should be sent (only if user explicitly enabled it)
   */
  private shouldSendSMS(
    channel: CommunicationChannel,
    userId: string | undefined,
    preferences: Map<string, UserCommunicationPreferences> | undefined,
    category?: CommunicationCategory
  ): boolean {
    // SMS is only sent if explicitly requested/enabled
    if (channel !== 'sms') {
      return true; // Not SMS, proceed normally
    }

    // If no userId, don't send SMS (can't check preference)
    if (!userId) {
      return false;
    }

    // If no preferences, don't send SMS (opt-in required)
    if (!preferences || preferences.size === 0) {
      return false;
    }

    const userPrefs = preferences.get(userId);
    if (!userPrefs) {
      return false; // No preferences = no SMS
    }

    // Check if SMS is explicitly enabled
    // Access via type assertion since smsEnabled may not be in the interface
    const prefs = userPrefs as UserCommunicationPreferences & {
      smsEnabled?: boolean;
    };

    // SMS must be explicitly enabled
    if (prefs.smsEnabled !== true) {
      return false;
    }

    // Check category-specific SMS preference
    if (category && userPrefs.categoryPreferences) {
      const categoryKey = category.toLowerCase();
      const categoryChannels = this.getCategoryChannels(
        userPrefs.categoryPreferences,
        categoryKey
      );
      // If category preferences exist and SMS is not included, don't send
      if (categoryChannels && categoryChannels.length > 0 && !categoryChannels.includes('sms')) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if a channel can be sent to a recipient based on required contact info
   * @param channel - Channel to check
   * @param recipient - Recipient to validate
   * @returns true if channel can be sent, false otherwise
   */
  private canSendChannel(
    channel: CommunicationChannel,
    recipient: CommunicationRequest['recipients'][0]
  ): boolean {
    switch (channel) {
      case 'email':
        return !!recipient.email;
      case 'whatsapp':
      case 'sms':
        return !!recipient.phoneNumber;
      case 'push':
        return !!recipient.deviceToken || !!recipient.userId; // Can fetch device token from userId
      case 'socket':
        return !!recipient.socketRoom || !!recipient.userId; // Can derive room from userId
      default:
        return true; // Unknown channels - allow (will fail gracefully in sendToChannel)
    }
  }

  /**
   * Filter channels based on user preferences
   */
  private filterChannelsByPreferences(
    channels: CommunicationChannel[],
    preferences: Map<string, UserCommunicationPreferences> | undefined,
    recipients: CommunicationRequest['recipients'],
    category?: CommunicationCategory
  ): CommunicationChannel[] {
    if (!preferences || preferences.size === 0) {
      // Even without preferences, SMS should be opt-in only
      return channels.filter(channel => channel !== 'sms');
    }

    const filteredChannels = new Set<CommunicationChannel>();

    for (const channel of channels) {
      let shouldInclude = true;

      for (const recipient of recipients) {
        if (recipient.userId) {
          const userPrefs = preferences.get(recipient.userId);
          if (userPrefs) {
            // Special handling for SMS: Only send if user explicitly enabled
            if (channel === 'sms') {
              if (
                !this.shouldSendSMS(channel, recipient.userId, preferences, category)
              ) {
                shouldInclude = false;
                break;
              }
            }
            // Check quiet hours
            if (userPrefs.quietHours) {
              const now = new Date();
              const currentTime = now.toLocaleTimeString('en-US', {
                hour12: false,
                hour: '2-digit',
                minute: '2-digit',
                timeZone: userPrefs.quietHours.timezone || 'UTC',
              });

              const quietStart = userPrefs.quietHours.start || '22:00';
              const quietEnd = userPrefs.quietHours.end || '08:00';

              // Check if current time is within quiet hours
              if (this.isInQuietHours(currentTime, quietStart, quietEnd)) {
                // Skip non-critical notifications during quiet hours
                shouldInclude = false;
                break;
              }
            }

            // Check category-specific preferences
            if (category && userPrefs.categoryPreferences) {
              const categoryKey = category.toLowerCase();
              const categoryChannels = this.getCategoryChannels(
                userPrefs.categoryPreferences,
                categoryKey
              );
              if (
                categoryChannels &&
                categoryChannels.length > 0 &&
                !categoryChannels.includes(channel)
              ) {
                shouldInclude = false;
                break;
              }
            }

            // Check category enablement (appointment, ehr, billing, system)
            // Access via type assertion since these properties may not be in the interface
            const prefs = userPrefs as UserCommunicationPreferences & {
              appointmentEnabled?: boolean;
              ehrEnabled?: boolean;
              billingEnabled?: boolean;
              systemEnabled?: boolean;
            };
            if (category) {
              const categoryKey = category.toLowerCase();
              if (categoryKey === 'appointment' && prefs.appointmentEnabled === false) {
                shouldInclude = false;
                break;
              }
              if (
                (categoryKey === 'ehr_record' || categoryKey === 'ehr') &&
                prefs.ehrEnabled === false
              ) {
                shouldInclude = false;
                break;
              }
              if (categoryKey === 'billing' && prefs.billingEnabled === false) {
                shouldInclude = false;
                break;
              }
              if (categoryKey === 'system' && prefs.systemEnabled === false) {
                shouldInclude = false;
                break;
              }
            }

            // Check if channel is disabled for this user
            if (userPrefs.disabledChannels.includes(channel)) {
              shouldInclude = false;
              break;
            }
            // Check if channel is enabled (if enabledChannels is specified)
            if (
              userPrefs.enabledChannels.length > 0 &&
              !userPrefs.enabledChannels.includes(channel)
            ) {
              shouldInclude = false;
              break;
            }
          }
        }
      }

      if (shouldInclude) {
        filteredChannels.add(channel);
      }
    }

    return Array.from(filteredChannels);
  }

  /**
   * Check if current time is within quiet hours
   */
  private isInQuietHours(currentTime: string, start: string, end: string): boolean {
    const [currentHour, currentMin] = currentTime.split(':').map(Number);
    const [startHour, startMin] = start.split(':').map(Number);
    const [endHour, endMin] = end.split(':').map(Number);

    if (
      currentHour === undefined ||
      currentMin === undefined ||
      startHour === undefined ||
      startMin === undefined ||
      endHour === undefined ||
      endMin === undefined
    ) {
      return false;
    }

    const currentMinutes = currentHour * 60 + currentMin;
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    // Handle quiet hours that span midnight
    if (startMinutes > endMinutes) {
      return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
    }

    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }

  /**
   * Check rate limiting
   */
  private async checkRateLimit(request: CommunicationRequest): Promise<boolean> {
    const config = this.categoryConfig.get(request.category);
    if (!config?.rateLimit) {
      return false;
    }

    // Check rate limit per recipient
    for (const recipient of request.recipients) {
      const recipientId = recipient.userId || recipient.email || 'unknown';
      const key = `communication:rate_limit:${request.category}:${recipientId}`;
      const isLimited = await this.cacheService.isRateLimited(
        key,
        config.rateLimit.limit,
        config.rateLimit.windowSeconds
      );

      if (isLimited) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get user communication preferences from database
   */
  private async getUserPreferences(
    recipients: CommunicationRequest['recipients']
  ): Promise<Map<string, UserCommunicationPreferences> | undefined> {
    const preferences = new Map<string, UserCommunicationPreferences>();

    for (const recipient of recipients) {
      if (recipient.userId) {
        try {
          const cacheKey = `notification_preferences:${recipient.userId}`;
          let cached = await this.cacheService.get<{
            emailEnabled: boolean;
            smsEnabled: boolean;
            pushEnabled: boolean;
            socketEnabled: boolean;
            whatsappEnabled: boolean;
            appointmentEnabled: boolean;
            ehrEnabled: boolean;
            billingEnabled: boolean;
            systemEnabled: boolean;
            quietHours?: { start?: string; end?: string; timezone?: string } | null;
            categoryPreferences?: Record<string, string[]> | null;
          }>(cacheKey);

          if (!cached) {
            // Fetch from database
            const dbPrefs = await this.databaseService.findNotificationPreferenceByUserIdSafe(
              recipient.userId
            );

            if (dbPrefs) {
              cached = {
                emailEnabled: dbPrefs.emailEnabled,
                smsEnabled: dbPrefs.smsEnabled,
                pushEnabled: dbPrefs.pushEnabled,
                socketEnabled: dbPrefs.socketEnabled,
                whatsappEnabled: dbPrefs.whatsappEnabled,
                appointmentEnabled: dbPrefs.appointmentEnabled,
                ehrEnabled: dbPrefs.ehrEnabled,
                billingEnabled: dbPrefs.billingEnabled,
                systemEnabled: dbPrefs.systemEnabled,
                quietHours: dbPrefs.quietHoursStart
                  ? ({
                      start: dbPrefs.quietHoursStart,
                      end: dbPrefs.quietHoursEnd || undefined,
                      timezone: dbPrefs.quietHoursTimezone || 'UTC',
                    } as { start?: string; end?: string; timezone?: string } | null)
                  : null,
                categoryPreferences: dbPrefs.categoryPreferences
                  ? (dbPrefs.categoryPreferences as unknown as Record<string, string[]>)
                  : null,
              };

              // Cache for 1 hour
              await this.cacheService.set(cacheKey, cached, 3600);
            } else {
              // Use defaults
              cached = {
                emailEnabled: true,
                smsEnabled: true,
                pushEnabled: true,
                socketEnabled: true,
                whatsappEnabled: false,
                appointmentEnabled: true,
                ehrEnabled: true,
                billingEnabled: true,
                systemEnabled: true,
                quietHours: null,
                categoryPreferences: null,
              };
            }
          }

          if (cached) {
            // Convert to UserCommunicationPreferences format
            const enabledChannels: CommunicationChannel[] = [];
            const disabledChannels: CommunicationChannel[] = [];

            if (cached.emailEnabled) enabledChannels.push('email');
            else disabledChannels.push('email');
            if (cached.smsEnabled) enabledChannels.push('sms');
            else disabledChannels.push('sms');
            if (cached.pushEnabled) enabledChannels.push('push');
            else disabledChannels.push('push');
            if (cached.socketEnabled) enabledChannels.push('socket');
            else disabledChannels.push('socket');
            if (cached.whatsappEnabled) enabledChannels.push('whatsapp');
            else disabledChannels.push('whatsapp');

            preferences.set(recipient.userId, {
              userId: recipient.userId,
              enabledChannels,
              disabledChannels,
              categoryPreferences: cached.categoryPreferences
                ? (cached.categoryPreferences as unknown as Record<string, CommunicationChannel[]>)
                : undefined,
              quietHours: cached.quietHours
                ? {
                    start: cached.quietHours.start || '22:00',
                    end: cached.quietHours.end || '08:00',
                    timezone: cached.quietHours.timezone || 'UTC',
                  }
                : undefined,
              appointmentEnabled: cached.appointmentEnabled ?? true,
              ehrEnabled: cached.ehrEnabled ?? true,
              billingEnabled: cached.billingEnabled ?? true,
              systemEnabled: cached.systemEnabled ?? true,
            } as UserCommunicationPreferences);
          }
        } catch (error) {
          // Log but don't fail
          void this.loggingService.log(
            LogType.CACHE,
            LogLevel.WARN,
            'Failed to get user communication preferences',
            'CommunicationService',
            {
              userId: recipient.userId,
              error: error instanceof Error ? error.message : 'Unknown error',
            }
          );
        }
      }
    }

    return preferences.size > 0 ? preferences : undefined;
  }

  /**
   * Map channel to notification type
   */
  private mapChannelToNotificationType(
    channel: CommunicationChannel
  ): 'EMAIL' | 'SMS' | 'PUSH_NOTIFICATION' {
    switch (channel) {
      case 'email':
        return 'EMAIL';
      case 'sms':
        return 'SMS';
      case 'push':
        return 'PUSH_NOTIFICATION';
      default:
        return 'PUSH_NOTIFICATION';
    }
  }

  /**
   * Send message to a specific channel with delivery tracking
   */
  private async sendToChannelWithTracking(
    channel: CommunicationChannel,
    request: CommunicationRequest,
    recipient: CommunicationRequest['recipients'][0],
    notificationId?: string
  ): Promise<ChannelDeliveryResult> {
    const result = await this.sendToChannel(channel, request, recipient);

    // Track delivery status
    if (notificationId && recipient.userId) {
      try {
        // Create delivery log
        await this.databaseService.executeWrite(
          async prisma => {
            const client = this.databaseService['toTransactionClient'](prisma);
            const notificationClient = client as unknown as {
              notificationDeliveryLog: {
                create: (args: {
                  data: {
                    notificationId: string;
                    channel: string;
                    status: string;
                    sentAt: Date;
                    deliveredAt?: Date;
                    failedAt?: Date;
                    failureReason?: string;
                    providerResponse: unknown;
                    retryCount: number;
                  };
                }) => Promise<unknown>;
              };
              notification: {
                update: (args: {
                  where: { id: string };
                  data: {
                    status: string;
                    deliveryStatus: string;
                    sentAt: Date;
                    deliveredAt?: Date;
                    failedAt?: Date;
                    failureReason?: string;
                    channel: string;
                    deliveryReceipt: unknown;
                  };
                }) => Promise<unknown>;
              };
            };
            await notificationClient.notificationDeliveryLog.create({
              data: {
                notificationId,
                channel,
                status: result.success ? 'SENT' : 'FAILED',
                sentAt: result.timestamp,
                ...(result.success && { deliveredAt: new Date() }),
                ...(!result.success && {
                  failedAt: new Date(),
                  failureReason: result.error || 'Unknown error',
                }),
                providerResponse: result.metadata || null,
                retryCount: 0,
              },
            });

            // Update notification delivery status
            await notificationClient.notification.update({
              where: { id: notificationId },
              data: {
                status: result.success ? 'SENT' : 'FAILED',
                deliveryStatus: result.success ? 'SENT' : 'FAILED',
                sentAt: result.timestamp,
                ...(result.success && { deliveredAt: new Date() }),
                ...(!result.success && {
                  failedAt: new Date(),
                  failureReason: result.error || 'Unknown error',
                }),
                channel,
                deliveryReceipt: result.metadata || null,
              },
            });
          },
          {
            userId: 'system',
            userRole: 'system',
            clinicId:
              request.metadata &&
              typeof request.metadata === 'object' &&
              'clinicId' in request.metadata
                ? (request.metadata['clinicId'] as string | undefined) || ''
                : '',
            operation: 'updateNotificationDeliveryStatus',
            resourceType: 'NOTIFICATION',
            resourceId: notificationId,
            timestamp: new Date(),
          }
        );
      } catch (error) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.WARN,
          'Failed to track notification delivery status',
          'CommunicationService',
          {
            notificationId,
            channel,
            error: error instanceof Error ? error.message : 'Unknown error',
          }
        );
      }
    }

    return result;
  }

  /**
   * Send message to a specific channel
   */
  private async sendToChannel(
    channel: CommunicationChannel,
    request: CommunicationRequest,
    recipient: CommunicationRequest['recipients'][0]
  ): Promise<ChannelDeliveryResult> {
    const timestamp = new Date();

    try {
      switch (channel) {
        case 'socket':
          return this.sendSocket(request, recipient, timestamp);
        case 'push':
          return await this.sendPush(request, recipient, timestamp);
        case 'email':
          return await this.sendEmail(request, recipient, timestamp);
        case 'whatsapp':
          return await this.sendWhatsApp(request, recipient, timestamp);
        case 'sms':
          return await this.sendSMS(request, recipient, timestamp);
        default: {
          const channelName = String(channel);
          return {
            channel: channel as CommunicationChannel,
            success: false,
            error: `Unsupported channel: ${channelName}`,
            timestamp,
          };
        }
      }
    } catch (error) {
      return {
        channel,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp,
      };
    }
  }

  /**
   * Send via Socket.IO
   */
  private sendSocket(
    request: CommunicationRequest,
    recipient: CommunicationRequest['recipients'][0],
    timestamp: Date
  ): Promise<ChannelDeliveryResult> {
    try {
      if (!recipient.socketRoom && !recipient.userId) {
        return Promise.resolve({
          channel: 'socket',
          success: false,
          error: 'No socket room or userId provided',
          timestamp,
        });
      }

      const room =
        recipient.socketRoom || (recipient.userId ? `user:${recipient.userId}` : 'unknown');
      const socketData: Record<string, string | number | boolean | null> = {
        type: String(request.category),
        title: request.title,
        body: request.body,
      };
      if (request.data) {
        // Convert data to socket-compatible format
        for (const [key, value] of Object.entries(request.data)) {
          if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean' ||
            value === null
          ) {
            socketData[key] = value;
          } else {
            socketData[key] = JSON.stringify(value);
          }
        }
      }
      // SocketService.sendToRoom is synchronous, but we wrap it for consistency
      this.socketService.sendToRoom(room, request.title, socketData);

      return Promise.resolve({
        channel: 'socket',
        success: true,
        messageId: `socket:${room}:${Date.now()}`,
        timestamp,
      });
    } catch (error) {
      return Promise.resolve({
        channel: 'socket',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp,
      });
    }
  }

  /**
   * Send push notification
   * PushNotificationService handles FCM primary and SNS fallback internally
   */
  private async sendPush(
    request: CommunicationRequest,
    recipient: CommunicationRequest['recipients'][0],
    timestamp: Date
  ): Promise<ChannelDeliveryResult> {
    try {
      if (!recipient.deviceToken) {
        return {
          channel: 'push',
          success: false,
          error: 'No device token provided',
          timestamp,
        };
      }

      // PushNotificationService handles FCM primary and SNS fallback automatically
      const result = await this.pushService.sendToDevice(
        recipient.deviceToken,
        {
          title: request.title,
          body: request.body,
          ...(request.data && { data: request.data as Record<string, string> }),
        },
        recipient.userId
      );

      return {
        channel: 'push',
        success: result.success,
        ...(result.messageId && { messageId: result.messageId }),
        ...(result.success ? {} : { error: result.error || 'Unknown error' }),
        timestamp,
        ...(result.provider && {
          metadata: { provider: result.provider, usedFallback: result.usedFallback },
        }),
      };
    } catch (error) {
      return {
        channel: 'push',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp,
      };
    }
  }

  /**
   * Send email using EmailService (unified email provider interface)
   * EmailService handles provider selection internally (SMTP, Mailtrap, SES, etc.)
   * This provides a single entry point for all email operations
   * Supports multi-tenant communication via clinicId
   */
  private async sendEmail(
    request: CommunicationRequest,
    recipient: CommunicationRequest['recipients'][0],
    timestamp: Date
  ): Promise<ChannelDeliveryResult> {
    try {
      if (!recipient.email) {
        return {
          channel: 'email',
          success: false,
          error: 'No email address provided',
          timestamp,
        };
      }

      // Extract clinicId from request metadata
      const clinicId =
        request.metadata && typeof request.metadata === 'object' && 'clinicId' in request.metadata
          ? (request.metadata['clinicId'] as string | undefined)
          : undefined;

      // Use EmailService as the unified email provider interface
      // EmailService handles provider selection (SMTP, Mailtrap, SES, etc.) internally
      // Pass clinicId for multi-tenant provider routing
      // Pass userId for unsubscribe link generation
      const emailResult = await this.emailService.sendSimpleEmail(
        {
          to: recipient.email,
          subject: request.title,
          body: request.body,
          isHtml: true,
          ...(recipient.userId && { userId: recipient.userId }),
        },
        clinicId
      );

      return {
        channel: 'email',
        success: emailResult.success,
        ...(emailResult.messageId && { messageId: emailResult.messageId }),
        ...(emailResult.success ? {} : { error: emailResult.error || 'Unknown error' }),
        timestamp,
      };
    } catch (error) {
      await this.loggingService.log(
        LogType.EMAIL,
        LogLevel.ERROR,
        'Failed to send email',
        'CommunicationService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          recipient: recipient.email,
          stack: error instanceof Error ? error.stack : undefined,
        }
      );

      return {
        channel: 'email',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp,
      };
    }
  }

  /**
   * Send WhatsApp message
   * Supports multi-tenant communication via clinicId
   */
  private async sendWhatsApp(
    request: CommunicationRequest,
    recipient: CommunicationRequest['recipients'][0],
    timestamp: Date
  ): Promise<ChannelDeliveryResult> {
    try {
      if (!recipient.phoneNumber) {
        return {
          channel: 'whatsapp',
          success: false,
          error: 'No phone number provided',
          timestamp,
        };
      }

      // Extract clinicId from request metadata
      const clinicId =
        request.metadata && typeof request.metadata === 'object' && 'clinicId' in request.metadata
          ? (request.metadata['clinicId'] as string | undefined)
          : undefined;

      // Use WhatsApp service to send message
      // Pass clinicId for multi-tenant provider routing
      const message = `${request.title}\n\n${request.body}`;
      const success = await this.whatsAppService.sendCustomMessage(
        recipient.phoneNumber,
        message,
        clinicId
      );

      return {
        channel: 'whatsapp',
        success,
        ...(success && { messageId: `whatsapp:${recipient.phoneNumber}:${Date.now()}` }),
        ...(success ? {} : { error: 'Failed to send WhatsApp message' }),
        timestamp,
      };
    } catch (error) {
      return {
        channel: 'whatsapp',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp,
      };
    }
  }

  /**
   * Send SMS (only if user explicitly enabled it)
   */
  private async sendSMS(
    request: CommunicationRequest,
    recipient: CommunicationRequest['recipients'][0],
    timestamp: Date
  ): Promise<ChannelDeliveryResult> {
    try {
      if (!recipient.phoneNumber) {
        return {
          channel: 'sms',
          success: false,
          error: 'No phone number provided',
          timestamp,
        };
      }

      // SMS should only be sent if user explicitly enabled it
      // This check should have been done in filterChannelsByPreferences,
      // but double-check here for safety
      if (recipient.userId) {
        const preferences = await this.getUserPreferences([recipient]);
        if (!this.shouldSendSMS('sms', recipient.userId, preferences, request.category)) {
          return {
            channel: 'sms',
            success: false,
            error: 'SMS not enabled by user preference',
            timestamp,
          };
        }
      }

      // Extract clinicId from request metadata
      const clinicId =
        request.metadata && typeof request.metadata === 'object' && 'clinicId' in request.metadata
          ? (request.metadata['clinicId'] as string | undefined)
          : undefined;

      // TODO: Implement SMS service adapter when available
      // For now, return not implemented
      await this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.WARN,
        'SMS service not yet implemented',
        'CommunicationService',
        {
          phoneNumber: recipient.phoneNumber,
          clinicId,
        }
      );

      return {
        channel: 'sms',
        success: false,
        error: 'SMS service not yet implemented',
        timestamp,
      };
    } catch (error) {
      return {
        channel: 'sms',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp,
      };
    }
  }

  /**
   * Emit communication event
   */
  private async emitCommunicationEvent(
    request: CommunicationRequest,
    results: ChannelDeliveryResult[],
    success: boolean
  ): Promise<void> {
    try {
      if (!this.typedEventService) {
        return;
      }
      await this.typedEventService.emitEnterprise('communication.sent', {
        eventId: uuidv4(),
        eventType: 'communication.sent',
        category: EventCategory.SYSTEM,
        priority: this.mapPriorityToEventPriority(request.priority),
        timestamp: new Date().toISOString(),
        source: 'CommunicationService',
        version: '1.0.0',
        payload: {
          category: request.category,
          success,
          channels: results.map(r => r.channel),
          recipientCount: request.recipients.length,
          results: results.map(r => ({
            channel: r.channel,
            success: r.success,
            messageId: r.messageId,
          })),
        },
      } as EnterpriseEventPayload);
    } catch (error) {
      // Log but don't fail
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        'Failed to emit communication event',
        'CommunicationService',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      );
    }
  }

  /**
   * Map communication priority to event priority
   */
  private mapPriorityToEventPriority(priority?: CommunicationPriority): EventPriority {
    switch (priority) {
      case CommunicationPriority.CRITICAL:
        return EventPriority.CRITICAL;
      case CommunicationPriority.HIGH:
        return EventPriority.HIGH;
      case CommunicationPriority.LOW:
        return EventPriority.LOW;
      default:
        return EventPriority.NORMAL;
    }
  }

  /**
   * Get communication metrics
   */
  getMetrics(): typeof this.metrics {
    return { ...this.metrics };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      channelMetrics: {
        socket: { sent: 0, successful: 0, failed: 0 },
        push: { sent: 0, successful: 0, failed: 0 },
        email: { sent: 0, successful: 0, failed: 0 },
        sms: { sent: 0, successful: 0, failed: 0 },
        whatsapp: { sent: 0, successful: 0, failed: 0 },
      },
    };
  }

  // ===== HEALTH AND MONITORING =====

  /**
   * Health check using optimized health monitor
   * Uses dedicated health check with timeout protection and caching
   */
  async healthCheck(): Promise<boolean> {
    if (this.healthMonitor) {
      const healthStatus = await this.healthMonitor.getHealthStatus();
      return healthStatus.healthy;
    }
    // Fallback: check if services are available
    return true; // CommunicationService itself is always available if instantiated
  }

  /**
   * Get health status with latency
   * Uses optimized health monitor for real-time status
   */
  async getHealthStatus(): Promise<[boolean, number]> {
    if (this.healthMonitor) {
      const healthStatus = await this.healthMonitor.getHealthStatus();
      const latency = healthStatus.socket.latency || healthStatus.email.latency || 0;
      return [healthStatus.healthy, latency];
    }
    // Fallback: service exists
    return [true, 0];
  }
}
