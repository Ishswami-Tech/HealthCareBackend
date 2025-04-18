import { Controller, Get, Param, Logger } from '@nestjs/common';
import { AppointmentLocationService } from './appointment-location.service';

@Controller('api/appointments/locations')
export class AppointmentLocationController {
  private readonly logger = new Logger(AppointmentLocationController.name);

  constructor(
    private readonly locationService: AppointmentLocationService,
  ) {}

  @Get()
  async getAllLocations() {
    try {
      return await this.locationService.getAllLocations();
    } catch (error) {
      this.logger.error(`Failed to get locations: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get(':locationId')
  async getLocationById(@Param('locationId') locationId: string) {
    try {
      return await this.locationService.getLocationById(locationId);
    } catch (error) {
      this.logger.error(`Failed to get location ${locationId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get(':locationId/doctors')
  async getDoctorsByLocation(@Param('locationId') locationId: string) {
    try {
      return await this.locationService.getDoctorsByLocation(locationId);
    } catch (error) {
      this.logger.error(`Failed to get doctors for location ${locationId}: ${error.message}`, error.stack);
      throw error;
    }
  }
} 