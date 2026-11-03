/**
 * Queue Ops Service
 * @module ClinicOps
 * @description Front-desk queue priority: mark a patient SENIOR / PREGNANT / EMERGENCY so they
 * move ahead in the live queue (and keep the priority if they have not checked in yet). No-show
 * and skip keep using PATCH /queue/:patientId/status; calling / starting stays doctor-only.
 */

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentQueueService } from '@infrastructure/queue';
import { queuePriorityWeight } from '@infrastructure/queue/src/services/live-queue-rebuild.util';
import { OpsDbService, type OpsActor } from './ops-db.service';
import { ClinicAuditService } from './audit.service';
import type { SetQueuePriorityDto } from '../dto/clinic-ops.dto';

/**
 * appointment.priority column values. The live-queue weight comes from THE queue scale
 * (queuePriorityWeight: EMERGENCY 100, HIGH 50, NORMAL 0), so a reset to NORMAL weighs exactly
 * what a patient who never had a priority weighs and goes back to their place by token (M3).
 */
const COLUMN_PRIORITY: Record<SetQueuePriorityDto['priority'], string> = {
  NORMAL: 'NORMAL',
  SENIOR: 'HIGH',
  PREGNANT: 'HIGH',
  EMERGENCY: 'EMERGENCY',
};

export function queueWeightOf(priority: SetQueuePriorityDto['priority']): number {
  return queuePriorityWeight(COLUMN_PRIORITY[priority]);
}
const OPEN_STATUSES = ['SCHEDULED', 'CONFIRMED', 'PENDING', 'IN_PROGRESS'];

export interface QueuePriorityResponse {
  appointmentId: string;
  priority: SetQueuePriorityDto['priority'];
  reason: string | null;
  appliedToLiveQueue: boolean;
}

@Injectable()
export class QueueOpsService {
  constructor(
    private readonly ops: OpsDbService,
    private readonly queueService: AppointmentQueueService,
    private readonly audit: ClinicAuditService
  ) {}

  async setPriority(
    appointmentId: string,
    dto: SetQueuePriorityDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<QueuePriorityResponse> {
    const appointment = await this.ops.read(client =>
      client.appointment.findFirst({
        where: { id: appointmentId, clinicId },
        select: { id: true, type: true, status: true, metadata: true },
      })
    );
    if (!appointment) throw new NotFoundException('Appointment not found');
    if (String(appointment.type) === 'VIDEO_CALL') {
      throw new BadRequestException('Video visits have no queue, so they have no queue priority');
    }
    if (!OPEN_STATUSES.includes(String(appointment.status))) {
      throw new BadRequestException(
        `Priority can only be set on an open visit (this one is ${appointment.status})`
      );
    }

    const reason = dto.reason?.trim() || null;
    const label = dto.priority === 'NORMAL' ? null : dto.priority;
    const previous =
      appointment.metadata && typeof appointment.metadata === 'object'
        ? (appointment.metadata as Record<string, unknown>)
        : {};
    const rest = Object.fromEntries(
      Object.entries(previous).filter(
        ([key]) => key !== 'priorityLabel' && key !== 'priorityReason'
      )
    );
    const metadata = {
      ...rest,
      ...(label ? { priorityLabel: label } : {}),
      ...(label && reason ? { priorityReason: reason } : {}),
    };

    await this.ops.write(
      client =>
        client.appointment.updateMany({
          where: { id: appointmentId, clinicId },
          data: { priority: COLUMN_PRIORITY[dto.priority], metadata },
        }),
      {
        actor,
        clinicId,
        resourceType: 'APPOINTMENT',
        operation: 'SET_QUEUE_PRIORITY',
        resourceId: appointmentId,
        details: { priority: dto.priority },
      }
    );

    await this.audit.record(
      clinicId,
      { type: 'APPOINTMENT', id: appointmentId },
      'QUEUE_PRIORITY_SET',
      actor,
      {
        priority: dto.priority,
        reason,
      }
    );

    const live = await this.queueService.setEntryPriority(
      appointmentId,
      { priority: queueWeightOf(dto.priority), label, reason: label ? reason : null },
      clinicId,
      'clinic'
    );
    return {
      appointmentId,
      priority: dto.priority,
      reason: label ? reason : null,
      appliedToLiveQueue: live.updated,
    };
  }
}
