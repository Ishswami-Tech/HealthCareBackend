import { Controller, Get, Param, Logger, UseGuards } from '@nestjs/common';
import { AppointmentLocationService } from './appointment-location.service';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiSecurity } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/libs/core/guards/jwt-auth.guard';
import { RolesGuard } from 'src/libs/core/guards/roles.guard';
import { ClinicGuard } from 'src/libs/core/guards/clinic.guard';
import { UseInterceptors } from '@nestjs/common';
import { TenantContextInterceptor } from 'src/libs/utils/interceptors/tenant-context.interceptor';
import { PermissionGuard } from 'src/libs/core/guards/permission.guard';
import { Permission } from 'src/libs/infrastructure/permissions';

@ApiTags('Appointment Locations')
@Controller('api/appointments/locations')
@UseGuards(JwtAuthGuard, RolesGuard, ClinicGuard, PermissionGuard)
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