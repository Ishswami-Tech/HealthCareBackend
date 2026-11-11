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
import type { LocalizedProfile } from '@services/doctors/localized-profile.util';
import { DOCTOR_PROFILE_USER_SELECT } from '@services/doctors/doctor-response.util';

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
  /** Already validated by normalizeLocalizedProfile; null clears the column. */
  localizedProfile?: LocalizedProfile | null;
  /** ABDM Health Professional Registry (HPR) id. Scaffolding only; not yet verified against ABDM. */
  abdmHprId?: string;
}

/** Fixed fees (rupees) a doctor earns per visit type in a clinic; admin-only, rest is convenience fee. */
export interface DoctorFeeSplitInput {
  /** null clears the fixed fee, so the percentage platform fee applies again. */
  videoDoctorFee?: number | null;
  inPersonDoctorFee?: number | null;
}

/** Identity fields of a doctor needed to describe them as an external practitioner (FHIR). */
export interface DoctorPractitionerSummary {
  id: string;
  name: string | null;
  licenseNumber: string | null;
  qualification: string | null;
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
  'abdmHprId',
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
  if (data.localizedProfile !== undefined) {
    updateData['localizedProfile'] =
      data.localizedProfile === null ? Prisma.DbNull : data.localizedProfile;
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
      // GET /user/profile (UsersService.findOne) independently caches this same doctor record
      // under its own tags — license/qualification/certifications/languages/abdmHprId etc. live
      // there too (the profile screen's Professional tab reads them from there), and nothing
      // else invalidates it on a doctor-record save. Without this, a save looked like it silently
      // didn't persist: the UI showed the new value from local state until the next hard reload,
      // which then served the stale cached response for up to its 300s TTL.
      await this.cacheService.invalidateCacheByTag(`user:${userId}`);
      await this.cacheService.invalidateCacheByTag('user_profiles');
      await this.cacheService.invalidateCacheByTag('user_details');
      // The patient clinic payload carries `expectedWalkInFee`, derived from doctor fees.
      if ('consultationFee' in updateData || 'inPersonConsultationEnabled' in updateData) {
        await this.cacheService.invalidateCacheByTag('user_clinic');
        await this.cacheService.invalidateCacheByTag('clinics');
      }
      if (!data.clinicId) await this.invalidateDoctorClinicLists(userId);
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
   * Clinic-scoped doctor lists (GET /doctors, /clinics/:id/doctors) are cached per clinic. Callers
   * without a clinic context (SUPER_ADMIN) must still bust the lists of every clinic the doctor is in.
   */
  private async invalidateDoctorClinicLists(userId: string): Promise<void> {
    const links = await this.databaseService.executeHealthcareRead(async client => {
      const tx = client as unknown as Prisma.TransactionClient;
      return await tx.doctorClinic.findMany({
        where: { doctor: { userId } },
        select: { clinicId: true },
      });
    });
    for (const clinicId of new Set(links.map(link => link.clinicId))) {
      await this.cacheService.invalidateClinicCache(clinicId);
    }
    await this.cacheService.invalidateCacheByTag('doctors');
  }

  /**
   * Partial profile update. A DOCTOR may edit only their own profile; a CLINIC_ADMIN only
   * doctors assigned to their clinic; SUPER_ADMIN any doctor. `targetUserId` is the doctor's
   * User id (same identifier as GET /doctors/:id). Money fields (what the patient pays and
   * what the doctor earns) are admin-only.
   */
  async updateDoctorProfile(
    targetUserId: string,
    actor: DoctorProfileActor,
    data: DoctorProfileFieldsInput,
    fees: DoctorFeeSplitInput = {}
  ) {
    const isAdmin = actor.role === 'SUPER_ADMIN' || actor.role === 'CLINIC_ADMIN';
    const hasFees = fees.videoDoctorFee !== undefined || fees.inPersonDoctorFee !== undefined;
    // What a doctor earns is set by an admin, never by the doctor themselves.
    if (hasFees && !isAdmin) {
      throw new ForbiddenException('Only an admin can set what a doctor earns');
    }
    // The patient-facing prices are clinic pricing too, so a doctor cannot change their own.
    // Older clients resend the whole profile, so an unchanged price is ignored, not refused.
    const hasPrices = data.consultationFee !== undefined || data.videoConsultationFee !== undefined;
    const profileData =
      hasPrices && !isAdmin ? await this.withoutUnchangedPrices(targetUserId, data) : data;
    await this.assertCanEditProfile(targetUserId, actor);
    if (hasFees && !actor.clinicId) {
      throw new BadRequestException('Clinic context is required to set doctor fees');
    }
    const result = await this.createOrUpdateDoctor({
      ...profileData,
      userId: targetUserId,
      ...(actor.clinicId ? { clinicId: actor.clinicId } : {}),
    });
    if (hasFees && actor.clinicId) {
      await this.saveDoctorFees(targetUserId, actor.clinicId, actor, fees);
    }
    return { ...result, profile: await this.getDoctorProfile(targetUserId) };
  }

  /**
   * A non-admin may not change consultation prices: a sent price that differs from the stored
   * one is refused (403); a price equal to the stored one is dropped from the update.
   */
  private async withoutUnchangedPrices(
    targetUserId: string,
    data: DoctorProfileFieldsInput
  ): Promise<DoctorProfileFieldsInput> {
    const stored = await this.databaseService.executeHealthcareRead(async client => {
      const typedClient = client as unknown as PrismaTransactionClientWithDelegates;
      return (await typedClient.doctor.findUnique({
        where: { userId: targetUserId } as PrismaDelegateArgs,
        select: { consultationFee: true, videoConsultationFee: true } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as unknown as {
        consultationFee?: number | null;
        videoConsultationFee?: number | null;
      } | null;
    });
    const unchanged = (sent: number | undefined, current: number | null | undefined): boolean =>
      sent === undefined || (current != null && Number(current) === Number(sent));
    if (
      !unchanged(data.consultationFee, stored?.consultationFee) ||
      !unchanged(data.videoConsultationFee, stored?.videoConsultationFee)
    ) {
      throw new ForbiddenException('Only an admin can set consultation prices');
    }
    const { consultationFee: _consultationFee, videoConsultationFee: _videoFee, ...rest } = data;
    return rest;
  }

  /** Stores the doctor's fixed fees for this clinic. Affects only payments made afterwards. */
  private async saveDoctorFees(
    targetUserId: string,
    clinicId: string,
    actor: DoctorProfileActor,
    fees: DoctorFeeSplitInput
  ): Promise<void> {
    const data: Record<string, number | null> = {};
    if (fees.videoDoctorFee !== undefined) data['videoDoctorFee'] = fees.videoDoctorFee;
    if (fees.inPersonDoctorFee !== undefined) data['inPersonDoctorFee'] = fees.inPersonDoctorFee;
    await this.databaseService.executeHealthcareWrite(
      async client => {
        const tx = client as unknown as Prisma.TransactionClient;
        const result = await tx.doctorClinic.updateMany({
          where: { clinicId, doctor: { userId: targetUserId } },
          data,
        });
        if (result.count === 0) {
          throw new NotFoundException('Doctor not found in this clinic');
        }
      },
      {
        userId: actor.userId,
        userRole: actor.role,
        clinicId,
        resourceType: 'DOCTOR_FEE_SPLIT',
        operation: 'UPDATE',
        resourceId: targetUserId,
        details: { ...data },
      }
    );
    await this.cacheService.invalidateCacheByTag(`doctor:${targetUserId}`);
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
            select: DOCTOR_PROFILE_USER_SELECT as PrismaDelegateArgs,
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
    limit?: number | undefined;
  }) {
    const clinicSegment = filters?.clinicId?.trim() || 'global';
    const specializationSegment = filters?.specialization?.trim() || 'all';
    const locationSegment = filters?.locationId?.trim() || 'all';
    const hasValidLimit = typeof filters?.limit === 'number' && filters.limit >= 0;
    const limitSegment = hasValidLimit ? String(filters?.limit) : 'all';

    // DEBUG: Log the incoming filters. Fire-and-forget: this runs on every call (hit or
    // miss) ahead of the cache lookup, and awaiting it taxed every GET /doctors request
    // with a cache round-trip before the real work even started.
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.DEBUG,
      `getAllDoctors called with filters: ${JSON.stringify({ filters, clinicSegment, specializationSegment, locationSegment })}`,
      'DoctorsService'
    );

    const cacheKey = this.cacheService
      .getKeyFactory()
      .fromTemplate(
        'clinic:{clinicId}:doctors:spec:{specialization}:loc:{locationId}:limit:{limit}',
        {
          clinicId: clinicSegment,
          specialization: specializationSegment,
          locationId: locationSegment,
          limit: limitSegment,
        }
      );

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

        // DEBUG: Log the where clause before query. Fire-and-forget: only runs on a
        // cache miss, but still shouldn't add a cache round-trip ahead of the DB read.
        void this.loggingService.log(
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
          select: DOCTOR_PROFILE_USER_SELECT as PrismaDelegateArgs,
          ...(hasValidLimit && { take: filters?.limit }),
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
        `clinic:${clinicSegment}:doctors:spec:${specializationSegment}:loc:${locationSegment}:limit:${limitSegment}`,
      ],
    };

    let result = await this.cacheService.cache(cacheKey, fetchDoctorsFromDatabase, cacheOptions);

    if (Array.isArray(result) && result.length === 0) {
      void this.loggingService.log(
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

    // DEBUG: Log the final result. Fire-and-forget: runs on every call, hit or miss.
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.DEBUG,
      `getAllDoctors final result - count: ${Array.isArray(result) ? result.length : 0}`,
      'DoctorsService'
    );

    return result;
  }

  /** Doctors (by Doctor.id) who practise in `clinicId`; ids outside the clinic are omitted. */
  async getPractitionerSummaries(
    doctorIds: readonly string[],
    clinicId: string
  ): Promise<DoctorPractitionerSummary[]> {
    if (doctorIds.length === 0) return [];
    const rows = await this.databaseService.executeHealthcareRead(async client => {
      const tx = client as unknown as Prisma.TransactionClient;
      return await tx.doctor.findMany({
        where: { id: { in: [...doctorIds] }, clinics: { some: { clinicId } } },
        select: {
          id: true,
          licenseNumber: true,
          qualification: true,
          user: { select: { name: true } },
        },
      });
    });
    return rows.map(row => ({
      id: row.id,
      name: row.user?.name ?? null,
      licenseNumber: row.licenseNumber ?? null,
      qualification: row.qualification ?? null,
    }));
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
