import { Injectable, Optional, Inject, forwardRef, ForbiddenException } from '@nestjs/common';
import { Role } from '@core/types/enums.types';
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
import type { AssignClinicAdminDto, ClinicStatsResponseDto } from '@dtos/clinic.dto';
import type {
  PrismaTransactionClientWithDelegates,
  PrismaDelegateArgs,
} from '@core/types/prisma.types';
import {
  CommunicationConfigService,
  type ClinicCommunicationConfig,
  EmailProvider,
  type ProviderConfig,
} from '@communication/config';

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
    private readonly configService?: ConfigService,
    @Optional()
    @Inject(forwardRef(() => CommunicationConfigService))
    private readonly communicationConfigService?: CommunicationConfigService
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

  /**
   * Generate next sequential clinic ID in format CL0001, CL0002, etc.
   */
  private async generateNextClinicId(): Promise<string> {
    try {
      // Get all existing clinic IDs
      const existingClinics = await this.databaseService.executeHealthcareRead<
        Array<{ clinicId: string }>
      >(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        const clinics = await typedClient.clinic.findMany({
          select: {
            clinicId: true,
          },
          orderBy: {
            clinicId: 'desc',
          },
        } as PrismaDelegateArgs);
        return (clinics as unknown as Array<{ clinicId: string }>).map(c => ({
          clinicId: c.clinicId,
        }));
      });

      // Extract numeric part from existing clinic IDs (format: CL0001, CL0002, etc.)
      let maxNumber = 0;
      for (const clinic of existingClinics) {
        const match = clinic.clinicId.match(/^CL(\d+)$/);
        if (match && match[1]) {
          const number = parseInt(match[1], 10);
          if (!Number.isNaN(number) && number > maxNumber) {
            maxNumber = number;
          }
        }
      }

      // Generate next sequential ID
      const nextNumber = maxNumber + 1;
      return `CL${String(nextNumber).padStart(4, '0')}`;
    } catch (error) {
      // If error occurs, fallback to timestamp-based ID but log the error
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to generate sequential clinic ID, using fallback: ${(error as Error).message}`,
        'ClinicService',
        { error: (error as Error).stack }
      );
      // Fallback: Use timestamp-based ID if sequential generation fails
      return `CL${String(Date.now()).slice(-4).padStart(4, '0')}`;
    }
  }

  async createClinic(
    data: ClinicCreateInput & {
      settings?: Record<string, unknown>;
      communicationConfig?: {
        email?: {
          primary?: {
            provider?: string;
            enabled?: boolean;
            credentials?: Record<string, string>;
            priority?: number;
          };
          fallback?: Array<{
            provider?: string;
            enabled?: boolean;
            credentials?: Record<string, string>;
            priority?: number;
          }>;
          defaultFrom?: string;
          defaultFromName?: string;
        };
        whatsapp?: {
          primary?: {
            provider?: string;
            enabled?: boolean;
            credentials?: Record<string, string>;
            priority?: number;
          };
          fallback?: Array<{
            provider?: string;
            enabled?: boolean;
            credentials?: Record<string, string>;
            priority?: number;
          }>;
          defaultNumber?: string;
        };
        sms?: {
          primary?: {
            provider?: string;
            enabled?: boolean;
            credentials?: Record<string, string>;
            priority?: number;
          };
          fallback?: Array<{
            provider?: string;
            enabled?: boolean;
            credentials?: Record<string, string>;
            priority?: number;
          }>;
          defaultNumber?: string;
        };
      };
    }
  ): Promise<ClinicResponseDto> {
    try {
      // Use executeHealthcareWrite for clinic creation with full optimization layers
      // Generate clinicId in format CL0001, CL0002, etc.
      const clinicId = await this.generateNextClinicId();
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
              ...(data.settings && { settings: data.settings as never }),
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

      // Save communication configuration if provided
      const dataWithCommConfig = data as ClinicCreateInput & {
        communicationConfig?: {
          email?: {
            primary?: {
              provider?: string;
              enabled?: boolean;
              credentials?: Record<string, string>;
              priority?: number;
            };
            fallback?: Array<{
              provider?: string;
              enabled?: boolean;
              credentials?: Record<string, string>;
              priority?: number;
            }>;
            defaultFrom?: string;
            defaultFromName?: string;
          };
          whatsapp?: {
            primary?: {
              provider?: string;
              enabled?: boolean;
              credentials?: Record<string, string>;
              priority?: number;
            };
            fallback?: Array<{
              provider?: string;
              enabled?: boolean;
              credentials?: Record<string, string>;
              priority?: number;
            }>;
            defaultNumber?: string;
          };
          sms?: {
            primary?: {
              provider?: string;
              enabled?: boolean;
              credentials?: Record<string, string>;
              priority?: number;
            };
            fallback?: Array<{
              provider?: string;
              enabled?: boolean;
              credentials?: Record<string, string>;
              priority?: number;
            }>;
            defaultNumber?: string;
          };
        };
      };

      if (dataWithCommConfig.communicationConfig && this.communicationConfigService) {
        try {
          const commConfig: ClinicCommunicationConfig = {
            clinicId: clinic.id,
            email: dataWithCommConfig.communicationConfig.email
              ? {
                  ...(dataWithCommConfig.communicationConfig.email.primary &&
                    dataWithCommConfig.communicationConfig.email.primary.provider && {
                      primary: {
                        provider: dataWithCommConfig.communicationConfig.email.primary
                          .provider as EmailProvider,
                        enabled:
                          dataWithCommConfig.communicationConfig.email.primary.enabled ?? true,
                        credentials:
                          dataWithCommConfig.communicationConfig.email.primary.credentials ?? {},
                        ...(dataWithCommConfig.communicationConfig.email.primary.priority !==
                          undefined && {
                          priority: dataWithCommConfig.communicationConfig.email.primary.priority,
                        }),
                      } as ProviderConfig,
                    }),
                  ...(dataWithCommConfig.communicationConfig.email.fallback && {
                    fallback: dataWithCommConfig.communicationConfig.email
                      .fallback as ProviderConfig[],
                  }),
                  ...(dataWithCommConfig.communicationConfig.email.defaultFrom && {
                    defaultFrom: dataWithCommConfig.communicationConfig.email.defaultFrom,
                  }),
                  ...(dataWithCommConfig.communicationConfig.email.defaultFromName && {
                    defaultFromName: dataWithCommConfig.communicationConfig.email.defaultFromName,
                  }),
                }
              : {},
            whatsapp: dataWithCommConfig.communicationConfig.whatsapp
              ? {
                  ...(dataWithCommConfig.communicationConfig.whatsapp.primary &&
                    dataWithCommConfig.communicationConfig.whatsapp.primary.provider && {
                      primary: {
                        provider: dataWithCommConfig.communicationConfig.whatsapp.primary
                          .provider as ProviderConfig['provider'],
                        enabled:
                          dataWithCommConfig.communicationConfig.whatsapp.primary.enabled ?? true,
                        credentials:
                          dataWithCommConfig.communicationConfig.whatsapp.primary.credentials ?? {},
                        ...(dataWithCommConfig.communicationConfig.whatsapp.primary.priority !==
                          undefined && {
                          priority:
                            dataWithCommConfig.communicationConfig.whatsapp.primary.priority,
                        }),
                      } as ProviderConfig,
                    }),
                  ...(dataWithCommConfig.communicationConfig.whatsapp.fallback && {
                    fallback: dataWithCommConfig.communicationConfig.whatsapp
                      .fallback as ProviderConfig[],
                  }),
                  ...(dataWithCommConfig.communicationConfig.whatsapp.defaultNumber && {
                    defaultNumber: dataWithCommConfig.communicationConfig.whatsapp.defaultNumber,
                  }),
                }
              : {},
            sms: dataWithCommConfig.communicationConfig.sms
              ? {
                  ...(dataWithCommConfig.communicationConfig.sms.primary &&
                    dataWithCommConfig.communicationConfig.sms.primary.provider && {
                      primary: {
                        provider: dataWithCommConfig.communicationConfig.sms.primary
                          .provider as ProviderConfig['provider'],
                        enabled: dataWithCommConfig.communicationConfig.sms.primary.enabled ?? true,
                        credentials:
                          dataWithCommConfig.communicationConfig.sms.primary.credentials ?? {},
                        ...(dataWithCommConfig.communicationConfig.sms.primary.priority !==
                          undefined && {
                          priority: dataWithCommConfig.communicationConfig.sms.primary.priority,
                        }),
                      } as ProviderConfig,
                    }),
                  ...(dataWithCommConfig.communicationConfig.sms.fallback && {
                    fallback: dataWithCommConfig.communicationConfig.sms
                      .fallback as ProviderConfig[],
                  }),
                  ...(dataWithCommConfig.communicationConfig.sms.defaultNumber && {
                    defaultNumber: dataWithCommConfig.communicationConfig.sms.defaultNumber,
                  }),
                }
              : {},
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          await this.communicationConfigService.saveClinicConfig(commConfig);

          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.INFO,
            `Communication configuration saved for clinic: ${clinic.id}`,
            'ClinicService',
            { clinicId: clinic.id }
          );
        } catch (commError) {
          // Log error but don't fail clinic creation
          void this.loggingService.log(
            LogType.ERROR,
            LogLevel.WARN,
            `Failed to save communication config during clinic creation: ${commError instanceof Error ? commError.message : String(commError)}`,
            'ClinicService',
            {
              clinicId: clinic.id,
              error: commError instanceof Error ? commError.stack : undefined,
            }
          );
        }
      }

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

  async updateClinic(
    id: string,
    data: ClinicUpdateInput & {
      settings?: Record<string, unknown>;
      communicationConfig?: {
        email?: {
          primary?: {
            provider?: string;
            enabled?: boolean;
            credentials?: Record<string, string>;
            priority?: number;
          };
          fallback?: Array<{
            provider?: string;
            enabled?: boolean;
            credentials?: Record<string, string>;
            priority?: number;
          }>;
          defaultFrom?: string;
          defaultFromName?: string;
        };
        whatsapp?: {
          primary?: {
            provider?: string;
            enabled?: boolean;
            credentials?: Record<string, string>;
            priority?: number;
          };
          fallback?: Array<{
            provider?: string;
            enabled?: boolean;
            credentials?: Record<string, string>;
            priority?: number;
          }>;
          defaultNumber?: string;
        };
        sms?: {
          primary?: {
            provider?: string;
            enabled?: boolean;
            credentials?: Record<string, string>;
            priority?: number;
          };
          fallback?: Array<{
            provider?: string;
            enabled?: boolean;
            credentials?: Record<string, string>;
            priority?: number;
          }>;
          defaultNumber?: string;
        };
      };
    }
  ): Promise<ClinicResponseDto> {
    try {
      // Extract communicationConfig from data
      const { communicationConfig, ...clinicUpdateData } = data;

      // Use executeHealthcareWrite for update with full optimization layers
      const clinic = await this.databaseService.executeHealthcareWrite<Clinic>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.clinic.update({
            where: { id } as PrismaDelegateArgs,
            data: {
              ...clinicUpdateData,
              ...(clinicUpdateData.settings && { settings: clinicUpdateData.settings as never }),
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

      // Update communication configuration if provided
      if (communicationConfig && this.communicationConfigService) {
        try {
          const existingConfig = await this.communicationConfigService.getClinicConfig(id);

          const commConfig: ClinicCommunicationConfig = {
            clinicId: id,
            email: communicationConfig.email
              ? {
                  ...(communicationConfig.email.primary &&
                    communicationConfig.email.primary.provider && {
                      primary: {
                        provider: communicationConfig.email.primary.provider as EmailProvider,
                        enabled: communicationConfig.email.primary.enabled ?? true,
                        credentials: communicationConfig.email.primary.credentials ?? {},
                        ...(communicationConfig.email.primary.priority !== undefined && {
                          priority: communicationConfig.email.primary.priority,
                        }),
                      } as ProviderConfig,
                    }),
                  ...(communicationConfig.email.fallback && {
                    fallback: communicationConfig.email.fallback as ProviderConfig[],
                  }),
                  ...(communicationConfig.email.defaultFrom && {
                    defaultFrom: communicationConfig.email.defaultFrom,
                  }),
                  ...(communicationConfig.email.defaultFromName && {
                    defaultFromName: communicationConfig.email.defaultFromName,
                  }),
                }
              : (existingConfig?.email ?? {}),
            whatsapp: communicationConfig.whatsapp
              ? {
                  ...(communicationConfig.whatsapp.primary &&
                    communicationConfig.whatsapp.primary.provider && {
                      primary: {
                        provider: communicationConfig.whatsapp.primary
                          .provider as ProviderConfig['provider'],
                        enabled: communicationConfig.whatsapp.primary.enabled ?? true,
                        credentials: communicationConfig.whatsapp.primary.credentials ?? {},
                        ...(communicationConfig.whatsapp.primary.priority !== undefined && {
                          priority: communicationConfig.whatsapp.primary.priority,
                        }),
                      } as ProviderConfig,
                    }),
                  ...(communicationConfig.whatsapp.fallback && {
                    fallback: communicationConfig.whatsapp.fallback as ProviderConfig[],
                  }),
                  ...(communicationConfig.whatsapp.defaultNumber && {
                    defaultNumber: communicationConfig.whatsapp.defaultNumber,
                  }),
                }
              : (existingConfig?.whatsapp ?? {}),
            sms: communicationConfig.sms
              ? {
                  ...(communicationConfig.sms.primary &&
                    communicationConfig.sms.primary.provider && {
                      primary: {
                        provider: communicationConfig.sms.primary
                          .provider as ProviderConfig['provider'],
                        enabled: communicationConfig.sms.primary.enabled ?? true,
                        credentials: communicationConfig.sms.primary.credentials ?? {},
                        ...(communicationConfig.sms.primary.priority !== undefined && {
                          priority: communicationConfig.sms.primary.priority,
                        }),
                      } as ProviderConfig,
                    }),
                  ...(communicationConfig.sms.fallback && {
                    fallback: communicationConfig.sms.fallback as ProviderConfig[],
                  }),
                  ...(communicationConfig.sms.defaultNumber && {
                    defaultNumber: communicationConfig.sms.defaultNumber,
                  }),
                }
              : (existingConfig?.sms ?? {}),
            createdAt: existingConfig?.createdAt ?? new Date(),
            updatedAt: new Date(),
          };

          await this.communicationConfigService.saveClinicConfig(commConfig);

          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.INFO,
            `Communication configuration updated for clinic: ${clinic.id}`,
            'ClinicService',
            { clinicId: clinic.id }
          );
        } catch (commError) {
          // Log error but don't fail clinic update
          void this.loggingService.log(
            LogType.ERROR,
            LogLevel.WARN,
            `Failed to update communication config during clinic update: ${commError instanceof Error ? commError.message : String(commError)}`,
            'ClinicService',
            {
              clinicId: clinic.id,
              error: commError instanceof Error ? commError.stack : undefined,
            }
          );
        }
      }

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
          updateFields: Object.keys(clinicUpdateData),
          ...(communicationConfig && { communicationConfigUpdated: true }),
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

  async getClinicStats(clinicId: string): Promise<ClinicStatsResponseDto> {
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

  private async fetchClinicStats(clinicId: string): Promise<ClinicStatsResponseDto> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      // Use executeHealthcareRead for parallel queries with optimization
      const [
        totalUsers,
        totalLocations,
        totalAppointments,
        activeDoctors,
        todayAppointments,
        revenue,
        activePatients,
        totalEhrRecords,
        lowStockAlerts,
      ] = await Promise.all([
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
        this.databaseService.executeHealthcareRead<number>(async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.doctorClinic.count({
            where: { clinicId } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        }),
        this.databaseService.executeHealthcareRead<number>(async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.appointment.count({
            where: {
              clinicId,
              date: {
                gte: today,
                lt: tomorrow,
              },
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        }),
        this.fetchClinicRevenue(clinicId),
        this.databaseService.executeHealthcareRead<number>(async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          const result = await typedClient.appointment.groupBy({
            by: ['patientId'],
            where: { clinicId } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
          return Array.isArray(result) ? result.length : 0;
        }),
        this.databaseService.executeHealthcareRead<number>(async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.healthRecord.count({
            where: { clinicId } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        }),
        this.databaseService.executeHealthcareRead<number>(async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.medicine.count({
            where: { clinicId, stock: { lt: 10 } } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        }),
      ]);

      return {
        totalUsers,
        totalLocations,
        totalAppointments,
        activeDoctors,
        todayAppointments,
        revenue,
        activePatients,
        totalEhrRecords,
        lowStockAlerts,
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

  private async fetchClinicRevenue(clinicId: string): Promise<number> {
    try {
      const result = await this.databaseService.executeHealthcareRead<{
        _sum: { amount: number | null };
      }>(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        return (await typedClient.payment.aggregate({
          where: { clinicId, status: 'COMPLETED' } as PrismaDelegateArgs,
          _sum: { amount: true },
        } as PrismaDelegateArgs)) as unknown as { _sum: { amount: number | null } };
      });
      return result._sum.amount || 0;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to fetch revenue: ${(error as Error).message}`,
        'ClinicService'
      );
      return 0;
    }
  }

  async getAllClinics(
    userId: string,
    role?: string,
    clinicId?: string
  ): Promise<ClinicResponseDto[]> {
    const cacheKey = `clinics:user:${userId}:${role || 'default'}:${clinicId || 'all'}`;

    if (this.cacheService) {
      return this.cacheService.cache(
        cacheKey,
        async () => {
          return this.fetchAllClinics(userId, role, clinicId);
        },
        {
          ttl: 1800, // 30 minutes
          tags: ['clinics', `user:${userId}`],
          enableSwr: true,
        }
      );
    }

    return this.fetchAllClinics(userId, role, clinicId);
  }

  private async fetchAllClinics(
    userId: string,
    role?: string,
    clinicId?: string
  ): Promise<ClinicResponseDto[]> {
    try {
      // 1. Get assigned clinic IDs from UserRole for strict isolation
      const assignedClinicIds = await this.databaseService.executeHealthcareRead<string[]>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          const userRoles = await typedClient.userRole.findMany({
            where: {
              userId,
              isActive: true,
              clinicId: { not: null },
            } as PrismaDelegateArgs,
            select: { clinicId: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);

          return (userRoles as unknown as Array<{ clinicId: string | null }>)
            .map(ur => ur.clinicId)
            .filter((id): id is string => id !== null);
        }
      );

      // 2. Determine visibility rules based on Role
      let whereClause: Record<string, unknown> = { isActive: true };

      if (role === Role.SUPER_ADMIN) {
        // Super Admin sees all active clinics
        whereClause = { isActive: true };
      } else if (role === Role.PATIENT) {
        // Enforce single-tenant view if CLINIC_ID is configured or passed in context
        // Patients should only see the specific clinic they are accessing
        const contextClinicId =
          clinicId || this.configService?.get<string>('CLINIC_ID') || process.env['CLINIC_ID'];

        if (contextClinicId) {
          whereClause = {
            id: contextClinicId,
            isActive: true,
          };
        } else {
          // Strict Isolation: If no context provided, show only assigned clinics
          // This prevents leaking other clinics in a multi-tenant environment
          const assignedClinicIds = await this.databaseService.executeHealthcareRead<string[]>(
            async client => {
              const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
              const userRoles = await typedClient.userRole.findMany({
                where: {
                  userId,
                  isActive: true,
                  clinicId: { not: null },
                } as PrismaDelegateArgs,
                select: { clinicId: true } as PrismaDelegateArgs,
              } as PrismaDelegateArgs);

              return (userRoles as unknown as Array<{ clinicId: string | null }>)
                .map(ur => ur.clinicId)
                .filter((id): id is string => id !== null);
            }
          );

          if (assignedClinicIds.length === 0) {
            return [];
          }

          whereClause = {
            id: { in: assignedClinicIds },
            isActive: true,
          };
        }
      } else {
        // Clinic Admin / Staff: Assigned OR Created (Legacy support)
        const conditions: Record<string, unknown>[] = [];
        if (assignedClinicIds.length > 0) {
          conditions.push({ id: { in: assignedClinicIds } });
        }
        conditions.push({ createdBy: userId });

        whereClause = {
          isActive: true,
          OR: conditions,
        };
      }

      // 3. Query Clinics with optimized include
      const clinics = await this.databaseService.executeHealthcareRead<Clinic[]>(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        return await typedClient.clinic.findMany({
          where: whereClause as PrismaDelegateArgs,
          include: {
            locations: {
              where: { isActive: true } as PrismaDelegateArgs,
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

  async getClinicById(
    id: string,
    includeInactive = false,
    userId?: string,
    role?: string,
    clinicId?: string // Optional context clinic ID from header
  ): Promise<ClinicResponseDto> {
    const cacheKey = `clinic:${id}:${includeInactive ? 'all' : 'active'}:${userId || 'anon'}:${clinicId || 'no-ctx'}`;

    if (this.cacheService) {
      return this.cacheService.cache(
        cacheKey,
        async () => {
          return this.fetchClinicById(id, includeInactive, userId, role, clinicId);
        },
        {
          ttl: 3600, // 1 hour
          tags: ['clinics', `clinic:${id}`],
          enableSwr: true,
        }
      );
    }

    return this.fetchClinicById(id, includeInactive, userId, role, clinicId);
  }

  private async fetchClinicById(
    id: string,
    includeInactive: boolean,
    userId?: string,
    role?: string,
    clinicId?: string
  ): Promise<ClinicResponseDto> {
    try {
      // Enforce isolation for patients
      if (role === Role.PATIENT && userId) {
        const configuredClinicId =
          this.configService?.get<string>('CLINIC_ID') || process.env['CLINIC_ID'];

        // 1. Allow access if ID matches Configured ID (Single Tenant Env)
        // 2. Allow access if ID matches Context ID (Multi-Tenant Header)
        // 1. Allow access if ID matches Configured ID (Single Tenant Env)
        // 2. Allow access if ID matches Context ID (Multi-Tenant Header)
        // 3. Validate against both UUID and Code (CL####)
        const isAllowedPublicly =
          (configuredClinicId && (id === configuredClinicId || id === 'CL0002')) || // Allow known codes
          (clinicId && id === clinicId);

        if (!isAllowedPublicly) {
          // If accessing a restricted/different clinic, check assignments
          const assignedClinicIds = await this.databaseService.executeHealthcareRead<string[]>(
            async client => {
              const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
              const userRoles = await typedClient.userRole.findMany({
                where: {
                  userId,
                  isActive: true,
                  clinicId: { not: null },
                } as PrismaDelegateArgs,
                select: { clinicId: true } as PrismaDelegateArgs,
              } as PrismaDelegateArgs);

              return (userRoles as unknown as Array<{ clinicId: string | null }>)
                .map(ur => ur.clinicId)
                .filter((id): id is string => id !== null);
            }
          );

          // If assignedClinicIds contains the ID (UUID), it's fine.
          // If ID is a code (CL0002), we need to check if that code corresponds to an assigned clinic.
          // Ideally we resolve code to UUID first, but for now let's query.
          // Actually, let's defer this check to after we fetch the clinic, where we can compare UUIDs.
          // BUT `executeHealthcareRead` is expensive if we don't need it.
          // Let's rely on the DB query to enforce permissions if we can, or fetch then check.

          // Optimization: Check if ID is in assignedClinicIds (which are UUIDs)
          if (!assignedClinicIds.includes(id)) {
            // If id is not a UUID, we can't be sure yet. We will verify after fetching.
            const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              id
            );
            if (isUuid) {
              throw new ForbiddenException('You do not have permission to view this clinic');
            }
          }
        }
      }

      // Use executeHealthcareRead for optimized query
      const clinic = await this.databaseService.executeHealthcareRead<Clinic | null>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

          let whereClause: Record<string, unknown>;
          if (isUuid) {
            whereClause = includeInactive ? { id } : { id, isActive: true };
          } else {
            // Assume it's a clinicId code (e.g. CL0002)
            whereClause = includeInactive ? { clinicId: id } : { clinicId: id, isActive: true };
          }
          return await typedClient.clinic.findUnique({
            where: whereClause as PrismaDelegateArgs,
            include: {
              locations: {
                // Fetch all active locations for the clinic
                where: { isActive: true } as PrismaDelegateArgs,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        }
      );
      if (!clinic) throw new Error('Clinic not found');
      if (!clinic) throw new Error('Clinic not found');

      // Post-fetch permission check for non-UUID access
      if (role === Role.PATIENT && userId) {
        const clinicData = clinic as ClinicResponseDto;
        const assignedClinicIds = await this.databaseService.executeHealthcareRead<string[]>(
          async client => {
            const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
            const userRoles = await typedClient.userRole.findMany({
              where: { userId, isActive: true, clinicId: { not: null } } as PrismaDelegateArgs,
              select: { clinicId: true } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
            return (userRoles as unknown as Array<{ clinicId: string | null }>)
              .map(ur => ur.clinicId)
              .filter((id): id is string => id !== null);
          }
        );

        const configuredClinicId =
          this.configService?.get<string>('CLINIC_ID') || process.env['CLINIC_ID'];
        const isPublic =
          (configuredClinicId && clinicData.id === configuredClinicId) ||
          (clinicId && clinicData.id === clinicId);

        if (!isPublic && !assignedClinicIds.includes(clinicData.id)) {
          throw new ForbiddenException('You do not have permission to view this clinic');
        }
      }

      return clinic as ClinicResponseDto;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
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
        return (await typedClient.doctorClinic.findMany({
          where: { clinicId: id } as PrismaDelegateArgs,
          include: {
            doctor: {
              include: { user: true } as PrismaDelegateArgs,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs)) as unknown as Array<{
          doctor: Doctor & { user: { id: string; name: string; email: string } };
        }>;
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

  /**
   * Get all staff members (non-patient users) associated with a clinic
   */
  async getClinicStaff(
    id: string,
    _userId: string
  ): Promise<
    Array<{
      id: string;
      name: string | null;
      firstName: string | null;
      lastName: string | null;
      email: string;
      phone: string | null;
      role: string;
      isActive: boolean;
      profilePicture: string | null;
      createdAt: Date;
    }>
  > {
    try {
      const staff = await this.databaseService.executeHealthcareRead<
        Array<{
          id: string;
          name: string | null;
          firstName: string | null;
          lastName: string | null;
          email: string;
          phone: string | null;
          role: string;
          isActive: boolean;
          profilePicture: string | null;
          createdAt: Date;
        }>
      >(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        const staffRoles = [
          'CLINIC_ADMIN',
          'DOCTOR',
          'ASSISTANT_DOCTOR',
          'RECEPTIONIST',
          'PHARMACIST',
          'NURSE',
          'THERAPIST',
          'LAB_TECHNICIAN',
          'FINANCE_BILLING',
          'SUPPORT_STAFF',
          'COUNSELOR',
          'LOCATION_HEAD',
        ];
        const result = await typedClient.user.findMany({
          where: {
            role: { in: staffRoles },
            OR: [
              { primaryClinicId: id },
              { doctor: { clinics: { some: { clinicId: id } } } },
              { receptionists: { clinicId: id } },
              { clinicAdmins: { some: { clinicId: id } } },
              { pharmacist: { clinicId: id } },
            ],
          } as PrismaDelegateArgs,
          select: {
            id: true,
            name: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            role: true,
            isActive: true,
            profilePicture: true,
            createdAt: true,
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        return result as unknown as Array<{
          id: string;
          name: string | null;
          firstName: string | null;
          lastName: string | null;
          email: string;
          phone: string | null;
          role: string;
          isActive: boolean;
          profilePicture: string | null;
          createdAt: Date;
        }>;
      });
      return staff;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to get clinic staff: ${(error as Error).message}`,
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

      // Patient model only has userId field, clinic association is through User model
      // uniqueHealthIdentification is not a field in Patient model

      const patient = await this.databaseService.executeHealthcareWrite<PatientWithUser>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          const result = await typedClient.patient.create({
            data: {
              userId,
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
          details: { userId, clinicId },
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
