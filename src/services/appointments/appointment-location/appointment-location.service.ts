import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma/prisma.service';
import { LoggingService } from '../../../shared/logging/logging.service';
import { LogLevel, LogType } from '../../../shared/logging/types/logging.types';
import { RedisService } from '../../../shared/cache/redis/redis.service';

@Injectable()
export class AppointmentLocationService {
  private readonly LOCATIONS_CACHE_KEY = 'appointment:locations';
  private readonly CACHE_TTL = 3600; // 1 hour in seconds

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly loggingService: LoggingService,
  ) {}

  /**
   * Get all available locations
   */
  async getAllLocations() {
    try {
      // Try to get from cache first
      const cachedLocations = await this.redisService.get(this.LOCATIONS_CACHE_KEY);
      if (cachedLocations) {
        this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.DEBUG,
          'Retrieved locations from cache',
          'AppointmentLocationService'
        );
        return JSON.parse(cachedLocations);
      }

      // If not in cache, get from database
      const locations = await this.prisma.clinic.findMany({
        select: {
          id: true,
          name: true,
          address: true,
        },
        where: {
          // Remove isActive if it doesn't exist in your schema
        },
      });

      // Store in cache for future requests
      await this.redisService.set(
        this.LOCATIONS_CACHE_KEY, 
        JSON.stringify(locations), 
        this.CACHE_TTL
      );
      
      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Retrieved ${locations.length} locations from database`,
        'AppointmentLocationService'
      );
      
      return locations;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get locations: ${error.message}`,
        'AppointmentLocationService',
        { error: error.stack }
      );
      throw new Error('Failed to get clinic locations');
    }
  }

  /**
   * Get location by ID
   */
  async getLocationById(locationId: string) {
    try {
      const location = await this.prisma.clinic.findUnique({
        where: { id: locationId },
        select: {
          id: true,
          name: true,
          address: true,
        },
      });

      if (!location) {
        throw new NotFoundException(`Location with ID ${locationId} not found`);
      }

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        `Retrieved location: ${locationId}`,
        'AppointmentLocationService',
        { locationId }
      );
      
      return location;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get location ${locationId}: ${error.message}`,
        'AppointmentLocationService',
        { locationId, error: error.stack }
      );
      throw new Error(`Failed to get location details: ${error.message}`);
    }
  }

  /**
   * Get doctors available at a specific location
   */
  async getDoctorsByLocation(locationId: string) {
    try {
      // Get the clinic location first
      const location = await this.prisma.clinicLocation.findUnique({
        where: { id: locationId }
      });
      
      if (!location) {
        throw new NotFoundException(`Location with ID ${locationId} not found`);
      }
      
      // Get all doctors for this clinic
      const doctors = await this.prisma.doctor.findMany({
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              profilePicture: true,
            }
          }
        }
      });

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Retrieved ${doctors.length} doctors for location ${locationId}`,
        'AppointmentLocationService',
        { locationId, count: doctors.length }
      );
      
      return doctors;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get doctors for location ${locationId}: ${error.message}`,
        'AppointmentLocationService',
        { locationId, error: error.stack }
      );
      throw new Error(`Failed to get doctors for the selected location: ${error.message}`);
    }
  }

  /**
   * Invalidate locations cache - call this when locations are updated
   */
  async invalidateLocationsCache() {
    try {
      await this.redisService.del(this.LOCATIONS_CACHE_KEY);
      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Locations cache invalidated',
        'AppointmentLocationService'
      );
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to invalidate locations cache: ${error.message}`,
        'AppointmentLocationService',
        { error: error.stack }
      );
    }
  }
} 