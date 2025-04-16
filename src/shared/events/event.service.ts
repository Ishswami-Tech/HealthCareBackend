import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LoggingService } from '../logging/logging.service';
import { LogLevel, LogType } from '../logging/types/logging.types';
import { RedisService } from '../cache/redis/redis.service';

@Injectable()
export class EventService implements OnModuleInit {
  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly loggingService: LoggingService,
    private readonly redisService: RedisService,
  ) {}

  onModuleInit() {
    // Subscribe to all events for logging
    this.eventEmitter.onAny((event: string, ...args: any[]) => {
      this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.INFO,
        `Event emitted: ${event}`,
        'EventService',
        { args }
      );
    });
  }

  async emit(event: string, payload: any): Promise<void> {
    const eventData = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: event,
      timestamp: new Date().toISOString(),
      payload
    };

    // Store event in Redis
    await this.redisService.rPush('events', JSON.stringify(eventData));
    // Keep only last 1000 events
    await this.redisService.lTrim('events', -1000, -1);

    // Emit the event
    this.eventEmitter.emit(event, payload);
  }

  async emitAsync(event: string, payload: any): Promise<void> {
    const eventData = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: event,
      timestamp: new Date().toISOString(),
      payload
    };

    // Store event in Redis
    await this.redisService.rPush('events', JSON.stringify(eventData));
    // Keep only last 1000 events
    await this.redisService.lTrim('events', -1000, -1);

    // Emit the event
    await this.eventEmitter.emitAsync(event, payload);
  }

  async getEvents(
    type?: string,
    startTime?: string,
    endTime?: string,
  ): Promise<any[]> {
    try {
      // Get events from Redis
      const redisEvents = await this.redisService.lRange('events', 0, -1);
      let events = redisEvents.map(event => JSON.parse(event));

      // Apply filters
      if (type || startTime || endTime) {
        events = events.filter(event => {
          const eventTime = new Date(event.timestamp);
          const matchesType = !type || event.type === type;
          const matchesStartTime = !startTime || eventTime >= new Date(startTime);
          const matchesEndTime = !endTime || eventTime <= new Date(endTime);
          return matchesType && matchesStartTime && matchesEndTime;
        });
      }

      // Sort by timestamp descending
      return events.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    } catch (error) {
      this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to retrieve events',
        'EventService',
        { error: error.message }
      );
      return [];
    }
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

  removeAllListeners(event?: string): void {
    this.eventEmitter.removeAllListeners(event);
  }

  async clearEvents() {
    try {
      await this.redisService.del('events');
      return { success: true, message: 'Events cleared successfully' };
    } catch (error) {
      console.error('Error clearing events:', error);
      throw new Error('Failed to clear events');
    }
  }
} 