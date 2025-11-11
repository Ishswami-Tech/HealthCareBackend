import { Module } from '@nestjs/common';
import { ConfigModule } from '@config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { LoggingModule } from '@infrastructure/logging';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import {
  PushNotificationService,
  SNSBackupService,
  DeviceTokenService,
} from '@communication/messaging/push';
import { EmailModule } from '@communication/messaging/email';
import { ChatBackupService } from '@communication/messaging/chat/chat-backup.service';

@Module({
  imports: [
    ConfigModule,
    EventEmitterModule,
    LoggingModule,
    EmailModule, // Import EmailModule which already has the email queue registered
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    PushNotificationService,
    SNSBackupService,
    ChatBackupService,
    DeviceTokenService,
    // EmailQueueService, SESEmailService, EmailTemplatesService are provided by EmailModule
  ],
  exports: [
    NotificationService,
    PushNotificationService,
    SNSBackupService,
    ChatBackupService,
    DeviceTokenService,
    // EmailQueueService, SESEmailService, EmailTemplatesService are exported by EmailModule
  ],
})
export class NotificationModule {}
