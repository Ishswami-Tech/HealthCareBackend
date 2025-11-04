import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggingModule } from '@infrastructure/logging';
import { DatabaseModule } from '@infrastructure/database';
import { PushNotificationService } from '@communication/messaging/push/push.service';
import { DeviceTokenService } from '@communication/messaging/push/device-token.service';
import { SNSBackupService } from '@communication/messaging/push/sns-backup.service';

/**
 * Push Notification Module
 *
 * Provides push notification services with:
 * - Firebase Cloud Messaging (FCM) as primary provider
 * - AWS SNS as backup provider
 * - Device token management (in-memory with optional database persistence)
 * - HIPAA-compliant logging for all notification operations
 *
 * Architecture:
 * - PushNotificationService: Primary service for sending push notifications
 * - DeviceTokenService: Manages device tokens (in-memory + optional database)
 * - SNSBackupService: AWS SNS backup for high availability
 */
@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    DatabaseModule, // Optional: For device token persistence
  ],
  providers: [PushNotificationService, DeviceTokenService, SNSBackupService],
  exports: [PushNotificationService, DeviceTokenService, SNSBackupService],
})
export class PushModule {}
