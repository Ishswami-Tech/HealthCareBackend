import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../../../libs/infrastructure/database";
import { LoggingService } from "../../../libs/infrastructure/logging";
import {
  LogType,
  LogLevel,
} from "../../../libs/infrastructure/logging/types/logging.types";
import {
  ClinicLocationCreateInput,
  ClinicLocationUpdateInput,
  ClinicLocationResponseDto,
} from "../types/clinic-location.types";

@Injectable()
export class ClinicLocationService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService,
  ) {}

  async createClinicLocation(
    data: ClinicLocationCreateInput,
    _userId: string,
  ): Promise<ClinicLocationResponseDto> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();

      const clinicLocation = await prismaClient.clinicLocation.create({
        data: {
          ...data,
          workingHours: data.workingHours || "9:00 AM - 5:00 PM",
          isActive: data.isActive ?? true,
        },
      });

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Clinic location created: ${clinicLocation.id}`,
        "ClinicLocationService",
        { locationId: clinicLocation.id },
      );

      return clinicLocation as ClinicLocationResponseDto;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create clinic location: ${(error as Error).message}`,
        "ClinicLocationService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async getLocations(
    clinicId: string,
    includeDoctors = false,
  ): Promise<ClinicLocationResponseDto[]> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();

      const include = includeDoctors
        ? {
            doctorClinic: {
              include: {
                doctor: {
                  include: {
                    user: {
                      select: {
                        id: true,
                        name: true,
                        email: true,
                      },
                    },
                  },
                },
              },
            },
          }
        : undefined;

      const locations = await prismaClient.clinicLocation.findMany({
        where: {
          clinicId,
          isActive: true,
        },
        include,
      });

      return locations as ClinicLocationResponseDto[];
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get locations: ${(error as Error).message}`,
        "ClinicLocationService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async getClinicLocationById(
    id: string,
    includeDoctors = false,
  ): Promise<ClinicLocationResponseDto | null> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();

      const include = includeDoctors
        ? {
            doctorClinic: {
              include: {
                doctor: {
                  include: {
                    user: {
                      select: {
                        id: true,
                        name: true,
                        email: true,
                      },
                    },
                  },
                },
              },
            },
          }
        : undefined;

      const location = await prismaClient.clinicLocation.findFirst({
        where: { id },
        include,
      });

      return location as ClinicLocationResponseDto | null;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic location: ${(error as Error).message}`,
        "ClinicLocationService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async updateLocation(
    id: string,
    data: ClinicLocationUpdateInput,
    _userId: string,
  ): Promise<ClinicLocationResponseDto> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();

      const location = await prismaClient.clinicLocation.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Clinic location updated: ${location.id}`,
        "ClinicLocationService",
        { locationId: location.id },
      );

      return location as ClinicLocationResponseDto;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update clinic location: ${(error as Error).message}`,
        "ClinicLocationService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async deleteLocation(id: string, _userId: string): Promise<void> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();

      await prismaClient.clinicLocation.update({
        where: { id },
        data: {
          isActive: false,
          updatedAt: new Date(),
        },
      });

      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Clinic location deactivated: ${id}`,
        "ClinicLocationService",
        { locationId: id },
      );
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to delete clinic location: ${(error as Error).message}`,
        "ClinicLocationService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }

  async getLocationCount(clinicId: string): Promise<number> {
    try {
      const prismaClient = this.databaseService.getPrismaClient();

      const count = await prismaClient.clinicLocation.count({
        where: {
          clinicId,
          isActive: true,
        },
      });

      return count;
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get location count: ${(error as Error).message}`,
        "ClinicLocationService",
        { error: (error as Error).stack },
      );
      throw error;
    }
  }
}
