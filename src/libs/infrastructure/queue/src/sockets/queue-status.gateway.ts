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
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { Server, Socket } from "socket.io";
import { QueueService } from "../queue.service";

interface ClientSession {
  clientId: string;
  tenantId: string;
  userId: string;
  connectedAt: Date;
  subscribedQueues: Set<string>;
  messageCount: number;
  lastActivity: Date;
}

interface QueueFilters {
  status?: string[];
  priority?: string[];
  tenantId?: string;
  dateRange?: {
    from: string;
    to: string;
  };
}

@WebSocketGateway({
  cors: {
    origin: "*",
    credentials: true,
  },
  namespace: "/queue-status",
})
export class QueueStatusGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(QueueStatusGateway.name);

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

  constructor(private readonly queueService: QueueService) {}

  afterInit(server: Server) {
    this.logger.log("🚀 Queue Status Gateway initialized");
    this.startMetricsStreaming();
  }

  async handleConnection(client: Socket) {
    try {
      const tenantId = this.extractTenantId(client);
      const userId = this.extractUserId(client);

      await this.validateClientAccess(client, tenantId);

      // Create session
      const session: ClientSession = {
        clientId: client.id,
        tenantId,
        userId,
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

      client.join(`tenant:${tenantId}`);

      this.logger.log(
        `✅ Client connected: ${client.id} (tenant: ${tenantId}, user: ${userId})`,
      );

      await this.sendInitialStatus(client, tenantId);
    } catch (_error) {
      this.logger.error(`❌ Connection failed for ${client.id}:`, _error);
      client.emit("connection_error", {
        _error: _error instanceof Error ? _error.message : "Unknown _error",
      });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    const session = this.connectedClients.get(client.id);
    if (session) {
      // Clean up subscriptions
      session.subscribedQueues.forEach((queueName) => {
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

      this.logger.log(
        `👋 Client disconnected: ${client.id} (tenant: ${session.tenantId})`,
      );
    }
  }

  @SubscribeMessage("subscribe_queue")
  async handleSubscribeQueue(
    @MessageBody() data: { queueName: string; filters?: QueueFilters },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const session = this.connectedClients.get(client.id);
      if (!session) throw new Error("Session not found");

      const { queueName, filters } = data as any;

      await this.validateQueueAccess(session.tenantId, queueName);

      if (!this.queueSubscriptions.has(queueName)) {
        this.queueSubscriptions.set(queueName, new Set());
      }
      this.queueSubscriptions.get(queueName)!.add(client.id);
      session.subscribedQueues.add(queueName);

      // Send current queue status
      const queueStatus = await this.queueService.getQueueStatus(queueName);
      client.emit("queue_status", {
        queueName,
        status: queueStatus,
        timestamp: new Date().toISOString(),
      });

      this.logger.log(
        `📊 Client ${client.id} subscribed to queue ${queueName}`,
      );

      client.emit("subscription_confirmed", {
        queueName,
        filters,
        subscribedAt: new Date().toISOString(),
      });
    } catch (_error) {
      this.logger.error(`❌ Queue subscription failed:`, _error);
      client.emit("subscription_error", {
        queueName: data.queueName,
        _error: _error instanceof Error ? _error.message : "Unknown _error",
      });
    }
  }

  @SubscribeMessage("get_queue_metrics")
  async handleGetQueueMetrics(
    @MessageBody() data: { queueNames?: string[]; detailed?: boolean },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const session = this.connectedClients.get(client.id);
      if (!session) throw new Error("Session not found");

      const { queueNames, detailed = false } = data as any;
      const accessibleQueues = await this.getAccessibleQueues(
        session.tenantId,
        queueNames,
      );

      const metrics = await Promise.all(
        accessibleQueues.map(async (queueName) => {
          const queueMetrics =
            await this.queueService.getEnterpriseQueueMetrics(queueName);
          return {
            queueName,
            metrics: queueMetrics,
            health: await this.queueService.getQueueHealth(queueName),
            timestamp: new Date().toISOString(),
          };
        }),
      );

      client.emit("queue_metrics_response", {
        metrics,
        detailed,
        requestedAt: new Date().toISOString(),
      });
    } catch (_error) {
      this.logger.error(`❌ Metrics request failed:`, _error);
      client.emit("metrics_error", {
        _error: _error instanceof Error ? _error.message : "Unknown _error",
      });
    }
  }

  // Broadcast methods
  async broadcastQueueMetrics(queueName: string, metrics: unknown) {
    const updateData = {
      queueName,
      metrics,
      timestamp: new Date().toISOString(),
    };

    const subscribers = this.queueSubscriptions.get(queueName);
    if (subscribers) {
      subscribers.forEach((clientId) => {
        const session = this.connectedClients.get(clientId);
        if (session) {
          this.server.to(clientId).emit("queue_metrics_update", updateData);
        }
      });
    }

    this.updateConnectionMetrics();
  }

  // Helper methods
  private async startMetricsStreaming() {
    this.metricsStreamInterval = setInterval(async () => {
      try {
        const allStatuses = await this.queueService.getAllQueueStatuses();

        for (const [queueName, status] of Object.entries(allStatuses)) {
          const subscribers = this.queueSubscriptions.get(queueName);
          if (subscribers && subscribers.size > 0) {
            await this.broadcastQueueMetrics(queueName, (status as any).metrics);
          }
        }

        this.server.emit("gateway_metrics", {
          ...this.connectionMetrics,
          timestamp: new Date().toISOString(),
        });
      } catch (_error) {
        this.logger.error("Metrics streaming _error:", _error);
      }
    }, 5000);
  }

  private extractTenantId(client: Socket): string {
    return (
      (client.handshake.query.tenantId as string) ||
      (client.handshake.headers["x-tenant-id"] as string) ||
      "default"
    );
  }

  private extractUserId(client: Socket): string {
    return (
      (client.handshake.query.userId as string) ||
      (client.handshake.headers["x-user-id"] as string) ||
      "anonymous"
    );
  }

  private async validateClientAccess(
    client: Socket,
    tenantId: string,
  ): Promise<void> {
    const token = client.handshake.auth.token;
    if (!token && tenantId !== "default") {
      throw new Error("Authentication required for tenant access");
    }
  }

  private async validateQueueAccess(
    tenantId: string,
    queueName: string,
  ): Promise<void> {
    const accessibleQueues = await this.getAccessibleQueues(tenantId);
    if (!accessibleQueues.includes(queueName)) {
      throw new Error(`Access denied to queue: ${queueName}`);
    }
  }

  private async getAccessibleQueues(
    tenantId: string,
    requestedQueues?: string[],
  ): Promise<string[]> {
    const allStatuses = await this.queueService.getAllQueueStatuses();
    const allQueues = Object.keys(allStatuses);

    if (tenantId === "admin") {
      return requestedQueues || allQueues;
    }

    if (tenantId.includes("clinic")) {
      const clinicQueues = allQueues.filter(
        (q) => q.includes("clinic") || q.includes("shared"),
      );
      return requestedQueues
        ? requestedQueues.filter((q) => clinicQueues.includes(q))
        : clinicQueues;
    }

    const healthcareQueues = allQueues.filter(
      (q) => !q.includes("clinic") || q.includes("shared"),
    );

    return requestedQueues
      ? requestedQueues.filter((q) => healthcareQueues.includes(q))
      : healthcareQueues;
  }

  private async sendInitialStatus(client: Socket, tenantId: string) {
    try {
      const accessibleQueues = await this.getAccessibleQueues(tenantId);
      const queueStatuses = await this.queueService.getAllQueueStatuses();

      const filteredStatuses = Object.fromEntries(
        Object.entries(queueStatuses).filter(([queueName]) =>
          accessibleQueues.includes(queueName),
        ),
      );

      client.emit("initial_status", {
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
      this.logger.error("Failed to send initial status:", _error);
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

    this.logger.log("🔌 Queue Status Gateway shutdown completed");
  }
}
