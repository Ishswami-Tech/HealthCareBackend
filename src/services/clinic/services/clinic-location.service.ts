import { Injectable, NotFoundException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma/prisma.service';
import { CreateClinicLocationDto } from '../dto/create-clinic-location.dto';
import { UpdateClinicLocationDto } from '../dto/update-clinic-location.dto';
import { EventService } from '../../../shared/events/event.service';
import { ClinicPermissionService } from '../shared/permission.utils';
import { ClinicErrorService } from '../shared/error.utils';
import { QrService } from '../../../shared/QR/qr.service';
import { LoggingService } from '../../../shared/logging/logging.service';
import { LogType, LogLevel } from '../../../shared/logging/types/logging.types';
import { ClinicLocation, QRCodeData } from '../../../libs/types/clinic.types';

@Injectable()
export class ClinicLocationService {
  constructor(
    private prisma: PrismaService,
    private readonly eventService: EventService,
    private readonly permissionService: ClinicPermissionService,
    private readonly errorService: ClinicErrorService,
    private readonly qrService: QrService,
    private readonly loggingService: LoggingService,
  ) {}

  private async generateLocationId(): Promise<string> {
    const lastLocation = await this.prisma.clinicLocation.findFirst({
      orderBy: { locationId: 'desc' },
    });

    if (!lastLocation) {
      return 'LOC0001';
    }

    const lastNumber = parseInt(lastLocation.locationId.slice(3));
    const newNumber = lastNumber + 1;
    return `LOC${newNumber.toString().padStart(4, '0')}`;
  }

  async createLocation(clinicId: string, createLocationDto: CreateClinicLocationDto, userId: string): Promise<ClinicLocation> {
    try {
      // Check if the user has permission to add locations to this clinic
      const hasPermission = await this.permissionService.hasClinicPermission(userId, clinicId);
      if (!hasPermission) {
        throw new UnauthorizedException('You do not have permission to add locations to this clinic');
      }

      // Check if a location with the same name already exists for this clinic
      const existingLocation = await this.prisma.clinicLocation.findFirst({
        where: {
          clinicId,
          name: createLocationDto.name,
        },
      });

      if (existingLocation) {
        throw new ConflictException('A location with this name already exists for this clinic');
      }

      // Generate unique location ID
      const locationId = await this.generateLocationId();

      // Create the new location
      const location = await this.prisma.clinicLocation.create({
        data: {
          ...createLocationDto,
          clinicId,
          locationId,
          isActive: true,
          timezone: createLocationDto.timezone || 'UTC',
          workingHours: createLocationDto.workingHours || {
            monday: { start: '09:00', end: '17:00' },
            tuesday: { start: '09:00', end: '17:00' },
            wednesday: { start: '09:00', end: '17:00' },
            thursday: { start: '09:00', end: '17:00' },
            friday: { start: '09:00', end: '17:00' },
            saturday: { start: '09:00', end: '13:00' },
            sunday: null
          }
        },
        include: {
          clinic: true,
          doctorClinic: {
            include: {
              doctor: {
                include: {
                  user: {
                    select: {
                      id: true,
                      firstName: true,
                      lastName: true,
                      profilePicture: true
                    }
                  }
                }
              }
            }
          }
        }
      });

      const formattedLocation: ClinicLocation = {
        id: location.id,
        locationId: location.locationId,
        name: location.name,
        address: location.address,
        city: location.city,
        state: location.state,
        country: location.country,
        zipCode: location.zipCode,
        phone: location.phone,
        email: location.email,
        timezone: location.timezone,
        workingHours: location.workingHours as any,
        isActive: location.isActive,
        doctors: location.doctorClinic.map(dc => ({
          id: dc.doctor.id,
          name: `${dc.doctor.user.firstName} ${dc.doctor.user.lastName}`,
          profilePicture: dc.doctor.user.profilePicture
        }))
      };

      await this.eventService.emit('clinic.location.created', {
        clinicId,
        locationId: location.id,
        name: location.name,
        createdBy: userId
      });

      return formattedLocation;
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

  async getLocations(clinicId: string, userId: string): Promise<ClinicLocation[]> {
    try {
      // Check if the user has permission to view this clinic's locations
      const hasPermission = await this.permissionService.hasClinicPermission(userId, clinicId);
      if (!hasPermission) {
        throw new UnauthorizedException('You do not have permission to view locations for this clinic');
      }

      const locations = await this.prisma.clinicLocation.findMany({
        where: { 
          clinicId,
          isActive: true 
        },
        include: {
          doctorClinic: {
            include: {
              doctor: {
                include: {
                  user: {
                    select: {
                      id: true,
                      firstName: true,
                      lastName: true,
                      profilePicture: true
                    }
                  }
                }
              }
            }
          }
        },
        orderBy: {
          locationId: 'asc'
        }
      });

      return locations.map(location => ({
        id: location.id,
        locationId: location.locationId,
        name: location.name,
        address: location.address,
        city: location.city,
        state: location.state,
        country: location.country,
        zipCode: location.zipCode,
        phone: location.phone,
        email: location.email,
        timezone: location.timezone,
        workingHours: location.workingHours as any,
        isActive: location.isActive,
        doctors: location.doctorClinic.map(dc => ({
          id: dc.doctor.id,
          name: `${dc.doctor.user.firstName} ${dc.doctor.user.lastName}`,
          profilePicture: dc.doctor.user.profilePicture
        }))
      }));
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

  async getLocationById(id: string, clinicId: string, userId: string): Promise<ClinicLocation> {
    try {
      // Check if the user has permission to view this clinic's locations
      const hasPermission = await this.permissionService.hasClinicPermission(userId, clinicId);
      if (!hasPermission) {
        throw new UnauthorizedException('You do not have permission to view locations for this clinic');
      }

      const location = await this.prisma.clinicLocation.findFirst({
        where: {
          id,
          clinicId,
          isActive: true
        },
        include: {
          doctorClinic: {
            include: {
              doctor: {
                include: {
                  user: {
                    select: {
                      id: true,
                      firstName: true,
                      lastName: true,
                      profilePicture: true
                    }
                  }
                }
              }
            }
          }
        }
      });

      if (!location) {
        throw new NotFoundException('Location not found');
      }

      return {
        id: location.id,
        locationId: location.locationId,
        name: location.name,
        address: location.address,
        city: location.city,
        state: location.state,
        country: location.country,
        zipCode: location.zipCode,
        phone: location.phone,
        email: location.email,
        timezone: location.timezone,
        workingHours: location.workingHours as any,
        isActive: location.isActive,
        doctors: location.doctorClinic.map(dc => ({
          id: dc.doctor.id,
          name: `${dc.doctor.user.firstName} ${dc.doctor.user.lastName}`,
          profilePicture: dc.doctor.user.profilePicture
        }))
      };
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

  async generateLocationQR(locationId: string, clinicId: string, userId: string): Promise<string> {
    try {
      const location = await this.getLocationById(locationId, clinicId, userId);
      
      const qrData: QRCodeData = {
        locationId: location.locationId,
        clinicId,
        timestamp: new Date().toISOString()
      };

      const qrCode = await this.qrService.generateQR(JSON.stringify(qrData));

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        'Generated QR code for location',
        'ClinicLocationService',
        { locationId, clinicId }
      );

      return qrCode;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to generate location QR: ${error.message}`,
        'ClinicLocationService',
        { locationId, error: error.stack }
      );
      throw error;
    }
  }

  async verifyLocationQR(qrData: string, userId: string): Promise<ClinicLocation> {
    try {
      const data: QRCodeData = JSON.parse(qrData);
      
      // Find the location using the locationId from QR code
      const location = await this.prisma.clinicLocation.findFirst({
        where: { locationId: data.locationId }
      });

      if (!location) {
        throw new NotFoundException('Location not found');
      }

      // Check if user has permission to access this clinic's locations
      const hasPermission = await this.permissionService.hasClinicPermission(userId, data.clinicId);
      if (!hasPermission) {
        throw new UnauthorizedException('You do not have permission to access this location');
      }

      // Verify the location belongs to the correct clinic
      if (location.clinicId !== data.clinicId) {
        throw new Error('Invalid QR code: location does not match clinic');
      }

      // Verify the QR code is not too old (e.g., within 5 minutes)
      const timestamp = new Date(data.timestamp);
      const now = new Date();
      const fiveMinutes = 5 * 60 * 1000;
      if (now.getTime() - timestamp.getTime() > fiveMinutes) {
        throw new Error('QR code has expired');
      }

      return this.getLocationById(location.id, location.clinicId, userId);
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to verify location QR: ${error.message}`,
        'ClinicLocationService',
        { error: error.stack }
      );
      throw error;
    }
  }

  async updateLocation(id: string, clinicId: string, updateLocationDto: UpdateClinicLocationDto, userId: string): Promise<ClinicLocation> {
    try {
      // Check if the user has permission to update this clinic's locations
      const hasPermission = await this.permissionService.hasClinicPermission(userId, clinicId);
      if (!hasPermission) {
        throw new UnauthorizedException('You do not have permission to update locations for this clinic');
      }

      // Check if the location exists
      const location = await this.prisma.clinicLocation.findFirst({
        where: {
          id,
          clinicId,
          isActive: true
        },
      });

      if (!location) {
        throw new NotFoundException('Location not found');
      }

      // If updating the name, check if another location already has this name
      if (updateLocationDto.name && updateLocationDto.name !== location.name) {
        const existingLocation = await this.prisma.clinicLocation.findFirst({
          where: {
            clinicId,
            name: updateLocationDto.name,
            id: { not: id },
            isActive: true
          },
        });

        if (existingLocation) {
          throw new ConflictException('Another location with this name already exists for this clinic');
        }
      }

      // Update the location
      const updatedLocation = await this.prisma.clinicLocation.update({
        where: { id },
        data: {
          ...updateLocationDto,
          updatedAt: new Date()
        },
        include: {
          doctorClinic: {
            include: {
              doctor: {
                include: {
                  user: {
                    select: {
                      id: true,
                      firstName: true,
                      lastName: true,
                      profilePicture: true
                    }
                  }
                }
              }
            }
          }
        }
      });

      await this.eventService.emit('clinic.location.updated', {
        clinicId,
        locationId: id,
        updatedFields: Object.keys(updateLocationDto),
        updatedBy: userId
      });

      return {
        id: updatedLocation.id,
        locationId: updatedLocation.locationId,
        name: updatedLocation.name,
        address: updatedLocation.address,
        city: updatedLocation.city,
        state: updatedLocation.state,
        country: updatedLocation.country,
        zipCode: updatedLocation.zipCode,
        phone: updatedLocation.phone,
        email: updatedLocation.email,
        timezone: updatedLocation.timezone,
        workingHours: updatedLocation.workingHours as any,
        isActive: updatedLocation.isActive,
        doctors: updatedLocation.doctorClinic.map(dc => ({
          id: dc.doctor.id,
          name: `${dc.doctor.user.firstName} ${dc.doctor.user.lastName}`,
          profilePicture: dc.doctor.user.profilePicture
        }))
      };
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

  async deleteLocation(id: string, clinicId: string, userId: string): Promise<{ message: string }> {
    try {
      // Check if the user has permission to delete locations for this clinic
      const hasPermission = await this.permissionService.hasClinicPermission(userId, clinicId);
      if (!hasPermission) {
        throw new UnauthorizedException('You do not have permission to delete locations for this clinic');
      }

      // Check if the location exists
      const location = await this.prisma.clinicLocation.findFirst({
        where: {
          id,
          clinicId,
          isActive: true
        },
      });

      if (!location) {
        throw new NotFoundException('Location not found');
      }

      // Check if this is the only active location for the clinic
      const activeLocationsCount = await this.prisma.clinicLocation.count({
        where: { 
          clinicId,
          isActive: true
        },
      });

      if (activeLocationsCount === 1) {
        throw new ConflictException('Cannot delete the only active location for a clinic');
      }

      // Soft delete the location by marking it as inactive
      await this.prisma.clinicLocation.update({
        where: { id },
        data: {
          isActive: false,
          updatedAt: new Date()
        }
      });

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