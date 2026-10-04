/**
 * Family Members Service
 * @module FamilyMembers
 * @description Dependents registered under a head-of-family patient.
 *
 * A dependent is a real patient (own User + Patient rows, no login) so every
 * existing visit / EHR / prescription flow works for them unchanged. The
 * `FamilyMember` row is the link back to the head of family. `User.phone` is
 * unique, so the shared family phone is stored on the FamilyMember row, not
 * on the dependent's User.
 */

import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { generateUserId } from '@utils/user-id.util';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events/event.service';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LogLevel, LogType } from '@core/types';
import { Role } from '@core/types/enums.types';
import type {
  PrismaDelegateArgs,
  PrismaTransactionClientWithDelegates,
} from '@core/types/prisma.types';
import type {
  CreateFamilyMemberDto,
  FamilyMemberResponse,
  UpdateFamilyMemberDto,
} from '@dtos/family-member.dto';
import type { VisitActor } from '@services/patient-visits/patient-visits.service';

interface FamilyMemberRow {
  id: string;
  patientId: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  relation: string;
  gender: string | null;
  dateOfBirth: Date | null;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

type FamilyClient = PrismaTransactionClientWithDelegates & {
  familyMember: {
    create: (args: PrismaDelegateArgs) => Promise<FamilyMemberRow>;
    findFirst: (args: PrismaDelegateArgs) => Promise<FamilyMemberRow | null>;
    findMany: (args: PrismaDelegateArgs) => Promise<FamilyMemberRow[]>;
    update: (args: PrismaDelegateArgs) => Promise<FamilyMemberRow>;
    count: (args: PrismaDelegateArgs) => Promise<number>;
  };
};

interface CreatedFamilyMember {
  member: FamilyMemberRow;
  dependentPatientId: string;
}

/** Most ACTIVE dependents a patient may add to their own account (POST /family-members/me). */
export const MAX_ACTIVE_DEPENDENTS_PER_PATIENT = 10;

/**
 * Most dependents a patient may CREATE in a rolling window, counting the ones they
 * later removed. Without it, create/remove cycling keeps the ACTIVE count low while
 * minting unlimited User + Patient rows (a removal is only a soft delete).
 */
export const MAX_DEPENDENT_CREATIONS_PER_WINDOW = 20;
export const DEPENDENT_CREATION_WINDOW_DAYS = 30;

/** Per-household lock: count + create must not interleave (see `withHouseholdLock`). */
const HOUSEHOLD_LOCK_TTL_SECONDS = 30;
const HOUSEHOLD_LOCK_ATTEMPTS = 40;
const HOUSEHOLD_LOCK_RETRY_MS = 50;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface CreateFamilyMemberOptions {
  /**
   * Reject (409) when the head of family already has this many ACTIVE dependents.
   * Set for patient self-service; clinic staff registering a household are not capped.
   */
  readonly maxActiveDependents?: number;
  /**
   * Reject (429) when the head of family created this many dependents in the last
   * `DEPENDENT_CREATION_WINDOW_DAYS` days, INCLUDING soft-deleted ones. Set for
   * patient self-service together with `maxActiveDependents`.
   */
  readonly maxRecentCreations?: number;
}

@Injectable()
export class FamilyMembersService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService,
    private readonly cacheService: CacheService
  ) {}

  async createFamilyMember(
    dto: CreateFamilyMemberDto,
    clinicId: string,
    actor: VisitActor,
    options: CreateFamilyMemberOptions = {}
  ): Promise<FamilyMemberResponse> {
    const primary = await this.databaseService.executeHealthcareRead<{ id: string } | null>(
      async client => {
        const tc = client as unknown as PrismaTransactionClientWithDelegates;
        const row = await tc.patient.findUnique({
          where: { id: dto.primaryPatientId } as PrismaDelegateArgs,
          select: { id: true } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        return row ? { id: row.id } : null;
      }
    );
    if (!primary) {
      throw new NotFoundException(`Patient ${dto.primaryPatientId} not found`);
    }
    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();
    const fullName = `${firstName} ${lastName}`.trim();
    const dateOfBirth = dto.dateOfBirth ? new Date(dto.dateOfBirth) : null;
    const gender = this.cleanText(dto.gender)?.toUpperCase() ?? null;

    const insertMember = (): Promise<CreatedFamilyMember> =>
      this.databaseService.executeHealthcareWrite<CreatedFamilyMember>(
        async client => {
          const tc = client as unknown as FamilyClient;

          const user = await tc.user.create({
            data: {
              userid: generateUserId(dto.phone?.trim() || fullName, false),
              name: fullName,
              firstName,
              lastName,
              role: Role.PATIENT,
              gender,
              dateOfBirth,
              primaryClinicId: clinicId,
              isActive: true,
              isVerified: false,
              // Dependents never log in, so there is no profile to complete.
              isProfileComplete: true,
              profileCompletedAt: new Date(),
              clinics: { connect: { id: clinicId } },
            } as PrismaDelegateArgs,
            select: { id: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);

          const patient = await tc.patient.create({
            data: { userId: user.id } as PrismaDelegateArgs,
            select: { id: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);

          const member = await tc.familyMember.create({
            data: {
              patientId: dto.primaryPatientId,
              userId: user.id,
              firstName,
              lastName,
              relation: dto.relation.trim(),
              gender,
              dateOfBirth,
              phone: this.cleanText(dto.phone),
              notes: this.cleanText(dto.notes),
              createdByUserId: actor.userId ?? null,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);

          return { member, dependentPatientId: patient.id };
        },
        {
          userId: actor.userId || 'system',
          clinicId,
          resourceType: 'FAMILY_MEMBER',
          operation: 'CREATE',
          resourceId: dto.primaryPatientId,
          userRole: actor.role || 'system',
          details: { primaryPatientId: dto.primaryPatientId, relation: dto.relation },
        }
      );

    // Self-service: the caps are counted and the row is created under ONE per-patient
    // lock, so parallel requests cannot all see "9 active" and each add a dependent.
    // Staff registrations pass no cap and take no lock.
    const result =
      options.maxActiveDependents !== undefined || options.maxRecentCreations !== undefined
        ? await this.withHouseholdLock(dto.primaryPatientId, async () => {
            await this.assertDependentCapacity(dto.primaryPatientId, options);
            return insertMember();
          })
        : await insertMember();

    await this.eventService.emit('family-member.created', {
      familyMemberId: result.member.id,
      primaryPatientId: dto.primaryPatientId,
      dependentPatientId: result.dependentPatientId,
      clinicId,
    });
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Family member registered',
      'FamilyMembersService',
      { familyMemberId: result.member.id, primaryPatientId: dto.primaryPatientId, clinicId }
    );

    return this.toResponse(result.member, result.dependentPatientId);
  }

  /**
   * ACTIVE dependents of a head-of-family patient. Callers are responsible for
   * authorising `primaryPatientId` (patient self-service derives it from the JWT;
   * staff routes call `assertPatientInClinic` first).
   */
  async listFamilyMembers(primaryPatientId: string): Promise<FamilyMemberResponse[]> {
    return this.databaseService.executeHealthcareRead<FamilyMemberResponse[]>(async client => {
      const tc = client as unknown as FamilyClient;
      const rows = await tc.familyMember.findMany({
        where: {
          patientId: primaryPatientId,
          isActive: true,
          deletedAt: null,
        } as PrismaDelegateArgs,
        orderBy: { createdAt: 'asc' } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
      const patientIdByUserId = await this.resolveDependentPatientIds(tc, rows);
      return rows.map(row =>
        this.toResponse(row, row.userId ? (patientIdByUserId.get(row.userId) ?? null) : null)
      );
    });
  }

  /**
   * Staff routes: 404 unless the head-of-family patient belongs to the request
   * clinic. "Belongs" mirrors the clinic patient list: the user's primary clinic,
   * a clinic membership / role there, or an appointment in the clinic.
   * Not used by the /me routes (a patient is scoped by ownership, and a patient who
   * uses the app against a second clinic must keep working).
   */
  async assertPatientInClinic(patientId: string, clinicId: string): Promise<void> {
    const found = await this.databaseService.executeHealthcareRead<{ id: string } | null>(
      async client => {
        const tc = client as unknown as PrismaTransactionClientWithDelegates;
        const row = await tc.patient.findFirst({
          where: {
            id: patientId,
            OR: [
              { user: { primaryClinicId: clinicId } },
              { user: { clinics: { some: { id: clinicId } } } },
              { user: { userRoles: { some: { clinicId, isActive: true } } } },
              { appointments: { some: { clinicId } } },
            ],
          } as PrismaDelegateArgs,
          select: { id: true } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        return row ? { id: row.id } : null;
      }
    );
    if (!found) {
      throw new NotFoundException(`Patient ${patientId} not found`);
    }
  }

  /** Staff routes: 404 unless the member's head-of-family patient belongs to the clinic. */
  async assertMemberInClinic(id: string, clinicId: string): Promise<void> {
    const row = await this.findActiveRow(id);
    await this.assertPatientInClinic(row.patientId, clinicId).catch((error: unknown) => {
      if (error instanceof NotFoundException) {
        throw new NotFoundException(`Family member ${id} not found`);
      }
      throw error;
    });
  }

  /**
   * Runs `work` while holding a per-household lock (distributed, via the cache
   * provider), released in `finally`. Contenders retry for about two seconds, then get a
   * 409. Fails closed: when the lock cannot be taken the dependent is not created.
   */
  private async withHouseholdLock<T>(primaryPatientId: string, work: () => Promise<T>): Promise<T> {
    const lockKey = `lock:family-members:create:${primaryPatientId}`;
    let acquired = false;
    for (let attempt = 0; attempt < HOUSEHOLD_LOCK_ATTEMPTS && !acquired; attempt += 1) {
      acquired = await this.cacheService.acquireLock(lockKey, HOUSEHOLD_LOCK_TTL_SECONDS);
      if (!acquired) {
        await new Promise<void>(resolve => setTimeout(resolve, HOUSEHOLD_LOCK_RETRY_MS));
      }
    }
    if (!acquired) {
      throw new ConflictException(
        'Another family member is being added to this account. Please try again in a moment.'
      );
    }
    try {
      return await work();
    } finally {
      await this.cacheService.releaseLock(lockKey).catch(() => false);
    }
  }

  /**
   * Both caps are decided on rows read inside the household lock:
   *  - ACTIVE, non-deleted dependents <= `maxActiveDependents` (409)
   *  - dependents CREATED in the last 30 days, soft-deleted ones included, <=
   *    `maxRecentCreations` (429), so create/remove cycling cannot mint unlimited rows.
   */
  private async assertDependentCapacity(
    primaryPatientId: string,
    options: CreateFamilyMemberOptions
  ): Promise<void> {
    const windowStart = new Date(Date.now() - DEPENDENT_CREATION_WINDOW_DAYS * MS_PER_DAY);
    const counts = await this.databaseService.executeHealthcareRead<{
      active: number;
      recentlyCreated: number;
    }>(async client => {
      const tc = client as unknown as FamilyClient;
      const active =
        options.maxActiveDependents === undefined
          ? 0
          : await tc.familyMember.count({
              where: {
                patientId: primaryPatientId,
                isActive: true,
                deletedAt: null,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
      const recentlyCreated =
        options.maxRecentCreations === undefined
          ? 0
          : await tc.familyMember.count({
              // no isActive / deletedAt condition: removed dependents still count
              where: {
                patientId: primaryPatientId,
                createdAt: { gte: windowStart },
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
      return { active, recentlyCreated };
    });

    if (options.maxActiveDependents !== undefined && counts.active >= options.maxActiveDependents) {
      throw new ConflictException(
        `You can add at most ${options.maxActiveDependents} family members. Remove one before adding another.`
      );
    }
    if (
      options.maxRecentCreations !== undefined &&
      counts.recentlyCreated >= options.maxRecentCreations
    ) {
      throw new HttpException(
        `You can add at most ${options.maxRecentCreations} family members every ${DEPENDENT_CREATION_WINDOW_DAYS} days, including ones you removed. Please try again later.`,
        HttpStatus.TOO_MANY_REQUESTS
      );
    }
  }

  async updateFamilyMember(
    id: string,
    dto: UpdateFamilyMemberDto,
    clinicId: string,
    actor: VisitActor
  ): Promise<FamilyMemberResponse> {
    const existing = await this.findActiveRow(id);

    const data: Record<string, unknown> = {};
    if (dto.firstName !== undefined) data['firstName'] = dto.firstName.trim();
    if (dto.lastName !== undefined) data['lastName'] = dto.lastName.trim();
    if (dto.relation !== undefined) data['relation'] = dto.relation.trim();
    if (dto.gender !== undefined)
      data['gender'] = this.cleanText(dto.gender)?.toUpperCase() ?? null;
    if (dto.dateOfBirth !== undefined) {
      data['dateOfBirth'] = dto.dateOfBirth ? new Date(dto.dateOfBirth) : null;
    }
    if (dto.phone !== undefined) data['phone'] = this.cleanText(dto.phone);
    if (dto.notes !== undefined) data['notes'] = this.cleanText(dto.notes);

    const result = await this.databaseService.executeHealthcareWrite<{
      member: FamilyMemberRow;
      dependentPatientId: string | null;
    }>(
      async client => {
        const tc = client as unknown as FamilyClient;
        const member = await tc.familyMember.update({
          where: { id } as PrismaDelegateArgs,
          data: data as PrismaDelegateArgs,
        } as PrismaDelegateArgs);

        // Keep the dependent's own User row in step so the patient list and
        // case-sheet header show the same name/gender/DOB as the family card.
        if (existing.userId) {
          const userData: Record<string, unknown> = {};
          const firstName = (data['firstName'] as string | undefined) ?? existing.firstName;
          const lastName = (data['lastName'] as string | undefined) ?? existing.lastName;
          if (data['firstName'] !== undefined || data['lastName'] !== undefined) {
            userData['firstName'] = firstName;
            userData['lastName'] = lastName;
            userData['name'] = `${firstName} ${lastName}`.trim();
          }
          if (data['gender'] !== undefined) userData['gender'] = data['gender'];
          if (data['dateOfBirth'] !== undefined) userData['dateOfBirth'] = data['dateOfBirth'];
          if (Object.keys(userData).length > 0) {
            await tc.user.update({
              where: { id: existing.userId } as PrismaDelegateArgs,
              data: userData as PrismaDelegateArgs,
            } as PrismaDelegateArgs);
          }
        }

        const patientIdByUserId = await this.resolveDependentPatientIds(tc, [member]);
        return {
          member,
          dependentPatientId: member.userId ? (patientIdByUserId.get(member.userId) ?? null) : null,
        };
      },
      {
        userId: actor.userId || 'system',
        clinicId,
        resourceType: 'FAMILY_MEMBER',
        operation: 'UPDATE',
        resourceId: id,
        userRole: actor.role || 'system',
        details: { updateFields: Object.keys(data) },
      }
    );

    await this.eventService.emit('family-member.updated', { familyMemberId: id, clinicId });
    return this.toResponse(result.member, result.dependentPatientId);
  }

  /**
   * Soft delete: unlinks the dependent from the family card but keeps their
   * Patient/User and all clinical records intact.
   */
  async deleteFamilyMember(id: string, clinicId: string, actor: VisitActor): Promise<void> {
    await this.findActiveRow(id);

    await this.databaseService.executeHealthcareWrite<FamilyMemberRow>(
      async client => {
        const tc = client as unknown as FamilyClient;
        return tc.familyMember.update({
          where: { id } as PrismaDelegateArgs,
          data: { isActive: false, deletedAt: new Date() } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: actor.userId || 'system',
        clinicId,
        resourceType: 'FAMILY_MEMBER',
        operation: 'DELETE',
        resourceId: id,
        userRole: actor.role || 'system',
        details: { softDelete: true },
      }
    );

    await this.eventService.emit('family-member.removed', { familyMemberId: id, clinicId });
  }

  /**
   * Patient self-service: resolve the caller's own Patient.id from their User.id.
   */
  async resolvePatientIdForUser(userId: string): Promise<string> {
    const row = await this.databaseService.executeHealthcareRead<{ id: string } | null>(
      async client => {
        const tc = client as unknown as PrismaTransactionClientWithDelegates;
        const patient = await tc.patient.findFirst({
          where: { userId } as PrismaDelegateArgs,
          select: { id: true } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
        return patient ? { id: (patient as { id: string }).id } : null;
      }
    );
    if (!row) {
      throw new NotFoundException('Patient record not found for this account');
    }
    return row.id;
  }

  /**
   * Patient self-service: 404 unless the family member belongs to the caller
   * (never reveal whether another family's member exists).
   */
  async assertOwnedByPatient(id: string, primaryPatientId: string): Promise<void> {
    const row = await this.findActiveRow(id);
    if (row.patientId !== primaryPatientId) {
      throw new NotFoundException(`Family member ${id} not found`);
    }
  }

  private async findActiveRow(id: string): Promise<FamilyMemberRow> {
    const row = await this.databaseService.executeHealthcareRead<FamilyMemberRow | null>(
      async client => {
        const tc = client as unknown as FamilyClient;
        return tc.familyMember.findFirst({
          where: { id, deletedAt: null } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      }
    );
    if (!row) {
      throw new NotFoundException(`Family member ${id} not found`);
    }
    return row;
  }

  private async resolveDependentPatientIds(
    tc: FamilyClient,
    rows: FamilyMemberRow[]
  ): Promise<Map<string, string>> {
    const userIds = rows
      .map(row => row.userId)
      .filter((userId): userId is string => typeof userId === 'string' && userId.length > 0);
    if (userIds.length === 0) {
      return new Map();
    }
    const patients = (await tc.patient.findMany({
      where: { userId: { in: userIds } } as PrismaDelegateArgs,
      select: { id: true, userId: true } as PrismaDelegateArgs,
    } as PrismaDelegateArgs)) as unknown as Array<{ id: string; userId: string }>;
    return new Map(patients.map(patient => [patient.userId, patient.id]));
  }

  private cleanText(value: string | undefined): string | null {
    if (value === undefined) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private toResponse(
    row: FamilyMemberRow,
    dependentPatientId: string | null
  ): FamilyMemberResponse {
    return {
      id: row.id,
      primaryPatientId: row.patientId,
      dependentPatientId,
      dependentUserId: row.userId ?? null,
      firstName: row.firstName,
      lastName: row.lastName,
      name: `${row.firstName} ${row.lastName}`.trim(),
      relation: row.relation,
      gender: row.gender ?? null,
      dateOfBirth: row.dateOfBirth ? new Date(row.dateOfBirth).toISOString() : null,
      phone: row.phone ?? null,
      notes: row.notes ?? null,
      isActive: row.isActive,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }
}
