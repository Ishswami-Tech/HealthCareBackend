import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  Patch,
  Query,
  UseGuards,
  Request,
  NotFoundException,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiSecurity,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '@core/guards/jwt-auth.guard';
import { RolesGuard } from '@core/guards/roles.guard';
import { RbacGuard } from '@core/rbac/rbac.guard';
import { RequireResourcePermission } from '@core/rbac/rbac.decorators';
import { Roles } from '@core/decorators/roles.decorator';
import { Role } from '@core/types/enums.types';
import { ClinicLocationService } from '@services/clinic/services/clinic-location.service';
import { ClinicIdPipe } from '@core/pipes/clinic-id.pipe';
import { CreateClinicLocationDto, UpdateClinicLocationDto } from '@dtos/clinic.dto';
import { Cache as CacheDecorator, InvalidateClinicCache } from '@core/decorators';
import { CacheService } from '@infrastructure/cache/cache.service';
import { toSafeClinicResponse } from '@services/clinic/clinic-response.util';
import { parseWorkingHours } from './working-hours.util';
import type {
  ClinicLocationUpdateInput,
  ClinicLocationResponseDto,
} from '@core/types/clinic.types';

@ApiTags('clinic locations')
@ApiBearerAuth()
@ApiSecurity('session-id')
@UseGuards(JwtAuthGuard, RolesGuard, RbacGuard)
@Controller('clinics/:clinicId/locations')
export class ClinicLocationController {
  constructor(
    private readonly locationService: ClinicLocationService,
    @Optional() private readonly cacheService?: CacheService
  ) {}

  /** Validated working hours as the stored JSON string; a 400 with the reason otherwise. */
  private storedWorkingHours(input: unknown): string {
    const result = parseWorkingHours(input);
    if (!result.ok) throw new BadRequestException(result.error);
    return result.stored;
  }

  /** The location must belong to the clinic in the path (a location id alone is not a scope). */
  private async assertLocationInClinic(id: string, clinicId: string): Promise<void> {
    const location = await this.locationService.getClinicLocationById(id, false, clinicId);
    if (!location || location.clinicId !== clinicId) {
      throw new NotFoundException(`Location with ID ${id} not found`);
    }
  }

  /**
   * Doctor availability is computed from the location hours and cached per doctor and clinic:
   * drop those entries so the next read uses the new hours (same keys as the appointment cache).
   */
  private async clearAvailabilityCache(clinicId: string): Promise<void> {
    if (!this.cacheService) return;
    // Clinic-bound keys only: a location change of one clinic never flushes another's slots.
    // Best effort, as before: a cache failure never fails the location write (entries age out).
    await this.cacheService.invalidateClinicAvailabilityCache(clinicId).catch(() => 0);
  }

  @Post()
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.CLINIC_LOCATION_HEAD)
  @RequireResourcePermission('clinics', 'create')
  @InvalidateClinicCache({
    tags: ['clinic_locations', 'clinic:{clinicId}'],
    patterns: ['clinic_locations:{clinicId}:*', 'clinic_location:{clinicId}:*'],
  })
  @ApiOperation({ summary: 'Create a new clinic location' })
  @ApiBody({ type: CreateClinicLocationDto })
  @ApiResponse({
    status: 201,
    description: 'The location has been successfully created.',
  })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiParam({ name: 'clinicId', description: 'ID of the clinic' })
  async create(
    @Param('clinicId', ClinicIdPipe) clinicId: string,
    @Body() createLocationDto: CreateClinicLocationDto,
    @Request() req: { user?: { id?: string; sub?: string } }
  ): Promise<ClinicLocationResponseDto> {
    const userId = req.user?.id || req.user?.sub || 'system';
    const created = await this.locationService.createClinicLocation(
      {
        ...createLocationDto,
        // Optional on the DTO, required (possibly empty) strings on the create input.
        zipCode: createLocationDto.zipCode ?? '',
        phone: createLocationDto.phone ?? '',
        email: createLocationDto.email ?? '',
        timezone: createLocationDto.timezone ?? 'Asia/Kolkata',
        clinicId,
        locationId: `LOC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        workingHours: createLocationDto.workingHours
          ? this.storedWorkingHours(createLocationDto.workingHours)
          : JSON.stringify({ start: '09:00', end: '17:00' }),
      },
      userId
    );
    return toSafeClinicResponse(created);
  }

  @Get()
  @Roles(
    Role.SUPER_ADMIN,
    Role.CLINIC_ADMIN,
    Role.CLINIC_LOCATION_HEAD,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.NURSE,
    Role.THERAPIST,
    Role.COUNSELOR,
    Role.RECEPTIONIST,
    Role.PATIENT
  )
  @RequireResourcePermission('clinics', 'read')
  @CacheDecorator({
    keyTemplate: 'clinic_locations:{clinicId}:false:{includeInactive}',
    ttl: 1800, // 30 minutes
    tags: ['clinic_locations', 'clinic:{clinicId}'],
    enableSWR: true,
  })
  @ApiOperation({ summary: 'Get all locations for a clinic' })
  @ApiResponse({
    status: 200,
    description: 'Return all locations for the specified clinic.',
  })
  @ApiParam({ name: 'clinicId', description: 'ID of the clinic' })
  @ApiQuery({
    name: 'includeInactive',
    description: 'Include inactive locations in the response',
    required: false,
    type: Boolean,
  })
  async findAll(
    @Param('clinicId', ClinicIdPipe) clinicId: string,
    @Request() _req: { user: { id: string } },
    @Query('includeInactive') includeInactive?: string
  ): Promise<ClinicLocationResponseDto[]> {
    const includeInactiveFlag = includeInactive === 'true';
    const locations = await this.locationService.getLocations(clinicId, false, includeInactiveFlag);
    return toSafeClinicResponse(locations);
  }

  @Get(':id')
  @Roles(
    Role.SUPER_ADMIN,
    Role.CLINIC_ADMIN,
    Role.CLINIC_LOCATION_HEAD,
    Role.DOCTOR,
    Role.ASSISTANT_DOCTOR,
    Role.RECEPTIONIST,
    Role.PATIENT
  )
  @CacheDecorator({
    // The clinic is part of the key: this controller has no ClinicGuard, so a key without it would
    // replay one clinic's location to a request addressed to another clinic (the handler's
    // clinic-ownership check does not run on a hit).
    keyTemplate: 'clinic_location:{clinicId}:{id}',
    ttl: 1800, // 30 minutes
    tags: ['clinic_locations', 'clinic_location:{id}'],
    enableSWR: true,
  })
  @ApiOperation({ summary: 'Get a specific clinic location' })
  @ApiResponse({ status: 200, description: 'Return the specified location.' })
  @ApiResponse({ status: 404, description: 'Location not found.' })
  @ApiParam({ name: 'clinicId', description: 'ID of the clinic' })
  @ApiParam({ name: 'id', description: 'ID of the location' })
  async findOne(
    @Param('id') id: string,
    @Param('clinicId', ClinicIdPipe) clinicId: string,
    @Request() _req: { user: { id: string } }
  ): Promise<ClinicLocationResponseDto> {
    const location = await this.locationService.getClinicLocationById(id, false, clinicId);
    if (!location) {
      throw new NotFoundException(`Location with ID ${id} not found`);
    }
    return toSafeClinicResponse(location);
  }

  @Put(':id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.CLINIC_LOCATION_HEAD)
  @RequireResourcePermission('clinics', 'update')
  @InvalidateClinicCache({
    tags: ['clinic_locations', 'clinic:{clinicId}', 'clinic_location:{id}'],
    patterns: ['clinic_locations:{clinicId}:*', 'clinic_location:{clinicId}:*'],
  })
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
    @Param('clinicId', ClinicIdPipe) clinicId: string,
    @Body() updateLocationDto: UpdateClinicLocationDto,
    @Request() req: { user?: { id?: string; sub?: string } }
  ): Promise<ClinicLocationResponseDto> {
    const userId = req.user?.id || req.user?.sub || 'system';
    await this.assertLocationInClinic(id, clinicId);
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
      ...(updateLocationDto.abdmHfrId !== undefined && {
        abdmHfrId: updateLocationDto.abdmHfrId,
      }),
      ...(updateLocationDto.workingHours !== undefined && {
        workingHours: this.storedWorkingHours(updateLocationDto.workingHours),
      }),
    };

    const updated = await this.locationService.updateLocation(id, updateData, userId);
    if (updateData.workingHours !== undefined) await this.clearAvailabilityCache(clinicId);
    return toSafeClinicResponse(updated);
  }

  /** PATCH alias of PUT :id (the web sends PATCH); same body, roles, permission and cache busting. */
  @Patch(':id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.CLINIC_LOCATION_HEAD)
  @RequireResourcePermission('clinics', 'update')
  @InvalidateClinicCache({
    tags: ['clinic_locations', 'clinic:{clinicId}', 'clinic_location:{id}'],
    patterns: ['clinic_locations:{clinicId}:*', 'clinic_location:{clinicId}:*'],
  })
  @ApiOperation({ summary: 'Update a clinic location (PATCH alias of PUT)' })
  @ApiBody({ type: UpdateClinicLocationDto })
  @ApiResponse({ status: 200, description: 'The location has been successfully updated.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  @ApiResponse({ status: 404, description: 'Location not found.' })
  @ApiParam({ name: 'clinicId', description: 'ID of the clinic' })
  @ApiParam({ name: 'id', description: 'ID of the location' })
  async patch(
    @Param('id') id: string,
    @Param('clinicId', ClinicIdPipe) clinicId: string,
    @Body() updateLocationDto: UpdateClinicLocationDto,
    @Request() req: { user?: { id?: string; sub?: string } }
  ): Promise<ClinicLocationResponseDto> {
    return this.update(id, clinicId, updateLocationDto, req);
  }

  @Put(':id/working-hours')
  // Schedule is the clinic admin's (product rule 7); reception no longer edits location hours.
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.CLINIC_LOCATION_HEAD)
  @RequireResourcePermission('clinics', 'update')
  @InvalidateClinicCache({
    tags: ['clinic_locations', 'clinic:{clinicId}', 'clinic_location:{id}'],
    patterns: ['clinic_locations:{clinicId}:*', 'clinic_location:{clinicId}:*'],
  })
  @ApiOperation({ summary: 'Update clinic location working hours' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        workingHours: {
          type: 'object',
          description: 'Working hours configuration',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'The location working hours have been successfully updated.',
  })
  @ApiParam({ name: 'clinicId', description: 'ID of the clinic' })
  @ApiParam({ name: 'id', description: 'ID of the location' })
  async updateWorkingHours(
    @Param('id') id: string,
    @Param('clinicId', ClinicIdPipe) clinicId: string,
    @Body('workingHours') workingHours: unknown,
    @Request() req: { user?: { id?: string; sub?: string } }
  ): Promise<ClinicLocationResponseDto> {
    const userId = req.user?.id || req.user?.sub || 'system';

    // { start: 'HH:MM', end: 'HH:MM' } (start < end) or per-day hours; anything else is a 400.
    await this.assertLocationInClinic(id, clinicId);
    const updateData: ClinicLocationUpdateInput = {
      workingHours: this.storedWorkingHours(workingHours),
    };

    const updated = await this.locationService.updateLocation(id, updateData, userId);
    await this.clearAvailabilityCache(clinicId);
    return toSafeClinicResponse(updated);
  }

  @Delete(':id')
  @Roles(Role.SUPER_ADMIN, Role.CLINIC_ADMIN, Role.CLINIC_LOCATION_HEAD)
  @RequireResourcePermission('clinics', 'delete')
  @InvalidateClinicCache({
    tags: ['clinic_locations', 'clinic:{clinicId}', 'clinic_location:{id}'],
    patterns: ['clinic_locations:{clinicId}:*', 'clinic_location:{clinicId}:*'],
  })
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
    @Param('clinicId', ClinicIdPipe) clinicId: string,
    @Request() req: { user?: { id?: string; sub?: string } }
  ): Promise<void> {
    const userId = req.user?.id || req.user?.sub || 'system';
    await this.locationService.deleteLocation(id, userId, clinicId);
  }
}
