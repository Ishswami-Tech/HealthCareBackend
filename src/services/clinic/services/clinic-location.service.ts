import {
  Injectable,
  NotFoundException,
  ConflictException,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaService } from "../../../libs/infrastructure/database/prisma/prisma.service";
import { CreateClinicLocationDto } from "../dto/create-clinic-location.dto";
import { UpdateClinicLocationDto } from "../dto/update-clinic-location.dto";
import { EventService } from "../../../libs/infrastructure/events/event.service";
import { ClinicErrorService } from "../shared/error.utils";
import { QrService } from "../../../libs/utils/QR/qr.service";
import { LoggingService } from "../../../libs/infrastructure/logging/logging.service";
import {
  LogType,
  LogLevel,
} from "../../../libs/infrastructure/logging/types/logging.types";
import { RbacService } from "../../../libs/core/rbac/rbac.service";
import { resolveClinicUUID } from "../../../libs/utils/clinic.utils";
// import { ClinicLocation, QRCodeData } from "src/libs/core/types/clinic.types";

// Define types locally since the import path is not working
export interface ClinicLocation {
  id: string;
  locationId: string;
  name: string;
  address: string;
  city: string;
  state: string;
  country: string;
  zipCode?: string;
  phone?: string;
  email?: string;
  timezone: string;
  workingHours: Record<string, { start: string; end: string } | null>;
  isActive: boolean;
  doctors: Array<{
    id: string;
    name: string;
    profilePicture?: string;
  }>;
}

export interface QRCodeData {
  locationId: string;
  clinicId: string;
  timestamp: string;
}

@Injectable()
export class ClinicLocationService {
  constructor(
    private prisma: PrismaService,
    private readonly eventService: EventService,
    private readonly errorService: ClinicErrorService,
    private readonly qrService: QrService,
    private readonly loggingService: LoggingService,
    private readonly rbacService: RbacService,
  ) {}

  private async generateLocationId(): Promise<string> {
    const lastLocation = await this.prisma.clinicLocation.findFirst({
      orderBy: { locationId: "desc" },
    });

    if (!lastLocation) {
      return "LOC0001";
    }

    const lastNumber = parseInt(lastLocation.locationId.slice(3));
    const newNumber = lastNumber + 1;
    return `LOC${newNumber.toString().padStart(4, "0")}`;
  }

  async createLocation(
    clinicId: string,
    createLocationDto: CreateClinicLocationDto,
    userId: string,
  ): Promise<ClinicLocation> {
    try {
      // Check if the user has permission to add locations to this clinic
      const hasPermission = await this.rbacService.checkPermission({
        userId,
        resource: "clinic",
        action: "manage_clinic_staff",
        resourceId: clinicId,
      });
      if (!hasPermission) {
        throw new UnauthorizedException(
          "You do not have permission to add locations to this clinic",
        );
      }

      // Check if a location with the same name already exists for this clinic
      const existingLocation = await this.prisma.clinicLocation.findFirst({
        where: {
          clinicId,
          name: createLocationDto.name,
        },
      });

      if (existingLocation) {
        throw new ConflictException(
          "A location with this name already exists for this clinic",
        );
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
          timezone: createLocationDto.timezone || "UTC",
          workingHours: createLocationDto.workingHours || {
            monday: { start: "09:00", end: "17:00" },
            tuesday: { start: "09:00", end: "17:00" },
            wednesday: { start: "09:00", end: "17:00" },
            thursday: { start: "09:00", end: "17:00" },
            friday: { start: "09:00", end: "17:00" },
            saturday: { start: "09:00", end: "13:00" },
            sunday: null,
          },
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
                      profilePicture: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      const formattedLocation: ClinicLocation = {
        id: location.id,
        locationId: location.locationId,
        name: location.name,
        address: location.address,
        city: location.city,
        state: location.state,
        country: location.country,
        zipCode: location.zipCode || undefined,
        phone: location.phone || undefined,
        email: location.email || undefined,
        timezone: location.timezone || "UTC",
        workingHours: location.workingHours,
        isActive: location.isActive,
        doctors: (
          (location as Record<string, unknown>).doctorClinic as unknown[]
        ).map((dc: unknown) => ({
          id: (
            (dc as Record<string, unknown>).doctor as Record<string, unknown>
          ).id as string,
          name: `${(((dc as Record<string, unknown>).doctor as Record<string, unknown>).user as Record<string, unknown>).firstName as string} ${(((dc as Record<string, unknown>).doctor as Record<string, unknown>).user as Record<string, unknown>).lastName as string}`,
          profilePicture:
            ((
              (
                (dc as Record<string, unknown>).doctor as Record<
                  string,
                  unknown
                >
              ).user as Record<string, unknown>
            ).profilePicture as string) || undefined,
        })),
      };

      await this.eventService.emit("clinic.location.created", {
        clinicId,
        locationId: location.id,
        name: location.name,
        createdBy: userId,
      });

      return formattedLocation;
    } catch (_error) {
      await this.errorService.logError(
        _error,
        "ClinicLocationService",
        "create clinic location",
        { clinicId, ...createLocationDto },
      );
      throw _error;
    }
  }

  async getLocations(
    clinicId: string,
    userId: string,
  ): Promise<ClinicLocation[]> {
    const clinicUUID = await resolveClinicUUID(this.prisma, clinicId);
    try {
      // Check if the user has permission to view this clinic's locations
      const hasPermission = await this.rbacService.checkPermission({
        userId,
        resource: "clinic",
        action: "manage_clinic_staff",
        resourceId: clinicUUID,
      });
      if (!hasPermission) {
        throw new UnauthorizedException(
          "You do not have permission to view locations for this clinic",
        );
      }

      const locations = await this.prisma.clinicLocation.findMany({
        where: {
          clinicId: clinicUUID,
          isActive: true,
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
                      profilePicture: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: {
          locationId: "asc",
        },
      });

      return locations.map((location: unknown) => ({
        id: (location as Record<string, unknown>).id as string,
        locationId: (location as Record<string, unknown>).locationId as string,
        name: (location as Record<string, unknown>).name as string,
        address: (location as Record<string, unknown>).address as string,
        city: (location as Record<string, unknown>).city as string,
        state: (location as Record<string, unknown>).state as string,
        country: (location as Record<string, unknown>).country as string,
        zipCode:
          ((location as Record<string, unknown>).zipCode as string) ||
          undefined,
        phone:
          ((location as Record<string, unknown>).phone as string) || undefined,
        email:
          ((location as Record<string, unknown>).email as string) || undefined,
        timezone:
          ((location as Record<string, unknown>).timezone as string) || "UTC",
        workingHours: (location as Record<string, unknown>)
          .workingHours as Record<
          string,
          { start: string; end: string } | null
        >,
        isActive: (location as Record<string, unknown>).isActive as boolean,
        doctors: (
          (location as Record<string, unknown>).doctorClinic as unknown[]
        ).map((dc: unknown) => ({
          id: (
            (dc as Record<string, unknown>).doctor as Record<string, unknown>
          ).id as string,
          name: `${(((dc as Record<string, unknown>).doctor as Record<string, unknown>).user as Record<string, unknown>).firstName as string} ${(((dc as Record<string, unknown>).doctor as Record<string, unknown>).user as Record<string, unknown>).lastName as string}`,
          profilePicture:
            ((
              (
                (dc as Record<string, unknown>).doctor as Record<
                  string,
                  unknown
                >
              ).user as Record<string, unknown>
            ).profilePicture as string) || undefined,
        })),
      }));
    } catch (_error) {
      await this.errorService.logError(
        _error,
        "ClinicLocationService",
        "retrieve clinic locations",
        { clinicId },
      );
      throw _error;
    }
  }

  async getLocationById(
    id: string,
    clinicId: string,
    userId: string,
  ): Promise<ClinicLocation> {
    const clinicUUID = await resolveClinicUUID(this.prisma, clinicId);
    try {
      // Check if the user has permission to view this clinic's locations
      const hasPermission = await this.rbacService.checkPermission({
        userId,
        resource: "clinic",
        action: "manage_clinic_staff",
        resourceId: clinicUUID,
      });
      if (!hasPermission) {
        throw new UnauthorizedException(
          "You do not have permission to view locations for this clinic",
        );
      }

      const location = await this.prisma.clinicLocation.findFirst({
        where: {
          id,
          clinicId: clinicUUID,
          isActive: true,
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
                      profilePicture: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!location) {
        throw new NotFoundException("Location not found");
      }

      return {
        id: location.id,
        locationId: location.locationId,
        name: location.name,
        address: location.address,
        city: location.city,
        state: location.state,
        country: location.country,
        zipCode: location.zipCode || undefined,
        phone: location.phone || undefined,
        email: location.email || undefined,
        timezone: location.timezone || "UTC",
        workingHours: location.workingHours,
        isActive: location.isActive,
        doctors: (
          (location as Record<string, unknown>).doctorClinic as unknown[]
        ).map((dc: unknown) => ({
          id: (
            (dc as Record<string, unknown>).doctor as Record<string, unknown>
          ).id as string,
          name: `${(((dc as Record<string, unknown>).doctor as Record<string, unknown>).user as Record<string, unknown>).firstName as string} ${(((dc as Record<string, unknown>).doctor as Record<string, unknown>).user as Record<string, unknown>).lastName as string}`,
          profilePicture:
            ((
              (
                (dc as Record<string, unknown>).doctor as Record<
                  string,
                  unknown
                >
              ).user as Record<string, unknown>
            ).profilePicture as string) || undefined,
        })),
      };
    } catch (_error) {
      await this.errorService.logError(
        _error,
        "ClinicLocationService",
        "retrieve clinic location",
        { clinicId, locationId: id },
      );
      throw _error;
    }
  }

  async generateLocationQR(
    locationId: string,
    clinicId: string,
    userId: string,
  ): Promise<string> {
    try {
      const location = await this.getLocationById(locationId, clinicId, userId);

      const qrData: QRCodeData = {
        locationId: location.locationId,
        clinicId,
        timestamp: new Date().toISOString(),
      };

      const qrCode = await this.qrService.generateQR(JSON.stringify(qrData));

      this.loggingService.log(
        LogType.APPOINTMENT,
        LogLevel.INFO,
        "Generated QR code for location",
        "ClinicLocationService",
        { locationId, clinicId },
      );

      return qrCode;
    } catch (_error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to generate location QR: ${_error instanceof Error ? _error.message : "Unknown _error"}`,
        "ClinicLocationService",
        {
          locationId,
          _error: _error instanceof Error ? _error.stack : "",
        },
      );
      throw _error;
    }
  }

  async verifyLocationQR(
    qrData: string,
    userId: string,
  ): Promise<ClinicLocation> {
    try {
      const data: QRCodeData = JSON.parse(qrData);

      // Find the location using the locationId from QR code
      const location = await this.prisma.clinicLocation.findFirst({
        where: { locationId: data.locationId },
      });

      if (!location) {
        throw new NotFoundException("Location not found");
      }

      // Check if user has permission to access this clinic's locations
      const hasPermission = await this.rbacService.checkPermission({
        userId,
        resource: "clinic",
        action: "manage_clinic_staff",
        resourceId: data.clinicId,
      });
      if (!hasPermission) {
        throw new UnauthorizedException(
          "You do not have permission to access this location",
        );
      }

      // Verify the location belongs to the correct clinic
      if (location.clinicId !== data.clinicId) {
        throw new Error("Invalid QR code: location does not match clinic");
      }

      // Verify the QR code is not too old (e.g., within 5 minutes)
      const timestamp = new Date(data.timestamp);
      const now = new Date();
      const fiveMinutes = 5 * 60 * 1000;
      if (now.getTime() - timestamp.getTime() > fiveMinutes) {
        throw new Error("QR code has expired");
      }

      return this.getLocationById(location.id, location.clinicId, userId);
    } catch (_error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to verify location QR: ${_error instanceof Error ? _error.message : "Unknown _error"}`,
        "ClinicLocationService",
        { _error: _error instanceof Error ? _error.stack : "" },
      );
      throw _error;
    }
  }

  async updateLocation(
    id: string,
    clinicId: string,
    updateLocationDto: UpdateClinicLocationDto,
    userId: string,
  ): Promise<ClinicLocation> {
    try {
      // Check if the user has permission to update this clinic's locations
      const hasPermission = await this.rbacService.checkPermission({
        userId,
        resource: "clinic",
        action: "manage_clinic_staff",
        resourceId: clinicId,
      });
      if (!hasPermission) {
        throw new UnauthorizedException(
          "You do not have permission to update locations for this clinic",
        );
      }

      // Check if the location exists
      const location = await this.prisma.clinicLocation.findFirst({
        where: {
          id,
          clinicId,
          isActive: true,
        },
      });

      if (!location) {
        throw new NotFoundException("Location not found");
      }

      // If updating the name, check if another location already has this name
      if (updateLocationDto.name && updateLocationDto.name !== location.name) {
        const existingLocation = await this.prisma.clinicLocation.findFirst({
          where: {
            clinicId,
            name: updateLocationDto.name,
            id: { not: id },
            isActive: true,
          },
        });

        if (existingLocation) {
          throw new ConflictException(
            "Another location with this name already exists for this clinic",
          );
        }
      }

      // Update the location
      const updatedLocation = await this.prisma.clinicLocation.update({
        where: { id },
        data: {
          ...updateLocationDto,
          updatedAt: new Date(),
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
                      profilePicture: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      await this.eventService.emit("clinic.location.updated", {
        clinicId,
        locationId: id,
        updatedFields: Object.keys(updateLocationDto),
        updatedBy: userId,
      });

      return {
        id: updatedLocation.id,
        locationId: updatedLocation.locationId,
        name: updatedLocation.name,
        address: updatedLocation.address,
        city: updatedLocation.city,
        state: updatedLocation.state,
        country: updatedLocation.country,
        zipCode: updatedLocation.zipCode || undefined,
        phone: updatedLocation.phone || undefined,
        email: updatedLocation.email || undefined,
        timezone: updatedLocation.timezone || "UTC",
        workingHours: updatedLocation.workingHours,
        isActive: updatedLocation.isActive,
        doctors: updatedLocation.doctorClinic.map((dc: unknown) => ({
          id: (
            (dc as Record<string, unknown>).doctor as Record<string, unknown>
          ).id as string,
          name: `${(((dc as Record<string, unknown>).doctor as Record<string, unknown>).user as Record<string, unknown>).firstName as string} ${(((dc as Record<string, unknown>).doctor as Record<string, unknown>).user as Record<string, unknown>).lastName as string}`,
          profilePicture:
            ((
              (
                (dc as Record<string, unknown>).doctor as Record<
                  string,
                  unknown
                >
              ).user as Record<string, unknown>
            ).profilePicture as string) || undefined,
        })),
      };
    } catch (_error) {
      await this.errorService.logError(
        _error,
        "ClinicLocationService",
        "update clinic location",
        { clinicId, locationId: id, ...updateLocationDto },
      );
      throw _error;
    }
  }

  async deleteLocation(
    id: string,
    clinicId: string,
    userId: string,
  ): Promise<{ message: string }> {
    try {
      // Check if the user has permission to delete locations for this clinic
      const hasPermission = await this.rbacService.checkPermission({
        userId,
        resource: "clinic",
        action: "manage_clinic_staff",
        resourceId: clinicId,
      });
      if (!hasPermission) {
        throw new UnauthorizedException(
          "You do not have permission to delete locations for this clinic",
        );
      }

      // Check if the location exists
      const location = await this.prisma.clinicLocation.findFirst({
        where: {
          id,
          clinicId,
          isActive: true,
        },
      });

      if (!location) {
        throw new NotFoundException("Location not found");
      }

      // Check if this is the only active location for the clinic
      const activeLocationsCount = await this.prisma.clinicLocation.count({
        where: {
          clinicId,
          isActive: true,
        },
      });

      if (activeLocationsCount === 1) {
        throw new ConflictException(
          "Cannot delete the only active location for a clinic",
        );
      }

      // Soft delete the location by marking it as inactive
      await this.prisma.clinicLocation.update({
        where: { id },
        data: {
          isActive: false,
          updatedAt: new Date(),
        },
      });

      await this.eventService.emit("clinic.location.deleted", {
        clinicId,
        locationId: id,
        deletedBy: userId,
      });

      return { message: "Location deleted successfully" };
    } catch (_error) {
      await this.errorService.logError(
        _error,
        "ClinicLocationService",
        "delete clinic location",
        { clinicId, locationId: id },
      );
      throw _error;
    }
  }
}
