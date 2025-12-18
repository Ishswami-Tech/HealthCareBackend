import { Injectable, Optional, Inject, forwardRef } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { CacheService } from '@infrastructure/cache';
import { EventService } from '@infrastructure/events';
import { ConfigService } from '@config';
import {
  LogType,
  LogLevel,
  type IEventService,
  isEventService,
  EventCategory,
  EventPriority,
} from '@core/types';
import type {
  ClinicCreateInput,
  ClinicUpdateInput,
  ClinicResponseDto,
  ClinicLocationResponseDto,
} from '@core/types/clinic.types';
import type { PatientWithUser, Doctor, ClinicAdmin, Clinic } from '@core/types';
import type { AssignClinicAdminDto } from '@dtos/clinic.dto';
import type {
  PrismaTransactionClientWithDelegates,
  PrismaDelegateArgs,
} from '@core/types/prisma.types';

@Injectable()
export class ClinicService {
  private readonly eventService: IEventService;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService,
    @Optional()
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService?: CacheService,
    @Inject(forwardRef(() => EventService))
    eventService?: unknown,
    @Optional()
    @Inject(forwardRef(() => ConfigService))
    private readonly configService?: ConfigService
  ) {
    // Type guard ensures type safety when using the service
    if (eventService && isEventService(eventService)) {
      this.eventService = eventService;
    } else {
      // EventService is optional - clinic operations can work without it
      this.eventService = {
        emit: () => Promise.resolve(),
        emitAsync: () => Promise.resolve(),
        emitEnterprise: () => Promise.resolve(),
        on: () => () => {},
        onAny: () => () => {},
      } as unknown as IEventService;
    }
  }

  async createClinic(data: ClinicCreateInput): Promise<ClinicResponseDto> {
    try {
      // Use executeHealthcareWrite for clinic creation with full optimization layers
      // Generate clinicId and ensure required fields are present
      const clinicId = `CLINIC-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const dataWithDefaults = data as ClinicCreateInput & {
        db_connection_string?: string;
        databaseName?: string;
      };
      // Use DatabaseService to construct clinic-specific database connection string
      // This ensures consistent database URL parsing across the application
      const databaseName =
        dataWithDefaults.databaseName ||
        `clinic_${clinicId.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      const dbConnectionString =
        dataWithDefaults.db_connection_string ||
        this.databaseService.constructClinicDatabaseUrl(databaseName);

      const clinic = await this.databaseService.executeHealthcareWrite<Clinic>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.clinic.create({
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
            } as PrismaDelegateArgs,
            include: {
              locations: {
                where: { isActive: true } as PrismaDelegateArgs,
                take: 1,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
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

      // Emit clinic lifecycle event
      void this.eventService.emitEnterprise('clinic.created', {
        eventId: `clinic-created-${clinic.id}`,
        eventType: 'clinic.created',
        category: EventCategory.SYSTEM,
        priority: EventPriority.NORMAL,
        timestamp: new Date().toISOString(),
        source: 'ClinicService',
        version: '1.0.0',
        clinicId: clinic.id,
        userId: data.createdBy || 'system',
        metadata: {
          name: clinic.name,
          subdomain: (clinic as { subdomain?: string }).subdomain,
          appName: (clinic as { app_name?: string }).app_name,
        },
      });

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

      const clinic = await this.databaseService.executeHealthcareRead<Clinic | null>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.clinic.findFirst(queryOptions as PrismaDelegateArgs);
        }
      );

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
      const clinic = await this.databaseService.executeHealthcareWrite<Clinic>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.clinic.update({
            where: { id } as PrismaDelegateArgs,
            data: {
              ...data,
              updatedAt: new Date(),
            } as PrismaDelegateArgs,
            include: {
              locations: {
                where: { isActive: true } as PrismaDelegateArgs,
                take: 1,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
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

      // Emit clinic lifecycle event
      void this.eventService.emitEnterprise('clinic.updated', {
        eventId: `clinic-updated-${clinic.id}`,
        eventType: 'clinic.updated',
        category: EventCategory.SYSTEM,
        priority: EventPriority.NORMAL,
        timestamp: new Date().toISOString(),
        source: 'ClinicService',
        version: '1.0.0',
        clinicId: clinic.id,
        userId: 'system',
        metadata: {
          name: clinic.name,
          subdomain: (clinic as { subdomain?: string }).subdomain,
          appName: (clinic as { app_name?: string }).app_name,
          updateFields: Object.keys(data),
        },
      });

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
      const count = await this.databaseService.executeHealthcareRead<number>(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        return await typedClient.clinic.count({
          where: {
            isActive: true,
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
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
    const cacheKey = `clinic:${clinicId}:stats`;

    if (this.cacheService) {
      return this.cacheService.cache(
        cacheKey,
        async () => {
          return this.fetchClinicStats(clinicId);
        },
        {
          ttl: 300, // 5 minutes (stats change frequently)
          tags: ['clinics', `clinic:${clinicId}`, 'stats'],
          enableSwr: true,
        }
      );
    }

    return this.fetchClinicStats(clinicId);
  }

  private async fetchClinicStats(clinicId: string): Promise<{
    totalUsers: number;
    totalLocations: number;
    totalAppointments: number;
  }> {
    try {
      // Use executeHealthcareRead for parallel queries with optimization
      const [totalUsers, totalLocations, totalAppointments] = await Promise.all([
        this.databaseService.executeHealthcareRead<number>(async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.userRole.count({
            where: { clinicId, isActive: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        }),
        this.databaseService.executeHealthcareRead<number>(async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.clinicLocation.count({
            where: { clinicId, isActive: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
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
    const cacheKey = `clinics:user:${userId}`;

    if (this.cacheService) {
      return this.cacheService.cache(
        cacheKey,
        async () => {
          return this.fetchAllClinics(userId);
        },
        {
          ttl: 1800, // 30 minutes
          tags: ['clinics', `user:${userId}`],
          enableSwr: true,
        }
      );
    }

    return this.fetchAllClinics(userId);
  }

  private async fetchAllClinics(userId: string): Promise<ClinicResponseDto[]> {
    try {
      // Use executeHealthcareRead for optimized query
      const clinics = await this.databaseService.executeHealthcareRead<Clinic[]>(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        return await typedClient.clinic.findMany({
          where: { createdBy: userId } as PrismaDelegateArgs,
          include: {
            locations: {
              where: { isActive: true } as PrismaDelegateArgs,
              take: 1,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
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
    const cacheKey = `clinic:${id}:${includeInactive ? 'all' : 'active'}`;

    if (this.cacheService) {
      return this.cacheService.cache(
        cacheKey,
        async () => {
          return this.fetchClinicById(id, includeInactive);
        },
        {
          ttl: 3600, // 1 hour
          tags: ['clinics', `clinic:${id}`],
          enableSwr: true,
        }
      );
    }

    return this.fetchClinicById(id, includeInactive);
  }

  private async fetchClinicById(id: string, includeInactive: boolean): Promise<ClinicResponseDto> {
    try {
      // Use executeHealthcareRead for optimized query
      const clinic = await this.databaseService.executeHealthcareRead<Clinic | null>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          const whereClause = includeInactive ? { id } : { id, isActive: true };
          return await typedClient.clinic.findUnique({
            where: whereClause as PrismaDelegateArgs,
            include: {
              locations: {
                where: { isActive: true } as PrismaDelegateArgs,
                take: 1,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        }
      );
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
      await this.databaseService.executeHealthcareWrite<Clinic>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.clinic.delete({
            where: { id } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
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

      // Emit clinic lifecycle event
      void this.eventService.emitEnterprise('clinic.deleted', {
        eventId: `clinic-deleted-${id}`,
        eventType: 'clinic.deleted',
        category: EventCategory.SYSTEM,
        priority: EventPriority.NORMAL,
        timestamp: new Date().toISOString(),
        source: 'ClinicService',
        version: '1.0.0',
        clinicId: id,
      });
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
    const cacheKey = `clinic:app:${appName}`;

    if (this.cacheService) {
      return this.cacheService.cache(
        cacheKey,
        async () => {
          return this.fetchClinicByAppName(appName);
        },
        {
          ttl: 3600, // 1 hour
          tags: ['clinics', 'app_name'],
          enableSwr: true,
        }
      );
    }

    return this.fetchClinicByAppName(appName);
  }

  private async fetchClinicByAppName(appName: string): Promise<ClinicResponseDto> {
    try {
      // Use executeHealthcareRead for optimized query
      const clinic = await this.databaseService.executeHealthcareRead<Clinic | null>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.clinic.findFirst({
            where: { app_name: appName } as PrismaDelegateArgs,
            include: {
              locations: {
                where: { isActive: true } as PrismaDelegateArgs,
                take: 1,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        }
      );
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

  async getClinicDoctors(
    id: string,
    _userId: string
  ): Promise<Array<{ doctor: Doctor & { user: { id: string; name: string; email: string } } }>> {
    try {
      // Use executeHealthcareRead for optimized query - Doctor is linked via DoctorClinic
      const doctors = await this.databaseService.executeHealthcareRead<
        Array<{ doctor: Doctor & { user: { id: string; name: string; email: string } } }>
      >(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
          doctorClinic: {
            findMany: (
              args: PrismaDelegateArgs
            ) => Promise<
              Array<{ doctor: Doctor & { user: { id: string; name: string; email: string } } }>
            >;
          };
        };
        return await typedClient.doctorClinic.findMany({
          where: { clinicId: id } as PrismaDelegateArgs,
          include: {
            doctor: {
              include: { user: true } as PrismaDelegateArgs,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
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

  async getClinicPatients(id: string, _userId: string): Promise<PatientWithUser[]> {
    try {
      // Use executeHealthcareRead for optimized query - Patients linked via appointments
      const patients = await this.databaseService.executeHealthcareRead<PatientWithUser[]>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          // Get unique patient IDs from appointments
          const appointments = await typedClient.appointment.findMany({
            where: { clinicId: id } as PrismaDelegateArgs,
            select: { patientId: true } as PrismaDelegateArgs,
            distinct: ['patientId'] as unknown as PrismaDelegateArgs,
          } as PrismaDelegateArgs);

          const typedAppointments = appointments as Array<{ patientId: string }>;
          const patientIds = typedAppointments.map((a: { patientId: string }) => a.patientId);

          if (patientIds.length === 0) {
            return [];
          }

          const result = await typedClient.patient.findMany({
            where: {
              id: { in: patientIds },
            } as PrismaDelegateArgs,
            include: { user: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
          return result as unknown as PatientWithUser[];
        }
      );
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

  async getActiveLocations(clinicId: string): Promise<ClinicLocationResponseDto[]> {
    try {
      // Use executeHealthcareRead for optimized query
      const locations = await this.databaseService.executeHealthcareRead<
        ClinicLocationResponseDto[]
      >(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        const result = await typedClient.clinicLocation.findMany({
          where: { clinicId, isActive: true } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        return result as unknown as ClinicLocationResponseDto[];
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

  async assignClinicAdmin(
    data: AssignClinicAdminDto
  ): Promise<ClinicAdmin & { user: { id: string; name: string; email: string } }> {
    try {
      // Use executeHealthcareWrite for create with audit logging
      const userId = data.userId;
      const clinicId = data.clinicId;

      const admin = await this.databaseService.executeHealthcareWrite<
        ClinicAdmin & { user: { id: string; name: string; email: string } }
      >(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          const result = await typedClient.clinicAdmin.create({
            data: {
              userId,
              clinicId,
              isOwner: 'isOwner' in data ? Boolean(data['isOwner']) : false,
            } as PrismaDelegateArgs,
            include: { user: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
          return result as unknown as ClinicAdmin & {
            user: { id: string; name: string; email: string };
          };
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

  /**
   * Generate unique health identification (UHID) for a patient
   * Format: UHID-YYYY-NNNNNN (Year + sequential number)
   */
  private async generateUniqueHealthIdentification(clinicId?: string): Promise<string> {
    const year = new Date().getFullYear();
    const counterKey = clinicId
      ? `uhid:counter:${clinicId}:${year}`
      : `uhid:counter:global:${year}`;

    if (this.cacheService) {
      const currentId = await this.cacheService.get(counterKey);
      const nextId = currentId ? parseInt(currentId as string, 10) + 1 : 1;
      await this.cacheService.set(counterKey, nextId.toString());
      return `UHID-${year}-${nextId.toString().padStart(6, '0')}`;
    }

    // Fallback: Use database count if cache is not available
    const count = await this.databaseService.executeHealthcareRead<number>(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      const whereClause = clinicId
        ? {
            clinicId,
            uniqueHealthIdentification: {
              startsWith: `UHID-${year}-`,
            },
          }
        : {
            uniqueHealthIdentification: {
              startsWith: `UHID-${year}-`,
            },
          };
      return await typedClient.patient.count({
        where: whereClause as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });

    const nextId = count + 1;
    return `UHID-${year}-${nextId.toString().padStart(6, '0')}`;
  }

  async registerPatientToClinic(data: {
    userId: string;
    clinicId: string;
  }): Promise<PatientWithUser> {
    try {
      // Use executeHealthcareWrite for create with audit logging
      const userId = data.userId;
      const clinicId = data.clinicId;

      if (!userId) {
        throw new Error('userId is required');
      }

      // Generate unique health identification automatically
      const uniqueHealthIdentification = await this.generateUniqueHealthIdentification(clinicId);

      const patient = await this.databaseService.executeHealthcareWrite<PatientWithUser>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          const result = await typedClient.patient.create({
            data: {
              userId,
              clinicId,
              uniqueHealthIdentification,
            } as PrismaDelegateArgs,
            include: { user: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
          return result as unknown as PatientWithUser;
        },
        {
          userId,
          clinicId: clinicId || '',
          resourceType: 'PATIENT',
          operation: 'CREATE',
          resourceId: '',
          userRole: 'system',
          details: { userId, clinicId, uniqueHealthIdentification },
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

  async associateUserWithClinic(data: {
    userId: string;
    clinicId: string;
  }): Promise<{ id: string; userId: string; clinicId: string; createdAt: Date; updatedAt: Date }> {
    try {
      // Use executeHealthcareWrite for create with audit logging
      // Note: User-clinic association is handled via UserRole in RBAC system
      const userId = data.userId;
      const clinicIdOrAppName = data.clinicId;

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
      // Return a placeholder object matching the expected type
      return {
        id: '', // Placeholder - actual association uses UserRole
        userId,
        clinicId,
        createdAt: new Date(),
        updatedAt: new Date(),
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
      const userRole = await this.databaseService.executeHealthcareRead<{
        clinicId: string | null;
      } | null>(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        return await typedClient.userRole.findFirst({
          where: {
            userId,
            isActive: true,
            clinicId: { not: null },
          } as PrismaDelegateArgs,
          include: {
            role: true,
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
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
