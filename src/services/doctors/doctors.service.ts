import {
  Injectable,
  Inject,
  forwardRef,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@infrastructure/database/prisma/generated/client';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { CacheService } from '@infrastructure/cache/cache.service';
import { EventService } from '@infrastructure/events/event.service';
import { PrismaDelegateArgs, PrismaTransactionClientWithDelegates } from '@core/types/prisma.types';
import { LogType, LogLevel } from '@core/types/logging.types';

/** Optional professional-profile fields that are copied verbatim when defined. */
export interface DoctorProfileFieldsInput {
  specialization?: string;
  experience?: number;
  qualification?: string;
  consultationFee?: number;
  workingHours?: unknown;
  videoConsultationFee?: number;
  slotDurationMinutes?: number;
  videoConsultationEnabled?: boolean;
  inPersonConsultationEnabled?: boolean;
  licenseNumber?: string;
  languages?: string[];
  education?: string;
  certifications?: string[];
}

export interface DoctorProfileActor {
  userId: string;
  role: string;
  clinicId?: string | undefined;
}

export interface DoctorReviewsPage {
  items: {
    id: string;
    rating: number;
    comment: string | null;
    createdAt: Date;
    reviewerName: string;
  }[];
  averageRating: number;
  reviewCount: number;
  meta: { page: number; limit: number; total: number; totalPages: number };
}

const REVIEWS_DEFAULT_LIMIT = 10;
const REVIEWS_MAX_LIMIT = 50;

/** "Asha Patil" -> "Asha P." so reviews never expose a full patient name. */
export function maskReviewerName(
  firstName?: string | null,
  lastName?: string | null,
  fallback?: string | null
): string {
  const first = firstName?.trim();
  const last = lastName?.trim();
  if (first) return last ? `${first} ${last.charAt(0).toUpperCase()}.` : first;
  const parts = fallback?.trim().split(/\s+/);
  if (parts?.[0]) return parts[1] ? `${parts[0]} ${parts[1].charAt(0).toUpperCase()}.` : parts[0];
  return 'Patient';
}

const PASS_THROUGH_FIELDS = [
  'videoConsultationFee',
  'slotDurationMinutes',
  'videoConsultationEnabled',
  'inPersonConsultationEnabled',
  'licenseNumber',
  'languages',
  'education',
  'certifications',
] as const;

/** Builds the Doctor update payload; undefined values are never written. */
export function buildDoctorProfileUpdate(data: DoctorProfileFieldsInput): Record<string, unknown> {
  const updateData: Record<string, unknown> = {};
  if (data.specialization) updateData['specialization'] = data.specialization;
  if (data.experience !== undefined) updateData['experience'] = data.experience;
  if (data.qualification) updateData['qualification'] = data.qualification;
  if (data.consultationFee !== undefined) updateData['consultationFee'] = data.consultationFee;
  if (data.workingHours) updateData['workingHours'] = data.workingHours;
  for (const key of PASS_THROUGH_FIELDS) {
    if (data[key] !== undefined) updateData[key] = data[key];
  }
  return updateData;
}

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

  async createOrUpdateDoctor(
    data: DoctorProfileFieldsInput & {
      userId: string;
      clinicId?: string;
    }
  ) {
    const { userId } = data;

    // 1. Ensure Profile
    await this.ensureDoctorProfile(userId);

    // 2. Update Doctor Details
    const updateData = buildDoctorProfileUpdate(data);

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

      // Bust the getDoctorProfile cache added above — it wouldn't otherwise be
      // invalidated by anything (invalidateClinicCache below only fires when
      // clinicId is provided, and only busts clinic-scoped tags).
      await this.cacheService.invalidateCacheByTag(`doctor:${userId}`);
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

  /**
   * Partial profile update. A DOCTOR may edit only their own profile; a CLINIC_ADMIN only
   * doctors assigned to their clinic; SUPER_ADMIN any doctor. `targetUserId` is the doctor's
   * User id (same identifier as GET /doctors/:id).
   */
  async updateDoctorProfile(
    targetUserId: string,
    actor: DoctorProfileActor,
    data: DoctorProfileFieldsInput
  ) {
    await this.assertCanEditProfile(targetUserId, actor);
    const result = await this.createOrUpdateDoctor({
      ...data,
      userId: targetUserId,
      ...(actor.clinicId ? { clinicId: actor.clinicId } : {}),
    });
    return { ...result, profile: await this.getDoctorProfile(targetUserId) };
  }

  /**
   * Onboard/update a doctor from POST /doctors. A CLINIC_ADMIN may only onboard a user whose role
   * is DOCTOR and who is either already in their clinic or in no clinic yet (then the clinic
   * link is created); a doctor already assigned to another clinic is rejected. SUPER_ADMIN is
   * unrestricted.
   */
  async onboardDoctor(
    actor: Pick<DoctorProfileActor, 'role' | 'clinicId'>,
    data: DoctorProfileFieldsInput & { userId: string; clinicId?: string }
  ) {
    if (actor.role === 'CLINIC_ADMIN') {
      const clinicId = actor.clinicId;
      if (!clinicId) throw new ForbiddenException('Clinic context is required');
      await this.assertOnboardableDoctor(data.userId, clinicId);
    }
    const result = await this.createOrUpdateDoctor(data);
    if (actor.role === 'CLINIC_ADMIN' && actor.clinicId) {
      const clinicId = actor.clinicId;
      await this.databaseService.executeHealthcareWrite(
        async client => {
          const tx = client as unknown as Prisma.TransactionClient;
          const doctor = await tx.doctor.findUnique({
            where: { userId: data.userId },
            select: { id: true },
          });
          if (doctor) {
            await tx.doctorClinic.createMany({
              data: [{ doctorId: doctor.id, clinicId }],
              skipDuplicates: true,
            });
          }
        },
        {
          userId: data.userId,
          clinicId,
          resourceType: 'DOCTOR',
          operation: 'UPDATE',
          resourceId: data.userId,
          userRole: 'CLINIC_ADMIN',
          details: { action: 'assign_doctor_to_clinic' },
        }
      );
      await this.cacheService.invalidateCacheByTag(`doctor:${data.userId}`);
    }
    return result;
  }

  private async assertOnboardableDoctor(userId: string, clinicId: string): Promise<void> {
    const user = await this.databaseService.executeHealthcareRead(async client => {
      const tx = client as unknown as Prisma.TransactionClient;
      return await tx.user.findUnique({
        where: { id: userId },
        select: { role: true, doctor: { select: { clinics: { select: { clinicId: true } } } } },
      });
    });
    if (!user || String(user.role) !== 'DOCTOR') {
      throw new NotFoundException('Doctor user not found');
    }
    const assigned = user.doctor?.clinics ?? [];
    if (assigned.length > 0 && !assigned.some(c => c.clinicId === clinicId)) {
      throw new ConflictException('This doctor is already assigned to another clinic');
    }
  }

  private async assertCanEditProfile(targetUserId: string, actor: DoctorProfileActor) {
    if (actor.role === 'SUPER_ADMIN') return;
    if (actor.role === 'DOCTOR') {
      if (actor.userId !== targetUserId) {
        throw new ForbiddenException('Doctors can only edit their own profile');
      }
      return;
    }
    if (actor.role === 'CLINIC_ADMIN' && actor.clinicId) {
      const assigned = await this.databaseService.executeHealthcareRead(async client => {
        const tx = client as unknown as Prisma.TransactionClient;
        return await tx.doctorClinic.findFirst({
          where: { clinicId: actor.clinicId as string, doctor: { userId: targetUserId } },
          select: { doctorId: true },
        });
      });
      if (!assigned) {
        throw new NotFoundException('Doctor not found in this clinic');
      }
      return;
    }
    throw new ForbiddenException('Insufficient permissions to edit this doctor profile');
  }

  async getDoctorProfile(userId: string) {
    // Same pattern as getAllDoctors below: reference data that changes only on an
    // explicit profile edit. Tagged `doctor:${userId}` so it's busted both by
    // createOrUpdateDoctor below and by CacheService.invalidateAppointmentCache
    // (appointment writes already tag doctor:${doctorId}), and `user:${userId}`
    // so any generic user-profile update also busts it.
    return await this.cacheService.cache(
      this.cacheService.getKeyFactory().fromTemplate('doctor:{userId}:profile', { userId }),
      async () =>
        this.databaseService.executeHealthcareRead(async client => {
          const typedClient = client as unknown as PrismaTransactionClientWithDelegates & {
            user: { findUnique: (args: PrismaDelegateArgs) => Promise<unknown> };
          };
          const user = (await typedClient.user.findUnique({
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
          } as PrismaDelegateArgs)) as { doctor?: { id: string } | null } | null;
          if (!user?.doctor) return user;
          const stats = await (client as unknown as Prisma.TransactionClient).review.aggregate({
            where: { doctorId: user.doctor.id },
            _avg: { rating: true },
            _count: { _all: true },
          });
          return {
            ...user,
            reviewStats: {
              averageRating: stats._avg.rating ? Math.round(stats._avg.rating * 10) / 10 : 0,
              reviewCount: stats._count._all,
            },
          };
        }),
      {
        ttl: 3600,
        enableSwr: true,
        tags: [`doctor:${userId}`, `user:${userId}`],
      }
    );
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

    const fetchDoctorsFromDatabase = async () => {
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
    };

    const cacheOptions = {
      ttl: 86400,
      enableSwr: true,
      tags: [
        'doctors',
        `clinic:${clinicSegment}`,
        `clinic:${clinicSegment}:doctors`,
        `clinic:${clinicSegment}:doctors:spec:${specializationSegment}:loc:${locationSegment}`,
      ],
    };

    let result = await this.cacheService.cache(cacheKey, fetchDoctorsFromDatabase, cacheOptions);

    if (Array.isArray(result) && result.length === 0) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'getAllDoctors cache returned no doctors, forcing direct database refresh',
        'DoctorsService',
        { filters, clinicSegment, specializationSegment, locationSegment }
      );

      result = await this.cacheService.cache(cacheKey, fetchDoctorsFromDatabase, {
        ...cacheOptions,
        forceRefresh: true,
      });
    }

    // DEBUG: Log the final result
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.DEBUG,
      `getAllDoctors final result - count: ${Array.isArray(result) ? result.length : 0}`,
      'DoctorsService'
    );

    return result;
  }

  // ---------------------------------------------------------------------------
  // Reviews. Reuses the `Review` table that VideoService.rateConsultation already
  // writes to, so ratings from both flows share one aggregate. Video reviews are
  // deduplicated via appointment.metadata.consultationRating; reviews created here
  // carry Review.appointmentId (unique) for one-review-per-appointment.
  // ---------------------------------------------------------------------------

  /** `idOrUserId` may be the Doctor id or the doctor's User id; doctor must be in the clinic. */
  private async resolveClinicDoctor(
    idOrUserId: string,
    clinicId: string
  ): Promise<{ id: string; userId: string }> {
    const doctor = await this.databaseService.executeHealthcareRead(async client => {
      const tx = client as unknown as Prisma.TransactionClient;
      return await tx.doctor.findFirst({
        where: {
          OR: [{ id: idOrUserId }, { userId: idOrUserId }],
          clinics: { some: { clinicId } },
        },
        select: { id: true, userId: true },
      });
    });
    if (!doctor) throw new NotFoundException('Doctor not found');
    return doctor;
  }

  async listDoctorReviews(
    idOrUserId: string,
    clinicId: string,
    page = 1,
    limit = REVIEWS_DEFAULT_LIMIT
  ): Promise<DoctorReviewsPage> {
    const safePage = Math.max(1, Math.floor(page));
    const safeLimit = Math.min(REVIEWS_MAX_LIMIT, Math.max(1, Math.floor(limit)));
    const doctor = await this.resolveClinicDoctor(idOrUserId, clinicId);
    const where = { doctorId: doctor.id, clinicId };

    return await this.databaseService.executeHealthcareRead(async client => {
      const tx = client as unknown as Prisma.TransactionClient;
      // Sequential on purpose: both queries share one pg client inside this callback, and
      // running them concurrently triggers pg's "client.query() when the client is already
      // executing a query" deprecation, which becomes a hard error in pg@9.
      const rows = await tx.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        select: {
          id: true,
          rating: true,
          comment: true,
          createdAt: true,
          patient: {
            select: { user: { select: { firstName: true, lastName: true, name: true } } },
          },
        },
      });
      const stats = await tx.review.aggregate({
        where,
        _avg: { rating: true },
        _count: { _all: true },
      });
      const total = stats._count._all;
      return {
        items: rows.map(r => ({
          id: r.id,
          rating: r.rating,
          comment: r.comment,
          createdAt: r.createdAt,
          reviewerName: maskReviewerName(
            r.patient?.user?.firstName,
            r.patient?.user?.lastName,
            r.patient?.user?.name
          ),
        })),
        averageRating: stats._avg.rating ? Math.round(stats._avg.rating * 10) / 10 : 0,
        reviewCount: total,
        meta: { page: safePage, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) },
      };
    });
  }

  async createDoctorReview(
    idOrUserId: string,
    clinicId: string,
    patientUserId: string,
    input: { appointmentId: string; rating: number; comment?: string | undefined }
  ): Promise<{ id: string; rating: number; comment: string | null }> {
    const doctor = await this.resolveClinicDoctor(idOrUserId, clinicId);

    const created = await this.databaseService.executeHealthcareWrite(
      async client => {
        const tx = client as unknown as Prisma.TransactionClient;
        const patient = await tx.patient.findUnique({
          where: { userId: patientUserId },
          select: { id: true },
        });
        if (!patient) throw new ForbiddenException('Only patients can review a doctor');

        const appointment = await tx.appointment.findFirst({
          where: { id: input.appointmentId, clinicId, doctorId: doctor.id, patientId: patient.id },
          select: { id: true, status: true, metadata: true },
        });
        // Fail closed: another patient's / doctor's appointment looks nonexistent.
        if (!appointment) throw new NotFoundException('Appointment not found');
        if (String(appointment.status).toUpperCase() !== 'COMPLETED') {
          throw new BadRequestException('You can review a doctor after a completed appointment');
        }
        const metadata =
          appointment.metadata &&
          typeof appointment.metadata === 'object' &&
          !Array.isArray(appointment.metadata)
            ? (appointment.metadata as Record<string, unknown>)
            : {};
        if (metadata['consultationRating']) {
          throw new ConflictException('This appointment has already been reviewed');
        }

        try {
          const review = await tx.review.create({
            data: {
              rating: input.rating,
              comment: input.comment?.trim() || null,
              patientId: patient.id,
              doctorId: doctor.id,
              clinicId,
              appointmentId: appointment.id,
            },
            select: { id: true, rating: true, comment: true },
          });
          const stats = await tx.review.aggregate({
            where: { doctorId: doctor.id },
            _avg: { rating: true },
          });
          await tx.doctor.update({
            where: { id: doctor.id },
            data: { rating: Math.round((stats._avg.rating ?? 0) * 10) / 10 },
          });
          return review;
        } catch (error) {
          if ((error as { code?: string }).code === 'P2002') {
            throw new ConflictException('This appointment has already been reviewed');
          }
          throw error;
        }
      },
      {
        userId: patientUserId,
        clinicId,
        resourceType: 'REVIEW',
        operation: 'CREATE',
        resourceId: input.appointmentId,
        userRole: 'PATIENT',
        details: { doctorId: doctor.id, rating: input.rating },
      }
    );

    await this.cacheService.invalidateCacheByTag(`doctor:${doctor.userId}`);
    await this.cacheService.invalidateCacheByTag(`clinic:${clinicId}:doctors`);
    return created;
  }
}
