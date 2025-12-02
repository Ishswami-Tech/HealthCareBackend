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
import { QueueService } from '@infrastructure/queue/src/queue.service';

// Internal imports - Infrastructure
import { LoggingService, safeLog, safeLogError } from '@infrastructure/logging';

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

  private metricsStreamInterval!: NodeJS.Timeout;
  private isInitialized = false;

  constructor(
    private readonly queueService: QueueService,
    @Optional()
    @Inject(forwardRef(() => LoggingService))
    private readonly loggingService?: LoggingService
  ) {
    // Defensive check: ensure all Maps are initialized in constructor
    // This is critical because afterInit() might be called before onModuleInit()
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

  /**
   * OnModuleInit ensures LoggingService is available before WebSocket initialization
   * According to NestJS lifecycle: OnModuleInit.onModuleInit() is called after all modules are initialized
   * Using forwardRef() to handle circular dependency between QueueModule and LoggingModule
   */
  onModuleInit() {
    try {
      // Defensive check: ensure all Maps are initialized
      if (!this.connectedClients) {
        this.connectedClients = new Map<string, ClientSession>();
      }
      if (!this.queueSubscriptions) {
        this.queueSubscriptions = new Map<string, Set<string>>();
      }
      if (!this.tenantSubscriptions) {
        this.tenantSubscriptions = new Map<string, Set<string>>();
      }

    // LoggingService is optional - if not available, we'll continue without logging
    // This handles cases where LoggingService might not be initialized yet due to circular dependencies
    if (this.loggingService) {
      this.isInitialized = true;
    } else {
      // LoggingService not available yet - will retry in afterInit
      this.isInitialized = false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const errorStack = error instanceof Error ? error.stack : 'No stack trace';
      console.error(`[QueueStatusGateway] onModuleInit failed: ${errorMessage}`);
      console.error(`[QueueStatusGateway] Stack: ${errorStack}`);
      // Don't throw - allow app to continue without queue status gateway
    }
  }

  /**
   * afterInit is called when WebSocket server is initialized
   * This may be called before onModuleInit completes, so we check initialization status
   * Using forwardRef means we need to handle potential timing issues
   */
  afterInit(_server: Server) {
    // Wait for module initialization to complete if not ready
    // This handles the case where WebSocket initialization happens before OnModuleInit
    if (!this.isInitialized || !this.loggingService) {
      // Use setTimeout to allow onModuleInit to complete
      // This is necessary when using forwardRef due to circular dependencies
      setTimeout(() => {
        this.isInitialized = true;
        safeLog(
          this.loggingService,
          LogType.SYSTEM,
          LogLevel.INFO,
          '🚀 Queue Status Gateway initialized (delayed)',
          'QueueStatusGateway'
        );
        void this.startMetricsStreaming();
      }, 500); // Increased delay to 500ms to allow LoggingService to initialize
      return;
    }

    // LoggingService is guaranteed to be available here
    safeLog(
      this.loggingService,
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

      // Defensive check before calling .set()
      if (this.connectedClients && typeof this.connectedClients.set === 'function') {
      this.connectedClients.set(client.id, session);
      } else {
        throw new Error('connectedClients Map is not properly initialized');
      }

      // Setup tenant subscription
      if (this.tenantSubscriptions && typeof this.tenantSubscriptions.has === 'function') {
      if (!this.tenantSubscriptions.has(tenantId)) {
          if (typeof this.tenantSubscriptions.set === 'function') {
        this.tenantSubscriptions.set(tenantId, new Set());
          } else {
            throw new Error('tenantSubscriptions Map is not properly initialized');
          }
        }
      } else {
        throw new Error('tenantSubscriptions Map is not properly initialized');
      }
      this.tenantSubscriptions.get(tenantId)!.add(client.id);

      this.connectionMetrics.activeConnections++;
      this.connectionMetrics.totalConnections++;

      void client.join(`tenant:${tenantId}`);

      safeLog(
        this.loggingService,
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
      safeLogError(this.loggingService, _error, 'QueueStatusGateway', {
        clientId: client.id,
        operation: 'handleConnection',
      });
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

      safeLog(
        this.loggingService,
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

      // Defensive check before calling .set()
      if (this.queueSubscriptions && typeof this.queueSubscriptions.has === 'function') {
      if (!this.queueSubscriptions.has(queueName)) {
          if (typeof this.queueSubscriptions.set === 'function') {
        this.queueSubscriptions.set(queueName, new Set());
          } else {
            throw new Error('queueSubscriptions Map is not properly initialized');
          }
        }
      } else {
        throw new Error('queueSubscriptions Map is not properly initialized');
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

      safeLog(
        this.loggingService,
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
      safeLogError(this.loggingService, _error, 'QueueStatusGateway', {
        clientId: client.id,
        queueName: data.queueName,
        operation: 'subscribe_queue',
      });
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
      safeLogError(this.loggingService, _error, 'QueueStatusGateway', {
        clientId: client.id,
        operation: 'get_queue_metrics',
      });
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
        if (!this.queueService || typeof this.queueService.getAllQueueStatuses !== 'function') {
          return;
        }
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
        safeLogError(this.loggingService, _error, 'QueueStatusGateway', {
          operation: 'startMetricsStreaming',
        });
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
    if (!this.queueService || typeof this.queueService.getAllQueueStatuses !== 'function') {
      return requestedQueues || [];
    }
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
      if (!this.queueService || typeof this.queueService.getAllQueueStatuses !== 'function') {
        client.emit('initial_status', {
          queues: {},
          tenantId,
          timestamp: new Date().toISOString(),
        });
        return;
      }
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
      safeLogError(this.loggingService, _error, 'QueueStatusGateway', {
        tenantId,
        operation: 'sendInitialStatus',
      });
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

    safeLog(
      this.loggingService,
      LogType.SYSTEM,
      LogLevel.INFO,
      '🔌 Queue Status Gateway shutdown completed',
      'QueueStatusGateway'
    );
  }
}
