/**
 * Notification Event Listener
 * ============================
 * Listens to business events and triggers appropriate communication
 * Bridges the central event system to the unified CommunicationService
 *
 * @module NotificationEventListener
 * @description Event-driven communication trigger system using CommunicationService
 */

import { Injectable, OnModuleInit, Inject, forwardRef } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
// Use direct imports to avoid TDZ issues with barrel exports
import { EventService } from '@infrastructure/events/event.service';
import { CommunicationService } from '@communication/communication.service';
import { LoggingService } from '@infrastructure/logging/logging.service';
import {
  LogType,
  LogLevel,
  EventCategory,
  EventPriority,
  type IEventService,
  isEventService,
} from '@core/types';
import {
  CommunicationCategory,
  CommunicationPriority,
  type CommunicationChannel,
} from '@core/types';
import type { EnterpriseEventPayload } from '@core/types';

/**
 * Event-to-Communication mapping rules
 */
interface CommunicationRule {
  eventPattern: string | RegExp;
  category: CommunicationCategory;
  channels?: CommunicationChannel[];
  priority: CommunicationPriority;
  template?: string;
  recipients: (payload: EnterpriseEventPayload) => Array<{
    userId?: string;
    email?: string;
    phoneNumber?: string;
    deviceToken?: string;
    socketRoom?: string;
  }>;
  shouldNotify: (_payload: EnterpriseEventPayload) => boolean;
}

@Injectable()
export class NotificationEventListener implements OnModuleInit {
  private readonly communicationRules: CommunicationRule[] = [
    // EHR Events - Generic Pattern
    {
      eventPattern:
        /^ehr\.(medical_history|lab_report|radiology_report|surgical_record|vital|allergy|medication|immunization)\.created$/,
      category: CommunicationCategory.EHR_RECORD,
      channels: ['socket', 'push', 'email'],
      priority: CommunicationPriority.HIGH,
      template: 'ehr_record_created',
      recipients: payload => {
        const recipients: Array<{
          userId?: string;
          email?: string;
          deviceToken?: string;
          socketRoom?: string;
        }> = [];
        if (payload.userId) {
          recipients.push({
            userId: payload.userId,
            socketRoom: `user:${payload.userId}`,
          });
        }
        if (payload.clinicId) {
          // Add clinic staff based on event type
          recipients.push({
            userId: payload.clinicId,
            socketRoom: `clinic:${payload.clinicId}`,
          });
        }
        return recipients;
      },
      shouldNotify: () => true,
    },
    // EHR Critical Alerts - Vital Signs Out of Range
    {
      eventPattern: /^ehr\.vital\.created$/,
      category: CommunicationCategory.EHR_RECORD,
      channels: ['socket', 'push', 'email'],
      priority: CommunicationPriority.CRITICAL,
      template: 'vital_critical_alert',
      recipients: payload => {
        const recipients: Array<{
          userId?: string;
          email?: string;
          deviceToken?: string;
          socketRoom?: string;
        }> = [];
        // Check if vital signs are out of range (metadata should contain this info)
        const isCritical = payload.metadata?.['isCritical'] as boolean | undefined;
        if (isCritical) {
          if (payload.userId) {
            recipients.push({
              userId: payload.userId,
              socketRoom: `user:${payload.userId}`,
            });
          }
          if (payload.clinicId) {
            // Alert clinic staff for critical vitals
            recipients.push({
              socketRoom: `clinic:${payload.clinicId}:doctors`,
            });
          }
        }
        return recipients;
      },
      shouldNotify: payload => {
        // Only notify if vital signs are critical
        return (payload.metadata?.['isCritical'] as boolean | undefined) === true;
      },
    },
    // EHR Critical Alerts - Critical Allergy Added
    {
      eventPattern: /^ehr\.allergy\.created$/,
      category: CommunicationCategory.EHR_RECORD,
      channels: ['socket', 'push', 'email'],
      priority: CommunicationPriority.CRITICAL,
      template: 'allergy_critical_alert',
      recipients: payload => {
        const recipients: Array<{
          userId?: string;
          email?: string;
          deviceToken?: string;
          socketRoom?: string;
        }> = [];
        // Check if allergy is critical/severe
        const severity = payload.metadata?.['severity'] as string | undefined;
        const isCritical = severity === 'severe' || severity === 'critical';
        if (isCritical) {
          if (payload.userId) {
            recipients.push({
              userId: payload.userId,
              socketRoom: `user:${payload.userId}`,
            });
          }
          if (payload.clinicId) {
            // Alert clinic staff for critical allergies
            recipients.push({
              socketRoom: `clinic:${payload.clinicId}:doctors`,
            });
          }
        }
        return recipients;
      },
      shouldNotify: payload => {
        // Only notify if allergy is critical/severe
        const severity = payload.metadata?.['severity'] as string | undefined;
        return severity === 'severe' || severity === 'critical';
      },
    },
    // EHR Surgical Record Created - Specific Notification
    {
      eventPattern: /^ehr\.surgical_record\.created$/,
      category: CommunicationCategory.EHR_RECORD,
      channels: ['socket', 'push', 'email'],
      priority: CommunicationPriority.HIGH,
      template: 'surgical_record_created',
      recipients: payload => {
        const recipients: Array<{
          userId?: string;
          email?: string;
          deviceToken?: string;
          socketRoom?: string;
        }> = [];
        if (payload.userId) {
          recipients.push({
            userId: payload.userId,
            socketRoom: `user:${payload.userId}`,
          });
        }
        if (payload.clinicId) {
          // Notify clinic staff about surgical records
          recipients.push({
            socketRoom: `clinic:${payload.clinicId}:doctors`,
          });
        }
        return recipients;
      },
      shouldNotify: () => true,
    },
    // EHR Immunization Record Created - Specific Notification
    {
      eventPattern: /^ehr\.immunization\.created$/,
      category: CommunicationCategory.EHR_RECORD,
      channels: ['socket', 'push', 'email'],
      priority: CommunicationPriority.NORMAL,
      template: 'immunization_record_created',
      recipients: payload => {
        const recipients: Array<{
          userId?: string;
          email?: string;
          deviceToken?: string;
          socketRoom?: string;
        }> = [];
        if (payload.userId) {
          recipients.push({
            userId: payload.userId,
            socketRoom: `user:${payload.userId}`,
          });
        }
        return recipients;
      },
      shouldNotify: () => true,
    },
    // User Events
    {
      eventPattern: /^user\.created$/,
      category: CommunicationCategory.USER_ACTIVITY,
      channels: ['email'],
      priority: CommunicationPriority.NORMAL,
      template: 'user_welcome',
      recipients: payload => {
        if (payload.userId) {
          return [{ userId: payload.userId }];
        }
        return [];
      },
      shouldNotify: () => true,
    },
    {
      eventPattern: /^user\.updated$/,
      category: CommunicationCategory.USER_ACTIVITY,
      channels: ['socket', 'push', 'email'],
      priority: CommunicationPriority.NORMAL,
      template: 'user_updated',
      recipients: payload => {
        if (payload.userId) {
          return [
            {
              userId: payload.userId,
              socketRoom: `user:${payload.userId}`,
            },
          ];
        }
        return [];
      },
      shouldNotify: () => true,
    },
    // Appointment Events
    {
      eventPattern: /^appointment\.created$/,
      category: CommunicationCategory.APPOINTMENT,
      channels: ['socket', 'push', 'email', 'whatsapp'],
      priority: CommunicationPriority.HIGH,
      template: 'appointment_created',
      recipients: payload => {
        const recipients: Array<{
          userId?: string;
          email?: string;
          deviceToken?: string;
          socketRoom?: string;
        }> = [];
        if (payload.userId) {
          recipients.push({
            userId: payload.userId,
            socketRoom: `user:${payload.userId}`,
          }); // Patient
        }
        const doctorId = payload.metadata?.['doctorId'] as string | undefined;
        if (doctorId) {
          recipients.push({
            userId: doctorId,
            socketRoom: `user:${doctorId}`,
          }); // Doctor
        }
        return recipients;
      },
      shouldNotify: () => true,
    },
    {
      eventPattern: /^appointment\.(cancelled|rescheduled)$/,
      category: CommunicationCategory.APPOINTMENT,
      channels: ['socket', 'push', 'email', 'whatsapp'],
      priority: CommunicationPriority.HIGH,
      template: 'appointment_updated',
      recipients: payload => {
        const recipients: Array<{
          userId?: string;
          email?: string;
          deviceToken?: string;
          socketRoom?: string;
        }> = [];
        if (payload.userId) {
          recipients.push({
            userId: payload.userId,
            socketRoom: `user:${payload.userId}`,
          });
        }
        const doctorId = payload.metadata?.['doctorId'] as string | undefined;
        if (doctorId) {
          recipients.push({
            userId: doctorId,
            socketRoom: `user:${doctorId}`,
          });
        }
        return recipients;
      },
      shouldNotify: () => true,
    },
    // Queue Position Updates
    {
      eventPattern: /^appointment\.queue\.(position\.updated|updated|reordered)$/,
      category: CommunicationCategory.APPOINTMENT,
      channels: ['socket', 'push'], // Real-time only, no email
      priority: CommunicationPriority.NORMAL,
      template: 'queue_position_update',
      recipients: payload => {
        const recipients: Array<{
          userId?: string;
          deviceToken?: string;
          socketRoom?: string;
        }> = [];
        // Get appointmentId from metadata to find patient
        const appointmentId = payload.metadata?.['appointmentId'] as string | undefined;
        if (appointmentId) {
          // Add appointment-specific room for real-time updates
          recipients.push({
            socketRoom: `appointment:${appointmentId}`,
          });
        }
        // Add user-specific room if userId is in payload
        if (payload.userId) {
          recipients.push({
            userId: payload.userId,
            socketRoom: `user:${payload.userId}`,
          });
        }
        // Add clinic room for staff monitoring
        if (payload.clinicId) {
          recipients.push({
            socketRoom: `clinic:${payload.clinicId}`,
          });
        }
        return recipients;
      },
      shouldNotify: payload => {
        // Only notify if position changed significantly (e.g., moved up by 2+ positions)
        const position = payload.metadata?.['position'] as number | undefined;
        const previousPosition = payload.metadata?.['previousPosition'] as number | undefined;
        if (position !== undefined && previousPosition !== undefined) {
          // Notify if moved up by 2+ positions or reached position 1
          return position < previousPosition - 1 || position === 1;
        }
        // Always notify if no previous position (first update)
        return true;
      },
    },
    // Billing Events
    {
      eventPattern: /^billing\.(payment|invoice)\.(created|paid)$/,
      category: CommunicationCategory.BILLING,
      channels: ['push', 'email'],
      priority: CommunicationPriority.NORMAL,
      template: 'billing_notification',
      recipients: payload => {
        if (payload.userId) {
          return [{ userId: payload.userId }];
        }
        return [];
      },
      shouldNotify: () => true,
    },
  ];

  private typedEventService?: IEventService;
  private typedCommunicationService?: CommunicationService;

  constructor(
    @Inject(forwardRef(() => EventService))
    eventService: unknown,
    @Inject(forwardRef(() => CommunicationService))
    private readonly communicationService: unknown,
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService
  ) {
    // Type guard ensures type safety when using the service
    // This handles forwardRef circular dependency type resolution issues
    if (!isEventService(eventService)) {
      throw new Error('EventService is not available or invalid');
    }
    this.typedEventService = eventService;

    // Type guard for CommunicationService
    if (!this.communicationService || typeof this.communicationService !== 'object') {
      throw new Error('CommunicationService is not available or invalid');
    }
    if (typeof (this.communicationService as CommunicationService).send !== 'function') {
      throw new Error('CommunicationService.send method is not available');
    }
    this.typedCommunicationService = this.communicationService as CommunicationService;
  }

  async onModuleInit(): Promise<void> {
    await this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'NotificationEventListener initialized - listening to business events via CommunicationService',
      'NotificationEventListener',
      {
        ruleCount: this.communicationRules.length,
      }
    );
  }

  /**
   * Generic event handler that processes all events
   * Uses @OnEvent decorator to listen to EventEmitter2 events
   */
  @OnEvent('**')
  async handleEvent(
    eventType: string | string[] | Record<string, unknown>,
    payload: EnterpriseEventPayload | Record<string, unknown> | undefined
  ): Promise<void> {
    // Normalize eventType to string (declare outside try block for catch block access)
    let normalizedEventType = 'unknown';
    try {
      if (typeof eventType === 'string') {
        normalizedEventType = eventType;
      } else if (Array.isArray(eventType)) {
        normalizedEventType = eventType.join('.');
      } else if (eventType && typeof eventType === 'object' && 'eventType' in eventType) {
        // If eventType is an object with eventType property, extract it
        const extractedEventType = (eventType as { eventType: unknown }).eventType;
        if (typeof extractedEventType === 'string') {
          normalizedEventType = extractedEventType;
        } else if (extractedEventType !== null && extractedEventType !== undefined) {
          // Only stringify if it's a primitive type, otherwise use 'unknown'
          if (
            typeof extractedEventType === 'number' ||
            typeof extractedEventType === 'boolean' ||
            typeof extractedEventType === 'bigint'
          ) {
            normalizedEventType = String(extractedEventType);
          } else {
            normalizedEventType = 'unknown';
          }
        } else {
          normalizedEventType = 'unknown';
        }
        // If payload is undefined, use eventType as payload
        if (!payload || (typeof payload === 'object' && Object.keys(payload).length === 0)) {
          payload = eventType;
        }
      } else if (eventType && typeof eventType === 'object') {
        // For other object types, use 'unknown' instead of stringifying
        normalizedEventType = 'unknown';
      }

      // Normalize payload
      const eventPayload = this.normalizePayload(payload);

      // Find matching communication rule
      const rule = this.findMatchingRule(normalizedEventType, eventPayload);

      if (!rule) {
        // No communication rule for this event
        return;
      }

      // Check if communication should be sent
      if (!rule.shouldNotify(eventPayload)) {
        return;
      }

      // Get recipients
      const recipients = rule.recipients(eventPayload);

      if (recipients.length === 0) {
        await this.loggingService.log(
          LogType.NOTIFICATION,
          LogLevel.DEBUG,
          `No recipients found for event ${normalizedEventType}`,
          'NotificationEventListener',
          { eventType: normalizedEventType }
        );
        return;
      }

      // Generate communication content
      const { title, body } = this.generateCommunicationContent(
        normalizedEventType,
        eventPayload,
        rule
      );

      // Send communication via CommunicationService
      const communicationRequest = {
        category: rule.category,
        title,
        body,
        recipients,
        ...(rule.channels && rule.channels.length > 0 && { channels: rule.channels }),
        priority: rule.priority,
        data: {
          eventType: normalizedEventType,
          eventId: eventPayload.eventId,
          ...(eventPayload.userId && { userId: eventPayload.userId }),
          ...(eventPayload.clinicId && { clinicId: eventPayload.clinicId }),
          ...(eventPayload.metadata && { metadata: eventPayload.metadata }),
        },
        respectPreferences: true,
        applyRateLimit: true,
      };
      if (!this.typedCommunicationService) {
        throw new Error('CommunicationService is not available');
      }
      const result = await this.typedCommunicationService.send(communicationRequest);

      await this.loggingService.log(
        LogType.NOTIFICATION,
        result.success ? LogLevel.INFO : LogLevel.WARN,
        `Processed communication for event ${normalizedEventType}`,
        'NotificationEventListener',
        {
          eventType: normalizedEventType,
          recipientCount: recipients.length,
          category: rule.category,
          channels: rule.channels,
          success: result.success,
          requestId: result.requestId,
        }
      );
    } catch (error) {
      await this.loggingService.log(
        LogType.NOTIFICATION,
        LogLevel.ERROR,
        `Error processing communication for event ${normalizedEventType || 'unknown'}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'NotificationEventListener',
        {
          eventType: normalizedEventType || 'unknown',
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }

  /**
   * Normalize payload to EnterpriseEventPayload
   */
  private normalizePayload(payload: unknown): EnterpriseEventPayload {
    if (this.isEnterpriseEventPayload(payload)) {
      return payload;
    }

    // If payload is wrapped, extract it
    if (typeof payload === 'object' && payload !== null && 'payload' in payload) {
      const wrapped = payload as { payload: unknown };
      if (this.isEnterpriseEventPayload(wrapped.payload)) {
        return wrapped.payload;
      }
    }

    // Create minimal EnterpriseEventPayload from plain object
    const plain = payload as Record<string, unknown>;
    const result: EnterpriseEventPayload = {
      eventId: `evt_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      eventType: (plain['eventType'] as string) || 'unknown',
      category: (plain['category'] as EventCategory) || EventCategory.SYSTEM,
      priority: (plain['priority'] as EventPriority) || EventPriority.NORMAL,
      timestamp: new Date().toISOString(),
      source: (plain['source'] as string) || 'NotificationEventListener',
      version: '1.0.0',
      metadata: plain,
    };
    const userId = plain['userId'];
    if (userId && typeof userId === 'string') {
      result.userId = userId;
    }
    const clinicId = plain['clinicId'];
    if (clinicId && typeof clinicId === 'string') {
      result.clinicId = clinicId;
    }
    return result;
  }

  /**
   * Type guard for EnterpriseEventPayload
   */
  private isEnterpriseEventPayload(payload: unknown): payload is EnterpriseEventPayload {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'eventId' in payload &&
      'eventType' in payload &&
      'category' in payload &&
      'priority' in payload &&
      'timestamp' in payload &&
      'source' in payload &&
      'version' in payload
    );
  }

  /**
   * Find matching communication rule for event
   */
  private findMatchingRule(
    eventType: string,
    _payload: EnterpriseEventPayload
  ): CommunicationRule | undefined {
    return this.communicationRules.find(rule => {
      if (typeof rule.eventPattern === 'string') {
        return eventType.startsWith(rule.eventPattern);
      }
      if (rule.eventPattern instanceof RegExp) {
        return rule.eventPattern.test(eventType);
      }
      return false;
    });
  }

  /**
   * Generate communication title and body based on event
   */
  private generateCommunicationContent(
    eventType: string,
    _payload: EnterpriseEventPayload,
    _rule: CommunicationRule
  ): { title: string; body: string } {
    // Default content
    let title = 'Notification';
    let body = 'You have a new notification';

    // Customize based on event type
    if (eventType.startsWith('ehr.')) {
      const recordType = eventType.split('.')[1]?.replace(/_/g, ' ') || 'record';
      title = 'New Medical Record';
      body = `A new ${recordType} has been added to your health records`;
    } else if (eventType.startsWith('appointment.')) {
      if (eventType.includes('.created')) {
        title = 'Appointment Scheduled';
        body = 'Your appointment has been successfully scheduled';
      } else if (eventType.includes('.cancelled')) {
        title = 'Appointment Cancelled';
        body = 'Your appointment has been cancelled';
      } else if (eventType.includes('.rescheduled')) {
        title = 'Appointment Rescheduled';
        body = 'Your appointment has been rescheduled';
      }
    } else if (eventType.startsWith('user.')) {
      if (eventType.includes('.created')) {
        title = 'Welcome!';
        body = 'Your account has been created successfully';
      } else if (eventType.includes('.updated')) {
        title = 'Account Updated';
        body = 'Your account information has been updated';
      }
    } else if (eventType.startsWith('billing.')) {
      title = 'Billing Update';
      body = 'You have a new billing notification';
    } else if (eventType.startsWith('appointment.queue.')) {
      const position = _payload.metadata?.['position'] as number | undefined;
      const totalInQueue = _payload.metadata?.['totalInQueue'] as number | undefined;
      const estimatedWaitTime = _payload.metadata?.['estimatedWaitTime'] as number | undefined;
      if (eventType.includes('.position.updated')) {
        title = 'Queue Position Update';
        if (position === 1) {
          body = 'You are next in line! The doctor will see you shortly.';
        } else if (position !== undefined) {
          const waitTimeText =
            estimatedWaitTime !== undefined
              ? `Estimated wait time: ${estimatedWaitTime} minutes`
              : '';
          body = `Your position in queue: ${position}${totalInQueue ? ` of ${totalInQueue}` : ''}. ${waitTimeText}`;
        } else {
          body = 'Your queue position has been updated';
        }
      } else if (eventType.includes('.reordered')) {
        title = 'Queue Updated';
        body = 'The queue order has been updated';
      } else {
        title = 'Queue Update';
        body = 'Your appointment queue status has changed';
      }
    }

    return { title, body };
  }
}
