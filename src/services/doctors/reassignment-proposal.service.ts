/**
 * Review service for the L3 reassignment cascade proposals (DoctorReassignmentProposal) —
 * the human-confirm half of L3: list pending proposals, then APPLY (a chosen target doctor
 * at the same time, or a chosen next-available-day slot), HOLD for reception, or DISCARD.
 *
 * Every move goes through the EXISTING appointment paths — no parallel reschedule:
 *  - same-time provider move -> AppointmentsService.reassignDoctor (clinic / location /
 *    assistant-coverage checks + `appointment.reassigned` + queue re-check-in), then the
 *    existing `appointment.rescheduled` patient-notify event;
 *  - day move -> AppointmentsService.rescheduleAppointment (locks, availability grid,
 *    billing sync, reschedule limit, `appointment.rescheduled` notify).
 *
 * Row persistence + RBAC live in ReassignmentProposalStore (shared with the cascade); this
 * service only orchestrates the review actions on top of it.
 */

import { BadRequestException, Injectable } from '@nestjs/common';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events/event.service';
import { LogType, LogLevel } from '@core/types';
import type { AppointmentContext } from '@core/types/appointment.types';
import type { AppointmentWithRelations } from '@core/types/database.types';
import {
  isRescheduleStatusAllowed,
  rescheduleStatusRefusal,
} from '@services/appointments/core/reschedule-policy';
import { AppointmentsService } from '@services/appointments/appointments.service';
import { CoreAppointmentService } from '@services/appointments/core/core-appointment.service';
import type { DayAvailabilityActor } from '@services/doctors/day-availability.service';
import { addDaysIstKey } from '@services/doctors/day-availability-sessions.util';
import { formatDateKeyInIST } from '@utils/date-time.util';
import {
  ReassignmentProposalStore,
  toReassignmentProposalResponse,
  type ReassignmentProposalRow,
  type ReassignmentProposalResponse,
} from '@services/doctors/reassignment-proposal.store';

const SOURCE = 'ReassignmentProposalService';
const NEXT_DAY_HORIZON_DAYS = 31;

export type { ReassignmentProposalResponse };

export interface ProposalApplyInput {
  /** Chosen target provider (Doctor.id); same-time move via the reassign path. */
  doctorId?: string;
  /** Chosen next-available-day date+time (IST) via the reschedule path; same time preferred. */
  date?: string;
  time?: string;
  notes?: string;
}

@Injectable()
export class ReassignmentProposalService {
  constructor(
    private readonly loggingService: LoggingService,
    private readonly eventService: EventService,
    private readonly appointmentsService: AppointmentsService,
    private readonly coreAppointmentService: CoreAppointmentService,
    private readonly proposalStore: ReassignmentProposalStore
  ) {}

  /** Pending (or all) proposals in a clinic, optionally for one doctor (Doctor.id or User.id). */
  async listProposals(
    clinicId: string,
    actor: DayAvailabilityActor,
    status?: string,
    doctorId?: string
  ): Promise<ReassignmentProposalResponse[]> {
    if (!clinicId) throw new BadRequestException('Clinic context is required');
    this.proposalStore.assertReviewRole(actor);
    const normalizedStatus = (status?.trim() || 'PENDING').toUpperCase();
    let doctorFilter = doctorId?.trim() || undefined;
    if (actor.role === 'DOCTOR' || actor.role === 'ASSISTANT_DOCTOR') {
      doctorFilter =
        (await this.appointmentsService.resolveDoctorEntityId(
          doctorFilter ?? actor.userId,
          clinicId
        )) ?? undefined;
      if (!doctorFilter) {
        throw new BadRequestException('Doctors can only list their own reassignment proposals');
      }
    }
    const rows = await this.proposalStore.list(clinicId, normalizedStatus, doctorFilter);
    return rows.map(toReassignmentProposalResponse);
  }

  /**
   * Confirm a specific move: either a chosen target doctor at the SAME time (the reassign path)
   * or a chosen day+time (the reschedule path). Marks the proposal APPLIED.
   */
  async applyProposal(
    id: string,
    clinicId: string,
    actor: DayAvailabilityActor,
    input: ProposalApplyInput
  ): Promise<ReassignmentProposalResponse> {
    const proposal = await this.requirePending(id, clinicId, actor);
    const hasDoctor = Boolean(input.doctorId?.trim());
    const hasDate = Boolean(input.date?.trim() && input.time?.trim());
    if (!hasDoctor && !hasDate) {
      throw new BadRequestException('Provide doctorId (same-time move) or date+time (day move)');
    }
    if (hasDoctor && !hasDate) {
      await this.applySameTimeMove(
        proposal,
        input.doctorId?.trim() || '',
        actor,
        input.notes?.trim()
      );
    } else {
      await this.applyDayMove(
        proposal,
        input.date?.trim() || '',
        input.time?.trim() || '',
        actor,
        input.notes?.trim()
      );
    }
    return await this.proposalStore.setStatus(id, actor, 'APPLIED', input.notes?.trim());
  }

  /**
   * The "no queue overflow" rule: find the next open slot of the proposal's doctor through the
   * shared availability seam (same time preferred, else the day's earliest open slot) and move
   * the visit there via the existing reschedule path. Marks the proposal APPLIED.
   */
  async moveToNextAvailableDay(
    id: string,
    clinicId: string,
    actor: DayAvailabilityActor
  ): Promise<ReassignmentProposalResponse> {
    const proposal = await this.requirePending(id, clinicId, actor);
    const appointment = await this.loadAppointment(proposal.appointmentId, clinicId);
    const slot = await this.findNextOpenSlot(appointment, proposal, clinicId);
    if (!slot) {
      throw new BadRequestException(
        'No open slot found for this doctor in the next 31 days; pick one manually or hold the visit'
      );
    }
    await this.applyDayMove(proposal, slot.date, slot.time, actor, 'Next available slot');
    return await this.proposalStore.setStatus(
      id,
      actor,
      'APPLIED',
      'Moved to the next available slot'
    );
  }

  /** Defer to reception/admin: no patient move yet, the patient is told it is pending. */
  async holdProposal(
    id: string,
    clinicId: string,
    actor: DayAvailabilityActor
  ): Promise<ReassignmentProposalResponse> {
    const proposal = await this.requirePending(id, clinicId, actor);
    const appointment = await this.loadAppointment(proposal.appointmentId, clinicId);
    const updated = await this.proposalStore.setStatus(
      id,
      actor,
      'DEFERRED',
      'Held for reception/admin; patient notified that rescheduling is pending'
    );
    await this.notifyPatientOfPendingReschedule(proposal, appointment);
    return updated;
  }

  /** Discard: the visit stays with the original doctor; no patient move. */
  async discardProposal(
    id: string,
    clinicId: string,
    actor: DayAvailabilityActor
  ): Promise<ReassignmentProposalResponse> {
    // RBAC + existence check (no patient move happens here).
    await this.requirePending(id, clinicId, actor);
    return await this.proposalStore.setStatus(id, actor, 'DISCARDED', 'Discarded; no patient move');
  }

  // ── Moves via the existing appointment paths ─────────────────────────────────

  /** Same-time move: eligibility + open-slot re-check, then the existing reassign path. */
  private async applySameTimeMove(
    proposal: ReassignmentProposalRow,
    targetDoctorId: string,
    actor: DayAvailabilityActor,
    notes: string | undefined
  ): Promise<void> {
    if (!targetDoctorId) throw new BadRequestException('doctorId is required for a same-time move');
    const appointment = await this.loadAppointment(proposal.appointmentId, proposal.clinicId);
    if (appointment.doctorId === targetDoctorId) {
      throw new BadRequestException('The visit is already assigned to this doctor');
    }
    // The chosen provider must be eligible AND open at that exact slot (same rules as the
    // cascade's safe-auto check, but human-driven, so a failed check is a hard 400).
    const candidates = (await this.appointmentsService.getAppointmentReassignmentCandidates(
      appointment.id,
      proposal.clinicId
    )) as Array<{ id: string; eligible: boolean; reason?: string }>;
    const candidate = (candidates ?? []).find(item => item.id === targetDoctorId);
    if (!candidate) {
      throw new BadRequestException('Target doctor is not a provider of this clinic');
    }
    if (!candidate.eligible) {
      throw new BadRequestException(
        candidate.reason ?? 'Target doctor is not eligible for this visit'
      );
    }
    const open = await this.providerOpenAtSlot(
      targetDoctorId,
      formatDateKeyInIST(appointment.date),
      appointment,
      appointment.time
    );
    if (!open) {
      throw new BadRequestException(
        'The target doctor is not open at that slot; pick another doctor or a different day'
      );
    }
    await this.appointmentsService.reassignDoctor(
      appointment.id,
      targetDoctorId,
      actor.userId || 'system',
      proposal.clinicId,
      actor.role,
      notes ?? 'Reassignment proposal applied: same-time move'
    );
    await this.notifySameTimeMove(proposal, appointment, targetDoctorId);
  }

  /** Day move via the existing reschedule path (locks, grid, billing sync, notify). */
  private async applyDayMove(
    proposal: ReassignmentProposalRow,
    date: string,
    time: string,
    actor: DayAvailabilityActor,
    notes: string | undefined
  ): Promise<void> {
    if (!date || !time) throw new BadRequestException('date and time are required for a day move');
    const appointment = await this.loadAppointment(proposal.appointmentId, proposal.clinicId);
    // The same reschedulability guard the reschedule path enforces, up front for a clear 400.
    if (!isRescheduleStatusAllowed(appointment.type, appointment.status)) {
      throw new BadRequestException(rescheduleStatusRefusal(appointment.type));
    }
    const result = await this.appointmentsService.rescheduleAppointment(
      proposal.appointmentId,
      date,
      time,
      actor.userId || 'system',
      proposal.clinicId,
      actor.role,
      notes ?? 'Reassignment proposal applied: moved to the chosen day'
    );
    if (!result.success) {
      throw new BadRequestException(result.message || 'The appointment could not be rescheduled');
    }
  }

  /** Scan up to 31 days: same time first, then the day's earliest open slot of the doctor. */
  private async findNextOpenSlot(
    appointment: AppointmentWithRelations,
    proposal: ReassignmentProposalRow,
    clinicId: string
  ): Promise<{ date: string; time: string } | null> {
    const originalDateKey = formatDateKeyInIST(appointment.date);
    const todayKey = istTodayKey();
    for (let offset = 1; offset <= NEXT_DAY_HORIZON_DAYS; offset += 1) {
      const date = addDaysIstKey(originalDateKey, offset);
      if (date < todayKey) continue;
      const slots = await this.providerOpenSlots(appointment.doctorId, clinicId, date, appointment);
      const sameTime = slots.find(slot => slot === appointment.time);
      if (sameTime) return { date, time: sameTime };
      const earliest = slots
        .slice()
        .sort()
        .find(slot => slot >= appointment.time);
      if (earliest) return { date, time: earliest };
    }
    void this.loggingService.log(
      LogType.APPOINTMENT,
      LogLevel.WARN,
      'No open slot for the next-day move within the 31-day horizon',
      SOURCE,
      {
        appointmentId: appointment.id,
        doctorId: appointment.doctorId,
        clinicId,
        proposalId: proposal.id,
      }
    );
    return null;
  }

  /** The provider's open slots at that day, through the shared availability seam. */
  private async providerOpenSlots(
    doctorId: string,
    clinicId: string,
    date: string,
    appointment: AppointmentWithRelations
  ): Promise<string[]> {
    const context: AppointmentContext = {
      userId: 'system',
      role: 'SYSTEM',
      clinicId,
      ...(appointment.locationId ? { locationId: appointment.locationId } : {}),
      ...(appointment.type ? { appointmentType: String(appointment.type) } : {}),
    };
    const availability = (await this.coreAppointmentService.getDoctorAvailability(
      doctorId,
      date,
      context
    )) as { availableSlots?: string[] };
    return availability?.availableSlots ?? [];
  }

  private providerOpenAtSlot(
    doctorId: string,
    date: string,
    appointment: AppointmentWithRelations,
    time: string
  ): Promise<boolean> {
    return this.providerOpenSlots(
      doctorId,
      formatDateKeyInIST(appointment.date),
      date,
      appointment
    ).then(slots => slots.includes(time));
  }

  // ── Existing patient-notify paths (best-effort) ─────────────────────────────

  /** The existing reschedule-notify path for a same-time provider move. */
  private async notifySameTimeMove(
    proposal: ReassignmentProposalRow,
    appointment: AppointmentWithRelations,
    targetDoctorId: string
  ): Promise<void> {
    try {
      await this.eventService.emit('appointment.rescheduled', {
        appointmentId: appointment.id,
        clinicId: proposal.clinicId,
        oldDate: formatDateKeyInIST(appointment.date),
        oldTime: appointment.time,
        newDate: formatDateKeyInIST(appointment.date),
        newTime: appointment.time,
        appointment,
        context: { userId: targetDoctorId },
        reason: 'Your appointment was moved to a different doctor at the same time',
      });
    } catch (error) {
      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.WARN,
        'Could not notify the patient of the same-time move',
        SOURCE,
        {
          appointmentId: appointment.id,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  /** The hold notice: the patient is told the visit is pending a reschedule decision. */
  private async notifyPatientOfPendingReschedule(
    proposal: ReassignmentProposalRow,
    appointment: AppointmentWithRelations
  ): Promise<void> {
    try {
      await this.eventService.emit('appointment.updated', {
        appointmentId: appointment.id,
        clinicId: proposal.clinicId,
        appointment,
        context: { userId: appointment.doctorId, source: 'ReassignmentProposalService.hold' },
        reason: 'Your appointment is pending rescheduling; the clinic will confirm a new time',
        status: appointment.status,
      });
    } catch (error) {
      void this.loggingService.log(
        LogType.BUSINESS,
        LogLevel.WARN,
        'Could not notify the patient of the hold',
        SOURCE,
        {
          appointmentId: appointment.id,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  // ── Shared reads ────────────────────────────────────────────────────────────

  /** Load + RBAC + PENDING gate; every review action starts here. */
  private async requirePending(
    id: string,
    clinicId: string,
    actor: DayAvailabilityActor
  ): Promise<ReassignmentProposalRow> {
    const proposal = await this.proposalStore.load(id, clinicId);
    if (proposal.status !== 'PENDING') {
      throw new BadRequestException(
        `Only PENDING proposals can be acted on (status: ${proposal.status})`
      );
    }
    await this.proposalStore.assertCanManageDoctor(proposal.doctorId, actor, clinicId);
    return proposal;
  }

  private async loadAppointment(
    appointmentId: string,
    clinicId: string
  ): Promise<AppointmentWithRelations> {
    const appointment = (await this.appointmentsService.getAppointmentById(
      appointmentId,
      clinicId
    )) as AppointmentWithRelations;
    if (!appointment) throw new BadRequestException('The proposal appointment no longer exists');
    return appointment;
  }
}

/** Today's IST day key (YYYY-MM-DD). */
function istTodayKey(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
