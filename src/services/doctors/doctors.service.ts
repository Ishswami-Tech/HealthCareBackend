import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { CacheService } from '@infrastructure/cache/cache.service';
import { EventService } from '@infrastructure/events/event.service';
import { PrismaDelegateArgs, PrismaTransactionClientWithDelegates } from '@core/types/prisma.types';
import { LogType, LogLevel } from '@core/types/logging.types';

@Injectable()
export class DoctorsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => CacheService))
    private readonly cacheService: CacheService,
    @Inject(forwardRef(() => EventService))
    private readonly eventService: EventService
  ) {}

  /**
   * Helper to ensure Doctor record exists for a user used internally
   */
  async ensureDoctorProfile(userId: string) {
    const existing = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        doctor: { findUnique: (args: PrismaDelegateArgs) => Promise<unknown> };
      };
      return await typedClient.doctor.findUnique({
        where: { userId } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });

    if (!existing) {
      await this.databaseService.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            doctor: { create: (args: PrismaDelegateArgs) => Promise<unknown> };
          };
          // Basic empty doctor profile
          return await typedClient.doctor.create({
            data: {
              userId,
              specialization: 'General', // Default
              experience: 0,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        {
          userId: userId,
          clinicId: '',
          resourceType: 'DOCTOR',
          operation: 'CREATE',
          resourceId: 'new',
          userRole: 'system',
          details: { action: 'ensure_doctor_profile' },
        }
      );
    }
  }

  async createOrUpdateDoctor(data: {
    userId: string;
    clinicId?: string;
    specialization?: string;
    experience?: number;
    qualification?: string;
    consultationFee?: number;
    workingHours?: unknown; // Json
  }) {
    const { userId } = data;

    // 1. Ensure Profile
    await this.ensureDoctorProfile(userId);

    // 2. Update Doctor Details
    const updateData: Record<string, unknown> = {};
    if (data.specialization) updateData['specialization'] = data.specialization;
    if (data.experience !== undefined) updateData['experience'] = data.experience;
    if (data.qualification) updateData['qualification'] = data.qualification;
    if (data.consultationFee !== undefined) updateData['consultationFee'] = data.consultationFee;
    if (data.workingHours) updateData['workingHours'] = data.workingHours;

    if (Object.keys(updateData).length > 0) {
      await this.databaseService.executeHealthcareWrite(
        async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            doctor: { update: (args: PrismaDelegateArgs) => Promise<unknown> };
          };
          return await typedClient.doctor.update({
            where: { userId } as PrismaDelegateArgs,
            data: updateData as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        {
          userId,
          clinicId: data.clinicId || '',
          resourceType: 'DOCTOR',
          operation: 'UPDATE',
          resourceId: userId,
          userRole: 'system',
          details: { fields: Object.keys(updateData) },
        }
      );
    }

    if (data.clinicId) {
      await this.cacheService.invalidateClinicCache(data.clinicId);
      // ✅ Emit WebSocket event so all connected clients refetch the
      // clinic doctor list immediately instead of waiting for TTL.
      try {
        await this.eventService.emit('doctor.clinic.changed', {
          clinicId: data.clinicId,
          userId,
          action: 'updated',
        });
      } catch (eventError) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          'Failed to emit doctor.clinic.changed event',
          'DoctorsService',
          { error: (eventError as Error).message }
        );
      }
    }

    return { success: true, message: 'Doctor profile updated' };
  }

  async getDoctorProfile(userId: string) {
    return await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
        user: { findUnique: (args: PrismaDelegateArgs) => Promise<unknown> };
      };
      return await typedClient.user.findUnique({
        where: { id: userId } as PrismaDelegateArgs,
        include: {
          doctor: {
            include: {
              clinics: {
                include: { clinic: true },
              },
            },
          },
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
    });
  }

  async getAllDoctors(filters?: {
    specialization?: string | undefined;
    clinicId?: string | undefined;
    locationId?: string | undefined;
  }) {
    const clinicSegment = filters?.clinicId?.trim() || 'global';
    const specializationSegment = filters?.specialization?.trim() || 'all';
    const locationSegment = filters?.locationId?.trim() || 'all';

    // DEBUG: Log the incoming filters
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.DEBUG,
      `getAllDoctors called with filters: ${JSON.stringify({ filters, clinicSegment, specializationSegment, locationSegment })}`,
      'DoctorsService'
    );

    const cacheKey = this.cacheService
      .getKeyFactory()
      .fromTemplate('clinic:{clinicId}:doctors:spec:{specialization}:loc:{locationId}', {
        clinicId: clinicSegment,
        specialization: specializationSegment,
        locationId: locationSegment,
      });

    const result = await this.cacheService.cache(
      cacheKey,
      async () => {
        return await this.databaseService.executeHealthcareRead(async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            user: { findMany: (args: PrismaDelegateArgs) => Promise<unknown[]> };
          };

          const where: Record<string, unknown> = { role: 'DOCTOR' };

          if (filters?.specialization) {
            where['doctor'] = {
              specialization: { contains: filters.specialization, mode: 'insensitive' },
            };
          }

          // DEBUG: Log the where clause before query
          await this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.DEBUG,
            `getAllDoctors query - filters: ${JSON.stringify(filters)}, where clause: ${JSON.stringify(where)}`,
            'DoctorsService'
          );

          if (filters?.clinicId || filters?.locationId) {
            if (!where['doctor']) {
              where['doctor'] = {};
            }
            const doctorWhere = where['doctor'] as Record<string, unknown>;

            const clinicsFilter: Record<string, unknown> = {};

            if (filters.clinicId) {
              clinicsFilter['clinicId'] = filters.clinicId;
            }

            if (filters.locationId) {
              // Match doctors assigned specifically to this location OR not assigned to any specific location (clinic-wide)
              clinicsFilter['OR'] = [{ locationId: filters.locationId }, { locationId: null }];
            }

            doctorWhere['clinics'] = {
              some: clinicsFilter,
            };
          }

          return await typedClient.user.findMany({
            where: where as PrismaDelegateArgs,
            include: {
              doctor: true,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        });
      },
      {
        ttl: 86400,
        enableSwr: true,
        tags: [
          'doctors',
          `clinic:${clinicSegment}`,
          `clinic:${clinicSegment}:doctors`,
          `clinic:${clinicSegment}:doctors:spec:${specializationSegment}:loc:${locationSegment}`,
        ],
      }
    );

    // DEBUG: Log the final result
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.DEBUG,
      `getAllDoctors final result - count: ${result?.length || 0}`,
      'DoctorsService'
    );

    if (!Array.isArray(result) || result.length > 0) {
      return result;
    }

    // Empty array — don't cache (interceptor will skip writing [] to cache).
    return result;
  }
}
