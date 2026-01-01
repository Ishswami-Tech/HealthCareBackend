import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { BaseAppointmentPlugin } from '@services/appointments/plugins/base/base-plugin.service';
import { AppointmentQueueService } from './appointment-queue.service';
import { LoggingService } from '@infrastructure/logging';

interface PluginData {
  operation: string;
  doctorId?: string;
  date?: string;
  appointmentId?: string;
  locationId?: string;
  period?: string;
  priority?: number;
  reorderData?: {
    doctorId: string;
    date: string;
    newOrder: string[];
  };
}

@Injectable()
export class ClinicQueuePlugin extends BaseAppointmentPlugin {
  readonly name = 'clinic-queue-plugin';
  readonly version = '1.0.0';
  readonly features = ['queue-management', 'priority-queues', 'emergency-handling'];

  constructor(
    private readonly queueService: AppointmentQueueService,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    loggingService?: LoggingService
  ) {
    super(loggingService);
  }

  async process(data: unknown): Promise<unknown> {
    const pluginData = data as PluginData;
    await this.logPluginAction('Processing clinic queue operation', {
      operation: pluginData.operation,
    });

    // Delegate to existing queue service - no functionality change
    switch (pluginData.operation) {
      case 'getDoctorQueue':
        return await this.queueService.getDoctorQueue(
          pluginData.doctorId!,
          pluginData.date!,
          'clinic',
          pluginData.locationId
        );

      case 'getPatientQueuePosition':
        return await this.queueService.getPatientQueuePosition(pluginData.appointmentId!, 'clinic');

      case 'confirmAppointment':
        return await this.queueService.confirmAppointment(pluginData.appointmentId!, 'clinic');

      case 'startConsultation':
        return await this.queueService.startConsultation(
          pluginData.appointmentId!,
          pluginData.doctorId!,
          'clinic'
        );

      case 'reorderQueue':
        return await this.queueService.reorderQueue(pluginData.reorderData!, 'clinic');

      case 'getLocationQueueStats':
        return await this.queueService.getLocationQueueStats(pluginData.locationId!, 'clinic');

      case 'getQueueMetrics':
        return await this.queueService.getQueueMetrics(
          pluginData.locationId!,
          'clinic',
          pluginData.period!
        );

      case 'handleEmergencyAppointment':
        return await this.queueService.handleEmergencyAppointment(
          pluginData.appointmentId!,
          pluginData.priority!,
          'clinic'
        );

      default:
        await this.logPluginError('Unknown queue operation', {
          operation: pluginData.operation,
        });
        throw new Error(`Unknown queue operation: ${pluginData.operation}`);
    }
  }

  async validate(data: unknown): Promise<boolean> {
    const pluginData = data as PluginData;
    // Validate that required fields are present for each operation
    const requiredFields: Record<string, string[]> = {
      getDoctorQueue: ['doctorId', 'date'],
      getPatientQueuePosition: ['appointmentId'],
      confirmAppointment: ['appointmentId'],
      startConsultation: ['appointmentId', 'doctorId'],
      reorderQueue: ['reorderData'],
      getLocationQueueStats: ['locationId'],
      getQueueMetrics: ['locationId', 'period'],
      handleEmergencyAppointment: ['appointmentId', 'priority'],
    };

    const operation = pluginData.operation;
    const fields = requiredFields[operation];

    if (!fields) {
      await this.logPluginError('Invalid operation', { operation });
      return Promise.resolve(false);
    }

    const isValid = fields.every(
      (field: string) => pluginData[field as keyof PluginData] !== undefined
    );
    if (!isValid) {
      await this.logPluginError('Missing required fields', {
        operation,
        requiredFields: fields,
      });
    }

    return Promise.resolve(isValid);
  }
}
