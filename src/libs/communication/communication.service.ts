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

// Infrastructure services
import { EventService } from '@infrastructure/events';
import { LoggingService } from '@infrastructure/logging';
import { CacheService } from '@infrastructure/cache';
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
} from '@core/types/communication.types';
import type { EnterpriseEventPayload } from '@core/types/event.types';

/**
 * Communication Service
 * Provides unified interface for all communication channels
 */
@Injectable()
export class CommunicationService implements OnModuleInit {
  // Category to channel mapping
  private readonly categoryConfig: Map<CommunicationCategory, CategoryChannelConfig> = new Map([
    [
      CommunicationCategory.LOGIN,
      {
        defaultChannels: ['socket'],
        strategy: DeliveryStrategy.IMMEDIATE,
        priority: CommunicationPriority.LOW,
        rateLimit: { limit: 10, windowSeconds: 60 }, // Prevent spam
      },
    ],
    [
      CommunicationCategory.EHR_RECORD,
      {
        defaultChannels: ['socket', 'push', 'email'],
        requiredChannels: ['socket'],
        strategy: DeliveryStrategy.IMMEDIATE,
        priority: CommunicationPriority.HIGH,
      },
    ],
    [
      CommunicationCategory.APPOINTMENT,
      {
        defaultChannels: ['socket', 'push', 'email'],
        strategy: DeliveryStrategy.IMMEDIATE,
        priority: CommunicationPriority.HIGH,
      },
    ],
    [
      CommunicationCategory.REMINDER,
      {
        defaultChannels: ['push', 'email'],
        strategy: DeliveryStrategy.SCHEDULED,
        priority: CommunicationPriority.NORMAL,
      },
    ],
    [
      CommunicationCategory.BILLING,
      {
        defaultChannels: ['push', 'email'],
        strategy: DeliveryStrategy.QUEUED,
        priority: CommunicationPriority.NORMAL,
      },
    ],
    [
      CommunicationCategory.CRITICAL,
      {
        defaultChannels: ['socket', 'push', 'email', 'sms', 'whatsapp'],
        requiredChannels: ['socket', 'push'],
        fallbackChannels: ['sms', 'whatsapp'],
        strategy: DeliveryStrategy.IMMEDIATE,
        priority: CommunicationPriority.CRITICAL,
      },
    ],
    [
      CommunicationCategory.SYSTEM,
      {
        defaultChannels: ['socket', 'email'],
        strategy: DeliveryStrategy.QUEUED,
        priority: CommunicationPriority.NORMAL,
      },
    ],
    [
      CommunicationCategory.USER_ACTIVITY,
      {
        defaultChannels: ['socket'],
        strategy: DeliveryStrategy.IMMEDIATE,
        priority: CommunicationPriority.LOW,
      },
    ],
    [
      CommunicationCategory.PRESCRIPTION,
      {
        defaultChannels: ['push', 'email'],
        strategy: DeliveryStrategy.IMMEDIATE,
        priority: CommunicationPriority.HIGH,
      },
    ],
    [
      CommunicationCategory.CHAT,
      {
        defaultChannels: ['socket'],
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
    private readonly cacheService: CacheService
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

      // Get user preferences if enabled
      const preferences =
        request.respectPreferences !== false
          ? await this.getUserPreferences(request.recipients)
          : undefined;

      // Filter channels based on preferences
      const finalChannels = this.filterChannelsByPreferences(
        channels,
        preferences,
        request.recipients
      );

      // Send through each channel
      const results: ChannelDeliveryResult[] = [];
      const sendPromises: Promise<ChannelDeliveryResult>[] = [];

      for (const channel of finalChannels) {
        for (const recipient of request.recipients) {
          const sendPromise = this.sendToChannel(channel, request, recipient);
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
   * Filter channels based on user preferences
   */
  private filterChannelsByPreferences(
    channels: CommunicationChannel[],
    preferences: Map<string, UserCommunicationPreferences> | undefined,
    recipients: CommunicationRequest['recipients']
  ): CommunicationChannel[] {
    if (!preferences || preferences.size === 0) {
      return channels;
    }

    const filteredChannels = new Set<CommunicationChannel>();

    for (const channel of channels) {
      let shouldInclude = true;

      for (const recipient of recipients) {
        if (recipient.userId) {
          const userPrefs = preferences.get(recipient.userId);
          if (userPrefs) {
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
   * Get user communication preferences
   */
  private async getUserPreferences(
    recipients: CommunicationRequest['recipients']
  ): Promise<Map<string, UserCommunicationPreferences> | undefined> {
    const preferences = new Map<string, UserCommunicationPreferences>();

    for (const recipient of recipients) {
      if (recipient.userId) {
        try {
          const cacheKey = `user:${recipient.userId}:communication:preferences`;
          const cached = await this.cacheService.get<UserCommunicationPreferences>(cacheKey);
          if (cached) {
            preferences.set(recipient.userId, cached);
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

      // Use EmailService as the unified email provider interface
      // EmailService handles provider selection (SMTP, Mailtrap, SES, etc.) internally
      const emailResult = await this.emailService.sendSimpleEmail({
        to: recipient.email,
        subject: request.title,
        body: request.body,
        isHtml: true,
      });

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

      // Use WhatsApp service to send message
      // For now, we'll use a simple text message
      // In production, you might want to use templates
      const message = `${request.title}\n\n${request.body}`;
      const success = await this.whatsAppService.sendCustomMessage(recipient.phoneNumber, message);

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
   * Send SMS (placeholder - implement when SMS service is available)
   */
  private async sendSMS(
    _request: CommunicationRequest,
    _recipient: CommunicationRequest['recipients'][0],
    timestamp: Date
  ): Promise<ChannelDeliveryResult> {
    // TODO: Implement SMS service when available
    return Promise.resolve({
      channel: 'sms',
      success: false,
      error: 'SMS service not yet implemented',
      timestamp,
    });
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
}
