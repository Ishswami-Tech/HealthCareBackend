/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-floating-promises */
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { DatabaseService } from "../../../../libs/infrastructure/database";
import { CacheService } from "../../../../libs/infrastructure/cache";
import { LoggingService } from "../../../../libs/infrastructure/logging/logging.service";
import { LogType, LogLevel } from "../../../../libs/infrastructure/logging";
// Local type definitions for Check-In models
export interface CheckInLocation {
  id: string;
  clinicId: string;
  locationName: string;
  coordinates: Record<string, number>;
  radius: number;
  isActive: boolean;
  qrCode?: string | null;
  qrCodeExpiry?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CheckIn {
  id: string;
  appointmentId: string;
  locationId: string;
  checkInTime: Date;
  isVerified: boolean;
  verifiedBy?: string | null;
  coordinates?: Record<string, number> | null;
  deviceInfo?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCheckInLocationDto {
  clinicId: string;
  locationName: string;
  coordinates: { lat: number; lng: number };
  radius: number; // in meters
}

export interface UpdateCheckInLocationDto {
  locationName?: string;
  coordinates?: { lat: number; lng: number };
  radius?: number;
  isActive?: boolean;
}

export interface ProcessCheckInDto {
  appointmentId: string;
  locationId: string;
  patientId: string;
  coordinates?: { lat: number; lng: number };
  deviceInfo?: Record<string, unknown>;
  qrCode?: string;
}

export interface VerifyCheckInDto {
  checkInId: string;
  verifiedBy: string;
  notes?: string;
}

export interface CheckInValidation {
  isValid: boolean;
  distance?: number;
  message: string;
}

@Injectable()
export class CheckInLocationService {
  private readonly logger = new Logger(CheckInLocationService.name);
  private readonly LOCATION_CACHE_TTL = 3600; // 1 hour
  private readonly CHECKIN_CACHE_TTL = 1800; // 30 minutes

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly cacheService: CacheService,
    private readonly loggingService: LoggingService,
  ) {}

  /**
   * Create a new check-in location
   */
  async createCheckInLocation(
    data: CreateCheckInLocationDto,
  ): Promise<CheckInLocation> {
    const startTime = Date.now();

    try {
      // Generate QR code (unique identifier)
      const qrCode = this.generateQRCode(data.clinicId, data.locationName);

      const location = await this.databaseService
        .getPrismaClient()
        .checkInLocation.create({
          data: {
            clinicId: data.clinicId,
            locationName: data.locationName,
            qrCode,
            coordinates: data.coordinates as any,
            radius: data.radius,
          },
        });

      // Invalidate cache
      await this.cacheService.invalidateByPattern(
        `checkin-locations:clinic:${data.clinicId}*`,
      );

      this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        "Check-in location created successfully",
        "CheckInLocationService",
        {
          locationId: location.id,
          locationName: data.locationName,
          clinicId: data.clinicId,
          responseTime: Date.now() - startTime,
        },
      );

      return location;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create check-in location: ${error instanceof Error ? error.message : String(error)}`,
        "CheckInLocationService",
        {
          data,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Get all check-in locations for a clinic
   */
  async getClinicLocations(
    clinicId: string,
    isActive?: boolean,
  ): Promise<CheckInLocation[]> {
    const startTime = Date.now();
    const cacheKey = `checkin-locations:clinic:${clinicId}:${isActive ?? "all"}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      const locations = await this.databaseService
        .getPrismaClient()
        .checkInLocation.findMany({
          where: {
            clinicId,
            ...(isActive !== undefined && { isActive }),
          },
          include: {
            checkIns: {
              take: 10,
              orderBy: { checkedInAt: "desc" },
            },
          },
          orderBy: { createdAt: "desc" },
        });

      // Cache the result
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(locations),
        this.LOCATION_CACHE_TTL,
      );

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Clinic check-in locations retrieved successfully",
        "CheckInLocationService",
        {
          clinicId,
          count: locations.length,
          responseTime: Date.now() - startTime,
        },
      );

      return locations;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic locations: ${error instanceof Error ? error.message : String(error)}`,
        "CheckInLocationService",
        {
          clinicId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Get location by QR code
   */
  async getLocationByQRCode(qrCode: string): Promise<CheckInLocation> {
    const startTime = Date.now();
    const cacheKey = `checkin-location:qr:${qrCode}`;

    try {
      // Try to get from cache first
      const cached = await this.cacheService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached as string);
      }

      const location = await this.databaseService
        .getPrismaClient()
        .checkInLocation.findUnique({
          where: { qrCode },
        });

      if (!location) {
        throw new NotFoundException(
          `Location with QR code ${qrCode} not found`,
        );
      }

      if (!location.isActive) {
        throw new BadRequestException("This check-in location is not active");
      }

      // Cache the result
      await this.cacheService.set(
        cacheKey,
        JSON.stringify(location),
        this.LOCATION_CACHE_TTL,
      );

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Location retrieved by QR code",
        "CheckInLocationService",
        {
          locationId: location.id,
          qrCode,
          responseTime: Date.now() - startTime,
        },
      );

      return location;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get location by QR code: ${error instanceof Error ? error.message : String(error)}`,
        "CheckInLocationService",
        {
          qrCode,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Update check-in location
   */
  async updateCheckInLocation(
    locationId: string,
    data: UpdateCheckInLocationDto,
  ): Promise<CheckInLocation> {
    const startTime = Date.now();

    try {
      const location = await this.databaseService
        .getPrismaClient()
        .checkInLocation.update({
          where: { id: locationId },
          data: {
            ...data,
            coordinates: data.coordinates as any,
          },
        });

      // Invalidate cache
      await this.cacheService.del(`checkin-location:${locationId}`);
      await this.cacheService.invalidateByPattern(
        `checkin-locations:clinic:${location.clinicId}*`,
      );
      if (location.qrCode) {
        await this.cacheService.del(`checkin-location:qr:${location.qrCode}`);
      }

      this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        "Check-in location updated successfully",
        "CheckInLocationService",
        {
          locationId,
          responseTime: Date.now() - startTime,
        },
      );

      return location;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update check-in location: ${error instanceof Error ? error.message : String(error)}`,
        "CheckInLocationService",
        {
          locationId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Delete check-in location
   */
  async deleteCheckInLocation(locationId: string): Promise<void> {
    const startTime = Date.now();

    try {
      const location = await this.databaseService
        .getPrismaClient()
        .checkInLocation.findUnique({
          where: { id: locationId },
        });

      if (!location) {
        throw new NotFoundException(`Location with ID ${locationId} not found`);
      }

      await this.databaseService.getPrismaClient().checkInLocation.delete({
        where: { id: locationId },
      });

      // Invalidate cache
      await this.cacheService.del(`checkin-location:${locationId}`);
      await this.cacheService.invalidateByPattern(
        `checkin-locations:clinic:${location.clinicId}*`,
      );
      if (location.qrCode) {
        await this.cacheService.del(`checkin-location:qr:${location.qrCode}`);
      }

      this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        "Check-in location deleted successfully",
        "CheckInLocationService",
        {
          locationId,
          responseTime: Date.now() - startTime,
        },
      );
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to delete check-in location: ${error instanceof Error ? error.message : String(error)}`,
        "CheckInLocationService",
        {
          locationId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  // =============================================
  // CHECK-IN PROCESSING
  // =============================================

  /**
   * Process check-in
   */
  async processCheckIn(data: ProcessCheckInDto): Promise<CheckIn> {
    const startTime = Date.now();

    try {
      // Validate appointment exists
      const appointment = await this.databaseService
        .getPrismaClient()
        .appointment.findUnique({
          where: { id: data.appointmentId },
        });

      if (!appointment) {
        throw new NotFoundException(
          `Appointment with ID ${data.appointmentId} not found`,
        );
      }

      // Check if already checked in
      const existingCheckIn = await this.databaseService
        .getPrismaClient()
        .checkIn.findFirst({
          where: {
            appointmentId: data.appointmentId,
          },
        });

      if (existingCheckIn) {
        throw new BadRequestException("Appointment already checked in");
      }

      // Get location details
      const location = await this.databaseService
        .getPrismaClient()
        .checkInLocation.findUnique({
          where: { id: data.locationId },
        });

      if (!location) {
        throw new NotFoundException(
          `Location with ID ${data.locationId} not found`,
        );
      }

      if (!location.isActive) {
        throw new BadRequestException("Check-in location is not active");
      }

      // Validate location if coordinates provided
      if (data.coordinates) {
        const validation = this.validateLocation(data.coordinates, location);
        if (!validation.isValid) {
          throw new BadRequestException(validation.message);
        }
      }

      // Create check-in
      const checkIn = await this.databaseService
        .getPrismaClient()
        .checkIn.create({
          data: {
            appointmentId: data.appointmentId,
            locationId: data.locationId,
            patientId: data.patientId,
            coordinates: data.coordinates as any,
            deviceInfo: data.deviceInfo as any,
          },
          include: {
            location: true,
            patient: {
              include: {
                user: {
                  select: {
                    name: true,
                    email: true,
                    phone: true,
                  },
                },
              },
            },
            appointment: {
              select: {
                id: true,
                type: true,
                date: true,
                time: true,
              },
            },
          },
        });

      // Update appointment status
      await this.databaseService.getPrismaClient().appointment.update({
        where: { id: data.appointmentId },
        data: {
          checkedInAt: new Date(),
          status: "CHECKED_IN" as any,
        },
      });

      // Invalidate cache
      await this.cacheService.invalidateByPattern(`checkins:*`);

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        "Check-in processed successfully",
        "CheckInLocationService",
        {
          checkInId: checkIn.id,
          appointmentId: data.appointmentId,
          locationId: data.locationId,
          responseTime: Date.now() - startTime,
        },
      );

      return checkIn;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to process check-in: ${error instanceof Error ? error.message : String(error)}`,
        "CheckInLocationService",
        {
          data,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Verify check-in
   */
  async verifyCheckIn(data: VerifyCheckInDto): Promise<CheckIn> {
    const startTime = Date.now();

    try {
      const checkIn = await this.databaseService
        .getPrismaClient()
        .checkIn.update({
          where: { id: data.checkInId },
          data: {
            isVerified: true,
            verifiedBy: data.verifiedBy,
            notes: data.notes,
          },
          include: {
            location: true,
            patient: {
              include: {
                user: {
                  select: {
                    name: true,
                    email: true,
                    phone: true,
                  },
                },
              },
            },
            appointment: true,
          },
        });

      // Invalidate cache
      await this.cacheService.invalidateByPattern(`checkins:*`);

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        "Check-in verified successfully",
        "CheckInLocationService",
        {
          checkInId: data.checkInId,
          verifiedBy: data.verifiedBy,
          responseTime: Date.now() - startTime,
        },
      );

      return checkIn;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to verify check-in: ${error instanceof Error ? error.message : String(error)}`,
        "CheckInLocationService",
        {
          data,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Get check-ins for a location
   */
  async getLocationCheckIns(
    locationId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<CheckIn[]> {
    const startTime = Date.now();

    try {
      const whereClause: any = { locationId };

      if (startDate && endDate) {
        whereClause.checkedInAt = {
          gte: startDate,
          lte: endDate,
        };
      }

      const checkIns = await this.databaseService
        .getPrismaClient()
        .checkIn.findMany({
          where: whereClause,
          include: {
            patient: {
              include: {
                user: {
                  select: {
                    name: true,
                    email: true,
                    phone: true,
                  },
                },
              },
            },
            appointment: {
              select: {
                id: true,
                type: true,
                date: true,
                time: true,
              },
            },
          },
          orderBy: { checkedInAt: "desc" },
        });

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Location check-ins retrieved successfully",
        "CheckInLocationService",
        {
          locationId,
          count: checkIns.length,
          responseTime: Date.now() - startTime,
        },
      );

      return checkIns;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get location check-ins: ${error instanceof Error ? error.message : String(error)}`,
        "CheckInLocationService",
        {
          locationId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  /**
   * Get check-in statistics
   */
  async getCheckInStats(
    locationId: string,
    date?: Date,
  ): Promise<{
    totalCheckIns: number;
    verified: number;
    unverified: number;
    averageCheckInTime: number;
  }> {
    const startTime = Date.now();

    try {
      const whereClause: any = { locationId };

      if (date) {
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        whereClause.checkedInAt = {
          gte: startOfDay,
          lte: endOfDay,
        };
      }

      const checkIns = await this.databaseService
        .getPrismaClient()
        .checkIn.findMany({
          where: whereClause,
        });

      type CheckInWithVerification = { isVerified: boolean };
      const checkInsTyped = checkIns as CheckInWithVerification[];
      const stats = {
        totalCheckIns: checkIns.length,
        verified: checkInsTyped.filter(
          (c: CheckInWithVerification) => c.isVerified,
        ).length,
        unverified: checkInsTyped.filter(
          (c: CheckInWithVerification) => !c.isVerified,
        ).length,
        averageCheckInTime: 0, // Placeholder - would calculate based on actual data
      };

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        "Check-in stats retrieved successfully",
        "CheckInLocationService",
        {
          locationId,
          stats,
          responseTime: Date.now() - startTime,
        },
      );

      return stats;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get check-in stats: ${error instanceof Error ? error.message : String(error)}`,
        "CheckInLocationService",
        {
          locationId,
          error: error instanceof Error ? error.stack : undefined,
        },
      );
      throw error;
    }
  }

  // =============================================
  // HELPER METHODS
  // =============================================

  /**
   * Validate location coordinates
   */
  private validateLocation(
    patientCoords: { lat: number; lng: number },
    location: CheckInLocation,
  ): CheckInValidation {
    const locationCoords = location.coordinates as any;
    const distance = this.calculateDistance(
      patientCoords.lat,
      patientCoords.lng,
      locationCoords.lat,
      locationCoords.lng,
    );

    if (distance > location.radius) {
      return {
        isValid: false,
        distance,
        message: `Patient is ${Math.round(distance)}m away from the check-in location. Maximum allowed distance is ${location.radius}m.`,
      };
    }

    return {
      isValid: true,
      distance,
      message: "Location validated successfully",
    };
  }

  /**
   * Calculate distance between two coordinates using Haversine formula
   */
  private calculateDistance(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lng2 - lng1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }

  /**
   * Generate unique QR code
   */
  private generateQRCode(clinicId: string, locationName: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const nameHash = Buffer.from(locationName)
      .toString("base64")
      .substring(0, 8);
    return `CHK-${clinicId.substring(0, 8)}-${nameHash}-${timestamp}-${random}`;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-floating-promises */
