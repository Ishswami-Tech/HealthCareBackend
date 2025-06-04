import { Controller, Get, Param, Logger, UseGuards } from '@nestjs/common';
import { AppointmentLocationService } from './appointment-location.service';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../libs/guards/jwt-auth.guard';
import { RolesGuard } from '../../../libs/guards/roles.guard';
import { ClinicGuard } from '../../../libs/guards/clinic.guard';
import { UseInterceptors } from '@nestjs/common';
import { TenantContextInterceptor } from '../../../shared/interceptors/tenant-context.interceptor';

@ApiTags('Appointment Locations')
@Controller('api/appointments/locations')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard)
@UseInterceptors(TenantContextInterceptor)
@ApiBearerAuth()
@ApiSecurity('session-id')
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