/**
 * Communication Listeners Module
 * ===============================
 * Module for event listeners that bridge the central event system
 * to the unified CommunicationService
 *
 * @module ListenersModule
 * @description Event-driven communication integration via CommunicationService
 */

import { Module, forwardRef } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EventsModule } from '@infrastructure/events';
import { LoggingModule } from '@logging';
import { CommunicationModule } from '@communication/communication.module';
import { NotificationEventListener } from './notification-event.listener';

/**
 * Communication Listeners Module
 *
 * Provides event listeners that automatically trigger communication
 * services when business events occur.
 *
 * Listeners:
 * - NotificationEventListener: Triggers communication via CommunicationService based on business events
 *
 * @example
 * ```typescript
 * // Events are automatically processed by listeners
 * await eventService.emit('ehr.medical_history.created', {
 *   userId: '123',
 *   clinicId: '456'
 * });
 * // NotificationEventListener will automatically trigger communication via CommunicationService
 * // CommunicationService handles channel selection (socket, push, email, WhatsApp, SMS)
 * ```
 */
@Module({
  imports: [
    EventEmitterModule,
    EventsModule, // Central event system
    LoggingModule,
    forwardRef(() => CommunicationModule), // Unified communication service
  ],
  providers: [NotificationEventListener],
  exports: [NotificationEventListener],
})
export class ListenersModule {}
