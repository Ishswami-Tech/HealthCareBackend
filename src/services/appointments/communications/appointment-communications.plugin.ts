import { Injectable } from '@nestjs/common';
import { BaseAppointmentPlugin } from '@services/appointments/plugins/base/base-plugin.service';
import { AppointmentCommunicationsService } from './appointment-communications.service';
import type { QueueUpdateMessage, AppointmentStatusMessage } from '@core/types/appointment.types';

interface SimpleNotificationData {
  title: string;
  message: string;
  type: 'info' | 'warning' | 'success' | 'error';
  appointmentId?: string;
}

interface CommunicationsPluginData {
  operation: string;
  clinicId?: string;
  doctorId?: string;
  queueData?: QueueUpdateMessage;
  appointmentId?: string;
  userId?: string;
  statusData?: AppointmentStatusMessage;
  patientId?: string;
  callData?: unknown;
  notificationData?: SimpleNotificationData;
}

@Injectable()
export class AppointmentCommunicationsPlugin extends BaseAppointmentPlugin {
  readonly name = 'appointment-communications-plugin';
  readonly version = '1.0.0';
  readonly features = [
    'real-time-updates',
    'queue-notifications',
    'appointment-status',
    'video-calls',
    'notifications',
  ];

  constructor(private readonly communicationsService: AppointmentCommunicationsService) {
    super();
  }

  async process(data: unknown): Promise<unknown> {
    const pluginData = data as CommunicationsPluginData;
    await this.logPluginAction('Processing appointment communications operation', {
      operation: pluginData.operation,
    });

    // Delegate to communications service - proper separation of concerns
    switch (pluginData.operation) {
      case 'sendQueueUpdate':
        if (!pluginData.clinicId || !pluginData.doctorId || !pluginData.queueData) {
          throw new Error('Missing required fields for sendQueueUpdate');
        }
        return await this.communicationsService.sendQueueUpdate(
          pluginData.clinicId,
          pluginData.doctorId,
          pluginData.queueData
        );

      case 'sendAppointmentStatusUpdate':
        if (
          !pluginData.appointmentId ||
          !pluginData.clinicId ||
          !pluginData.userId ||
          !pluginData.statusData
        ) {
          throw new Error('Missing required fields for sendAppointmentStatusUpdate');
        }
        return await this.communicationsService.sendAppointmentStatusUpdate(
          pluginData.appointmentId,
          pluginData.clinicId,
          pluginData.userId,
          pluginData.statusData
        );

      case 'sendVideoCallNotification':
        if (
          !pluginData.appointmentId ||
          !pluginData.clinicId ||
          !pluginData.patientId ||
          !pluginData.doctorId ||
          !pluginData.callData
        ) {
          throw new Error('Missing required fields for sendVideoCallNotification');
        }
        return await this.communicationsService.sendVideoCallNotification(
          pluginData.appointmentId,
          pluginData.clinicId,
          pluginData.patientId,
          pluginData.doctorId,
          pluginData.callData
        );

      case 'sendNotification': {
        if (!pluginData.userId || !pluginData.clinicId || !pluginData.notificationData) {
          throw new Error('Missing required fields for sendNotification');
        }
        const notificationData = pluginData.notificationData;
        if (!notificationData.title || !notificationData.message || !notificationData.type) {
          throw new Error(
            'Invalid notificationData: missing required fields (title, message, type)'
          );
        }
        return await this.communicationsService.sendNotification(
          pluginData.userId,
          pluginData.clinicId,
          notificationData
        );
      }

      case 'getActiveConnections':
        if (!pluginData.clinicId) {
          throw new Error('Missing required field clinicId for getActiveConnections');
        }
        return await this.communicationsService.getActiveConnections(pluginData.clinicId);

      case 'joinAppointmentRoom':
        if (!pluginData.userId || !pluginData.appointmentId || !pluginData.clinicId) {
          throw new Error('Missing required fields for joinAppointmentRoom');
        }
        return await this.communicationsService.joinAppointmentRoom(
          pluginData.userId,
          pluginData.appointmentId,
          pluginData.clinicId
        );

      case 'leaveAppointmentRoom':
        if (!pluginData.userId || !pluginData.appointmentId) {
          throw new Error('Missing required fields for leaveAppointmentRoom');
        }
        return await this.communicationsService.leaveAppointmentRoom(
          pluginData.userId,
          pluginData.appointmentId
        );

      default:
        await this.logPluginError('Unknown communications operation', {
          operation: pluginData.operation,
        });
        throw new Error(`Unknown communications operation: ${pluginData.operation}`);
    }
  }

  validate(data: unknown): Promise<boolean> {
    const pluginData = data as CommunicationsPluginData;
    // Validate that required fields are present for each operation
    const requiredFields: Record<string, string[]> = {
      sendQueueUpdate: ['clinicId', 'doctorId', 'queueData'],
      sendAppointmentStatusUpdate: ['appointmentId', 'clinicId', 'userId', 'statusData'],
      sendVideoCallNotification: ['appointmentId', 'clinicId', 'patientId', 'doctorId', 'callData'],
      sendNotification: ['userId', 'clinicId', 'notificationData'],
      getActiveConnections: ['clinicId'],
      joinAppointmentRoom: ['userId', 'appointmentId', 'clinicId'],
      leaveAppointmentRoom: ['userId', 'appointmentId'],
    };

    const operation = pluginData.operation;
    const fields = requiredFields[operation];

    if (!fields) {
      void this.logPluginError('Invalid operation', { operation });
      return Promise.resolve(false);
    }

    const isValid = fields.every((field: unknown) => {
      const fieldName = field as string;
      return (
        fieldName in pluginData &&
        pluginData[fieldName as keyof CommunicationsPluginData] !== undefined
      );
    });
    if (!isValid) {
      void this.logPluginError('Missing required fields', {
        operation,
        requiredFields: fields,
      });
    }

    return Promise.resolve(isValid);
  }
}
