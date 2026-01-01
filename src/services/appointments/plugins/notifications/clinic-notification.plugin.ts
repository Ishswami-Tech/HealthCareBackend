import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { BaseAppointmentPlugin } from '@services/appointments/plugins/base/base-plugin.service';
import { AppointmentNotificationService } from './appointment-notification.service';
import { LoggingService } from '@infrastructure/logging';
import type { NotificationData } from '@core/types/appointment.types';

interface NotificationPluginData {
  operation: string;
  notificationData?: NotificationData;
  scheduledFor?: Date;
  clinicId?: string;
  hoursBefore?: number;
  type?: string;
  appointmentId?: string;
  patientId?: string;
  doctorId?: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  channels?: ('email' | 'sms' | 'whatsapp' | 'push' | 'socket')[];
  patientName?: string;
  doctorName?: string;
  appointmentDate?: string;
  appointmentTime?: string;
  location?: string;
  clinicName?: string;
  appointmentType?: string;
  notes?: string;
  rescheduleUrl?: string;
}

@Injectable()
export class ClinicNotificationPlugin extends BaseAppointmentPlugin {
  readonly name = 'clinic-notification-plugin';
  readonly version = '1.0.0';
  readonly features = [
    'notification-scheduling',
    'multi-channel-notifications',
    'notification-templates',
    'notification-analytics',
  ];

  constructor(
    private readonly notificationService: AppointmentNotificationService,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    loggingService?: LoggingService
  ) {
    super(loggingService);
  }

  async process(data: unknown): Promise<unknown> {
    const pluginData = data as NotificationPluginData;
    await this.logPluginAction('Processing clinic notification operation', {
      operation: pluginData.operation,
    });

    switch (pluginData.operation) {
      case 'sendNotification':
        if (!pluginData.notificationData) {
          throw new Error('Missing required field notificationData for sendNotification');
        }
        return await this.notificationService.sendNotification(pluginData.notificationData);

      case 'scheduleNotification':
        if (!pluginData.notificationData || !pluginData.scheduledFor) {
          throw new Error('Missing required fields for scheduleNotification');
        }
        return await this.notificationService.scheduleNotification(
          pluginData.notificationData,
          pluginData.scheduledFor
        );

      case 'sendReminderNotifications':
        if (!pluginData.clinicId) {
          throw new Error('Missing required field clinicId for sendReminderNotifications');
        }
        return await this.notificationService.sendReminderNotifications(
          pluginData.clinicId,
          pluginData.hoursBefore
        );

      case 'getNotificationTemplates':
        if (!pluginData.clinicId) {
          throw new Error('Missing required field clinicId for getNotificationTemplates');
        }
        return await this.notificationService.getNotificationTemplates(
          pluginData.clinicId,
          pluginData.type
        );

      case 'sendAppointmentConfirmation':
        return await this.sendAppointmentConfirmation(data);

      case 'sendAppointmentCancellation':
        return await this.sendAppointmentCancellation(data);

      case 'sendAppointmentReschedule':
        return await this.sendAppointmentReschedule(data);

      case 'send_appointment_created':
      case 'sendAppointmentCreated':
        return await this.sendAppointmentCreated(data);

      case 'send_appointment_updated':
      case 'sendAppointmentUpdated':
        return await this.sendAppointmentUpdated(data);

      case 'send_appointment_cancelled':
      case 'sendAppointmentCancelled':
        return await this.sendAppointmentCancellation(data);

      default:
        await this.logPluginError('Unknown notification operation', {
          operation: pluginData.operation,
        });
        throw new Error(`Unknown notification operation: ${pluginData.operation}`);
    }
  }

  async validate(data: unknown): Promise<boolean> {
    const pluginData = data as NotificationPluginData;
    const requiredFields: Record<string, string[]> = {
      sendNotification: ['notificationData'],
      scheduleNotification: ['notificationData', 'scheduledFor'],
      sendReminderNotifications: ['clinicId'],
      getNotificationTemplates: ['clinicId'],
      sendAppointmentConfirmation: ['appointmentId', 'patientId', 'doctorId', 'clinicId'],
      sendAppointmentCancellation: ['appointmentId', 'patientId', 'doctorId', 'clinicId'],
      sendAppointmentReschedule: ['appointmentId', 'patientId', 'doctorId', 'clinicId'],
      send_appointment_created: ['appointmentId', 'patientId', 'doctorId', 'clinicId'],
      sendAppointmentCreated: ['appointmentId', 'patientId', 'doctorId', 'clinicId'],
      send_appointment_updated: ['appointmentId', 'patientId', 'doctorId', 'clinicId'],
      sendAppointmentUpdated: ['appointmentId', 'patientId', 'doctorId', 'clinicId'],
      send_appointment_cancelled: ['appointmentId', 'patientId', 'doctorId', 'clinicId'],
      sendAppointmentCancelled: ['appointmentId', 'patientId', 'doctorId', 'clinicId'],
    };

    const operation = pluginData.operation;
    const required = requiredFields[operation];

    if (!required) {
      await this.logPluginError('Unknown operation for validation', { operation });
      return Promise.resolve(false);
    }

    for (const field of required) {
      const fieldValue = (pluginData as unknown as Record<string, unknown>)[field];
      if (!fieldValue) {
        await this.logPluginError(`Missing required field: ${field}`, {
          operation,
          field,
        });
        return Promise.resolve(false);
      }
    }

    return Promise.resolve(true);
  }

  /**
   * Send appointment confirmation notification
   */
  private async sendAppointmentConfirmation(data: unknown): Promise<unknown> {
    const pluginData = data as NotificationPluginData;
    if (
      !pluginData.appointmentId ||
      !pluginData.patientId ||
      !pluginData.doctorId ||
      !pluginData.clinicId
    ) {
      throw new Error('Missing required fields for sendAppointmentConfirmation');
    }
    const notificationData: NotificationData = {
      appointmentId: pluginData.appointmentId,
      patientId: pluginData.patientId,
      doctorId: pluginData.doctorId,
      clinicId: pluginData.clinicId,
      type: 'confirmation',
      priority: pluginData.priority || 'normal',
      channels: pluginData.channels || ['email', 'whatsapp', 'push'],
      templateData: {
        patientName: pluginData.patientName || 'Patient',
        doctorName: pluginData.doctorName || 'Doctor',
        appointmentDate: (pluginData.appointmentDate ||
          new Date().toISOString().split('T')[0]) as string,
        appointmentTime: pluginData.appointmentTime || '10:00',
        location: pluginData.location || 'Clinic',
        clinicName: pluginData.clinicName || 'Healthcare Clinic',
        appointmentType: pluginData.appointmentType || '',
        notes: pluginData.notes || '',
      },
    };

    return await this.notificationService.sendNotification(notificationData);
  }

  /**
   * Send appointment cancellation notification
   */
  private async sendAppointmentCancellation(data: unknown): Promise<unknown> {
    const pluginData = data as NotificationPluginData;
    if (
      !pluginData.appointmentId ||
      !pluginData.patientId ||
      !pluginData.doctorId ||
      !pluginData.clinicId
    ) {
      throw new Error('Missing required fields for sendAppointmentCancellation');
    }
    const notificationData: NotificationData = {
      appointmentId: pluginData.appointmentId,
      patientId: pluginData.patientId,
      doctorId: pluginData.doctorId,
      clinicId: pluginData.clinicId,
      type: 'cancellation',
      priority: pluginData.priority || 'high',
      channels: pluginData.channels || ['email', 'whatsapp', 'push', 'socket'],
      templateData: {
        patientName: pluginData.patientName || 'Patient',
        doctorName: pluginData.doctorName || 'Doctor',
        appointmentDate: (pluginData.appointmentDate ||
          new Date().toISOString().split('T')[0]) as string,
        appointmentTime: pluginData.appointmentTime || '10:00',
        location: pluginData.location || 'Clinic',
        clinicName: pluginData.clinicName || 'Healthcare Clinic',
        appointmentType: pluginData.appointmentType || '',
        notes: pluginData.notes || '',
      },
    };

    return await this.notificationService.sendNotification(notificationData);
  }

  /**
   * Send appointment reschedule notification
   */
  private async sendAppointmentReschedule(data: unknown): Promise<unknown> {
    const pluginData = data as NotificationPluginData;
    if (
      !pluginData.appointmentId ||
      !pluginData.patientId ||
      !pluginData.doctorId ||
      !pluginData.clinicId
    ) {
      throw new Error('Missing required fields for sendAppointmentReschedule');
    }
    const notificationData: NotificationData = {
      appointmentId: pluginData.appointmentId,
      patientId: pluginData.patientId,
      doctorId: pluginData.doctorId,
      clinicId: pluginData.clinicId,
      type: 'reschedule',
      priority: pluginData.priority || 'normal',
      channels: pluginData.channels || ['email', 'whatsapp', 'push'],
      templateData: {
        patientName: pluginData.patientName || 'Patient',
        doctorName: pluginData.doctorName || 'Doctor',
        appointmentDate: (pluginData.appointmentDate ||
          new Date().toISOString().split('T')[0]) as string,
        appointmentTime: pluginData.appointmentTime || '10:00',
        location: pluginData.location || 'Clinic',
        clinicName: pluginData.clinicName || 'Healthcare Clinic',
        appointmentType: pluginData.appointmentType || '',
        notes: pluginData.notes || '',
        rescheduleUrl: pluginData.rescheduleUrl || '',
      },
    };

    return await this.notificationService.sendNotification(notificationData);
  }

  /**
   * Send appointment created notification
   */
  private async sendAppointmentCreated(data: unknown): Promise<unknown> {
    const pluginData = data as NotificationPluginData;
    if (
      !pluginData.appointmentId ||
      !pluginData.patientId ||
      !pluginData.doctorId ||
      !pluginData.clinicId
    ) {
      throw new Error('Missing required fields for sendAppointmentCreated');
    }
    const notificationData: NotificationData = {
      appointmentId: pluginData.appointmentId,
      patientId: pluginData.patientId,
      doctorId: pluginData.doctorId,
      clinicId: pluginData.clinicId,
      type: 'created',
      priority: pluginData.priority || 'normal',
      channels: pluginData.channels || ['email', 'whatsapp', 'push', 'socket'],
      templateData: {
        patientName: pluginData.patientName || 'Patient',
        doctorName: pluginData.doctorName || 'Doctor',
        appointmentDate: (pluginData.appointmentDate ||
          new Date().toISOString().split('T')[0]) as string,
        appointmentTime: pluginData.appointmentTime || '10:00',
        location: pluginData.location || 'Clinic',
        clinicName: pluginData.clinicName || 'Healthcare Clinic',
        appointmentType: pluginData.appointmentType || '',
        notes: pluginData.notes || '',
      },
    };

    return await this.notificationService.sendNotification(notificationData);
  }

  /**
   * Send appointment updated notification
   */
  private async sendAppointmentUpdated(data: unknown): Promise<unknown> {
    const pluginData = data as NotificationPluginData & { changes?: unknown };
    if (
      !pluginData.appointmentId ||
      !pluginData.patientId ||
      !pluginData.doctorId ||
      !pluginData.clinicId
    ) {
      throw new Error('Missing required fields for sendAppointmentUpdated');
    }
    const notificationData: NotificationData = {
      appointmentId: pluginData.appointmentId,
      patientId: pluginData.patientId,
      doctorId: pluginData.doctorId,
      clinicId: pluginData.clinicId,
      type: 'updated',
      priority: pluginData.priority || 'normal',
      channels: pluginData.channels || ['email', 'whatsapp', 'push', 'socket'],
      templateData: {
        patientName: pluginData.patientName || 'Patient',
        doctorName: pluginData.doctorName || 'Doctor',
        appointmentDate: (pluginData.appointmentDate ||
          new Date().toISOString().split('T')[0]) as string,
        appointmentTime: pluginData.appointmentTime || '10:00',
        location: pluginData.location || 'Clinic',
        clinicName: pluginData.clinicName || 'Healthcare Clinic',
        appointmentType: pluginData.appointmentType || '',
        notes: pluginData.notes || '',
        changes: (pluginData.changes || {}) as Record<string, unknown>,
      },
    };

    return await this.notificationService.sendNotification(notificationData);
  }
}
