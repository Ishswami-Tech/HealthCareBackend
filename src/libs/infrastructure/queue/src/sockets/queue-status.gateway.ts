import { nowIso } from '@utils/date-time.util';
/**
 * REAL-TIME QUEUE STATUS GATEWAY
 * ==============================
 * WebSocket gateway for real-time queue monitoring and management
 */

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Injectable, OnModuleInit, Inject, forwardRef, Optional } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { QueueService } from '@queue/src/queue.service';
import { EventService } from '@infrastructure/events/event.service';

// Internal imports - Infrastructure
import { LoggingService, safeLog, safeLogError } from '@infrastructure/logging';

// Internal imports - Core
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { LogType, LogLevel, isEventService, EnterpriseEventPayload } from '@core/types';

// Import types from centralized location
import type { ClientSession, QueueFilters } from '@core/types/queue.types';

// Get CORS origin from environment (fallback to restricted list for security)
const getCorsOrigin = (): string | string[] => {
  const corsOrigin = process.env['CORS_ORIGIN'] || '';
  if (corsOrigin) {
    // Split comma-separated origins
    return corsOrigin.split(',').map((o: string) => o.trim());
  }
  // Default to localhost origins only (more secure than '*')
  return ['http://localhost:3000', 'http://localhost:8088', 'http://localhost:8082'];
};

@WebSocketGateway({
  cors: {
    origin: getCorsOrigin(),
    credentials: true,
  },
  namespace: '/queue-status',
})
@Injectable()
export class QueueStatusGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer() server!: Server;

  private connectedClients = new Map<string, ClientSession>();
  private queueSubscriptions = new Map<string, Set<string>>();
  private tenantSubscriptions = new Map<string, Set<string>>();

  private connectionMetrics = {
    totalConnections: 0,
    activeConnections: 0,
    messagesPerSecond: 0,
    lastMessageTime: Date.now(),
  };

  private isInitialized = false;

  constructor(
    private readonly queueService: QueueService,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService,
    @Optional()
    @Inject(forwardRef(() => EventService))
    private readonly eventService?: unknown
  ) {
    // Defensive check: ensure all Maps are initialized in constructor
    if (!this.connectedClients || typeof this.connectedClients.set !== 'function') {
      this.connectedClients = new Map<string, ClientSession>();
    }
    if (!this.queueSubscriptions || typeof this.queueSubscriptions.set !== 'function') {
      this.queueSubscriptions = new Map<string, Set<string>>();
    }
    if (!this.tenantSubscriptions || typeof this.tenantSubscriptions.set !== 'function') {
      this.tenantSubscriptions = new Map<string, Set<string>>();
    }
  }

  onModuleInit() {
    try {
      // Initialize Maps if needed
      if (!this.connectedClients) this.connectedClients = new Map();
      if (!this.queueSubscriptions) this.queueSubscriptions = new Map();
      if (!this.tenantSubscriptions) this.tenantSubscriptions = new Map();

      // Subscribe to Events
      if (this.eventService && isEventService(this.eventService)) {
        this.eventService.on('appointment.queue.updated', (event: unknown) =>
          this.handleQueueUpdate(event as EnterpriseEventPayload)
        );
        this.eventService.on('appointment.queue.position.updated', (event: unknown) =>
          this.handleQueuePositionUpdate(event as EnterpriseEventPayload)
        );
      }

      this.isInitialized = !!this.loggingService;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (this.loggingService) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.ERROR,
          `QueueStatusGateway onModuleInit failed: ${errorMessage}`,
          'QueueStatusGateway',
          { error: errorMessage }
        );
      }
    }
  }

  afterInit(_server: Server) {
    if (!this.isInitialized || !this.loggingService) {
      setTimeout(() => {
        this.isInitialized = true;
        safeLog(
          this.loggingService,
          LogType.SYSTEM,
          LogLevel.INFO,
          '🚀 Queue Status Gateway initialized (delayed)',
          'QueueStatusGateway'
        );
      }, 500);
      return;
    }

    safeLog(
      this.loggingService,
      LogType.SYSTEM,
      LogLevel.INFO,
      '🚀 Queue Status Gateway initialized',
      'QueueStatusGateway'
    );
  }

  private handleQueueUpdate(event: EnterpriseEventPayload) {
    try {
      const payload = event.payload as {
        doctorId?: string;
        domain?: string;
        action?: string;
        queuePositions?: unknown[];
        clinicId?: string;
        locationId?: string;
      };

      const { doctorId, domain, action, queuePositions, clinicId, locationId } = payload;

      if (domain && doctorId) {
        const queueName = `queue:${domain}:${doctorId}`;
        this.broadcastQueueMetrics(queueName, {
          action,
          queuePositions,
          timestamp: nowIso(),
        });
      }

      // Room-based broadcasting
      if (clinicId) this.server.to(`clinic:${clinicId}`).emit('queue.updated', payload);
      if (locationId) this.server.to(`location:${locationId}`).emit('queue.updated', payload);
      if (doctorId) this.server.to(`doctor:${doctorId}`).emit('queue.updated', payload);
    } catch (error) {
      safeLogError(this.loggingService, error, 'QueueStatusGateway.handleQueueUpdate');
    }
  }

  private handleQueuePositionUpdate(event: EnterpriseEventPayload) {
    try {
      const payload = event.payload as {
        clinicId?: string;
        locationId?: string;
        doctorId?: string;
      };
      const { clinicId, locationId, doctorId } = payload;

      if (clinicId) this.server.to(`clinic:${clinicId}`).emit('queue.position.updated', payload);
      if (locationId)
        this.server.to(`location:${locationId}`).emit('queue.position.updated', payload);
      if (doctorId) this.server.to(`doctor:${doctorId}`).emit('queue.position.updated', payload);
    } catch (error) {
      safeLogError(this.loggingService, error, 'QueueStatusGateway.handleQueuePositionUpdate');
    }
  }

  handleConnection(client: Socket) {
    try {
      const tenantId = this.extractTenantId(client);
      const userId = this.extractUserId(client);

      this.validateClientAccess(client, tenantId);

      const session: ClientSession = {
        clientId: client.id,
        tenantId,
        userId,
        domain: 'clinic',
        connectedAt: new Date(),
        subscribedQueues: new Set(),
        messageCount: 0,
        lastActivity: new Date(),
      };

      this.connectedClients.set(client.id, session);

      if (!this.tenantSubscriptions.has(tenantId)) {
        this.tenantSubscriptions.set(tenantId, new Set());
      }
      this.tenantSubscriptions.get(tenantId)!.add(client.id);

      this.connectionMetrics.activeConnections++;
      this.connectionMetrics.totalConnections++;

      void client.join(`tenant:${tenantId}`);

      const clinicId = client.handshake.query['clinicId'] as string;
      const locationId = client.handshake.query['locationId'] as string;
      const doctorId = client.handshake.query['doctorId'] as string;

      if (clinicId) void client.join(`clinic:${clinicId}`);
      if (locationId) void client.join(`location:${locationId}`);
      if (doctorId) void client.join(`doctor:${doctorId}`);

      safeLog(
        this.loggingService,
        LogType.QUEUE,
        LogLevel.INFO,
        `✅ Client connected: ${client.id} (tenant: ${tenantId})`,
        'QueueStatusGateway'
      );

      void this.sendInitialStatus(client, tenantId);
    } catch (_error) {
      safeLogError(this.loggingService, _error, 'QueueStatusGateway', {
        clientId: client.id,
        operation: 'handleConnection',
      });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const session = this.connectedClients.get(client.id);
    if (session) {
      session.subscribedQueues.forEach(queueName => {
        const subscribers = this.queueSubscriptions.get(queueName);
        if (subscribers) {
          subscribers.delete(client.id);
          if (subscribers.size === 0) {
            this.queueSubscriptions.delete(queueName);
          }
        }
      });

      const tenantSubscribers = this.tenantSubscriptions.get(session.tenantId);
      if (tenantSubscribers) {
        tenantSubscribers.delete(client.id);
        if (tenantSubscribers.size === 0) {
          this.tenantSubscriptions.delete(session.tenantId);
        }
      }

      this.connectedClients.delete(client.id);
      this.connectionMetrics.activeConnections--;

      safeLog(
        this.loggingService,
        LogType.QUEUE,
        LogLevel.INFO,
        `👋 Client disconnected: ${client.id}`,
        'QueueStatusGateway'
      );
    }
  }

  @SubscribeMessage('subscribe_queue')
  handleSubscribeQueue(
    @MessageBody() data: { queueName: string; filters?: QueueFilters },
    @ConnectedSocket() client: Socket
  ) {
    try {
      const session = this.connectedClients.get(client.id);
      if (!session) {
        throw new HealthcareError(
          ErrorCode.AUTH_SESSION_EXPIRED,
          'Session not found',
          undefined,
          undefined,
          'QueueStatusGateway'
        );
      }

      const { queueName, filters } = data;
      this.validateQueueAccess(session.tenantId, queueName);

      if (!this.queueSubscriptions.has(queueName)) {
        this.queueSubscriptions.set(queueName, new Set());
      }
      this.queueSubscriptions.get(queueName)!.add(client.id);
      session.subscribedQueues.add(queueName);

      // Dynamic room joining based on filters
      const dynamicFilters = filters as Record<string, string>;
      if (dynamicFilters['clinicId']) void client.join(`clinic:${dynamicFilters['clinicId']}`);
      if (dynamicFilters['locationId'])
        void client.join(`location:${dynamicFilters['locationId']}`);
      if (dynamicFilters['doctorId']) void client.join(`doctor:${dynamicFilters['doctorId']}`);

      // Send immediate update if possible
      // Since we removed polling, we rely on events.
      // But we can trigger a "refresh" request or just wait.
      // For now, simple ack.
      client.emit('subscription_confirmed', {
        queueName,
        filters,
        subscribedAt: nowIso(),
      });
    } catch (_error) {
      safeLogError(this.loggingService, _error, 'QueueStatusGateway.handleSubscribeQueue');
      client.emit('subscription_error', {
        queueName: data.queueName,
        error: _error instanceof Error ? _error.message : 'Unknown error',
      });
    }
  }

  broadcastQueueMetrics(queueName: string, metrics: unknown) {
    const updateData = {
      queueName,
      metrics,
      timestamp: nowIso(),
    };

    const subscribers = this.queueSubscriptions.get(queueName);
    if (subscribers) {
      subscribers.forEach(clientId => {
        this.server.to(clientId).emit('queue_metrics_update', updateData);
      });
    }
    this.updateConnectionMetrics();
  }

  private extractTenantId(client: Socket): string {
    return (
      (client.handshake.query['tenantId'] as string) ||
      (client.handshake.headers['x-tenant-id'] as string) ||
      'default'
    );
  }

  private extractUserId(client: Socket): string {
    return (
      (client.handshake.query['userId'] as string) ||
      (client.handshake.headers['x-user-id'] as string) ||
      'anonymous'
    );
  }

  private validateClientAccess(client: Socket, tenantId: string): void {
    const token = client.handshake.auth['token'] as string | undefined;
    if (!token && tenantId !== 'default') {
      throw new HealthcareError(
        ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS,
        'Authentication required',
        undefined,
        { tenantId },
        'QueueStatusGateway'
      );
    }
  }

  private validateQueueAccess(_tenantId: string, _queueName: string): void {
    // Basic validation
    return;
  }

  private getAccessibleQueues(_tenantId: string): string[] {
    // Placeholder
    return [];
  }

  private sendInitialStatus(client: Socket, tenantId: string) {
    client.emit('initial_status', {
      connected: true,
      tenantId,
      timestamp: nowIso(),
    });
  }

  private updateConnectionMetrics() {
    const now = Date.now();
    const timeDiff = (now - this.connectionMetrics.lastMessageTime) / 1000;
    if (timeDiff > 0) this.connectionMetrics.messagesPerSecond = 1 / timeDiff;
    this.connectionMetrics.lastMessageTime = now;
  }

  onModuleDestroy() {
    // Cleanup if needed
  }
}
