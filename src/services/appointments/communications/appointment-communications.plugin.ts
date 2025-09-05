import { Injectable } from '@nestjs/common';
import { BaseAppointmentPlugin } from '../plugins/base/base-plugin.service';
import { AppointmentCommunicationsService } from './appointment-communications.service';

@Injectable()
export class AppointmentCommunicationsPlugin extends BaseAppointmentPlugin {
  readonly name = 'appointment-communications-plugin';
  readonly version = '1.0.0';
  readonly features = ['real-time-updates', 'queue-notifications', 'appointment-status', 'video-calls', 'notifications'];

  constructor(
    private readonly communicationsService: AppointmentCommunicationsService
  ) {
    super();
  }

  async process(data: any): Promise<any> {
    this.logPluginAction('Processing appointment communications operation', { operation: data.operation });
    
    // Delegate to communications service - proper separation of concerns
    switch (data.operation) {
      case 'sendQueueUpdate':
        return await this.communicationsService.sendQueueUpdate(
          data.clinicId,
          data.doctorId,
          data.queueData
        );
      
      case 'sendAppointmentStatusUpdate':
        return await this.communicationsService.sendAppointmentStatusUpdate(
          data.appointmentId,
          data.clinicId,
          data.userId,
          data.statusData
        );
      
      case 'sendVideoCallNotification':
        return await this.communicationsService.sendVideoCallNotification(
          data.appointmentId,
          data.clinicId,
          data.patientId,
          data.doctorId,
          data.callData
        );
      
      case 'sendNotification':
        return await this.communicationsService.sendNotification(
          data.userId,
          data.clinicId,
          data.notificationData
        );
      
      case 'getActiveConnections':
        return await this.communicationsService.getActiveConnections(data.clinicId);
      
      case 'joinAppointmentRoom':
        return await this.communicationsService.joinAppointmentRoom(
          data.userId,
          data.appointmentId,
          data.clinicId
        );
      
      case 'leaveAppointmentRoom':
        return await this.communicationsService.leaveAppointmentRoom(
          data.userId,
          data.appointmentId
        );
      
      default:
        this.logPluginError('Unknown communications operation', { operation: data.operation });
        throw new Error(`Unknown communications operation: ${data.operation}`);
    }
  }

  async validate(data: any): Promise<boolean> {
    // Validate that required fields are present for each operation
    const requiredFields = {
      sendQueueUpdate: ['clinicId', 'doctorId', 'queueData'],
      sendAppointmentStatusUpdate: ['appointmentId', 'clinicId', 'userId', 'statusData'],
      sendVideoCallNotification: ['appointmentId', 'clinicId', 'patientId', 'doctorId', 'callData'],
      sendNotification: ['userId', 'clinicId', 'notificationData'],
      getActiveConnections: ['clinicId'],
      joinAppointmentRoom: ['userId', 'appointmentId', 'clinicId'],
      leaveAppointmentRoom: ['userId', 'appointmentId']
    };

    const operation = data.operation;
    const fields = (requiredFields as any)[operation];
    
    if (!fields) {
      this.logPluginError('Invalid operation', { operation });
      return false;
    }

    const isValid = fields.every((field: any) => data[field] !== undefined);
    if (!isValid) {
      this.logPluginError('Missing required fields', { operation, requiredFields: fields });
    }

    return isValid;
  }
}
