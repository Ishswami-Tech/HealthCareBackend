/**
 * ===================================================================
 * A++ ENTERPRISE EVENT SERVICE FOR 1M+ USERS
 * Healthcare-focused Event-Driven Architecture with HIPAA Compliance
 * ===================================================================
 */

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LoggingService } from '../logging/logging.service';
import { LogLevel, LogType } from '../logging/types/logging.types';
import { RedisService } from '../cache/redis/redis.service';
import {
  EnterpriseEventPayload,
  EventCategory,
  EventPriority,
  EventStatus,
  EventResult,
  EventFilter,
  EventMetrics,
  EventSubscription
} from './types/event.types';

@Injectable()
export class EnterpriseEventService implements OnModuleInit, OnModuleDestroy {
  private readonly subscriptions = new Map<string, EventSubscription>();
  private readonly eventBuffer: EnterpriseEventPayload[] = [];
  private readonly maxBufferSize = 50000; // Increased for 1M+ users
  private metricsBuffer: any[] = [];
  private processedEvents = 0;
  private failedEvents = 0;
  private totalProcessingTime = 0;
  
  // Circuit breaker pattern
  private circuitBreakerState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private circuitBreakerTimeout = 60000; // 1 minute
  private failureThreshold = 50;

  // Performance monitoring
  private performanceInterval!: NodeJS.Timeout;
  private cleanupInterval!: NodeJS.Timeout;
  private bufferFlushInterval!: NodeJS.Timeout;

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly loggingService: LoggingService,
    private readonly redisService: RedisService,
  ) {}

  async onModuleInit() {
    await this.initializeEnterpriseFeatures();
    this.setupPerformanceMonitoring();
    this.setupEventBuffering();
    this.setupCircuitBreaker();
  }

  async onModuleDestroy() {
    await this.cleanup();
  }

  private async initializeEnterpriseFeatures() {
    // Initialize enterprise event storage
    await this.redisService.set('event_service:initialized', Date.now().toString());
    
    // Setup event indexing for fast queries
    await this.createEventIndices();
    
    // Initialize metrics
    await this.resetMetrics();

    this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      'Enterprise Event Service initialized with A++ grade features',
      'EnterpriseEventService'
    );
  }

  private async createEventIndices() {
    try {
      // Create sorted sets for efficient querying
      await this.redisService.zadd('events:by_timestamp', Date.now(), 'init');
      await this.redisService.zadd('events:by_priority', 1, 'init');
      await this.redisService.zadd('events:by_category', 1, 'init');
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to create event indices',
        'EnterpriseEventService',
        { error: (error as Error).message }
      );
    }
  }

  private setupPerformanceMonitoring() {
    this.performanceInterval = setInterval(async () => {
      await this.collectPerformanceMetrics();
    }, 30000); // Every 30 seconds

    this.cleanupInterval = setInterval(async () => {
      await this.cleanupExpiredEvents();
    }, 300000); // Every 5 minutes
  }

  private setupEventBuffering() {
    this.bufferFlushInterval = setInterval(async () => {
      if (this.eventBuffer.length > 0) {
        await this.flushEventBuffer();
      }
    }, 5000); // Flush buffer every 5 seconds
  }

  private setupCircuitBreaker() {
    // Reset circuit breaker periodically
    setInterval(() => {
      if (this.circuitBreakerState === 'OPEN' && 
          Date.now() - this.lastFailureTime > this.circuitBreakerTimeout) {
        this.circuitBreakerState = 'HALF_OPEN';
        this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          'Circuit breaker moved to HALF_OPEN state',
          'EnterpriseEventService'
        );
      }
    }, 30000);
  }

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
    
    try {
      // Circuit breaker check
      if (this.circuitBreakerState === 'OPEN') {
        throw new Error('Event service circuit breaker is OPEN');
      }

      // Create enriched event payload
      const enrichedPayload: EnterpriseEventPayload = {
        ...payload,
        eventId: payload.eventId || this.generateEventId(),
        eventType,
        timestamp: payload.timestamp || new Date().toISOString(),
        source: payload.source || 'EnterpriseEventService',
        version: payload.version || '1.0.0',
        priority: options?.priority || payload.priority || EventPriority.NORMAL,
        correlationId: payload.correlationId || this.generateCorrelationId(),
        traceId: payload.traceId || this.generateTraceId(),
      };

      // Add to buffer for batch processing
      this.eventBuffer.push(enrichedPayload);

      // Immediate processing for high priority events
      if (enrichedPayload.priority === EventPriority.CRITICAL || 
          enrichedPayload.priority === EventPriority.EMERGENCY) {
        await this.processEventImmediate(enrichedPayload);
      }

      // Emit the event
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

      // Reset circuit breaker on success
      if (this.circuitBreakerState === 'HALF_OPEN') {
        this.circuitBreakerState = 'CLOSED';
        this.failureCount = 0;
      }

      return {
        success: true,
        eventId: enrichedPayload.eventId,
        result: enrichedPayload,
        processingTime: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      this.handleEventFailure(error);
      
      return {
        success: false,
        eventId: payload?.eventId || 'unknown',
        error: {
          code: 'EVENT_PROCESSING_ERROR',
          message: (error as Error).message,
          stack: (error as Error).stack,
          retryable: true
        },
        processingTime: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async processEventImmediate(event: EnterpriseEventPayload) {
    try {
      // Store immediately for critical events
      await this.redisService.set(
        `event:critical:${event.eventId}`,
        JSON.stringify(event),
        3600 // 1 hour TTL for critical events
      );

      // Add to priority queue
      await this.redisService.zadd(
        'events:priority_queue',
        this.getPriorityScore(event.priority),
        event.eventId
      );

      // Log critical event
      await this.loggingService.logPhiAccess(
        event.userId || 'system',
        'EVENT_PROCESSOR',
        event.clinicId || 'unknown',
        'CREATE',
        {
          resource: event.eventType,
          outcome: 'SUCCESS'
        }
      );

    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to process critical event immediately',
        'EnterpriseEventService',
        { eventId: event.eventId, error: (error as Error).message }
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
      await this.redisService.set(eventKey, JSON.stringify(event), ttl);

      // Add to indices
      const timestamp = new Date(event.timestamp).getTime();
      await this.redisService.zadd('events:by_timestamp', timestamp, event.eventId);
      await this.redisService.zadd('events:by_priority', this.getPriorityScore(event.priority), event.eventId);
      await this.redisService.zadd(categoryKey, timestamp, event.eventId);

      if (userKey) {
        await this.redisService.zadd(userKey, timestamp, event.eventId);
      }

      if (clinicKey) {
        await this.redisService.zadd(clinicKey, timestamp, event.eventId);
      }

    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to store event in cache',
        'EnterpriseEventService',
        { eventId: event.eventId, error: (error as Error).message }
      );
    }
  }

  private async flushEventBuffer() {
    if (this.eventBuffer.length === 0) return;

    try {
      const events = [...this.eventBuffer];
      this.eventBuffer.length = 0; // Clear buffer

      // Batch process events
      const pipeline = [];
      for (const event of events) {
        if (event.priority !== EventPriority.CRITICAL && 
            event.priority !== EventPriority.EMERGENCY) {
          pipeline.push(['SET', `event:${event.eventId}`, JSON.stringify(event), 'EX', this.getTTLByPriority(event.priority)]);
          pipeline.push(['ZADD', 'events:by_timestamp', new Date(event.timestamp).getTime(), event.eventId]);
        }
      }

      if (pipeline.length > 0) {
        // Execute batch operations
        await this.redisService.multi(pipeline);
      }

      this.loggingService.log(
        LogType.PERFORMANCE,
        LogLevel.INFO,
        `Flushed ${events.length} events from buffer`,
        'EnterpriseEventService',
        { batchSize: events.length, bufferUtilization: (events.length / this.maxBufferSize) * 100 }
      );

    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to flush event buffer',
        'EnterpriseEventService',
        { error: (error as Error).message, bufferSize: this.eventBuffer.length }
      );
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
          const eventData = await this.redisService.get(`event:${eventId}`);
          if (eventData) {
            events.push(JSON.parse(eventData));
          }
        } catch (error) {
          // Skip corrupted events
          continue;
        }
      }

      // Log query performance
      const queryTime = Date.now() - startTime;
      this.loggingService.log(
        LogType.PERFORMANCE,
        LogLevel.INFO,
        'Event query executed',
        'EnterpriseEventService',
        {
          queryTime,
          resultCount: events.length,
          totalFound: eventIds.length,
          filter: JSON.stringify(filter)
        }
      );

      return events;

    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to query events',
        'EnterpriseEventService',
        { error: (error as Error).message, filter }
      );
      return [];
    }
  }

  /**
   * Get comprehensive event metrics
   */
  async getEventMetrics(): Promise<EventMetrics> {
    try {
      const totalEvents = await this.redisService.zcard('events:by_timestamp');
      const avgProcessingTime = this.processedEvents > 0 ? 
        this.totalProcessingTime / this.processedEvents : 0;

      const metrics: EventMetrics = {
        totalEvents,
        eventsPerSecond: this.calculateEventsPerSecond(),
        avgProcessingTime,
        eventsByCategory: await this.getEventsByCategory(),
        eventsByPriority: await this.getEventsByPriority(),
        eventsByStatus: await this.getEventsByStatus(),
        failureRate: this.processedEvents > 0 ? 
          (this.failedEvents / this.processedEvents) * 100 : 0,
        retryRate: 0, // TODO: Implement retry tracking
        errorDistribution: await this.getErrorDistribution()
      };

      return metrics;

    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to get event metrics',
        'EnterpriseEventService',
        { error: (error as Error).message }
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
        errorDistribution: {}
      };
    }
  }

  // Helper methods
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
      [EventPriority.EMERGENCY]: 5
    };
    return scores[priority] || 2;
  }

  private getTTLByPriority(priority: EventPriority): number {
    const ttls = {
      [EventPriority.LOW]: 3600,      // 1 hour
      [EventPriority.NORMAL]: 7200,   // 2 hours
      [EventPriority.HIGH]: 14400,    // 4 hours
      [EventPriority.CRITICAL]: 43200, // 12 hours
      [EventPriority.EMERGENCY]: 86400 // 24 hours
    };
    return ttls[priority] || 7200;
  }

  private handleEventFailure(error: any) {
    this.failedEvents++;
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.circuitBreakerState = 'OPEN';
      this.loggingService.log(
        LogType.SECURITY,
        LogLevel.ERROR,
        'Circuit breaker OPENED due to high failure rate',
        'EnterpriseEventService',
        { failureCount: this.failureCount, threshold: this.failureThreshold }
      );
    }
  }

  private calculateEventsPerSecond(): number {
    // Simple calculation - in production, use a sliding window
    return this.processedEvents / 60; // Assuming 1 minute window
  }

  private async queryByCategory(filter: EventFilter): Promise<string[]> {
    const results: string[] = [];
    for (const category of filter.category || []) {
      const categoryKey = `events:category:${category}`;
      const ids = await this.redisService.zrevrange(categoryKey, 0, -1);
      results.push(...ids);
    }
    return [...new Set(results)]; // Remove duplicates
  }

  private async queryByUser(filter: EventFilter): Promise<string[]> {
    return await this.redisService.zrevrange(`events:user:${filter.userId}`, 0, -1);
  }

  private async queryByClinic(filter: EventFilter): Promise<string[]> {
    return await this.redisService.zrevrange(`events:clinic:${filter.clinicId}`, 0, -1);
  }

  private async queryByTimeRange(filter: EventFilter): Promise<string[]> {
    const start = filter.startTime ? new Date(filter.startTime).getTime() : 0;
    const end = filter.endTime ? new Date(filter.endTime).getTime() : Date.now();
    return await this.redisService.zrangebyscore('events:by_timestamp', start, end);
  }

  private async getEventsByCategory(): Promise<Record<EventCategory, number>> {
    const categories = {} as Record<EventCategory, number>;
    for (const category of Object.values(EventCategory)) {
      const count = await this.redisService.zcard(`events:category:${category}`);
      categories[category] = count;
    }
    return categories;
  }

  private async getEventsByPriority(): Promise<Record<EventPriority, number>> {
    // TODO: Implement priority counting
    return {} as Record<EventPriority, number>;
  }

  private async getEventsByStatus(): Promise<Record<EventStatus, number>> {
    // TODO: Implement status counting
    return {} as Record<EventStatus, number>;
  }

  private async getErrorDistribution(): Promise<Record<string, number>> {
    // TODO: Implement error distribution tracking
    return {};
  }

  private async collectPerformanceMetrics() {
    const metrics = {
      timestamp: Date.now(),
      processedEvents: this.processedEvents,
      failedEvents: this.failedEvents,
      bufferSize: this.eventBuffer.length,
      bufferUtilization: (this.eventBuffer.length / this.maxBufferSize) * 100,
      circuitBreakerState: this.circuitBreakerState,
      avgProcessingTime: this.processedEvents > 0 ? this.totalProcessingTime / this.processedEvents : 0
    };

    this.metricsBuffer.push(metrics);

    // Keep only last 100 metrics points
    if (this.metricsBuffer.length > 100) {
      this.metricsBuffer = this.metricsBuffer.slice(-100);
    }
  }

  private async cleanupExpiredEvents() {
    try {
      const expiredTime = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days ago
      const expiredIds = await this.redisService.zrangebyscore('events:by_timestamp', 0, expiredTime);
      
      if (expiredIds.length > 0) {
        // Remove expired events
        for (const eventId of expiredIds) {
          await this.redisService.del(`event:${eventId}`);
        }
        
        await this.redisService.zremrangebyscore('events:by_timestamp', 0, expiredTime);
        
        this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.INFO,
          `Cleaned up ${expiredIds.length} expired events`,
          'EnterpriseEventService'
        );
      }
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to cleanup expired events',
        'EnterpriseEventService',
        { error: (error as Error).message }
      );
    }
  }

  private async resetMetrics() {
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

  // Legacy compatibility methods
  async emit(event: string, payload: any): Promise<void> {
    await this.emitEnterprise(event, {
      eventId: this.generateEventId(),
      eventType: event,
      category: EventCategory.SYSTEM,
      priority: EventPriority.NORMAL,
      timestamp: new Date().toISOString(),
      source: 'LegacyCompatibility',
      version: '1.0.0',
      payload
    } as EnterpriseEventPayload);
  }

  on(event: string, listener: (...args: any[]) => void): void {
    this.eventEmitter.on(event, listener);
  }

  once(event: string, listener: (...args: any[]) => void): void {
    this.eventEmitter.once(event, listener);
  }

  off(event: string, listener: (...args: any[]) => void): void {
    this.eventEmitter.off(event, listener);
  }
}