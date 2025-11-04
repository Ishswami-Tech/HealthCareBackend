import { Injectable } from '@nestjs/common';
import { BaseAppointmentPlugin } from '../base/base-plugin.service';
import { CheckInService } from './check-in.service';

@Injectable()
export class ClinicCheckInPlugin extends BaseAppointmentPlugin {
  readonly name = 'clinic-checkin-plugin';
  readonly version = '1.0.0';
  readonly features = ['check-in', 'queue-management', 'consultation-start'];

  constructor(private readonly checkInService: CheckInService) {
    super();
  }

  async process(data: unknown): Promise<unknown> {
    const pluginData = data as any;
    this.logPluginAction('Processing clinic check-in operation', {
      operation: pluginData.operation,
    });

    // Delegate to existing check-in service - no functionality change
    switch (pluginData.operation) {
      case 'checkIn':
        return await this.checkInService.checkIn(pluginData.appointmentId, pluginData.userId);

      case 'getCheckedInAppointments':
        return await this.checkInService.getCheckedInAppointments(pluginData.clinicId);

      case 'processCheckIn':
        return await this.checkInService.processCheckIn(
          pluginData.appointmentId,
          pluginData.clinicId
        );

      case 'getPatientQueuePosition':
        return await this.checkInService.getPatientQueuePosition(
          pluginData.appointmentId,
          pluginData.clinicId
        );

      case 'startConsultation':
        return await this.checkInService.startConsultation(
          pluginData.appointmentId,
          pluginData.clinicId
        );

      case 'getDoctorActiveQueue':
        return await this.checkInService.getDoctorActiveQueue(
          pluginData.doctorId,
          pluginData.clinicId
        );

      case 'reorderQueue':
        return await this.checkInService.reorderQueue(
          pluginData.clinicId,
          pluginData.appointmentOrder
        );

      case 'getLocationQueue':
        return await this.checkInService.getLocationQueue(pluginData.clinicId);

      // NEW AYURVEDIC OPERATIONS
      case 'processAyurvedicCheckIn':
        return await this.checkInService.processAyurvedicCheckIn(
          pluginData.appointmentId,
          pluginData.clinicId,
          pluginData.checkInData
        );

      case 'getTherapyQueue':
        return await this.checkInService.getTherapyQueue(
          pluginData.therapyType,
          pluginData.clinicId
        );

      default:
        this.logPluginError('Unknown check-in operation', {
          operation: pluginData.operation,
        });
        throw new Error(`Unknown check-in operation: ${pluginData.operation}`);
    }
  }

  validate(data: unknown): Promise<boolean> {
    const pluginData = data as any;
    // Validate that required fields are present for each operation
    const requiredFields = {
      checkIn: ['appointmentId', 'userId'],
      getCheckedInAppointments: ['clinicId'],
      processCheckIn: ['appointmentId', 'clinicId'],
      getPatientQueuePosition: ['appointmentId', 'clinicId'],
      startConsultation: ['appointmentId', 'clinicId'],
      getDoctorActiveQueue: ['doctorId', 'clinicId'],
      reorderQueue: ['clinicId', 'appointmentOrder'],
      getLocationQueue: ['clinicId'],
      // NEW AYURVEDIC FIELDS
      processAyurvedicCheckIn: ['appointmentId', 'clinicId', 'checkInData'],
      getTherapyQueue: ['therapyType', 'clinicId'],
    };

    const operation = pluginData.operation;
    const fields = (requiredFields as any)[operation];

    if (!fields) {
      this.logPluginError('Invalid operation', { operation });
      return Promise.resolve(false);
    }

    const isValid = fields.every((field: unknown) => pluginData[field as string] !== undefined);
    if (!isValid) {
      this.logPluginError('Missing required fields', {
        operation,
        requiredFields: fields,
      });
    }

    return isValid;
  }
}
