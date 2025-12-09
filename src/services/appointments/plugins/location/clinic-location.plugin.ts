import { Injectable } from '@nestjs/common';
import { BaseAppointmentPlugin } from '@services/appointments/plugins/base/base-plugin.service';
import { AppointmentLocationService } from './appointment-location.service';

interface LocationPluginData {
  operation: string;
  locationId?: string;
}

@Injectable()
export class ClinicLocationPlugin extends BaseAppointmentPlugin {
  readonly name = 'clinic-location-plugin';
  readonly version = '1.0.0';
  readonly features = ['location-management', 'qr-codes', 'multi-location'];

  constructor(private readonly locationService: AppointmentLocationService) {
    super();
  }

  async process(data: unknown): Promise<unknown> {
    const pluginData = data as LocationPluginData;
    this.logPluginAction('Processing clinic location operation', {
      operation: pluginData.operation,
    });

    // Delegate to existing location service - no functionality change
    switch (pluginData.operation) {
      case 'getAllLocations':
        return await this.locationService.getAllLocations('clinic');

      case 'getLocationById':
        if (!pluginData.locationId) {
          throw new Error('Missing required field locationId for getLocationById');
        }
        return await this.locationService.getLocationById(pluginData.locationId, 'clinic');

      case 'getDoctorsByLocation':
        if (!pluginData.locationId) {
          throw new Error('Missing required field locationId for getDoctorsByLocation');
        }
        return await this.locationService.getDoctorsByLocation(pluginData.locationId, 'clinic');

      case 'getLocationStats':
        if (!pluginData.locationId) {
          throw new Error('Missing required field locationId for getLocationStats');
        }
        return await this.locationService.getLocationStats(pluginData.locationId, 'clinic');

      case 'invalidateLocationsCache':
        return await this.locationService.invalidateLocationsCache('clinic');

      case 'invalidateDoctorsCache':
        if (!pluginData.locationId) {
          throw new Error('Missing required field locationId for invalidateDoctorsCache');
        }
        return await this.locationService.invalidateDoctorsCache(pluginData.locationId, 'clinic');

      default:
        this.logPluginError('Unknown location operation', {
          operation: pluginData.operation,
        });
        throw new Error(`Unknown location operation: ${pluginData.operation}`);
    }
  }

  validate(data: unknown): Promise<boolean> {
    const pluginData = data as LocationPluginData;
    // Validate that required fields are present for each operation
    const requiredFields: Record<string, string[]> = {
      getLocationById: ['locationId'],
      getDoctorsByLocation: ['locationId'],
      getLocationStats: ['locationId'],
      invalidateDoctorsCache: ['locationId'],
    };

    const operation = pluginData.operation;
    const fields = requiredFields[operation];

    if (!fields) {
      // Operations without required fields are valid
      return Promise.resolve(true);
    }

    const isValid = fields.every((field: unknown) => {
      const fieldName = field as string;
      return (
        fieldName in pluginData && pluginData[fieldName as keyof LocationPluginData] !== undefined
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
