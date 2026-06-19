import { nowIso, formatDateKeyInIST, formatTimeInIST } from '@utils/date-time.util';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel, AppointmentStatus } from '@core/types';
import { EmailService } from '@communication/channels/email/email.service';
import { WhatsAppService } from '@communication/channels/whatsapp/whatsapp.service';
import { PushNotificationService } from '@communication/channels/push/push.service';
import { DeviceTokenService } from '@communication/channels/push/device-token.service';
import {
  SocketService,
  type SocketEventData,
  type SocketEventPrimitive,
} from '@communication/channels/socket/socket.service';
import { DatabaseService } from '@infrastructure/database';
import { EmailTemplate } from '@core/types';
import type {
  PrismaTransactionClientWithDelegates,
  PrismaDelegateArgs,
} from '@core/types/prisma.types';
import type {
  NotificationData,
  NotificationResult,
  NotificationTemplate,
} from '@core/types/appointment.types';
// Re-export types for backward compatibility
export type { NotificationData, NotificationResult, NotificationTemplate };

function resolveText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return fallback;
}

function resolveClinicDisplayName(templateData: unknown): string {
  const data = templateData as Record<string, unknown>;
  const directClinicName = resolveText(data['clinicName'] || data['clinicDisplayName'], '');
  if (directClinicName) {
    return directClinicName;
  }

  const nestedClinic = data['clinic'];
  if (nestedClinic && typeof nestedClinic === 'object' && !Array.isArray(nestedClinic)) {
    const clinicRecord = nestedClinic as Record<string, unknown>;
    const clinicName = resolveText(clinicRecord['name'] || clinicRecord['displayName'], '');
    if (clinicName) {
      return clinicName;
    }
  }

  const nestedAppointment = data['appointment'];
  if (
    nestedAppointment &&
    typeof nestedAppointment === 'object' &&
    !Array.isArray(nestedAppointment)
  ) {
    const appointmentRecord = nestedAppointment as Record<string, unknown>;
    const appointmentClinic = appointmentRecord['clinic'];
    if (
      appointmentClinic &&
      typeof appointmentClinic === 'object' &&
      !Array.isArray(appointmentClinic)
    ) {
      const clinicRecord = appointmentClinic as Record<string, unknown>;
      const clinicName = resolveText(clinicRecord['name'] || clinicRecord['displayName'], '');
      if (clinicName) {
        return clinicName;
      }
    }
    const clinicName = resolveText(appointmentRecord['clinicName'], '');
    if (clinicName) {
      return clinicName;
    }
  }

  return resolveText(data['appName'], 'Healthcare App');
}

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
    private readonly deviceTokenService: DeviceTokenService,
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
    hoursBefore: number = 0.25
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

    try {
      const now = new Date();
      const windowEnd = new Date(now.getTime() + hoursBefore * 60 * 60 * 1000);

      const appointments = await this.databaseService.findAppointmentsSafe(
        {
          clinicId,
          status: {
            in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED],
          } as never,
          date: {
            gte: now,
            lte: windowEnd,
          } as never,
        } as never,
        {
          orderBy: { date: 'asc' },
          rowLevelSecurity: false,
        }
      );

      let sent = 0;
      let failed = 0;

      for (const appointment of appointments) {
        try {
          const patientName =
            appointment.patient?.user?.name ||
            [appointment.patient?.user?.firstName, appointment.patient?.user?.lastName]
              .filter(Boolean)
              .join(' ') ||
            'Patient';
          const doctorName =
            appointment.doctor?.user?.name ||
            [appointment.doctor?.user?.firstName, appointment.doctor?.user?.lastName]
              .filter(Boolean)
              .join(' ') ||
            'Doctor';
          const clinicName = appointment.clinic?.name || 'Healthcare Clinic';
          const appointmentDate = formatDateKeyInIST(appointment.date);
          const appointmentTime = formatTimeInIST(
            appointment.time ? new Date(`1970-01-01T${appointment.time}`) : appointment.date
          );

          const result = await this.sendNotification({
            appointmentId: appointment.id,
            patientId: appointment.patientId,
            doctorId: appointment.doctorId,
            clinicId,
            type: 'reminder',
            priority: 'normal',
            channels: ['email', 'whatsapp'],
            templateData: {
              patientName,
              doctorName,
              appointmentDate,
              appointmentTime,
              location: appointment.location?.name || clinicName,
              clinicName,
              appointmentType: appointment.type || 'appointment',
            },
          });

          if (result.success) {
            sent++;
          } else {
            failed++;
          }
        } catch (error) {
          failed++;
          await this.loggingService.log(
            LogType.ERROR,
            LogLevel.ERROR,
            'Failed to send reminder notification for appointment',
            'AppointmentNotificationService.sendReminderNotifications',
            {
              clinicId,
              appointmentId: appointment.id,
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
      }

      const processed = appointments.length;
      return { processed, sent, failed };
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to send reminder notifications: ${error instanceof Error ? error.message : String(error)}`,
        'AppointmentNotificationService.sendReminderNotifications',
        {
          clinicId,
          hoursBefore,
          error: error instanceof Error ? error.stack : undefined,
        }
      );
      return { processed: 0, sent: 0, failed: 0 };
    }
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
      // Return empty array until notificationTemplate model is added
      // Using DatabaseService pattern (no direct Prisma client access)
      const templates: unknown[] = [];

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
  private async resolvePatientUserId(
    patientId: string,
    notificationId: string
  ): Promise<string | null> {
    try {
      const patient = await this.databaseService.executeHealthcareRead<{ userId: string } | null>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return (await typedClient.patient.findUnique({
            where: { id: patientId } as PrismaDelegateArgs,
            select: { userId: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs)) as { userId: string } | null;
        }
      );

      if (patient?.userId) {
        return patient.userId;
      }

      const directUser = await this.databaseService.findUserByIdSafe(patientId);
      if (directUser?.id) {
        await this.loggingService.log(
          LogType.NOTIFICATION,
          LogLevel.WARN,
          'Patient record not found, falling back to patientId as userId',
          'AppointmentNotificationService.resolvePatientUserId',
          {
            notificationId,
            patientId,
            userId: directUser.id,
          }
        );

        return directUser.id;
      }

      return null;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        'Failed to resolve patient user mapping',
        'AppointmentNotificationService.resolvePatientUserId',
        {
          notificationId,
          patientId,
          error: error instanceof Error ? error.message : String(error),
        }
      );

      return null;
    }
  }

  private async resolveDoctorUserId(
    doctorId: string,
    notificationId: string
  ): Promise<string | null> {
    try {
      const doctor = await this.databaseService.executeHealthcareRead<{ userId: string } | null>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return (await typedClient.doctor.findUnique({
            where: { id: doctorId } as PrismaDelegateArgs,
            select: { userId: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs)) as { userId: string } | null;
        }
      );

      if (doctor?.userId) {
        return doctor.userId;
      }

      const directUser = await this.databaseService.findUserByIdSafe(doctorId);
      if (directUser?.id) {
        await this.loggingService.log(
          LogType.NOTIFICATION,
          LogLevel.WARN,
          'Doctor record not found, falling back to doctorId as userId',
          'AppointmentNotificationService.resolveDoctorUserId',
          {
            notificationId,
            doctorId,
            userId: directUser.id,
          }
        );

        return directUser.id;
      }

      return null;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        'Failed to resolve doctor user mapping',
        'AppointmentNotificationService.resolveDoctorUserId',
        {
          notificationId,
          doctorId,
          error: error instanceof Error ? error.message : String(error),
        }
      );

      return null;
    }
  }

  private async sendEmailNotification(
    notificationData: NotificationData,
    notificationId: string
  ): Promise<void> {
    const { appointmentId, templateData, type, clinicId, patientId } = notificationData;

    const patientUserId = await this.resolvePatientUserId(patientId, notificationId);

    // Fetch patient email using DatabaseService helper method (follows architecture rules)
    let patientEmail: string | undefined;
    try {
      const user = patientUserId
        ? await this.databaseService.findUserByIdSafe(patientUserId)
        : null;
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
          patientUserId,
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
          patientUserId,
        }
      );
      return;
    }

    const subject = this.getEmailSubject(type, templateData);
    const body = this.getEmailBody(type, templateData);
    const emailTemplate =
      type === 'confirmation'
        ? EmailTemplate.APPOINTMENT_CONFIRMATION
        : EmailTemplate.APPOINTMENT_REMINDER;
    const appointmentType = this.normalizeAppointmentType(templateData.appointmentType);
    const detailsUrl = appointmentId
      ? this.buildAppointmentDetailsUrl(appointmentId, appointmentType)
      : undefined;

    await this.emailService.sendEmail({
      to: patientEmail,
      subject,
      template: emailTemplate,
      context: {
        patientName: templateData.patientName,
        doctorName: templateData.doctorName,
        appointmentDate: templateData.appointmentDate,
        appointmentTime: templateData.appointmentTime,
        location: templateData.location,
        clinicName: templateData.clinicName,
        appointmentType,
        appointmentId,
        detailsUrl,
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
        patientUserId,
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
    const { templateData, type, patientId, doctorId, clinicId } = notificationData;
    const [patientUserId, doctorUserId] = await Promise.all([
      this.resolvePatientUserId(patientId, notificationId),
      doctorId ? this.resolveDoctorUserId(doctorId, notificationId) : Promise.resolve(null),
    ]);

    // Fetch recipient phone numbers using DatabaseService (follows architecture rules)
    const [patientUser, doctorUser] = await Promise.all([
      patientUserId ? this.databaseService.findUserByIdSafe(patientUserId) : Promise.resolve(null),
      doctorUserId ? this.databaseService.findUserByIdSafe(doctorUserId) : Promise.resolve(null),
    ]);

    const patientPhone = patientUser?.phone || null;
    const doctorPhone = doctorUser?.phone || null;

    if (!patientPhone && !doctorPhone) {
      await this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.WARN,
        `Skipping WhatsApp notification - no phone number found`,
        'AppointmentNotificationService',
        { notificationId, patientId, patientUserId, doctorId, doctorUserId }
      );
      return;
    }

    try {
      const appointmentType = this.normalizeAppointmentType(templateData.appointmentType);
      const detailsUrl = this.buildAppointmentDetailsUrl(
        notificationData.appointmentId,
        appointmentType
      );
      const deliveryResults: Array<{ role: 'patient' | 'doctor'; phone: string }> = [];

      const sendForRecipient = async (
        role: 'patient' | 'doctor',
        phone: string | null
      ): Promise<void> => {
        if (!phone) {
          await this.loggingService.log(
            LogType.NOTIFICATION,
            LogLevel.WARN,
            `Skipping WhatsApp notification - no ${role} phone number found`,
            'AppointmentNotificationService',
            { notificationId, patientId, patientUserId, doctorId, doctorUserId }
          );
          return;
        }

        let didSend = false;
        if (type === 'confirmation' || type === 'created') {
          if (role === 'patient') {
            await this.whatsAppService.sendAppointmentConfirmation(
              phone,
              templateData.patientName,
              templateData.doctorName,
              templateData.appointmentDate,
              templateData.appointmentTime,
              templateData.location,
              clinicId,
              detailsUrl,
              appointmentType,
              role
            );
            didSend = true;
          } else if (role === 'doctor' && appointmentType === 'video') {
            const customMessage = this.buildDoctorVideoSummaryMessage(
              templateData.patientName,
              templateData.doctorName,
              templateData.appointmentDate,
              templateData.appointmentTime,
              detailsUrl,
              templateData.clinicName
            );
            await this.whatsAppService.sendCustomMessage(phone, customMessage, clinicId);
            didSend = true;
          }
        } else if (type === 'reminder' || type === 'updated') {
          if (role === 'patient') {
            await this.whatsAppService.sendAppointmentReminder(
              phone,
              templateData.patientName,
              templateData.doctorName,
              templateData.appointmentDate,
              templateData.appointmentTime,
              templateData.location,
              clinicId,
              detailsUrl,
              appointmentType
            );
            didSend = true;
          }
        }

        if (didSend) {
          deliveryResults.push({ role, phone });
        }
      };

      await sendForRecipient('patient', patientPhone);
      // Keep doctors out of per-appointment WhatsApp/email traffic.
      // Doctor-facing updates are handled via dashboard/socket and can be summarized separately.
      const shouldNotifyDoctor = false;
      if (doctorPhone && shouldNotifyDoctor) {
        await sendForRecipient('doctor', doctorPhone);
      }

      if (deliveryResults.length === 0) {
        throw new Error('No WhatsApp recipients were available for notification');
      }

      await this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.INFO,
        `WhatsApp notification sent`,
        'AppointmentNotificationService',
        {
          notificationId,
          type,
          clinicId,
          recipients: deliveryResults,
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
    const patientUserId = await this.resolvePatientUserId(patientId, notificationId);

    // Fetch patient device tokens using DeviceTokenService
    // DeviceTokenService uses in-memory storage (primary) with optional database persistence
    // This follows the architecture pattern: use service layer, not direct database access
    let deviceTokens: string[] = [];
    try {
      const tokenData = patientUserId ? this.deviceTokenService.getUserTokens(patientUserId) : [];
      deviceTokens = tokenData.map(token => token.token);
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to fetch device tokens for push notification`,
        'AppointmentNotificationService.sendPushNotification',
        {
          notificationId,
          patientId,
          patientUserId,
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
          patientUserId,
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
        patientUserId,
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
      timestamp: nowIso(),
    };
    void this.socketService.sendToUser(patientId, 'appointment_notification', eventData);

    // Send to clinic room for staff
    const clinicEventData: SocketEventData = {
      appointmentId,
      patientId,
      type,
      timestamp: nowIso(),
    };
    void this.socketService.sendToRoom(`clinic:${clinicId}`, 'appointment_update', clinicEventData);

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
    const displayName = resolveClinicDisplayName(templateData);
    const subjects = {
      reminder: `Appointment reminder from ${displayName}`,
      confirmation: `Appointment confirmed by ${displayName}`,
      cancellation: `Appointment cancellation notice from ${displayName}`,
      reschedule: `Appointment rescheduled by ${displayName}`,
      follow_up: `Follow-up required from ${displayName}`,
    };

    return subjects[type as keyof typeof subjects] || 'APPOINTMENT NOTIFICATION';
  }

  /**
   * Get email body based on notification type
   */
  private getEmailBody(type: string, templateData: unknown): string {
    const data = templateData as Record<string, unknown>;
    const displayName = resolveClinicDisplayName(templateData);
    const patientName = resolveText(data['patientName'], 'there');
    const doctorName = resolveText(data['doctorName'], 'Doctor');
    const appointmentDate = resolveText(data['appointmentDate'], 'soon');
    const appointmentTime = resolveText(data['appointmentTime'], 'TBD');
    const location = resolveText(data['location'], displayName);
    const appointmentType = this.normalizeAppointmentType(
      resolveText(data['appointmentType'], 'appointment')
    );
    const detailsUrl = resolveText(data['detailsUrl'], '');
    const cancellationReason = resolveText(data['cancellationReason'], '');
    const cancelledBy = resolveText(data['cancelledBy'], '');
    const typeLabel =
      appointmentType === 'video' ? 'video appointment' : `${appointmentType} appointment`;
    const bodies = {
      reminder: `
        <h2>Appointment Reminder</h2>
        <p>Hello ${patientName},</p>
        <p>This is a reminder for your ${typeLabel} with ${doctorName} at ${displayName}.</p>
        <p><strong>Date:</strong> ${appointmentDate}</p>
        <p><strong>Time:</strong> ${appointmentTime}</p>
        <p><strong>Location:</strong> ${location}</p>
        <p>Please arrive 15 minutes early and bring any required documents.</p>
      `,
      confirmation: `
        <h2>Appointment Confirmed</h2>
        <p>Hello ${patientName},</p>
        <p>Your ${typeLabel} with ${doctorName} at ${displayName} has been confirmed.</p>
        <p><strong>Date:</strong> ${appointmentDate}</p>
        <p><strong>Time:</strong> ${appointmentTime}</p>
        <p><strong>Location:</strong> ${location}</p>
        ${detailsUrl ? `<p><a href="${detailsUrl}">View appointment details</a></p>` : ''}
        <p>${appointmentType === 'video' ? 'Please open your appointment details in the app for the video join link.' : 'Please open your appointment details in the app for location or join link.'}</p>
      `,
      cancellation: `
        <h2>Appointment Cancelled</h2>
        <p>Hello ${patientName},</p>
        <p>Your ${typeLabel} with ${doctorName} at ${displayName} scheduled for ${appointmentDate} at ${appointmentTime} has been cancelled.</p>
        ${cancellationReason ? `<p><strong>Reason:</strong> ${cancellationReason}</p>` : ''}
        ${cancelledBy ? `<p><strong>Cancelled by:</strong> ${cancelledBy}</p>` : ''}
        ${
          appointmentType === 'video'
            ? '<p>The video consultation link for this appointment is no longer active.</p>'
            : ''
        }
        <p>Please contact the clinic if you need to reschedule or have any questions.</p>
      `,
      reschedule: `
        <h2>Appointment Rescheduled</h2>
        <p>Hello ${patientName},</p>
        <p>Your ${typeLabel} with ${doctorName} at ${displayName} has been rescheduled.</p>
        <p><strong>New Date:</strong> ${appointmentDate}</p>
        <p><strong>New Time:</strong> ${appointmentTime}</p>
        <p><strong>Location:</strong> ${location}</p>
      `,
    };

    return bodies[type as keyof typeof bodies] || 'APPOINTMENT NOTIFICATION';
  }

  /**
   * Get push notification title
   */
  private getPushTitle(type: string, templateData: unknown): string {
    const data = templateData as Record<string, unknown>;
    const displayName = resolveText(data['clinicName'] || data['appName'], 'Healthcare App');
    const titles = {
      reminder: `Appointment Reminder - ${displayName}`,
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

  private normalizeAppointmentType(appointmentType?: string): string {
    const normalized = (appointmentType || '').trim().toUpperCase();
    if (normalized === 'VIDEO_CALL' || normalized === 'VIDEO') {
      return 'video';
    }
    if (normalized === 'IN_PERSON' || normalized === 'INPERSON' || normalized === 'IN-PERSON') {
      return 'in-person';
    }
    if (normalized === 'HOME_VISIT' || normalized === 'HOME VISIT') {
      return 'home-visit';
    }
    return appointmentType?.trim() || 'in-person';
  }

  private buildAppointmentDetailsUrl(appointmentId: string, appointmentType: string): string {
    const frontendBaseUrl =
      this.configService.getEnv('FRONTEND_URL') ||
      this.configService.getEnv('NEXT_PUBLIC_APP_URL') ||
      'http://localhost:3000';
    const normalizedFrontendUrl = frontendBaseUrl.replace(/\/+$/, '');

    if (appointmentType === 'video') {
      return `${normalizedFrontendUrl}/meet/${encodeURIComponent(appointmentId)}`;
    }

    return `${normalizedFrontendUrl}/patient/appointments?appointmentId=${encodeURIComponent(appointmentId)}`;
  }

  private buildDoctorVideoSummaryMessage(
    patientName: string,
    doctorName: string,
    appointmentDate: string,
    appointmentTime: string,
    detailsUrl?: string,
    clinicName?: string
  ): string {
    const clinicLabel = resolveText(clinicName, 'Healthcare Clinic');
    const joinLink = detailsUrl ? `\nJoin link: ${detailsUrl}` : '';

    return [
      `Today's video appointment for ${doctorName}`,
      '',
      `Patient: ${patientName}`,
      `Time: ${appointmentDate} at ${appointmentTime}`,
      `Clinic: ${clinicLabel}`,
      `${joinLink}`.trim(),
    ]
      .filter(Boolean)
      .join('\n');
  }
}
