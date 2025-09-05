import { Injectable } from '@nestjs/common';
import { BaseAppointmentPlugin } from '../base/base-plugin.service';
import { VideoService } from './video.service';

@Injectable()
export class ClinicVideoPlugin extends BaseAppointmentPlugin {
  readonly name = 'clinic-video-plugin';
  readonly version = '1.0.0';
  readonly features = ['video-calls', 'consultation-rooms', 'recording', 'screen-sharing', 'medical-imaging'];

  constructor(
    private readonly videoService: VideoService
  ) {
    super();
  }

  async process(data: any): Promise<any> {
    this.logPluginAction('Processing clinic video operation', { operation: data.operation });
    
    // Delegate to existing video service - no functionality change
    switch (data.operation) {
      case 'createVideoCall':
        return await this.videoService.createVideoCall(
          data.appointmentId, 
          data.patientId, 
          data.doctorId, 
          data.clinicId
        );
      
      case 'joinVideoCall':
        return await this.videoService.joinVideoCall(data.callId, data.userId);
      
      case 'endVideoCall':
        return await this.videoService.endVideoCall(data.callId, data.userId);
      
      case 'startRecording':
        return await this.videoService.startRecording(data.callId, data.userId);
      
      case 'stopRecording':
        return await this.videoService.stopRecording(data.callId, data.userId);
      
      case 'shareMedicalImage':
        return await this.videoService.shareMedicalImage(data.callId, data.userId, data.imageData);
      
      case 'getVideoCallHistory':
        return await this.videoService.getVideoCallHistory(data.userId, data.clinicId);
      
      default:
        this.logPluginError('Unknown video operation', { operation: data.operation });
        throw new Error(`Unknown video operation: ${data.operation}`);
    }
  }

  async validate(data: any): Promise<boolean> {
    // Validate that required fields are present for each operation
    const requiredFields = {
      createVideoCall: ['appointmentId', 'patientId', 'doctorId', 'clinicId'],
      joinVideoCall: ['callId', 'userId'],
      endVideoCall: ['callId', 'userId'],
      startRecording: ['callId', 'userId'],
      stopRecording: ['callId', 'userId'],
      shareMedicalImage: ['callId', 'userId', 'imageData'],
      getVideoCallHistory: ['userId']
    };

    const operation = data.operation;
    const fields = requiredFields[operation as keyof typeof requiredFields];
    
    if (!fields) {
      this.logPluginError('Invalid operation', { operation });
      return false;
    }

    const isValid = fields.every((field: string) => data[field] !== undefined);
    if (!isValid) {
      this.logPluginError('Missing required fields', { operation, requiredFields: fields });
    }

    return isValid;
  }
}
