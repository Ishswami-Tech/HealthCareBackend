/**
 * L3 cascade for a just-written doctor day-availability override (L1): when the override
 * REMOVES OPD windows for a doctor+date (shrinks the windows, or closes the day), that
 * doctor's not-yet-started in-person appointments inside the removed windows are handled
 * here, not left stranded:
 *
 *  - SAFE-AUTO (no human): another eligible same-clinic provider (a different doctor, or the
 *    clinic's assistant-doctor where the appointment/clinic allows it) is genuinely open at
 *    the exact slot per the shared availability seam (their L0 weekly windows + their own L1
 *    overrides — never hand-rolled availability), AND the move has no billing impact (no
 *    COMPLETED payment and no live invoice on the visit). Applied through the EXISTING
 *    reassign path (AppointmentsService.reassignDoctor — clinic / location / assistant-
 *    coverage checks included, which also emits `appointment.reassigned`), the patient is
 *    notified through the EXISTING reschedule-notify path (`appointment.rescheduled`), and a
 *    resolved APPLIED proposal row is recorded for audit (via the shared store).
 *  - MANUAL (propose-and-confirm): everything else. A PENDING DoctorReassignmentProposal row
 *    is created — or the existing PENDING row refreshed, one PENDING row per appointment so
 *    a replaced override never piles up duplicates — for the doctor / clinic-admin to review.
 *
 * Fail-open: per-visit errors are captured as PENDING proposals with a note; the trigger
 * (DayAvailabilityService.createDayOverride) additionally wraps the whole run in try/catch,
 * so a cascade failure never rolls back or blocks the availability change.
 */

import { Injectable } from '@nestjs/common';
import { DatabaseService } from '@infrastructure/database';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events/event.service';
import { Prisma, $Enums } from '@infrastructure/database/prisma/generated/client';
import { LogType, LogLevel } from '@core/types';
import type { AppointmentContext } from '@core/types/appointment.types';
import type { AppointmentWithRelations } from '@core/types/database.types';
import {
  IN_PERSON_NON_RESCHEDULABLE_STATUSES,
  isCheckedInForReschedule,
  isRescheduleStatusAllowed,
  isVideoAppointmentType,
} from '@services/appointments/core/reschedule-policy';
import { AppointmentsService } from '@services/appointments/appointments.service';
import { CoreAppointmentService } from '@services/appointments/core/core-appointment.service';
import { timeInsideWindows } from '@services/doctors/day-availability-sessions.util';
import { ReassignmentProposalStore } from '@services/doctors/reassignment-proposal.store';

export interface DayOverrideCascadeInput {
  /** Doctor.id (or the doctor's User.id, as the override row stores it). */
  doctorId: string;
  clinicId: string;
  /** IST calendar day, YYYY-MM-DD. */
  date: string;
  /** The NEW override's session blocks; `[]` = closed for the day. */
  newSessions: Array<{ start: string; end: string }>;
  /** The effective windows BEFORE this override (the superseded override's, or weekly). */
  oldSessions: Array<{ start: string; end: string }>;
  /** Set when the override is location-scoped: only that location's visits are cascaded. */
  locationId?: string | null;
  reason?: string | null;
}

export interface DayOverrideCascadeSummary {
  affected: number;
  autoMoved: number;
  pending: number;
}

const SOURCE = 'ReassignmentCascadeService';
const SYSTEM_ACTOR = 'system';

interface AffectedVisit {
  id: string;
  type: string;
  status: string;
  time: string;
  locationId: string | null;
  patientId: string;
  doctorId: string;
  checkedInAt: Date | null;
}

interface ProviderCandidate {
  id: string;
  name: string;
  eligible: boolean;
  isCurrent: boolean;
}

@Injectable()
export class ReassignmentCascadeService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService,
    private readonly appointmentsService: AppointmentsService,
    private readonly coreAppointmentService: CoreAppointmentService,
    private readonly proposalStore: ReassignmentProposalStore
  ) {}

  /**
   * Run the cascade after an override was written and its availability cache invalidated.
   * Never throws: failures are logged WARN and the summary reflects what completed.
   */
  async runDayOverrideCascade(input: DayOverrideCascadeInput): Promise<DayOverrideCascadeSummary> {
    const summary: DayOverrideCascadeSummary = { affected: 0, autoMoved: 0, pending: 0 };
    // Nothing was removed when both the old and the new windows are empty.
    if (input.newSessions.length === 0 && input.oldSessions.length === 0) {
      return summary;
    }
    const removed = this.removedWindowPredicate(input);
    let visits: AffectedVisit[];
    try {
      visits = await this.loadAffectedVisits(input, removed);
    } catch (error) {
      this.warn('Could not load affected visits; cascade stopped', { ...input }, error);
      return summary;
    }
    summary.affected = visits.length;
    // One availability lookup per provider per run: every visit shares the day.
    const openSlotsByProvider = new Map<string, string[]>();
    for (const visit of visits) {
      try {
        const moved = await this.trySafeAutoMove(input, visit, openSlotsByProvider);
        if (moved) {
          summary.autoMoved += 1;
        } else {
          await this.recordPending(input, visit, this.manualReason(input, visit));
          summary.pending += 1;
        }
      } catch (error) {
        // A move that failed mid-way still needs a human eye: leave it as a PENDING proposal.
        try {
          await this.recordPending(
            input,
            visit,
            `Auto-move failed: ${error instanceof Error ? error.message : String(error)}`
          );
        } catch (recordError) {
          this.warn(
            'Could not record a pending proposal',
            { ...input, appointmentId: visit.id },
            recordError
          );
        }
        summary.pending += 1;
      }
    }
    if (summary.affected > 0) {
      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.INFO,
        'Day-override reassignment cascade finished',
        SOURCE,
        { doctorId: input.doctorId, clinicId: input.clinicId, date: input.date, ...summary }
      );
    }
    return summary;
  }

  // ── Find ──────────────────────────────────────────────────────────────────────

  /**
   * The doctor's not-yet-started in-person visits of that day (+location, when the override is
   * location-scoped) whose slot the override just removed. The status set is the
   * reschedule-policy one; video visits never sit in an OPD window and are excluded.
   */
  private loadAffectedVisits(
    input: DayOverrideCascadeInput,
    removed: (time: string) => boolean
  ): Promise<AffectedVisit[]> {
    const dayStart = new Date(`${input.date}T00:00:00.000+05:30`);
    const dayEnd = new Date(`${input.date}T23:59:59.999+05:30`);
    return this.databaseService.executeHealthcareRead<AffectedVisit[]>(async client => {
      const tx = client as unknown as Prisma.TransactionClient;
      const rows = await tx.appointment.findMany({
        where: {
          doctorId: input.doctorId,
          clinicId: input.clinicId,
          date: { gte: dayStart, lte: dayEnd },
          status: {
            notIn: [...IN_PERSON_NON_RESCHEDULABLE_STATUSES] as $Enums.AppointmentStatus[],
          },
          ...(input.locationId ? { locationId: input.locationId } : {}),
        },
        select: {
          id: true,
          type: true,
          status: true,
          time: true,
          locationId: true,
          patientId: true,
          doctorId: true,
          checkedInAt: true,
        },
      });
      return (rows ?? []).filter(row => {
        if (isVideoAppointmentType(row.type)) return false; // OPD windows are in-person only
        if (!isRescheduleStatusAllowed(row.type, row.status)) return false;
        // A checked-in visit is in today's queue: it has started and must not move.
        if (isCheckedInForReschedule({ type: row.type, checkedInAt: row.checkedInAt })) {
          return false;
        }
        return removed(row.time);
      });
    });
  }

  /**
   * "The override just removed this slot": inside the old windows but not inside the new ones.
   * A "closed for the day" override (new sessions empty) with open old windows removes the
   * whole day; when nothing was open before (old sessions empty) nothing was removed either.
   */
  private removedWindowPredicate(input: DayOverrideCascadeInput): (time: string) => boolean {
    if (input.newSessions.length === 0) {
      return input.oldSessions.length > 0 ? () => true : () => false;
    }
    if (input.oldSessions.length === 0) return () => false;
    return (time: string): boolean =>
      timeInsideWindows(time, input.oldSessions) && !timeInsideWindows(time, input.newSessions);
  }

  private manualReason(input: DayOverrideCascadeInput, visit: AffectedVisit): string {
    const window = input.newSessions.length === 0 ? 'day closed' : `window ${visit.time} removed`;
    return `No auto-move (${window} on ${input.date}): apply a chosen doctor, the next available day, hold for reception, or discard`;
  }

  // ── Split: safe-auto vs manual ───────────────────────────────────────────────

  /**
   * The safe-auto preconditions, ALL of them (any failure -> manual):
   *   1. no billing impact: no COMPLETED payment and no live (non-VOID) invoice;
   *   2. an eligible same-clinic provider other than the current one — per the existing
   *      reassignment-candidate rules (role, location, assistant-doctor coverage / service
   *      eligibility, so a cross-role move only lands where the patient/clinic allows it);
   *   3. that provider is genuinely open at the exact slot per the availability seam
   *      (CoreAppointmentService.getDoctorAvailability: their L0 weekly + L1 overrides,
   *      closures, booked slots — the same grid every booking reads).
   * On success the visit is re-assigned through the existing reassign path (same date+time,
   * location kept), the patient is notified through the existing reschedule-notify path, and
   * an APPLIED audit row is recorded. Returns false (manual) when any precondition fails.
   */
  private async trySafeAutoMove(
    input: DayOverrideCascadeInput,
    visit: AffectedVisit,
    openSlotsByProvider: Map<string, string[]>
  ): Promise<boolean> {
    if (await this.hasBillingImpact(visit.id, input.clinicId)) return false;

    let candidates: ProviderCandidate[];
    try {
      candidates = (await this.appointmentsService.getAppointmentReassignmentCandidates(
        visit.id,
        input.clinicId
      )) as ProviderCandidate[];
    } catch (error) {
      this.warn(
        'Reassignment candidate lookup failed; leaving the visit for manual review',
        { ...input, appointmentId: visit.id },
        error
      );
      return false;
    }
    for (const candidate of candidates ?? []) {
      if (!candidate.eligible || candidate.isCurrent || candidate.id === visit.doctorId) {
        continue;
      }
      if (!(await this.providerOpenAtSlot(input, visit, candidate.id, openSlotsByProvider))) {
        continue;
      }
      // Existing path: checks + metadata + queue re-check-in + `appointment.reassigned`.
      await this.appointmentsService.reassignDoctor(
        visit.id,
        candidate.id,
        SYSTEM_ACTOR,
        input.clinicId,
        SYSTEM_ACTOR,
        `Day override removed the OPD window; auto-moved to ${candidate.name} (same time)`
      );
      await this.notifyPatientOfSameTimeMove(input, visit, candidate.name);
      await this.proposalStore.recordApplied({
        clinicId: input.clinicId,
        doctorId: input.doctorId,
        appointmentId: visit.id,
        dateKey: input.date,
        targetDoctorId: candidate.id,
        reason: input.reason ?? null,
      });
      return true;
    }
    return false;
  }

  /** The provider's own grid at that day through the shared availability seam. */
  private async providerOpenAtSlot(
    input: DayOverrideCascadeInput,
    visit: AffectedVisit,
    providerId: string,
    openSlotsByProvider: Map<string, string[]>
  ): Promise<boolean> {
    let slots = openSlotsByProvider.get(providerId);
    if (slots === undefined) {
      const context: AppointmentContext = {
        userId: SYSTEM_ACTOR,
        role: SYSTEM_ACTOR,
        clinicId: input.clinicId,
        ...(visit.locationId ? { locationId: visit.locationId } : {}),
        appointmentType: visit.type,
      };
      const availability = (await this.coreAppointmentService.getDoctorAvailability(
        providerId,
        input.date,
        context
      )) as { availableSlots?: string[] };
      slots = availability?.availableSlots ?? [];
      openSlotsByProvider.set(providerId, slots);
    }
    return slots.includes(visit.time);
  }

  /** No billing impact = no COMPLETED payment and no live (non-VOID) invoice on the visit. */
  private async hasBillingImpact(appointmentId: string, clinicId: string): Promise<boolean> {
    return await this.databaseService.executeHealthcareRead(async client => {
      const tx = client as unknown as Prisma.TransactionClient;
      const [payment, invoice] = await Promise.all([
        tx.payment.findFirst({
          where: { appointmentId, status: 'COMPLETED' },
          select: { id: true },
        }),
        tx.invoice.findFirst({
          where: { appointmentId, clinicId, status: { not: 'VOID' } },
          select: { id: true },
        }),
      ]);
      return Boolean(payment || invoice);
    });
  }

  /**
   * The existing patient-notify path for a same-time move: the `appointment.rescheduled`
   * event (old slot == new slot, provider in the reason) is exactly what the reschedule flow
   * emits (appointments.service.ts ~4215) and what the notification listener turns into the
   * patient's "moved" message. Best-effort: a notification failure never fails the cascade.
   */
  private async notifyPatientOfSameTimeMove(
    input: DayOverrideCascadeInput,
    visit: AffectedVisit,
    providerName: string
  ): Promise<void> {
    try {
      const appointment = (await this.appointmentsService.getAppointmentById(
        visit.id,
        input.clinicId
      )) as AppointmentWithRelations;
      await this.eventService.emit('appointment.rescheduled', {
        appointmentId: visit.id,
        clinicId: input.clinicId,
        oldDate: input.date,
        oldTime: visit.time,
        newDate: input.date,
        newTime: visit.time,
        appointment,
        context: { userId: SYSTEM_ACTOR },
        reason: `Your appointment was moved to ${providerName} at the same time`,
      });
    } catch (error) {
      this.warn(
        'Could not notify the patient of the auto-move',
        { ...input, appointmentId: visit.id },
        error
      );
    }
  }

  private recordPending(
    input: DayOverrideCascadeInput,
    visit: AffectedVisit,
    notes: string
  ): Promise<void> {
    return this.proposalStore.recordPending({
      clinicId: input.clinicId,
      doctorId: input.doctorId,
      appointmentId: visit.id,
      dateKey: input.date,
      reason: input.reason ?? null,
      notes,
    });
  }

  private warn(message: string, context: Record<string, unknown>, error?: unknown): void {
    void this.loggingService.log(LogType.BUSINESS, LogLevel.WARN, message, SOURCE, {
      ...context,
      ...(error !== undefined
        ? { error: error instanceof Error ? error.message : JSON.stringify(error) }
        : {}),
    });
  }
}
