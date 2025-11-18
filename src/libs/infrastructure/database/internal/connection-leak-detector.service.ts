/**
 * Connection Leak Detector Service
 * @class ConnectionLeakDetectorService
 * @description Detects and tracks connection leaks
 * Follows Single Responsibility Principle - only handles leak detection
 */

import { Injectable, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { EventService } from '@infrastructure/events';
import { EventCategory, EventPriority } from '@core/types';

export interface ConnectionLeakInfo {
  connectionId: string;
  acquiredAt: Date;
  operation: string;
  stackTrace?: string;
  duration: number;
}

@Injectable()
export class ConnectionLeakDetectorService implements OnModuleInit {
  private readonly serviceName = 'ConnectionLeakDetectorService';
  private readonly activeConnections = new Map<string, ConnectionLeakInfo>();
  private readonly LEAK_THRESHOLD_MS = 60000; // 1 minute
  private readonly CHECK_INTERVAL_MS = 30000; // 30 seconds
  private checkInterval?: NodeJS.Timeout;

  constructor(
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService: LoggingService,
    @Inject(forwardRef(() => EventService))
    private readonly eventService: EventService
  ) {}

  onModuleInit(): void {
    this.startLeakDetection();
  }

  /**
   * Track connection acquisition
   */
  trackAcquisition(connectionId: string, operation: string, stackTrace?: string): void {
    this.activeConnections.set(connectionId, {
      connectionId,
      acquiredAt: new Date(),
      operation,
      ...(stackTrace !== undefined && { stackTrace }),
      duration: 0,
    });
  }

  /**
   * Track connection release
   */
  trackRelease(connectionId: string): void {
    this.activeConnections.delete(connectionId);
  }

  /**
   * Get active connections
   */
  getActiveConnections(): ReadonlyMap<string, ConnectionLeakInfo> {
    return new Map(this.activeConnections);
  }

  /**
   * Start leak detection
   */
  private startLeakDetection(): void {
    this.checkInterval = setInterval(() => {
      void this.checkForLeaks();
    }, this.CHECK_INTERVAL_MS);
  }

  /**
   * Check for connection leaks
   */
  private checkForLeaks(): void {
    const now = Date.now();
    const leaks: ConnectionLeakInfo[] = [];

    for (const [, info] of this.activeConnections.entries()) {
      const duration = now - info.acquiredAt.getTime();
      if (duration > this.LEAK_THRESHOLD_MS) {
        leaks.push({
          ...info,
          duration,
        });
      }
    }

    if (leaks.length > 0) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Detected ${leaks.length} connection leak(s)`,
        this.serviceName,
        { leaks: leaks.map(l => ({ connectionId: l.connectionId, duration: l.duration })) }
      );

      // Emit event
      void this.eventService.emitEnterprise(
        'database.connection-leak.detected',
        {
          eventId: `connection-leak-${Date.now()}`,
          eventType: 'database.connection-leak.detected',
          category: EventCategory.DATABASE,
          priority: EventPriority.CRITICAL,
          timestamp: new Date().toISOString(),
          source: this.serviceName,
          version: '1.0.0',
          correlationId: `leak-${Date.now()}`,
          traceId: `trace-${Date.now()}`,
          payload: {
            leakCount: leaks.length,
            leaks: leaks.map(l => ({
              connectionId: l.connectionId,
              operation: l.operation,
              duration: l.duration,
            })),
            timestamp: new Date().toISOString(),
          },
        },
        {
          priority: EventPriority.CRITICAL,
          async: true,
        }
      );
    }
  }

  /**
   * Cleanup
   */
  onModuleDestroy(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}
