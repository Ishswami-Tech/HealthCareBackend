import { nowIso } from '@utils/date-time.util';
import {
  HttpStatus,
  Injectable,
  Optional,
  Inject,
  forwardRef,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@core/types/enums.types';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { CacheService } from '@infrastructure/cache/cache.service';
import { EventService } from '@infrastructure/events/event.service';
import { ConfigService } from '@config/config.service';
import { HealthcareErrorsService } from '@core/errors/healthcare-errors.service';
import { HealthcareError } from '@core/errors/healthcare-error.class';
import { ErrorCode } from '@core/errors/error-codes.enum';
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
import {
  nextAvailableSlotFromWorkingHours,
  workingHoursToSchedule,
  type DoctorScheduleEntry,
} from '@services/doctors/doctor-schedule.util';
import { ageFromDateOfBirth } from '@infrastructure/database/methods/appointment.methods';

/** Patient row for staff-facing lists, enriched with OPD visit counters. */
export type DoctorPatientListItem = PatientWithUser & {
  totalVisits: number;
  lastVisit: Date | null;
  /** Whole years from the user's date of birth; null when unknown. */
  age: number | null;
  /** Earliest upcoming SCHEDULED / CONFIRMED visit in this clinic; null when none. */
  nextAppointment: Date | null;
};

/** Filters of the staff patient lists (gender / age band / active flag are matched in memory). */
export interface ClinicPatientListFilters {
  search?: string;
  limit?: number;
  offset?: number;
  gender?: string;
  /** "18-30", "60+" or "0-17" (whole years, inclusive). */
  ageRange?: string;
  isActive?: boolean;
}

/** Parsed "min-max" / "min+" age band; null when the text is not an age range. */
export function parseAgeRange(value: string | undefined): { min: number; max: number } | null {
  if (!value) return null;
  const text = value.trim();
  const open = /^(\d{1,3})\s*\+$/.exec(text);
  if (open) return { min: Number(open[1]), max: Number.MAX_SAFE_INTEGER };
  const closed = /^(\d{1,3})\s*-\s*(\d{1,3})$/.exec(text);
  if (!closed) return null;
  const min = Number(closed[1]);
  const max = Number(closed[2]);
  return max >= min ? { min, max } : null;
}

/** Keys of the clinic form that are not Clinic columns and must never reach prisma.update. */
const CLINIC_LOCATION_FIELDS = ['city', 'state', 'country', 'zipCode'] as const;
const CLINIC_SETTINGS_FIELDS = ['operatingHours', 'status', 'type'] as const;

/**
 * One-level deep merge of the stored clinic settings with the incoming patch: nested objects are
 * merged key by key (so a page that edits `paymentSettings` cannot wipe `opdControls`), arrays and
 * scalars are replaced, `null` deletes a key.
 */
export function mergeClinicSettings(
  existing: unknown,
  patch: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!patch) return undefined;
  const base: Record<string, unknown> =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete base[key];
      continue;
    }
    const current = base[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      base[key] = {
        ...(current as Record<string, unknown>),
        ...(value as Record<string, unknown>),
      };
    } else {
      base[key] = value;
    }
  }
  return base;
}
import type { ClinicPatientOptions, ClinicPatientResult } from '@core/types/database.types';
import type { AssignClinicAdminDto, ClinicStatsResponseDto } from '@dtos/clinic.dto';
import type {
  PrismaTransactionClientWithDelegates,
  PrismaDelegateArgs,
} from '@core/types/prisma.types';
import { CommunicationConfigService } from '@communication/config';
import {
  type ClinicCommunicationConfig,
  EmailProvider,
  type ProviderConfig,
} from '@core/types/communication.types';

@Injectable()
export class ClinicService {
  private readonly eventService: IEventService;

  private sanitizeClinicSettings(
    settings?: Record<string, unknown>
  ): Record<string, unknown> | undefined {
    if (!settings) {
      return undefined;
    }

    const sanitizedSettings = { ...settings };
    const appointmentSettings =
      sanitizedSettings['appointmentSettings'] &&
      typeof sanitizedSettings['appointmentSettings'] === 'object' &&
      !Array.isArray(sanitizedSettings['appointmentSettings'])
        ? { ...(sanitizedSettings['appointmentSettings'] as Record<string, unknown>) }
        : undefined;

    if (appointmentSettings) {
      delete appointmentSettings['assistantDoctorCoverage'];
      sanitizedSettings['appointmentSettings'] = appointmentSettings;
    }

    return sanitizedSettings;
  }

  constructor(
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => LoggingService))
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
      /** Main location of the new clinic (the super-admin form sends the address details here). */
      mainLocation?: {
        name?: string;
        address?: string;
        city?: string;
        state?: string;
        country?: string;
        zipCode?: string;
        phone?: string;
        email?: string;
        timezone?: string;
        latitude?: number;
        longitude?: number;
        workingHours?: unknown;
        settings?: Record<string, unknown>;
      };
      city?: string;
      state?: string;
      country?: string;
      zipCode?: string;
      /** Clinic admin to assign: a User id or email of a CLINIC_ADMIN user. */
      clinicAdminIdentifier?: string;
      /** Role of the creator; a CLINIC_ADMIN creator becomes the clinic's admin when no identifier is sent. */
      createdByRole?: string;
      type?: string;
      operatingHours?: string;
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

      // `type` / `operatingHours` have no Clinic column: they live in settings.
      const settings = mergeClinicSettings(data.settings ?? {}, {
        ...(data.type ? { clinicType: data.type } : {}),
        ...(data.operatingHours ? { operatingHours: data.operatingHours } : {}),
      });

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
              ...(settings && Object.keys(settings).length > 0 && { settings: settings as never }),
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

      const mainLocation = await this.createMainLocation(clinic, data);
      const clinicAdminId = await this.assignInitialClinicAdmin(clinic.id, data);

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
        timestamp: nowIso(),
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

      return {
        ...(clinic as unknown as Record<string, unknown>),
        ...(mainLocation ? { mainLocation } : {}),
        ...(clinicAdminId ? { clinicAdminId } : {}),
      } as unknown as ClinicResponseDto;
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

  /** Writes city/state/country/zipCode from the clinic form onto the clinic's main (first active) location. */
  private async updateMainLocationAddress(
    clinicId: string,
    patch: Record<string, string>
  ): Promise<void> {
    const location = await this.databaseService.executeHealthcareRead<{ id: string } | null>(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        return (await typedClient.clinicLocation.findFirst({
          where: { clinicId, isActive: true, deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        } as PrismaDelegateArgs)) as { id: string } | null;
      }
    );
    if (!location) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Clinic address fields ignored: the clinic has no active location yet',
        'ClinicService',
        { clinicId, fields: Object.keys(patch) }
      );
      return;
    }
    await this.databaseService.executeHealthcareWrite(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        return await typedClient.clinicLocation.update({
          where: { id: location.id },
          data: { ...patch, updatedAt: new Date() },
        } as PrismaDelegateArgs);
      },
      {
        userId: 'system',
        clinicId,
        resourceType: 'CLINIC_LOCATION',
        operation: 'UPDATE',
        resourceId: location.id,
        userRole: 'system',
        details: { updateFields: Object.keys(patch), source: 'updateClinic' },
      }
    );
    if (this.cacheService) {
      await this.cacheService.invalidateCacheByTag('clinic_locations');
      await this.cacheService.invalidateCacheByTag(`clinic_location:${location.id}`);
    }
  }

  /**
   * The clinic's first location, from `mainLocation` or the top-level city/state/country/zipCode
   * the older form sends. Skipped when neither carries a city. Same row shape and id scheme as
   * ClinicLocationService.createClinicLocation.
   */
  private async createMainLocation(
    clinic: Clinic,
    data: Parameters<ClinicService['createClinic']>[0]
  ): Promise<ClinicLocationResponseDto | null> {
    const source = data.mainLocation ?? {};
    const city = source.city ?? data.city;
    const state = source.state ?? data.state;
    const country = source.country ?? data.country;
    if (!city || !state || !country) return null;

    const workingHours =
      typeof source.workingHours === 'string'
        ? source.workingHours
        : source.workingHours
          ? JSON.stringify(source.workingHours)
          : '9:00 AM - 5:00 PM';

    const location = await this.databaseService.executeHealthcareWrite<ClinicLocationResponseDto>(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        return (await typedClient.clinicLocation.create({
          data: {
            clinicId: clinic.id,
            locationId: `LOC-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
            name: source.name?.trim() || `${clinic.name} - Main`,
            address: source.address?.trim() || clinic.address,
            city,
            state,
            country,
            zipCode: source.zipCode ?? data.zipCode ?? null,
            phone: source.phone ?? clinic.phone,
            email: source.email ?? clinic.email,
            timezone: source.timezone ?? data.timezone ?? 'UTC',
            ...(source.latitude !== undefined && { latitude: source.latitude }),
            ...(source.longitude !== undefined && { longitude: source.longitude }),
            workingHours,
            ...(source.settings && { settings: source.settings as never }),
            isActive: true,
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs)) as unknown as ClinicLocationResponseDto;
      },
      {
        userId: data.createdBy || 'system',
        clinicId: clinic.id,
        resourceType: 'CLINIC_LOCATION',
        operation: 'CREATE',
        resourceId: '',
        userRole: 'system',
        details: { source: 'createClinic.mainLocation' },
      }
    );
    return location;
  }

  /**
   * Links the clinic to its first admin: the user named by `clinicAdminIdentifier` (User id or
   * email, must hold the CLINIC_ADMIN role), or the creator when a clinic admin creates a clinic.
   * Fails closed on an unknown or non-admin identifier (404 / 409) instead of leaving the clinic
   * without an owner silently.
   */
  private async assignInitialClinicAdmin(
    clinicId: string,
    data: { clinicAdminIdentifier?: string; createdBy: string; createdByRole?: string }
  ): Promise<string | null> {
    const identifier = data.clinicAdminIdentifier?.trim();
    const fallbackToCreator =
      !identifier && String(data.createdByRole || '').toUpperCase() === String(Role.CLINIC_ADMIN);
    if (!identifier && !fallbackToCreator) return null;

    const user = await this.databaseService.executeHealthcareRead<{
      id: string;
      role: string;
    } | null>(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return (await typedClient.user.findFirst({
        where: identifier
          ? { OR: [{ id: identifier }, { email: identifier.toLowerCase() }] }
          : { id: data.createdBy },
        select: { id: true, role: true },
      } as PrismaDelegateArgs)) as { id: string; role: string } | null;
    });

    if (!user) {
      throw new NotFoundException('Specified clinic admin user was not found');
    }
    if (String(user.role).toUpperCase() !== String(Role.CLINIC_ADMIN)) {
      throw new HealthcareError(
        ErrorCode.BUSINESS_RULE_VIOLATION,
        'The specified user is not a Clinic Admin',
        HttpStatus.CONFLICT,
        { userId: user.id }
      );
    }

    const admin = await this.databaseService.executeHealthcareWrite<ClinicAdmin>(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        // ClinicAdmin.userId is unique: an admin already attached elsewhere is moved to this clinic.
        return (await typedClient.clinicAdmin.upsert({
          where: { userId: user.id },
          create: { userId: user.id, clinicId, isOwner: true },
          update: { clinicId, isOwner: true },
        } as PrismaDelegateArgs)) as unknown as ClinicAdmin;
      },
      {
        userId: data.createdBy || 'system',
        clinicId,
        resourceType: 'CLINIC_ADMIN',
        operation: 'CREATE',
        resourceId: user.id,
        userRole: 'system',
        details: { source: 'createClinic.clinicAdminIdentifier' },
      }
    );
    return admin.id;
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
      const { communicationConfig, ...rawUpdateData } = data;
      const clinicUpdateData: Record<string, unknown> = { ...rawUpdateData };

      // The admin forms send address details and display settings that are not Clinic columns:
      // city/state/country/zipCode go to the main location, operatingHours/status/type to settings.
      // Spreading them into prisma.update used to fail every clinic save with "Unknown argument".
      const locationPatch: Record<string, string> = {};
      for (const field of CLINIC_LOCATION_FIELDS) {
        const value = clinicUpdateData[field];
        delete clinicUpdateData[field];
        if (typeof value === 'string' && value.trim()) locationPatch[field] = value.trim();
      }
      const settingsPatch: Record<string, unknown> = {};
      for (const field of CLINIC_SETTINGS_FIELDS) {
        const value = clinicUpdateData[field];
        delete clinicUpdateData[field];
        if (value !== undefined) settingsPatch[field === 'type' ? 'clinicType' : field] = value;
      }
      const incomingSettings = this.sanitizeClinicSettings(
        clinicUpdateData['settings'] as Record<string, unknown> | undefined
      );
      delete clinicUpdateData['settings'];
      const settingsToMerge =
        incomingSettings || Object.keys(settingsPatch).length > 0
          ? { ...(incomingSettings ?? {}), ...settingsPatch }
          : undefined;

      // Settings are merged into the stored JSON, never replaced wholesale: the super-admin page
      // edits a few keys and must not wipe opdControls / operatingWindowsByDay / paymentSettings.
      const existing = settingsToMerge
        ? await this.databaseService.executeHealthcareRead<{ settings: unknown } | null>(
            async client => {
              const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
              return (await typedClient.clinic.findUnique({
                where: { id },
                select: { settings: true },
              } as PrismaDelegateArgs)) as { settings: unknown } | null;
            }
          )
        : null;
      const mergedSettings = settingsToMerge
        ? mergeClinicSettings(existing?.settings, settingsToMerge)
        : undefined;

      // Use executeHealthcareWrite for update with full optimization layers
      const clinic = await this.databaseService.executeHealthcareWrite<Clinic>(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.clinic.update({
            where: { id } as PrismaDelegateArgs,
            data: {
              ...clinicUpdateData,
              ...(mergedSettings && { settings: mergedSettings as never }),
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

      if (Object.keys(locationPatch).length > 0) {
        await this.updateMainLocationAddress(id, locationPatch);
      }

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

      // Invalidate clinic cache to ensure fresh data on next fetch
      if (this.cacheService) {
        const cacheKeys = [
          `clinic:${clinic.id}:active:anon:no-ctx`,
          `clinic:${clinic.id}:active:anon:anon`,
          `clinic:${clinic.id}:all:anon:no-ctx`,
          `clinic:${clinic.id}:all:anon:anon`,
          `clinic:my:${clinic.id}`,
        ];
        await Promise.all(cacheKeys.map(key => this.cacheService!.delete(key)));
      }

      // Emit clinic lifecycle event
      void this.eventService.emitEnterprise('clinic.updated', {
        eventId: `clinic-updated-${clinic.id}`,
        eventType: 'clinic.updated',
        category: EventCategory.SYSTEM,
        priority: EventPriority.NORMAL,
        timestamp: nowIso(),
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

  /**
   * Resolve the configured clinic ID from env/config without ever returning an empty string.
   * Returns the configured CLINIC_ID, or null if not set. An empty string here would silently
   * bypass tenant-isolation checks in the PATIENT code paths, so we explicitly reject it.
   */
  private resolveConfiguredClinicId(): string | null {
    let fromConfig: string | undefined;
    try {
      fromConfig =
        typeof this.configService?.get === 'function'
          ? this.configService.get<string | undefined>('CLINIC_ID', undefined)
          : undefined;
    } catch {
      // CLINIC_ID may not be set in config store; fall back to env
      fromConfig = undefined;
    }
    const fromEnv = process.env['CLINIC_ID'];
    const raw = fromConfig || fromEnv || undefined;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
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
        const contextClinicId = clinicId || this.resolveConfiguredClinicId();

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
          ttl: 300, // 5 minutes (mutable user-dependent data)
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
      // Enforce isolation for every non-super-admin role — previously this
      // only ran for PATIENT, so CLINIC_ADMIN/DOCTOR/RECEPTIONIST/NURSE
      // could fetch any other clinic's data (including its patient list via
      // the sibling getClinicPatients/getClinicStaff endpoints) just by
      // passing a different clinic id in the URL.
      if (role !== Role.SUPER_ADMIN && userId) {
        const configuredClinicId = this.resolveConfiguredClinicId();

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
      if (!clinic) throw new NotFoundException('Clinic not found');

      // Post-fetch permission check for non-UUID access
      if (role !== Role.SUPER_ADMIN && userId) {
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

        const configuredClinicId = this.resolveConfiguredClinicId();
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
        timestamp: nowIso(),
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
      // Query the clinic-doctor join table directly so we always return the
      // clinic's actual configured doctors, regardless of role data drift.
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

        const doctorClinics = (await typedClient.doctorClinic.findMany({
          where: { clinicId: id } as PrismaDelegateArgs,
          select: {
            doctor: {
              select: {
                id: true,
                userId: true,
                specialization: true,
                experience: true,
                localizedProfile: true,
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    profilePicture: true,
                  },
                },
              },
            },
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs)) as unknown as Array<{
          doctor: Doctor & { user: { id: string; name: string; email: string } };
        }>;

        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.DEBUG,
          `Loaded doctor-clinic links for clinic ${id}`,
          'ClinicService',
          {
            clinicId: id,
            doctorLinkCount: doctorClinics.length,
          }
        );

        return doctorClinics.map(entry => ({
          doctor: entry.doctor,
        }));
      });

      if (doctors.length === 0) {
        const fallbackDoctors = await this.databaseService.executeHealthcareRead<
          Array<{ doctor: Doctor & { user: { id: string; name: string; email: string } } }>
        >(async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            user: {
              findMany: (args: PrismaDelegateArgs) => Promise<
                Array<{
                  doctor: Doctor & { user: { id: string; name: string; email: string } };
                }>
              >;
            };
          };

          const users = (await typedClient.user.findMany({
            where: {
              role: 'DOCTOR',
              doctor: {
                isNot: null,
              },
              OR: [
                { primaryClinicId: id },
                { clinics: { some: { id } } },
                { userRoles: { some: { clinicId: id, isActive: true } } },
              ],
            } as PrismaDelegateArgs,
            select: {
              doctor: {
                select: {
                  id: true,
                  userId: true,
                  specialization: true,
                  experience: true,
                  localizedProfile: true,
                  user: {
                    select: {
                      id: true,
                      name: true,
                      email: true,
                      profilePicture: true,
                    },
                  },
                },
              },
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs)) as unknown as Array<{
            doctor: Doctor & { user: { id: string; name: string; email: string } };
          }>;

          return users.filter(entry => Boolean(entry.doctor));
        });

        if (fallbackDoctors.length > 0) {
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.WARN,
            `Resolved clinic doctors for clinic ${id} via fallback doctor lookup`,
            'ClinicService',
            {
              clinicId: id,
              doctorCount: fallbackDoctors.length,
            }
          );
          return fallbackDoctors;
        }
      }

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Resolved clinic doctors for clinic ${id}`,
        'ClinicService',
        {
          clinicId: id,
          doctorCount: doctors.length,
        }
      );
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
          doctor?: { specialization: string; experience: number } | null;
          specialization?: string;
        }>
      >(async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
        const result = await typedClient.user.findMany({
          where: {
            OR: [
              // Users associated via their primary clinic assignment
              { primaryClinicId: id },
              // Doctors linked via the DoctorClinic join table
              { doctor: { clinics: { some: { clinicId: id } } } },
              // Profile-based staff associations
              { receptionists: { clinicId: id } },
              { clinicAdmins: { clinicId: id } },
              { pharmacist: { clinicId: id } },
              { nurse: { clinicId: id } },
              { therapist: { clinicId: id } },
              { labTechnician: { clinicId: id } },
              { counselor: { clinicId: id } },
              { supportStaff: { clinicId: id } },
              { financeBilling: { clinicId: id } },
              // Many-to-many clinic relation
              { clinics: { some: { id } } },
              // RBAC UserRole assignments
              { userRoles: { some: { clinicId: id, isActive: true } } },
            ],
          } as PrismaDelegateArgs,
          // NOTE: Use ONLY `select` (never mix with `include`). Nest doctor inside select.
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
            doctor: {
              select: {
                specialization: true,
                experience: true,
              },
            },
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

          const result = await typedClient.patient.findMany({
            where: {
              OR: [
                ...(patientIds.length > 0 ? [{ id: { in: patientIds } }] : []),
                { user: { primaryClinicId: id } },
                { user: { clinics: { some: { id } } } },
                { user: { userRoles: { some: { clinicId: id } } } },
              ],
            } as PrismaDelegateArgs,
            // `omit`: these lists are sent to staff browsers; the password hash must never be in them.
            include: { user: { omit: { password: true } } } as PrismaDelegateArgs,
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

  async getClinicPatientsPaginated(
    id: string,
    options?: ClinicPatientOptions
  ): Promise<ClinicPatientResult> {
    return await this.databaseService.getClinicPatients(id, options);
  }

  /**
   * A doctor's patient list is simply the clinic's patient list: patients
   * belong to the clinic, not to whichever doctor happens to see them (same
   * data receptionist/clinic-admin see via getClinicPatients). doctorUserId
   * is accepted for API-shape consistency and future auditing, not filtering.
   */
  async getClinicPatientsForDoctor(
    clinicId: string,
    _doctorUserId: string,
    options?: { search?: string; limit?: number; offset?: number }
  ): Promise<{ patients: DoctorPatientListItem[]; total: number }> {
    const limit = Math.min(options?.limit || 50, 200);
    const offset = Math.max(options?.offset || 0, 0);

    const patients = await this.databaseService.executeHealthcareRead<PatientWithUser[]>(
      async client => {
        const typedClient = client as unknown as PrismaTransactionClientWithDelegates;

        const appointments = await typedClient.appointment.findMany({
          where: { clinicId } as PrismaDelegateArgs,
          select: { patientId: true } as PrismaDelegateArgs,
          distinct: ['patientId'] as unknown as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        const patientIds = (appointments as Array<{ patientId: string }>).map(a => a.patientId);

        const result = await typedClient.patient.findMany({
          where: {
            OR: [
              ...(patientIds.length > 0 ? [{ id: { in: patientIds } }] : []),
              { user: { primaryClinicId: clinicId } },
              { user: { clinics: { some: { id: clinicId } } } },
              { user: { userRoles: { some: { clinicId } } } },
            ],
          } as PrismaDelegateArgs,
          // `omit`: these lists are sent to staff browsers; the password hash must never be in them.
            include: { user: { omit: { password: true } } } as PrismaDelegateArgs,
          // Stable ordering: without it Postgres returns rows in physical
          // order, which changes after any update and makes pagination
          // skip/duplicate patients.
          orderBy: { createdAt: 'desc' } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        return result as unknown as PatientWithUser[];
      }
    );

    const searchTerm = options?.search?.trim().toLowerCase();
    const filtered = searchTerm
      ? patients.filter(p => {
          const user = (p as unknown as { user?: Record<string, unknown> }).user;
          const haystack = [
            user?.['firstName'],
            user?.['lastName'],
            user?.['email'],
            user?.['phone'],
          ]
            .filter((value): value is string => typeof value === 'string')
            .join(' ')
            .toLowerCase();
          return haystack.includes(searchTerm);
        })
      : patients;

    const page = filtered.slice(offset, offset + limit);
    const pageIds = page.map(p => p.id);
    const [visitStats, nextVisits] = await Promise.all([
      this.getOpdVisitStats(clinicId, pageIds),
      this.getNextAppointments(clinicId, pageIds),
    ]);

    return {
      patients: page.map(p => {
        const dateOfBirth = (p as unknown as { user?: { dateOfBirth?: Date | string | null } }).user
          ?.dateOfBirth;
        return {
          ...p,
          totalVisits: visitStats.get(p.id)?.totalVisits ?? 0,
          lastVisit: visitStats.get(p.id)?.lastVisit ?? null,
          age: ageFromDateOfBirth(dateOfBirth),
          nextAppointment: nextVisits.get(p.id) ?? null,
        };
      }),
      total: filtered.length,
    };
  }

  /**
   * Earliest upcoming SCHEDULED / CONFIRMED visit per patient in this clinic, for the
   * "Next appointment" column of the doctor's patient list.
   */
  private async getNextAppointments(
    clinicId: string,
    patientIds: string[]
  ): Promise<Map<string, Date>> {
    const next = new Map<string, Date>();
    if (patientIds.length === 0) return next;

    const rows = await this.databaseService.executeHealthcareRead<
      Array<{ patientId: string; _min: { date: Date | null } }>
    >(async client => {
      const typedClient = client as unknown as {
        appointment: {
          groupBy: (
            args: PrismaDelegateArgs
          ) => Promise<Array<{ patientId: string; _min: { date: Date | null } }>>;
        };
      };
      return typedClient.appointment.groupBy({
        by: ['patientId'],
        where: {
          clinicId,
          patientId: { in: patientIds },
          status: { in: ['SCHEDULED', 'CONFIRMED'] },
          date: { gte: new Date() },
        },
        _min: { date: true },
      } as PrismaDelegateArgs);
    });

    for (const row of rows) {
      if (row._min.date) next.set(row.patientId, row._min.date);
    }
    return next;
  }

  /**
   * OPD visit counters for the "Visits" column of staff patient lists:
   * number of OPD registrations in this clinic and the most recent one.
   */
  private async getOpdVisitStats(
    clinicId: string,
    patientIds: string[]
  ): Promise<Map<string, { totalVisits: number; lastVisit: Date | null }>> {
    const stats = new Map<string, { totalVisits: number; lastVisit: Date | null }>();
    if (patientIds.length === 0) return stats;

    const rows = await this.databaseService.executeHealthcareRead<
      Array<{
        patientId: string;
        _count: { _all: number };
        _max: { registrationDate: Date | null };
      }>
    >(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        patientVisit: {
          groupBy: (args: PrismaDelegateArgs) => Promise<
            Array<{
              patientId: string;
              _count: { _all: number };
              _max: { registrationDate: Date | null };
            }>
          >;
        };
      };
      return typedClient.patientVisit.groupBy({
        by: ['patientId'],
        where: { clinicId, patientId: { in: patientIds } },
        _count: { _all: true },
        _max: { registrationDate: true },
      } as PrismaDelegateArgs);
    });

    for (const row of rows) {
      stats.set(row.patientId, {
        totalVisits: row._count._all,
        lastVisit: row._max.registrationDate,
      });
    }
    return stats;
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
            // `omit`: these lists are sent to staff browsers; the password hash must never be in them.
            include: { user: { omit: { password: true } } } as PrismaDelegateArgs,
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
            // `omit`: these lists are sent to staff browsers; the password hash must never be in them.
            include: { user: { omit: { password: true } } } as PrismaDelegateArgs,
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
      let clinicIdToUse: string | null = null;
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

      if (userRole && userRole.clinicId) {
        clinicIdToUse = userRole.clinicId;
      } else {
        const user = await this.databaseService.executeHealthcareRead<{
          primaryClinicId?: string | null;
        } | null>(async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
          return await typedClient.user.findUnique({
            where: { id: userId } as PrismaDelegateArgs,
            select: { primaryClinicId: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        });

        if (user && user.primaryClinicId) {
          clinicIdToUse = user.primaryClinicId;
        }
      }

      if (!clinicIdToUse) {
        throw new NotFoundException('No clinic association found for user');
      }

      return await this.getClinicById(clinicIdToUse);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
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
