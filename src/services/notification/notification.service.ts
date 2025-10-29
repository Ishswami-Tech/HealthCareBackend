import { Injectable, Logger } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { PushNotificationService } from "../../libs/communication/messaging/push/push.service";
import { SESEmailService } from "../../libs/communication/messaging/email/ses-email.service";
import { SNSBackupService } from "../../libs/communication/messaging/push/sns-backup.service";
import { ChatBackupService } from "../../libs/communication/messaging/chat/chat-backup.service";
import {
  UnifiedNotificationDto,
  AppointmentReminderDto,
  PrescriptionNotificationDto,
  ChatBackupDto,
  NotificationResponseDto,
  NotificationType,
} from "../../libs/dtos";

export interface NotificationDeliveryResult {
  success: boolean;
  results: Array<{
    type: "push" | "email" | "push_backup";
    result: {
      success: boolean;
      messageId?: string;
      error?: string;
    };
  }>;
}

export interface NotificationMetrics {
  totalSent: number;
  successfulSent: number;
  failedSent: number;
  services: {
    push: { sent: number; successful: number; failed: number };
    email: { sent: number; successful: number; failed: number };
    backup: { sent: number; successful: number; failed: number };
  };
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private metrics: NotificationMetrics = {
    totalSent: 0,
    successfulSent: 0,
    failedSent: 0,
    services: {
      push: { sent: 0, successful: 0, failed: 0 },
      email: { sent: 0, successful: 0, failed: 0 },
      backup: { sent: 0, successful: 0, failed: 0 },
    },
  };

  constructor(
    private readonly pushService: PushNotificationService,
    private readonly emailService: SESEmailService,
    private readonly snsBackupService: SNSBackupService,
    private readonly chatBackupService: ChatBackupService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async sendUnifiedNotification(
    notificationData: UnifiedNotificationDto,
  ): Promise<NotificationDeliveryResult> {
    const results: NotificationDeliveryResult["results"] = [];
    let overallSuccess = false;

    try {
      this.logger.log("Sending unified notification", {
        type: notificationData.type,
        title: notificationData.title,
        hasDeviceToken: !!notificationData.deviceToken,
        hasEmail: !!notificationData.email,
      });

      // Send push notification
      if (
        (notificationData.type === NotificationType.PUSH ||
          notificationData.type === NotificationType.BOTH) &&
        notificationData.deviceToken
      ) {
        try {
          const pushResult = await this.pushService.sendToDevice(
            notificationData.deviceToken,
            {
              title: notificationData.title,
              body: notificationData.body,
              ...(notificationData.data && { data: notificationData.data }),
            },
          );

          results.push({ type: "push", result: pushResult });
          this.updateMetrics("push", pushResult.success);

          if (pushResult.success) {
            overallSuccess = true;
          } else if (notificationData.useBackup !== false) {
            // Try SNS backup if primary push fails
            this.logger.warn("Push notification failed, trying SNS backup", {
              _error: pushResult.error,
              deviceToken: this.maskToken(notificationData.deviceToken),
            });

            try {
              const snsResult =
                await this.snsBackupService.sendPushNotification(
                  notificationData.deviceToken,
                  {
                    title: notificationData.title,
                    body: notificationData.body,
                    ...(notificationData.data && {
                      data: notificationData.data,
                    }),
                  },
                  "android", // Default to Android, could be made configurable
                );

              results.push({ type: "push_backup", result: snsResult });
              this.updateMetrics("backup", snsResult.success);

              if (snsResult.success) {
                overallSuccess = true;
              }
            } catch (snsError) {
              this.logger.error("SNS backup also failed", {
                _error:
                  snsError instanceof Error
                    ? snsError.message
                    : "Unknown error",
                deviceToken: this.maskToken(notificationData.deviceToken),
              });
              results.push({
                type: "push_backup",
                result: {
                  success: false,
                  error:
                    snsError instanceof Error
                      ? snsError.message
                      : "Unknown error",
                },
              });
              this.updateMetrics("backup", false);
            }
          }
        } catch (pushError) {
          this.logger.error("Push notification failed", {
            _error:
              pushError instanceof Error ? pushError.message : "Unknown error",
            deviceToken: this.maskToken(notificationData.deviceToken),
          });
          results.push({
            type: "push",
            result: {
              success: false,
              error:
                pushError instanceof Error
                  ? pushError.message
                  : "Unknown error",
            },
          });
          this.updateMetrics("push", false);
        }
      }

      // Send email notification
      if (
        (notificationData.type === NotificationType.EMAIL ||
          notificationData.type === NotificationType.BOTH) &&
        notificationData.email
      ) {
        try {
          const emailResult = await this.emailService.sendEmail({
            to: notificationData.email,
            subject: notificationData.title,
            body: notificationData.body,
            isHtml: true,
          });

          results.push({ type: "email", result: emailResult });
          this.updateMetrics("email", emailResult.success);

          if (emailResult.success) {
            overallSuccess = true;
          }
        } catch (emailError) {
          this.logger.error("Email notification failed", {
            _error:
              emailError instanceof Error
                ? emailError.message
                : "Unknown error",
            email: notificationData.email,
          });
          results.push({
            type: "email",
            result: {
              success: false,
              error:
                emailError instanceof Error
                  ? emailError.message
                  : "Unknown error",
            },
          });
          this.updateMetrics("email", false);
        }
      }

      // Emit event for notification sent
      this.eventEmitter.emit("notification.sent", {
        type: notificationData.type,
        success: overallSuccess,
        title: notificationData.title,
        results,
        timestamp: Date.now(),
      });

      this.logger.log("Unified notification completed", {
        type: notificationData.type,
        overallSuccess,
        resultCount: results.length,
        title: notificationData.title,
      });

      return { success: overallSuccess, results };
    } catch (_error) {
      this.logger.error("Failed to send unified notification", {
        _error: _error instanceof Error ? _error.message : "Unknown _error",
        stack: _error instanceof Error ? _error.stack : undefined,
        type: notificationData.type,
        title: notificationData.title,
      });

      return {
        success: false,
        results: [
          {
            type: "push",
            result: {
              success: false,
              error: _error instanceof Error ? _error.message : "Unknown error",
            },
          },
        ],
      };
    }
  }

  async sendAppointmentReminder(
    appointmentData: AppointmentReminderDto,
  ): Promise<NotificationResponseDto> {
    try {
      this.logger.log("Sending appointment reminder", {
        patientName: appointmentData.patientName,
        doctorName: appointmentData.doctorName,
        date: appointmentData.date,
        time: appointmentData.time,
      });

      const unifiedNotification: UnifiedNotificationDto = {
        type: appointmentData.deviceToken
          ? NotificationType.BOTH
          : NotificationType.EMAIL,
        title: "Appointment Reminder",
        body: `Your appointment with ${appointmentData.doctorName} is scheduled for ${appointmentData.date} at ${appointmentData.time}`,
        ...(appointmentData.deviceToken && {
          deviceToken: appointmentData.deviceToken,
        }),
        email: appointmentData.to,
        data: {
          type: "appointment_reminder",
          ...(appointmentData.appointmentId && {
            appointmentId: appointmentData.appointmentId,
          }),
          doctorName: appointmentData.doctorName,
          date: appointmentData.date,
          time: appointmentData.time,
          location: appointmentData.location,
        },
      };

      // Also send dedicated email with rich template
      const emailResult = await this.emailService.sendAppointmentReminder(
        appointmentData.to,
        {
          patientName: appointmentData.patientName,
          doctorName: appointmentData.doctorName,
          date: appointmentData.date,
          time: appointmentData.time,
          location: appointmentData.location,
          ...(appointmentData.appointmentId && {
            appointmentId: appointmentData.appointmentId,
          }),
        },
      );

      const unifiedResult =
        await this.sendUnifiedNotification(unifiedNotification);

      // Emit specific event for appointment reminder
      this.eventEmitter.emit("appointment.reminder.sent", {
        patientName: appointmentData.patientName,
        doctorName: appointmentData.doctorName,
        date: appointmentData.date,
        emailSuccess: emailResult.success,
        pushSuccess: unifiedResult.success,
        timestamp: Date.now(),
      });

      return {
        success: emailResult.success || unifiedResult.success,
        ...(emailResult.messageId && { messageId: emailResult.messageId }),
        ...(unifiedResult.results[0]?.result?.messageId && {
          messageId: unifiedResult.results[0].result.messageId,
        }),
        metadata: {
          emailResult,
          pushResult: unifiedResult,
        },
      };
    } catch (_error) {
      this.logger.error("Failed to send appointment reminder", {
        _error: _error instanceof Error ? _error.message : "Unknown error",
        patientName: appointmentData.patientName,
        appointmentId: appointmentData.appointmentId,
      });

      return {
        success: false,
        error: _error instanceof Error ? _error.message : "Unknown error",
      };
    }
  }

  async sendPrescriptionNotification(
    prescriptionData: PrescriptionNotificationDto,
  ): Promise<NotificationResponseDto> {
    try {
      this.logger.log("Sending prescription notification", {
        patientName: prescriptionData.patientName,
        prescriptionId: prescriptionData.prescriptionId,
        medicationCount: prescriptionData.medications.length,
      });

      const unifiedNotification: UnifiedNotificationDto = {
        type: prescriptionData.deviceToken
          ? NotificationType.BOTH
          : NotificationType.EMAIL,
        title: "Prescription Ready",
        body: `Your prescription ${prescriptionData.prescriptionId} is ready for pickup`,
        ...(prescriptionData.deviceToken && {
          deviceToken: prescriptionData.deviceToken,
        }),
        email: prescriptionData.to,
        data: {
          type: "prescription_ready",
          prescriptionId: prescriptionData.prescriptionId,
          doctorName: prescriptionData.doctorName,
          medicationCount: prescriptionData.medications.length.toString(),
        },
      };

      // Send dedicated email with rich template
      const emailResult = await this.emailService.sendPrescriptionReady(
        prescriptionData.to,
        {
          patientName: prescriptionData.patientName,
          doctorName: prescriptionData.doctorName,
          prescriptionId: prescriptionData.prescriptionId,
          medications: prescriptionData.medications,
          ...(prescriptionData.pickupInstructions && {
            pickupInstructions: prescriptionData.pickupInstructions,
          }),
        },
      );

      const unifiedResult =
        await this.sendUnifiedNotification(unifiedNotification);

      // Emit specific event for prescription notification
      this.eventEmitter.emit("prescription.notification.sent", {
        patientName: prescriptionData.patientName,
        prescriptionId: prescriptionData.prescriptionId,
        emailSuccess: emailResult.success,
        pushSuccess: unifiedResult.success,
        timestamp: Date.now(),
      });

      return {
        success: emailResult.success || unifiedResult.success,
        ...(emailResult.messageId && { messageId: emailResult.messageId }),
        ...(unifiedResult.results[0]?.result?.messageId && {
          messageId: unifiedResult.results[0].result.messageId,
        }),
        metadata: {
          emailResult,
          pushResult: unifiedResult,
        },
      };
    } catch (_error) {
      this.logger.error("Failed to send prescription notification", {
        _error: _error instanceof Error ? _error.message : "Unknown error",
        patientName: prescriptionData.patientName,
        prescriptionId: prescriptionData.prescriptionId,
      });

      return {
        success: false,
        error: _error instanceof Error ? _error.message : "Unknown error",
      };
    }
  }

  async backupChatMessage(
    chatData: ChatBackupDto,
  ): Promise<NotificationResponseDto> {
    try {
      this.logger.log("Backing up chat message", {
        messageId: chatData.id,
        senderId: chatData.senderId,
        receiverId: chatData.receiverId,
        type: chatData.type,
      });

      const result = await this.chatBackupService.backupMessage({
        id: chatData.id,
        senderId: chatData.senderId,
        receiverId: chatData.receiverId,
        content: chatData.content,
        timestamp: chatData.timestamp,
        type: chatData.type,
        ...(chatData.metadata && { metadata: chatData.metadata }),
      });

      // Emit event for chat message backup
      this.eventEmitter.emit("chat.message.backed_up", {
        messageId: chatData.id,
        senderId: chatData.senderId,
        receiverId: chatData.receiverId,
        success: result.success,
        timestamp: Date.now(),
      });

      return {
        success: result.success,
        ...(result.messageId && { messageId: result.messageId }),
        ...(result.error && { error: result.error }),
      };
    } catch (_error) {
      this.logger.error("Failed to backup chat message", {
        _error: _error instanceof Error ? _error.message : "Unknown _error",
        messageId: chatData.id,
      });

      return {
        success: false,
        error: _error instanceof Error ? _error.message : "Unknown error",
      };
    }
  }

  getNotificationMetrics(): NotificationMetrics {
    return { ...this.metrics };
  }

  getServiceHealthStatus(): {
    firebase: boolean;
    awsSes: boolean;
    awsSns: boolean;
    firebaseDatabase: boolean;
  } {
    return {
      firebase: this.pushService.isHealthy(),
      awsSes: this.emailService.isHealthy(),
      awsSns: this.snsBackupService.isHealthy(),
      firebaseDatabase: this.chatBackupService.isHealthy(),
    };
  }

  private updateMetrics(
    service: "push" | "email" | "backup",
    success: boolean,
  ): void {
    this.metrics.totalSent++;
    this.metrics.services[service].sent++;

    if (success) {
      this.metrics.successfulSent++;
      this.metrics.services[service].successful++;
    } else {
      this.metrics.failedSent++;
      this.metrics.services[service].failed++;
    }
  }

  private maskToken(token: string): string {
    if (!token || token.length < 10) return "INVALID_TOKEN";
    return `${token.substring(0, 6)}...${token.substring(token.length - 4)}`;
  }
}
