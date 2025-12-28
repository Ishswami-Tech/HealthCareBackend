/**
 * Unified Communication Controller
 * ============================
 * Single entry point for all communication needs with category-based routing
 * Consolidates 15+ notification endpoints into unified API
 *
 * @module CommunicationController
 * @description Unified communication API following Strategy pattern and SOLID principles
 * @see https://docs.nestjs.com/controllers - NestJS Controller documentation
 */

import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpStatus,
  UsePipes,
  ValidationPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { CommunicationService } from './communication.service';
import { PushNotificationService } from './channels/push/push.service';
import { DeviceTokenService } from './channels/push/device-token.service';
import { ChatBackupService } from './channels/chat/chat-backup.service';
import { CommunicationAlertingService } from './services/communication-alerting.service';
import { CommunicationHealthMonitorService } from './communication-health-monitor.service';
import { DatabaseService } from '@infrastructure/database/database.service';
import { CommunicationCategory, CommunicationPriority, CommunicationChannel } from '@core/types';
import {
  SendPushNotificationDto,
  SendMultiplePushNotificationsDto,
  SendTopicNotificationDto,
  SendEmailDto,
  AppointmentReminderDto,
  PrescriptionNotificationDto,
  ChatBackupDto,
  UnifiedNotificationDto,
  SubscribeToTopicDto,
  RegisterDeviceTokenDto,
  NotificationResponseDto,
  MessageHistoryResponseDto,
  NotificationStatsResponseDto,
} from '@dtos/index';
import { NotificationType } from '@dtos/notification.dto';
import type {
  UnifiedNotificationResponse,
  ChatStatsResponse,
  NotificationHealthStatusResponse,
  NotificationTestSystemResponse,
  NotificationServiceHealthStatus,
} from '@core/types';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { Roles } from '@core/decorators/roles.decorator';
import { Cache } from '@core/decorators';
import { RoleEnum as Role } from '@core/types';

/**
 * Unified Communication Controller
 * Provides category-based routing for all communication needs
 */
@ApiTags('communication')
@Controller('communication')
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@UseGuards(JwtAuthGuard, RolesGuard, RbacGuard)
export class CommunicationController {
  constructor(
    private readonly communicationService: CommunicationService,
    private readonly pushService: PushNotificationService,
    private readonly deviceTokenService: DeviceTokenService,
    private readonly chatBackupService: ChatBackupService,
    private readonly alertingService: CommunicationAlertingService,
    private readonly healthMonitor: CommunicationHealthMonitorService,
    private readonly databaseService: DatabaseService
  ) {}

  /**
   * Unified Send Endpoint
   * Category-based routing for all communication types
   */
  @Post('send')
  @RequireResourcePermission('notifications', 'create')
  @ApiOperation({
    summary: 'Send unified communication',
    description:
      'Send communication via multiple channels with automatic category-based channel selection. Supports all communication types: push, email, SMS, WhatsApp, socket.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Communication sent successfully',
    type: NotificationResponseDto,
  })
  async sendUnified(
    @Body() unifiedDto: UnifiedNotificationDto
  ): Promise<UnifiedNotificationResponse> {
    const channels: CommunicationChannel[] = [];
    const notificationType = unifiedDto.type;
    if (notificationType === NotificationType.PUSH || notificationType === NotificationType.BOTH) {
      channels.push('push');
    }
    if (notificationType === NotificationType.EMAIL || notificationType === NotificationType.BOTH) {
      channels.push('email');
    }

    const recipients = [];
    if (unifiedDto.deviceToken) {
      recipients.push({ deviceToken: unifiedDto.deviceToken });
    }
    if (unifiedDto.email) {
      const emailRecipient = recipients.find(r => r.deviceToken === unifiedDto.deviceToken);
      if (emailRecipient) {
        Object.assign(emailRecipient, { email: unifiedDto.email });
      } else {
        recipients.push({ email: unifiedDto.email });
      }
    }

    const result = await this.communicationService.send({
      category: CommunicationCategory.USER_ACTIVITY,
      title: unifiedDto.title,
      body: unifiedDto.body,
      recipients,
      ...(channels.length > 0 && { channels }),
      priority: CommunicationPriority.NORMAL,
      ...(unifiedDto.data && { data: unifiedDto.data }),
    });

    return {
      success: result.success,
      results: result.results
        .filter(r => r.channel === 'push' || r.channel === 'email' || r.channel === 'socket')
        .map(r => {
          const channelType = r.channel as 'push' | 'email' | 'push_backup';
          return {
            type: channelType,
            result: {
              success: r.success,
              ...(r.messageId && { messageId: r.messageId }),
              ...(r.error && { error: r.error }),
            },
          } as const;
        }),
      metadata: {
        deliveryChannels: result.results.map(r => r.channel),
        successfulChannels: result.results.filter(r => r.success).map(r => r.channel),
      },
    };
  }

  /**
   * Category-based routing: APPOINTMENT
   */
  @Post('appointment/reminder')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.DOCTOR, Role.RECEPTIONIST)
  @RequireResourcePermission('notifications', 'create')
  @ApiOperation({
    summary: 'Send appointment reminder',
    description: 'Send appointment reminder via email and optionally push notification',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Appointment reminder sent successfully',
    type: NotificationResponseDto,
  })
  async sendAppointmentReminder(
    @Body() appointmentDto: AppointmentReminderDto
  ): Promise<NotificationResponseDto> {
    const channels: CommunicationChannel[] = appointmentDto.deviceToken
      ? ['push', 'email', 'whatsapp', 'socket']
      : ['email', 'whatsapp'];

    const result = await this.communicationService.send({
      category: CommunicationCategory.APPOINTMENT,
      title: 'Appointment Reminder',
      body: `Your appointment with ${appointmentDto.doctorName} is scheduled for ${appointmentDto.date} at ${appointmentDto.time}`,
      recipients: [
        {
          ...(appointmentDto.deviceToken && { deviceToken: appointmentDto.deviceToken }),
          email: appointmentDto.to,
        },
      ],
      channels,
      priority: CommunicationPriority.HIGH,
      data: {
        type: 'appointment_reminder',
        ...(appointmentDto.appointmentId && { appointmentId: appointmentDto.appointmentId }),
        doctorName: appointmentDto.doctorName,
        date: appointmentDto.date,
        time: appointmentDto.time,
        location: appointmentDto.location,
      },
    });

    return {
      success: result.success,
      ...(result.results[0]?.messageId && { messageId: result.results[0].messageId }),
    };
  }

  /**
   * Category-based routing: PRESCRIPTION
   */
  @Post('prescription/ready')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.DOCTOR, Role.PHARMACIST)
  @RequireResourcePermission('notifications', 'create')
  @ApiOperation({
    summary: 'Send prescription ready notification',
    description: 'Send prescription ready notification via email and optionally push notification',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Prescription notification sent successfully',
    type: NotificationResponseDto,
  })
  async sendPrescriptionReady(
    @Body() prescriptionDto: PrescriptionNotificationDto
  ): Promise<NotificationResponseDto> {
    const channels: CommunicationChannel[] = prescriptionDto.deviceToken
      ? ['push', 'email', 'whatsapp', 'socket']
      : ['email', 'whatsapp'];

    const result = await this.communicationService.send({
      category: CommunicationCategory.PRESCRIPTION,
      title: 'Prescription Ready',
      body: `Your prescription from ${prescriptionDto.doctorName} is ready for pickup`,
      recipients: [
        {
          ...(prescriptionDto.deviceToken && { deviceToken: prescriptionDto.deviceToken }),
          email: prescriptionDto.to,
        },
      ],
      channels,
      priority: CommunicationPriority.HIGH,
      data: {
        type: 'prescription_ready',
        ...(prescriptionDto.prescriptionId && { prescriptionId: prescriptionDto.prescriptionId }),
        doctorName: prescriptionDto.doctorName,
      },
    });

    return {
      success: result.success,
      ...(result.results[0]?.messageId && { messageId: result.results[0].messageId }),
    };
  }

  /**
   * Category-based routing: USER_ACTIVITY - Push
   */
  @Post('push')
  @RequireResourcePermission('notifications', 'create')
  @ApiOperation({
    summary: 'Send push notification to a single device',
    description:
      'Send a push notification to a specific device using Firebase Cloud Messaging. Uses CommunicationService for unified delivery.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Push notification sent successfully',
    type: NotificationResponseDto,
  })
  async sendPushNotification(
    @Body() sendPushDto: SendPushNotificationDto
  ): Promise<NotificationResponseDto> {
    const result = await this.communicationService.send({
      category: CommunicationCategory.USER_ACTIVITY,
      title: sendPushDto.title,
      body: sendPushDto.body,
      recipients: [
        {
          deviceToken: sendPushDto.deviceToken,
        },
      ],
      channels: ['push'],
      priority: CommunicationPriority.NORMAL,
      ...(sendPushDto.data && { data: sendPushDto.data }),
    });

    const pushResult = result.results.find(r => r.channel === 'push');
    return {
      success: pushResult?.success ?? false,
      ...(pushResult?.messageId && { messageId: pushResult.messageId }),
      ...(pushResult?.error && { error: pushResult.error }),
    };
  }

  /**
   * Category-based routing: USER_ACTIVITY - Push Multiple
   */
  @Post('push/multiple')
  @RequireResourcePermission('notifications', 'create')
  @ApiOperation({
    summary: 'Send push notification to multiple devices',
    description:
      'Send the same push notification to multiple devices at once using CommunicationService',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Push notifications sent',
    type: NotificationResponseDto,
  })
  async sendMultiplePushNotifications(
    @Body() sendMultipleDto: SendMultiplePushNotificationsDto
  ): Promise<NotificationResponseDto> {
    const recipients = sendMultipleDto.deviceTokens.map(token => ({
      deviceToken: token,
    }));

    const result = await this.communicationService.send({
      category: CommunicationCategory.USER_ACTIVITY,
      title: sendMultipleDto.title,
      body: sendMultipleDto.body,
      recipients,
      channels: ['push'],
      priority: CommunicationPriority.NORMAL,
      ...(sendMultipleDto.data && { data: sendMultipleDto.data }),
    });

    const pushResults = result.results.filter(r => r.channel === 'push');
    const successCount = pushResults.filter(r => r.success).length;
    const failureCount = pushResults.filter(r => !r.success).length;

    return {
      success: result.success,
      ...(successCount > 0 && { successCount }),
      ...(failureCount > 0 && { failureCount }),
      ...(result.success ? {} : { error: 'Some notifications failed' }),
    };
  }

  /**
   * Category-based routing: USER_ACTIVITY - Topic Push
   */
  @Post('push/topic')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('notifications', 'create')
  @ApiOperation({
    summary: 'Send push notification to a topic',
    description:
      'Send push notification to all devices subscribed to a specific topic. Uses PushNotificationService directly for topic-based delivery.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Topic notification sent successfully',
    type: NotificationResponseDto,
  })
  async sendTopicNotification(
    @Body() sendTopicDto: SendTopicNotificationDto
  ): Promise<NotificationResponseDto> {
    const result = await this.pushService.sendToTopic(sendTopicDto.topic, {
      title: sendTopicDto.title,
      body: sendTopicDto.body,
      ...(sendTopicDto.data && { data: sendTopicDto.data }),
    });

    return {
      success: result.success,
      ...(result.messageId && { messageId: result.messageId }),
      ...(result.error && { error: result.error }),
    };
  }

  /**
   * Category-based routing: USER_ACTIVITY - Email
   */
  @Post('email')
  @RequireResourcePermission('notifications', 'create')
  @ApiOperation({
    summary: 'Send email notification',
    description:
      'Send an email notification using CommunicationService (ZeptoMail primary, with fallback)',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Email sent successfully',
    type: NotificationResponseDto,
  })
  async sendEmail(@Body() sendEmailDto: SendEmailDto): Promise<NotificationResponseDto> {
    const result = await this.communicationService.send({
      category: CommunicationCategory.USER_ACTIVITY,
      title: sendEmailDto.subject,
      body: sendEmailDto.body,
      recipients: [
        {
          email: sendEmailDto.to,
        },
      ],
      channels: ['email'],
      priority: CommunicationPriority.NORMAL,
      data: {
        ...(sendEmailDto.replyTo && { replyTo: sendEmailDto.replyTo }),
        ...(sendEmailDto.cc && { cc: sendEmailDto.cc }),
        ...(sendEmailDto.bcc && { bcc: sendEmailDto.bcc }),
        isHtml: sendEmailDto.isHtml !== false,
      },
    });

    const emailResult = result.results.find(r => r.channel === 'email');
    return {
      success: emailResult?.success ?? false,
      ...(emailResult?.messageId && { messageId: emailResult.messageId }),
      ...(emailResult?.error && { error: emailResult.error }),
    };
  }

  /**
   * Category-based routing: CHAT
   */
  @Post('chat/backup')
  @RequireResourcePermission('notifications', 'create')
  @ApiOperation({
    summary: 'Backup chat message',
    description: 'Backup a chat message to Firebase Realtime Database',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Chat message backed up successfully',
    type: NotificationResponseDto,
  })
  async backupChatMessage(@Body() chatBackupDto: ChatBackupDto): Promise<NotificationResponseDto> {
    const result = await this.chatBackupService.backupMessage({
      id: chatBackupDto.id || `msg_${Date.now()}`,
      senderId: chatBackupDto.senderId,
      receiverId: chatBackupDto.receiverId,
      content: chatBackupDto.content,
      timestamp: Date.now(),
      type: chatBackupDto.type || 'text',
      ...(chatBackupDto.metadata && { metadata: chatBackupDto.metadata }),
    });

    return {
      success: result.success,
      ...(result.messageId && { messageId: result.messageId }),
      ...(result.error && { error: result.error }),
    };
  }

  /**
   * Topic Management
   */
  @Post('push/subscribe')
  @RequireResourcePermission('notifications', 'create')
  @ApiOperation({
    summary: 'Subscribe device to topic',
    description: 'Subscribe a device token to a specific topic for topic-based messaging',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Device subscribed to topic successfully',
  })
  async subscribeToTopic(
    @Body() subscribeDto: SubscribeToTopicDto
  ): Promise<{ success: boolean; error?: string }> {
    const success = await this.pushService.subscribeToTopic(
      subscribeDto.deviceToken,
      subscribeDto.topic
    );

    return {
      success,
      ...(success ? {} : { error: 'Failed to subscribe to topic' }),
    };
  }

  @Post('push/unsubscribe')
  @RequireResourcePermission('notifications', 'create')
  @ApiOperation({
    summary: 'Unsubscribe device from topic',
    description: 'Unsubscribe a device token from a specific topic',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Device unsubscribed from topic successfully',
  })
  async unsubscribeFromTopic(
    @Body() unsubscribeDto: SubscribeToTopicDto
  ): Promise<{ success: boolean; error?: string }> {
    const success = await this.pushService.unsubscribeFromTopic(
      unsubscribeDto.deviceToken,
      unsubscribeDto.topic
    );

    return {
      success,
      ...(success ? {} : { error: 'Failed to unsubscribe from topic' }),
    };
  }

  @Post('push/device-token')
  @RequireResourcePermission('notifications', 'create')
  @ApiOperation({
    summary: 'Register device token for push notifications',
    description:
      'Register a device token (FCM token) for push notifications. Supports iOS, Android, and Web platforms.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Device token registered successfully',
    type: NotificationResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid device token or platform',
  })
  async registerDeviceToken(
    @Body() registerDto: RegisterDeviceTokenDto
  ): Promise<{ success: boolean; error?: string }> {
    // Get userId from request context if not provided
    // TODO: Extract from JWT token or request context
    const userId = registerDto.userId || 'anonymous';

    const success = await this.deviceTokenService.registerDeviceToken({
      userId,
      token: registerDto.token,
      platform: registerDto.platform,
      ...(registerDto.appVersion && { appVersion: registerDto.appVersion }),
      ...(registerDto.deviceModel && { deviceModel: registerDto.deviceModel }),
      ...(registerDto.osVersion && { osVersion: registerDto.osVersion }),
      isActive: true,
    });

    return {
      success,
      ...(success ? {} : { error: 'Failed to register device token' }),
    };
  }

  /**
   * Chat History
   */
  @Get('chat/history/:userId')
  @RequireResourcePermission('notifications', 'read', { requireOwnership: true })
  @Cache({
    keyTemplate: 'communication:chat:history:{userId}:{conversationPartnerId}:{limit}:{startAfter}',
    ttl: 300,
    // 5 minutes (chat history changes frequently)
    tags: ['communication', 'chat', 'user:{userId}'],
    enableSWR: true,
  })
  @ApiOperation({
    summary: 'Get chat message history',
    description:
      'Retrieve chat message history for a specific user and conversation. Cached for performance.',
  })
  @ApiParam({
    name: 'userId',
    description: 'User ID to get message history for',
    example: 'user123',
  })
  @ApiQuery({
    name: 'conversationPartnerId',
    description: 'ID of the conversation partner',
    required: false,
  })
  @ApiQuery({
    name: 'limit',
    description: 'Maximum number of messages to retrieve (1-1000)',
    required: false,
    example: 50,
  })
  @ApiQuery({
    name: 'startAfter',
    description: 'Get messages before this timestamp',
    required: false,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Message history retrieved successfully',
    type: MessageHistoryResponseDto,
  })
  async getChatHistory(
    @Param('userId') userId: string,
    @Query('conversationPartnerId') conversationPartnerId?: string,
    @Query('limit') limit?: number,
    @Query('startAfter') startAfter?: number
  ): Promise<MessageHistoryResponseDto> {
    if (!conversationPartnerId) {
      return await this.chatBackupService.syncMessages(userId, startAfter);
    }

    return await this.chatBackupService.getMessageHistory(
      userId,
      conversationPartnerId,
      limit || 50,
      startAfter
    );
  }

  /**
   * Statistics and Health
   */
  @Get('stats')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('notifications', 'read')
  @Cache({
    keyTemplate: 'communication:stats',
    ttl: 300,
    // 5 minutes (stats change frequently)
    tags: ['communication', 'stats'],
    enableSWR: true,
  })
  @ApiOperation({
    summary: 'Get communication statistics',
    description:
      'Retrieve communication system statistics and health status. Cached for performance.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Statistics retrieved successfully',
    type: NotificationStatsResponseDto,
  })
  getStats(): NotificationStatsResponseDto {
    const metrics = this.communicationService.getMetrics();
    const totalSent = metrics.totalRequests;
    const successfulSent = metrics.successfulRequests;

    const successRate = totalSent > 0 ? (successfulSent / totalSent) * 100 : 0;

    return {
      totalNotifications: totalSent,
      notificationsLast24h: 0,
      notificationsLast7d: 0,
      successRate: Math.round(successRate * 100) / 100,
      services: {
        firebase: metrics.channelMetrics.push.successful > 0,
        zeptomail: metrics.channelMetrics.email.successful > 0,
        awsSes: metrics.channelMetrics.email.successful > 0, // Legacy/fallback
        awsSns: metrics.channelMetrics.push.successful > 0,
        firebaseDatabase: metrics.channelMetrics.socket.successful > 0,
      },
    };
  }

  /**
   * Enhanced Analytics Endpoint
   */
  @Get('analytics')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('notifications', 'read')
  @Cache({
    keyTemplate: 'communication:analytics:{clinicId}:{period}',
    ttl: 300, // 5 minutes
    tags: ['communication', 'analytics'],
    enableSWR: true,
  })
  @ApiOperation({
    summary: 'Get enhanced communication analytics',
    description:
      'Retrieve detailed communication analytics including bounce rates, complaint rates, and per-provider metrics. Cached for performance.',
  })
  @ApiQuery({
    name: 'clinicId',
    required: false,
    description: 'Filter by clinic ID',
  })
  @ApiQuery({
    name: 'provider',
    required: false,
    description: 'Filter by provider',
  })
  @ApiQuery({
    name: 'period',
    required: false,
    description: 'Time period (1h, 24h, 7d, 30d)',
    enum: ['1h', '24h', '7d', '30d'],
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Analytics retrieved successfully',
  })
  async getAnalytics(
    @Query('clinicId') clinicId?: string,
    @Query('provider') provider?: string,
    @Query('period') period: '1h' | '24h' | '7d' | '30d' = '24h'
  ): Promise<{
    metrics: {
      email: {
        sent: number;
        delivered: number;
        bounced: number;
        complained: number;
        bounceRate: number;
        complaintRate: number;
        deliveryRate: number;
        providers: Record<string, { sent: number; delivered: number; failed: number }>;
      };
      whatsapp: {
        sent: number;
        delivered: number;
        failed: number;
        deliveryRate: number;
        providers: Record<string, { sent: number; delivered: number; failed: number }>;
      };
      push: {
        sent: number;
        delivered: number;
        failed: number;
        deliveryRate: number;
      };
      socket: {
        sent: number;
        delivered: number;
        failed: number;
        deliveryRate: number;
      };
      sms: {
        sent: number;
        delivered: number;
        failed: number;
        deliveryRate: number;
      };
    };
    period: string;
    timestamp: string;
  }> {
    // Calculate time window
    const periodMs: Record<string, number> = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    };
    const periodDuration = periodMs[period];
    if (!periodDuration) {
      throw new Error(`Invalid period: ${period}`);
    }
    const since = new Date(Date.now() - periodDuration);

    // Get detailed metrics from database
    const deliveryLogs = await this.databaseService.executeHealthcareRead(async client => {
      const notificationClient = client as unknown as {
        notificationDeliveryLog: {
          findMany: (args: {
            where: {
              createdAt: { gte: Date };
              clinicId?: string;
            };
            select: {
              channel: true;
              status: true;
              providerResponse: true;
            };
          }) => Promise<
            Array<{
              channel: string;
              status: string;
              providerResponse: unknown;
            }>
          >;
        };
      };
      return await notificationClient.notificationDeliveryLog.findMany({
        where: {
          createdAt: { gte: since },
          ...(clinicId && { clinicId }),
        },
        select: {
          channel: true,
          status: true,
          providerResponse: true,
        },
      });
    });

    // Calculate metrics per channel
    const calculateChannelMetrics = (channel: string) => {
      const channelLogs = deliveryLogs.filter(
        (log: { channel: string }) => log.channel === channel
      );
      const sent = channelLogs.length;
      const delivered = channelLogs.filter(
        (log: { status: string }) => log.status === 'DELIVERED'
      ).length;
      const failed = channelLogs.filter(
        (log: { status: string }) => log.status === 'FAILED' || log.status === 'BOUNCED'
      ).length;
      const bounced = channelLogs.filter(
        (log: { status: string }) => log.status === 'BOUNCED'
      ).length;
      const complained = channelLogs.filter(
        (log: { status: string }) => log.status === 'COMPLAINED'
      ).length;

      return {
        sent,
        delivered,
        failed,
        bounced,
        complained,
        deliveryRate: sent > 0 ? (delivered / sent) * 100 : 0,
        bounceRate: sent > 0 ? (bounced / sent) * 100 : 0,
        complaintRate: sent > 0 ? (complained / sent) * 100 : 0,
      };
    };

    // Calculate provider-specific metrics
    const calculateProviderMetrics = (channel: string) => {
      const channelLogs = deliveryLogs.filter(
        (log: { channel: string }) => log.channel === channel
      );
      const providers: Record<string, { sent: number; delivered: number; failed: number }> = {};

      for (const log of channelLogs) {
        const providerName = (log.providerResponse as { provider?: string })?.provider || 'unknown';
        if (!providers[providerName]) {
          providers[providerName] = { sent: 0, delivered: 0, failed: 0 };
        }
        providers[providerName].sent++;
        if (log.status === 'DELIVERED') {
          providers[providerName].delivered++;
        } else if (log.status === 'FAILED' || log.status === 'BOUNCED') {
          providers[providerName].failed++;
        }
      }

      return providers;
    };

    const emailMetrics = calculateChannelMetrics('email');
    const whatsappMetrics = calculateChannelMetrics('whatsapp');
    const pushMetrics = calculateChannelMetrics('push');
    const socketMetrics = calculateChannelMetrics('socket');
    const smsMetrics = calculateChannelMetrics('sms');

    return {
      metrics: {
        email: {
          ...emailMetrics,
          providers: calculateProviderMetrics('email'),
        },
        whatsapp: {
          sent: whatsappMetrics.sent,
          delivered: whatsappMetrics.delivered,
          failed: whatsappMetrics.failed,
          deliveryRate: whatsappMetrics.deliveryRate,
          providers: calculateProviderMetrics('whatsapp'),
        },
        push: {
          sent: pushMetrics.sent,
          delivered: pushMetrics.delivered,
          failed: pushMetrics.failed,
          deliveryRate: pushMetrics.deliveryRate,
        },
        socket: {
          sent: socketMetrics.sent,
          delivered: socketMetrics.delivered,
          failed: socketMetrics.failed,
          deliveryRate: socketMetrics.deliveryRate,
        },
        sms: {
          sent: smsMetrics.sent,
          delivered: smsMetrics.delivered,
          failed: smsMetrics.failed,
          deliveryRate: smsMetrics.deliveryRate,
        },
      },
      period,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('health')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @Cache({
    keyTemplate: 'communication:health',
    ttl: 60, // 1 minute (health checks should be recent)
    tags: ['communication', 'health'],
    enableSWR: true,
  })
  @ApiOperation({
    summary: 'Check communication services health',
    description: 'Check the health status of all communication services. Cached for performance.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Health status retrieved successfully',
  })
  async getHealthStatus(): Promise<NotificationHealthStatusResponse> {
    const metrics = this.communicationService.getMetrics();
    const healthStatus = await this.healthMonitor.getHealthStatus();
    const services: NotificationServiceHealthStatus = {
      firebase: healthStatus.push?.connected || metrics.channelMetrics.push.successful > 0,
      zeptomail: healthStatus.email?.connected || metrics.channelMetrics.email.successful > 0,
      awsSes: metrics.channelMetrics.email.successful > 0, // Legacy/fallback
      awsSns: metrics.channelMetrics.push.successful > 0,
      firebaseDatabase:
        healthStatus.socket?.connected || metrics.channelMetrics.socket.successful > 0,
    };
    const healthy = healthStatus.healthy && Object.values(services).some(status => status);

    return {
      healthy,
      services,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('dashboard')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('notifications', 'read')
  @Cache({
    keyTemplate: 'communication:dashboard:{clinicId}',
    ttl: 60, // 1 minute
    tags: ['communication', 'dashboard'],
    enableSWR: true,
  })
  @ApiOperation({
    summary: 'Get communication health dashboard',
    description:
      'Get comprehensive dashboard with health status, metrics, alerts, and recent activity. Cached for performance.',
  })
  @ApiQuery({
    name: 'clinicId',
    required: false,
    description: 'Filter by clinic ID',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Dashboard data retrieved successfully',
  })
  async getDashboard(@Query('clinicId') clinicId?: string): Promise<{
    health: NotificationHealthStatusResponse;
    metrics: ReturnType<CommunicationService['getMetrics']>;
    alerts: Awaited<ReturnType<CommunicationAlertingService['getActiveAlerts']>>;
    recentActivity: {
      totalRequests: number;
      successfulRequests: number;
      failedRequests: number;
      successRate: number;
    };
    timestamp: string;
  }> {
    const health = await this.getHealthStatus();
    const metrics = this.communicationService.getMetrics();
    const alerts = await this.alertingService.getActiveAlerts();

    // Get recent activity (last 1 hour)
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const recentLogs = await this.databaseService.executeHealthcareRead(async client => {
      const notificationClient = client as unknown as {
        notificationDeliveryLog: {
          findMany: (args: {
            where: {
              createdAt: { gte: Date };
              clinicId?: string;
            };
            select: {
              status: true;
            };
          }) => Promise<Array<{ status: string }>>;
        };
      };
      return await notificationClient.notificationDeliveryLog.findMany({
        where: {
          createdAt: { gte: since },
          ...(clinicId && { clinicId }),
        },
        select: {
          status: true,
        },
      });
    });

    const totalRequests = recentLogs.length;
    const successfulRequests = recentLogs.filter(
      (log: { status: string }) => log.status === 'DELIVERED'
    ).length;
    const failedRequests = recentLogs.filter(
      (log: { status: string }) => log.status === 'FAILED' || log.status === 'BOUNCED'
    ).length;
    const successRate = totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 100;

    return {
      health,
      metrics,
      alerts,
      recentActivity: {
        totalRequests,
        successfulRequests,
        failedRequests,
        successRate,
      },
      timestamp: new Date().toISOString(),
    };
  }

  @Get('alerts')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('notifications', 'read')
  @Cache({
    keyTemplate: 'communication:alerts',
    ttl: 30, // 30 seconds (alerts change frequently)
    tags: ['communication', 'alerts'],
    enableSWR: true,
  })
  @ApiOperation({
    summary: 'Get active communication alerts',
    description:
      'Get all active alerts for delivery failures and system issues. Cached for 30 seconds.',
  })
  @ApiQuery({
    name: 'channel',
    required: false,
    description: 'Filter by channel',
    enum: ['email', 'whatsapp', 'push', 'socket', 'sms'],
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Alerts retrieved successfully',
  })
  async getAlerts(
    @Query('channel') channel?: 'email' | 'whatsapp' | 'push' | 'socket' | 'sms'
  ): Promise<{
    alerts: Awaited<ReturnType<CommunicationAlertingService['getActiveAlerts']>>;
    alertConfig: ReturnType<CommunicationAlertingService['getAlertConfig']>;
    timestamp: string;
  }> {
    const allAlerts = await this.alertingService.getActiveAlerts();
    const alerts = channel ? allAlerts.filter(alert => alert.channel === channel) : allAlerts;
    const alertConfig = this.alertingService.getAlertConfig();

    return {
      alerts,
      alertConfig,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('chat/stats')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @RequireResourcePermission('notifications', 'read')
  @Cache({
    keyTemplate: 'communication:chat:stats',
    ttl: 300, // 5 minutes (stats change frequently)
    tags: ['communication', 'chat', 'stats'],
    enableSWR: true,
  })
  @ApiOperation({
    summary: 'Get chat backup statistics',
    description: 'Retrieve statistics about chat message backups. Cached for performance.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Chat statistics retrieved successfully',
  })
  async getChatStats(): Promise<ChatStatsResponse> {
    const stats = await this.chatBackupService.getBackupStats();

    if (!stats) {
      return {
        success: false,
        error: 'Unable to retrieve chat statistics',
      };
    }

    return {
      success: true,
      ...stats,
    };
  }

  @Post('test')
  @Roles(Role.SUPER_ADMIN)
  @RequireResourcePermission('notifications', 'create')
  @ApiOperation({
    summary: 'Test communication system',
    description: 'Send test communications to verify system functionality',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Test communications sent',
  })
  testSystem(): NotificationTestSystemResponse {
    const tests: Record<string, { success: boolean; error?: string }> = {};

    const metrics = this.communicationService.getMetrics();
    const services = {
      push: metrics.channelMetrics.push.successful > 0 || metrics.channelMetrics.push.sent > 0,
      email: metrics.channelMetrics.email.successful > 0 || metrics.channelMetrics.email.sent > 0,
      socket:
        metrics.channelMetrics.socket.successful > 0 || metrics.channelMetrics.socket.sent > 0,
      whatsapp:
        metrics.channelMetrics.whatsapp.successful > 0 || metrics.channelMetrics.whatsapp.sent > 0,
    };

    tests['serviceHealth'] = {
      success: Object.values(services).some(status => status),
      ...(Object.values(services).every(status => !status) && {
        error: 'All services are unhealthy',
      }),
    };

    const successfulTests = Object.values(tests).filter(test => test.success).length;
    const totalTests = Object.keys(tests).length;

    return {
      success: successfulTests > 0,
      tests,
      summary: `${successfulTests}/${totalTests} tests passed`,
    };
  }
}
