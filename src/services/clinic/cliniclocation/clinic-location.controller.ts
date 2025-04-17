import { Controller, Get, Post, Body, Param, Delete, Put, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../libs/guards/jwt-auth.guard';
import { RolesGuard } from '../../../libs/guards/roles.guard';
import { Roles } from '../../../libs/decorators/roles.decorator';
import { Role } from '@prisma/client';
import { ClinicLocationService } from './clinic-location.service';
import { CreateClinicLocationDto } from '../dto/create-clinic-location.dto';
import { UpdateClinicLocationDto } from '../dto/update-clinic-location.dto';

@ApiTags('Clinic Locations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('clinics/:clinicId/locations')
export class ClinicLocationController {
  constructor(private readonly locationService: ClinicLocationService) {}

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({ summary: 'Create a new clinic location' })
  @ApiResponse({ status: 201, description: 'The location has been successfully created.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiParam({ name: 'clinicId', description: 'ID of the clinic' })
  async create(
    @Param('clinicId') clinicId: string,
    @Body() createLocationDto: CreateClinicLocationDto,
    @Request() req,
  ) {
    return this.locationService.createLocation(clinicId, createLocationDto, req.user.id);
  }

  @Get()
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.DOCTOR, Role.RECEPTIONIST)
  @ApiOperation({ summary: 'Get all locations for a clinic' })
  @ApiResponse({ status: 200, description: 'Return all locations for the specified clinic.' })
  @ApiParam({ name: 'clinicId', description: 'ID of the clinic' })
  async findAll(@Param('clinicId') clinicId: string, @Request() req) {
    return this.locationService.getLocations(clinicId, req.user.id);
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
    @Param('clinicId') clinicId: string,
    @Request() req,
  ) {
    return this.locationService.getLocationById(id, clinicId, req.user.id);
  }

  @Put(':id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({ summary: 'Update a clinic location' })
  @ApiResponse({ status: 200, description: 'The location has been successfully updated.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Location not found.' })
  @ApiParam({ name: 'clinicId', description: 'ID of the clinic' })
  @ApiParam({ name: 'id', description: 'ID of the location' })
  async update(
    @Param('id') id: string,
    @Param('clinicId') clinicId: string,
    @Body() updateLocationDto: UpdateClinicLocationDto,
    @Request() req,
  ) {
    return this.locationService.updateLocation(id, clinicId, updateLocationDto, req.user.id);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN)
  @ApiOperation({ summary: 'Delete a clinic location' })
  @ApiResponse({ status: 200, description: 'The location has been successfully deleted.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Location not found.' })
  @ApiParam({ name: 'clinicId', description: 'ID of the clinic' })
  @ApiParam({ name: 'id', description: 'ID of the location' })
  async remove(
    @Param('id') id: string,
    @Param('clinicId') clinicId: string,
    @Request() req,
  ) {
    return this.locationService.deleteLocation(id, clinicId, req.user.id);
  }
} 