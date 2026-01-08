import { Module, Global, forwardRef } from '@nestjs/common';
import { COMMUNICATION_SERVICE_TOKEN } from './communication.constants';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { HttpModule } from '@infrastructure/http';
// TerminusModule removed - using only LoggingService (per .ai-rules/ coding standards)
import { EmailModule } from '@communication/channels/email/email.module';
import { WhatsAppModule } from '@communication/channels/whatsapp/whatsapp.module';
import { PushModule } from '@communication/channels/push/push.module';
import { SocketModule } from '@communication/channels/socket/socket.module';
import { ChatModule } from '@communication/channels/chat/chat.module';
import { NotificationModule } from '@services/notification/notification.module';
import { ListenersModule } from '@communication/listeners/listeners.module';
// Use direct imports to avoid TDZ issues with barrel exports
import { EventsModule } from '@infrastructure/events/events.module';
import { CacheModule } from '@infrastructure/cache/cache.module';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { ResilienceModule } from '@core/resilience';
import { CommunicationService } from './communication.service';
import { CommunicationHealthMonitorService } from './communication-health-monitor.service';
import { CommunicationController } from './communication.controller';
import { CommunicationConfigModule } from './config/communication-config.module';
import { CommunicationAdaptersModule } from './adapters/adapters.module';
import { EmailServicesModule } from './adapters/email/email-services.module';
import { ClinicTemplateService } from './services/clinic-template.service';
import { CommunicationAlertingService } from './services/communication-alerting.service';

/**
 * Unified Communication Module
 *
 * Aggregates all communication services into a single module for easier import.
 * Provides:
 * - Email services (SMTP, SES, templates, queue management)
 * - WhatsApp Business API integration
 * - Push notifications (Firebase, SNS)
 * - Real-time WebSocket communication
 * - Notification orchestration service
 * - Event-driven communication listeners
 *
 * @module CommunicationModule
 * @description Centralized module for all communication services
 *
 * Architecture:
 * - Central Event System (@infrastructure/events) → Event Listeners → Communication Services
 * - Services emit events → Listeners react → Communication services deliver
 *
 * @example
 * ```typescript
 * // In your module - CommunicationModule is @Global(), so CommunicationService is available everywhere
 * @Module({
 *   // No need to import CommunicationModule - it's global
 *   providers: [MyService],
 * })
 * export class MyModule {}
 *
 * // In your service
 * constructor(private readonly communicationService: CommunicationService) {}
 * ```
 */
@Global()
@Module({
  imports: [
    HttpModule, // HTTP client for WhatsApp API calls
    // TerminusModule removed - using only LoggingService (per .ai-rules/ coding standards)
    EventEmitterModule, // Required for EventEmitter2 injection
    // Use forwardRef for all channel modules to break circular dependencies
    // CommunicationModule is built on top of all channel services
    forwardRef(() => EmailModule), // Email services (SMTP, SES, templates, queue)
    forwardRef(() => WhatsAppModule), // WhatsApp Business API
    forwardRef(() => PushModule), // Push notifications (Firebase, SNS)
    forwardRef(() => SocketModule), // Real-time WebSocket communication
    forwardRef(() => ChatModule), // Chat backup and synchronization
    forwardRef(() => NotificationModule), // REST API endpoints in @services/notification (for external API access)
    forwardRef(() => ListenersModule), // Event-driven communication listeners
    forwardRef(() => CommunicationConfigModule), // Multi-tenant communication configuration
    forwardRef(() => CommunicationAdaptersModule), // Provider adapters (SMTP, SES, SendGrid, Meta WhatsApp, Twilio)
    forwardRef(() => EmailServicesModule), // Email services (suppression list, webhooks, rate monitoring)
    forwardRef(() => EventsModule), // Central event system
    forwardRef(() => CacheModule), // Cache for rate limiting and preferences
    forwardRef(() => DatabaseModule), // Database for notification preferences and delivery tracking
    forwardRef(() => ResilienceModule), // Provides CircuitBreakerService
  ],
  controllers: [CommunicationController],
  providers: [
    CommunicationService,
    {
      provide: COMMUNICATION_SERVICE_TOKEN,
      useExisting: CommunicationService,
    },
    CommunicationHealthMonitorService,
    ClinicTemplateService,
    CommunicationAlertingService,
  ],
  exports: [
    EmailModule,
    WhatsAppModule,
    PushModule,
    SocketModule,
    ChatModule,
    NotificationModule,
    ListenersModule,
    CommunicationConfigModule, // Multi-tenant communication configuration
    CommunicationService, // Unified communication service
    // Export health monitor for HealthService
    CommunicationHealthMonitorService,
    ClinicTemplateService, // Clinic template data service
    CommunicationAlertingService, // Alerting service
  ],
})
export class CommunicationModule {}
