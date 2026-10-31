/**
 * Clinic-day audit listener
 * @module ClinicOps
 * @description Writes one ClinicAuditEvent row (through ClinicAuditService) for every check-in,
 * consultation start / completion, completed payment and EHR prescription, whichever code path
 * produced it (reception, QR scan, queue call-next, video end, cron, payment webhook). The rows
 * carry ids only (see clinic-day-audit.util); a failed write never fails the clinical action.
 */

import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventService } from '@infrastructure/events/event.service';
import { LoggingService } from '@infrastructure/logging';
import { LogLevel, LogType } from '@core/types';
import { ClinicAuditService } from './audit.service';
import { OpsDbService } from './ops-db.service';
import {
  CLINIC_DAY_AUDIT_EVENT_NAMES,
  clinicDayAuditKey,
  createRecentKeyGuard,
  resolveClinicDayAudit,
  type ClinicDayAuditIntent,
} from './clinic-day-audit.util';

/** A duplicate announcement of the same transition arrives within milliseconds; 2 min is ample. */
const DEDUPE_WINDOW_MS = 120_000;
const DEDUPE_MAX_KEYS = 5_000;

@Injectable()
export class ClinicDayAuditListener implements OnModuleInit {
  private readonly recent = createRecentKeyGuard(DEDUPE_WINDOW_MS, DEDUPE_MAX_KEYS);

  constructor(
    private readonly eventService: EventService,
    private readonly audit: ClinicAuditService,
    private readonly ops: OpsDbService,
    private readonly loggingService: LoggingService
  ) {}

  onModuleInit(): void {
    for (const eventName of CLINIC_DAY_AUDIT_EVENT_NAMES) {
      this.eventService.on(eventName, (envelope: unknown) => {
        void this.handle(eventName, envelope);
      });
    }
  }

  private async handle(eventName: string, envelope: unknown): Promise<void> {
    const intent = resolveClinicDayAudit(eventName, envelope);
    if (!intent) return;
    // Claimed synchronously, before any await, so the second announcement is dropped even when
    // both arrive in the same tick.
    if (!this.recent.firstSeen(clinicDayAuditKey(intent))) return;
    try {
      const role = intent.actorRole ?? (await this.lookupRole(intent.actorUserId));
      await this.audit.record(
        intent.clinicId,
        { type: intent.entityType, id: intent.entityId },
        intent.action,
        { userId: intent.actorUserId ?? '', role: role ?? '' },
        { ...intent.detail }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.AUDIT,
        LogLevel.WARN,
        'Clinic-day audit event could not be recorded',
        'ClinicDayAuditListener',
        {
          event: eventName,
          clinicId: intent.clinicId,
          entityType: intent.entityType,
          entityId: intent.entityId,
          error: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  /** The actor's role when the event did not carry it (check-in, completion). */
  private async lookupRole(userId: ClinicDayAuditIntent['actorUserId']): Promise<string | null> {
    if (!userId) return null;
    const user = await this.ops.read(client =>
      client.user.findFirst({ where: { id: userId }, select: { id: true, role: true } })
    );
    return user?.role ? String(user.role).toUpperCase() : null;
  }
}
