import { Injectable, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { StaticAssetService } from '@infrastructure/storage/static-asset.service';
import { LoggingService } from '@infrastructure/logging';
import { EHRService } from '@services/ehr/ehr.service';
import { LogLevel, LogType } from '@core/types';
import type {
  PrismaDelegateArgs,
  PrismaTransactionClientWithDelegates,
} from '@core/types/prisma.types';
import { PaginationMetaDto } from '@dtos/common-response.dto';
import type { CarePlanItemDto, CarePlanStatus, UpsertCarePlanDto } from '@dtos/ehr.dto';
import { nowIso } from '@utils/date-time.util';

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_CARE_PLAN_TITLE = 'Care plan';

interface WorkspacePatientRow {
  id: string;
  userId: string;
  prakriti: string | null;
  dosha: string | null;
  registeredByDoctorId: string | null;
  createdAt: Date;
  user: {
    name: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
    gender: string | null;
    age: number | null;
    dateOfBirth: Date | null;
    bloodGroup: string | null;
    maritalStatus: string | null;
    occupation: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    profilePicture: string | null;
    emergencyContacts: Array<{ name: string; relationship: string; phone: string }>;
  };
}

interface CarePlanRow {
  id: string;
  clinicId: string;
  patientId: string;
  title: string;
  status: string;
  summary: string | null;
  goals: unknown;
  interventions: unknown;
  dietNotes: string | null;
  lifestyleNotes: string | null;
  nextReviewDate: Date | null;
  createdById: string;
  updatedById: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CarePlanResponse {
  exists: boolean;
  id: string | null;
  clinicId: string;
  patientId: string;
  title: string;
  status: CarePlanStatus;
  summary: string;
  goals: CarePlanItemDto[];
  interventions: CarePlanItemDto[];
  dietNotes: string;
  lifestyleNotes: string;
  nextReviewDate: string | null;
  updatedById: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface WorkspaceActor {
  readonly userId: string;
  readonly role?: string | undefined;
}

function toItems(value: unknown): CarePlanItemDto[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') {
      return [];
    }
    const { text, done } = item as { text?: unknown; done?: unknown };
    return typeof text === 'string' && text.length > 0 ? [{ text, done: done === true }] : [];
  });
}

/** Plain `{ text, done }` objects for the JSON column (DTO class instances are not JSON-safe to store). */
function normaliseItems(items: readonly CarePlanItemDto[]): Array<{ text: string; done: boolean }> {
  return items.map(item => ({ text: item.text.trim(), done: item.done === true }));
}

/**
 * EHR workspace reads and the care plan. Every method resolves the patient through
 * `EHRService.resolvePatient(identifier, clinicId)`, which only returns patients of
 * the caller's clinic, so an unknown patient and another clinic's patient are the same
 * 404 and clinic data never leaks across tenants. Role gating is on the controller.
 */
@Injectable()
export class EHRWorkspaceService {
  constructor(
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => StaticAssetService))
    private readonly staticAssetService: StaticAssetService,
    @Inject(forwardRef(() => EHRService))
    private readonly ehrService: EHRService
  ) {}

  private async requirePatient(
    identifier: string,
    clinicId: string
  ): Promise<{ id: string; userId: string }> {
    const patient = await this.ehrService.resolvePatient(identifier, clinicId);
    if (!patient) {
      throw new NotFoundException(`Patient ${identifier} not found`);
    }
    return patient;
  }

  private auditRead(actor: WorkspaceActor, clinicId: string, resource: string, patientId: string) {
    void this.loggingService
      .log(LogType.AUDIT, LogLevel.INFO, `HIPAA Audit: VIEW_${resource}`, 'EHRWorkspaceService', {
        action: `VIEW_${resource}`,
        userId: actor.userId,
        clinicId,
        patientId,
        timestamp: nowIso(),
        compliance: { hipaa: true, phiAccessed: true, auditTrail: true },
      })
      .catch(() => undefined);
  }

  /** One patient of the caller's clinic, for the EHR workspace header. */
  async getWorkspacePatient(identifier: string, clinicId: string, actor: WorkspaceActor) {
    const resolved = await this.requirePatient(identifier, clinicId);
    this.auditRead(actor, clinicId, 'EHR_WORKSPACE_PATIENT', resolved.id);

    const { row, appointmentCount, lastVisit, allergies, activeMedications } =
      await this.databaseService.executeHealthcareRead(async client => {
        const tc = client as unknown as PrismaTransactionClientWithDelegates & {
          appointment: {
            count: (args: PrismaDelegateArgs) => Promise<number>;
            findFirst: (args: PrismaDelegateArgs) => Promise<{ date: Date } | null>;
          };
          allergy: { findMany: (args: PrismaDelegateArgs) => Promise<Array<{ allergen: string }>> };
          medication: { count: (args: PrismaDelegateArgs) => Promise<number> };
        };
        const patientRow = (await tc.patient.findUnique({
          where: { id: resolved.id } as PrismaDelegateArgs,
          select: {
            id: true,
            userId: true,
            prakriti: true,
            dosha: true,
            registeredByDoctorId: true,
            createdAt: true,
            user: {
              select: {
                name: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                gender: true,
                age: true,
                dateOfBirth: true,
                bloodGroup: true,
                maritalStatus: true,
                occupation: true,
                address: true,
                city: true,
                state: true,
                profilePicture: true,
                emergencyContacts: {
                  where: { isActive: true, deletedAt: null },
                  orderBy: { createdAt: 'asc' },
                  take: 1,
                  select: { name: true, relationship: true, phone: true },
                },
              },
            },
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs)) as unknown as WorkspacePatientRow | null;

        const clinicScope = { patientId: resolved.id, clinicId };
        const [count, last, allergyRows, medicationCount] = await Promise.all([
          tc.appointment.count({ where: clinicScope } as PrismaDelegateArgs),
          tc.appointment.findFirst({
            where: { ...clinicScope, status: 'COMPLETED' } as PrismaDelegateArgs,
            orderBy: { date: 'desc' } as PrismaDelegateArgs,
            select: { date: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs),
          tc.allergy.findMany({
            where: { userId: resolved.userId, clinicId } as PrismaDelegateArgs,
            select: { allergen: true } as PrismaDelegateArgs,
            take: 20,
          } as PrismaDelegateArgs),
          tc.medication.count({
            where: { userId: resolved.userId, clinicId, isActive: true } as PrismaDelegateArgs,
          } as PrismaDelegateArgs),
        ]);
        return {
          row: patientRow,
          appointmentCount: count,
          lastVisit: last?.date ?? null,
          allergies: allergyRows.map(a => a.allergen),
          activeMedications: medicationCount,
        };
      });

    if (!row) {
      throw new NotFoundException(`Patient ${identifier} not found`);
    }
    const { user } = row;
    const photo = user.profilePicture
      ? await this.staticAssetService.resolveSignedUrl(user.profilePicture, undefined, {
          boundTo: [row.userId],
        })
      : null;
    return {
      id: row.id,
      userId: row.userId,
      name: user.name,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      phone: user.phone,
      gender: user.gender,
      age: user.age,
      dateOfBirth: user.dateOfBirth ? user.dateOfBirth.toISOString() : null,
      bloodGroup: user.bloodGroup,
      maritalStatus: user.maritalStatus,
      occupation: user.occupation,
      address: user.address,
      city: user.city,
      state: user.state,
      profilePicture: photo,
      emergencyContact: user.emergencyContacts[0] ?? null,
      prakriti: row.prakriti,
      dosha: row.dosha,
      registeredAt: row.createdAt.toISOString(),
      summary: {
        appointmentCount,
        lastVisitDate: lastVisit ? lastVisit.toISOString() : null,
        allergies,
        activeMedications,
      },
    };
  }

  /** A patient's appointments in the caller's clinic, newest first, paginated. */
  async listPatientAppointments(
    identifier: string,
    clinicId: string,
    actor: WorkspaceActor,
    query: { page?: number | undefined; limit?: number | undefined; status?: string | undefined }
  ) {
    const patient = await this.requirePatient(identifier, clinicId);
    this.auditRead(actor, clinicId, 'EHR_PATIENT_APPOINTMENTS', patient.id);
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const where: Record<string, unknown> = { patientId: patient.id, clinicId };
    if (query.status) {
      where['status'] = query.status.toUpperCase();
    }

    const { rows, total } = await this.databaseService.executeHealthcareRead(async client => {
      const tc = client as unknown as PrismaTransactionClientWithDelegates & {
        appointment: {
          findMany: (args: PrismaDelegateArgs) => Promise<Array<Record<string, unknown>>>;
          count: (args: PrismaDelegateArgs) => Promise<number>;
        };
      };
      const [items, count] = await Promise.all([
        tc.appointment.findMany({
          where: where as PrismaDelegateArgs,
          orderBy: [{ date: 'desc' }, { time: 'desc' }, { id: 'asc' }],
          skip: (page - 1) * limit,
          take: limit,
          select: {
            id: true,
            type: true,
            treatmentType: true,
            status: true,
            date: true,
            time: true,
            duration: true,
            notes: true,
            isFollowUp: true,
            checkedInAt: true,
            startedAt: true,
            completedAt: true,
            cancellationReason: true,
            doctor: {
              select: { id: true, specialization: true, user: { select: { name: true } } },
            },
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs),
        tc.appointment.count({ where: where as PrismaDelegateArgs } as PrismaDelegateArgs),
      ]);
      return { rows: items, total: count };
    });

    return {
      data: rows.map(row => {
        const { doctor, ...rest } = row as unknown as {
          doctor?: { id: string; specialization: string; user: { name: string } };
        } & Record<string, unknown>;
        return {
          ...rest,
          doctor: doctor
            ? { id: doctor.id, name: doctor.user.name, specialization: doctor.specialization }
            : null,
        };
      }),
      meta: new PaginationMetaDto(page, limit, total),
    };
  }

  private toCarePlanResponse(row: CarePlanRow): CarePlanResponse {
    return {
      exists: true,
      id: row.id,
      clinicId: row.clinicId,
      patientId: row.patientId,
      title: row.title,
      status: row.status as CarePlanStatus,
      summary: row.summary ?? '',
      goals: toItems(row.goals),
      interventions: toItems(row.interventions),
      dietNotes: row.dietNotes ?? '',
      lifestyleNotes: row.lifestyleNotes ?? '',
      nextReviewDate: row.nextReviewDate ? row.nextReviewDate.toISOString() : null,
      updatedById: row.updatedById,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** The patient's care plan in this clinic, or an empty skeleton (`exists: false`). */
  async getCarePlan(
    identifier: string,
    clinicId: string,
    actor: WorkspaceActor
  ): Promise<CarePlanResponse> {
    const patient = await this.requirePatient(identifier, clinicId);
    this.auditRead(actor, clinicId, 'CARE_PLAN', patient.id);
    const row = await this.databaseService.executeHealthcareRead<CarePlanRow | null>(
      async client => {
        const tc = client as unknown as PrismaTransactionClientWithDelegates & {
          carePlan: { findUnique: (args: PrismaDelegateArgs) => Promise<CarePlanRow | null> };
        };
        return await tc.carePlan.findUnique({
          where: { clinicId_patientId: { clinicId, patientId: patient.id } } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      }
    );
    if (row) {
      return this.toCarePlanResponse(row);
    }
    return {
      exists: false,
      id: null,
      clinicId,
      patientId: patient.id,
      title: DEFAULT_CARE_PLAN_TITLE,
      status: 'ACTIVE',
      summary: '',
      goals: [],
      interventions: [],
      dietNotes: '',
      lifestyleNotes: '',
      nextReviewDate: null,
      updatedById: null,
      createdAt: null,
      updatedAt: null,
    };
  }

  /** Creates or updates the patient's care plan; only supplied fields change on update. */
  async upsertCarePlan(
    identifier: string,
    clinicId: string,
    dto: UpsertCarePlanDto,
    actor: WorkspaceActor
  ): Promise<CarePlanResponse> {
    const patient = await this.requirePatient(identifier, clinicId);

    const fields: Record<string, unknown> = {};
    if (dto.title !== undefined) fields['title'] = dto.title.trim() || DEFAULT_CARE_PLAN_TITLE;
    if (dto.status !== undefined) fields['status'] = dto.status;
    if (dto.summary !== undefined) fields['summary'] = dto.summary.trim() || null;
    if (dto.goals !== undefined) fields['goals'] = normaliseItems(dto.goals);
    if (dto.interventions !== undefined) {
      fields['interventions'] = normaliseItems(dto.interventions);
    }
    if (dto.dietNotes !== undefined) fields['dietNotes'] = dto.dietNotes.trim() || null;
    if (dto.lifestyleNotes !== undefined) {
      fields['lifestyleNotes'] = dto.lifestyleNotes.trim() || null;
    }
    if (dto.nextReviewDate !== undefined) fields['nextReviewDate'] = new Date(dto.nextReviewDate);

    const row = await this.databaseService.executeHealthcareWrite<CarePlanRow>(
      async client => {
        const tc = client as unknown as PrismaTransactionClientWithDelegates & {
          carePlan: { upsert: (args: PrismaDelegateArgs) => Promise<CarePlanRow> };
        };
        return await tc.carePlan.upsert({
          where: { clinicId_patientId: { clinicId, patientId: patient.id } } as PrismaDelegateArgs,
          create: {
            clinicId,
            patientId: patient.id,
            createdById: actor.userId,
            updatedById: actor.userId,
            ...fields,
          } as PrismaDelegateArgs,
          update: { updatedById: actor.userId, ...fields } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: actor.userId,
        clinicId,
        resourceType: 'CARE_PLAN',
        operation: 'UPSERT',
        resourceId: patient.id,
        userRole: actor.role ?? 'system',
        details: { patientId: patient.id, updateFields: Object.keys(fields) },
      }
    );
    return this.toCarePlanResponse(row);
  }
}
