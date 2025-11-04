/**
 * EVENT-TO-SOCKET BROADCASTER
 * ============================
 * Central service that bridges EventEmitter events to WebSocket broadcasts
 * Automatically propagates events to relevant clients based on roles and permissions
 */

import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SocketService } from '@communication/socket/socket.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';

interface EventPayload {
  userId?: string;
  clinicId?: string;
  appointmentId?: string;
  subscriptionId?: string;
  invoiceId?: string;
  paymentId?: string;
  ehrRecordId?: string;
  roles?: string[];
  [key: string]: string | number | boolean | null | undefined | string[];
}

@Injectable()
export class EventSocketBroadcaster implements OnModuleInit {
  private isEnabled = true;

  // Event patterns that should be broadcasted
  private readonly BROADCASTABLE_EVENTS = [
    'billing.',
    'ehr.',
    'appointment.',
    'user.',
    'clinic.',
    'notification.',
    'payment.',
    'subscription.',
    'invoice.',
  ];

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly socketService: SocketService,
    private readonly loggingService: LoggingService
  ) {}

  onModuleInit(): void {
    if (!this.socketService) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'SocketService not available, event broadcasting disabled',
        'EventSocketBroadcaster'
      );
      this.isEnabled = false;
      return;
    }

    // Subscribe to all events
    this.eventEmitter.onAny(
      (
        event: string | string[],
        payload: Record<string, string | number | boolean | null | undefined | string[]>
      ) => {
        const eventName = Array.isArray(event) ? event.join('.') : event;
        this.handleEvent(eventName, payload);
      }
    );

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Event-to-Socket broadcaster initialized',
      'EventSocketBroadcaster'
    );
  }

  /**
   * Handle event and broadcast to relevant sockets
   */
  private handleEvent(
    event: string,
    payload: Record<string, string | number | boolean | null | undefined | string[]>
  ): void {
    if (!this.isEnabled) return;

    try {
      // Check if event should be broadcasted
      if (!this.shouldBroadcast(event)) {
        return;
      }

      // Extract event data
      const eventData = this.normalizePayload(payload);

      // Determine target rooms
      const rooms = this.determineTargetRooms(event, eventData);

      // Broadcast to all target rooms
      this.broadcastToRooms(event, rooms, eventData);

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
        `Error broadcasting event ${event}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'EventSocketBroadcaster'
      );
    }
  }

  /**
   * Check if event should be broadcasted to sockets
   */
  private shouldBroadcast(event: string): boolean {
    return this.BROADCASTABLE_EVENTS.some(pattern => event.startsWith(pattern));
  }

  /**
   * Normalize payload to standard format
   */
  private normalizePayload(
    payload: Record<string, string | number | boolean | null | undefined | string[]>
  ): EventPayload {
    // Handle both direct payload and wrapped payload
    if (typeof payload === 'object' && payload !== null) {
      return payload as EventPayload;
    }
    return {};
  }

  /**
   * Determine which rooms should receive the event
   */
  private determineTargetRooms(event: string, payload: EventPayload): string[] {
    const rooms: Set<string> = new Set();

    // User-specific room
    if (payload.userId) {
      rooms.add(`user:${payload.userId}`);
    }

    // Clinic-wide room
    if (payload.clinicId) {
      rooms.add(`clinic:${payload.clinicId}`);

      // Role-specific rooms within clinic
      if (this.isAdminEvent(event)) {
        rooms.add(`clinic:${payload.clinicId}:role:CLINIC_ADMIN`);
        rooms.add(`clinic:${payload.clinicId}:role:SUPER_ADMIN`);
      }

      if (this.isDoctorRelevant(event)) {
        rooms.add(`clinic:${payload.clinicId}:role:DOCTOR`);
      }

      if (this.isReceptionistRelevant(event)) {
        rooms.add(`clinic:${payload.clinicId}:role:RECEPTIONIST`);
      }
    }

    // Resource-specific rooms
    if (payload.appointmentId) {
      rooms.add(`appointment:${payload.appointmentId}`);
    }

    if (payload.subscriptionId) {
      rooms.add(`subscription:${payload.subscriptionId}`);
    }

    if (payload.invoiceId) {
      rooms.add(`invoice:${payload.invoiceId}`);
    }

    if (payload.paymentId) {
      rooms.add(`payment:${payload.paymentId}`);
    }

    if (payload.ehrRecordId) {
      rooms.add(`ehr:${payload.ehrRecordId}`);
    }

    return Array.from(rooms);
  }

  /**
   * Check if event is relevant to admins
   */
  private isAdminEvent(event: string): boolean {
    const adminEvents = [
      'billing.',
      'payment.',
      'subscription.',
      'invoice.',
      'clinic.',
      'user.created',
      'user.updated',
      'user.deleted',
    ];

    return adminEvents.some(pattern => event.startsWith(pattern));
  }

  /**
   * Check if event is relevant to doctors
   */
  private isDoctorRelevant(event: string): boolean {
    const doctorEvents = ['appointment.', 'ehr.', 'notification.patient', 'user.patient'];

    return doctorEvents.some(pattern => event.startsWith(pattern));
  }

  /**
   * Check if event is relevant to receptionists
   */
  private isReceptionistRelevant(event: string): boolean {
    const receptionistEvents = ['appointment.', 'notification.appointment', 'user.patient'];

    return receptionistEvents.some(pattern => event.startsWith(pattern));
  }

  /**
   * Broadcast event to multiple rooms
   */
  private broadcastToRooms(event: string, rooms: string[], data: EventPayload): void {
    if (!this.socketService) return;

    for (const room of rooms) {
      try {
        this.socketService.sendToRoom(room, event, {
          ...data,
          timestamp: new Date().toISOString(),
          eventType: event,
        });
      } catch (error) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.ERROR,
          `Failed to broadcast to room ${room}: ${error instanceof Error ? error.message : 'Unknown error'}`,
          'EventSocketBroadcaster'
        );
      }
    }
  }

  /**
   * Manually broadcast an event (for testing or special cases)
   */
  broadcastEvent(event: string, payload: EventPayload, rooms?: string[]): void {
    if (!this.isEnabled) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Event broadcasting is disabled',
        'EventSocketBroadcaster'
      );
      return;
    }

    const targetRooms = rooms || this.determineTargetRooms(event, payload);
    this.broadcastToRooms(event, targetRooms, payload);
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
