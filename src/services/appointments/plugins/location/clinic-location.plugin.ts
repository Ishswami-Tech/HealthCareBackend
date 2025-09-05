import { Injectable } from '@nestjs/common';
import { BaseAppointmentPlugin } from '../base/base-plugin.service';
import { AppointmentLocationService } from './appointment-location.service';

@Injectable()
export class ClinicLocationPlugin extends BaseAppointmentPlugin {
  readonly name = 'clinic-location-plugin';
  readonly version = '1.0.0';
  readonly features = ['location-management', 'qr-codes', 'multi-location'];

  constructor(
    private readonly locationService: AppointmentLocationService
  ) {
    super();
  }

  async process(data: any): Promise<any> {
    this.logPluginAction('Processing clinic location operation', { operation: data.operation });
    
    // Delegate to existing location service - no functionality change
    switch (data.operation) {
      case 'getAllLocations':
        return await this.locationService.getAllLocations('clinic');
      
      case 'getLocationById':
        return await this.locationService.getLocationById(data.locationId, 'clinic');
      
      case 'getDoctorsByLocation':
        return await this.locationService.getDoctorsByLocation(data.locationId, 'clinic');
      
      case 'getLocationStats':
        return await this.locationService.getLocationStats(data.locationId, 'clinic');
      
      case 'invalidateLocationsCache':
        return await this.locationService.invalidateLocationsCache('clinic');
      
      case 'invalidateDoctorsCache':
        return await this.locationService.invalidateDoctorsCache(data.locationId, 'clinic');
      
      default:
        this.logPluginError('Unknown location operation', { operation: data.operation });
        throw new Error(`Unknown location operation: ${data.operation}`);
    }
  }

  async validate(data: any): Promise<boolean> {
    // Validate that required fields are present for each operation
    const requiredFields = {
      getLocationById: ['locationId'],
      getDoctorsByLocation: ['locationId'],
      getLocationStats: ['locationId'],
      invalidateDoctorsCache: ['locationId']
    };

    const operation = data.operation;
    const fields = (requiredFields as any)[operation];
    
    if (!fields) {
      // Operations without required fields are valid
      return true;
    }

    const isValid = fields.every((field: any) => data[field] !== undefined);
    if (!isValid) {
      this.logPluginError('Missing required fields', { operation, requiredFields: fields });
    }

    return isValid;
  }
}
