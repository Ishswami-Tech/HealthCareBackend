/**
 * Communication Listeners Module
 * ===============================
 * Module for event listeners that bridge the central event system
 * to the unified CommunicationService
 *
 * @module ListenersModule
 * @description Event-driven communication integration via CommunicationService
 */

import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EventsModule } from '@infrastructure/events/events.module';
import { LoggingModule } from '@logging';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { NotificationModule } from '@services/notification/notification.module';
import { NotificationEventListener } from './notification-event.listener';
import { DoctorAppointmentEventListener } from './doctor-appointment-event.listener';
import { DoctorSummaryService } from '../services/doctor-summary.service';

/**
 * Communication Listeners Module
 *
 * Provides event listeners that automatically trigger communication
 * services when business events occur.
 *
 * Listeners:
 * - NotificationEventListener: Triggers communication via CommunicationService based on business events
 * - DoctorAppointmentEventListener: Enqueues a doctor daily summary job on appointment.created
 */
@Module({
  imports: [
    EventEmitterModule,
    EventsModule, // Central event system
    LoggingModule,
    DatabaseModule,
    NotificationModule, // NotificationPreferenceService for doctor prefs
  ],
  providers: [NotificationEventListener, DoctorAppointmentEventListener, DoctorSummaryService],
  exports: [NotificationEventListener, DoctorAppointmentEventListener, DoctorSummaryService],
})
export class ListenersModule {}
