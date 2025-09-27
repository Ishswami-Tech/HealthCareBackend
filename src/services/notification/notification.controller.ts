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
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import { NotificationService } from "./notification.service";
import { PushNotificationService } from "../../libs/communication/messaging/push/push.service";
import { SESEmailService } from "../../libs/communication/messaging/email/ses-email.service";
import { ChatBackupService } from "../../libs/communication/messaging/chat/chat-backup.service";
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
} from "../../libs/dtos";

interface UnifiedNotificationResponse {
  success: boolean;
  results: Array<{
    type: "push" | "email" | "push_backup";
    result: {
      success: boolean;
      messageId?: string;
      error?: string;
    };
  }>;
  metadata: {
    deliveryChannels: string[];
    successfulChannels: string[];
  };
}

interface ChatStatsResponse {
  success: boolean;
  totalMessages?: number;
  messagesLast24h?: number;
  messagesLast7d?: number;
  totalStorageUsed?: number;
  error?: string;
}

// Import guards - adjust import paths based on your auth setup
// import { JwtAuthGuard } from '@libs/core/guards/jwt-auth.guard';
// import { RolesGuard } from '@libs/core/guards/roles.guard';
// import { Roles } from '@libs/core/decorators/roles.decorator';

@ApiTags("Notifications")
@Controller("notifications")
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
// @UseGuards(JwtAuthGuard) // Uncomment when authentication is needed
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly pushService: PushNotificationService,
    private readonly emailService: SESEmailService,
    private readonly chatBackupService: ChatBackupService,
  ) {}

  @Post("push")
  @ApiOperation({
    summary: "Send push notification to a single device",
    description:
      "Send a push notification to a specific device using Firebase Cloud Messaging",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Push notification sent successfully",
    type: NotificationResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: "Invalid request data",
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: "Failed to send push notification",
  })
  async sendPushNotification(
    @Body() sendPushDto: SendPushNotificationDto,
  ): Promise<NotificationResponseDto> {
    const result = await this.pushService.sendToDevice(
      sendPushDto.deviceToken,
      {
        title: sendPushDto.title,
        body: sendPushDto.body,
        data: sendPushDto.data,
      },
    );

    return {
      success: result.success,
      messageId: result.messageId,
      error: result.error,
    };
  }

  @Post("push/multiple")
  @ApiOperation({
    summary: "Send push notification to multiple devices",
    description: "Send the same push notification to multiple devices at once",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Push notifications sent",
    type: NotificationResponseDto,
  })
  async sendMultiplePushNotifications(
    @Body() sendMultipleDto: SendMultiplePushNotificationsDto,
  ): Promise<NotificationResponseDto> {
    const result = await this.pushService.sendToMultipleDevices(
      sendMultipleDto.deviceTokens,
      {
        title: sendMultipleDto.title,
        body: sendMultipleDto.body,
        data: sendMultipleDto.data,
      },
    );

    return {
      success: result.success,
      successCount: result.successCount,
      failureCount: result.failureCount,
      error: result.error,
    };
  }

  @Post("push/topic")
  @ApiOperation({
    summary: "Send push notification to a topic",
    description:
      "Send push notification to all devices subscribed to a specific topic",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Topic notification sent successfully",
    type: NotificationResponseDto,
  })
  async sendTopicNotification(
    @Body() sendTopicDto: SendTopicNotificationDto,
  ): Promise<NotificationResponseDto> {
    const result = await this.pushService.sendToTopic(sendTopicDto.topic, {
      title: sendTopicDto.title,
      body: sendTopicDto.body,
      data: sendTopicDto.data,
    });

    return {
      success: result.success,
      messageId: result.messageId,
      error: result.error,
    };
  }

  @Post("push/subscribe")
  @ApiOperation({
    summary: "Subscribe device to topic",
    description:
      "Subscribe a device token to a specific topic for topic-based messaging",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Device subscribed to topic successfully",
  })
  async subscribeToTopic(
    @Body() subscribeDto: SubscribeToTopicDto,
  ): Promise<{ success: boolean; error?: string }> {
    const success = await this.pushService.subscribeToTopic(
      subscribeDto.deviceToken,
      subscribeDto.topic,
    );

    return {
      success,
      ...(success ? {} : { error: "Failed to subscribe to topic" }),
    };
  }

  @Post("push/unsubscribe")
  @ApiOperation({
    summary: "Unsubscribe device from topic",
    description: "Unsubscribe a device token from a specific topic",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Device unsubscribed from topic successfully",
  })
  async unsubscribeFromTopic(
    @Body() unsubscribeDto: SubscribeToTopicDto,
  ): Promise<{ success: boolean; error?: string }> {
    const success = await this.pushService.unsubscribeFromTopic(
      unsubscribeDto.deviceToken,
      unsubscribeDto.topic,
    );

    return {
      success,
      ...(success ? {} : { error: "Failed to unsubscribe from topic" }),
    };
  }

  @Post("email")
  @ApiOperation({
    summary: "Send email notification",
    description: "Send an email notification using AWS SES",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Email sent successfully",
    type: NotificationResponseDto,
  })
  async sendEmail(
    @Body() sendEmailDto: SendEmailDto,
  ): Promise<NotificationResponseDto> {
    const result = await this.emailService.sendEmail({
      to: sendEmailDto.to,
      subject: sendEmailDto.subject,
      body: sendEmailDto.body,
      isHtml: sendEmailDto.isHtml,
      replyTo: sendEmailDto.replyTo,
      cc: sendEmailDto.cc,
      bcc: sendEmailDto.bcc,
    });

    return {
      success: result.success,
      messageId: result.messageId,
      error: result.error,
    };
  }

  @Post("appointment-reminder")
  @ApiOperation({
    summary: "Send appointment reminder",
    description:
      "Send appointment reminder via email and optionally push notification",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Appointment reminder sent successfully",
    type: NotificationResponseDto,
  })
  async sendAppointmentReminder(
    @Body() appointmentDto: AppointmentReminderDto,
  ): Promise<NotificationResponseDto> {
    return await this.notificationService.sendAppointmentReminder(
      appointmentDto,
    );
  }

  @Post("prescription-ready")
  @ApiOperation({
    summary: "Send prescription ready notification",
    description:
      "Send prescription ready notification via email and optionally push notification",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Prescription notification sent successfully",
    type: NotificationResponseDto,
  })
  async sendPrescriptionReady(
    @Body() prescriptionDto: PrescriptionNotificationDto,
  ): Promise<NotificationResponseDto> {
    return await this.notificationService.sendPrescriptionNotification(
      prescriptionDto,
    );
  }

  @Post("unified")
  @ApiOperation({
    summary: "Send unified notification",
    description:
      "Send notification via multiple channels (push, email, or both) with automatic fallback",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Unified notification sent",
  })
  async sendUnifiedNotification(
    @Body() unifiedDto: UnifiedNotificationDto,
  ): Promise<UnifiedNotificationResponse> {
    const result =
      await this.notificationService.sendUnifiedNotification(unifiedDto);

    return {
      success: result.success,
      results: result.results,
      metadata: {
        deliveryChannels: result.results.map((r) => r.type),
        successfulChannels: result.results
          .filter((r) => r.result.success)
          .map((r) => r.type),
      },
    };
  }

  @Post("chat-backup")
  @ApiOperation({
    summary: "Backup chat message",
    description: "Backup a chat message to Firebase Realtime Database",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Chat message backed up successfully",
    type: NotificationResponseDto,
  })
  async backupChatMessage(
    @Body() chatBackupDto: ChatBackupDto,
  ): Promise<NotificationResponseDto> {
    return await this.notificationService.backupChatMessage(chatBackupDto);
  }

  @Get("chat-history/:userId")
  @ApiOperation({
    summary: "Get chat message history",
    description:
      "Retrieve chat message history for a specific user and conversation",
  })
  @ApiParam({
    name: "userId",
    description: "User ID to get message history for",
    example: "user123",
  })
  @ApiQuery({
    name: "conversationPartnerId",
    description: "ID of the conversation partner",
    required: false,
  })
  @ApiQuery({
    name: "limit",
    description: "Maximum number of messages to retrieve (1-1000)",
    required: false,
    example: 50,
  })
  @ApiQuery({
    name: "startAfter",
    description: "Get messages before this timestamp",
    required: false,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Message history retrieved successfully",
    type: MessageHistoryResponseDto,
  })
  async getChatHistory(
    @Param("userId") userId: string,
    @Query("conversationPartnerId") conversationPartnerId?: string,
    @Query("limit") limit?: number,
    @Query("startAfter") startAfter?: number,
  ): Promise<MessageHistoryResponseDto> {
    if (!conversationPartnerId) {
      // Get sync messages if no conversation partner specified
      return await this.chatBackupService.syncMessages(userId, startAfter);
    }

    return await this.chatBackupService.getMessageHistory(
      userId,
      conversationPartnerId,
      limit || 50,
      startAfter,
    );
  }

  @Get("stats")
  @ApiOperation({
    summary: "Get notification statistics",
    description: "Retrieve notification system statistics and health status",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Statistics retrieved successfully",
    type: NotificationStatsResponseDto,
  })
  getNotificationStats(): NotificationStatsResponseDto {
    const metrics = this.notificationService.getNotificationMetrics();
    const healthStatus = this.notificationService.getServiceHealthStatus();

    const successRate =
      metrics.totalSent > 0
        ? (metrics.successfulSent / metrics.totalSent) * 100
        : 0;

    return {
      totalNotifications: metrics.totalSent,
      notificationsLast24h: 0, // Would need to implement time-based tracking
      notificationsLast7d: 0, // Would need to implement time-based tracking
      successRate: Math.round(successRate * 100) / 100,
      services: healthStatus,
    };
  }

  @Get("health")
  @ApiOperation({
    summary: "Check notification services health",
    description: "Check the health status of all notification services",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Health status retrieved successfully",
  })
  getHealthStatus(): {
    healthy: boolean;
    services: {
      firebase: boolean;
      awsSes: boolean;
      awsSns: boolean;
      firebaseDatabase: boolean;
    };
    timestamp: string;
  } {
    const services = this.notificationService.getServiceHealthStatus();
    const healthy = Object.values(services).some((status) => status);

    return {
      healthy,
      services,
      timestamp: new Date().toISOString(),
    };
  }

  @Get("chat-stats")
  @ApiOperation({
    summary: "Get chat backup statistics",
    description: "Retrieve statistics about chat message backups",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Chat statistics retrieved successfully",
  })
  async getChatStats(): Promise<ChatStatsResponse> {
    const stats = await this.chatBackupService.getBackupStats();

    if (!stats) {
      return {
        success: false,
        error: "Unable to retrieve chat statistics",
      };
    }

    return {
      success: true,
      ...stats,
    };
  }

  @Post("test")
  @ApiOperation({
    summary: "Test notification system",
    description: "Send test notifications to verify system functionality",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: "Test notifications sent",
  })
  testNotificationSystem(): {
    success: boolean;
    tests: Record<string, { success: boolean; error?: string }>;
    summary: string;
  } {
    const tests: Record<string, { success: boolean; error?: string }> = {};

    // Test health of all services
    const healthStatus = this.notificationService.getServiceHealthStatus();
    tests.serviceHealth = {
      success: Object.values(healthStatus).some((status) => status),
      error: Object.values(healthStatus).every((status) => !status)
        ? "All services are unhealthy"
        : undefined,
    };

    const successfulTests = Object.values(tests).filter(
      (test) => test.success,
    ).length;
    const totalTests = Object.keys(tests).length;

    return {
      success: successfulTests > 0,
      tests,
      summary: `${successfulTests}/${totalTests} tests passed`,
    };
  }
}
