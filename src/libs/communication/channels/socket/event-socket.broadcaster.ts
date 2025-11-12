/**
 * EVENT-TO-SOCKET BROADCASTER
 * ============================
 * Central service that bridges EventEmitter events to WebSocket broadcasts
 * Automatically propagates events to relevant clients based on roles and permissions
 */

import { Injectable, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { SocketService } from '@communication/channels/socket/socket.service';
import { LoggingService } from '@infrastructure/logging';
import { EventService } from '@infrastructure/events';
import {
  LogType,
  LogLevel,
  type IEventService,
  isEventService,
  type EnterpriseEventPayload,
} from '@core/types';

interface EventPayload {
  userId?: string | undefined;
  clinicId?: string | undefined;
  appointmentId?: string | undefined;
  subscriptionId?: string | undefined;
  invoiceId?: string | undefined;
  paymentId?: string | undefined;
  ehrRecordId?: string | undefined;
  roles?: string[] | undefined;
  [key: string]: string | number | boolean | null | undefined | string[];
}

@Injectable()
export class EventSocketBroadcaster implements OnModuleInit {
  private isEnabled = true;
  private typedEventService?: IEventService;

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
    'communication.',
  ];

  constructor(
    @Inject(forwardRef(() => EventService))
    private readonly eventService: unknown,
    private readonly socketService: SocketService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
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

    // Subscribe to all events using EventService's onAny() method
    // This ensures we're listening to events emitted through the centralized EventService
    // EventService is the single source of truth for all event emissions
    this.typedEventService.onAny((event: string | string[], ...args: unknown[]) => {
      const eventName = Array.isArray(event) ? event.join('.') : event;
      const payload = args[0] as EnterpriseEventPayload | Record<string, unknown> | undefined;

      // Handle both simple and enterprise event formats
      if (payload && typeof payload === 'object' && 'eventType' in payload) {
        // Enterprise event payload
        const enterprisePayload = payload as EnterpriseEventPayload;
        this.handleEvent(enterprisePayload.eventType || eventName, enterprisePayload);
      } else if (payload) {
        // Simple payload
        this.handleEvent(eventName, payload);
      } else {
        // No payload
        this.handleEvent(eventName, {});
      }
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
   * Handle event and broadcast to relevant sockets
   * Supports both EnterpriseEventPayload and plain object payloads
   */
  private handleEvent(
    event: string,
    payload: EnterpriseEventPayload | Record<string, unknown>
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
   * Handles both EnterpriseEventPayload and plain object payloads
   */
  private normalizePayload(
    payload: EnterpriseEventPayload | Record<string, unknown>
  ): EventPayload {
    // If it's an EnterpriseEventPayload, extract relevant fields
    if (payload && typeof payload === 'object' && 'eventType' in payload) {
      const enterprisePayload = payload as EnterpriseEventPayload;
      const eventPayload: EventPayload = {};

      // Set defined properties only
      if (enterprisePayload.userId) {
        eventPayload.userId = enterprisePayload.userId;
      }
      if (enterprisePayload.clinicId) {
        eventPayload.clinicId = enterprisePayload.clinicId;
      }

      // Extract metadata properties
      if (enterprisePayload.metadata) {
        const appointmentId = enterprisePayload.metadata['appointmentId'];
        if (appointmentId && typeof appointmentId === 'string') {
          eventPayload.appointmentId = appointmentId;
        }

        const subscriptionId = enterprisePayload.metadata['subscriptionId'];
        if (subscriptionId && typeof subscriptionId === 'string') {
          eventPayload.subscriptionId = subscriptionId;
        }

        const invoiceId = enterprisePayload.metadata['invoiceId'];
        if (invoiceId && typeof invoiceId === 'string') {
          eventPayload.invoiceId = invoiceId;
        }

        const paymentId = enterprisePayload.metadata['paymentId'];
        if (paymentId && typeof paymentId === 'string') {
          eventPayload.paymentId = paymentId;
        }

        const ehrRecordId = enterprisePayload.metadata['ehrRecordId'];
        if (ehrRecordId && typeof ehrRecordId === 'string') {
          eventPayload.ehrRecordId = ehrRecordId;
        }

        const roles = enterprisePayload.metadata['roles'];
        if (roles && Array.isArray(roles)) {
          eventPayload.roles = roles as string[];
        }

        // Add remaining metadata properties that match EventPayload index signature
        for (const [key, value] of Object.entries(enterprisePayload.metadata)) {
          if (
            ![
              'appointmentId',
              'subscriptionId',
              'invoiceId',
              'paymentId',
              'ehrRecordId',
              'roles',
            ].includes(key) &&
            (typeof value === 'string' ||
              typeof value === 'number' ||
              typeof value === 'boolean' ||
              value === null ||
              Array.isArray(value))
          ) {
            (eventPayload as Record<string, unknown>)[key] = value;
          }
        }
      }

      return eventPayload;
    }
    // Handle plain object payload
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

    // Convert EventPayload to SocketEventData by filtering out undefined values
    const socketData: Record<
      string,
      string | number | boolean | null | string[] | Record<string, string | number | boolean | null>
    > = {
      timestamp: new Date().toISOString(),
      eventType: event,
    };

    // Add defined properties only (SocketEventData doesn't allow undefined)
    if (data.userId !== undefined) {
      socketData['userId'] = data.userId;
    }
    if (data.clinicId !== undefined) {
      socketData['clinicId'] = data.clinicId;
    }
    if (data.appointmentId !== undefined) {
      socketData['appointmentId'] = data.appointmentId;
    }
    if (data.subscriptionId !== undefined) {
      socketData['subscriptionId'] = data.subscriptionId;
    }
    if (data.invoiceId !== undefined) {
      socketData['invoiceId'] = data.invoiceId;
    }
    if (data.paymentId !== undefined) {
      socketData['paymentId'] = data.paymentId;
    }
    if (data.ehrRecordId !== undefined) {
      socketData['ehrRecordId'] = data.ehrRecordId;
    }
    if (data.roles !== undefined) {
      socketData['roles'] = data.roles;
    }

    // Add other properties from index signature
    for (const [key, value] of Object.entries(data)) {
      if (
        ![
          'userId',
          'clinicId',
          'appointmentId',
          'subscriptionId',
          'invoiceId',
          'paymentId',
          'ehrRecordId',
          'roles',
        ].includes(key) &&
        (typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean' ||
          value === null ||
          Array.isArray(value) ||
          (typeof value === 'object' && value !== null))
      ) {
        socketData[key] = value as
          | string
          | number
          | boolean
          | null
          | string[]
          | Record<string, string | number | boolean | null>;
      }
    }

    for (const room of rooms) {
      try {
        this.socketService.sendToRoom(room, event, socketData);
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
