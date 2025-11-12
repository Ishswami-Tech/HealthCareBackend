// External imports
import { Module, forwardRef } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

// Internal imports - Core
import { ResilienceModule } from '@core/resilience';

// Internal imports - Local
import { EventService } from './event.service';

// Note: LoggingModule and CacheModule are @Global() - no need to import them
// LoggingService and CacheService are injected using @Inject(forwardRef(...)) in EventService

/**
 * Events Module - Centralized Event System
 *
 * **THIS IS THE CENTRAL EVENT HUB FOR THE ENTIRE APPLICATION**
 * All event emissions MUST go through EventService. No direct EventEmitter2 usage.
 *
 * Provides enterprise-grade event-driven architecture built on top of NestJS EventEmitter2.
 * EventService acts as the single source of truth for all event emissions in the application.
 *
 * **Architecture:**
 * ```
 * ┌─────────────────────────────────────────────────────────────┐
 * │              CENTRAL EVENT SYSTEM (Hub)                      │
 * │         @infrastructure/events/EventService                  │
 * │                                                              │
 * │  Services emit events:                                       │
 * │  await eventService.emit('ehr.lab_report.created', {...})   │
 * └─────────────────────────────────────────────────────────────┘
 *                        │
 *                        │ Events emitted via EventEmitter2
 *                        │
 *        ┌───────────────┼───────────────┐
 *        │               │               │
 *        ▼               ▼               ▼
 * ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
 * │   Socket     │ │  Unified     │ │   Other      │
 * │   Listener   │ │ Communication│ │  Listeners   │
 * │              │ │   Listener   │ │  (Audit,     │
 * │              │ │              │ │   Analytics) │
 * └──────────────┘ └──────────────┘ └──────────────┘
 * ```
 *
 * **Features:**
 * - EventService: Consolidated event service with both simple and enterprise-grade APIs
 *   - Simple API: emit(), emitAsync(), on(), once(), off(), removeAllListeners(), getEvents(), clearEvents()
 *   - Enterprise API: emitEnterprise() with circuit breaker, rate limiting, and HIPAA compliance
 *   - Wildcard subscriptions: onAny() for listening to all events
 * - Built on NestJS EventEmitter2 for compatibility with @OnEvent decorators
 * - Integrated with LoggingService, CircuitBreakerService, and CacheService for persistence
 * - Rate limiting, circuit breaking, event buffering, and performance monitoring
 * - HIPAA-compliant event handling with PHI data protection
 *
 * **Usage:**
 * ```typescript
 * import { EventService } from '@infrastructure/events';
 *
 * constructor(private readonly eventService: EventService) {}
 *
 * // Simple API
 * await this.eventService.emit('user.created', { userId: '123' });
 *
 * // Enterprise API
 * await this.eventService.emitEnterprise('user.created', {
 *   eventId: 'evt_123',
 *   eventType: 'user.created',
 *   category: EventCategory.USER_ACTIVITY,
 *   priority: EventPriority.HIGH,
 *   payload: { userId: '123' }
 * });
 *
 * // Listen to all events
 * this.eventService.onAny((event, ...args) => {
 *   console.log('Event emitted:', event, args);
 * });
 * ```
 *
 * **Important:**
 * - DO NOT use EventEmitter2 directly - always use EventService
 * - All event emissions must go through EventService for consistency, monitoring, and compliance
 * - EventService ensures rate limiting, circuit breaking, and HIPAA compliance
 */
@Module({
  imports: [
    // EventEmitterModule is already configured in AppModule with forRoot()
    // We just need to import it here for EventEmitter2 injection
    EventEmitterModule,
    // LoggingModule and CacheModule are @Global() - no need to import them
    // We use @Inject(forwardRef(...)) in EventService constructor to handle circular dependencies
    forwardRef(() => ResilienceModule), // For CircuitBreakerService
  ],
  providers: [EventService],
  exports: [EventService],
})
export class EventsModule {}
