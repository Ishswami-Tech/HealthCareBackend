/**
 * Visit Therapy Service (Therapy / Panchakarma plans and sessions)
 * @module PatientVisits
 * @description A doctor plans a procedure for a visit (N sessions, frequency,
 * assigned therapist); the therapist records each performed session. Backed
 * by `visit_therapy_plans` / `visit_therapy_sessions`.
 */

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events/event.service';
import { LogLevel, LogType } from '@core/types';
import { Role, TreatmentType } from '@core/types/enums.types';
import type {
  PrismaDelegateArgs,
  PrismaTransactionClientWithDelegates,
} from '@core/types/prisma.types';
import type {
  CreateVisitTherapyPlanDto,
  RecordTherapySessionDto,
  TherapistOptionResponse,
  TherapistRef,
  TherapyProgressResponse,
  TherapyProgressVitalsPoint,
  TherapyWorkItemResponse,
  UpdateTherapySessionDto,
  UpdateVisitTherapyPlanDto,
  VisitTherapyPlanResponse,
  VisitTherapySessionResponse,
  VisitTherapyStatus,
} from '@dtos/visit-therapy.dto';
import type { VisitActor } from '@services/patient-visits/patient-visits.service';

interface TherapyPlanRow {
  id: string;
  visitId: string;
  patientId: string;
  clinicId: string;
  procedure: string;
  procedureLabel: string | null;
  plannedSessions: number;
  completedSessions: number;
  frequency: string | null;
  startDate: Date;
  endDate: Date | null;
  therapistUserId: string | null;
  medicinesUsed: string | null;
  notes: string | null;
  status: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface TherapySessionRow {
  id: string;
  planId: string;
  visitId: string;
  clinicId: string;
  sessionNumber: number;
  sessionDate: Date;
  durationMinutes: number | null;
  observations: string | null;
  patientResponse: string | null;
  painScore: number | null;
  status: string;
  performedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface VisitRefRow {
  id: string;
  opdNumber: string;
  patientId: string;
  registrationDate: Date;
}

interface VitalsPointRow {
  visitId: string;
  painScore: number | null;
  weightKg: number | null;
  bmi: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
}

interface UserNameRow {
  id: string;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
}

interface PatientNameRow {
  id: string;
  user: Omit<UserNameRow, 'id'> | null;
}

interface AllocatedSessionRow {
  completedSessions: number | string;
  visitId: string;
}

type TherapyClient = PrismaTransactionClientWithDelegates & {
  patientVisit: {
    findFirst: (args: PrismaDelegateArgs) => Promise<VisitRefRow | null>;
    findMany: (args: PrismaDelegateArgs) => Promise<VisitRefRow[]>;
  };
  visitTherapyPlan: {
    create: (args: PrismaDelegateArgs) => Promise<TherapyPlanRow>;
    findFirst: (args: PrismaDelegateArgs) => Promise<TherapyPlanRow | null>;
    findMany: (args: PrismaDelegateArgs) => Promise<TherapyPlanRow[]>;
    update: (args: PrismaDelegateArgs) => Promise<TherapyPlanRow>;
  };
  visitTherapySession: {
    create: (args: PrismaDelegateArgs) => Promise<TherapySessionRow>;
    findFirst: (args: PrismaDelegateArgs) => Promise<TherapySessionRow | null>;
    findMany: (args: PrismaDelegateArgs) => Promise<TherapySessionRow[]>;
    update: (args: PrismaDelegateArgs) => Promise<TherapySessionRow>;
  };
  visitVitalsExamination: {
    findMany: (args: PrismaDelegateArgs) => Promise<VitalsPointRow[]>;
  };
};

const CLOSED_STATUSES: readonly string[] = ['COMPLETED', 'CANCELLED'];
const OPEN_STATUSES: readonly string[] = ['SCHEDULED', 'IN_PROGRESS'];
const SOURCE = 'VisitTherapyService';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class VisitTherapyService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService
  ) {}

  async listPlansForVisit(visitId: string, clinicId: string): Promise<VisitTherapyPlanResponse[]> {
    const visit = await this.assertVisitInClinic(visitId, clinicId);

    return this.databaseService.executeHealthcareRead<VisitTherapyPlanResponse[]>(async client => {
      const tc = client as unknown as TherapyClient;
      const plans = await tc.visitTherapyPlan.findMany({
        where: { visitId, clinicId } as PrismaDelegateArgs,
        orderBy: { createdAt: 'asc' } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
      const sessions = await this.loadSessions(tc, plans);
      const therapists = await this.resolveTherapists(tc, plans);
      return plans.map(plan =>
        this.toPlanResponse(plan, sessions, therapists, new Map([[visit.id, visit.opdNumber]]))
      );
    });
  }

  async createPlan(
    visitId: string,
    clinicId: string,
    dto: CreateVisitTherapyPlanDto,
    actor: VisitActor
  ): Promise<VisitTherapyPlanResponse> {
    const visit = await this.assertVisitInClinic(visitId, clinicId);

    const startDate = this.parseDate(dto.startDate, 'startDate');
    const endDate = dto.endDate ? this.parseDate(dto.endDate, 'endDate') : null;
    this.assertDateOrder(startDate, endDate);

    const therapistUserId = this.cleanText(dto.therapistUserId);
    const therapist = therapistUserId
      ? await this.assertTherapistInClinic(therapistUserId, clinicId)
      : null;

    const row = await this.databaseService.executeHealthcareWrite<TherapyPlanRow>(
      async client => {
        const tc = client as unknown as TherapyClient;
        return tc.visitTherapyPlan.create({
          data: {
            visitId,
            patientId: visit.patientId,
            clinicId,
            procedure: dto.procedure,
            procedureLabel: this.cleanText(dto.procedureLabel),
            plannedSessions: dto.plannedSessions,
            completedSessions: 0,
            frequency: this.cleanText(dto.frequency),
            startDate,
            endDate,
            therapistUserId,
            medicinesUsed: this.cleanText(dto.medicinesUsed),
            notes: this.cleanText(dto.notes),
            status: 'SCHEDULED',
            createdBy: actor.userId ?? null,
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: actor.userId || 'system',
        clinicId,
        resourceType: 'VISIT_THERAPY_PLAN',
        operation: 'CREATE',
        resourceId: visitId,
        userRole: actor.role || 'system',
        details: { visitId, procedure: dto.procedure, plannedSessions: dto.plannedSessions },
      }
    );

    await this.eventService.emit('patient-visit.therapy-plan.created', {
      planId: row.id,
      visitId,
      patientId: visit.patientId,
      clinicId,
      therapistUserId,
      procedure: dto.procedure,
    });
    await this.loggingService.log(LogType.SYSTEM, LogLevel.INFO, 'Therapy plan created', SOURCE, {
      planId: row.id,
      visitId,
      clinicId,
      procedure: dto.procedure,
    });

    const therapists = new Map<string, TherapistRef>(
      therapist ? [[therapist.userId, therapist]] : []
    );
    return this.toPlanResponse(
      row,
      new Map<string, TherapySessionRow[]>(),
      therapists,
      new Map<string, string>([[visit.id, visit.opdNumber]])
    );
  }

  async updatePlan(
    planId: string,
    clinicId: string,
    dto: UpdateVisitTherapyPlanDto,
    actor: VisitActor
  ): Promise<VisitTherapyPlanResponse> {
    const plan = await this.findPlanRow(planId, clinicId);
    const data = await this.buildPlanUpdate(plan, dto, clinicId);

    if (Object.keys(data).length > 0) {
      await this.databaseService.executeHealthcareWrite<TherapyPlanRow>(
        async client => {
          const tc = client as unknown as TherapyClient;
          return tc.visitTherapyPlan.update({
            where: { id: planId } as PrismaDelegateArgs,
            data: data as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
        },
        {
          userId: actor.userId || 'system',
          clinicId,
          resourceType: 'VISIT_THERAPY_PLAN',
          operation: 'UPDATE',
          resourceId: planId,
          userRole: actor.role || 'system',
          details: { updateFields: Object.keys(data) },
        }
      );

      await this.eventService.emit('patient-visit.therapy-plan.updated', {
        planId,
        visitId: plan.visitId,
        clinicId,
        updateFields: Object.keys(data),
      });
    }

    return this.getPlanResponse(planId, clinicId);
  }

  /**
   * Records one performed session. The session number is allocated by a
   * single atomic UPDATE on the plan row (executeHealthcareWrite is not a
   * transaction, so a read-then-insert would race); the unique
   * (planId, sessionNumber) constraint is the backstop.
   */
  async recordSession(
    planId: string,
    clinicId: string,
    dto: RecordTherapySessionDto,
    actor: VisitActor
  ): Promise<VisitTherapyPlanResponse> {
    const plan = await this.findPlanRow(planId, clinicId);
    this.assertPlanOpen(plan);
    const sessionDate = dto.sessionDate
      ? this.parseDate(dto.sessionDate, 'sessionDate')
      : new Date();

    const session = await this.databaseService.executeHealthcareWrite<TherapySessionRow>(
      async client => {
        const tc = client as unknown as TherapyClient;
        const allocated = await tc.$queryRaw<AllocatedSessionRow[]>`
          UPDATE "visit_therapy_plans"
          SET "completedSessions" = "completedSessions" + 1,
              "status" = CASE
                WHEN "completedSessions" + 1 >= "plannedSessions" THEN 'COMPLETED'::"TherapyStatus"
                ELSE 'IN_PROGRESS'::"TherapyStatus"
              END,
              "updatedAt" = NOW()
          WHERE "id" = ${planId}
            AND "clinicId" = ${clinicId}
            AND "status" NOT IN ('CANCELLED'::"TherapyStatus", 'COMPLETED'::"TherapyStatus")
          RETURNING "completedSessions", "visitId"
        `;
        const slot = allocated[0];
        const sessionNumber = Number(slot?.completedSessions ?? 0);
        if (!slot || !Number.isFinite(sessionNumber) || sessionNumber <= 0) {
          throw new BadRequestException(
            'This therapy plan is already completed or cancelled; no further sessions can be recorded'
          );
        }

        return tc.visitTherapySession.create({
          data: {
            planId,
            visitId: slot.visitId,
            clinicId,
            sessionNumber,
            sessionDate,
            durationMinutes: dto.durationMinutes ?? null,
            observations: this.cleanText(dto.observations),
            patientResponse: this.cleanText(dto.patientResponse),
            painScore: dto.painScore ?? null,
            status: 'COMPLETED',
            performedBy: actor.userId ?? null,
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: actor.userId || 'system',
        clinicId,
        resourceType: 'VISIT_THERAPY_SESSION',
        operation: 'CREATE',
        resourceId: planId,
        userRole: actor.role || 'system',
        details: { planId, visitId: plan.visitId },
      }
    );

    await this.eventService.emit('patient-visit.therapy-session.recorded', {
      sessionId: session.id,
      planId,
      visitId: plan.visitId,
      patientId: plan.patientId,
      clinicId,
      sessionNumber: session.sessionNumber,
      performedBy: actor.userId ?? null,
    });
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Therapy session recorded',
      SOURCE,
      {
        sessionId: session.id,
        planId,
        sessionNumber: session.sessionNumber,
        clinicId,
      }
    );

    return this.getPlanResponse(planId, clinicId);
  }

  async updateSession(
    sessionId: string,
    clinicId: string,
    dto: UpdateTherapySessionDto,
    actor: VisitActor
  ): Promise<VisitTherapySessionResponse> {
    const existing = await this.findSessionRow(sessionId, clinicId);

    const data: Record<string, unknown> = {};
    if (dto.sessionDate !== undefined) {
      data['sessionDate'] = this.parseDate(dto.sessionDate, 'sessionDate');
    }
    if (dto.durationMinutes !== undefined) data['durationMinutes'] = dto.durationMinutes;
    if (dto.observations !== undefined) data['observations'] = this.cleanText(dto.observations);
    if (dto.patientResponse !== undefined) {
      data['patientResponse'] = this.cleanText(dto.patientResponse);
    }
    if (dto.painScore !== undefined) data['painScore'] = dto.painScore;
    if (dto.status !== undefined) data['status'] = dto.status;

    if (Object.keys(data).length === 0) {
      return this.toSessionResponse(existing);
    }

    const row = await this.databaseService.executeHealthcareWrite<TherapySessionRow>(
      async client => {
        const tc = client as unknown as TherapyClient;
        return tc.visitTherapySession.update({
          where: { id: sessionId } as PrismaDelegateArgs,
          data: data as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      },
      {
        userId: actor.userId || 'system',
        clinicId,
        resourceType: 'VISIT_THERAPY_SESSION',
        operation: 'UPDATE',
        resourceId: sessionId,
        userRole: actor.role || 'system',
        details: { planId: existing.planId, updateFields: Object.keys(data) },
      }
    );

    await this.eventService.emit('patient-visit.therapy-session.updated', {
      sessionId,
      planId: existing.planId,
      clinicId,
      updateFields: Object.keys(data),
    });

    return this.toSessionResponse(row);
  }

  /**
   * Everything the Progress tab needs: every plan across the patient's visits
   * (newest first) plus a per-visit vitals series for trend charts.
   */
  async getPatientProgress(patientId: string, clinicId: string): Promise<TherapyProgressResponse> {
    return this.databaseService.executeHealthcareRead<TherapyProgressResponse>(async client => {
      const tc = client as unknown as TherapyClient;

      const visits = await tc.patientVisit.findMany({
        where: { patientId, clinicId } as PrismaDelegateArgs,
        orderBy: { registrationDate: 'asc' } as PrismaDelegateArgs,
        select: {
          id: true,
          opdNumber: true,
          patientId: true,
          registrationDate: true,
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
      const plans = await tc.visitTherapyPlan.findMany({
        where: { patientId, clinicId } as PrismaDelegateArgs,
        orderBy: { createdAt: 'desc' } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
      const sessions = await this.loadSessions(tc, plans);
      const therapists = await this.resolveTherapists(tc, plans);
      const opdNumbers = new Map(visits.map(visit => [visit.id, visit.opdNumber]));

      const visitIds = visits.map(visit => visit.id);
      const vitals =
        visitIds.length > 0
          ? await tc.visitVitalsExamination.findMany({
              where: { visitId: { in: visitIds } } as PrismaDelegateArgs,
              select: {
                visitId: true,
                painScore: true,
                weightKg: true,
                bmi: true,
                bpSystolic: true,
                bpDiastolic: true,
              } as PrismaDelegateArgs,
            } as PrismaDelegateArgs)
          : [];
      const vitalsByVisit = new Map(vitals.map(row => [row.visitId, row]));

      const activePlans = plans.filter(plan => plan.status !== 'CANCELLED');
      const totals = {
        planned: activePlans.reduce((sum, plan) => sum + plan.plannedSessions, 0),
        completed: activePlans.reduce((sum, plan) => sum + plan.completedSessions, 0),
      };

      const vitalsSeries: TherapyProgressVitalsPoint[] = visits.map(visit => {
        const point = vitalsByVisit.get(visit.id);
        return {
          visitId: visit.id,
          opdNumber: visit.opdNumber,
          date: new Date(visit.registrationDate).toISOString(),
          painScore: point?.painScore ?? null,
          weightKg: point?.weightKg ?? null,
          bmi: point?.bmi ?? null,
          bpSystolic: point?.bpSystolic ?? null,
          bpDiastolic: point?.bpDiastolic ?? null,
        };
      });

      return {
        plans: plans.map(plan => this.toPlanResponse(plan, sessions, therapists, opdNumbers)),
        totals,
        vitalsSeries,
      };
    });
  }

  /**
   * The therapist's work list: open plans assigned to them, optionally only
   * those active on `date` (startDate <= date and endDate unset or >= date).
   */
  async listMySessions(
    therapistUserId: string,
    clinicId: string,
    date?: string
  ): Promise<TherapyWorkItemResponse[]> {
    const where: PrismaDelegateArgs = {
      therapistUserId,
      clinicId,
      status: { in: [...OPEN_STATUSES] },
      ...this.buildDayFilter(date),
    };

    return this.databaseService.executeHealthcareRead<TherapyWorkItemResponse[]>(async client => {
      const tc = client as unknown as TherapyClient;
      const plans = await tc.visitTherapyPlan.findMany({
        where,
        orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }] as unknown as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
      if (plans.length === 0) return [];

      const sessions = await this.loadSessions(tc, plans);
      const therapists = await this.resolveTherapists(tc, plans);

      const visitIds = [...new Set(plans.map(plan => plan.visitId))];
      const visits = await tc.patientVisit.findMany({
        where: { id: { in: visitIds } } as PrismaDelegateArgs,
        select: {
          id: true,
          opdNumber: true,
          patientId: true,
          registrationDate: true,
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs);
      const opdNumbers = new Map(visits.map(visit => [visit.id, visit.opdNumber]));

      const patientIds = [...new Set(plans.map(plan => plan.patientId))];
      const patients = (await tc.patient.findMany({
        where: { id: { in: patientIds } } as PrismaDelegateArgs,
        select: {
          id: true,
          user: { select: { name: true, firstName: true, lastName: true, phone: true } },
        } as PrismaDelegateArgs,
      } as PrismaDelegateArgs)) as unknown as PatientNameRow[];
      const patientsById = new Map(patients.map(patient => [patient.id, patient]));

      return plans.map(plan => {
        const patient = patientsById.get(plan.patientId);
        return {
          ...this.toPlanResponse(plan, sessions, therapists, opdNumbers),
          patientName: patient?.user ? this.displayName(patient.user) : null,
          patientPhone: patient?.user?.phone ?? null,
        };
      });
    });
  }

  /** Therapists attached to the clinic, for the assignment picker. */
  async listTherapists(clinicId: string): Promise<TherapistOptionResponse[]> {
    return this.databaseService.executeHealthcareRead<TherapistOptionResponse[]>(async client => {
      const tc = client as unknown as TherapyClient;
      const users = (await tc.user.findMany({
        where: this.therapistScope(clinicId),
        select: { id: true, name: true, firstName: true, lastName: true, phone: true },
        orderBy: { name: 'asc' },
      } as PrismaDelegateArgs)) as unknown as UserNameRow[];
      return users.map(user => ({
        userId: user.id,
        name: this.displayName(user),
        phone: user.phone ?? null,
      }));
    });
  }

  private async getPlanResponse(
    planId: string,
    clinicId: string
  ): Promise<VisitTherapyPlanResponse> {
    const response =
      await this.databaseService.executeHealthcareRead<VisitTherapyPlanResponse | null>(
        async client => {
          const tc = client as unknown as TherapyClient;
          const plan = await tc.visitTherapyPlan.findFirst({
            where: { id: planId, clinicId } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
          if (!plan) return null;
          const visit = await tc.patientVisit.findFirst({
            where: { id: plan.visitId } as PrismaDelegateArgs,
            select: {
              id: true,
              opdNumber: true,
              patientId: true,
              registrationDate: true,
            } as PrismaDelegateArgs,
          } as PrismaDelegateArgs);
          const sessions = await this.loadSessions(tc, [plan]);
          const therapists = await this.resolveTherapists(tc, [plan]);
          const opdNumbers = new Map<string, string>(visit ? [[visit.id, visit.opdNumber]] : []);
          return this.toPlanResponse(plan, sessions, therapists, opdNumbers);
        }
      );
    if (!response) {
      throw new NotFoundException(`Therapy plan ${planId} not found`);
    }
    return response;
  }

  private async buildPlanUpdate(
    plan: TherapyPlanRow,
    dto: UpdateVisitTherapyPlanDto,
    clinicId: string
  ): Promise<Record<string, unknown>> {
    const data: Record<string, unknown> = {};

    if (dto.procedure !== undefined) data['procedure'] = dto.procedure;
    if (dto.procedureLabel !== undefined)
      data['procedureLabel'] = this.cleanText(dto.procedureLabel);
    if (dto.frequency !== undefined) data['frequency'] = this.cleanText(dto.frequency);
    if (dto.medicinesUsed !== undefined) data['medicinesUsed'] = this.cleanText(dto.medicinesUsed);
    if (dto.notes !== undefined) data['notes'] = this.cleanText(dto.notes);

    if (dto.plannedSessions !== undefined) {
      if (dto.plannedSessions < plan.completedSessions) {
        throw new BadRequestException(
          `Planned sessions cannot be fewer than the ${plan.completedSessions} already completed`
        );
      }
      data['plannedSessions'] = dto.plannedSessions;
    }

    const startDate =
      dto.startDate !== undefined ? this.parseDate(dto.startDate, 'startDate') : plan.startDate;
    if (dto.startDate !== undefined) data['startDate'] = startDate;

    let endDate: Date | null = plan.endDate;
    if (dto.endDate !== undefined) {
      const cleaned = this.cleanText(dto.endDate);
      endDate = cleaned ? this.parseDate(cleaned, 'endDate') : null;
      data['endDate'] = endDate;
    }
    this.assertDateOrder(startDate, endDate);

    if (dto.therapistUserId !== undefined) {
      const therapistUserId = this.cleanText(dto.therapistUserId);
      if (therapistUserId) await this.assertTherapistInClinic(therapistUserId, clinicId);
      data['therapistUserId'] = therapistUserId;
    }

    if (dto.status !== undefined) {
      data['status'] = dto.status;
    } else if (
      dto.plannedSessions !== undefined &&
      plan.completedSessions >= dto.plannedSessions &&
      OPEN_STATUSES.includes(plan.status)
    ) {
      // Shrinking the plan down to what has already been done finishes it,
      // mirroring what recordSession would have decided.
      data['status'] = 'COMPLETED';
    }

    return data;
  }

  private buildDayFilter(date: string | undefined): PrismaDelegateArgs {
    if (!date) return {};
    const dayStart = this.parseDate(date, 'date');
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart.getTime() + ONE_DAY_MS - 1);
    return {
      startDate: { lte: dayEnd },
      OR: [{ endDate: null }, { endDate: { gte: dayStart } }],
    };
  }

  private async loadSessions(
    tc: TherapyClient,
    plans: TherapyPlanRow[]
  ): Promise<Map<string, TherapySessionRow[]>> {
    const byPlan = new Map<string, TherapySessionRow[]>();
    if (plans.length === 0) return byPlan;
    const rows = await tc.visitTherapySession.findMany({
      where: { planId: { in: plans.map(plan => plan.id) } } as PrismaDelegateArgs,
      orderBy: { sessionNumber: 'asc' } as PrismaDelegateArgs,
    } as PrismaDelegateArgs);
    for (const row of rows) {
      const list = byPlan.get(row.planId);
      if (list) {
        list.push(row);
      } else {
        byPlan.set(row.planId, [row]);
      }
    }
    return byPlan;
  }

  private async resolveTherapists(
    tc: TherapyClient,
    plans: TherapyPlanRow[]
  ): Promise<Map<string, TherapistRef>> {
    const userIds = [
      ...new Set(
        plans
          .map(plan => plan.therapistUserId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      ),
    ];
    if (userIds.length === 0) return new Map();
    const users = (await tc.user.findMany({
      where: { id: { in: userIds } } as PrismaDelegateArgs,
      select: { id: true, name: true, firstName: true, lastName: true, phone: true },
    } as PrismaDelegateArgs)) as unknown as UserNameRow[];
    return new Map(users.map(user => [user.id, { userId: user.id, name: this.displayName(user) }]));
  }

  private async assertTherapistInClinic(userId: string, clinicId: string): Promise<TherapistRef> {
    const user = await this.databaseService.executeHealthcareRead<UserNameRow | null>(
      async client => {
        const tc = client as unknown as TherapyClient;
        return (await tc.user.findFirst({
          where: { AND: [{ id: userId }, this.therapistScope(clinicId)] },
          select: { id: true, name: true, firstName: true, lastName: true, phone: true },
        } as PrismaDelegateArgs)) as unknown as UserNameRow | null;
      }
    );
    if (!user) {
      throw new BadRequestException('Selected therapist is not available in this clinic');
    }
    return { userId: user.id, name: this.displayName(user) };
  }

  private therapistScope(clinicId: string): PrismaDelegateArgs {
    return {
      role: Role.THERAPIST,
      isActive: true,
      deletedAt: null,
      OR: [
        { primaryClinicId: clinicId },
        { clinics: { some: { id: clinicId } } },
        { userRoles: { some: { clinicId, isActive: true } } },
        { therapist: { clinicId } },
      ],
    };
  }

  private async assertVisitInClinic(visitId: string, clinicId: string): Promise<VisitRefRow> {
    const visit = await this.databaseService.executeHealthcareRead<VisitRefRow | null>(
      async client => {
        const tc = client as unknown as TherapyClient;
        return tc.patientVisit.findFirst({
          where: { id: visitId, clinicId } as PrismaDelegateArgs,
          select: {
            id: true,
            opdNumber: true,
            patientId: true,
            registrationDate: true,
          } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      }
    );
    if (!visit) {
      throw new NotFoundException(`Visit ${visitId} not found`);
    }
    return visit;
  }

  private async findPlanRow(planId: string, clinicId: string): Promise<TherapyPlanRow> {
    const row = await this.databaseService.executeHealthcareRead<TherapyPlanRow | null>(
      async client => {
        const tc = client as unknown as TherapyClient;
        return tc.visitTherapyPlan.findFirst({
          where: { id: planId, clinicId } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      }
    );
    if (!row) {
      throw new NotFoundException(`Therapy plan ${planId} not found`);
    }
    return row;
  }

  private async findSessionRow(sessionId: string, clinicId: string): Promise<TherapySessionRow> {
    const row = await this.databaseService.executeHealthcareRead<TherapySessionRow | null>(
      async client => {
        const tc = client as unknown as TherapyClient;
        return tc.visitTherapySession.findFirst({
          where: { id: sessionId, clinicId } as PrismaDelegateArgs,
        } as PrismaDelegateArgs);
      }
    );
    if (!row) {
      throw new NotFoundException(`Therapy session ${sessionId} not found`);
    }
    return row;
  }

  private assertPlanOpen(plan: TherapyPlanRow): void {
    if (CLOSED_STATUSES.includes(plan.status)) {
      throw new BadRequestException(
        `This therapy plan is ${plan.status.toLowerCase().replace('_', ' ')}; no further sessions can be recorded`
      );
    }
  }

  private assertDateOrder(startDate: Date, endDate: Date | null): void {
    if (endDate && endDate.getTime() < startDate.getTime()) {
      throw new BadRequestException('endDate cannot be before startDate');
    }
  }

  private parseDate(value: string, field: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} is not a valid date`);
    }
    return parsed;
  }

  private cleanText(value: string | undefined): string | null {
    if (value === undefined) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private displayName(user: Omit<UserNameRow, 'id'>): string {
    const name = user.name?.trim();
    if (name) return name;
    const parts = [user.firstName, user.lastName]
      .map(part => part?.trim() ?? '')
      .filter(part => part.length > 0);
    return parts.length > 0 ? parts.join(' ') : 'Unnamed';
  }

  private toSessionResponse(row: TherapySessionRow): VisitTherapySessionResponse {
    return {
      id: row.id,
      planId: row.planId,
      visitId: row.visitId,
      clinicId: row.clinicId,
      sessionNumber: row.sessionNumber,
      sessionDate: new Date(row.sessionDate).toISOString(),
      durationMinutes: row.durationMinutes ?? null,
      observations: row.observations ?? null,
      patientResponse: row.patientResponse ?? null,
      painScore: row.painScore ?? null,
      status: row.status as VisitTherapyStatus,
      performedBy: row.performedBy ?? null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }

  private toPlanResponse(
    row: TherapyPlanRow,
    sessions: Map<string, TherapySessionRow[]>,
    therapists: Map<string, TherapistRef>,
    opdNumbers: Map<string, string>
  ): VisitTherapyPlanResponse {
    return {
      id: row.id,
      visitId: row.visitId,
      opdNumber: opdNumbers.get(row.visitId) ?? null,
      patientId: row.patientId,
      clinicId: row.clinicId,
      procedure: row.procedure as TreatmentType,
      procedureLabel: row.procedureLabel ?? null,
      plannedSessions: row.plannedSessions,
      completedSessions: row.completedSessions,
      frequency: row.frequency ?? null,
      startDate: new Date(row.startDate).toISOString(),
      endDate: row.endDate ? new Date(row.endDate).toISOString() : null,
      therapistUserId: row.therapistUserId ?? null,
      therapist: row.therapistUserId ? (therapists.get(row.therapistUserId) ?? null) : null,
      medicinesUsed: row.medicinesUsed ?? null,
      notes: row.notes ?? null,
      status: row.status as VisitTherapyStatus,
      createdBy: row.createdBy ?? null,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      sessions: (sessions.get(row.id) ?? []).map(session => this.toSessionResponse(session)),
    };
  }
}
