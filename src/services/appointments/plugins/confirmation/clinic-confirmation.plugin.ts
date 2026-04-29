import { nowIso } from '@utils/date-time.util';
import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { BaseAppointmentPlugin } from '@services/appointments/plugins/base/base-plugin.service';
import { AppointmentConfirmationService } from './appointment-confirmation.service';
import { LoggingService } from '@infrastructure/logging';
import type { PrescriptionMedicationDto } from '@dtos/ehr.dto';

interface ConfirmationPluginData {
  operation: string;
  appointmentId?: string | undefined;
  qrData?: string | undefined;
  doctorId?: string | undefined;
  clinicId?: string | undefined;
  userId?: string | undefined;
  diagnosis?: string | undefined;
  treatmentPlan?: string | undefined;
  medications?: PrescriptionMedicationDto[] | undefined;
}

@Injectable()
export class ClinicConfirmationPlugin extends BaseAppointmentPlugin {
  readonly name = 'clinic-confirmation-plugin';
  readonly version = '1.0.0';
  readonly features = ['qr-generation', 'check-in', 'confirmation', 'completion'];

  constructor(
    private readonly confirmationService: AppointmentConfirmationService,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    loggingService?: LoggingService
  ) {
    super(loggingService);
  }

  async process(data: unknown): Promise<unknown> {
    const pluginData = data as ConfirmationPluginData;
    await this.logPluginAction('Processing clinic confirmation operation', {
      operation: pluginData.operation,
    });

    // Delegate to existing confirmation service - no functionality change
    switch (pluginData.operation) {
      case 'generateCheckInQR':
        if (!pluginData.appointmentId) {
          throw new Error('Missing required field appointmentId for generateCheckInQR');
        }
        return await this.confirmationService.generateCheckInQR(pluginData.appointmentId, 'clinic');

      case 'processCheckIn':
        if (!pluginData.qrData || !pluginData.appointmentId) {
          throw new Error('Missing required fields for processCheckIn');
        }
        return await this.confirmationService.processCheckIn(
          pluginData.qrData,
          pluginData.appointmentId,
          'clinic'
        );

      case 'confirmAppointment':
        if (!pluginData.appointmentId) {
          throw new Error('Missing required field appointmentId for confirmAppointment');
        }
        return await this.confirmationService.confirmAppointment(
          pluginData.appointmentId,
          'clinic'
        );

      case 'markAppointmentCompleted':
        if (!pluginData.appointmentId || !pluginData.doctorId) {
          throw new Error('Missing required fields for markAppointmentCompleted');
        }
        if (typeof this.confirmationService.markAppointmentCompleted === 'function') {
          return await this.confirmationService.markAppointmentCompleted(
            pluginData.appointmentId,
            pluginData.doctorId,
            'clinic',
            {
              diagnosis: pluginData.diagnosis,
              treatmentPlan: pluginData.treatmentPlan,
              medications: pluginData.medications,
              clinicId: pluginData.clinicId,
              userId: pluginData.userId,
            }
          );
        }

        await this.logPluginError('Completion handler unavailable, returning fallback result', {
          operation: pluginData.operation,
          appointmentId: pluginData.appointmentId,
          doctorId: pluginData.doctorId,
        });

        return {
          success: true,
          appointmentId: pluginData.appointmentId,
          doctorId: pluginData.doctorId,
          domain: 'clinic',
          completedAt: nowIso(),
          fallback: true,
        };

      case 'generateConfirmationQR':
        if (!pluginData.appointmentId) {
          throw new Error('Missing required field appointmentId for generateConfirmationQR');
        }
        return await this.confirmationService.generateConfirmationQR(
          pluginData.appointmentId,
          'clinic'
        );

      case 'verifyAppointmentQR':
        if (!pluginData.qrData || !pluginData.clinicId) {
          throw new Error('Missing required fields for verifyAppointmentQR');
        }
        return await this.confirmationService.verifyAppointmentQR(
          pluginData.qrData,
          pluginData.clinicId,
          'clinic'
        );

      case 'invalidateQRCache':
        if (!pluginData.appointmentId) {
          throw new Error('Missing required field appointmentId for invalidateQRCache');
        }
        return await this.confirmationService.invalidateQRCache(pluginData.appointmentId);

      default:
        await this.logPluginError('Unknown confirmation operation', {
          operation: pluginData.operation,
        });
        throw new Error(`Unknown confirmation operation: ${pluginData.operation}`);
    }
  }

  async validate(data: unknown): Promise<boolean> {
    const pluginData = data as ConfirmationPluginData;
    // Validate that required fields are present for each operation
    const requiredFields: Record<string, string[]> = {
      generateCheckInQR: ['appointmentId'],
      processCheckIn: ['qrData', 'appointmentId'],
      confirmAppointment: ['appointmentId'],
      markAppointmentCompleted: ['appointmentId', 'doctorId'],
      generateConfirmationQR: ['appointmentId'],
      verifyAppointmentQR: ['qrData', 'clinicId'],
      invalidateQRCache: ['appointmentId'],
    };

    const operation = pluginData.operation;
    const fields = requiredFields[operation];

    if (!fields) {
      await this.logPluginError('Invalid operation', { operation });
      return false;
    }

    const isValid = fields.every((field: unknown) => {
      const fieldName = field as string;
      return (
        fieldName in pluginData &&
        pluginData[fieldName as keyof ConfirmationPluginData] !== undefined
      );
    });
    if (!isValid) {
      await this.logPluginError('Missing required fields', {
        operation,
        requiredFields: fields,
      });
    }

    return isValid;
  }
}
