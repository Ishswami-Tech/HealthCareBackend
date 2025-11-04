import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PushNotificationService, SNSBackupService } from '@communication/messaging/push';
import { SESEmailService } from '@communication/messaging/email';
import { ChatBackupService } from '@communication/messaging/chat/chat-backup.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import {
  UnifiedNotificationDto,
  AppointmentReminderDto,
  PrescriptionNotificationDto,
  ChatBackupDto,
  NotificationResponseDto,
  NotificationType,
} from '@dtos/index';
import type {
  NotificationDeliveryResult,
  NotificationMetrics,
  NotificationServiceHealthStatus,
} from '@core/types/notification.types';

@Injectable()
export class NotificationService {
  // Internal mutable metrics (different from readonly NotificationMetrics interface)
  private metrics: {
    totalSent: number;
    successfulSent: number;
    failedSent: number;
    services: {
      push: { sent: number; successful: number; failed: number };
      email: { sent: number; successful: number; failed: number };
      backup: { sent: number; successful: number; failed: number };
    };
  } = {
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
    private readonly loggingService: LoggingService
  ) {}

  async sendUnifiedNotification(
    notificationData: UnifiedNotificationDto
  ): Promise<NotificationDeliveryResult> {
    const results: NotificationDeliveryResult['results'] = [];
    let overallSuccess = false;

    try {
      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.INFO,
        'Sending unified notification',
        'NotificationService',
        {
          type: notificationData.type,
          title: notificationData.title,
          hasDeviceToken: !!notificationData.deviceToken,
          hasEmail: !!notificationData.email,
        }
      );

      // Send push notification
      if (
        (notificationData.type === NotificationType.PUSH ||
          notificationData.type === NotificationType.BOTH) &&
        notificationData.deviceToken
      ) {
        try {
          const pushResult = await this.pushService.sendToDevice(notificationData.deviceToken, {
            title: notificationData.title,
            body: notificationData.body,
            ...(notificationData.data && { data: notificationData.data }),
          });

          results.push({ type: 'push', result: pushResult });
          this.updateMetrics('push', pushResult.success);

          if (pushResult.success) {
            overallSuccess = true;
          } else if (notificationData.useBackup !== false) {
            // Try SNS backup if primary push fails
            void this.loggingService.log(
              LogType.NOTIFICATION,
              LogLevel.WARN,
              'Push notification failed, trying SNS backup',
              'NotificationService',
              {
                error: pushResult.error,
                deviceToken: this.maskToken(notificationData.deviceToken),
              }
            );

            try {
              const snsResult = await this.snsBackupService.sendPushNotification(
                notificationData.deviceToken,
                {
                  title: notificationData.title,
                  body: notificationData.body,
                  ...(notificationData.data && {
                    data: notificationData.data,
                  }),
                },
                'android' // Default to Android, could be made configurable
              );

              results.push({ type: 'push_backup', result: snsResult });
              this.updateMetrics('backup', snsResult.success);

              if (snsResult.success) {
                overallSuccess = true;
              }
            } catch (snsError) {
              void this.loggingService.log(
                LogType.NOTIFICATION,
                LogLevel.ERROR,
                'SNS backup also failed',
                'NotificationService',
                {
                  error: snsError instanceof Error ? snsError.message : 'Unknown error',
                  deviceToken: this.maskToken(notificationData.deviceToken),
                  stack: snsError instanceof Error ? snsError.stack : String(snsError),
                }
              );
              results.push({
                type: 'push_backup',
                result: {
                  success: false,
                  error: snsError instanceof Error ? snsError.message : 'Unknown error',
                },
              });
              this.updateMetrics('backup', false);
            }
          }
        } catch (pushError) {
          void this.loggingService.log(
            LogType.NOTIFICATION,
            LogLevel.ERROR,
            'Push notification failed',
            'NotificationService',
            {
              error: pushError instanceof Error ? pushError.message : 'Unknown error',
              deviceToken: this.maskToken(notificationData.deviceToken),
              stack: pushError instanceof Error ? pushError.stack : String(pushError),
            }
          );
          results.push({
            type: 'push',
            result: {
              success: false,
              error: pushError instanceof Error ? pushError.message : 'Unknown error',
            },
          });
          this.updateMetrics('push', false);
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

          results.push({ type: 'email', result: emailResult });
          this.updateMetrics('email', emailResult.success);

          if (emailResult.success) {
            overallSuccess = true;
          }
        } catch (emailError) {
          void this.loggingService.log(
            LogType.NOTIFICATION,
            LogLevel.ERROR,
            'Email notification failed',
            'NotificationService',
            {
              error: emailError instanceof Error ? emailError.message : 'Unknown error',
              email: notificationData.email,
              stack: emailError instanceof Error ? emailError.stack : String(emailError),
            }
          );
          results.push({
            type: 'email',
            result: {
              success: false,
              error: emailError instanceof Error ? emailError.message : 'Unknown error',
            },
          });
          this.updateMetrics('email', false);
        }
      }

      // Emit event for notification sent
      this.eventEmitter.emit('notification.sent', {
        type: notificationData.type,
        success: overallSuccess,
        title: notificationData.title,
        results,
        timestamp: Date.now(),
      });

      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.INFO,
        'Unified notification completed',
        'NotificationService',
        {
          type: notificationData.type,
          overallSuccess,
          resultCount: results.length,
          title: notificationData.title,
        }
      );

      return { success: overallSuccess, results };
    } catch (_error) {
      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.ERROR,
        'Failed to send unified notification',
        'NotificationService',
        {
          error: _error instanceof Error ? _error.message : 'Unknown error',
          stack: _error instanceof Error ? _error.stack : String(_error),
          type: notificationData.type,
          title: notificationData.title,
        }
      );

      return {
        success: false,
        results: [
          {
            type: 'push',
            result: {
              success: false,
              error: _error instanceof Error ? _error.message : 'Unknown error',
            },
          },
        ],
      };
    }
  }

  async sendAppointmentReminder(
    appointmentData: AppointmentReminderDto
  ): Promise<NotificationResponseDto> {
    try {
      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Sending appointment reminder',
        'NotificationService',
        {
          patientName: appointmentData.patientName,
          doctorName: appointmentData.doctorName,
          date: appointmentData.date,
          time: appointmentData.time,
        }
      );

      const unifiedNotification: UnifiedNotificationDto = {
        type: appointmentData.deviceToken ? NotificationType.BOTH : NotificationType.EMAIL,
        title: 'Appointment Reminder',
        body: `Your appointment with ${appointmentData.doctorName} is scheduled for ${appointmentData.date} at ${appointmentData.time}`,
        ...(appointmentData.deviceToken && {
          deviceToken: appointmentData.deviceToken,
        }),
        email: appointmentData.to,
        data: {
          type: 'appointment_reminder',
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
      const emailResult = await this.emailService.sendAppointmentReminder(appointmentData.to, {
        patientName: appointmentData.patientName,
        doctorName: appointmentData.doctorName,
        date: appointmentData.date,
        time: appointmentData.time,
        location: appointmentData.location,
        ...(appointmentData.appointmentId && {
          appointmentId: appointmentData.appointmentId,
        }),
      });

      const unifiedResult = await this.sendUnifiedNotification(unifiedNotification);

      // Emit specific event for appointment reminder
      this.eventEmitter.emit('appointment.reminder.sent', {
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
      void this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.ERROR,
        'Failed to send appointment reminder',
        'NotificationService',
        {
          error: _error instanceof Error ? _error.message : 'Unknown error',
          patientName: appointmentData.patientName,
          appointmentId: appointmentData.appointmentId,
          stack: _error instanceof Error ? _error.stack : String(_error),
        }
      );

      return {
        success: false,
        error: _error instanceof Error ? _error.message : 'Unknown error',
      };
    }
  }

  async sendPrescriptionNotification(
    prescriptionData: PrescriptionNotificationDto
  ): Promise<NotificationResponseDto> {
    try {
      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.INFO,
        'Sending prescription notification',
        'NotificationService',
        {
          patientName: prescriptionData.patientName,
          prescriptionId: prescriptionData.prescriptionId,
          medicationCount: prescriptionData.medications.length,
        }
      );

      const unifiedNotification: UnifiedNotificationDto = {
        type: prescriptionData.deviceToken ? NotificationType.BOTH : NotificationType.EMAIL,
        title: 'Prescription Ready',
        body: `Your prescription ${prescriptionData.prescriptionId} is ready for pickup`,
        ...(prescriptionData.deviceToken && {
          deviceToken: prescriptionData.deviceToken,
        }),
        email: prescriptionData.to,
        data: {
          type: 'prescription_ready',
          prescriptionId: prescriptionData.prescriptionId,
          doctorName: prescriptionData.doctorName,
          medicationCount: prescriptionData.medications.length.toString(),
        },
      };

      // Send dedicated email with rich template
      const emailResult = await this.emailService.sendPrescriptionReady(prescriptionData.to, {
        patientName: prescriptionData.patientName,
        doctorName: prescriptionData.doctorName,
        prescriptionId: prescriptionData.prescriptionId,
        medications: prescriptionData.medications,
        ...(prescriptionData.pickupInstructions && {
          pickupInstructions: prescriptionData.pickupInstructions,
        }),
      });

      const unifiedResult = await this.sendUnifiedNotification(unifiedNotification);

      // Emit specific event for prescription notification
      this.eventEmitter.emit('prescription.notification.sent', {
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
      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.ERROR,
        'Failed to send prescription notification',
        'NotificationService',
        {
          error: _error instanceof Error ? _error.message : 'Unknown error',
          patientName: prescriptionData.patientName,
          prescriptionId: prescriptionData.prescriptionId,
          stack: _error instanceof Error ? _error.stack : String(_error),
        }
      );

      return {
        success: false,
        error: _error instanceof Error ? _error.message : 'Unknown error',
      };
    }
  }

  async backupChatMessage(chatData: ChatBackupDto): Promise<NotificationResponseDto> {
    try {
      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.INFO,
        'Backing up chat message',
        'NotificationService',
        {
          messageId: chatData.id,
          senderId: chatData.senderId,
          receiverId: chatData.receiverId,
          type: chatData.type,
        }
      );

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
      this.eventEmitter.emit('chat.message.backed_up', {
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
      void this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.ERROR,
        'Failed to backup chat message',
        'NotificationService',
        {
          error: _error instanceof Error ? _error.message : 'Unknown error',
          messageId: chatData.id,
          stack: _error instanceof Error ? _error.stack : String(_error),
        }
      );

      return {
        success: false,
        error: _error instanceof Error ? _error.message : 'Unknown error',
      };
    }
  }

  getNotificationMetrics(): NotificationMetrics {
    return { ...this.metrics };
  }

  getServiceHealthStatus(): NotificationServiceHealthStatus {
    return {
      firebase: this.pushService.isHealthy(),
      awsSes: this.emailService.isHealthy(),
      awsSns: this.snsBackupService.isHealthy(),
      firebaseDatabase: this.chatBackupService.isHealthy(),
    };
  }

  private updateMetrics(service: 'push' | 'email' | 'backup', success: boolean): void {
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
    if (!token || token.length < 10) return 'INVALID_TOKEN';
    return `${token.substring(0, 6)}...${token.substring(token.length - 4)}`;
  }
}
