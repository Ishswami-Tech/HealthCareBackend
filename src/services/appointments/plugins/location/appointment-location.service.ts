import { nowIso } from '@utils/date-time.util';
import { Injectable, NotFoundException, Optional, Inject, forwardRef } from '@nestjs/common';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LocationCacheService } from '@infrastructure/cache/services/location-cache.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { DatabaseService } from '@infrastructure/database';
import { ClinicLocationService } from '@services/clinic/services/clinic-location.service';
import type { ClinicLocationResponseDto } from '@core/types/clinic.types';

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
  private readonly DOCTORS_CACHE_TTL = 1800; // 30 minutes
  private readonly STATS_CACHE_TTL = 300; // 5 minutes

  constructor(
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
    private readonly databaseService: DatabaseService,
    @Optional()
    @Inject(forwardRef(() => LocationCacheService))
    private readonly locationCacheService?: LocationCacheService,
    @Optional()
    @Inject(forwardRef(() => ClinicLocationService))
    private readonly clinicLocationService?: ClinicLocationService
  ) {}

  async getAllLocations(domain: string, clinicId?: string): Promise<unknown> {
    const startTime = Date.now();

    try {
      // If clinicId provided, use shared cache and clinic service first
      if (clinicId && this.locationCacheService) {
        const cached = await this.locationCacheService.getLocationsByClinic(clinicId, false);
        if (cached) {
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.INFO,
            'Locations retrieved from shared cache',
            'AppointmentLocationService',
            { domain, clinicId, responseTime: Date.now() - startTime }
          );
          return {
            locations: cached.map(location => this.toAppointmentLocation(location, domain)),
            total: cached.length,
            domain,
            retrievedAt: nowIso(),
          };
        }

        // Cache miss - fetch from ClinicLocationService
        if (this.clinicLocationService) {
          const locations = await this.clinicLocationService.getLocations(clinicId, false);
          const result = {
            locations: locations.map(location => this.toAppointmentLocation(location, domain)),
            total: locations.length,
            domain,
            retrievedAt: nowIso(),
          };
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.INFO,
            'Locations retrieved from database',
            'AppointmentLocationService',
            {
              domain,
              clinicId,
              count: locations.length,
              responseTime: Date.now() - startTime,
            }
          );
          return result;
        }
      }

      // Direct database read when clinic-scoped services are unavailable
      const cacheKey = `locations:${domain}`;
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

      const locations = await this.fetchLocationsFromDatabase(clinicId, domain);

      const result = {
        locations,
        total: locations.length,
        domain,
        retrievedAt: nowIso(),
      };

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(result), 3600);

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
          clinicId,
          _error: _error instanceof Error ? _error.stack : undefined,
        }
      );
      throw _error;
    }
  }

  async getLocationById(locationId: string, domain: string, clinicId?: string): Promise<unknown> {
    const startTime = Date.now();

    try {
      // Use LocationCacheService for shared cache (single source of truth)
      if (this.locationCacheService) {
        const cached = await this.locationCacheService.getLocation(locationId, false, clinicId);
        if (cached) {
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.INFO,
            'Location retrieved from shared cache',
            'AppointmentLocationService',
            { locationId, domain, clinicId, responseTime: Date.now() - startTime }
          );
          return {
            location: this.toAppointmentLocation(cached, domain),
            domain,
            retrievedAt: nowIso(),
          };
        }

        // Cache miss - fetch from ClinicLocationService
        if (this.clinicLocationService) {
          const location = await this.clinicLocationService.getClinicLocationById(
            locationId,
            false,
            clinicId
          );
          if (!location) {
            throw new NotFoundException(`Location not found: ${locationId}`);
          }

          const result = {
            location: this.toAppointmentLocation(location, domain),
            domain,
            retrievedAt: nowIso(),
          };

          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.INFO,
            'Location retrieved from database',
            'AppointmentLocationService',
            { locationId, domain, clinicId, responseTime: Date.now() - startTime }
          );

          return result;
        }
      }

      // Fallback to original implementation if services not available
      const cacheKey = `location:${locationId}:${domain}`;
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      // Get location from database
      const location = await this.fetchLocationFromDatabase(locationId, clinicId, domain);

      if (!location) {
        throw new NotFoundException(`Location not found: ${locationId}`);
      }

      const result = {
        location,
        domain,
        retrievedAt: nowIso(),
      };

      // Cache the result
      await this.cacheService.set(cacheKey, JSON.stringify(result), 3600);

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
          clinicId,
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

      // Get doctors from database
      const doctors = await this.fetchDoctorsFromDatabase(locationId);

      const result = {
        doctors,
        locationId,
        domain,
        total: doctors.length,
        retrievedAt: nowIso(),
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

      const stats = await this.calculateLocationStats(locationId);

      const result = {
        locationId,
        domain,
        stats,
        calculatedAt: nowIso(),
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

  async invalidateLocationsCache(
    domain: string,
    clinicId?: string,
    locationId?: string
  ): Promise<unknown> {
    const startTime = Date.now();

    try {
      // Invalidate shared location cache if locationId provided
      if (locationId && this.locationCacheService) {
        await this.locationCacheService.invalidateLocation(locationId, clinicId);
      }

      // Invalidate domain-specific caches
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
        { domain, clinicId, locationId, responseTime: Date.now() - startTime }
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
          clinicId,
          locationId,
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

  private async fetchLocationsFromDatabase(
    clinicId: string | undefined,
    domain: string
  ): Promise<Location[]> {
    const rows = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as {
        clinicLocation: {
          findMany: (args: unknown) => Promise<
            Array<{
              id: string;
              locationId: string;
              name: string;
              address: string;
              city: string;
              state: string;
              country: string;
              zipCode: string | null;
              phone: string | null;
              email: string | null;
              isActive: boolean;
              clinicId: string;
              latitude: number | null;
              longitude: number | null;
              timezone: string | null;
              workingHours: unknown;
              settings: Record<string, unknown> | null;
            }>
          >;
        };
      };

      return await typedClient.clinicLocation.findMany({
        where: {
          ...(clinicId ? { clinicId } : {}),
          isActive: true,
        },
        orderBy: { name: 'asc' },
      });
    });

    return rows.map(location => this.toAppointmentLocation(location, domain));
  }

  private async fetchLocationFromDatabase(
    locationId: string,
    clinicId: string | undefined,
    domain: string
  ): Promise<Location | null> {
    const location = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as {
        clinicLocation: {
          findFirst: (args: unknown) => Promise<{
            id: string;
            locationId: string;
            name: string;
            address: string;
            city: string;
            state: string;
            country: string;
            zipCode: string | null;
            phone: string | null;
            email: string | null;
            isActive: boolean;
            clinicId: string;
            latitude: number | null;
            longitude: number | null;
            timezone: string | null;
            workingHours: unknown;
            settings: Record<string, unknown> | null;
          } | null>;
        };
      };

      return await typedClient.clinicLocation.findFirst({
        where: {
          locationId,
          ...(clinicId ? { clinicId } : {}),
          isActive: true,
        },
      });
    });

    return location ? this.toAppointmentLocation(location, domain) : null;
  }

  private async fetchDoctorsFromDatabase(locationId: string): Promise<AppointmentLocationDoctor[]> {
    const location = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as {
        clinicLocation: {
          findFirst: (args: unknown) => Promise<{
            doctorClinic: Array<{
              doctor: {
                id: string;
                specialization: string;
                experience: number;
                qualification: string | null;
                rating: number | null;
                user: { name: string };
              };
            }>;
          } | null>;
        };
      };

      return await typedClient.clinicLocation.findFirst({
        where: { locationId, isActive: true },
        include: {
          doctorClinic: {
            include: {
              doctor: {
                include: {
                  user: {
                    select: { name: true },
                  },
                },
              },
            },
          },
        },
      });
    });

    const doctorClinics = location?.doctorClinic || [];
    return doctorClinics.map(entry => ({
      id: entry.doctor.id,
      name: entry.doctor.user?.name || `Doctor ${entry.doctor.id}`,
      specialization: entry.doctor.specialization,
      ...(entry.doctor.qualification ? { licenseNumber: entry.doctor.qualification } : {}),
      experience: entry.doctor.experience,
      rating: entry.doctor.rating ?? 0,
    }));
  }

  private async calculateLocationStats(locationId: string): Promise<LocationStats> {
    const location = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as {
        appointment: {
          findMany: (args: unknown) => Promise<
            Array<{
              status: string;
              date: Date;
              checkedInAt: Date | null;
            }>
          >;
        };
        clinicLocation: {
          findFirst: (args: unknown) => Promise<{
            doctorClinic: Array<{
              doctor: {
                rating: number | null;
              };
            }>;
          } | null>;
        };
      };

      const [appointments, clinicLocation] = await Promise.all([
        typedClient.appointment.findMany({
          where: { locationId },
          select: {
            status: true,
            date: true,
            checkedInAt: true,
          },
        }),
        typedClient.clinicLocation.findFirst({
          where: { locationId, isActive: true },
          include: {
            doctorClinic: {
              include: {
                doctor: {
                  select: {
                    rating: true,
                  },
                },
              },
            },
          },
        }),
      ]);

      const totalAppointments = appointments.length;
      const completedAppointments = appointments.filter(app => app.status === 'COMPLETED').length;
      const waitTimes = appointments
        .filter(app => app.checkedInAt)
        .map(app => Math.max(0, (app.checkedInAt as Date).getTime() - app.date.getTime()) / 60000);
      const averageWaitTime =
        waitTimes.length > 0
          ? Math.round(waitTimes.reduce((sum, value) => sum + value, 0) / waitTimes.length)
          : 0;
      const totalDoctors = clinicLocation?.doctorClinic?.length || 0;
      const ratingValues =
        clinicLocation?.doctorClinic
          ?.map(entry => entry.doctor.rating)
          .filter(
            (rating): rating is number => typeof rating === 'number' && Number.isFinite(rating)
          )
          .filter(rating => rating > 0) || [];
      const patientSatisfaction =
        ratingValues.length > 0
          ? Number(
              (ratingValues.reduce((sum, rating) => sum + rating, 0) / ratingValues.length).toFixed(
                1
              )
            )
          : 0;

      return {
        totalAppointments,
        totalDoctors,
        averageWaitTime,
        efficiency:
          totalAppointments > 0
            ? Number((completedAppointments / totalAppointments).toFixed(2))
            : 0,
        utilization:
          totalDoctors > 0
            ? Number(Math.min(1, totalAppointments / Math.max(1, totalDoctors * 20)).toFixed(2))
            : 0,
        patientSatisfaction,
      } as LocationStats;
    });

    return location;
  }

  private toAppointmentLocation(
    location:
      | ClinicLocationResponseDto
      | {
          id: string;
          locationId: string;
          name: string;
          address: string;
          city: string;
          state: string;
          country: string;
          zipCode: string | null;
          phone: string | null;
          email: string | null;
          isActive: boolean;
          clinicId: string;
          latitude: number | null;
          longitude: number | null;
          timezone: string | null;
          workingHours: unknown;
          settings: Record<string, unknown> | null;
        },
    domain: string
  ): Location {
    const rawLocation = location as unknown as {
      id: string;
      locationId?: string;
      name: string;
      address: string;
      city: string;
      state: string;
      country: string;
      zipCode?: string | null;
      phone?: string | null;
      email?: string | null;
      isActive: boolean;
      latitude?: number | null;
      longitude?: number | null;
      workingHours?: unknown;
      settings?: Record<string, unknown> | null;
    };
    const operatingHours = this.toOperatingHours(rawLocation.workingHours);

    return {
      id: rawLocation.id,
      name: rawLocation.name,
      address: rawLocation.address,
      city: rawLocation.city,
      state: rawLocation.state,
      country: rawLocation.country,
      postalCode: rawLocation.zipCode || '',
      phone: rawLocation.phone || '',
      type: this.resolveLocationType(domain),
      capacity: this.getLocationCapacity(rawLocation.settings || null),
      isActive: rawLocation.isActive,
      ...(rawLocation.email ? { email: rawLocation.email } : {}),
      ...(rawLocation.latitude !== null &&
      rawLocation.longitude !== null &&
      rawLocation.latitude !== undefined &&
      rawLocation.longitude !== undefined
        ? {
            coordinates: {
              latitude: rawLocation.latitude,
              longitude: rawLocation.longitude,
            },
          }
        : {}),
      amenities: this.getAmenities(rawLocation.settings || null),
      operatingHours,
    };
  }

  private resolveLocationType(domain: string): Location['type'] {
    const normalizedDomain = domain.trim().toLowerCase();

    switch (normalizedDomain) {
      case 'studio':
        return 'studio';
      case 'hospital':
        return 'hospital';
      case 'outpatient':
        return 'outpatient';
      case 'healthcare':
      case 'clinic':
      default:
        return 'clinic';
    }
  }

  private toOperatingHours(workingHours: unknown): Location['operatingHours'] {
    const defaultHours = {
      monday: { open: '09:00', close: '17:00', isOpen: true },
      tuesday: { open: '09:00', close: '17:00', isOpen: true },
      wednesday: { open: '09:00', close: '17:00', isOpen: true },
      thursday: { open: '09:00', close: '17:00', isOpen: true },
      friday: { open: '09:00', close: '17:00', isOpen: true },
      saturday: { open: '09:00', close: '13:00', isOpen: true },
      sunday: { open: '00:00', close: '00:00', isOpen: false },
    };

    if (!workingHours || typeof workingHours !== 'object') {
      return defaultHours;
    }

    return {
      ...defaultHours,
      ...(workingHours as Record<string, { open?: string; close?: string; isOpen?: boolean }>),
    };
  }

  private getLocationCapacity(settings: Record<string, unknown> | null): number {
    const rawCapacity = settings?.['capacity'];
    if (typeof rawCapacity === 'number' && Number.isFinite(rawCapacity)) {
      return rawCapacity;
    }

    const fallbackCapacity = settings?.['maxAppointments'];
    if (typeof fallbackCapacity === 'number' && Number.isFinite(fallbackCapacity)) {
      return fallbackCapacity;
    }

    return 0;
  }

  private getAmenities(settings: Record<string, unknown> | null): string[] {
    const amenities = settings?.['amenities'];
    if (Array.isArray(amenities)) {
      return amenities.filter((item): item is string => typeof item === 'string');
    }

    return [];
  }
}
