import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type {
  ClinicLocationCreateInput,
  ClinicLocationUpdateInput,
  ClinicLocationResponseDto,
} from '@core/types/clinic.types';

@Injectable()
export class ClinicLocationService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService
  ) {}

  async createClinicLocation(
    data: ClinicLocationCreateInput,
    _userId: string
  ): Promise<ClinicLocationResponseDto> {
    try {
      // Use executeHealthcareWrite for clinic location creation with full optimization layers
      const clinicLocation = await this.databaseService.executeHealthcareWrite(
        async client => {
          return await client.clinicLocation.create({
            data: {
              ...data,
              workingHours: data.workingHours || '9:00 AM - 5:00 PM',
              isActive: data.isActive ?? true,
            },
          });
        },
        {
          userId: _userId || 'system',
          clinicId: data.clinicId || '',
          resourceType: 'CLINIC_LOCATION',
          operation: 'CREATE',
          resourceId: '',
          userRole: 'system',
          details: { name: data.name, clinicId: data.clinicId },
        }
      );

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Clinic location created: ${clinicLocation.id}`,
        'ClinicLocationService',
        { locationId: clinicLocation.id }
      );

      return clinicLocation as ClinicLocationResponseDto;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create clinic location: ${(error as Error).message}`,
        'ClinicLocationService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async getLocations(
    clinicId: string,
    includeDoctors = false
  ): Promise<ClinicLocationResponseDto[]> {
    try {
      // Use executeHealthcareRead for optimized query
      const queryOptions: {
        where: { clinicId: string; isActive: boolean };
        include?: {
          doctorClinic: {
            include: {
              doctor: {
                include: {
                  user: {
                    select: {
                      id: boolean;
                      name: boolean;
                      email: boolean;
                    };
                  };
                };
              };
            };
          };
        };
      } = {
        where: {
          clinicId,
          isActive: true,
        },
      };

      if (includeDoctors) {
        queryOptions.include = {
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
        };
      }

      const locations = await this.databaseService.executeHealthcareRead(async client => {
        return await client.clinicLocation.findMany(queryOptions);
      });

      return locations as ClinicLocationResponseDto[];
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get locations: ${(error as Error).message}`,
        'ClinicLocationService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async getClinicLocationById(
    id: string,
    includeDoctors = false
  ): Promise<ClinicLocationResponseDto | null> {
    try {
      // Use executeHealthcareRead for optimized query
      const queryOptions: {
        where: { id: string };
        include?: {
          doctorClinic: {
            include: {
              doctor: {
                include: {
                  user: {
                    select: {
                      id: boolean;
                      name: boolean;
                      email: boolean;
                    };
                  };
                };
              };
            };
          };
        };
      } = {
        where: { id },
      };

      if (includeDoctors) {
        queryOptions.include = {
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
        };
      }

      const location = await this.databaseService.executeHealthcareRead(async client => {
        return await client.clinicLocation.findFirst(queryOptions);
      });

      return location as ClinicLocationResponseDto | null;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic location: ${(error as Error).message}`,
        'ClinicLocationService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async updateLocation(
    id: string,
    data: ClinicLocationUpdateInput,
    _userId: string
  ): Promise<ClinicLocationResponseDto> {
    try {
      // Use executeHealthcareWrite for update with full optimization layers
      const location = await this.databaseService.executeHealthcareWrite(
        async client => {
          return await client.clinicLocation.update({
            where: { id },
            data: {
              ...data,
              updatedAt: new Date(),
            },
          });
        },
        {
          userId: _userId || 'system',
          clinicId:
            ('clinicId' in data && typeof data.clinicId === 'string' ? data.clinicId : '') || '',
          resourceType: 'CLINIC_LOCATION',
          operation: 'UPDATE',
          resourceId: id,
          userRole: 'system',
          details: { updateFields: Object.keys(data) },
        }
      );

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Clinic location updated: ${location.id}`,
        'ClinicLocationService',
        { locationId: location.id }
      );

      return location as ClinicLocationResponseDto;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update clinic location: ${(error as Error).message}`,
        'ClinicLocationService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async deleteLocation(id: string, _userId: string): Promise<void> {
    try {
      // Use executeHealthcareWrite for soft delete with audit logging
      await this.databaseService.executeHealthcareWrite(
        async client => {
          return await client.clinicLocation.update({
            where: { id },
            data: {
              isActive: false,
              updatedAt: new Date(),
            },
          });
        },
        {
          userId: _userId || 'system',
          clinicId: '',
          resourceType: 'CLINIC_LOCATION',
          operation: 'DELETE',
          resourceId: id,
          userRole: 'system',
          details: { locationId: id, softDelete: true },
        }
      );

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Clinic location deactivated: ${id}`,
        'ClinicLocationService',
        { locationId: id }
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to delete clinic location: ${(error as Error).message}`,
        'ClinicLocationService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async getLocationCount(clinicId: string): Promise<number> {
    try {
      // Use executeHealthcareRead for count query
      const count = await this.databaseService.executeHealthcareRead(async client => {
        return await client.clinicLocation.count({
          where: {
            clinicId,
            isActive: true,
          },
        });
      });

      return count;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get location count: ${(error as Error).message}`,
        'ClinicLocationService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }
}
