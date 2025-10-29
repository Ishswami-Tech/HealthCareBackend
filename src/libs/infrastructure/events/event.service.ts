import { Injectable, OnModuleInit } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { LoggingService } from "../logging/logging.service";
import { LogLevel, LogType } from "../logging/types/logging.types";
import { RedisService } from "../cache/redis/redis.service";

/**
 * Event service for managing application events
 * @class EventService
 * @description Provides event emission, subscription, and persistence capabilities
 * @example
 * ```typescript
 * await eventService.emit('user.created', { userId: '123', email: 'user@example.com' });
 * ```
 */
@Injectable()
export class EventService implements OnModuleInit {
  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly loggingService: LoggingService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Initialize event service and set up event logging
   */
  onModuleInit() {
    // Subscribe to all events for logging
    // @ts-expect-error - EventEmitter2 onAny method typing issue
    this.eventEmitter.onAny((event: string, ...args: unknown[]) => {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Event emitted: ${event}`,
        "EventService",
        { args },
      );
    });
  }

  /**
   * Emit an event synchronously
   * @param event - Event name
   * @param payload - Event payload data
   * @returns Promise that resolves when event is emitted
   * @example
   * ```typescript
   * await eventService.emit('user.created', { userId: '123' });
   * ```
   */
  async emit(event: string, payload: unknown): Promise<void> {
    const eventData = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: event,
      timestamp: new Date().toISOString(),
      payload,
    };

    // Store event in Redis
    await this.redisService.rPush("events", JSON.stringify(eventData));
    // Keep only last 1000 events
    await this.redisService.lTrim("events", -1000, -1);

    // Emit the event
    this.eventEmitter.emit(event, payload);
  }

  /**
   * Emit an event asynchronously
   * @param event - Event name
   * @param payload - Event payload data
   * @returns Promise that resolves when event is emitted
   * @example
   * ```typescript
   * await eventService.emitAsync('user.updated', { userId: '123' });
   * ```
   */
  async emitAsync(event: string, payload: unknown): Promise<void> {
    const eventData = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: event,
      timestamp: new Date().toISOString(),
      payload,
    };

    // Store event in Redis
    await this.redisService.rPush("events", JSON.stringify(eventData));
    // Keep only last 1000 events
    await this.redisService.lTrim("events", -1000, -1);

    // Emit the event
    await this.eventEmitter.emitAsync(event, payload);
  }

  /**
   * Get events with optional filtering
   * @param type - Optional event type filter
   * @param startTime - Optional start time filter (ISO string)
   * @param endTime - Optional end time filter (ISO string)
   * @returns Promise resolving to array of events
   * @example
   * ```typescript
   * const events = await eventService.getEvents('user.created', '2023-01-01', '2023-12-31');
   * ```
   */
  async getEvents(
    type?: string,
    startTime?: string,
    endTime?: string,
  ): Promise<unknown[]> {
    try {
      // Get events from Redis
      const redisEvents = await this.redisService.lRange("events", 0, -1);
      let events = redisEvents.map((event) => JSON.parse(event) as unknown);

      // Apply filters
      if (type || startTime || endTime) {
        events = events.filter((event) => {
          const eventObj = event as { timestamp: string; type: string };
          const eventTime = new Date(eventObj.timestamp);
          const matchesType = !type || eventObj.type === type;
          const matchesStartTime =
            !startTime || eventTime >= new Date(startTime);
          const matchesEndTime = !endTime || eventTime <= new Date(endTime);
          return matchesType && matchesStartTime && matchesEndTime;
        });
      }

      // Sort by timestamp descending
      return events.sort((a, b) => {
        const aEvent = a as { timestamp: string };
        const bEvent = b as { timestamp: string };
        return (
          new Date(bEvent.timestamp).getTime() -
          new Date(aEvent.timestamp).getTime()
        );
      });
    } catch (error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        "Failed to retrieve events",
        "EventService",
        { error: (error as Error).message },
      );
      return [];
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
   * Clear all stored events from Redis
   * @returns Promise resolving to success status
   * @example
   * ```typescript
   * const result = await eventService.clearEvents();
   * console.log(result.message);
   * ```
   */
  async clearEvents(): Promise<{ success: boolean; message: string }> {
    try {
      await this.redisService.del("events");
      return { success: true, message: "Events cleared successfully" };
    } catch (error) {
      console.error("Error clearing events:", error);
      throw new Error("Failed to clear events");
    }
  }
}
