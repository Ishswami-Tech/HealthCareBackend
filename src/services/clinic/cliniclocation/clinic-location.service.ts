import { Injectable, NotFoundException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma/prisma.service';
import { CreateClinicLocationDto } from '../dto/create-clinic-location.dto';
import { UpdateClinicLocationDto } from '../dto/update-clinic-location.dto';
import { EventService } from '../../../shared/events/event.service';
import { ClinicPermissionService } from '../shared/permission.utils';
import { ClinicErrorService } from '../shared/error.utils';

@Injectable()
export class ClinicLocationService {
  constructor(
    private prisma: PrismaService,
    private readonly eventService: EventService,
    private readonly permissionService: ClinicPermissionService,
    private readonly errorService: ClinicErrorService,
  ) {}

  /**
   * Create a new location for a clinic
   * Only ClinicAdmin can create locations for their clinic
   */
  async createLocation(clinicId: string, createLocationDto: CreateClinicLocationDto, userId: string) {
    try {
      // Check if the user has permission to add locations to this clinic
      const hasPermission = await this.permissionService.hasClinicPermission(userId, clinicId);
      if (!hasPermission) {
        throw new UnauthorizedException('You do not have permission to add locations to this clinic');
      }

      // Check if a location with the same name already exists for this clinic
      const existingLocation = await (this.prisma as any).clinic_locations.findFirst({
        where: {
          clinicId,
          name: createLocationDto.name,
        },
      });

      if (existingLocation) {
        throw new ConflictException('A location with this name already exists for this clinic');
      }

      // Create the new location
      const location = await (this.prisma as any).clinic_locations.create({
        data: {
          ...createLocationDto,
          clinicId,
        },
      });

      await this.errorService.logSuccess(
        'Clinic location created successfully',
        'ClinicLocationService',
        'create location',
        { clinicId, locationId: location.id }
      );

      await this.eventService.emit('clinic.location.created', {
        clinicId,
        locationId: location.id,
        name: location.name,
        createdBy: userId
      });

      return location;
    } catch (error) {
      await this.errorService.logError(
        error,
        'ClinicLocationService',
        'create clinic location',
        { clinicId, ...createLocationDto }
      );
      throw error;
    }
  }

  /**
   * Get all locations for a specific clinic
   */
  async getLocations(clinicId: string, userId: string) {
    try {
      // Check if the user has permission to view this clinic's locations
      const hasPermission = await this.permissionService.hasClinicPermission(userId, clinicId);
      if (!hasPermission) {
        throw new UnauthorizedException('You do not have permission to view locations for this clinic');
      }

      const locations = await (this.prisma as any).clinic_locations.findMany({
        where: { clinicId },
      });

      await this.errorService.logSuccess(
        'Clinic locations retrieved successfully',
        'ClinicLocationService',
        'get locations',
        { clinicId, count: locations.length }
      );

      return locations;
    } catch (error) {
      await this.errorService.logError(
        error,
        'ClinicLocationService',
        'retrieve clinic locations',
        { clinicId }
      );
      throw error;
    }
  }

  /**
   * Get a specific location by ID
   */
  async getLocationById(id: string, clinicId: string, userId: string) {
    try {
      // Check if the user has permission to view this clinic's locations
      const hasPermission = await this.permissionService.hasClinicPermission(userId, clinicId);
      if (!hasPermission) {
        throw new UnauthorizedException('You do not have permission to view locations for this clinic');
      }

      const location = await (this.prisma as any).clinic_locations.findFirst({
        where: {
          id,
          clinicId,
        },
      });

      if (!location) {
        throw new NotFoundException('Location not found');
      }

      await this.errorService.logSuccess(
        'Clinic location retrieved successfully',
        'ClinicLocationService',
        'get location by id',
        { clinicId, locationId: id }
      );

      return location;
    } catch (error) {
      await this.errorService.logError(
        error,
        'ClinicLocationService',
        'retrieve clinic location',
        { clinicId, locationId: id }
      );
      throw error;
    }
  }

  /**
   * Update a location
   */
  async updateLocation(id: string, clinicId: string, updateLocationDto: UpdateClinicLocationDto, userId: string) {
    try {
      // Check if the user has permission to update this clinic's locations
      const hasPermission = await this.permissionService.hasClinicPermission(userId, clinicId);
      if (!hasPermission) {
        throw new UnauthorizedException('You do not have permission to update locations for this clinic');
      }

      // Check if the location exists
      const location = await (this.prisma as any).clinic_locations.findFirst({
        where: {
          id,
          clinicId,
        },
      });

      if (!location) {
        throw new NotFoundException('Location not found');
      }

      // If updating the name, check if another location already has this name
      if (updateLocationDto.name && updateLocationDto.name !== location.name) {
        const existingLocation = await (this.prisma as any).clinic_locations.findFirst({
          where: {
            clinicId,
            name: updateLocationDto.name,
            id: { not: id },
          },
        });

        if (existingLocation) {
          throw new ConflictException('Another location with this name already exists for this clinic');
        }
      }

      // Update the location
      const updatedLocation = await (this.prisma as any).clinic_locations.update({
        where: { id },
        data: updateLocationDto,
      });

      await this.errorService.logSuccess(
        'Clinic location updated successfully',
        'ClinicLocationService',
        'update location',
        { clinicId, locationId: id, updatedFields: Object.keys(updateLocationDto) }
      );

      await this.eventService.emit('clinic.location.updated', {
        clinicId,
        locationId: id,
        updatedFields: Object.keys(updateLocationDto),
        updatedBy: userId
      });

      return updatedLocation;
    } catch (error) {
      await this.errorService.logError(
        error,
        'ClinicLocationService',
        'update clinic location',
        { clinicId, locationId: id, ...updateLocationDto }
      );
      throw error;
    }
  }

  /**
   * Delete a location
   */
  async deleteLocation(id: string, clinicId: string, userId: string) {
    try {
      // Check if the user has permission to delete locations for this clinic
      const hasPermission = await this.permissionService.hasClinicPermission(userId, clinicId);
      if (!hasPermission) {
        throw new UnauthorizedException('You do not have permission to delete locations for this clinic');
      }

      // Check if the location exists
      const location = await (this.prisma as any).clinic_locations.findFirst({
        where: {
          id,
          clinicId,
        },
      });

      if (!location) {
        throw new NotFoundException('Location not found');
      }

      // Check if this is the only location for the clinic
      const locationsCount = await (this.prisma as any).clinic_locations.count({
        where: { clinicId },
      });

      if (locationsCount === 1) {
        throw new ConflictException('Cannot delete the only location for a clinic');
      }

      // Delete the location
      await (this.prisma as any).clinic_locations.delete({
        where: { id },
      });

      await this.errorService.logSuccess(
        'Clinic location deleted successfully',
        'ClinicLocationService',
        'delete location',
        { clinicId, locationId: id }
      );

      await this.eventService.emit('clinic.location.deleted', {
        clinicId,
        locationId: id,
        deletedBy: userId
      });

      return { message: 'Location deleted successfully' };
    } catch (error) {
      await this.errorService.logError(
        error,
        'ClinicLocationService',
        'delete clinic location',
        { clinicId, locationId: id }
      );
      throw error;
    }
  }
} 