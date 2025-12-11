/**
 * OpenVidu Webhook Service
 * @class OpenViduWebhookService
 * @description Processes OpenVidu webhook events and forwards them to Socket.IO for real-time updates
 *
 * This service implements the optimized architecture:
 * - OpenVidu webhooks (HTTP) → Backend → Socket.IO (WebSocket) → Frontend
 * - Reduces Socket.IO load by using webhooks for video session events
 * - Maintains real-time UX by forwarding events via Socket.IO
 */

import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { SocketService, type SocketEventData } from '@communication/channels/socket/socket.service';
import * as crypto from 'crypto';
import { EventService } from '@infrastructure/events';
import { LoggingService } from '@infrastructure/logging';
import { DatabaseService } from '@infrastructure/database';
import {
  LogType,
  LogLevel,
  EventCategory,
  EventPriority,
  type EnterpriseEventPayload,
} from '@core/types';
import type { OpenViduWebhookPayload, ConsultationInfo } from '@core/types/video.types';
import { isVideoCallAppointment } from '@core/types/appointment-guards.types';

@Injectable()
export class OpenViduWebhookService {
  constructor(
    private readonly socketService: SocketService,
    private readonly eventService: EventService,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => DatabaseService))
    private readonly databaseService: DatabaseService
  ) {}

  /**
   * Process OpenVidu webhook event
   * Extracts appointment info, forwards to Socket.IO, and emits to EventService
   */
  async processWebhookEvent(payload: OpenViduWebhookPayload): Promise<void> {
    try {
      // Extract consultation info from session ID
      const consultationInfo = await this.extractConsultationInfo(payload.sessionId);

      if (!consultationInfo) {
        await this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.WARN,
          `Could not extract consultation info from session ID: ${payload.sessionId}`,
          'OpenViduWebhookService',
          { sessionId: payload.sessionId, event: payload.event }
        );
        return;
      }

      // Forward to Socket.IO for real-time frontend updates
      await this.forwardToSocketIO(payload, consultationInfo);

      // Emit to EventService for other listeners (audit, analytics, etc.)
      await this.emitToEventService(payload, consultationInfo);

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        `Processed OpenVidu webhook event: ${payload.event}`,
        'OpenViduWebhookService',
        {
          event: payload.event,
          sessionId: payload.sessionId,
          appointmentId: consultationInfo.appointmentId,
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to process OpenVidu webhook event: ${error instanceof Error ? error.message : String(error)}`,
        'OpenViduWebhookService',
        {
          error: error instanceof Error ? error.message : String(error),
          payload,
        }
      );
      throw error;
    }
  }

  /**
   * Extract consultation information from OpenVidu session ID
   * Session IDs follow pattern: appointment-{appointmentId}-{hash}
   * OpenVidu uses customSessionId which becomes the session ID
   */
  private async extractConsultationInfo(sessionId: string): Promise<ConsultationInfo | null> {
    try {
      // Parse session ID: appointment-{appointmentId}-{hash}
      // Example: "appointment-123e4567-e89b-12d3-a456-426614174000-a1b2c3d4"
      const match = sessionId.match(/^appointment-([^-]+(?:-[^-]+)*?)-[a-f0-9]{8}$/i);
      if (!match || !match[1]) {
        // Try simpler pattern: appointment-{appointmentId}-{hash}
        const simpleMatch = sessionId.match(/^appointment-([^-]+)-/);
        if (!simpleMatch || !simpleMatch[1]) {
          return null;
        }
        return { appointmentId: simpleMatch[1] };
      }

      const appointmentId = match[1];

      // Fetch appointment from database to get clinic and user info
      try {
        // Use DatabaseService.findAppointmentByIdSafe for consistency
        const appointment = await this.databaseService.findAppointmentByIdSafe(appointmentId);

        if (!appointment) {
          return { appointmentId };
        }

        // Determine user role based on appointment type
        const isVideoCall = isVideoCallAppointment(appointment);

        const userId: string | undefined = appointment.patientId || appointment.doctorId;
        const result: ConsultationInfo = {
          appointmentId,
          clinicId: appointment.clinicId,
          userRole: isVideoCall ? 'patient' : 'doctor',
        };
        if (userId) {
          result.userId = userId;
        }
        return result;
      } catch (dbError) {
        // If database query fails, return basic info
        await this.loggingService.log(
          LogType.ERROR,
          LogLevel.WARN,
          `Failed to fetch appointment details: ${dbError instanceof Error ? dbError.message : String(dbError)}`,
          'OpenViduWebhookService',
          { appointmentId }
        );
        return { appointmentId };
      }
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to extract consultation info: ${error instanceof Error ? error.message : String(error)}`,
        'OpenViduWebhookService',
        { sessionId, error: error instanceof Error ? error.message : String(error) }
      );
      return null;
    }
  }

  /**
   * Forward webhook event to Socket.IO for real-time frontend updates
   */
  private async forwardToSocketIO(
    payload: OpenViduWebhookPayload,
    consultationInfo: ConsultationInfo
  ): Promise<void> {
    try {
      const room = `consultation_${consultationInfo.appointmentId}`;
      const socketEvent = this.mapWebhookToSocketEvent(payload, consultationInfo);

      // Send to Socket.IO room for real-time updates
      this.socketService.sendToRoom(room, 'openvidu_event', socketEvent);

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        `Forwarded OpenVidu event to Socket.IO room: ${room}`,
        'OpenViduWebhookService',
        {
          event: payload.event,
          room,
          appointmentId: consultationInfo.appointmentId,
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to forward to Socket.IO: ${error instanceof Error ? error.message : String(error)}`,
        'OpenViduWebhookService',
        {
          error: error instanceof Error ? error.message : String(error),
          payload,
        }
      );
      // Don't throw - webhook processing should continue even if Socket.IO fails
    }
  }

  /**
   * Map OpenVidu webhook event to Socket.IO event format
   */
  private mapWebhookToSocketEvent(
    payload: OpenViduWebhookPayload,
    consultationInfo: ConsultationInfo
  ): SocketEventData {
    // Map OpenVidu event types to consultation event types
    const eventTypeMap: Record<string, string> = {
      sessionCreated: 'status_changed',
      sessionDestroyed: 'status_changed',
      participantJoined: 'participant_joined',
      participantLeft: 'participant_left',
      recordingStarted: 'recording_started',
      recordingStopped: 'recording_stopped',
      webrtcConnectionCreated: 'connection_quality_update',
      webrtcConnectionDestroyed: 'connection_quality_update',
    };

    const consultationEventType: string = eventTypeMap[payload.event] || payload.event;

    // Convert to SocketEventData (only allows primitives, arrays of primitives, or nested records of primitives)
    // Build object explicitly to satisfy ESLint's type checker
    // Use bracket notation for all properties since SocketEventData is a Record type
    const socketEventData: SocketEventData = {
      ['type']: consultationEventType,
      ['appointmentId']: consultationInfo.appointmentId,
      ['sessionId']: payload.sessionId,
      ['timestamp']: new Date(payload.timestamp).toISOString(),
      ['event']: payload.event,
    };

    // Add optional fields explicitly (use bracket notation for index signature)
    if (payload.participantId) {
      socketEventData['participantId'] = payload.participantId;
    }
    if (payload.connectionId) {
      socketEventData['connectionId'] = payload.connectionId;
    }
    if (payload.reason) {
      socketEventData['reason'] = payload.reason;
    }
    if (consultationInfo.clinicId) {
      socketEventData['clinicId'] = consultationInfo.clinicId;
    }
    if (consultationInfo.userId) {
      socketEventData['userId'] = consultationInfo.userId;
    }
    if (consultationInfo.userRole) {
      socketEventData['userRole'] = consultationInfo.userRole;
    }

    return socketEventData;
  }

  /**
   * Emit webhook event to EventService for other listeners
   */
  private async emitToEventService(
    payload: OpenViduWebhookPayload,
    consultationInfo: ConsultationInfo
  ): Promise<void> {
    try {
      // Build event payload explicitly to satisfy ESLint's type checker
      // Initialize metadata object to avoid undefined checks
      const metadata: Record<string, unknown> = {
        sessionId: payload.sessionId,
        timestamp: payload.timestamp,
        appointmentId: consultationInfo.appointmentId,
      };

      // Add optional metadata fields
      if (payload.participantId) {
        metadata['participantId'] = payload.participantId;
      }
      if (payload.connectionId) {
        metadata['connectionId'] = payload.connectionId;
      }
      if (payload.reason) {
        metadata['reason'] = payload.reason;
      }
      if (consultationInfo.userRole) {
        metadata['userRole'] = consultationInfo.userRole;
      }

      const eventPayload: EnterpriseEventPayload = {
        eventId: `openvidu_${payload.sessionId}_${payload.timestamp}`,
        eventType: `openvidu.${payload.event}`,
        category: EventCategory.SYSTEM,
        priority: EventPriority.NORMAL,
        timestamp: new Date(payload.timestamp).toISOString(),
        source: 'OpenViduWebhookService',
        version: '1.0.0',
        metadata,
      };

      // Add optional top-level fields explicitly
      if (consultationInfo.clinicId) {
        eventPayload.clinicId = consultationInfo.clinicId;
      }
      if (consultationInfo.userId) {
        eventPayload.userId = consultationInfo.userId;
      }

      await this.eventService.emitEnterprise(`openvidu.${payload.event}`, eventPayload);

      await this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        `Emitted OpenVidu event to EventService: openvidu.${payload.event}`,
        'OpenViduWebhookService',
        {
          event: payload.event,
          appointmentId: consultationInfo.appointmentId,
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to emit to EventService: ${error instanceof Error ? error.message : String(error)}`,
        'OpenViduWebhookService',
        {
          error: error instanceof Error ? error.message : String(error),
          payload,
        }
      );
      // Don't throw - webhook processing should continue even if EventService fails
    }
  }

  /**
   * Validate webhook signature (if OpenVidu webhook secret is configured)
   * @see https://docs.openvidu.io/en/stable/developing/webhooks/#webhook-security
   */
  async validateWebhookSignature(
    payload: string,
    signature: string,
    secret: string
  ): Promise<boolean> {
    try {
      // Use Node.js crypto module (built-in, imported at top)
      const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

      // Use constant-time comparison to prevent timing attacks
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `Failed to validate webhook signature: ${error instanceof Error ? error.message : String(error)}`,
        'OpenViduWebhookService',
        { error: error instanceof Error ? error.message : String(error) }
      );
      return false;
    }
  }
}
