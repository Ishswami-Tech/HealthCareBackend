import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CacheService } from "../../../../libs/infrastructure/cache";
import { LoggingService } from "../../../../libs/infrastructure/logging/logging.service";
import { EmailService } from "../../../../libs/communication/messaging/email/email.service";
import { WhatsAppService } from "../../../../libs/communication/messaging/whatsapp/whatsapp.service";
import { PushNotificationService } from "../../../../libs/communication/messaging/push/push.service";
import { SocketService } from "../../../../libs/communication/socket/socket.service";
import { PrismaService } from "../../../../libs/infrastructure/database/prisma/prisma.service";

export interface NotificationData {
  appointmentId: string;
  patientId: string;
  doctorId: string;
  clinicId: string;
  type:
    | "reminder"
    | "confirmation"
    | "cancellation"
    | "reschedule"
    | "follow_up";
  scheduledFor?: Date;
  priority: "low" | "normal" | "high" | "urgent";
  channels: ("email" | "sms" | "whatsapp" | "push" | "socket")[];
  templateData: {
    patientName: string;
    doctorName: string;
    appointmentDate: string;
    appointmentTime: string;
    location: string;
    clinicName: string;
    appointmentType?: string;
    notes?: string;
    rescheduleUrl?: string;
    cancelUrl?: string;
  };
}

export interface NotificationResult {
  success: boolean;
  notificationId: string;
  sentChannels: string[];
  failedChannels: string[];
  errors?: string[];
  scheduledFor?: Date;
}

export interface NotificationTemplate {
  id: string;
  name: string;
  type: string;
  channels: string[];
  subject: string;
  body: string;
  variables: string[];
  isActive: boolean;
}

@Injectable()
export class AppointmentNotificationService {
  private readonly logger = new Logger(AppointmentNotificationService.name);
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
    private readonly prismaService: PrismaService,
  ) {}

  /**
   * Send appointment notification through multiple channels
   */
  async sendNotification(
    notificationData: NotificationData,
  ): Promise<NotificationResult> {
    const notificationId = `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const sentChannels: string[] = [];
    const failedChannels: string[] = [];
    const errors: string[] = [];

    this.logger.log(`Sending appointment notification ${notificationId}`, {
      appointmentId: notificationData.appointmentId,
      type: notificationData.type,
      channels: notificationData.channels,
    });

    // Process each notification channel
    for (const channel of notificationData.channels) {
      try {
        await this.sendViaChannel(channel, notificationData, notificationId);
        sentChannels.push(channel);
        this.logger.log(`Notification sent via ${channel}`, { notificationId });
      } catch (_error) {
        failedChannels.push(channel);
        const errorMessage =
          _error instanceof Error ? _error.message : "Unknown error";
        errors.push(`${channel}: ${errorMessage}`);
        this.logger.error(`Failed to send notification via ${channel}`, {
          notificationId,
          error: errorMessage,
        });
      }
    }

    // Log the notification attempt
    await this.loggingService.log(
      "NOTIFICATION_SENT" as any,
      "INFO" as any,
      `Appointment notification ${notificationData.type} sent`,
      "AppointmentNotificationService.sendNotification",
      {
        notificationId,
        appointmentId: notificationData.appointmentId,
        sentChannels,
        failedChannels,
        errors,
      },
    );

    return {
      success: sentChannels.length > 0,
      notificationId,
      sentChannels,
      failedChannels,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Schedule a notification for future delivery
   */
  async scheduleNotification(
    notificationData: NotificationData,
    scheduledFor: Date,
  ): Promise<NotificationResult> {
    const notificationId = `scheduled_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    this.logger.log(`Scheduling notification ${notificationId}`, {
      appointmentId: notificationData.appointmentId,
      scheduledFor,
    });

    // Store scheduled notification in cache
    const cacheKey = `scheduled_notification:${notificationId}`;
    await this.cacheService.set(
      cacheKey,
      {
        ...notificationData,
        notificationId,
        scheduledFor,
      },
      Math.floor((scheduledFor.getTime() - Date.now()) / 1000),
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
    hoursBefore: number = 24,
  ): Promise<{ processed: number; sent: number; failed: number }> {
    this.logger.log(`Sending reminder notifications for clinic ${clinicId}`, {
      hoursBefore,
    });

    // This would typically query the database for upcoming appointments
    // For now, we'll return a mock response
    const processed = 0;
    const sent = 0;
    const failed = 0;

    return { processed, sent, failed };
  }

  /**
   * Get notification templates
   */
  async getNotificationTemplates(
    clinicId: string,
    type?: string,
  ): Promise<NotificationTemplate[]> {
    const cacheKey = `notification_templates:${type || "all"}`;

    try {
      const cached = await this.cacheService.get(cacheKey);
      if (cached && Array.isArray(cached)) {
        return cached as NotificationTemplate[];
      }

      // Get templates from database
      const templates = await this.prismaService.notificationTemplate.findMany({
        where: {
          clinicId,
          isActive: true,
        },
        orderBy: {
          name: "asc",
        },
      });

      const templateList: NotificationTemplate[] = templates.map(
        (template: unknown) => {
          const templateData = template as Record<string, unknown>;
          return {
            id: templateData.id as string,
            name: templateData.name as string,
            type: templateData.type as string,
            channels: templateData.channels as string[],
            subject: templateData.subject as string,
            body: templateData.body as string,
            variables: templateData.variables as string[],
            isActive: templateData.isActive as boolean,
          };
        },
      );

      await this.cacheService.set(
        cacheKey,
        templateList,
        this.TEMPLATE_CACHE_TTL,
      );
      return templateList;
    } catch (_error) {
      this.logger.error("Failed to get notification templates", {
        error: _error instanceof Error ? _error.message : "Unknown error",
      });
      return [];
    }
  }

  /**
   * Send notification via specific channel
   */
  private async sendViaChannel(
    channel: string,
    notificationData: NotificationData,
    notificationId: string,
  ): Promise<void> {
    const { templateData, type } = notificationData;

    switch (channel) {
      case "email":
        await this.sendEmailNotification(notificationData, notificationId);
        break;

      case "whatsapp":
        await this.sendWhatsAppNotification(notificationData, notificationId);
        break;

      case "push":
        await this.sendPushNotification(notificationData, notificationId);
        break;

      case "socket":
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
    notificationId: string,
  ): Promise<void> {
    const { templateData, type } = notificationData;

    // Get patient email from notificationData or fetch from database
    const patientEmail = "patient@example.com"; // This should be fetched from user data

    const subject = this.getEmailSubject(type, templateData);
    const body = this.getEmailBody(type, templateData);

    await this.emailService.sendEmail({
      to: patientEmail,
      subject,
      template: "APPOINTMENT_REMINDER" as any,
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
    });

    this.logger.log(`Email notification sent`, {
      notificationId,
      patientEmail,
    });
  }

  /**
   * Send WhatsApp notification
   */
  private async sendWhatsAppNotification(
    notificationData: NotificationData,
    notificationId: string,
  ): Promise<void> {
    const { templateData, type } = notificationData;

    // Get patient phone from notificationData or fetch from database
    const patientPhone = "+1234567890"; // This should be fetched from user data

    if (type === "reminder") {
      await this.whatsAppService.sendAppointmentReminder(
        patientPhone,
        templateData.patientName,
        templateData.doctorName,
        templateData.appointmentDate,
        templateData.appointmentTime,
        templateData.location,
      );
    }

    this.logger.log(`WhatsApp notification sent`, {
      notificationId,
      patientPhone,
    });
  }

  /**
   * Send push notification
   */
  private async sendPushNotification(
    notificationData: NotificationData,
    notificationId: string,
  ): Promise<void> {
    const { templateData, type } = notificationData;

    // Get patient device tokens from notificationData or fetch from database
    const deviceTokens = ["device_token_1", "device_token_2"]; // This should be fetched from user data

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

    this.logger.log(`Push notification sent`, {
      notificationId,
      deviceTokens: deviceTokens.length,
    });
  }

  /**
   * Send socket notification
   */
  private async sendSocketNotification(
    notificationData: NotificationData,
    notificationId: string,
  ): Promise<void> {
    const { appointmentId, patientId, clinicId, type, templateData } =
      notificationData;

    // Send to patient's personal room
    this.socketService.sendToUser(patientId, "appointment_notification", {
      appointmentId,
      type,
      data: templateData,
      timestamp: new Date().toISOString(),
    });

    // Send to clinic room for staff
    this.socketService.sendToRoom(`clinic_${clinicId}`, "appointment_update", {
      appointmentId,
      patientId,
      type,
      timestamp: new Date().toISOString(),
    });

    this.logger.log(`Socket notification sent`, {
      notificationId,
      patientId,
      clinicId,
    });
  }

  /**
   * Get email subject based on notification type
   */
  private getEmailSubject(type: string, templateData: unknown): string {
    const data = templateData as Record<string, unknown>;
    const subjects = {
      reminder: `Appointment Reminder - ${data.clinicName as string}`,
      confirmation: `Appointment Confirmed - ${data.clinicName as string}`,
      cancellation: `Appointment Cancelled - ${data.clinicName as string}`,
      reschedule: `Appointment Rescheduled - ${data.clinicName as string}`,
      follow_up: `Follow-up Required - ${data.clinicName as string}`,
    };

    return (
      subjects[type as keyof typeof subjects] || "Appointment Notification"
    );
  }

  /**
   * Get email body based on notification type
   */
  private getEmailBody(type: string, templateData: unknown): string {
    const data = templateData as Record<string, unknown>;
    const bodies = {
      reminder: `
        <h2>Appointment Reminder</h2>
        <p>Hi ${data.patientName as string},</p>
        <p>This is a reminder for your appointment with ${data.doctorName as string} on ${data.appointmentDate as string} at ${data.appointmentTime as string}.</p>
        <p>Location: ${data.location as string}</p>
        <p>Please arrive 15 minutes early.</p>
      `,
      confirmation: `
        <h2>Appointment Confirmed</h2>
        <p>Hi ${data.patientName as string},</p>
        <p>Your appointment with ${data.doctorName as string} has been confirmed for ${data.appointmentDate as string} at ${data.appointmentTime as string}.</p>
        <p>Location: ${data.location as string}</p>
      `,
    };

    return bodies[type as keyof typeof bodies] || "Appointment notification";
  }

  /**
   * Get push notification title
   */
  private getPushTitle(type: string, templateData: unknown): string {
    const data = templateData as Record<string, unknown>;
    const titles = {
      reminder: `Appointment Reminder - ${data.clinicName as string}`,
      confirmation: `Appointment Confirmed`,
      cancellation: `Appointment Cancelled`,
      reschedule: `Appointment Rescheduled`,
      follow_up: `Follow-up Required`,
    };

    return titles[type as keyof typeof titles] || "Appointment Notification";
  }

  /**
   * Get push notification body
   */
  private getPushBody(type: string, templateData: unknown): string {
    const data = templateData as Record<string, unknown>;
    const bodies = {
      reminder: `Your appointment with ${data.doctorName as string} is scheduled for ${data.appointmentDate as string} at ${data.appointmentTime as string}`,
      confirmation: `Your appointment with ${data.doctorName as string} has been confirmed`,
      cancellation: `Your appointment has been cancelled`,
      reschedule: `Your appointment has been rescheduled`,
      follow_up: `Please schedule a follow-up appointment`,
    };

    return bodies[type as keyof typeof bodies] || "Appointment notification";
  }
}
