/**
 * Check-in Log Service
 * @module ClinicOps
 * @description Audit trail of every in-clinic check-in attempt (QR scan, desk check-in, walk-in),
 * successful or not, so the clinic admin and the front desk can see failed scans and resolve them.
 */

import { Injectable, NotFoundException } from '@nestjs/common';
import { LoggingService } from '@infrastructure/logging';
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { LogLevel, LogType } from '@core/types';
import { OpsDbService, type OpsActor } from './ops-db.service';
import {
  displayName,
  istCreatedAtRange,
  todayIstKey,
  type CheckInAttemptRow,
} from '../clinic-ops.types';
import type { ResolveCheckInAttemptDto } from '../dto/clinic-ops.dto';
import { isNoActivePlanError } from '@services/appointments/core/check-in-plan.util';

const SOURCE = 'CheckInLogService';

export type CheckInFailureReason =
  | 'EXPIRED_QR'
  | 'INVALID_QR'
  | 'WRONG_LOCATION'
  | 'NOT_BOOKED'
  | 'TOO_EARLY'
  | 'TOO_LATE'
  | 'ALREADY_CHECKED_IN'
  | 'LOCATION_INACTIVE'
  | 'LOCATION_REQUIRED'
  | 'TOO_FAR'
  | 'NO_ACTIVE_PLAN'
  | 'OTHER';

export interface RecordCheckInAttemptInput {
  clinicId: string;
  locationId?: string | null;
  appointmentId?: string | null;
  patientId?: string | null;
  patientName?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  method: 'QR' | 'MANUAL' | 'WALK_IN';
  outcome: 'SUCCESS' | 'FAILED';
  failureReason?: CheckInFailureReason;
  failureDetail?: string | null;
  tokenLabel?: string | null;
}

export interface CheckInAttemptResponse {
  id: string;
  at: string;
  locationId: string | null;
  appointmentId: string | null;
  patientId: string | null;
  patientName: string | null;
  method: string;
  outcome: string;
  failureReason: string | null;
  failureDetail: string | null;
  tokenLabel: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  needsAttention: boolean;
}

export interface CheckInLogSummary {
  date: string;
  total: number;
  succeeded: number;
  failed: number;
  unresolvedFailures: number;
  byMethod: Record<string, number>;
  byFailureReason: Record<string, number>;
}

/** Marker used in the validation message of a QR poster that was replaced (see QR regenerate). */
export const REPLACED_QR_MESSAGE =
  'This QR code was replaced. Please scan the new poster at the clinic.';

/**
 * Maps whatever the QR scan flow threw to a failure reason for the log. Pure: never touches the DB.
 */
export function classifyCheckInFailure(error: unknown): {
  reason: CheckInFailureReason;
  detail: string;
} {
  const detail = error instanceof Error ? error.message.slice(0, 300) : 'Unknown error';
  // The visit is not covered by an active plan (L1: was logged as OTHER).
  if (isNoActivePlanError(error)) {
    return { reason: 'NO_ACTIVE_PLAN', detail };
  }
  if (error instanceof HealthcareError) {
    switch (error.code) {
      case ErrorCode.CHECKIN_NO_APPOINTMENT_FOUND:
        return { reason: 'NOT_BOOKED', detail };
      case ErrorCode.CHECKIN_ALREADY_CONFIRMED:
        return { reason: 'ALREADY_CHECKED_IN', detail };
      case ErrorCode.CHECKIN_WRONG_LOCATION:
        return { reason: 'WRONG_LOCATION', detail };
      case ErrorCode.CHECKIN_INVALID_QR_CODE:
        return { reason: 'INVALID_QR', detail };
      case ErrorCode.CHECKIN_APPOINTMENT_EXPIRED:
        return { reason: 'TOO_LATE', detail };
      case ErrorCode.CHECKIN_TIME_WINDOW_EXPIRED: {
        const meta = (error.metadata ?? {}) as { appointmentTime?: string; currentTime?: string };
        const appointmentAt = meta.appointmentTime ? Date.parse(meta.appointmentTime) : NaN;
        const now = meta.currentTime ? Date.parse(meta.currentTime) : NaN;
        return {
          reason:
            Number.isNaN(appointmentAt) || Number.isNaN(now) || now < appointmentAt
              ? 'TOO_EARLY'
              : 'TOO_LATE',
          detail,
        };
      }
      default: {
        const field = (error.metadata as { field?: string } | undefined)?.field;
        if (field === 'qrCode') {
          return {
            reason: detail.includes(REPLACED_QR_MESSAGE) ? 'EXPIRED_QR' : 'INVALID_QR',
            detail,
          };
        }
        if (field === 'location') return { reason: 'LOCATION_INACTIVE', detail };
        return { reason: 'OTHER', detail };
      }
    }
  }
  return { reason: 'OTHER', detail };
}

@Injectable()
export class CheckInLogService {
  constructor(
    private readonly ops: OpsDbService,
    private readonly loggingService: LoggingService
  ) {}

  /** Never throws: the check-in itself must not fail because the log could not be written. */
  async recordAttempt(input: RecordCheckInAttemptInput): Promise<void> {
    try {
      await this.ops.write(
        client =>
          client.checkInAttempt.create({
            data: {
              clinicId: input.clinicId,
              locationId: input.locationId ?? null,
              appointmentId: input.appointmentId ?? null,
              patientId: input.patientId ?? null,
              patientName: input.patientName ?? null,
              actorUserId: input.actorUserId ?? null,
              actorRole: input.actorRole ?? null,
              method: input.method,
              outcome: input.outcome,
              failureReason: input.outcome === 'FAILED' ? (input.failureReason ?? 'OTHER') : null,
              failureDetail: input.failureDetail ?? null,
              tokenLabel: input.tokenLabel ?? null,
            },
          }),
        {
          actor: { userId: input.actorUserId ?? 'system', role: input.actorRole ?? 'system' },
          clinicId: input.clinicId,
          resourceType: 'CHECK_IN_ATTEMPT',
          operation: 'CREATE',
          details: { method: input.method, outcome: input.outcome },
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        'Could not record check-in attempt',
        SOURCE,
        { clinicId: input.clinicId, error: error instanceof Error ? error.message : String(error) }
      );
    }
  }

  async list(
    clinicId: string,
    filter: {
      date?: string;
      from?: string;
      to?: string;
      locationId?: string;
      outcome?: string;
      method?: string;
      limit?: number;
    }
  ): Promise<CheckInAttemptResponse[]> {
    const where = this.buildWhere(clinicId, filter);
    const rows = await this.ops.read(client =>
      client.checkInAttempt.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(filter.limit ?? 100, 1), 300),
      })
    );
    return this.toResponses(rows);
  }

  /** Failed attempts nobody has resolved yet (defaults to today). */
  async listFailed(
    clinicId: string,
    filter: { date?: string; locationId?: string; includeResolved?: boolean }
  ): Promise<CheckInAttemptResponse[]> {
    const where = this.buildWhere(clinicId, {
      date: filter.date ?? todayIstKey(),
      ...(filter.locationId ? { locationId: filter.locationId } : {}),
      outcome: 'FAILED',
    });
    if (!filter.includeResolved) where['resolution'] = null;
    const rows = await this.ops.read(client =>
      client.checkInAttempt.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 })
    );
    return this.toResponses(rows);
  }

  async summary(clinicId: string, date?: string, locationId?: string): Promise<CheckInLogSummary> {
    const day = date ?? todayIstKey();
    const where = this.buildWhere(clinicId, { date: day, ...(locationId ? { locationId } : {}) });
    const rows = await this.ops.read(client =>
      client.checkInAttempt.findMany({ where, orderBy: { createdAt: 'desc' }, take: 2000 })
    );
    const byMethod: Record<string, number> = {};
    const byFailureReason: Record<string, number> = {};
    let failed = 0;
    let unresolved = 0;
    for (const row of rows) {
      byMethod[row.method] = (byMethod[row.method] ?? 0) + 1;
      if (row.outcome === 'FAILED') {
        failed += 1;
        if (!row.resolution) unresolved += 1;
        const reason = row.failureReason ?? 'OTHER';
        byFailureReason[reason] = (byFailureReason[reason] ?? 0) + 1;
      }
    }
    return {
      date: day,
      total: rows.length,
      succeeded: rows.length - failed,
      failed,
      unresolvedFailures: unresolved,
      byMethod,
      byFailureReason,
    };
  }

  async resolve(
    id: string,
    dto: ResolveCheckInAttemptDto,
    clinicId: string,
    actor: OpsActor
  ): Promise<CheckInAttemptResponse> {
    const existing = await this.ops.read(client =>
      client.checkInAttempt.findFirst({ where: { id, clinicId } })
    );
    if (!existing) throw new NotFoundException('Check-in attempt not found');
    const row = await this.ops.write(
      async client => {
        await client.checkInAttempt.updateMany({
          where: { id, clinicId },
          data: {
            resolution: dto.resolution,
            resolvedById: actor.userId,
            resolvedAt: new Date(),
            resolutionNote: dto.note?.trim() || null,
          },
        });
        return (await client.checkInAttempt.findFirst({ where: { id } })) as CheckInAttemptRow;
      },
      {
        actor,
        clinicId,
        resourceType: 'CHECK_IN_ATTEMPT',
        operation: 'RESOLVE',
        resourceId: id,
        details: { resolution: dto.resolution },
      }
    );
    return (await this.toResponses([row]))[0] as CheckInAttemptResponse;
  }

  /** RECEPTIONIST: always its own location's log (see OpsDbService.locationScope). */
  locationScope(
    actor: OpsActor,
    clinicId: string,
    requested?: string
  ): Promise<string | undefined> {
    return this.ops.locationScope(actor, clinicId, requested);
  }

  private buildWhere(
    clinicId: string,
    filter: {
      date?: string;
      from?: string;
      to?: string;
      locationId?: string;
      outcome?: string;
      method?: string;
    }
  ): Record<string, unknown> {
    const where: Record<string, unknown> = { clinicId };
    const range = filter.date
      ? istCreatedAtRange(filter.date, filter.date)
      : istCreatedAtRange(filter.from, filter.to);
    if (range) where['createdAt'] = range;
    if (filter.locationId) where['locationId'] = filter.locationId;
    if (filter.outcome) where['outcome'] = filter.outcome.toUpperCase();
    if (filter.method) where['method'] = filter.method.toUpperCase();
    return where;
  }

  /** Patient scans only store the actor id; resolve the display name here. */
  private async toResponses(rows: CheckInAttemptRow[]): Promise<CheckInAttemptResponse[]> {
    const needName = [
      ...new Set(
        rows
          .filter(r => !r.patientName && r.actorUserId && r.actorRole === 'PATIENT')
          .map(r => r.actorUserId as string)
      ),
    ];
    const users = needName.length
      ? await this.ops.read(client =>
          client.user.findMany({
            where: { id: { in: needName } },
            select: { id: true, name: true, firstName: true, lastName: true },
          })
        )
      : [];
    const names = new Map(users.map(u => [u.id, displayName(u)]));
    return rows.map(r =>
      this.toResponse(
        r,
        r.patientName ?? (r.actorUserId ? (names.get(r.actorUserId) ?? null) : null)
      )
    );
  }

  private toResponse(r: CheckInAttemptRow, patientName: string | null): CheckInAttemptResponse {
    return {
      id: r.id,
      at: r.createdAt.toISOString(),
      locationId: r.locationId,
      appointmentId: r.appointmentId,
      patientId: r.patientId,
      patientName,
      method: r.method,
      outcome: r.outcome,
      failureReason: r.failureReason,
      failureDetail: r.failureDetail,
      tokenLabel: r.tokenLabel,
      resolution: r.resolution,
      resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
      resolutionNote: r.resolutionNote,
      needsAttention: r.outcome === 'FAILED' && !r.resolution,
    };
  }
}
