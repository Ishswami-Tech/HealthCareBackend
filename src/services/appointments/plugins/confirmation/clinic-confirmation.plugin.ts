import { Injectable } from '@nestjs/common';
import { BaseAppointmentPlugin } from '../base/base-plugin.service';
import { AppointmentConfirmationService } from './appointment-confirmation.service';

@Injectable()
export class ClinicConfirmationPlugin extends BaseAppointmentPlugin {
  readonly name = 'clinic-confirmation-plugin';
  readonly version = '1.0.0';
  readonly features = ['qr-generation', 'check-in', 'confirmation', 'completion'];

  constructor(
    private readonly confirmationService: AppointmentConfirmationService
  ) {
    super();
  }

  async process(data: any): Promise<any> {
    this.logPluginAction('Processing clinic confirmation operation', { operation: data.operation });
    
    // Delegate to existing confirmation service - no functionality change
    switch (data.operation) {
      case 'generateCheckInQR':
        return await this.confirmationService.generateCheckInQR(data.appointmentId, 'clinic');
      
      case 'processCheckIn':
        return await this.confirmationService.processCheckIn(data.qrData, data.appointmentId, 'clinic');
      
      case 'confirmAppointment':
        return await this.confirmationService.confirmAppointment(data.appointmentId, 'clinic');
      
      case 'markAppointmentCompleted':
        return await this.confirmationService.markAppointmentCompleted(
          data.appointmentId, 
          data.doctorId, 
          'clinic'
        );
      
      case 'generateConfirmationQR':
        return await this.confirmationService.generateConfirmationQR(data.appointmentId, 'clinic');
      
      case 'verifyAppointmentQR':
        return await this.confirmationService.verifyAppointmentQR(
          data.qrData, 
          data.clinicId, 
          'clinic'
        );
      
      case 'invalidateQRCache':
        return await this.confirmationService.invalidateQRCache(data.appointmentId);
      
      default:
        this.logPluginError('Unknown confirmation operation', { operation: data.operation });
        throw new Error(`Unknown confirmation operation: ${data.operation}`);
    }
  }

  async validate(data: any): Promise<boolean> {
    // Validate that required fields are present for each operation
    const requiredFields = {
      generateCheckInQR: ['appointmentId'],
      processCheckIn: ['qrData', 'appointmentId'],
      confirmAppointment: ['appointmentId'],
      markAppointmentCompleted: ['appointmentId', 'doctorId'],
      generateConfirmationQR: ['appointmentId'],
      verifyAppointmentQR: ['qrData', 'clinicId'],
      invalidateQRCache: ['appointmentId']
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
