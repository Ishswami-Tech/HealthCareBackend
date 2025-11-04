import { Injectable, NotFoundException } from '@nestjs/common';
import { CacheService } from '@infrastructure/cache';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { DatabaseService } from '@infrastructure/database';
// import type { Doctor } from "../../../../libs/infrastructure/database/prisma/prisma.types";

import type {
  AppointmentLocation,
  LocationStats,
  AppointmentLocationDoctor,
} from '@core/types/appointment.types';

// Re-export types for backward compatibility (with alias for Location)
export type { LocationStats, AppointmentLocationDoctor as LocationDoctor };
export type Location = AppointmentLocation;

@Injectable()
export class AppointmentLocationService {
  private readonly LOCATION_CACHE_TTL = 3600; // 1 hour
  private readonly DOCTORS_CACHE_TTL = 1800; // 30 minutes
  private readonly STATS_CACHE_TTL = 300; // 5 minutes

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly databaseService: DatabaseService
  ) {}

  async getAllLocations(domain: string): Promise<unknown> {
    const startTime = Date.now();
    const cacheKey = `locations:${domain}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Locations retrieved from cache',
          'AppointmentLocationService',
          { domain, responseTime: Date.now() - startTime }
        );
        return JSON.parse(cached as string);
      }

      // Get locations from database (placeholder implementation)
      const locations = this.fetchLocationsFromDatabase(domain);

      const result = {
        locations,
        total: locations.length,
        domain,
        retrievedAt: new Date().toISOString(),
      };

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(result), this.LOCATION_CACHE_TTL);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Locations retrieved successfully',
        'AppointmentLocationService',
        {
          domain,
          count: locations.length,
          responseTime: Date.now() - startTime,
        }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get locations: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentLocationService',
        {
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async getLocationById(locationId: string, domain: string): Promise<unknown> {
    const startTime = Date.now();
    const cacheKey = `location:${locationId}:${domain}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      // Get location from database (placeholder implementation)
      const location = this.fetchLocationFromDatabase(locationId, domain);

      if (!location) {
        throw new NotFoundException(`Location not found: ${locationId}`);
      }

      const result = {
        location,
        domain,
        retrievedAt: new Date().toISOString(),
      };

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(result), this.LOCATION_CACHE_TTL);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Location retrieved successfully',
        'AppointmentLocationService',
        { locationId, domain, responseTime: Date.now() - startTime }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get location: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentLocationService',
        {
          locationId,
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async getDoctorsByLocation(locationId: string, domain: string): Promise<unknown> {
    const startTime = Date.now();
    const cacheKey = `doctors:location:${locationId}:${domain}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      // Get doctors from database (placeholder implementation)
      const doctors = this.fetchDoctorsFromDatabase(locationId, domain);

      const result = {
        doctors,
        locationId,
        domain,
        total: doctors.length,
        retrievedAt: new Date().toISOString(),
      };

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(result), this.DOCTORS_CACHE_TTL);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Doctors retrieved successfully',
        'AppointmentLocationService',
        {
          locationId,
          domain,
          count: doctors.length,
          responseTime: Date.now() - startTime,
        }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get doctors: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentLocationService',
        {
          locationId,
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async getLocationStats(locationId: string, domain: string): Promise<unknown> {
    const startTime = Date.now();
    const cacheKey = `stats:location:${locationId}:${domain}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      // Calculate location statistics (placeholder implementation)
      const stats = this.calculateLocationStats();

      const result = {
        locationId,
        domain,
        stats,
        calculatedAt: new Date().toISOString(),
      };

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(result), this.STATS_CACHE_TTL);

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Location stats calculated successfully',
        'AppointmentLocationService',
        { locationId, domain, responseTime: Date.now() - startTime }
      );

      return result;
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get location stats: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentLocationService',
        {
          locationId,
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async invalidateLocationsCache(domain: string): Promise<unknown> {
    const startTime = Date.now();

    try {
      // Invalidate all location-related caches for the domain
      const patterns = [
        `locations:${domain}`,
        `location:*:${domain}`,
        `doctors:location:*:${domain}`,
        `stats:location:*:${domain}`,
      ];

      await Promise.all(patterns.map(pattern => this.cacheService.invalidateByPattern(pattern)));

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Location cache invalidated successfully',
        'AppointmentLocationService',
        { domain, responseTime: Date.now() - startTime }
      );

      return { success: true, message: 'Location cache invalidated' };
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to invalidate location cache: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentLocationService',
        {
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async invalidateDoctorsCache(locationId: string, domain: string): Promise<unknown> {
    const startTime = Date.now();

    try {
      // Invalidate doctor-related caches for the specific location
      const patterns = [
        `doctors:location:${locationId}:${domain}`,
        `stats:location:${locationId}:${domain}`,
      ];

      await Promise.all(patterns.map(pattern => this.cacheService.invalidateByPattern(pattern)));

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Doctors cache invalidated successfully',
        'AppointmentLocationService',
        { locationId, domain, responseTime: Date.now() - startTime }
      );

      return { success: true, message: 'Doctors cache invalidated' };
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to invalidate doctors cache: ${_error instanceof Error ? _error.message : String(_error)}`,
        'AppointmentLocationService',
        {
          locationId,
          domain,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  // Helper methods (placeholder implementations that would integrate with actual database)
  private fetchLocationsFromDatabase(domain: string): Location[] {
    // This would integrate with the actual database service
    // For now, return mock data
    const mockLocations: Location[] = [
      {
        id: 'loc-1',
        name: 'Main Clinic',
        address: '123 Healthcare Ave',
        city: 'Mumbai',
        state: 'Maharashtra',
        country: 'India',
        postalCode: '400001',
        phone: '+91-22-12345678',
        email: 'main@clinic.com',
        type: domain === 'healthcare' ? 'clinic' : 'studio',
        capacity: 50,
        isActive: true,
        coordinates: {
          latitude: 19.076,
          longitude: 72.8777,
        },
        amenities: ['Parking', 'Wheelchair Access', 'WiFi', 'Cafeteria'],
        operatingHours: {
          monday: { open: '09:00', close: '18:00', isOpen: true },
          tuesday: { open: '09:00', close: '18:00', isOpen: true },
          wednesday: { open: '09:00', close: '18:00', isOpen: true },
          thursday: { open: '09:00', close: '18:00', isOpen: true },
          friday: { open: '09:00', close: '18:00', isOpen: true },
          saturday: { open: '09:00', close: '14:00', isOpen: true },
          sunday: { open: '00:00', close: '00:00', isOpen: false },
        },
      },
      {
        id: 'loc-2',
        name: 'Downtown Branch',
        address: '456 Business District',
        city: 'Mumbai',
        state: 'Maharashtra',
        country: 'India',
        postalCode: '400002',
        phone: '+91-22-87654321',
        email: 'downtown@clinic.com',
        type: domain === 'healthcare' ? 'clinic' : 'studio',
        capacity: 30,
        isActive: true,
        coordinates: {
          latitude: 19.017,
          longitude: 72.8478,
        },
        amenities: ['Parking', 'WiFi'],
        operatingHours: {
          monday: { open: '08:00', close: '20:00', isOpen: true },
          tuesday: { open: '08:00', close: '20:00', isOpen: true },
          wednesday: { open: '08:00', close: '20:00', isOpen: true },
          thursday: { open: '08:00', close: '20:00', isOpen: true },
          friday: { open: '08:00', close: '20:00', isOpen: true },
          saturday: { open: '08:00', close: '16:00', isOpen: true },
          sunday: { open: '00:00', close: '00:00', isOpen: false },
        },
      },
    ];

    return mockLocations;
  }

  private fetchLocationFromDatabase(locationId: string, domain: string): Location | null {
    const locations = this.fetchLocationsFromDatabase(domain);
    return locations.find(loc => loc.id === locationId) || null;
  }

  private fetchDoctorsFromDatabase(
    locationId: string,
    domain: string
  ): AppointmentLocationDoctor[] {
    // This would integrate with the actual database service
    // For now, return mock data
    const mockDoctors: AppointmentLocationDoctor[] = [
      {
        id: 'doc-1',
        name: 'Dr. John Smith',
        specialization: domain === 'healthcare' ? 'Cardiology' : 'Fashion Design',
        licenseNumber: 'MED123456',
        experience: 15,
        rating: 4.8,
      },
      {
        id: 'doc-2',
        name: 'Dr. Sarah Johnson',
        specialization: domain === 'healthcare' ? 'Dermatology' : 'Fashion Styling',
        licenseNumber: 'MED789012',
        experience: 12,
        rating: 4.9,
      },
    ];

    return mockDoctors;
  }

  private calculateLocationStats(): LocationStats {
    // This would integrate with the actual database service
    // For now, return mock statistics
    return {
      totalAppointments: 150,
      totalDoctors: 8,
      averageWaitTime: 12,
      efficiency: 0.85,
      utilization: 0.75,
      patientSatisfaction: 4.6,
    };
  }
}
