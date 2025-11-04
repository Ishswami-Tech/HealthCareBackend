import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  UseGuards,
  Request,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiSecurity,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';
import { ClinicLocationService } from '@services/clinic/services/clinic-location.service';
import { CreateClinicLocationDto } from '@services/clinic/dto/create-clinic-location.dto';
import { UpdateClinicLocationDto } from '@services/clinic/dto/update-clinic-location.dto';
import type {
  ClinicLocationUpdateInput,
  ClinicLocationResponseDto,
} from '@core/types/clinic.types';

@ApiTags('Clinic Locations')
@ApiBearerAuth()
@ApiSecurity('session-id')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('clinics/:clinicId/locations')
export class ClinicLocationController {
  constructor(private readonly locationService: ClinicLocationService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({ summary: 'Create a new clinic location' })
  @ApiBody({ type: CreateClinicLocationDto })
  @ApiResponse({
    status: 201,
    description: 'The location has been successfully created.',
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiParam({ name: 'clinicId', description: 'ID of the clinic' })
  async create(
    @Param('clinicId') clinicId: string,
    @Body() createLocationDto: CreateClinicLocationDto,
    @Request() req: { user?: { id?: string; sub?: string } }
  ): Promise<ClinicLocationResponseDto> {
    const userId = req.user?.id || req.user?.sub || 'system';
    return await this.locationService.createClinicLocation(
      {
        ...createLocationDto,
        clinicId,
        locationId: `LOC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        workingHours:
          typeof createLocationDto.workingHours === 'string'
            ? createLocationDto.workingHours
            : createLocationDto.workingHours
              ? JSON.stringify(createLocationDto.workingHours)
              : '9:00 AM - 5:00 PM',
      },
      userId
    );
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.DOCTOR, Role.RECEPTIONIST)
  @ApiOperation({ summary: 'Get all locations for a clinic' })
  @ApiResponse({
    status: 200,
    description: 'Return all locations for the specified clinic.',
  })
  @ApiParam({ name: 'clinicId', description: 'ID of the clinic' })
  async findAll(
    @Param('clinicId') clinicId: string,
    @Request() _req: { user: { id: string } }
  ): Promise<ClinicLocationResponseDto[]> {
    return await this.locationService.getLocations(clinicId, false);
  }

  @Get(':id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.DOCTOR, Role.RECEPTIONIST)
  @ApiOperation({ summary: 'Get a specific clinic location' })
  @ApiResponse({ status: 200, description: 'Return the specified location.' })
  @ApiResponse({ status: 404, description: 'Location not found.' })
  @ApiParam({ name: 'clinicId', description: 'ID of the clinic' })
  @ApiParam({ name: 'id', description: 'ID of the location' })
  async findOne(
    @Param('id') id: string,
    @Param('clinicId') _clinicId: string,
    @Request() _req: { user: { id: string } }
  ): Promise<ClinicLocationResponseDto> {
    const location = await this.locationService.getClinicLocationById(id, false);
    if (!location) {
      throw new NotFoundException(`Location with ID ${id} not found`);
    }
    return location;
  }

  @Put(':id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({ summary: 'Update a clinic location' })
  @ApiBody({ type: UpdateClinicLocationDto })
  @ApiResponse({
    status: 200,
    description: 'The location has been successfully updated.',
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Location not found.' })
  @ApiParam({ name: 'clinicId', description: 'ID of the clinic' })
  @ApiParam({ name: 'id', description: 'ID of the location' })
  async update(
    @Param('id') id: string,
    @Param('clinicId') clinicId: string,
    @Body() updateLocationDto: UpdateClinicLocationDto,
    @Request() req: { user?: { id?: string; sub?: string } }
  ): Promise<ClinicLocationResponseDto> {
    const userId = req.user?.id || req.user?.sub || 'system';
    // Handle workingHours conversion properly - convert object to JSON string for ClinicLocationUpdateInput
    const updateData: ClinicLocationUpdateInput = {
      ...(updateLocationDto.name !== undefined && { name: updateLocationDto.name }),
      ...(updateLocationDto.address !== undefined && { address: updateLocationDto.address }),
      ...(updateLocationDto.city !== undefined && { city: updateLocationDto.city }),
      ...(updateLocationDto.state !== undefined && { state: updateLocationDto.state }),
      ...(updateLocationDto.country !== undefined && { country: updateLocationDto.country }),
      ...(updateLocationDto.zipCode !== undefined && { zipCode: updateLocationDto.zipCode }),
      ...(updateLocationDto.phone !== undefined && { phone: updateLocationDto.phone }),
      ...(updateLocationDto.email !== undefined && { email: updateLocationDto.email }),
      ...(updateLocationDto.timezone !== undefined && { timezone: updateLocationDto.timezone }),
      ...(updateLocationDto.isActive !== undefined && { isActive: updateLocationDto.isActive }),
      ...(updateLocationDto.latitude !== undefined && { latitude: updateLocationDto.latitude }),
      ...(updateLocationDto.longitude !== undefined && { longitude: updateLocationDto.longitude }),
      ...(updateLocationDto.settings !== undefined && { settings: updateLocationDto.settings }),
      ...(updateLocationDto.workingHours !== undefined && {
        workingHours:
          typeof updateLocationDto.workingHours === 'string'
            ? updateLocationDto.workingHours
            : JSON.stringify(updateLocationDto.workingHours),
      }),
    };

    return await this.locationService.updateLocation(id, updateData, userId);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({ summary: 'Delete a clinic location' })
  @ApiResponse({
    status: 200,
    description: 'The location has been successfully deleted.',
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Location not found.' })
  @ApiParam({ name: 'clinicId', description: 'ID of the clinic' })
  @ApiParam({ name: 'id', description: 'ID of the location' })
  async remove(
    @Param('id') id: string,
    @Param('clinicId') clinicId: string,
    @Request() req: { user?: { id?: string; sub?: string } }
  ): Promise<void> {
    const userId = req.user?.id || req.user?.sub || 'system';
    await this.locationService.deleteLocation(id, userId);
  }
}
