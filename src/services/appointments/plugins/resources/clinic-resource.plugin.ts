import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { BaseAppointmentPlugin } from '@services/appointments/plugins/base/base-plugin.service';
import { AppointmentResourceService } from './appointment-resource.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type { Resource } from '@core/types/appointment.types';

interface ResourcePluginData {
  operation: string;
  resourceData?: Omit<Resource, 'id' | 'createdAt' | 'updatedAt'>;
  clinicId?: string;
  type?: string;
  resourceId?: string;
  appointmentId?: string;
  startTime?: Date;
  endTime?: Date;
  notes?: string;
  bookingId?: string;
}

@Injectable()
export class ClinicResourcePlugin extends BaseAppointmentPlugin {
  constructor(
    private readonly resourceService: AppointmentResourceService,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    loggingService?: LoggingService
  ) {
    super(loggingService);
  }

  get name(): string {
    return 'clinic-resource';
  }

  get version(): string {
    return '1.0.0';
  }

  get features(): string[] {
    return ['resources', 'booking', 'conflicts'];
  }

  getSupportedOperations(): string[] {
    return [
      'createResource',
      'getClinicResources',
      'bookResource',
      'checkResourceConflicts',
      'getResourceBookings',
      'cancelResourceBooking',
      'getAlternativeResources',
    ];
  }

  async process(data: unknown): Promise<unknown> {
    const pluginData = this.validatePluginData(data);
    const { operation, ...params } = pluginData;

    if (this.loggingService) {
      await this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        `Processing resource operation: ${operation}`,
        'ClinicResourcePlugin',
        {
          operation,
          resourceId: params.resourceId,
          clinicId: params.clinicId,
        }
      );
    }

    try {
      switch (operation) {
        case 'createResource': {
          if (!params.resourceData) {
            throw new Error('Missing required field: resourceData');
          }
          return await this.resourceService.createResource(params.resourceData);
        }

        case 'getClinicResources': {
          if (!params.clinicId) {
            throw new Error('Missing required field: clinicId');
          }
          return await this.resourceService.getClinicResources(params.clinicId, params.type);
        }

        case 'bookResource': {
          if (!params.resourceId || !params.appointmentId || !params.startTime || !params.endTime) {
            throw new Error('Missing required fields for bookResource');
          }
          return await this.resourceService.bookResource(
            params.resourceId,
            params.appointmentId,
            params.startTime,
            params.endTime,
            params.notes
          );
        }

        case 'checkResourceConflicts': {
          if (!params.resourceId || !params.startTime || !params.endTime) {
            throw new Error('Missing required fields for checkResourceConflicts');
          }
          return await this.resourceService.checkResourceConflicts(
            params.resourceId,
            params.startTime,
            params.endTime
          );
        }

        case 'getResourceBookings': {
          if (!params.resourceId) {
            throw new Error('Missing required field: resourceId');
          }
          return await this.resourceService.getResourceBookings(
            params.resourceId,
            params.startTime,
            params.endTime
          );
        }

        case 'cancelResourceBooking': {
          if (!params.bookingId) {
            throw new Error('Missing required field: bookingId');
          }
          return await this.resourceService.cancelResourceBooking(params.bookingId);
        }

        case 'getAlternativeResources': {
          if (!params.resourceId) {
            throw new Error('Missing required field: resourceId');
          }
          return await this.resourceService.getAlternativeResources(params.resourceId);
        }

        default:
          throw new Error(`Unsupported operation: ${operation}`);
      }
    } catch (_error) {
      if (this.loggingService) {
        await this.loggingService.log(
          LogType.ERROR,
          LogLevel.ERROR,
          `Resource operation failed: ${operation}`,
          'ClinicResourcePlugin',
          {
            operation,
            error: _error instanceof Error ? _error.message : String(_error),
            stack: _error instanceof Error ? _error.stack : undefined,
          }
        );
      }
      throw _error;
    }
  }

  private validatePluginData(data: unknown): ResourcePluginData {
    if (typeof data !== 'object' || data === null) {
      throw new Error('Invalid plugin data: must be an object');
    }
    const record = data as Record<string, unknown>;
    if (typeof record['operation'] !== 'string') {
      throw new Error('Invalid plugin data: operation must be a string');
    }
    return record as unknown as ResourcePluginData;
  }

  validate(data: unknown): Promise<boolean> {
    try {
      const pluginData = this.validatePluginData(data);
      const { operation, ...params } = pluginData;

      // Validate required parameters based on operation
      switch (operation) {
        case 'createResource': {
          const resourceData = params.resourceData;
          return Promise.resolve(
            !!(
              resourceData &&
              typeof resourceData === 'object' &&
              'name' in resourceData &&
              'type' in resourceData &&
              'clinicId' in resourceData &&
              resourceData.name &&
              resourceData.type &&
              resourceData.clinicId
            )
          );
        }

        case 'getClinicResources':
          return Promise.resolve(!!params.clinicId);

        case 'bookResource':
          return Promise.resolve(
            !!(params.resourceId && params.appointmentId && params.startTime && params.endTime)
          );

        case 'checkResourceConflicts':
          return Promise.resolve(!!(params.resourceId && params.startTime && params.endTime));

        case 'getResourceBookings':
          return Promise.resolve(!!params.resourceId);

        case 'cancelResourceBooking':
          return Promise.resolve(!!params.bookingId);

        case 'getAlternativeResources':
          return Promise.resolve(!!params.resourceId);

        default:
          return Promise.resolve(false);
      }
    } catch {
      return Promise.resolve(false);
    }
  }

  getRequiredParameters(operation: string): string[] {
    switch (operation) {
      case 'createResource':
        return ['resourceData'];
      case 'getClinicResources':
        return ['clinicId'];
      case 'bookResource':
        return ['resourceId', 'appointmentId', 'startTime', 'endTime'];
      case 'checkResourceConflicts':
        return ['resourceId', 'startTime', 'endTime'];
      case 'getResourceBookings':
        return ['resourceId'];
      case 'cancelResourceBooking':
        return ['bookingId'];
      case 'getAlternativeResources':
        return ['resourceId'];
      default:
        return [];
    }
  }

  getHealthMetrics(): unknown {
    return {
      plugin: this.name,
      version: this.version,
      status: 'healthy',
      operations: this.getSupportedOperations().length,
      lastCheck: new Date().toISOString(),
    };
  }
}
