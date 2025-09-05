import { Injectable } from '@nestjs/common';
import { BaseAppointmentPlugin } from '../base/base-plugin.service';
import { AppointmentQueueService } from './appointment-queue.service';

@Injectable()
export class ClinicQueuePlugin extends BaseAppointmentPlugin {
  readonly name = 'clinic-queue-plugin';
  readonly version = '1.0.0';
  readonly features = ['queue-management', 'priority-queues', 'emergency-handling'];

  constructor(
    private readonly queueService: AppointmentQueueService
  ) {
    super();
  }

  async process(data: any): Promise<any> {
    this.logPluginAction('Processing clinic queue operation', { operation: data.operation });
    
    // Delegate to existing queue service - no functionality change
    switch (data.operation) {
      case 'getDoctorQueue':
        return await this.queueService.getDoctorQueue(data.doctorId, data.date, 'clinic');
      
      case 'getPatientQueuePosition':
        return await this.queueService.getPatientQueuePosition(data.appointmentId, 'clinic');
      
      case 'confirmAppointment':
        return await this.queueService.confirmAppointment(data.appointmentId, 'clinic');
      
      case 'startConsultation':
        return await this.queueService.startConsultation(data.appointmentId, data.doctorId, 'clinic');
      
      case 'reorderQueue':
        return await this.queueService.reorderQueue(data.reorderData, 'clinic');
      
      case 'getLocationQueueStats':
        return await this.queueService.getLocationQueueStats(data.locationId, 'clinic');
      
      case 'getQueueMetrics':
        return await this.queueService.getQueueMetrics(data.locationId, 'clinic', data.period);
      
      case 'handleEmergencyAppointment':
        return await this.queueService.handleEmergencyAppointment(
          data.appointmentId, 
          data.priority, 
          'clinic'
        );
      
      default:
        this.logPluginError('Unknown queue operation', { operation: data.operation });
        throw new Error(`Unknown queue operation: ${data.operation}`);
    }
  }

  async validate(data: any): Promise<boolean> {
    // Validate that required fields are present for each operation
    const requiredFields = {
      getDoctorQueue: ['doctorId', 'date'],
      getPatientQueuePosition: ['appointmentId'],
      confirmAppointment: ['appointmentId'],
      startConsultation: ['appointmentId', 'doctorId'],
      reorderQueue: ['reorderData'],
      getLocationQueueStats: ['locationId'],
      getQueueMetrics: ['locationId', 'period'],
      handleEmergencyAppointment: ['appointmentId', 'priority']
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
