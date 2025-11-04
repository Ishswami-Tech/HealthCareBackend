import { Injectable } from '@nestjs/common';
import { BaseAppointmentPlugin } from '@services/appointments/plugins/base/base-plugin.service';
import { CheckInService } from '@services/appointments/plugins/checkin/check-in.service';
import type { CheckInData } from '@core/types/appointment.types';

interface CheckInPluginData {
  operation: string;
  appointmentId?: string;
  userId?: string;
  clinicId?: string;
  doctorId?: string;
  appointmentOrder?: string[];
  therapyType?: string;
  checkInData?: CheckInData;
}

@Injectable()
export class ClinicCheckInPlugin extends BaseAppointmentPlugin {
  readonly name = 'clinic-checkin-plugin';
  readonly version = '1.0.0';
  readonly features = ['check-in', 'queue-management', 'consultation-start'];

  constructor(private readonly checkInService: CheckInService) {
    super();
  }

  async process(data: unknown): Promise<unknown> {
    const pluginData = data as CheckInPluginData;
    this.logPluginAction('Processing clinic check-in operation', {
      operation: pluginData.operation,
    });

    // Delegate to existing check-in service - no functionality change
    switch (pluginData.operation) {
      case 'checkIn':
        if (!pluginData.appointmentId || !pluginData.userId) {
          throw new Error('Missing required fields for checkIn');
        }
        return await this.checkInService.checkIn(pluginData.appointmentId, pluginData.userId);

      case 'getCheckedInAppointments':
        if (!pluginData.clinicId) {
          throw new Error('Missing required field clinicId for getCheckedInAppointments');
        }
        return await this.checkInService.getCheckedInAppointments(pluginData.clinicId);

      case 'processCheckIn':
        if (!pluginData.appointmentId || !pluginData.clinicId) {
          throw new Error('Missing required fields for processCheckIn');
        }
        return await this.checkInService.processCheckIn(
          pluginData.appointmentId,
          pluginData.clinicId
        );

      case 'getPatientQueuePosition':
        if (!pluginData.appointmentId || !pluginData.clinicId) {
          throw new Error('Missing required fields for getPatientQueuePosition');
        }
        return await this.checkInService.getPatientQueuePosition(
          pluginData.appointmentId,
          pluginData.clinicId
        );

      case 'startConsultation':
        if (!pluginData.appointmentId || !pluginData.clinicId) {
          throw new Error('Missing required fields for startConsultation');
        }
        return await this.checkInService.startConsultation(
          pluginData.appointmentId,
          pluginData.clinicId
        );

      case 'getDoctorActiveQueue':
        if (!pluginData.doctorId || !pluginData.clinicId) {
          throw new Error('Missing required fields for getDoctorActiveQueue');
        }
        return await this.checkInService.getDoctorActiveQueue(
          pluginData.doctorId,
          pluginData.clinicId
        );

      case 'reorderQueue':
        if (!pluginData.clinicId || !pluginData.appointmentOrder) {
          throw new Error('Missing required fields for reorderQueue');
        }
        return await this.checkInService.reorderQueue(
          pluginData.clinicId,
          pluginData.appointmentOrder
        );

      case 'getLocationQueue':
        if (!pluginData.clinicId) {
          throw new Error('Missing required field clinicId for getLocationQueue');
        }
        return await this.checkInService.getLocationQueue(pluginData.clinicId);

      // NEW AYURVEDIC OPERATIONS
      case 'processAyurvedicCheckIn':
        if (!pluginData.appointmentId || !pluginData.clinicId || !pluginData.checkInData) {
          throw new Error('Missing required fields for processAyurvedicCheckIn');
        }
        return await this.checkInService.processAyurvedicCheckIn(
          pluginData.appointmentId,
          pluginData.clinicId,
          pluginData.checkInData
        );

      case 'getTherapyQueue':
        if (!pluginData.therapyType || !pluginData.clinicId) {
          throw new Error('Missing required fields for getTherapyQueue');
        }
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
    const pluginData = data as CheckInPluginData;
    // Validate that required fields are present for each operation
    const requiredFields: Record<string, string[]> = {
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
    const fields = requiredFields[operation];

    if (!fields) {
      this.logPluginError('Invalid operation', { operation });
      return Promise.resolve(false);
    }

    const isValid = fields.every((field: unknown) => {
      const fieldName = field as string;
      return (
        fieldName in pluginData && pluginData[fieldName as keyof CheckInPluginData] !== undefined
      );
    });
    if (!isValid) {
      this.logPluginError('Missing required fields', {
        operation,
        requiredFields: fields,
      });
    }

    return Promise.resolve(isValid);
  }
}
