import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { BullModule } from '@nestjs/bull';
import { LoggingModule } from '@infrastructure/logging';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import {
  PushNotificationService,
  SNSBackupService,
  DeviceTokenService,
} from '@communication/messaging/push';
import {
  SESEmailService,
  EmailTemplatesService,
  EmailQueueService,
} from '@communication/messaging/email';
import { ChatBackupService } from '@communication/messaging/chat/chat-backup.service';

@Module({
  imports: [
    ConfigModule,
    EventEmitterModule,
    LoggingModule,
    BullModule.registerQueue({
      name: 'email',
    }),
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    PushNotificationService,
    SESEmailService,
    SNSBackupService,
    ChatBackupService,
    DeviceTokenService,
    EmailTemplatesService,
    EmailQueueService,
  ],
  exports: [
    NotificationService,
    PushNotificationService,
    SESEmailService,
    SNSBackupService,
    ChatBackupService,
    DeviceTokenService,
    EmailTemplatesService,
    EmailQueueService,
  ],
})
export class NotificationModule {}
