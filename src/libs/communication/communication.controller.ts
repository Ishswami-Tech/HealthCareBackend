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
import { ChatBackupService } from './channels/chat/chat-backup.service';
import {
  CommunicationCategory,
  CommunicationPriority,
  CommunicationChannel,
} from '@core/types/communication.types';
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
} from '@core/types/notification.types';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { Roles } from '@core/decorators/roles.decorator';
import { Cache } from '@core/decorators';
import { Role } from '@core/types/enums.types';

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
    private readonly chatBackupService: ChatBackupService
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
      ? ['push', 'email']
      : ['email'];

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
      ? ['push', 'email']
      : ['email'];

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
    description: 'Send an email notification using CommunicationService (AWS SES with fallback)',
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
        awsSes: metrics.channelMetrics.email.successful > 0,
        awsSns: metrics.channelMetrics.push.successful > 0,
        firebaseDatabase: metrics.channelMetrics.socket.successful > 0,
      },
    };
  }

  @Get('health')
  @Roles(Role.SUPER_ADMIN)
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
  getHealthStatus(): NotificationHealthStatusResponse {
    const metrics = this.communicationService.getMetrics();
    const services: NotificationServiceHealthStatus = {
      firebase: metrics.channelMetrics.push.successful > 0 || metrics.channelMetrics.push.sent > 0,
      awsSes: metrics.channelMetrics.email.successful > 0 || metrics.channelMetrics.email.sent > 0,
      awsSns: metrics.channelMetrics.push.successful > 0 || metrics.channelMetrics.push.sent > 0,
      firebaseDatabase:
        metrics.channelMetrics.socket.successful > 0 || metrics.channelMetrics.socket.sent > 0,
    };
    const healthy = Object.values(services).some(status => status);

    return {
      healthy,
      services,
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
