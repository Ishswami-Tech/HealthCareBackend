/**
 * Health Broadcaster Service
 * Broadcasts health status via Socket.IO
 */

import { Injectable, Optional, Inject, forwardRef, OnModuleInit } from '@nestjs/common';
import { Server } from 'socket.io';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type {
  AggregatedHealthStatus,
  HealthChange,
  RealtimeHealthStatus,
  RealtimeHealthStatusPayload,
  HealthHeartbeat,
  HealthUpdate,
  RealtimeSystemMetrics,
  EndpointHealthStatus,
} from '@core/types';

@Injectable()
export class HealthBroadcasterService implements OnModuleInit {
  private socketServer: Server | null = null;
  private readonly NAMESPACE = '/health';
  private readonly ROOM_ALL = 'health:all';

  constructor(
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService
  ) {}

  onModuleInit() {
    // Socket server will be set by gateway
  }

  /**
   * Set Socket.IO server (called by gateway)
   */
  setSocketServer(server: Server): void {
    this.socketServer = server;
  }

  /**
   * Get Socket.IO server
   */
  getSocketServer(): Server | undefined {
    return this.socketServer || undefined;
  }

  /**
   * Broadcast full health status
   */
  broadcastStatus(status: AggregatedHealthStatus): void {
    if (!this.socketServer) {
      return;
    }

    try {
      const namespace = this.socketServer.of(this.NAMESPACE);

      // Convert to optimized format
      const realtimeStatus: RealtimeHealthStatusPayload = {
        t: status.timestamp,
        o: status.overall,
        s: this.optimizeServices(status.services),
        ...(Object.keys(status.endpoints).length > 0 && {
          e: this.optimizeEndpoints(status.endpoints),
        }),
        ...(this.shouldIncludeSystemMetrics(status.system) && {
          sys: status.system,
        }),
        u: status.uptime,
      };

      // Broadcast to all clients in the room
      namespace.to(this.ROOM_ALL).emit('health:status', realtimeStatus);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      void this.loggingService?.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to broadcast health status: ${errorMessage}`,
        'HealthBroadcasterService',
        { error: errorMessage }
      );
    }
  }

  /**
   * Broadcast health changes
   */
  broadcastChanges(changes: HealthChange[], status: AggregatedHealthStatus): void {
    if (!this.socketServer || changes.length === 0) {
      return;
    }

    try {
      const namespace = this.socketServer.of(this.NAMESPACE);

      // Broadcast each change as incremental update
      for (const change of changes) {
        const update: HealthUpdate = {
          t: change.timestamp,
          ty: change.service.startsWith('system:') ? 'system' : 'service',
          id: change.service,
          st: change.currentStatus,
          ...(change.changeType === 'performance' && { rt: 0 }), // Response time if performance change
        };

        namespace.to(this.ROOM_ALL).emit('health:service:update', update);
      }

      // Also broadcast full status for critical changes
      const criticalChanges = changes.filter(c => c.severity === 'critical');
      if (criticalChanges.length > 0) {
        this.broadcastStatus(status);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      void this.loggingService?.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to broadcast health changes: ${errorMessage}`,
        'HealthBroadcasterService',
        { error: errorMessage }
      );
    }
  }

  /**
   * Broadcast heartbeat (lightweight ping)
   */
  broadcastHeartbeat(overallStatus: RealtimeHealthStatus): void {
    if (!this.socketServer) {
      return;
    }

    try {
      const namespace = this.socketServer.of(this.NAMESPACE);

      const heartbeat: HealthHeartbeat = {
        t: new Date().toISOString(),
        o: overallStatus,
      };

      namespace.to(this.ROOM_ALL).emit('health:heartbeat', heartbeat);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      void this.loggingService?.log(
        LogType.ERROR,
        LogLevel.WARN,
        `Failed to broadcast heartbeat: ${errorMessage}`,
        'HealthBroadcasterService',
        { error: errorMessage }
      );
    }
  }

  /**
   * Optimize services (only include changed services in full status)
   */
  private optimizeServices(
    services: Record<string, { status: RealtimeHealthStatus; timestamp: string }>
  ): Record<string, { status: RealtimeHealthStatus; timestamp: string }> {
    // For now, return all services
    // In production, could filter to only changed services
    return services;
  }

  /**
   * Optimize endpoints
   */
  private optimizeEndpoints(
    endpoints: Record<string, EndpointHealthStatus>
  ): Record<string, EndpointHealthStatus> {
    return endpoints;
  }

  /**
   * Check if system metrics should be included (threshold breach)
   */
  private shouldIncludeSystemMetrics(system: RealtimeSystemMetrics): boolean {
    return system.cpu >= 80 || system.memory >= 80 || system.errorRate >= 5;
  }
}
