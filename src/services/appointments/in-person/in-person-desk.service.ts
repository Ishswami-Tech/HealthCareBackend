/**
 * Front-desk writes of the in-person flow (V2) that are not a check-in themselves:
 *   - walk-in: book an in-person visit into the doctor's next free slot of today at the desk's
 *     location (the clinic's one doctor, clinic in-person visit length) and check it in through the shared InPersonCheckInService (same service as the QR);
 *   - undo no-show: put a visit marked NO_SHOW by mistake back where it was (CONFIRMED and in the
 *     location's live queue again when the patient had checked in, SCHEDULED otherwise).
 * Both are idempotent. Appointment creation reuses AppointmentsService.createAppointment (RBAC,
 * slot rules, events, cache invalidation), never a second create path.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events/event.service';
import { LogLevel, LogType } from '@core/types';
import { AppointmentType, Role } from '@core/types/enums.types';
import type { CreateAppointmentDto } from '@dtos/appointment.dto';
import { endOfIstDay, startOfIstDay } from '@utils/clock.util';
import {
  formatDateInIST,
  formatDateKeyInIST,
  getClockPartsInIST,
  nowIso,
} from '@utils/date-time.util';
import { isBookableDay } from '@utils/clinic-working-days.util';
import {
  PLAN_WAIVER_METADATA_KEY,
  type PlanWaiver,
  type WalkInPlanSettings,
  WALK_IN_PLAN_REQUIRED_MESSAGE,
  planWaiverOf,
  planWaiverOutcomeLabel,
  resolveWalkInPlanSettings,
  walkInInvoiceDescription,
} from '@utils/walk-in-plan-policy.util';
import { BillingService } from '@services/billing/billing.service';
import type { CreateInvoiceDto } from '@dtos/billing.dto';
import { AppointmentsService } from '../appointments.service';
import { httpErrorForFailedResult } from '../core/appointment-result-http.util';
import { CheckInLocationService } from '../plugins/therapy/check-in-location.service';
import { InPersonCheckInService, MANUAL_CHECK_IN_ROLES } from './in-person-check-in.service';
import { InPersonVisitService } from './in-person-visit.service';
import { resolveRestoredStatus, wasNoShowUndone, withNoShowUndo } from './no-show-undo.util';
import {
  type NextAvailableSlot,
  findNextAvailableSlot,
  noSlotTodayMessage,
} from './next-available-slot.util';
import type { PlanlessVisitRef } from '../core/check-in-plan.util';
import type { InPersonWalkInDto } from './in-person.dto';
import type {
  InPersonActor,
  InPersonUndoNoShowResult,
  InPersonWalkInResult,
} from './in-person.types';

/** Who may undo a no-show: the same roles that may mark one. */
export const UNDO_NO_SHOW_ROLES: ReadonlySet<string> = new Set([
  ...MANUAL_CHECK_IN_ROLES,
  Role.DOCTOR,
  Role.ASSISTANT_DOCTOR,
  Role.NURSE,
]);

/** Statuses of a visit that is still open today (a second walk-in reuses it). */
const OPEN_VISIT_STATUSES = ['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'PENDING'];
/** Free slots tried in order when a concurrent booking takes the first one. */
const WALK_IN_SLOT_ATTEMPTS = 5;
/** Random pause before the next slot after a collision, so colliding desks spread out. */
const WALK_IN_RETRY_JITTER_MS = { min: 15, max: 60 } as const;
/**
 * Booking refusals that mean "another request holds or just took this slot": the walk-in moves
 * on to the next free slot instead of failing (3 desks picking the same earliest slot).
 */
const RETRYABLE_SLOT_ERRORS: ReadonlySet<string> = new Set([
  'SCHEDULING_CONFLICT',
  'APPOINTMENT_CONFLICT',
]);
export const WALK_IN_NO_SLOT_MESSAGE =
  'No free in-person slot is left today for the doctor. Book the patient for another day.';
/** Error code of the "today is full" 409; its payload carries `nextAvailable` (or null). */
export const WALK_IN_NO_SLOT_CODE = 'WALK_IN_NO_SLOT_TODAY';
export const WALK_IN_SLOTS_BUSY_MESSAGE =
  'The next free slots were just taken at another desk. Please try the walk-in again.';
/**
 * Clinic rule REQUIRE_PLAN (the default): a walk-in needs an active plan. The other rules
 * (ALLOW_WITH_DESK_FEE / ALLOW_FREE) live in clinic settings: walk-in-plan-policy.util.
 */
export { WALK_IN_PLAN_REQUIRED_MESSAGE };
export const WALK_IN_DESK_FEE_MISSING_MESSAGE =
  'Set the walk-in desk fee (or the OPD consultation fee) in clinic settings before charging plan-less walk-ins.';

interface DeskClient {
  patient: {
    findFirst: (args: unknown) => Promise<{ id: string; userId: string } | null>;
  };
  clinic: {
    findUnique: (args: unknown) => Promise<{ settings?: unknown } | null>;
  };
  clinicLocation: {
    findFirst: (args: unknown) => Promise<{ id: string; workingHours?: unknown } | null>;
    findMany: (args: unknown) => Promise<Array<{ id: string }>>;
  };
  appointment: {
    findFirst: (args: unknown) => Promise<{
      id: string;
      subscriptionId?: string | null;
      metadata?: unknown;
    } | null>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
  doctorClinic: {
    findFirst: (args: unknown) => Promise<{ doctorId: string } | null>;
  };
  invoice: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
  };
}

/** A slot collision (409) from the booking guard, thrown or answered as a failed result. */
export function isRetryableSlotFailure(failure: unknown): boolean {
  if (failure instanceof HttpException) return failure.getStatus() === 409;
  const code = (failure as { error?: unknown } | null)?.error;
  return typeof code === 'string' && RETRYABLE_SLOT_ERRORS.has(code);
}

function retryJitter(): Promise<void> {
  const { min, max } = WALK_IN_RETRY_JITTER_MS;
  const delay = min + Math.floor(Math.random() * (max - min + 1));
  return new Promise(resolve => setTimeout(resolve, delay));
}

function upper(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** Minutes since midnight in IST (slot times are IST wall-clock). */
function istMinutesOfDay(now: Date): number {
  const clock = getClockPartsInIST(now);
  return clock ? clock.hour * 60 + clock.minute : 0;
}

@Injectable()
export class InPersonDeskService implements OnModuleInit {
  constructor(
    @Inject(forwardRef(() => DatabaseService))
    private readonly database: DatabaseService,
    @Inject(forwardRef(() => AppointmentsService))
    private readonly appointments: AppointmentsService,
    @Inject(forwardRef(() => InPersonCheckInService))
    private readonly checkIns: InPersonCheckInService,
    @Inject(forwardRef(() => InPersonVisitService))
    private readonly visits: InPersonVisitService,
    @Inject(forwardRef(() => CheckInLocationService))
    private readonly checkInLocations: CheckInLocationService,
    @Inject(forwardRef(() => CacheService))
    private readonly cache: CacheService,
    @Inject(forwardRef(() => EventService))
    private readonly events: EventService,
    @Inject(forwardRef(() => LoggingService))
    private readonly logging: LoggingService,
    @Inject(forwardRef(() => BillingService))
    private readonly billing: BillingService
  ) {}

  /**
   * H1 safety net: the shared check-in links the patient's active plan to a visit booked without
   * it, through the booking service's own lookup + link (wired here, where both are injected).
   */
  onModuleInit(): void {
    this.checkInLocations.registerPlanLinker({
      findActivePlan: (patientId, clinicId) =>
        this.appointments.findActiveInPersonPlan(patientId, clinicId),
      linkPlan: (plan, appointmentId, clinicId) =>
        this.appointments.linkInPersonPlan(plan, appointmentId, clinicId),
      allowWithoutPlan: visit => this.allowWithoutPlan(visit),
    });
  }

  private read<T>(operation: (client: DeskClient) => Promise<T>): Promise<T> {
    return this.database.executeHealthcareRead<T>(client =>
      operation(client as unknown as DeskClient)
    );
  }

  // ------------------------------------------------------------------ walk-in

  /** POST /in-person/walk-in. */
  async registerWalkIn(
    dto: InPersonWalkInDto,
    clinicId: string,
    actor: InPersonActor
  ): Promise<InPersonWalkInResult> {
    const role = upper(actor.role);
    if (!MANUAL_CHECK_IN_ROLES.has(role)) {
      throw new ForbiddenException('Only the reception desk can register a walk-in.');
    }
    const deskActor: InPersonActor = { ...actor, role };
    const locationId = await this.resolveDeskLocation(clinicId, deskActor, dto.locationId);
    const patient = await this.read(client =>
      client.patient.findFirst({
        where: {
          OR: [{ id: dto.patientId }, { userId: dto.patientId }],
          user: {
            OR: [{ primaryClinicId: clinicId }, { clinics: { some: { id: clinicId } } }],
          },
        },
        select: { id: true, userId: true },
      })
    );
    if (!patient) throw new NotFoundException('Patient not found in this clinic');

    const now = new Date();
    const open = await this.read(client =>
      client.appointment.findFirst({
        where: {
          clinicId,
          locationId,
          patientId: patient.id,
          type: { not: AppointmentType.VIDEO_CALL },
          status: { in: OPEN_VISIT_STATUSES },
          date: { gte: startOfIstDay(now), lte: endOfIstDay(now) },
        },
        select: { id: true, subscriptionId: true, metadata: true },
        orderBy: { createdAt: 'desc' },
      })
    );

    // In-person visits are covered by the patient's monthly in-person plan (no per-visit fee). A
    // staff booking does not auto-link the plan, so the walk-in links it here, exactly like the
    // patient booking path. Without an active plan the clinic's walk-in rule decides: refused
    // (REQUIRE_PLAN, the default, nothing is booked), free, or with a desk bill.
    const plan = open?.subscriptionId
      ? null
      : await this.appointments.findActiveInPersonPlan(patient.id, clinicId);
    const planless = !open?.subscriptionId && !plan;
    if (planless && !planWaiverOf(open?.metadata)) {
      const rule = await this.walkInPlanSettings(clinicId);
      if (rule.policy === 'REQUIRE_PLAN') {
        throw new BadRequestException(WALK_IN_PLAN_REQUIRED_MESSAGE);
      }
      // A desk-fee rule with no fee anywhere is refused before anything is booked.
      if (
        rule.policy === 'ALLOW_WITH_DESK_FEE' &&
        rule.deskFee === null &&
        !((await this.billing.resolveConsultationFee(clinicId, dto.doctorId ?? null)) ?? 0)
      ) {
        throw new BadRequestException(WALK_IN_DESK_FEE_MISSING_MESSAGE);
      }
    }

    let appointmentId: string;
    if (open) {
      appointmentId = open.id;
      if (plan) await this.ensurePlanLinked(plan, appointmentId, clinicId);
    } else {
      const doctorId = await this.resolveWalkInDoctorId(clinicId, dto.doctorId);
      appointmentId = await this.createWalkInAppointment(
        dto,
        doctorId,
        patient.id,
        locationId,
        clinicId,
        deskActor
      );
      if (plan) await this.linkPlanOrCancel(plan, appointmentId, clinicId, deskActor);
    }
    // Plan-less and allowed: record the waiver (and raise the desk bill) before the check-in,
    // which accepts a visit that carries one.
    const waiver = planless
      ? await this.applyPlanWaiver(appointmentId, clinicId, deskActor.userId)
      : null;
    const checkedIn = await this.checkIns.checkInManually(appointmentId, clinicId, deskActor, {
      method: 'WALK_IN',
    });
    if (checkedIn.result !== 'CHECKED_IN') {
      throw new ConflictException('The walk-in could not be checked in');
    }
    void this.logging.log(
      LogType.AUDIT,
      LogLevel.INFO,
      open ? 'Walk-in matched an open visit of today' : 'Walk-in registered',
      'InPersonDeskService',
      { appointmentId, clinicId, locationId, actorUserId: actor.userId, actorRole: role }
    );
    return {
      ...checkedIn,
      created: !open,
      planWaiver: waiver
        ? {
            policy: waiver.policy,
            deskFee: waiver.deskFee,
            invoiceId: waiver.invoiceId,
            label: planWaiverOutcomeLabel(waiver),
          }
        : null,
    };
  }

  /**
   * Same compensation as the subscription booking route: a visit the plan cannot cover is
   * cancelled. A visit that is already covered (createAppointment links the patient's plan for
   * staff bookings too) is a success, never a cancellation.
   */
  private async linkPlanOrCancel(
    plan: { subscriptionId: string; patientUserId: string },
    appointmentId: string,
    clinicId: string,
    actor: InPersonActor
  ): Promise<void> {
    try {
      await this.ensurePlanLinked(plan, appointmentId, clinicId);
    } catch (linkError) {
      await this.appointments.cancelAppointment(
        appointmentId,
        'Auto-cancelled: failed to link active subscription',
        actor.userId,
        clinicId,
        actor.role
      );
      throw linkError;
    }
  }

  /**
   * Idempotent plan link: nothing to do when the appointment already carries a subscription
   * (linked by the booking service, a retry, or a concurrent request). A link refused because the
   * visit got covered meanwhile ("already covered by a subscription") also counts as success.
   */
  private async ensurePlanLinked(
    plan: { subscriptionId: string; patientUserId: string },
    appointmentId: string,
    clinicId: string
  ): Promise<void> {
    if (await this.isCoveredByPlan(appointmentId, clinicId)) return;
    try {
      await this.appointments.linkInPersonPlan(plan, appointmentId, clinicId);
    } catch (linkError) {
      if (await this.isCoveredByPlan(appointmentId, clinicId)) return;
      throw linkError;
    }
  }

  private async isCoveredByPlan(appointmentId: string, clinicId: string): Promise<boolean> {
    const row = await this.read(client =>
      client.appointment.findFirst({
        where: { id: appointmentId, clinicId },
        select: { id: true, subscriptionId: true },
      })
    );
    return Boolean(row?.subscriptionId);
  }

  /**
   * The doctor of the walk-in: the named one (Doctor.id or the doctor's User id) after checking
   * they practise in this clinic, else the clinic's single doctor (400 when it has several).
   */
  private async resolveWalkInDoctorId(clinicId: string, requested?: string): Promise<string> {
    const named = requested?.trim();
    if (!named) return this.appointments.resolveSingleDoctorId(clinicId);
    const link = await this.read(client =>
      client.doctorClinic.findFirst({
        where: { clinicId, OR: [{ doctorId: named }, { doctor: { userId: named } }] },
        select: { doctorId: true },
      })
    );
    if (!link?.doctorId) {
      throw new NotFoundException('The selected doctor does not practise in this clinic');
    }
    return link.doctorId;
  }

  /** RECEPTIONIST: its allotted location. Others: the requested one, or the only active one. */
  private async resolveDeskLocation(
    clinicId: string,
    actor: InPersonActor,
    requested?: string
  ): Promise<string> {
    if (actor.role === String(Role.RECEPTIONIST)) {
      return this.visits.resolveReceptionistLocation(actor.userId, clinicId);
    }
    if (requested) {
      const found = await this.read(client =>
        client.clinicLocation.findFirst({
          where: { id: requested, clinicId, isActive: true, deletedAt: null },
          select: { id: true },
        })
      );
      if (!found) throw new NotFoundException('Location not found');
      return found.id;
    }
    const active = await this.read(client =>
      client.clinicLocation.findMany({
        where: { clinicId, isActive: true, deletedAt: null },
        select: { id: true },
        take: 2,
      })
    );
    if (active.length === 1 && active[0]) return active[0].id;
    throw new BadRequestException('locationId is required');
  }

  /**
   * Books the walk-in into the doctor's next free in-person slot of today (the same availability
   * grid patients book from: clinic visit length, in-person kind only, past slots hidden). A slot
   * taken between the read and the insert (409 from the slot rule) or held by another desk's
   * booking lock (SCHEDULING_CONFLICT) is skipped after a short random pause and the next free
   * slot is tried, up to WALK_IN_SLOT_ATTEMPTS. Only 409s come out of a collision, never a 400.
   * The visit length is the clinic's in-person setting (set by the booking service).
   */
  private async createWalkInAppointment(
    dto: InPersonWalkInDto,
    doctorId: string,
    patientId: string,
    locationId: string,
    clinicId: string,
    actor: InPersonActor
  ): Promise<string> {
    const today = formatDateKeyInIST(new Date());
    const candidates = await this.nextFreeSlotsToday(doctorId, today, clinicId, locationId, actor);
    if (candidates.length === 0) {
      // Nothing is booked: the desk is offered the next free slot and books it in one click.
      const nextAvailable = await this.findNextAvailable(
        doctorId,
        today,
        clinicId,
        locationId,
        actor
      );
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: WALK_IN_NO_SLOT_CODE,
        message: noSlotTodayMessage(nextAvailable, WALK_IN_NO_SLOT_MESSAGE),
        nextAvailable,
        // The web API client forwards only `details` of an error body.
        details: { nextAvailable },
      });
    }

    for (const [attempt, time] of candidates.entries()) {
      if (attempt > 0) await retryJitter();
      const createDto = {
        patientId,
        doctorId,
        locationId,
        appointmentDate: `${today}T${time}:00+05:30`,
        type: AppointmentType.IN_PERSON,
        ...(dto.notes?.trim() ? { notes: dto.notes.trim() } : {}),
        // The walk-in tag read by the lists (`isWalkIn`) and carried into the live queue entry.
        metadata: { isWalkIn: true, bookingSource: 'WALK_IN' },
      } as unknown as CreateAppointmentDto;
      let created: Awaited<ReturnType<AppointmentsService['createAppointment']>>;
      try {
        created = await this.appointments.createAppointment(
          createDto,
          actor.userId,
          clinicId,
          actor.role
        );
      } catch (error) {
        // Slot already held by the doctor (thrown 409): try the next free slot.
        if (isRetryableSlotFailure(error)) continue;
        throw error;
      }
      const id = (created.data as Record<string, unknown> | undefined)?.['id'];
      if (created.success && typeof id === 'string') return id;
      // Another desk holds this slot's booking lock right now: try the next free slot.
      if (!created.success && isRetryableSlotFailure(created)) continue;
      throw created.success
        ? new BadRequestException('The walk-in could not be booked')
        : httpErrorForFailedResult({
            ...created,
            message: created.message || 'The walk-in could not be booked',
          });
    }
    // Every candidate slot was taken by concurrent bookings: a conflict (409), never a 400.
    throw new ConflictException(WALK_IN_SLOTS_BUSY_MESSAGE);
  }

  /** The first free in-person slots of today ("HH:MM", earliest first, not before now). */
  private async nextFreeSlotsToday(
    doctorId: string,
    today: string,
    clinicId: string,
    locationId: string,
    actor: InPersonActor
  ): Promise<string[]> {
    const slots = await this.freeInPersonSlots(doctorId, today, clinicId, locationId, actor);
    const nowMinutes = istMinutesOfDay(new Date());
    return slots
      .filter(slot => toMinutes(slot) >= nowMinutes)
      .sort()
      .slice(0, WALK_IN_SLOT_ATTEMPTS);
  }

  /** Free in-person slots of one IST day from the patient booking grid ("HH:MM"). */
  private async freeInPersonSlots(
    doctorId: string,
    dateKey: string,
    clinicId: string,
    locationId: string,
    actor: InPersonActor
  ): Promise<string[]> {
    const response = (await this.appointments.getDoctorAvailability(
      doctorId,
      dateKey,
      clinicId,
      actor.userId,
      locationId,
      actor.role,
      AppointmentType.IN_PERSON
    )) as { data?: { availableSlots?: unknown } } | null;
    return Array.isArray(response?.data?.availableSlots)
      ? (response.data.availableSlots as unknown[]).filter(
          (slot): slot is string => typeof slot === 'string' && /^\d{2}:\d{2}$/.test(slot)
        )
      : [];
  }

  /**
   * The next free in-person slot after today (up to NEXT_SLOT_SEARCH_DAYS ahead), from the same
   * grid. A failed lookup only drops the suggestion: the desk still gets the "day is full" 409.
   */
  private async findNextAvailable(
    doctorId: string,
    today: string,
    clinicId: string,
    locationId: string,
    actor: InPersonActor
  ): Promise<NextAvailableSlot | null> {
    try {
      const [clinicSettings, location] = await Promise.all([
        this.clinicSettingsOf(clinicId),
        this.read(client =>
          client.clinicLocation.findFirst({
            where: { id: locationId, clinicId },
            select: { id: true, workingHours: true },
          })
        ),
      ]);
      return await findNextAvailableSlot({
        fromDateKey: today,
        doctorId,
        locationId,
        // Same working-day rule as the booking and the slot grid (clinic-working-days.util).
        isOpenDay: dateKey =>
          isBookableDay({
            dateKey,
            clinicSettings,
            locationWorkingHours: location?.workingHours,
          }),
        loadFreeSlots: dateKey =>
          this.freeInPersonSlots(doctorId, dateKey, clinicId, locationId, actor),
      });
    } catch (error) {
      void this.logging.log(
        LogType.BUSINESS,
        LogLevel.WARN,
        'Next available in-person slot lookup failed',
        'InPersonDeskService',
        {
          clinicId,
          doctorId,
          locationId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return null;
    }
  }

  // ------------------------------------------------------------------ walk-in without a plan

  private async clinicSettingsOf(clinicId: string): Promise<unknown> {
    const clinic = await this.read(client =>
      client.clinic.findUnique({ where: { id: clinicId }, select: { settings: true } })
    );
    return clinic?.settings;
  }

  private async walkInPlanSettings(clinicId: string): Promise<WalkInPlanSettings> {
    return resolveWalkInPlanSettings(await this.clinicSettingsOf(clinicId));
  }

  /**
   * Check-in hook (CheckInLocationService): a plan-less in-person visit goes ahead when the clinic
   * allows it. A missing desk fee is a 400 the desk can act on; any other failure refuses the
   * check-in as before (no plan), with a warning.
   */
  private async allowWithoutPlan(visit: PlanlessVisitRef): Promise<boolean> {
    try {
      return (await this.applyPlanWaiver(visit.id, visit.clinicId, null)) !== null;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      void this.logging.log(
        LogType.BUSINESS,
        LogLevel.WARN,
        'Walk-in without plan rule could not be applied at check-in',
        'InPersonDeskService',
        {
          appointmentId: visit.id,
          clinicId: visit.clinicId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
      return false;
    }
  }

  /**
   * Records on the visit that it goes ahead without a plan, per the clinic rule, and returns the
   * waiver (null under REQUIRE_PLAN). Idempotent: a recorded waiver is returned as is (also after
   * the rule changed), a desk bill is raised once per visit and reused on a repeat.
   */
  private async applyPlanWaiver(
    appointmentId: string,
    clinicId: string,
    actorUserId: string | null
  ): Promise<PlanWaiver | null> {
    const row = (await this.read(client =>
      client.appointment.findFirst({
        where: { id: appointmentId, clinicId },
        select: { id: true, patientId: true, doctorId: true, date: true, metadata: true },
      })
    )) as PlanlessVisitRef | null;
    if (!row) throw new NotFoundException('Appointment not found');
    const recorded = planWaiverOf(row.metadata);
    if (recorded && (recorded.policy === 'ALLOW_FREE' || recorded.invoiceId)) return recorded;

    const rule: WalkInPlanSettings = recorded
      ? { policy: recorded.policy, deskFee: recorded.deskFee }
      : await this.walkInPlanSettings(clinicId);
    if (rule.policy === 'REQUIRE_PLAN') return null;

    let deskFee: number | null = null;
    let invoiceId: string | null = null;
    if (rule.policy === 'ALLOW_WITH_DESK_FEE') {
      deskFee = rule.deskFee ?? (await this.billing.resolveConsultationFee(clinicId, row.doctorId));
      if (!deskFee || deskFee <= 0) {
        throw new BadRequestException(WALK_IN_DESK_FEE_MISSING_MESSAGE);
      }
      invoiceId = await this.ensureDeskInvoice({ ...row, clinicId }, deskFee);
    }
    const waiver: PlanWaiver = {
      policy: rule.policy,
      deskFee,
      invoiceId,
      appliedAt: nowIso(),
      appliedBy: actorUserId,
    };
    const metadata =
      row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {};
    await this.database.executeHealthcareWrite(
      client =>
        (client as unknown as DeskClient).appointment.updateMany({
          where: { id: appointmentId, clinicId },
          data: { metadata: { ...metadata, [PLAN_WAIVER_METADATA_KEY]: waiver } },
        }),
      {
        userId: actorUserId ?? 'system',
        userRole: 'system',
        clinicId,
        operation: 'WALK_IN_PLAN_WAIVER',
        resourceType: 'APPOINTMENT',
        resourceId: appointmentId,
        details: { policy: waiver.policy, deskFee, invoiceId },
        timestamp: new Date(),
      }
    );
    void this.logging.log(
      LogType.AUDIT,
      LogLevel.INFO,
      'In-person visit allowed without a plan (clinic walk-in rule)',
      'InPersonDeskService',
      { appointmentId, clinicId, policy: waiver.policy, deskFee, invoiceId, actorUserId }
    );
    return waiver;
  }

  /**
   * The desk bill of a plan-less visit: an OPD-style consultation invoice, PENDING and payable at
   * the counter. It is not an online checkout, so the 15-minute payment window never voids it.
   */
  private async ensureDeskInvoice(visit: PlanlessVisitRef, deskFee: number): Promise<string> {
    const existing = await this.read(client =>
      client.invoice.findFirst({
        where: {
          appointmentId: visit.id,
          clinicId: visit.clinicId,
          billType: 'CONSULTATION',
          status: { not: 'VOID' },
        },
        select: { id: true },
      })
    );
    if (existing) return existing.id;
    const patient = await this.read(client =>
      client.patient.findFirst({
        where: { id: visit.patientId },
        select: { id: true, userId: true },
      })
    );
    if (!patient?.userId) throw new NotFoundException('Patient not found in this clinic');
    const dateLabel = formatDateInIST(visit.date ?? new Date(), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    const description = walkInInvoiceDescription(dateLabel);
    const invoice = (await this.billing.createInvoice({
      userId: patient.userId,
      clinicId: visit.clinicId,
      amount: deskFee,
      tax: 0,
      discount: 0,
      dueDate: nowIso(),
      description,
      lineItems: [
        {
          description,
          quantity: 1,
          unitPrice: deskFee,
          amount: deskFee,
          itemType: 'CONSULTATION',
          refId: visit.id,
        },
      ] as unknown as Record<string, unknown>,
      billType: 'CONSULTATION',
      patientId: patient.id,
      appointmentId: visit.id,
      metadata: {
        appointmentId: visit.id,
        appointmentType: AppointmentType.IN_PERSON,
        paymentFor: 'WALK_IN_DESK_FEE',
        payableAt: 'DESK',
      },
    } as unknown as CreateInvoiceDto)) as { id: string };
    return invoice.id;
  }

  // ------------------------------------------------------------------ undo no-show

  /**
   * POST /in-person/appointments/:id/undo-no-show (also reached by PATCH /appointments/:id/status
   * to CONFIRMED / SCHEDULED on a NO_SHOW visit). Visit day only: the live queue is per day.
   */
  async undoNoShow(
    appointmentId: string,
    clinicId: string,
    actor: InPersonActor
  ): Promise<InPersonUndoNoShowResult> {
    const role = upper(actor.role);
    if (!UNDO_NO_SHOW_ROLES.has(role)) {
      throw new ForbiddenException('You cannot undo a no-show.');
    }
    const caller: InPersonActor = { ...actor, role };
    const row = await this.visits.loadForActor(appointmentId, clinicId, caller);
    const status = upper(row.status);
    // M4: the status the visit had before the no-show (recorded when it was marked), else
    // CONFIRMED when the patient had arrived (checked in / holds a token), else SCHEDULED.
    const restoredStatus: InPersonUndoNoShowResult['restoredStatus'] = resolveRestoredStatus(row);

    if (status !== 'NO_SHOW') {
      // A repeated undo is a no-op (200); an undo on a visit that was never a no-show is 409 (L3).
      if ((status === 'CONFIRMED' || status === 'SCHEDULED') && wasNoShowUndone(row.metadata)) {
        const [visit] = await this.visits.toVisits([row]);
        if (!visit) throw new NotFoundException('Appointment not found');
        return {
          result: 'RESTORED',
          alreadyRestored: true,
          restoredStatus: status as InPersonUndoNoShowResult['restoredStatus'],
          visit,
        };
      }
      throw new ConflictException(`Only a no-show can be undone (this visit is ${status}).`);
    }
    if (formatDateKeyInIST(row.date) !== formatDateKeyInIST(new Date())) {
      throw new BadRequestException('A no-show can only be undone on the day of the visit.');
    }

    const claimed = await this.database.executeHealthcareWrite(
      client =>
        (client as unknown as DeskClient).appointment.updateMany({
          where: { id: appointmentId, clinicId, status: 'NO_SHOW' },
          // The token, the arrival time and the check-in stay as they were: the visit goes back to
          // its place in the queue (ordered by token), not to the back.
          data: {
            status: restoredStatus,
            metadata: withNoShowUndo(row.metadata, restoredStatus, new Date(), caller.userId),
          },
        }),
      {
        userId: caller.userId,
        userRole: caller.role,
        clinicId,
        operation: 'UNDO_NO_SHOW',
        resourceType: 'APPOINTMENT',
        resourceId: appointmentId,
        details: { restoredStatus },
        timestamp: new Date(),
      }
    );

    if (claimed.count === 1 && restoredStatus === 'CONFIRMED' && row.locationId) {
      // Back into the location's live queue through the one check-in service: an already
      // checked-in CONFIRMED visit is "repaired" (queue entry re-added), nothing else changes.
      await this.checkInLocations.processCheckIn(
        { appointmentId, locationId: row.locationId, patientId: row.patientId },
        clinicId,
        { actor: caller, presence: 'skip' }
      );
    }

    await this.cache.invalidateAppointmentCache(
      appointmentId,
      row.patientId,
      row.doctorId,
      clinicId
    );
    void this.events
      .emit('appointment.no_show_undone', {
        appointmentId,
        clinicId,
        patientId: row.patientId,
        doctorId: row.doctorId,
        locationId: row.locationId,
        restoredStatus,
        actorUserId: caller.userId,
      })
      .catch(() => undefined);

    const fresh = await this.visits.loadForActor(appointmentId, clinicId, caller);
    const [visit] = await this.visits.toVisits([fresh]);
    if (!visit) throw new NotFoundException('Appointment not found');
    return {
      result: 'RESTORED',
      alreadyRestored: claimed.count !== 1,
      restoredStatus,
      visit,
    };
  }

  /**
   * PATCH /appointments/:id/status helper: when the target is CONFIRMED / SCHEDULED and the visit
   * is a NO_SHOW, undo it here; otherwise null and the normal status flow runs.
   */
  async undoNoShowIfApplicable(
    appointmentId: string,
    targetStatus: string,
    clinicId: string,
    actor: InPersonActor
  ): Promise<InPersonUndoNoShowResult | null> {
    const target = upper(targetStatus);
    if (target !== 'CONFIRMED' && target !== 'SCHEDULED') return null;
    const current = await this.read(client =>
      client.appointment.findFirst({
        where: { id: appointmentId, clinicId, status: 'NO_SHOW' },
        select: { id: true },
      })
    );
    if (!current) return null;
    return this.undoNoShow(appointmentId, clinicId, actor);
  }
}
