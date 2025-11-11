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
 * Events Module
 *
 * Provides enterprise-grade event-driven architecture built on top of NestJS EventEmitter2.
 *
 * Features:
 * - EventService: Consolidated event service with both simple and enterprise-grade APIs
 *   - Simple API: emit(), emitAsync(), on(), once(), off(), removeAllListeners(), getEvents(), clearEvents()
 *   - Enterprise API: emitEnterprise() with circuit breaker, rate limiting, and HIPAA compliance
 * - Built on NestJS EventEmitter2 for compatibility with @OnEvent decorators
 * - Integrated with LoggingService, CircuitBreakerService, and CacheService for persistence
 *
 * Usage:
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
 * ```
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
