import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { BullModule } from "@nestjs/bull";
import { NotificationService } from "./notification.service";
import { NotificationController } from "./notification.controller";
import { PushNotificationService } from "../../libs/communication/messaging/push/push.service";
import { SESEmailService } from "../../libs/communication/messaging/email/ses-email.service";
import { SNSBackupService } from "../../libs/communication/messaging/push/sns-backup.service";
import { ChatBackupService } from "../../libs/communication/messaging/chat/chat-backup.service";
import { DeviceTokenService } from "../../libs/communication/messaging/push/device-token.service";
import { EmailTemplatesService } from "../../libs/communication/messaging/email/email-templates.service";
import { EmailQueueService } from "../../libs/communication/messaging/email/email-queue.service";

@Module({
  imports: [
    ConfigModule,
    EventEmitterModule,
    BullModule.registerQueue({
      name: "email",
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
