/**
 * ===================================================================
 * CENTRALIZED EVENT SERVICE - SINGLE SOURCE OF TRUTH
 * A++ Enterprise Event System for 1M+ Users
 * Healthcare-focused Event-Driven Architecture with HIPAA Compliance
 * ===================================================================
 *
 * **THIS IS THE CENTRAL EVENT HUB FOR THE ENTIRE APPLICATION**
 * All event emissions MUST go through this service. No direct EventEmitter2 usage.
 *
 * This service acts as the single source of truth for all event emissions in the application.
 * It provides a unified, robust, and enterprise-grade event system built on top of NestJS EventEmitter2.
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
 * - Simple API: emit(), emitAsync(), on(), once(), off(), removeAllListeners(), getEvents(), clearEvents()
 * - Enterprise API: emitEnterprise() with full payload structure, circuit breaker, rate limiting, HIPAA compliance
 * - Wildcard subscriptions: onAny() for listening to all events
 * - Built on NestJS EventEmitter2 for compatibility with @OnEvent decorators
 * - Integrated with LoggingService, CircuitBreakerService, and CacheService
 * - Rate limiting, circuit breaking, event buffering, and performance monitoring
 * - HIPAA-compliant event handling with PHI data protection
 *
 * **Usage:**
 * ```typescript
 * // Simple API
 * await eventService.emit('user.created', { userId: '123' });
 *
 * // Enterprise API
 * await eventService.emitEnterprise('user.created', {
 *   eventId: 'evt_123',
 *   eventType: 'user.created',
 *   category: EventCategory.USER_ACTIVITY,
 *   priority: EventPriority.HIGH,
 *   payload: { userId: '123' }
 * });
 *
 * // Listen to all events
 * eventService.onAny((event, ...args) => {
 *   console.log('Event emitted:', event, args);
 * });
 * ```
 *
 * **Important:**
 * - DO NOT use EventEmitter2 directly - always use EventService
 * - All event emissions must go through EventService for consistency, monitoring, and compliance
 * - EventService ensures rate limiting, circuit breaking, and HIPAA compliance
 */

// External imports
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  HttpStatus,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

// Internal imports - Infrastructure
import { LogType, LogLevel } from '@core/types';
import type { LoggingService } from '@infrastructure/logging/logging.service';
import type { CacheService } from '@infrastructure/cache/cache.service';
// Logging is injected via token to avoid SWC TDZ circular-import issues

// Internal imports - Core
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { CircuitBreakerService } from '@core/resilience/circuit-breaker.service';

// Internal imports - Types (EventCategory and EventPriority are used as values)
import { EventCategory, EventPriority } from '@core/types';
import type {
  EnterpriseEventPayload,
  EventStatus,
  EventResult,
  EventFilter,
  EventMetrics,
  EventSubscription,
} from '@core/types';

@Injectable()
export class EventService implements OnModuleInit, OnModuleDestroy {
  private readonly subscriptions = new Map<string, EventSubscription>();
  private readonly eventBuffer: EnterpriseEventPayload[] = [];
  private readonly maxBufferSize = 50000; // Increased for 1M+ users
  private metricsBuffer: unknown[] = [];
  private processedEvents = 0;
  private failedEvents = 0;
  private totalProcessingTime = 0;

  // Performance monitoring
  private performanceInterval!: NodeJS.Timeout;
  private cleanupInterval!: NodeJS.Timeout;
  private bufferFlushInterval!: NodeJS.Timeout;

  // Rate limiting for event emission
  private readonly rateLimitMap = new Map<string, { count: number; resetTime: number }>();
  private readonly maxEventsPerSecond = 1000; // Max 1000 events per second per source
  private readonly rateLimitWindow = 1000; // 1 second window

  constructor(
    private readonly eventEmitter: EventEmitter2,
    @Inject('LOGGING_SERVICE')
    private readonly loggingService: LoggingService,
    @Inject('CACHE_SERVICE')
    private readonly cacheService: CacheService,
    @Optional()
    @Inject(forwardRef(() => CircuitBreakerService))
    private readonly circuitBreakerService?: CircuitBreakerService
  ) {}

  async onModuleInit() {
    await this.initializeEnterpriseFeatures();
    this.setupPerformanceMonitoring();
    this.setupEventBuffering();
    this.setupSecurityMonitoring();

    // Subscribe to all events for logging (simple API compatibility)
    const emitterWithOnAny = this.eventEmitter as EventEmitter2 & {
      onAny: (listener: (event: string, ...args: unknown[]) => void) => void;
    };

    if (emitterWithOnAny.onAny && typeof emitterWithOnAny.onAny === 'function') {
      emitterWithOnAny.onAny((event: string, ...args: unknown[]) => {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          `Event emitted: ${event}`,
          'EventService',
          { args }
        );
      });
    }
  }

  async onModuleDestroy() {
    await this.cleanup();
  }

  private async initializeEnterpriseFeatures() {
    // Initialize enterprise event storage
    await this.cacheService.set('event_service:initialized', Date.now().toString());

    // Setup event indexing for fast queries
    await this.createEventIndices();

    // Initialize metrics
    this.resetMetrics();

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Event Service initialized with A++ grade enterprise features',
      'EventService'
    );
  }

  private async createEventIndices() {
    try {
      // Create sorted sets for efficient querying
      await this.cacheService.zadd('events:by_timestamp', Date.now(), 'init');
      await this.cacheService.zadd('events:by_priority', 1, 'init');
      await this.cacheService.zadd('events:by_category', 1, 'init');
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to create event indices',
        'EventService',
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }

  private setupPerformanceMonitoring() {
    this.performanceInterval = setInterval(() => {
      this.collectPerformanceMetrics();
    }, 30000); // Every 30 seconds

    this.cleanupInterval = setInterval(() => {
      void (async () => {
        await this.cleanupExpiredEvents();
      })();
    }, 300000); // Every 5 minutes
  }

  private setupEventBuffering() {
    this.bufferFlushInterval = setInterval(() => {
      void (async () => {
        if (this.eventBuffer.length > 0) {
          await this.flushEventBuffer();
        }
      })();
    }, 5000); // Flush buffer every 5 seconds
  }

  private setupSecurityMonitoring() {
    // Clean up rate limit map every minute
    setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this.rateLimitMap.entries()) {
        if (now > value.resetTime) {
          this.rateLimitMap.delete(key);
        }
      }
    }, 60000); // Every minute
  }

  /**
   * Check rate limit for event emission
   */
  private checkRateLimit(source: string): boolean {
    const now = Date.now();
    const key = `rate_limit:${source}`;
    const current = this.rateLimitMap.get(key);

    if (!current || now > current.resetTime) {
      this.rateLimitMap.set(key, {
        count: 1,
        resetTime: now + this.rateLimitWindow,
      });
      return true;
    }

    if (current.count >= this.maxEventsPerSecond) {
      void this.loggingService.log(
        LogType.SECURITY,
        LogLevel.WARN,
        'Event rate limit exceeded',
        'EventService',
        {
          source,
          count: current.count,
          limit: this.maxEventsPerSecond,
        }
      );
      return false;
    }

    current.count++;
    return true;
  }

  // ===== SIMPLE API METHODS =====

  /**
   * Emit an event synchronously (simple API)
   * @param event - Event name
   * @param payload - Event payload data
   * @returns Promise that resolves when event is emitted
   * @example
   * ```typescript
   * await eventService.emit('user.created', { userId: '123' });
   * ```
   */
  async emit(event: string, payload: unknown): Promise<void> {
    await this.emitEnterprise(event, {
      eventId: this.generateEventId(),
      eventType: event,
      category: EventCategory.SYSTEM,
      priority: EventPriority.NORMAL,
      timestamp: new Date().toISOString(),
      source: 'EventService',
      version: '1.0.0',
      payload,
    } as EnterpriseEventPayload);
  }

  /**
   * Emit an event asynchronously (simple API)
   * @param event - Event name
   * @param payload - Event payload data
   * @returns Promise that resolves when event is emitted
   * @example
   * ```typescript
   * await eventService.emitAsync('user.updated', { userId: '123' });
   * ```
   */
  async emitAsync(event: string, payload: unknown): Promise<void> {
    await this.emitEnterprise(
      event,
      {
        eventId: this.generateEventId(),
        eventType: event,
        category: EventCategory.SYSTEM,
        priority: EventPriority.NORMAL,
        timestamp: new Date().toISOString(),
        source: 'EventService',
        version: '1.0.0',
        payload,
      } as EnterpriseEventPayload,
      { async: true }
    );
  }

  /**
   * Get events with optional filtering (simple API)
   * @param type - Optional event type filter
   * @param startTime - Optional start time filter (ISO string)
   * @param endTime - Optional end time filter (ISO string)
   * @returns Promise resolving to array of events
   * @example
   * ```typescript
   * const events = await eventService.getEvents('user.created', '2023-01-01', '2023-12-31');
   * ```
   */
  async getEvents(type?: string, startTime?: string, endTime?: string): Promise<unknown[]> {
    try {
      const filter: EventFilter = {};
      if (type) {
        // Filter by event type
        filter.eventType = type;
      }
      if (startTime) {
        filter.startTime = startTime;
      }
      if (endTime) {
        filter.endTime = endTime;
      }

      const results = await this.queryEvents(filter);
      // EnterpriseEventPayload IS the payload itself (not wrapped in a payload property)
      // Return the full event objects as they contain all the event data
      return results as unknown[];
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to retrieve events',
        'EventService',
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          type,
          startTime,
          endTime,
        }
      );
      return [];
    }
  }

  /**
   * Clear all stored events from cache
   * @returns Promise resolving to success status
   * @example
   * ```typescript
   * const result = await eventService.clearEvents();
   * ```
   */
  async clearEvents(): Promise<{ success: boolean; message: string }> {
    try {
      // Clear all event indices
      await this.cacheService.del('events:by_timestamp');
      await this.cacheService.del('events:by_priority');
      await this.cacheService.del('events:by_category');
      await this.cacheService.del('events:priority_queue');
      await this.cacheService.del('events');

      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        'Events cleared successfully',
        'EventService',
        {}
      );
      return { success: true, message: 'Events cleared successfully' };
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to clear events',
        'EventService',
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );

      throw new HealthcareError(
        ErrorCode.EVENT_PROCESSING_FAILED,
        'Failed to clear events',
        HttpStatus.INTERNAL_SERVER_ERROR,
        { operation: 'clearEvents' },
        'EventService.clearEvents'
      );
    }
  }

  /**
   * Subscribe to an event
   * @param event - Event name to subscribe to
   * @param listener - Event listener function
   * @example
   * ```typescript
   * eventService.on('user.created', (user) => console.log('User created:', user));
   * ```
   */
  on(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.on(event, listener);
  }

  /**
   * Subscribe to an event once
   * @param event - Event name to subscribe to
   * @param listener - Event listener function
   * @example
   * ```typescript
   * eventService.once('app.ready', () => console.log('App is ready'));
   * ```
   */
  once(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.once(event, listener);
  }

  /**
   * Unsubscribe from an event
   * @param event - Event name to unsubscribe from
   * @param listener - Event listener function to remove
   * @example
   * ```typescript
   * eventService.off('user.created', listenerFunction);
   * ```
   */
  off(event: string, listener: (...args: unknown[]) => void): void {
    this.eventEmitter.off(event, listener);
  }

  /**
   * Remove all listeners for an event or all events
   * @param event - Optional event name, if not provided removes all listeners
   * @example
   * ```typescript
   * eventService.removeAllListeners('user.created');
   * ```
   */
  removeAllListeners(event?: string): void {
    this.eventEmitter.removeAllListeners(event);
  }

  /**
   * Subscribe to all events (wildcard listener)
   * This method allows listening to all events emitted through EventService
   * Useful for services that need to react to any event (e.g., socket broadcasting, audit logging)
   * @param listener - Event listener function that receives (event, ...args)
   * @example
   * ```typescript
   * eventService.onAny((event, ...args) => {
   *   console.log('Event emitted:', event, args);
   * });
   * ```
   */
  onAny(listener: (event: string | string[], ...args: unknown[]) => void): void {
    const emitterWithOnAny = this.eventEmitter as EventEmitter2 & {
      onAny: (listener: (event: string | string[], ...args: unknown[]) => void) => void;
    };
    if (emitterWithOnAny.onAny && typeof emitterWithOnAny.onAny === 'function') {
      emitterWithOnAny.onAny(listener);
    } else {
      // Fallback: Subscribe to wildcard pattern if onAny is not available
      this.eventEmitter.on('**', listener);
    }
  }

  // ===== ENTERPRISE API METHODS =====

  /**
   * Emit enterprise-grade event with full feature set
   */
  async emitEnterprise<T extends EnterpriseEventPayload>(
    eventType: string,
    payload: T,
    options?: {
      priority?: EventPriority;
      retryPolicy?: { maxRetries: number; retryDelay: number };
      async?: boolean;
      timeout?: number;
    }
  ): Promise<EventResult> {
    const startTime = Date.now();
    const source = payload.source || 'unknown';

    try {
      // Rate limiting check
      if (!this.checkRateLimit(source)) {
        throw new HealthcareError(
          ErrorCode.RATE_LIMIT_EXCEEDED,
          'Event emission rate limit exceeded',
          HttpStatus.TOO_MANY_REQUESTS,
          {
            source,
            eventType,
            limit: this.maxEventsPerSecond,
          },
          'EventService.emitEnterprise'
        );
      }

      // Use CircuitBreakerService if available
      if (this.circuitBreakerService) {
        return await this.circuitBreakerService.execute(
          async () => this.executeEventEmission(eventType, payload, options, startTime),
          {
            name: 'event-emission',
            failureThreshold: 50,
            recoveryTimeout: 60000,
            onStateChange: (state, name) => {
              void this.loggingService.log(
                LogType.SYSTEM,
                LogLevel.WARN,
                `Circuit breaker state changed: ${state}`,
                'EventService',
                { circuitBreakerName: name, state }
              );
            },
          }
        );
      }

      // Fallback to direct execution if CircuitBreakerService not available
      return await this.executeEventEmission(eventType, payload, options, startTime);
    } catch (error) {
      return this.handleEventFailure(error, payload, startTime);
    }
  }

  /**
   * Query events with advanced filtering and pagination
   */
  async queryEvents(filter: EventFilter): Promise<EnterpriseEventPayload[]> {
    try {
      const startTime = Date.now();
      let eventIds: string[] = [];

      // Build query based on filters
      if (filter.category && filter.category.length > 0) {
        eventIds = await this.queryByCategory(filter);
      } else if (filter.userId) {
        eventIds = await this.queryByUser(filter);
      } else if (filter.clinicId) {
        eventIds = await this.queryByClinic(filter);
      } else {
        eventIds = await this.queryByTimeRange(filter);
      }

      // Apply pagination
      const offset = filter.offset || 0;
      const limit = Math.min(filter.limit || 100, 1000); // Max 1000 events per query
      const paginatedIds = eventIds.slice(offset, offset + limit);

      // Fetch events
      const events: EnterpriseEventPayload[] = [];
      for (const eventId of paginatedIds) {
        try {
          const eventData = await this.cacheService.get<string>(`event:${eventId}`);
          if (eventData) {
            const parsedEvent = JSON.parse(eventData) as EnterpriseEventPayload;
            // Filter by eventType if provided
            if (filter.eventType && parsedEvent.eventType !== filter.eventType) {
              continue;
            }
            events.push(parsedEvent);
          }
        } catch (_error) {
          // Skip corrupted events
          continue;
        }
      }

      // Log query performance
      const queryTime = Date.now() - startTime;
      void this.loggingService.log(
        LogType.PERFORMANCE,
        LogLevel.INFO,
        'Event query executed',
        'EventService',
        {
          queryTime,
          resultCount: events.length,
          totalFound: eventIds.length,
          filter: JSON.stringify(filter),
        }
      );

      return events;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to query events',
        'EventService',
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          filter,
        }
      );
      return [];
    }
  }

  /**
   * Get comprehensive event metrics
   */
  async getEventMetrics(): Promise<EventMetrics> {
    try {
      const totalEvents = await this.cacheService.zcard('events:by_timestamp');
      const avgProcessingTime =
        this.processedEvents > 0 ? this.totalProcessingTime / this.processedEvents : 0;

      const metrics: EventMetrics = {
        totalEvents,
        eventsPerSecond: this.calculateEventsPerSecond(),
        avgProcessingTime,
        eventsByCategory: await this.getEventsByCategory(),
        eventsByPriority: await this.getEventsByPriority(),
        eventsByStatus: await this.getEventsByStatus(),
        failureRate:
          this.processedEvents > 0 ? (this.failedEvents / this.processedEvents) * 100 : 0,
        retryRate: 0, // TODO: Implement retry tracking
        errorDistribution: await this.getErrorDistribution(),
      };

      return metrics;
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to get event metrics',
        'EventService',
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );

      return {
        totalEvents: 0,
        eventsPerSecond: 0,
        avgProcessingTime: 0,
        eventsByCategory: {} as Record<EventCategory, number>,
        eventsByPriority: {} as Record<EventPriority, number>,
        eventsByStatus: {} as Record<EventStatus, number>,
        failureRate: 0,
        retryRate: 0,
        errorDistribution: {},
      };
    }
  }

  // ===== PRIVATE HELPER METHODS =====

  /**
   * Execute event emission with all enterprise features
   */
  private async executeEventEmission<T extends EnterpriseEventPayload>(
    eventType: string,
    payload: T,
    options:
      | {
          priority?: EventPriority;
          retryPolicy?: { maxRetries: number; retryDelay: number };
          async?: boolean;
          timeout?: number;
        }
      | undefined,
    startTime: number
  ): Promise<EventResult> {
    // Validate event payload
    this.validateEventPayload(payload);

    // Create enriched event payload
    const enrichedPayload: EnterpriseEventPayload = {
      ...payload,
      eventId: payload.eventId || this.generateEventId(),
      eventType,
      timestamp: payload.timestamp || new Date().toISOString(),
      source: payload.source || 'EventService',
      version: payload.version || '1.0.0',
      priority: options?.priority || payload.priority || EventPriority.NORMAL,
      correlationId: payload.correlationId || this.generateCorrelationId(),
      traceId: payload.traceId || this.generateTraceId(),
    };

    // Security: Log security-sensitive events
    if (
      enrichedPayload.category === EventCategory.SECURITY ||
      enrichedPayload.category === EventCategory.AUTHENTICATION ||
      enrichedPayload.category === EventCategory.AUTHORIZATION
    ) {
      void this.loggingService.logSecurity(enrichedPayload.eventType, {
        eventId: enrichedPayload.eventId,
        userId: enrichedPayload.userId,
        clinicId: enrichedPayload.clinicId,
        source: enrichedPayload.source,
        priority: enrichedPayload.priority,
      });
    }

    // Add to buffer for batch processing
    if (this.eventBuffer.length < this.maxBufferSize) {
      this.eventBuffer.push(enrichedPayload);
    } else {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.WARN,
        'Event buffer full, dropping event',
        'EventService',
        {
          eventId: enrichedPayload.eventId,
          eventType,
          bufferSize: this.eventBuffer.length,
        }
      );
    }

    // Immediate processing for high priority events
    if (
      enrichedPayload.priority === EventPriority.CRITICAL ||
      enrichedPayload.priority === EventPriority.EMERGENCY
    ) {
      await this.processEventImmediate(enrichedPayload);
    }

    // Emit the event through NestJS EventEmitter2
    if (options?.async) {
      await this.eventEmitter.emitAsync(eventType, enrichedPayload);
    } else {
      this.eventEmitter.emit(eventType, enrichedPayload);
    }

    // Store in distributed cache with TTL
    await this.storeEventInCache(enrichedPayload);

    // Update metrics
    this.processedEvents++;
    this.totalProcessingTime += Date.now() - startTime;

    // Log successful event emission
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.DEBUG,
      'Event emitted successfully',
      'EventService',
      {
        eventId: enrichedPayload.eventId,
        eventType,
        category: enrichedPayload.category,
        priority: enrichedPayload.priority,
        processingTime: Date.now() - startTime,
      }
    );

    return {
      success: true,
      eventId: enrichedPayload.eventId,
      result: enrichedPayload,
      processingTime: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Validate event payload for security and compliance
   */
  private validateEventPayload(payload: EnterpriseEventPayload): void {
    // Validate required fields
    if (!payload.eventType && !payload.category) {
      throw new HealthcareError(
        ErrorCode.VALIDATION_REQUIRED_FIELD,
        'Event payload must have eventType or category',
        HttpStatus.BAD_REQUEST,
        { payload },
        'EventService.validateEventPayload'
      );
    }

    // Validate payload size (max 1MB)
    const payloadSize = JSON.stringify(payload).length;
    const maxSize = 1024 * 1024; // 1MB
    if (payloadSize > maxSize) {
      throw new HealthcareError(
        ErrorCode.VALIDATION_REQUIRED_FIELD,
        `Event payload too large: ${payloadSize} bytes (max: ${maxSize})`,
        HttpStatus.BAD_REQUEST,
        { payloadSize, maxSize },
        'EventService.validateEventPayload'
      );
    }

    // Validate PHI data handling for healthcare events
    if (
      payload.category === EventCategory.MEDICAL_RECORD ||
      payload.category === EventCategory.PATIENT ||
      payload.category === EventCategory.HIPAA
    ) {
      if (!payload.clinicId && !payload.userId) {
        void this.loggingService.log(
          LogType.SECURITY,
          LogLevel.WARN,
          'PHI event missing clinicId or userId',
          'EventService',
          {
            eventType: payload.eventType,
            category: payload.category,
          }
        );
      }
    }
  }

  /**
   * Handle event emission failure
   */
  private handleEventFailure(
    error: unknown,
    payload: EnterpriseEventPayload | undefined,
    startTime: number
  ): EventResult {
    this.failedEvents++;

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    void this.loggingService.log(
      LogType.ERROR,
      LogLevel.ERROR,
      'Event emission failed',
      'EventService',
      {
        error: errorMessage,
        stack: errorStack,
        eventId: payload?.eventId || 'unknown',
        eventType: payload?.eventType || 'unknown',
        processingTime: Date.now() - startTime,
      }
    );

    return {
      success: false,
      eventId: payload?.eventId || 'unknown',
      error: {
        code: 'EVENT_PROCESSING_ERROR',
        message: errorMessage,
        ...(errorStack && { stack: errorStack }),
        retryable: true,
      },
      processingTime: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    };
  }

  private async processEventImmediate(event: EnterpriseEventPayload) {
    try {
      // Store immediately for critical events
      await this.cacheService.set(
        `event:critical:${event.eventId}`,
        JSON.stringify(event),
        3600 // 1 hour TTL for critical events
      );

      // Add to priority queue
      await this.cacheService.zadd(
        'events:priority_queue',
        this.getPriorityScore(event.priority),
        event.eventId
      );

      // Log critical event
      void (this.loggingService.logPhiAccess(
        event.userId || 'system',
        'EVENT_PROCESSOR',
        event.clinicId || 'unknown',
        'CREATE',
        {
          resource: event.eventType,
          outcome: 'SUCCESS',
        }
      ) as unknown as Promise<void>);
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to process critical event immediately',
        'EventService',
        {
          eventId: event.eventId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }

  private async storeEventInCache(event: EnterpriseEventPayload) {
    try {
      const eventKey = `event:${event.eventId}`;
      const categoryKey = `events:category:${event.category}`;
      const userKey = event.userId ? `events:user:${event.userId}` : null;
      const clinicKey = event.clinicId ? `events:clinic:${event.clinicId}` : null;

      // Store event with TTL based on priority
      const ttl = this.getTTLByPriority(event.priority);
      await this.cacheService.set(eventKey, JSON.stringify(event), ttl);

      // Add to indices
      const timestamp = new Date(event.timestamp).getTime();
      await this.cacheService.zadd('events:by_timestamp', timestamp, event.eventId);
      await this.cacheService.zadd(
        'events:by_priority',
        this.getPriorityScore(event.priority),
        event.eventId
      );
      await this.cacheService.zadd(categoryKey, timestamp, event.eventId);

      if (userKey) {
        await this.cacheService.zadd(userKey, timestamp, event.eventId);
      }

      if (clinicKey) {
        await this.cacheService.zadd(clinicKey, timestamp, event.eventId);
      }
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to store event in cache',
        'EventService',
        {
          eventId: event.eventId,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }

  private async flushEventBuffer() {
    if (this.eventBuffer.length === 0) return;

    try {
      const events = [...this.eventBuffer];
      this.eventBuffer.length = 0; // Clear buffer

      // Batch process events
      const pipeline: Array<{ command: string; args: unknown[] }> = [];
      for (const event of events) {
        if (
          event.priority !== EventPriority.CRITICAL &&
          event.priority !== EventPriority.EMERGENCY
        ) {
          pipeline.push({
            command: 'SET',
            args: [
              `event:${event.eventId}`,
              JSON.stringify(event),
              'EX',
              this.getTTLByPriority(event.priority),
            ],
          });
          pipeline.push({
            command: 'ZADD',
            args: ['events:by_timestamp', new Date(event.timestamp).getTime(), event.eventId],
          });
        }
      }

      if (pipeline.length > 0) {
        // Execute batch operations
        await this.cacheService.multi(pipeline);
      }

      void this.loggingService.log(
        LogType.PERFORMANCE,
        LogLevel.INFO,
        `Flushed ${events.length} events from buffer`,
        'EventService',
        {
          batchSize: events.length,
          bufferUtilization: (events.length / this.maxBufferSize) * 100,
        }
      );
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to flush event buffer',
        'EventService',
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          bufferSize: this.eventBuffer.length,
        }
      );
    }
  }

  private async queryByCategory(filter: EventFilter): Promise<string[]> {
    const results: string[] = [];
    for (const category of filter.category || []) {
      const categoryKey = `events:category:${category}`;
      const ids = await this.cacheService.zrevrange(categoryKey, 0, -1);
      results.push(...ids);
    }
    return Array.from(new Set(results)); // Remove duplicates
  }

  private async queryByUser(filter: EventFilter): Promise<string[]> {
    return await this.cacheService.zrevrange(`events:user:${filter.userId}`, 0, -1);
  }

  private async queryByClinic(filter: EventFilter): Promise<string[]> {
    return await this.cacheService.zrevrange(`events:clinic:${filter.clinicId}`, 0, -1);
  }

  private async queryByTimeRange(filter: EventFilter): Promise<string[]> {
    const start = filter.startTime ? new Date(filter.startTime).getTime() : 0;
    const end = filter.endTime ? new Date(filter.endTime).getTime() : Date.now();
    return await this.cacheService.zrangebyscore('events:by_timestamp', start, end);
  }

  private async getEventsByCategory(): Promise<Record<EventCategory, number>> {
    const categories = {} as Record<EventCategory, number>;
    for (const category of Object.values(EventCategory)) {
      const count = await this.cacheService.zcard(`events:category:${category}`);
      categories[category] = count;
    }
    return categories;
  }

  private getEventsByPriority(): Promise<Record<EventPriority, number>> {
    // TODO: Implement priority counting
    return Promise.resolve({} as Record<EventPriority, number>);
  }

  private getEventsByStatus(): Promise<Record<EventStatus, number>> {
    // TODO: Implement status counting
    return Promise.resolve({} as Record<EventStatus, number>);
  }

  private getErrorDistribution(): Promise<Record<string, number>> {
    // TODO: Implement error distribution tracking
    return Promise.resolve({});
  }

  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateCorrelationId(): string {
    return `cor_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateTraceId(): string {
    return `trc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getPriorityScore(priority: EventPriority): number {
    const scores = {
      [EventPriority.LOW]: 1,
      [EventPriority.NORMAL]: 2,
      [EventPriority.HIGH]: 3,
      [EventPriority.CRITICAL]: 4,
      [EventPriority.EMERGENCY]: 5,
    };
    return scores[priority] || 2;
  }

  private getTTLByPriority(priority: EventPriority): number {
    const ttls = {
      [EventPriority.LOW]: 3600, // 1 hour
      [EventPriority.NORMAL]: 7200, // 2 hours
      [EventPriority.HIGH]: 14400, // 4 hours
      [EventPriority.CRITICAL]: 43200, // 12 hours
      [EventPriority.EMERGENCY]: 86400, // 24 hours
    };
    return ttls[priority] || 7200;
  }

  private calculateEventsPerSecond(): number {
    // Simple calculation - in production, use a sliding window
    return this.processedEvents / 60; // Assuming 1 minute window
  }

  private collectPerformanceMetrics() {
    const metrics = {
      timestamp: Date.now(),
      processedEvents: this.processedEvents,
      failedEvents: this.failedEvents,
      bufferSize: this.eventBuffer.length,
      bufferUtilization: (this.eventBuffer.length / this.maxBufferSize) * 100,
      avgProcessingTime:
        this.processedEvents > 0 ? this.totalProcessingTime / this.processedEvents : 0,
    };

    this.metricsBuffer.push(metrics);

    // Keep only last 100 metrics points
    if (this.metricsBuffer.length > 100) {
      this.metricsBuffer = this.metricsBuffer.slice(-100);
    }
  }

  private async cleanupExpiredEvents() {
    try {
      const expiredTime = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days ago
      const expiredIds = await this.cacheService.zrangebyscore(
        'events:by_timestamp',
        0,
        expiredTime
      );

      if (expiredIds.length > 0) {
        // Remove expired events
        for (const eventId of expiredIds) {
          await this.cacheService.del(`event:${eventId}`);
        }

        await this.cacheService.zremrangebyscore('events:by_timestamp', 0, expiredTime);

        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          `Cleaned up ${expiredIds.length} expired events`,
          'EventService'
        );
      }
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to cleanup expired events',
        'EventService',
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }

  private resetMetrics(): void {
    this.processedEvents = 0;
    this.failedEvents = 0;
    this.totalProcessingTime = 0;
    this.metricsBuffer = [];
  }

  private async cleanup() {
    if (this.performanceInterval) {
      clearInterval(this.performanceInterval);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    if (this.bufferFlushInterval) {
      clearInterval(this.bufferFlushInterval);
    }

    // Final buffer flush
    if (this.eventBuffer.length > 0) {
      await this.flushEventBuffer();
    }
  }
}
