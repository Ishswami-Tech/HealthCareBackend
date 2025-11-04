import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type {
  ClinicCreateInput,
  ClinicUpdateInput,
  ClinicResponseDto,
} from '@core/types/clinic.types';

@Injectable()
export class ClinicService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService
  ) {}

  async createClinic(data: ClinicCreateInput): Promise<ClinicResponseDto> {
    try {
      // Use executeHealthcareWrite for clinic creation with full optimization layers
      // Generate clinicId and ensure required fields are present
      const clinicId = `CLINIC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const dataWithDefaults = data as ClinicCreateInput & {
        db_connection_string?: string;
        databaseName?: string;
      };
      const dbConnectionString =
        dataWithDefaults.db_connection_string ||
        `postgresql://localhost:5432/${dataWithDefaults.databaseName || `clinic_${clinicId.toLowerCase().replace(/[^a-z0-9]/g, '_')}`}`;

      const clinic = await this.databaseService.executeHealthcareWrite(
        async client => {
          return await client.clinic.create({
            data: {
              name: data.name,
              address: data.address,
              phone: data.phone,
              email: data.email,
              subdomain: data.subdomain,
              app_name: data.app_name,
              clinicId,
              db_connection_string: dbConnectionString,
              ...(data.logo && { logo: data.logo }),
              ...(data.website && { website: data.website }),
              ...(data.description && { description: data.description }),
              timezone: data.timezone,
              currency: data.currency,
              language: data.language,
              createdBy: data.createdBy,
              isActive: data.isActive ?? true,
            },
            include: {
              locations: {
                where: { isActive: true },
                take: 1,
              },
            },
          });
        },
        {
          userId: data.createdBy || 'system',
          clinicId: '',
          resourceType: 'CLINIC',
          operation: 'CREATE',
          resourceId: '',
          userRole: 'system',
          details: { name: data.name, subdomain: data.subdomain },
        }
      );

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Clinic created: ${clinic.id}`,
        'ClinicService',
        { clinicId: clinic.id }
      );

      return clinic as ClinicResponseDto;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to create clinic: ${(error as Error).message}`,
        'ClinicService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async getClinicBySubdomain(
    subdomain: string,
    includeLocation = true
  ): Promise<ClinicResponseDto | null> {
    try {
      // Use executeHealthcareRead for optimized query
      const queryOptions: {
        where: { subdomain: string };
        include?: {
          locations: {
            where: { isActive: boolean };
            take: number;
          };
        };
      } = {
        where: { subdomain },
      };

      if (includeLocation) {
        queryOptions.include = {
          locations: {
            where: { isActive: true },
            take: 1,
          },
        };
      }

      const clinic = await this.databaseService.executeHealthcareRead(async client => {
        return await client.clinic.findFirst(queryOptions);
      });

      return clinic as ClinicResponseDto | null;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic by subdomain: ${(error as Error).message}`,
        'ClinicService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async updateClinic(id: string, data: ClinicUpdateInput): Promise<ClinicResponseDto> {
    try {
      // Use executeHealthcareWrite for update with full optimization layers
      const clinic = await this.databaseService.executeHealthcareWrite(
        async client => {
          return await client.clinic.update({
            where: { id },
            data: {
              ...data,
              updatedAt: new Date(),
            },
            include: {
              locations: {
                where: { isActive: true },
                take: 1,
              },
            },
          });
        },
        {
          userId: 'system',
          clinicId: id,
          resourceType: 'CLINIC',
          operation: 'UPDATE',
          resourceId: id,
          userRole: 'system',
          details: { updateFields: Object.keys(data) },
        }
      );

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Clinic updated: ${clinic.id}`,
        'ClinicService',
        { clinicId: clinic.id }
      );

      return clinic as ClinicResponseDto;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to update clinic: ${(error as Error).message}`,
        'ClinicService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async getClinicCount(): Promise<number> {
    try {
      // Use executeHealthcareRead for count query
      const count = await this.databaseService.executeHealthcareRead(async client => {
        return await client.clinic.count({
          where: {
            isActive: true,
          },
        });
      });

      return count;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic count: ${(error as Error).message}`,
        'ClinicService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async getClinicStats(clinicId: string): Promise<{
    totalUsers: number;
    totalLocations: number;
    totalAppointments: number;
  }> {
    try {
      // Use executeHealthcareRead for parallel queries with optimization
      const [totalUsers, totalLocations, totalAppointments] = await Promise.all([
        this.databaseService.executeHealthcareRead(async client => {
          return await client.userRole.count({
            where: { clinicId, isActive: true },
          });
        }),
        this.databaseService.executeHealthcareRead(async client => {
          return await client.clinicLocation.count({
            where: { clinicId, isActive: true },
          });
        }),
        this.databaseService.countAppointmentsSafe({
          clinicId,
        }),
      ]);

      return {
        totalUsers,
        totalLocations,
        totalAppointments,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic stats: ${(error as Error).message}`,
        'ClinicService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async getAllClinics(userId: string): Promise<ClinicResponseDto[]> {
    try {
      // Use executeHealthcareRead for optimized query
      const clinics = await this.databaseService.executeHealthcareRead(async client => {
        return await client.clinic.findMany({
          where: { createdBy: userId },
          include: {
            locations: {
              where: { isActive: true },
              take: 1,
            },
          },
        });
      });
      return clinics as ClinicResponseDto[];
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinics: ${(error as Error).message}`,
        'ClinicService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async getClinicById(id: string, includeInactive = false): Promise<ClinicResponseDto> {
    try {
      // Use executeHealthcareRead for optimized query
      const clinic = await this.databaseService.executeHealthcareRead(async client => {
        const whereClause = includeInactive ? { id } : { id, isActive: true };
        return await client.clinic.findUnique({
          where: whereClause,
          include: {
            locations: {
              where: { isActive: true },
              take: 1,
            },
          },
        });
      });
      if (!clinic) throw new Error('Clinic not found');
      return clinic as ClinicResponseDto;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic: ${(error as Error).message}`,
        'ClinicService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async deleteClinic(id: string): Promise<void> {
    try {
      // Use executeHealthcareWrite for delete with audit logging
      await this.databaseService.executeHealthcareWrite(
        async client => {
          return await client.clinic.delete({ where: { id } });
        },
        {
          userId: 'system',
          clinicId: id,
          resourceType: 'CLINIC',
          operation: 'DELETE',
          resourceId: id,
          userRole: 'system',
          details: { clinicId: id },
        }
      );
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Clinic deleted: ${id}`,
        'ClinicService',
        { clinicId: id }
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to delete clinic: ${(error as Error).message}`,
        'ClinicService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async getClinicByAppName(appName: string): Promise<ClinicResponseDto> {
    try {
      // Use executeHealthcareRead for optimized query
      const clinic = await this.databaseService.executeHealthcareRead(async client => {
        return await client.clinic.findFirst({
          where: { app_name: appName },
          include: {
            locations: {
              where: { isActive: true },
              take: 1,
            },
          },
        });
      });
      if (!clinic) throw new Error('Clinic not found');
      return clinic as ClinicResponseDto;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic by app name: ${(error as Error).message}`,
        'ClinicService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async getClinicDoctors(id: string, _userId: string): Promise<unknown[]> {
    try {
      // Use executeHealthcareRead for optimized query - Doctor is linked via DoctorClinic
      const doctors = await this.databaseService.executeHealthcareRead(async client => {
        return await client.doctorClinic.findMany({
          where: { clinicId: id },
          include: {
            doctor: {
              include: { user: true },
            },
          },
        });
      });
      return doctors;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic doctors: ${(error as Error).message}`,
        'ClinicService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async getClinicPatients(id: string, _userId: string): Promise<unknown[]> {
    try {
      // Use executeHealthcareRead for optimized query - Patients linked via appointments
      const patients = await this.databaseService.executeHealthcareRead(async client => {
        // Get unique patient IDs from appointments
        const appointments = await client.appointment.findMany({
          where: { clinicId: id },
          select: { patientId: true },
          distinct: ['patientId'],
        });

        const patientIds = appointments.map(a => a.patientId);

        if (patientIds.length === 0) {
          return [];
        }

        return await client.patient.findMany({
          where: {
            id: { in: patientIds },
          },
          include: { user: true },
        });
      });
      return patients;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic patients: ${(error as Error).message}`,
        'ClinicService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async getActiveLocations(clinicId: string): Promise<unknown[]> {
    try {
      // Use executeHealthcareRead for optimized query
      const locations = await this.databaseService.executeHealthcareRead(async client => {
        return await client.clinicLocation.findMany({
          where: { clinicId, isActive: true },
        });
      });
      return locations;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get active locations: ${(error as Error).message}`,
        'ClinicService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async assignClinicAdmin(data: Record<string, unknown>): Promise<unknown> {
    try {
      // Use executeHealthcareWrite for create with audit logging
      const userId =
        'userId' in data && typeof data['userId'] === 'string' ? data['userId'] : 'system';
      const clinicId =
        'clinicId' in data && typeof data['clinicId'] === 'string' ? data['clinicId'] : '';

      const admin = await this.databaseService.executeHealthcareWrite(
        async client => {
          return await client.clinicAdmin.create({
            data: {
              userId,
              clinicId,
              isOwner: 'isOwner' in data ? Boolean(data['isOwner']) : false,
            },
            include: { user: true },
          });
        },
        {
          userId,
          clinicId,
          resourceType: 'CLINIC_ADMIN',
          operation: 'CREATE',
          resourceId: '',
          userRole: 'system',
          details: { clinicId, userId },
        }
      );
      return admin;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to assign clinic admin: ${(error as Error).message}`,
        'ClinicService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async registerPatientToClinic(data: Record<string, unknown>): Promise<unknown> {
    try {
      // Use executeHealthcareWrite for create with audit logging
      const userId = 'userId' in data && typeof data['userId'] === 'string' ? data['userId'] : '';

      if (!userId) {
        throw new Error('userId is required');
      }

      const patient = await this.databaseService.executeHealthcareWrite(
        async client => {
          return await client.patient.create({
            data: {
              userId,
            },
            include: { user: true },
          });
        },
        {
          userId,
          clinicId: '',
          resourceType: 'PATIENT',
          operation: 'CREATE',
          resourceId: '',
          userRole: 'system',
          details: { userId },
        }
      );
      return patient;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to register patient to clinic: ${(error as Error).message}`,
        'ClinicService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async associateUserWithClinic(data: Record<string, unknown>): Promise<unknown> {
    try {
      // Use executeHealthcareWrite for create with audit logging
      // Note: User-clinic association is handled via UserRole in RBAC system
      const userId = 'userId' in data && typeof data['userId'] === 'string' ? data['userId'] : '';
      const clinicIdOrAppName =
        'clinicId' in data && typeof data['clinicId'] === 'string' ? data['clinicId'] : '';

      // If clinicId is actually an app name, resolve it to clinicId
      let clinicId = clinicIdOrAppName;
      if (
        clinicIdOrAppName &&
        !clinicIdOrAppName.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      ) {
        // It's an app name, not a UUID
        const clinic = await this.getClinicByAppName(clinicIdOrAppName);
        clinicId = clinic.id;
      }

      // Association is handled through UserRole - this method is kept for backward compatibility
      // Actual association should use ClinicUserService
      return {
        userId,
        clinicId,
        associated: true,
      };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to associate user with clinic: ${(error as Error).message}`,
        'ClinicService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }

  async getCurrentUserClinic(userId: string): Promise<ClinicResponseDto> {
    try {
      // Use executeHealthcareRead for optimized query - get clinic via UserRole
      const userRole = await this.databaseService.executeHealthcareRead(async client => {
        return await client.userRole.findFirst({
          where: {
            userId,
            isActive: true,
            clinicId: { not: null },
          },
          include: {
            role: true,
          },
        });
      });

      if (!userRole || !userRole.clinicId) {
        throw new Error('No clinic association found for user');
      }

      return await this.getClinicById(userRole.clinicId);
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get current user clinic: ${(error as Error).message}`,
        'ClinicService',
        { error: (error as Error).stack }
      );
      throw error;
    }
  }
}
