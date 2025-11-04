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
import { Server, Socket } from 'socket.io';
import { QueueService } from '@infrastructure/queue/src/queue.service';

// Internal imports - Infrastructure
import { LoggingService } from '@infrastructure/logging';

// Internal imports - Core
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';
import { LogType, LogLevel } from '@core/types';

// Import types from centralized location
import type { ClientSession, QueueFilters } from '@core/types/queue.types';

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/queue-status',
})
export class QueueStatusGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
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

  private metricsStreamInterval!: NodeJS.Timeout;

  constructor(
    private readonly queueService: QueueService,
    private readonly loggingService: LoggingService
  ) {}

  afterInit(_server: Server) {
    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      '🚀 Queue Status Gateway initialized',
      'QueueStatusGateway'
    );
    void this.startMetricsStreaming();
  }

  handleConnection(client: Socket) {
    try {
      const tenantId = this.extractTenantId(client);
      const userId = this.extractUserId(client);

      this.validateClientAccess(client, tenantId);

      // Create session
      const session: ClientSession = {
        clientId: client.id,
        tenantId,
        userId,
        domain: 'clinic', // Default to clinic domain, can be determined from client or request
        connectedAt: new Date(),
        subscribedQueues: new Set(),
        messageCount: 0,
        lastActivity: new Date(),
      };

      this.connectedClients.set(client.id, session);

      // Setup tenant subscription
      if (!this.tenantSubscriptions.has(tenantId)) {
        this.tenantSubscriptions.set(tenantId, new Set());
      }
      this.tenantSubscriptions.get(tenantId)!.add(client.id);

      this.connectionMetrics.activeConnections++;
      this.connectionMetrics.totalConnections++;

      void client.join(`tenant:${tenantId}`);

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `✅ Client connected: ${client.id} (tenant: ${tenantId}, user: ${userId})`,
        'QueueStatusGateway',
        {
          clientId: client.id,
          tenantId,
          userId,
        }
      );

      void this.sendInitialStatus(client, tenantId);
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `❌ Connection failed for ${client.id}: ${_error instanceof Error ? _error.message : String(_error)}`,
        'QueueStatusGateway',
        {
          clientId: client.id,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      client.emit('connection_error', {
        _error: _error instanceof Error ? _error.message : 'Unknown _error',
      });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const session = this.connectedClients.get(client.id);
    if (session) {
      // Clean up subscriptions
      session.subscribedQueues.forEach(queueName => {
        const subscribers = this.queueSubscriptions.get(queueName);
        if (subscribers) {
          subscribers.delete(client.id);
          if (subscribers.size === 0) {
            this.queueSubscriptions.delete(queueName);
          }
        }
      });

      // Clean up tenant subscription
      const tenantSubscribers = this.tenantSubscriptions.get(session.tenantId);
      if (tenantSubscribers) {
        tenantSubscribers.delete(client.id);
        if (tenantSubscribers.size === 0) {
          this.tenantSubscriptions.delete(session.tenantId);
        }
      }

      this.connectedClients.delete(client.id);
      this.connectionMetrics.activeConnections--;

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `👋 Client disconnected: ${client.id} (tenant: ${session.tenantId})`,
        'QueueStatusGateway',
        {
          clientId: client.id,
          tenantId: session.tenantId,
        }
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
          { clientId: client.id },
          'QueueStatusGateway'
        );
      }

      const { queueName, filters } = data as {
        queueName: string;
        filters: QueueFilters;
      };

      void this.validateQueueAccess(session.tenantId, queueName);

      if (!this.queueSubscriptions.has(queueName)) {
        this.queueSubscriptions.set(queueName, new Set());
      }
      this.queueSubscriptions.get(queueName)!.add(client.id);
      session.subscribedQueues.add(queueName);

      // Send current queue status
      const queueStatus = this.queueService.getQueueStatus(queueName);
      client.emit('queue_status', {
        queueName,
        status: queueStatus,
        timestamp: new Date().toISOString(),
      });

      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.INFO,
        `📊 Client ${client.id} subscribed to queue ${queueName}`,
        'QueueStatusGateway',
        {
          clientId: client.id,
          queueName,
        }
      );

      client.emit('subscription_confirmed', {
        queueName,
        filters,
        subscribedAt: new Date().toISOString(),
      });
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `❌ Queue subscription failed: ${_error instanceof Error ? _error.message : String(_error)}`,
        'QueueStatusGateway',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      client.emit('subscription_error', {
        queueName: data.queueName,
        _error: _error instanceof Error ? _error.message : 'Unknown _error',
      });
    }
  }

  @SubscribeMessage('get_queue_metrics')
  async handleGetQueueMetrics(
    @MessageBody() data: { queueNames?: string[]; detailed?: boolean },
    @ConnectedSocket() client: Socket
  ) {
    try {
      const session = this.connectedClients.get(client.id);
      if (!session) {
        throw new HealthcareError(
          ErrorCode.AUTH_SESSION_EXPIRED,
          'Session not found',
          undefined,
          { clientId: client.id },
          'QueueStatusGateway'
        );
      }

      const { queueNames, detailed = false } = data as {
        queueNames: string[];
        detailed?: boolean;
      };
      const accessibleQueues = this.getAccessibleQueues(session.tenantId, queueNames);

      const metrics = await Promise.all(
        accessibleQueues.map(async queueName => {
          const queueMetrics = await this.queueService.getEnterpriseQueueMetrics(queueName);
          return {
            queueName,
            metrics: queueMetrics,
            health: await this.queueService.getQueueHealth(queueName),
            timestamp: new Date().toISOString(),
          };
        })
      );

      client.emit('queue_metrics_response', {
        metrics,
        detailed,
        requestedAt: new Date().toISOString(),
      });
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `❌ Metrics request failed: ${_error instanceof Error ? _error.message : String(_error)}`,
        'QueueStatusGateway',
        {
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
      client.emit('metrics_error', {
        _error: _error instanceof Error ? _error.message : 'Unknown _error',
      });
    }
  }

  // Broadcast methods
  broadcastQueueMetrics(queueName: string, metrics: unknown) {
    const updateData = {
      queueName,
      metrics,
      timestamp: new Date().toISOString(),
    };

    const subscribers = this.queueSubscriptions.get(queueName);
    if (subscribers) {
      subscribers.forEach(clientId => {
        const session = this.connectedClients.get(clientId);
        if (session) {
          this.server.to(clientId).emit('queue_metrics_update', updateData);
        }
      });
    }

    this.updateConnectionMetrics();
  }

  // Helper methods
  private startMetricsStreaming() {
    this.metricsStreamInterval = setInterval(() => {
      try {
        const allStatuses = this.queueService.getAllQueueStatuses();

        for (const [queueName, status] of Object.entries(allStatuses)) {
          const subscribers = this.queueSubscriptions.get(queueName);
          if (subscribers && subscribers.size > 0) {
            this.broadcastQueueMetrics(queueName, (status as { metrics: unknown }).metrics);
          }
        }

        this.server.emit('gateway_metrics', {
          ...this.connectionMetrics,
          timestamp: new Date().toISOString(),
        });
      } catch (_error) {
        void this.loggingService.log(
          LogType.QUEUE,
          LogLevel.ERROR,
          `Metrics streaming error: ${_error instanceof Error ? _error.message : String(_error)}`,
          'QueueStatusGateway',
          {
            error: _error instanceof Error ? _error.message : String(_error),
            stack: _error instanceof Error ? _error.stack : undefined,
          }
        );
      }
    }, 5000);
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
        'Authentication required for tenant access',
        undefined,
        { tenantId },
        'QueueStatusGateway.validateClientAccess'
      );
    }
  }

  private validateQueueAccess(tenantId: string, queueName: string): void {
    const accessibleQueues = this.getAccessibleQueues(tenantId);
    if (!accessibleQueues.includes(queueName)) {
      throw new HealthcareError(
        ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS,
        `Access denied to queue: ${queueName}`,
        undefined,
        { tenantId, queueName },
        'QueueStatusGateway.validateQueueAccess'
      );
    }
  }

  private getAccessibleQueues(tenantId: string, requestedQueues?: string[]): string[] {
    const allStatuses = this.queueService.getAllQueueStatuses();
    const allQueues = Object.keys(allStatuses);

    if (tenantId === 'admin') {
      return requestedQueues || allQueues;
    }

    if (tenantId.includes('clinic')) {
      const clinicQueues = allQueues.filter(q => q.includes('clinic') || q.includes('shared'));
      return requestedQueues ? requestedQueues.filter(q => clinicQueues.includes(q)) : clinicQueues;
    }

    const healthcareQueues = allQueues.filter(q => !q.includes('clinic') || q.includes('shared'));

    return requestedQueues
      ? requestedQueues.filter(q => healthcareQueues.includes(q))
      : healthcareQueues;
  }

  private sendInitialStatus(client: Socket, tenantId: string) {
    try {
      const accessibleQueues = this.getAccessibleQueues(tenantId);
      const queueStatuses = this.queueService.getAllQueueStatuses();

      const filteredStatuses = Object.fromEntries(
        Object.entries(queueStatuses).filter(([queueName]) => accessibleQueues.includes(queueName))
      );

      client.emit('initial_status', {
        queues: filteredStatuses,
        tenantId,
        connectedAt: new Date().toISOString(),
        features: {
          realTimeUpdates: true,
          multiTenant: true,
          auditTrail: true,
          complianceMonitoring: true,
        },
      });
    } catch (_error) {
      void this.loggingService.log(
        LogType.QUEUE,
        LogLevel.ERROR,
        `Failed to send initial status: ${_error instanceof Error ? _error.message : String(_error)}`,
        'QueueStatusGateway',
        {
          tenantId,
          error: _error instanceof Error ? _error.message : String(_error),
          stack: _error instanceof Error ? _error.stack : undefined,
        }
      );
    }
  }

  private updateConnectionMetrics() {
    const now = Date.now();
    const timeDiff = (now - this.connectionMetrics.lastMessageTime) / 1000;

    if (timeDiff > 0) {
      this.connectionMetrics.messagesPerSecond = 1 / timeDiff;
    }

    this.connectionMetrics.lastMessageTime = now;
  }

  onModuleDestroy() {
    if (this.metricsStreamInterval) {
      clearInterval(this.metricsStreamInterval);
    }

    void this.loggingService.log(
      LogType.SYSTEM,
      LogLevel.INFO,
      '🔌 Queue Status Gateway shutdown completed',
      'QueueStatusGateway'
    );
  }
}
