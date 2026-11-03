/**
 * Clinic Audit Service
 * @module ClinicOps
 * @description Append-only trail of operational actions (queue priority, leave decisions, ...)
 * that the clinic admin can review. Writing never fails the action that triggered it.
 */

import { Injectable } from '@nestjs/common';
import { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';
import { OpsDbService, type OpsActor } from './ops-db.service';
import { displayName, istCreatedAtRange } from '../clinic-ops.types';

export interface AuditEventResponse {
  id: string;
  at: string;
  entityType: string;
  entityId: string;
  action: string;
  actorUserId: string | null;
  actorName: string | null;
  actorRole: string | null;
  detail: unknown;
}

@Injectable()
export class ClinicAuditService {
  constructor(
    private readonly ops: OpsDbService,
    private readonly loggingService: LoggingService
  ) {}

  async record(
    clinicId: string,
    entity: { type: string; id: string },
    action: string,
    actor: OpsActor,
    detail?: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.ops.write(
        client =>
          client.clinicAuditEvent.create({
            data: {
              clinicId,
              entityType: entity.type,
              entityId: entity.id,
              action,
              actorUserId: actor.userId || null,
              actorRole: actor.role || null,
              detail: detail ?? null,
            },
          }),
        {
          actor,
          clinicId,
          resourceType: 'CLINIC_AUDIT_EVENT',
          operation: 'CREATE',
          resourceId: entity.id,
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        'Could not write audit event',
        'ClinicAuditService',
        {
          clinicId,
          entityType: entity.type,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  async list(
    clinicId: string,
    filter: { entityType?: string; entityId?: string; from?: string; to?: string; limit?: number }
  ): Promise<AuditEventResponse[]> {
    const where: Record<string, unknown> = { clinicId };
    if (filter.entityType) where['entityType'] = filter.entityType.toUpperCase();
    if (filter.entityId) where['entityId'] = filter.entityId;
    const range = istCreatedAtRange(filter.from, filter.to);
    if (range) where['createdAt'] = range;
    const rows = await this.ops.read(client =>
      client.clinicAuditEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(filter.limit ?? 100, 1), 300),
      })
    );
    const actorIds = [...new Set(rows.map(r => r.actorUserId).filter((v): v is string => !!v))];
    const users = actorIds.length
      ? await this.ops.read(client =>
          client.user.findMany({
            where: { id: { in: actorIds } },
            select: { id: true, name: true, firstName: true, lastName: true },
          })
        )
      : [];
    const names = new Map(users.map(u => [u.id, displayName(u)]));
    return rows.map(r => ({
      id: r.id,
      at: r.createdAt.toISOString(),
      entityType: r.entityType,
      entityId: r.entityId,
      action: r.action,
      actorUserId: r.actorUserId,
      actorName: r.actorUserId ? (names.get(r.actorUserId) ?? null) : null,
      actorRole: r.actorRole,
      detail: r.detail ?? null,
    }));
  }
}
