import { nowIso } from '@utils/date-time.util';
/**
 * EVENT-TO-SOCKET BROADCASTER
 * ============================
 * Bridges EventService events to WebSocket clients.
 *
 * Security model (see socket-room-policy.ts):
 *  - Payloads are slim: event type, ids, status, version/timestamp. No nested appointment /
 *    payment / patient objects; clients refetch over HTTP, which applies RBAC + redaction.
 *  - `clinic:<id>` only contains staff. A patient gets their own updates on
 *    `user:<patientUserId>`, resolved from the event or (once, cached) from the appointment.
 *  - One emit per event to the union of rooms, so nobody receives duplicates.
 */

import { Injectable, OnModuleInit, Inject, Optional, forwardRef } from '@nestjs/common';
import { SocketService } from '@communication/channels/socket/socket.service';
// Use direct imports to avoid TDZ issues with barrel exports
import { LoggingService } from '@infrastructure/logging/logging.service';
import { EventService } from '@infrastructure/events/event.service';
// Type-only + alias token: a value import of DatabaseService here risks SWC TDZ import cycles.
import type { DatabaseService } from '@infrastructure/database/database.service';
import type { Prisma } from '@infrastructure/database/prisma/generated/client';
import { LogType, LogLevel, type IEventService, isEventService } from '@core/types';
import {
  buildSlimSocketPayload,
  determineTargetRooms,
  isPatientScopedEvent,
  summarizeEvent,
  type SocketEventIds,
  type SocketEventSummary,
} from '@communication/channels/socket/socket-room-policy';
import type { SocketEventData } from '@communication/channels/socket/socket-relay.util';

interface PatientRouting {
  patientUserId?: string;
  clinicId?: string;
}

interface CachedPatientRouting extends PatientRouting {
  expiresAt: number;
}

/** Appointment -> patient routing rarely changes; keep a small bounded in-memory cache. */
const ROUTING_CACHE_TTL_MS = 10 * 60 * 1000;
const ROUTING_CACHE_MAX_ENTRIES = 5000;

@Injectable()
export class EventSocketBroadcaster implements OnModuleInit {
  private isEnabled = true;
  private typedEventService?: IEventService;
  private readonly routingCache = new Map<string, CachedPatientRouting>();

  // Event patterns that should be broadcasted
  private readonly BROADCASTABLE_EVENTS = [
    'billing.',
    'ehr.',
    'appointment.',
    'doctor.availability.',
    'doctor.clinic.',
    'user.',
    'clinic.',
    'notification.',
    'payment.',
    'subscription.',
    'invoice.',
    'communication.',
    // Bare 'queue.*' events (e.g. queue.metrics.updated): the frontend listens for them on the
    // default namespace (useWebSocketIntegration.ts).
    'queue.',
  ];

  constructor(
    @Inject(forwardRef(() => EventService))
    private readonly eventService: unknown,
    @Inject(forwardRef(() => SocketService))
    private readonly socketService: SocketService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Optional()
    @Inject('DATABASE_SERVICE')
    private readonly databaseService?: DatabaseService
  ) {
    // Type guard ensures type safety when using the service
    if (!isEventService(this.eventService)) {
      throw new Error('EventService is not available or invalid');
    }
    this.typedEventService = this.eventService;
  }

  async onModuleInit(): Promise<void> {
    if (!this.socketService) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'SocketService not available, event broadcasting disabled',
        'EventSocketBroadcaster'
      );
      this.isEnabled = false;
      return;
    }

    if (!this.typedEventService) {
      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'EventService not available, event broadcasting disabled',
        'EventSocketBroadcaster'
      );
      this.isEnabled = false;
      return;
    }

    // EventService is the single source of truth for all event emissions.
    this.typedEventService.onAny((event: string | string[], ...args: unknown[]) => {
      const eventName = Array.isArray(event) ? event.join('.') : event;
      const payload = args[0];
      const record =
        payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : undefined;
      const eventType =
        record && typeof record['eventType'] === 'string' ? record['eventType'] : eventName;
      void this.handleEvent(eventType, payload);
    });

    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Event-to-Socket broadcaster initialized - listening to centralized EventService',
      'EventSocketBroadcaster',
      {
        broadcastablePatterns: this.BROADCASTABLE_EVENTS.length,
      }
    );
  }

  /**
   * Summarise the event, resolve the patient's user room if needed, and emit ONE slim payload
   * to the union of target rooms.
   */
  private async handleEvent(event: string, payload: unknown): Promise<void> {
    if (!this.isEnabled || !this.shouldBroadcast(event)) return;

    try {
      const summary = await this.withPatientRouting(event, summarizeEvent(payload));
      const rooms = determineTargetRooms(event, summary.ids);
      const socketData = buildSlimSocketPayload(event, summary, nowIso());

      // Availability changes are delivered through room targeting. Keep the global broadcast
      // (slim, PHI-free) only as a fallback when no rooms can be resolved.
      if (event.startsWith('doctor.availability.') && rooms.length === 0) {
        this.socketService.broadcast(event, socketData);
        return;
      }

      this.emitToRooms(event, rooms, socketData);
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Error broadcasting event ${event}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'EventSocketBroadcaster'
      );
    }
  }

  private shouldBroadcast(event: string): boolean {
    return this.BROADCASTABLE_EVENTS.some(pattern => event.startsWith(pattern));
  }

  /**
   * Patient-scoped events often carry only appointmentId/patientId (and some lack clinicId,
   * e.g. appointment.queue.position.updated). Fill the patient's user id and the clinic from
   * the appointment / patient record so the patient's own room and the staff room are reached.
   */
  private async withPatientRouting(
    event: string,
    summary: SocketEventSummary
  ): Promise<SocketEventSummary> {
    const { ids } = summary;
    if (!isPatientScopedEvent(event) || (ids.patientUserId && ids.clinicId)) {
      return summary;
    }
    const routing = await this.resolvePatientRouting(ids);
    if (!routing) {
      return summary;
    }
    const merged: SocketEventIds = { ...ids };
    if (!merged.patientUserId && routing.patientUserId) {
      merged.patientUserId = routing.patientUserId;
    }
    if (!merged.clinicId && routing.clinicId) {
      merged.clinicId = routing.clinicId;
    }
    return { ...summary, ids: merged };
  }

  private async resolvePatientRouting(ids: SocketEventIds): Promise<PatientRouting | null> {
    if (!this.databaseService) return null;
    const cacheKey = ids.appointmentId
      ? `appointment:${ids.appointmentId}`
      : ids.patientId
        ? `patient:${ids.patientId}`
        : null;
    if (!cacheKey) return null;

    const cached = this.routingCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached;
    }

    try {
      const routing = ids.appointmentId
        ? await this.lookupAppointmentRouting(ids.appointmentId)
        : await this.lookupPatientRouting(ids.patientId as string);
      this.rememberRouting(cacheKey, routing ?? {});
      return routing;
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        `Socket routing lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'EventSocketBroadcaster',
        { cacheKey }
      );
      return null;
    }
  }

  private async lookupAppointmentRouting(appointmentId: string): Promise<PatientRouting | null> {
    const row = await this.databaseService!.executeHealthcareRead(async client => {
      const typedClient = client as unknown as Prisma.TransactionClient;
      return await typedClient.appointment.findUnique({
        where: { id: appointmentId },
        select: { clinicId: true, patient: { select: { userId: true } } },
      });
    });
    if (!row) return null;
    return {
      clinicId: row.clinicId,
      ...(row.patient?.userId ? { patientUserId: row.patient.userId } : {}),
    };
  }

  private async lookupPatientRouting(patientId: string): Promise<PatientRouting | null> {
    const row = await this.databaseService!.executeHealthcareRead(async client => {
      const typedClient = client as unknown as Prisma.TransactionClient;
      return await typedClient.patient.findUnique({
        where: { id: patientId },
        select: { userId: true },
      });
    });
    return row?.userId ? { patientUserId: row.userId } : null;
  }

  private rememberRouting(key: string, routing: PatientRouting): void {
    if (this.routingCache.size >= ROUTING_CACHE_MAX_ENTRIES) {
      const oldestKey = this.routingCache.keys().next().value;
      if (oldestKey !== undefined) this.routingCache.delete(oldestKey);
    }
    this.routingCache.set(key, { ...routing, expiresAt: Date.now() + ROUTING_CACHE_TTL_MS });
  }

  /** One emit to the union of rooms (no duplicates for sockets in several rooms). */
  private emitToRooms(event: string, rooms: string[], socketData: SocketEventData): void {
    if (!this.socketService || rooms.length === 0) return;
    try {
      this.socketService.sendToRooms(rooms, event, socketData);
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        `Broadcasted event ${event} to ${rooms.length} rooms`,
        'EventSocketBroadcaster',
        { rooms }
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.ERROR,
        `Failed to broadcast ${event}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'EventSocketBroadcaster'
      );
    }
  }

  /**
   * Manually broadcast an event (for testing or special cases). The payload is slimmed the
   * same way as bridged events.
   */
  broadcastEvent(event: string, payload: Record<string, unknown>, rooms?: string[]): void {
    if (!this.isEnabled) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Event broadcasting is disabled',
        'EventSocketBroadcaster'
      );
      return;
    }

    const summary = summarizeEvent(payload);
    const targetRooms = rooms ?? determineTargetRooms(event, summary.ids);
    this.emitToRooms(event, targetRooms, buildSlimSocketPayload(event, summary, nowIso()));
  }

  /**
   * Enable event broadcasting
   */
  enable(): void {
    this.isEnabled = true;
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Event broadcasting enabled',
      'EventSocketBroadcaster'
    );
  }

  /**
   * Disable event broadcasting
   */
  disable(): void {
    this.isEnabled = false;
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Event broadcasting disabled',
      'EventSocketBroadcaster'
    );
  }

  /**
   * Get broadcasting status
   */
  isActive(): boolean {
    return this.isEnabled;
  }
}
