import { Module, forwardRef } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EmailModule } from '@communication/channels/email/email.module';
import { WhatsAppModule } from '@communication/channels/whatsapp/whatsapp.module';
import { PushModule } from '@communication/channels/push/push.module';
import { SocketModule } from '@communication/channels/socket/socket.module';
import { ChatModule } from '@communication/channels/chat/chat.module';
import { NotificationModule } from '@services/notification/notification.module';
import { ListenersModule } from '@communication/listeners/listeners.module';
import { EventsModule } from '@infrastructure/events';
import { CacheModule } from '@infrastructure/cache';
import { ResilienceModule } from '@core/resilience';
import { CommunicationService } from './communication.service';
import { CommunicationHealthMonitorService } from './communication-health-monitor.service';
import { CommunicationController } from './communication.controller';
import { CommunicationConfigModule } from './config/communication-config.module';

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
 * // In your module
 * @Module({
 *   imports: [CommunicationModule],
 * })
 * export class AppointmentsModule {}
 * ```
 */
@Module({
  imports: [
    EventEmitterModule, // Required for EventEmitter2 injection
    EmailModule, // Email services (SMTP, SES, templates, queue)
    WhatsAppModule, // WhatsApp Business API
    PushModule, // Push notifications (Firebase, SNS)
    SocketModule, // Real-time WebSocket communication
    ChatModule, // Chat backup and synchronization
    NotificationModule, // REST API endpoints in @services/notification (for external API access)
    ListenersModule, // Event-driven communication listeners
    CommunicationConfigModule, // Multi-tenant communication configuration
    forwardRef(() => EventsModule), // Central event system
    forwardRef(() => CacheModule), // Cache for rate limiting and preferences
    forwardRef(() => ResilienceModule), // Provides CircuitBreakerService
  ],
  controllers: [CommunicationController],
  providers: [CommunicationService, CommunicationHealthMonitorService],
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
  ],
})
export class CommunicationModule {}
