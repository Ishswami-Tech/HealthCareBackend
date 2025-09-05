import { Injectable } from '@nestjs/common';
import { BaseAppointmentPlugin } from '../base/base-plugin.service';
import { CheckInService } from './check-in.service';

@Injectable()
export class ClinicCheckInPlugin extends BaseAppointmentPlugin {
  readonly name = 'clinic-checkin-plugin';
  readonly version = '1.0.0';
  readonly features = ['check-in', 'queue-management', 'consultation-start'];

  constructor(
    private readonly checkInService: CheckInService
  ) {
    super();
  }

  async process(data: any): Promise<any> {
    this.logPluginAction('Processing clinic check-in operation', { operation: data.operation });
    
    // Delegate to existing check-in service - no functionality change
    switch (data.operation) {
      case 'checkIn':
        return await this.checkInService.checkIn(data.appointmentId, data.userId);
      
      case 'getCheckedInAppointments':
        return await this.checkInService.getCheckedInAppointments(data.clinicId);
      
      case 'processCheckIn':
        return await this.checkInService.processCheckIn(data.appointmentId, data.clinicId);
      
      case 'getPatientQueuePosition':
        return await this.checkInService.getPatientQueuePosition(data.appointmentId, data.clinicId);
      
      case 'startConsultation':
        return await this.checkInService.startConsultation(data.appointmentId, data.clinicId);
      
      case 'getDoctorActiveQueue':
        return await this.checkInService.getDoctorActiveQueue(data.doctorId, data.clinicId);
      
      case 'reorderQueue':
        return await this.checkInService.reorderQueue(data.clinicId, data.appointmentOrder);
      
      case 'getLocationQueue':
        return await this.checkInService.getLocationQueue(data.clinicId);
      
      default:
        this.logPluginError('Unknown check-in operation', { operation: data.operation });
        throw new Error(`Unknown check-in operation: ${data.operation}`);
    }
  }

  async validate(data: any): Promise<boolean> {
    // Validate that required fields are present for each operation
    const requiredFields = {
      checkIn: ['appointmentId', 'userId'],
      getCheckedInAppointments: ['clinicId'],
      processCheckIn: ['appointmentId', 'clinicId'],
      getPatientQueuePosition: ['appointmentId', 'clinicId'],
      startConsultation: ['appointmentId', 'clinicId'],
      getDoctorActiveQueue: ['doctorId', 'clinicId'],
      reorderQueue: ['clinicId', 'appointmentOrder'],
      getLocationQueue: ['clinicId']
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
