/**
 * Event-driven "2 ahead" / "you're next" alerts of the live in-person queue.
 *
 * Every queue mutation of AppointmentQueueService (check-in, confirm, call-next, start, remove /
 * no-show / cancel, priority, reorder, transfer, resume) emits `appointment.queue.updated` for one
 * doctor line, in the API or in the worker (queue jobs). This service hooks that one event, so no
 * mutation point needs its own call: it reads the doctor's live list (one cache LRANGE), picks the
 * waiting patients that crossed a threshold (pure, queue-notify.util), checks them against the
 * database in ONE batched read (in person, still waiting, Patient -> User), claims a per
 * appointment + threshold key (SET NX, expires at the end of the IST day) and emits
 * `appointment.queue.patient_alert`. The notification listener delivers it in-app + push with the
 * user's preferences and quiet hours.
 *
 * The worker's minute cron (InPersonQueueMaintenanceService) is the safety net for changes that
 * reach the list without an event (e.g. the 5-minute reconcile); it goes through `alertEntries`
 * too, so the same keys guarantee one message per appointment and threshold, whoever is first.
 * Reads (polling, sockets, getPatientQueuePosition) never alert. Never throws.
 */
import { Inject, Injectable, Optional, forwardRef } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DatabaseService } from '@infrastructure/database';
import { CacheService } from '@infrastructure/cache/cache.service';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events/event.service';
import { AppointmentQueueService } from '@infrastructure/queue';
import { EventCategory, EventPriority, LogLevel, LogType } from '@core/types';
import type { EnterpriseEventPayload } from '@core/types';
import type { QueueEntryData } from '@core/types/appointment.types';
import { nowIso, formatDateKeyInIST } from '@utils/date-time.util';
import { formatDoctorName } from '@services/billing/invoice-description.util';
import {
  QUEUE_PATIENT_ALERT_EVENT,
  type QueuePatientAlertMetadata,
} from '@communication/listeners/queue-patient-alert.util';
import {
  IN_PERSON_QUEUE_DOMAIN,
  claimQueueAlert,
  queueAlertTtlSeconds,
  queueLineOfEvent,
  queueNotifyMessage,
  selectAlertableNotifications,
  selectQueueNotifications,
  type QueueAlertRow,
  type QueueNotification,
  type QueueNotifyEntry,
  type QueuePatientAlert,
  type QueueUpdatedEnvelope,
} from '@services/appointments/in-person/queue-notify.util';

const SOURCE = 'QueuePatientAlertService';

interface AlertAppointmentRow {
  id: string;
  status: string;
  type: string;
  userId: string | null;
  patient: { user: { id: string } | null } | null;
  doctor: {
    user: { name: string | null; firstName: string | null; lastName: string | null } | null;
  } | null;
}

interface AlertReadClient {
  appointment: {
    findMany: (args: {
      where: { id: { in: string[] }; clinicId: string };
      select: Record<string, boolean | object>;
    }) => Promise<AlertAppointmentRow[]>;
  };
}

function doctorNameOf(row: AlertAppointmentRow): string | null {
  const user = row.doctor?.user;
  const name =
    user?.name?.trim() || [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
  return formatDoctorName(name) || null;
}

function toAlertRow(row: AlertAppointmentRow): QueueAlertRow {
  return {
    id: row.id,
    status: row.status,
    type: row.type,
    recipientUserId: row.patient?.user?.id || row.userId || null,
    doctorName: doctorNameOf(row),
  };
}

@Injectable()
export class QueuePatientAlertService {
  constructor(
    @Inject(forwardRef(() => DatabaseService))
    private readonly database: DatabaseService,
    @Inject(forwardRef(() => CacheService))
    private readonly cache: CacheService,
    @Inject(forwardRef(() => LoggingService))
    private readonly logging: LoggingService,
    @Inject(forwardRef(() => AppointmentQueueService))
    private readonly queue: AppointmentQueueService,
    @Optional()
    @Inject(forwardRef(() => EventService))
    private readonly events?: EventService
  ) {}

  /** One queue mutation: re-check that doctor's line (off the request path). */
  @OnEvent('appointment.queue.updated')
  onQueueUpdated(event: QueueUpdatedEnvelope): void {
    const now = new Date();
    const line = queueLineOfEvent(event, formatDateKeyInIST(now));
    if (!line) return;
    void this.alertDoctorLine(line.clinicId, line.ownerId, now);
  }

  /** Alerts due on one doctor's live line today; how many were emitted. Never throws. */
  async alertDoctorLine(
    clinicId: string,
    ownerId: string,
    now: Date = new Date()
  ): Promise<number> {
    try {
      const day = formatDateKeyInIST(now);
      const entries: QueueEntryData[] = await this.queue.getOperationalQueue(
        ownerId,
        clinicId,
        IN_PERSON_QUEUE_DOMAIN,
        day
      );
      return await this.alertEntries(clinicId, entries, now);
    } catch (error) {
      this.logFailure(
        'Queue patient alerts failed',
        error instanceof Error ? error : new Error(String(error)),
        { clinicId, doctorId: ownerId }
      );
      return 0;
    }
  }

  /**
   * Alerts due on live entries already in serving order (one doctor line, or a whole clinic for
   * the cron). Paused lines are skipped; one database read for every candidate. Never throws.
   */
  async alertEntries(
    clinicId: string,
    entries: readonly QueueNotifyEntry[],
    now: Date = new Date(),
    averageConsultMinutes?: number
  ): Promise<number> {
    try {
      const due = await this.withoutPausedLines(
        clinicId,
        selectQueueNotifications(entries, averageConsultMinutes),
        formatDateKeyInIST(now)
      );
      if (due.length === 0) return 0;
      const rows = await this.loadAlertRows(
        clinicId,
        due.map(item => item.appointmentId)
      );
      const ttlSeconds = queueAlertTtlSeconds(now);
      let emitted = 0;
      for (const alert of selectAlertableNotifications(due, rows)) {
        if (await this.claim(alert, ttlSeconds)) {
          await this.emitAlert(clinicId, alert);
          emitted += 1;
        }
      }
      return emitted;
    } catch (error) {
      this.logFailure(
        'Queue patient alerts failed',
        error instanceof Error ? error : new Error(String(error)),
        { clinicId }
      );
      return 0;
    }
  }

  // ------------------------------------------------------------------ helpers

  private async withoutPausedLines(
    clinicId: string,
    due: readonly QueueNotification[],
    day: string
  ): Promise<QueueNotification[]> {
    if (due.length === 0) return [];
    const paused = new Set<string>();
    for (const doctorId of new Set(due.map(item => item.doctorId).filter(Boolean))) {
      if (!doctorId) continue;
      const status = await this.queue.getQueuePauseStatus(
        doctorId,
        clinicId,
        day,
        IN_PERSON_QUEUE_DOMAIN
      );
      if (status === 'PAUSED') paused.add(doctorId);
    }
    return due.filter(item => !item.doctorId || !paused.has(item.doctorId));
  }

  /** The appointment facts of every candidate in one read, scoped to the clinic. */
  private async loadAlertRows(
    clinicId: string,
    appointmentIds: readonly string[]
  ): Promise<QueueAlertRow[]> {
    const rows = await this.database.executeHealthcareRead<AlertAppointmentRow[]>(async client =>
      (client as object as AlertReadClient).appointment.findMany({
        where: { id: { in: [...new Set(appointmentIds)] }, clinicId },
        select: {
          id: true,
          status: true,
          type: true,
          userId: true,
          patient: { select: { user: { select: { id: true } } } },
          doctor: { select: { user: { select: { name: true, firstName: true, lastName: true } } } },
        },
      })
    );
    return rows.map(toAlertRow);
  }

  /** SET NX of the message's key (and NEAR's too for NEXT); false when already sent. */
  private async claim(alert: QueuePatientAlert, ttlSeconds: number): Promise<boolean> {
    return await claimQueueAlert(
      (key, ttl) => this.cache.acquireLock(key, ttl),
      alert.appointmentId,
      alert.threshold,
      ttlSeconds
    );
  }

  private async emitAlert(clinicId: string, alert: QueuePatientAlert): Promise<void> {
    const message = queueNotifyMessage(alert, alert.doctorName);
    const metadata: QueuePatientAlertMetadata = {
      appointmentId: alert.appointmentId,
      clinicId,
      doctorId: alert.doctorId ?? '',
      patientUserId: alert.recipientUserId,
      threshold: alert.threshold,
      peopleAhead: alert.peopleAhead,
      position: alert.peopleAhead + 1,
      token: alert.token,
      doctorName: alert.doctorName,
      title: message.title,
      body: message.body,
    };
    if (!this.events) {
      void this.logging.log(
        LogType.NOTIFICATION,
        LogLevel.WARN,
        'Queue alert not emitted',
        SOURCE,
        {
          appointmentId: alert.appointmentId,
          threshold: alert.threshold,
          reason: 'EventService unavailable',
        }
      );
      return;
    }
    const envelope: EnterpriseEventPayload = {
      eventId: `queue-patient-alert-${alert.appointmentId}-${alert.threshold}`,
      eventType: QUEUE_PATIENT_ALERT_EVENT,
      category: EventCategory.APPOINTMENT,
      priority: EventPriority.HIGH,
      timestamp: nowIso(),
      source: SOURCE,
      version: '1.0.0',
      userId: alert.recipientUserId,
      clinicId,
      metadata: { ...metadata },
    };
    await this.events.emitEnterprise(QUEUE_PATIENT_ALERT_EVENT, envelope);
    void this.logging.log(
      LogType.NOTIFICATION,
      LogLevel.INFO,
      'Queue patient alert emitted',
      SOURCE,
      {
        appointmentId: alert.appointmentId,
        clinicId,
        threshold: alert.threshold,
        peopleAhead: alert.peopleAhead,
      }
    );
  }

  private logFailure(message: string, error: Error, context: object): void {
    void this.logging.log(LogType.ERROR, LogLevel.WARN, `${message}: ${error.message}`, SOURCE, {
      ...context,
      error: error.stack,
    });
  }
}
