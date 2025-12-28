import { Injectable } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { EmailService } from '@communication/channels/email/email.service';
import { WhatsAppService } from '@communication/channels/whatsapp/whatsapp.service';
import { PushNotificationService } from '@communication/channels/push/push.service';
import {
  SocketService,
  type SocketEventData,
  type SocketEventPrimitive,
} from '@communication/channels/socket/socket.service';
import { DatabaseService } from '@infrastructure/database';
import { EmailTemplate } from '@core/types';
import type {
  NotificationData,
  NotificationResult,
  NotificationTemplate,
} from '@core/types/appointment.types';

// Re-export types for backward compatibility
export type { NotificationData, NotificationResult, NotificationTemplate };

@Injectable()
export class AppointmentNotificationService {
  private readonly NOTIFICATION_CACHE_TTL = 3600; // 1 hour
  private readonly TEMPLATE_CACHE_TTL = 7200; // 2 hours

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly emailService: EmailService,
    private readonly whatsAppService: WhatsAppService,
    private readonly pushService: PushNotificationService,
    private readonly socketService: SocketService,
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService
  ) {}

  /**
   * Send appointment notification through multiple channels
   */
  async sendNotification(notificationData: NotificationData): Promise<NotificationResult> {
    const notificationId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const sentChannels: string[] = [];
    const failedChannels: string[] = [];
    const errors: string[] = [];

    await this.loggingService.log(
      LogType.NOTIFICATION,
      LogLevel.INFO,
      `Sending appointment notification ${notificationId}`,
      'AppointmentNotificationService',
      {
        appointmentId: notificationData.appointmentId,
        type: notificationData.type,
        channels: notificationData.channels,
      }
    );

    // Process each notification channel
    for (const channel of notificationData.channels) {
      try {
        await this.sendViaChannel(channel, notificationData, notificationId);
        sentChannels.push(channel);
        await this.loggingService.log(
          LogType.NOTIFICATION,
          LogLevel.INFO,
          `Notification sent via ${channel}`,
          'AppointmentNotificationService',
          { notificationId }
        );
      } catch (_error) {
        failedChannels.push(channel);
        const errorMessage = _error instanceof Error ? _error.message : 'Unknown error';
        errors.push(`${channel}: ${errorMessage}`);
        await this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          `Failed to send notification via ${channel}`,
          'AppointmentNotificationService',
          {
            notificationId,
            error: errorMessage,
          }
        );
      }
    }

    // Log the notification attempt
    await this.loggingService.log(
      LogType.NOTIFICATION,
      LogLevel.INFO,
      `Appointment notification ${notificationData.type} sent`,
      'AppointmentNotificationService.sendNotification',
      {
        notificationId,
        appointmentId: notificationData.appointmentId,
        sentChannels,
        failedChannels,
        errors,
      }
    );

    return {
      success: sentChannels.length > 0,
      notificationId,
      sentChannels,
      failedChannels,
      errors: errors.length > 0 ? errors : [],
    };
  }

  /**
   * Schedule a notification for future delivery
   */
  async scheduleNotification(
    notificationData: NotificationData,
    scheduledFor: Date
  ): Promise<NotificationResult> {
    const notificationId = `scheduled_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    await this.loggingService.log(
      LogType.NOTIFICATION,
      LogLevel.INFO,
      `Scheduling notification ${notificationId}`,
      'AppointmentNotificationService',
      {
        appointmentId: notificationData.appointmentId,
        scheduledFor,
      }
    );

    // Store scheduled notification in cache
    const cacheKey = `scheduled_notification:${notificationId}`;
    await this.cacheService.set(
      cacheKey,
      {
        ...notificationData,
        notificationId,
        scheduledFor,
      },
      Math.floor((scheduledFor.getTime() - Date.now()) / 1000)
    );

    return {
      success: true,
      notificationId,
      sentChannels: [],
      failedChannels: [],
      scheduledFor,
    };
  }

  /**
   * Send reminder notifications for upcoming appointments
   */
  async sendReminderNotifications(
    clinicId: string,
    hoursBefore: number = 24
  ): Promise<{ processed: number; sent: number; failed: number }> {
    await this.loggingService.log(
      LogType.NOTIFICATION,
      LogLevel.INFO,
      `Sending reminder notifications for clinic ${clinicId}`,
      'AppointmentNotificationService',
      {
        hoursBefore,
      }
    );

    // This would typically query the database for upcoming appointments
    // For now, we'll return a mock response
    const processed = 0;
    const sent = 0;
    const failed = 0;

    return Promise.resolve({ processed, sent, failed });
  }

  /**
   * Get notification templates
   */
  async getNotificationTemplates(clinicId: string, type?: string): Promise<NotificationTemplate[]> {
    const cacheKey = `notification_templates:${type || 'all'}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached && Array.isArray(cached)) {
        return cached as NotificationTemplate[];
      }

      // Get templates from database
      // Note: notificationTemplate model doesn't exist in Prisma schema
      // Using Notification model or returning mock templates for now
      const templates = await this.databaseService.executeHealthcareRead(_client => {
        // Return empty array or mock templates until notificationTemplate model is added
        return Promise.resolve([] as unknown[]);
      });

      const templateList: NotificationTemplate[] = templates.map((template: unknown) => {
        const templateData = template as Record<string, unknown>;
        return {
          id: templateData['id'] as string,
          name: templateData['name'] as string,
          type: templateData['type'] as string,
          channels: templateData['channels'] as string[],
          subject: templateData['subject'] as string,
          body: templateData['body'] as string,
          variables: templateData['variables'] as string[],
          isActive: templateData['isActive'] as boolean,
        };
      });

      await this.cacheService.set(cacheKey, templateList, this.TEMPLATE_CACHE_TTL);
      return templateList;
    } catch (_error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to get notification templates',
        'AppointmentNotificationService',
        {
          error: _error instanceof Error ? _error.message : 'Unknown error',
        }
      );
      return [];
    }
  }

  /**
   * Send notification via specific channel
   */
  private async sendViaChannel(
    channel: string,
    notificationData: NotificationData,
    notificationId: string
  ): Promise<void> {
    switch (channel) {
      case 'email':
        await this.sendEmailNotification(notificationData, notificationId);
        break;

      case 'whatsapp':
        await this.sendWhatsAppNotification(notificationData, notificationId);
        break;

      case 'push':
        await this.sendPushNotification(notificationData, notificationId);
        break;

      case 'socket':
        await this.sendSocketNotification(notificationData, notificationId);
        break;

      default:
        throw new Error(`Unsupported notification channel: ${channel}`);
    }
  }

  /**
   * Send email notification
   */
  private async sendEmailNotification(
    notificationData: NotificationData,
    notificationId: string
  ): Promise<void> {
    const { templateData, type, clinicId, patientId } = notificationData;

    // Fetch patient email from database
    let patientEmail: string | undefined;
    try {
      const user = await this.databaseService.executeHealthcareRead(async prisma => {
        return await prisma.user.findUnique({
          where: { id: patientId },
          select: { email: true },
        });
      });
      patientEmail = user?.email || undefined;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to fetch patient email for notification`,
        'AppointmentNotificationService.sendEmailNotification',
        {
          notificationId,
          patientId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }

    if (!patientEmail) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Skipping email notification - patient email not found`,
        'AppointmentNotificationService.sendEmailNotification',
        {
          notificationId,
          patientId,
        }
      );
      return;
    }

    const subject = this.getEmailSubject(type, templateData);
    const body = this.getEmailBody(type, templateData);

    await this.emailService.sendEmail({
      to: patientEmail,
      subject,
      template: EmailTemplate.APPOINTMENT_REMINDER,
      context: {
        patientName: templateData.patientName,
        doctorName: templateData.doctorName,
        appointmentDate: templateData.appointmentDate,
        appointmentTime: templateData.appointmentTime,
        location: templateData.location,
        clinicName: templateData.clinicName,
      },
      text: body,
      html: body,
      ...(clinicId && { clinicId }), // Pass clinicId for multi-tenant email routing
    });

    await this.loggingService.log(
      LogType.NOTIFICATION,
      LogLevel.INFO,
      `Email notification sent`,
      'AppointmentNotificationService',
      {
        notificationId,
        patientEmail,
      }
    );
  }

  /**
   * Send WhatsApp notification
   * Supports multi-tenant communication via clinicId
   */
  private async sendWhatsAppNotification(
    notificationData: NotificationData,
    notificationId: string
  ): Promise<void> {
    const { templateData, type, patientId, clinicId } = notificationData;

    // Fetch patient phone number from database
    let patientPhone: string | null = null;
    if (patientId) {
      try {
        const patient = await this.databaseService.executeHealthcareRead(async prisma => {
          return await prisma.patient.findUnique({
            where: { id: patientId },
            select: {
              userId: true,
            },
          });
        });

        // Fetch phone from user if patient found
        if (patient?.userId) {
          const user = await this.databaseService.executeHealthcareRead(async prisma => {
            return await prisma.user.findUnique({
              where: { id: patient.userId },
              select: { phone: true },
            });
          });
          patientPhone = user?.phone || null;
        }
      } catch (error) {
        await this.loggingService.log(
          LogType.ERROR,
          LogLevel.WARN,
          `Failed to fetch patient phone number: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'AppointmentNotificationService',
          { patientId, notificationId }
        );
      }
    }

    if (!patientPhone) {
      await this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.WARN,
        `Skipping WhatsApp notification - no phone number found`,
        'AppointmentNotificationService',
        { notificationId, patientId }
      );
      return;
    }

    try {
      // Send based on notification type
      if (type === 'reminder' || type === 'created' || type === 'updated') {
        await this.whatsAppService.sendAppointmentReminder(
          patientPhone,
          templateData.patientName,
          templateData.doctorName,
          templateData.appointmentDate,
          templateData.appointmentTime,
          templateData.location,
          clinicId // Pass clinicId for multi-tenant support
        );
      } else if (type === 'prescription') {
        await this.whatsAppService.sendPrescriptionNotification(
          patientPhone,
          templateData.patientName,
          templateData.doctorName,
          templateData.medicationDetails || 'Prescription ready',
          templateData.prescriptionUrl,
          clinicId // Pass clinicId for multi-tenant support
        );
      }

      await this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.INFO,
        `WhatsApp notification sent`,
        'AppointmentNotificationService',
        {
          notificationId,
          patientPhone,
          type,
          clinicId,
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to send WhatsApp notification: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'AppointmentNotificationService',
        {
          notificationId,
          patientPhone,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      throw error;
    }
  }

  /**
   * Send push notification
   */
  private async sendPushNotification(
    notificationData: NotificationData,
    notificationId: string
  ): Promise<void> {
    const { templateData, type, patientId } = notificationData;

    // Fetch patient device tokens from database
    let deviceTokens: string[] = [];
    try {
      const tokens = await this.databaseService.executeHealthcareRead(async prisma => {
        return await prisma.deviceToken.findMany({
          where: {
            userId: patientId,
            isActive: true,
          },
          select: { token: true },
        });
      });
      deviceTokens = tokens.map(t => t.token);
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to fetch device tokens for push notification`,
        'AppointmentNotificationService.sendPushNotification',
        {
          notificationId,
          patientId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }

    if (deviceTokens.length === 0) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Skipping push notification - no device tokens found`,
        'AppointmentNotificationService.sendPushNotification',
        {
          notificationId,
          patientId,
        }
      );
      return;
    }

    const title = this.getPushTitle(type, templateData);
    const body = this.getPushBody(type, templateData);

    for (const token of deviceTokens) {
      await this.pushService.sendToDevice(token, {
        title,
        body,
        data: {
          appointmentId: notificationData.appointmentId,
          type: notificationData.type,
        },
      });
    }

    await this.loggingService.log(
      LogType.NOTIFICATION,
      LogLevel.INFO,
      `Push notification sent`,
      'AppointmentNotificationService',
      {
        notificationId,
        deviceTokens: deviceTokens.length,
      }
    );
  }

  /**
   * Send socket notification
   */
  private async sendSocketNotification(
    notificationData: NotificationData,
    notificationId: string
  ): Promise<void> {
    const { appointmentId, patientId, clinicId, type, templateData } = notificationData;

    // Convert templateData to SocketEventData format (exclude changes field as it may contain non-primitives)
    // SocketEventData only accepts primitives: string | number | boolean | null
    const socketData: Record<string, string | number | boolean | null> = {
      patientName: templateData.patientName,
      doctorName: templateData.doctorName,
      appointmentDate: templateData.appointmentDate,
      appointmentTime: templateData.appointmentTime,
      location: templateData.location,
      clinicName: templateData.clinicName,
    };

    const appointmentType = templateData['appointmentType'];
    if (appointmentType) {
      socketData['appointmentType'] = appointmentType;
    }
    const notes = templateData['notes'];
    if (notes) {
      socketData['notes'] = notes;
    }
    const rescheduleUrl = templateData['rescheduleUrl'];
    if (rescheduleUrl) {
      socketData['rescheduleUrl'] = rescheduleUrl;
    }
    const cancelUrl = templateData['cancelUrl'];
    if (cancelUrl) {
      socketData['cancelUrl'] = cancelUrl;
    }
    // Note: changes field is excluded from socket data as it may contain non-primitive values
    // Changes are only used in email/notification templates, not socket events

    // Send to patient's personal room
    // socketData contains only primitives, so it's compatible with SocketEventData
    // The 'data' field contains a Record<string, SocketEventPrimitive> which is valid
    // Type assertion needed because TypeScript needs explicit confirmation of nested Record structure
    const eventData: SocketEventData = {
      appointmentId,
      type,
      data: socketData as Record<string, SocketEventPrimitive>,
      timestamp: new Date().toISOString(),
    };
    void this.socketService.sendToUser(patientId, 'appointment_notification', eventData);

    // Send to clinic room for staff
    const clinicEventData: SocketEventData = {
      appointmentId,
      patientId,
      type,
      timestamp: new Date().toISOString(),
    };
    void this.socketService.sendToRoom(`clinic_${clinicId}`, 'appointment_update', clinicEventData);

    await this.loggingService.log(
      LogType.NOTIFICATION,
      LogLevel.INFO,
      `Socket notification sent`,
      'AppointmentNotificationService',
      {
        notificationId,
        patientId,
        clinicId,
      }
    );
  }

  /**
   * Get email subject based on notification type
   */
  private getEmailSubject(type: string, templateData: unknown): string {
    const data = templateData as Record<string, unknown>;
    const subjects = {
      reminder: `Appointment Reminder - ${data['clinicName'] as string}`,
      confirmation: `Appointment Confirmed - ${data['clinicName'] as string}`,
      cancellation: `Appointment Cancelled - ${data['clinicName'] as string}`,
      reschedule: `Appointment Rescheduled - ${data['clinicName'] as string}`,
      follow_up: `Follow-up Required - ${data['clinicName'] as string}`,
    };

    return subjects[type as keyof typeof subjects] || 'Appointment Notification';
  }

  /**
   * Get email body based on notification type
   */
  private getEmailBody(type: string, templateData: unknown): string {
    const data = templateData as Record<string, unknown>;
    const bodies = {
      reminder: `
        <h2>Appointment Reminder</h2>
        <p>Hi ${data['patientName'] as string},</p>
        <p>This is a reminder for your appointment with ${data['doctorName'] as string} on ${data['appointmentDate'] as string} at ${data['appointmentTime'] as string}.</p>
        <p>Location: ${data['location'] as string}</p>
        <p>Please arrive 15 minutes early.</p>
      `,
      confirmation: `
        <h2>Appointment Confirmed</h2>
        <p>Hi ${data['patientName'] as string},</p>
        <p>Your appointment with ${data['doctorName'] as string} has been confirmed for ${data['appointmentDate'] as string} at ${data['appointmentTime'] as string}.</p>
        <p>Location: ${data['location'] as string}</p>
      `,
    };

    return bodies[type as keyof typeof bodies] || 'Appointment notification';
  }

  /**
   * Get push notification title
   */
  private getPushTitle(type: string, templateData: unknown): string {
    const data = templateData as Record<string, unknown>;
    const titles = {
      reminder: `Appointment Reminder - ${data['clinicName'] as string}`,
      confirmation: `Appointment Confirmed`,
      cancellation: `Appointment Cancelled`,
      reschedule: `Appointment Rescheduled`,
      follow_up: `Follow-up Required`,
    };

    return titles[type as keyof typeof titles] || 'Appointment Notification';
  }

  /**
   * Get push notification body
   */
  private getPushBody(type: string, templateData: unknown): string {
    const data = templateData as Record<string, unknown>;
    const bodies = {
      reminder: `Your appointment with ${data['doctorName'] as string} is scheduled for ${data['appointmentDate'] as string} at ${data['appointmentTime'] as string}`,
      confirmation: `Your appointment with ${data['doctorName'] as string} has been confirmed`,
      cancellation: `Your appointment has been cancelled`,
      reschedule: `Your appointment has been rescheduled`,
      follow_up: `Please schedule a follow-up appointment`,
    };

    return bodies[type as keyof typeof bodies] || 'Appointment notification';
  }
}
