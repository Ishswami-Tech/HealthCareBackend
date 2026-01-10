import { Controller, Get, Res, Inject, forwardRef } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from '@core/decorators/public.decorator';
import { ConfigService } from '@config/config.service';
import { FastifyReply } from 'fastify';
import { HealthService } from './services/health/health.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type { ServiceHealth, DetailedHealthCheckResponse } from '@core/types/common.types';

// Local types for dashboard
interface ServiceInfo {
  name: string;
  description: string;
  url: string;
  active: boolean;
  category: string;
  credentials?: string;
  devOnly?: boolean;
  port?: number;
  status?: string;
  metrics?: Record<string, unknown>;
}

interface DashboardLogEntry {
  timestamp: string | Date;
  level: string;
  message: string;
  source: string;
  data: string;
}

interface DashboardData {
  overallHealth: {
    status: 'healthy' | 'degraded';
    statusText: string;
    healthyCount: number;
    totalCount: number;
    lastChecked: string;
    details: string;
  };
  services: Array<{
    id: string;
    name: string;
    status: string;
    isHealthy: boolean;
    responseTime: number;
    details: string;
    lastChecked: string;
    metrics: Record<string, unknown>;
    error?: string;
  }>;
  clusterInfo?:
    | {
        isPrimary: boolean;
        isWorker: boolean;
        workerId: string | number | undefined;
        instanceId: string;
        nodeName: string;
        hostname: string;
        cpuCount: number;
        totalWorkers?: number;
        activeWorkers?: number;
      }
    | undefined;
}

@ApiTags('root')
@Controller('')
export class AppController {
  constructor(
    private readonly appService: AppService,
    @Inject(forwardRef(() => ConfigService)) private readonly configService: ConfigService,
    private readonly healthService: HealthService,
    @Inject(forwardRef(() => LoggingService)) private readonly loggingService: LoggingService
  ) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'API Dashboard',
    description: 'Shows a dashboard with all available services and their status.',
  })
  @ApiResponse({
    status: 200,
    description: 'Dashboard HTML',
  })
  async getDashboard(@Res() res: FastifyReply) {
    try {
      const appConfig = this.configService.getAppConfig();
      const urlsConfig = this.configService.getUrlsConfig();
      const baseUrl = appConfig.apiUrl || appConfig.baseUrl;
      const isProduction = appConfig.environment === 'production';

      // Get real-time service status using Terminus health checks
      let healthData;
      try {
        // Use HealthService for health checks (standardized, reliable, includes realtime status)
        const healthCheckPromise = this.healthService.getDetailedHealth().then(healthResult => {
          // HealthService already returns the correct format with realtime status
          return healthResult;
        });
        const timeoutPromise = new Promise<DetailedHealthCheckResponse>(resolve => {
          setTimeout(() => {
            resolve({
              status: 'degraded',
              timestamp: new Date().toISOString(),
              environment: appConfig.environment,
              version: this.configService?.getEnv('npm_package_version', '0.0.1') || '0.0.1',
              systemMetrics: {
                uptime: process.uptime(),
                memoryUsage: {
                  heapTotal: 0,
                  heapUsed: 0,
                  rss: 0,
                  external: 0,
                  systemTotal: 0,
                  systemFree: 0,
                  systemUsed: 0,
                },
                cpuUsage: {
                  user: 0,
                  system: 0,
                  cpuCount: 0,
                  cpuModel: 'unknown',
                  cpuSpeed: 0,
                },
              },
              services: {
                api: {
                  status: 'unhealthy',
                  responseTime: 0,
                  lastChecked: new Date().toISOString(),
                },
                database: {
                  status: 'unhealthy' as const,
                  responseTime: 0,
                  lastChecked: new Date().toISOString(),
                },
                cache: {
                  status: 'unhealthy' as const,
                  responseTime: 0,
                  lastChecked: new Date().toISOString(),
                },
                queue: {
                  status: 'unhealthy' as const,
                  responseTime: 0,
                  lastChecked: new Date().toISOString(),
                },
                logger: {
                  status: 'unhealthy' as const,
                  responseTime: 0,
                  lastChecked: new Date().toISOString(),
                },
                video: {
                  status: 'unhealthy' as const,
                  responseTime: 0,
                  lastChecked: new Date().toISOString(),
                },
                communication: {
                  status: 'unhealthy' as const,
                  responseTime: 0,
                  lastChecked: new Date().toISOString(),
                  details: 'Communication service unavailable',
                },
              },
              processInfo: {
                pid: process.pid,
                ppid: process.ppid,
                platform: process.platform,
                versions: {},
              },
              memory: {
                heapUsed: 0,
                heapTotal: 0,
                external: 0,
                arrayBuffers: 0,
              },
              cpu: {
                user: 0,
                system: 0,
              },
            });
          }, 15000); // 15 second timeout (increased to allow health checks to complete)
        });
        healthData = await Promise.race([healthCheckPromise, timeoutPromise]);
      } catch (healthError) {
        // If health check fails completely, use default degraded status
        // This should rarely happen as HealthService is designed to never throw
        try {
          if (this.loggingService) {
            void this.loggingService.log(
              LogType.SYSTEM,
              LogLevel.WARN,
              'Health check failed in dashboard, using default status',
              'AppController',
              {
                error: healthError instanceof Error ? healthError.message : String(healthError),
                stack: healthError instanceof Error ? healthError.stack : undefined,
              }
            );
          }
        } catch (logError) {
          // Ignore logging errors - we still want to show the dashboard
          console.error('Failed to log health check error:', logError);
        }
        // Create a default health data structure
        healthData = {
          status: 'degraded',
          timestamp: new Date().toISOString(),
          environment: this.configService?.getEnvironment() || 'development',
          version: this.configService?.getEnv('npm_package_version', '0.0.1') || '0.0.1',
          systemMetrics: {
            uptime: process.uptime(),
            memoryUsage: {
              heapTotal: 0,
              heapUsed: 0,
              rss: 0,
              external: 0,
              systemTotal: 0,
              systemFree: 0,
              systemUsed: 0,
            },
            cpuUsage: {
              user: 0,
              system: 0,
              cpuCount: 0,
              cpuModel: 'unknown',
              cpuSpeed: 0,
            },
          },
          services: {
            api: {
              status: 'unhealthy',
              responseTime: 0,
              lastChecked: new Date().toISOString(),
            },
            database: {
              status: 'unhealthy' as const,
              responseTime: 0,
              lastChecked: new Date().toISOString(),
            },
            cache: {
              status: 'unhealthy' as const,
              responseTime: 0,
              lastChecked: new Date().toISOString(),
            },
            queue: {
              status: 'unhealthy' as const,
              responseTime: 0,
              lastChecked: new Date().toISOString(),
            },
            logger: {
              status: 'unhealthy' as const,
              responseTime: 0,
              lastChecked: new Date().toISOString(),
            },
            communication: {
              status: 'unhealthy' as const,
              responseTime: 0,
              lastChecked: new Date().toISOString(),
              details: 'Communication service unavailable',
            },
          },
          processInfo: {
            pid: process.pid,
            ppid: process.ppid,
            platform: process.platform,
            versions: {},
          },
          memory: {
            heapUsed: 0,
            heapTotal: 0,
            external: 0,
            arrayBuffers: 0,
          },
          cpu: {
            user: 0,
            system: 0,
          },
        };
      }

      // Extract health services data once - reuse for all status checks
      const healthServices =
        (healthData && 'services' in healthData ? healthData.services : {}) || {};

      // Check if services are running
      // API is always considered running if we can serve the dashboard
      const isApiRunning = true; // API is running if we can serve this page

      // Extract individual service statuses for real-time checks
      const queueHealth = healthServices.queue as ServiceHealth | undefined;
      const loggerHealth = healthServices.logger as ServiceHealth | undefined;
      const communicationHealth = (healthServices as { communication?: ServiceHealth })
        .communication;
      const prismaStudioStatus = (healthServices as { prismaStudio?: ServiceHealth }).prismaStudio
        ?.status;
      const redisCommanderStatus = (healthServices as { redisCommander?: ServiceHealth })
        .redisCommander?.status;

      // Extract communication sub-services status from communicationHealth
      const communicationHealthData = communicationHealth as
        | (ServiceHealth & {
            communicationHealth?: {
              socket?: { connected?: boolean };
              email?: { connected?: boolean };
            };
          })
        | undefined;
      const socketStatus = communicationHealthData?.communicationHealth?.socket?.connected
        ? 'healthy'
        : 'unhealthy';
      // Communication service status (overall communication health)
      const communicationStatus =
        communicationHealth?.status === 'healthy' ? 'healthy' : 'unhealthy';

      // Extract real-time metrics for all services
      const basePort =
        this.configService?.get<number | string>('PORT', 8088) ||
        this.configService?.get<number | string>('VIRTUAL_PORT', 8088) ||
        8088;
      const queueMetrics =
        (queueHealth && 'metrics' in queueHealth ? queueHealth.metrics : {}) || {};
      const loggerMetrics =
        (loggerHealth && 'metrics' in loggerHealth ? loggerHealth.metrics : {}) || {};
      const socketMetrics = communicationHealthData?.communicationHealth?.socket || {};
      const communicationMetrics = communicationHealthData?.communicationHealth || {};
      const queuePort = (queueMetrics['port'] as number | string | undefined) || basePort;
      const loggerPort = (loggerMetrics['port'] as number | string | undefined) || basePort;
      const activeQueues = queueMetrics['activeQueues'] as number | undefined;
      const queueStatuses = queueMetrics['queueStatuses'] as Record<string, unknown> | undefined;

      // Real-time status based on actual health checks - no assumptions
      // Since we're already serving this dashboard, API is clearly running
      const isQueueRunning = queueHealth?.status === 'healthy';
      const isLoggerRunning = loggerHealth?.status === 'healthy';
      const isSocketRunning = socketStatus === 'healthy';
      const isCommunicationRunning = communicationStatus === 'healthy';
      const isPrismaStudioRunning = prismaStudioStatus === 'healthy';
      const isRedisCommanderRunning = redisCommanderStatus === 'healthy';

      // Define all services with real-time status based on actual health checks
      // Services are active if their health check passes (API is already running since we're serving this page)
      const allServices: ServiceInfo[] = [
        {
          name: 'API Documentation',
          description: 'Swagger API documentation and testing interface.',
          url: `${baseUrl}${urlsConfig.swagger}`,
          active: isApiRunning, // API is running if we can serve this page
          category: 'Documentation',
        },
        {
          name: 'Queue Dashboard',
          description: `Queue management and monitoring dashboard. Port: ${String(queuePort)}${activeQueues !== undefined ? ` | Active Queues: ${activeQueues}` : ''}`,
          url: `${baseUrl}${this.configService?.get<string>('BULL_BOARD_URL', '/queue-dashboard') || '/queue-dashboard'}`,
          active: isQueueRunning, // Active if queue health check passes
          category: 'Monitoring',
          port: Number(queuePort),
          status: queueHealth?.details || (isQueueRunning ? 'Running' : 'Inactive'),
          metrics: {
            activeQueues,
            queueStatuses,
          },
        },
        {
          name: 'Logger',
          description: `Application logs and monitoring interface. Port: ${String(loggerPort)}`,
          url: `${baseUrl}/logger`,
          active: isLoggerRunning, // Active if logger health check passes
          category: 'Monitoring',
          port: Number(loggerPort),
          status: loggerHealth?.details || (isLoggerRunning ? 'Running' : 'Inactive'),
          metrics: loggerMetrics,
        },
        {
          name: 'WebSocket',
          description: `WebSocket endpoint for real-time communication. Port: ${String(basePort)}`,
          url: `${baseUrl}/socket-test`,
          active: isSocketRunning, // Active if socket health check passes
          category: 'API',
          port: Number(basePort),
          status: communicationHealthData?.communicationHealth?.socket?.connected
            ? 'Running'
            : 'Inactive',
          metrics: socketMetrics,
        },
        {
          name: 'Communication',
          description: `Communication service for email, WhatsApp, SMS, and push notifications. Port: ${String(basePort)}`,
          url: `${baseUrl}${appConfig.apiPrefix}/communication/health`,
          active: isCommunicationRunning, // Active if communication health check passes
          category: 'Services',
          port: Number(basePort),
          status: communicationHealth?.status === 'healthy' ? 'Running' : 'Inactive',
          metrics: communicationMetrics,
        },
      ];

      // Add development-only services with real-time status
      // Use actual exposed ports from Docker configuration
      // CRITICAL: Show Redis Commander in dev mode for both Redis and Dragonfly
      // Dragonfly is Redis-compatible, so Redis Commander can be used to manage it
      const cacheProvider = this.configService?.getCacheProvider() || 'dragonfly';
      const isRedisProvider = cacheProvider === 'redis';
      const isDragonflyProvider = cacheProvider === 'dragonfly';

      // Show Redis Commander in dev mode for both Redis and Dragonfly (Dragonfly is Redis-compatible)
      // In production/staging, only show if Redis is the provider and it's running
      if (!isProduction) {
        // Development mode: Always show Redis Commander (can be used for Dragonfly too)
        allServices.push({
          name: isDragonflyProvider ? 'Redis Commander (Dragonfly)' : 'Redis Commander',
          description: isDragonflyProvider
            ? 'Dragonfly cache management interface (Redis-compatible).'
            : 'Redis database management interface.',
          url: urlsConfig.redisCommander || this.configService.getEnv('REDIS_COMMANDER_URL') || '',
          active: isRedisCommanderRunning, // Active if Redis Commander health check passes
          category: 'Database',
          credentials: 'Username: admin, Password: admin',
          devOnly: true,
        });
      } else if (isRedisProvider && isRedisCommanderRunning) {
        // Production/Staging: Only show if Redis is the provider
        allServices.push({
          name: 'Redis Commander',
          description: 'Redis database management interface.',
          url: urlsConfig.redisCommander || this.configService.getEnv('REDIS_COMMANDER_URL') || '',
          active: isRedisCommanderRunning,
          category: 'Database',
          credentials: 'Username: admin, Password: admin',
          devOnly: false,
        });
      }

      if (!isProduction || isPrismaStudioRunning) {
        allServices.push({
          name: 'Prisma Studio',
          description: 'PostgreSQL database management through Prisma.',
          url: urlsConfig.prismaStudio || this.configService.getEnv('PRISMA_STUDIO_URL') || '',
          active: isPrismaStudioRunning, // Active if Prisma Studio health check passes
          category: 'Database',
          devOnly: !isProduction,
        });
      }

      // Filter services based on environment
      // Production/Staging: Only show essential services (worker, api, redis, postgres)
      // Development: Show all services
      const services = isProduction
        ? allServices.filter((service: ServiceInfo) => {
            // In production/staging, only show: API Documentation, Queue Dashboard, Logger, WebSocket, Communication
            // Hide: Prisma Studio, Redis Commander (unless Redis is provider)
            const essentialServices = [
              'API Documentation',
              'Queue Dashboard',
              'Logger',
              'WebSocket',
              'Communication',
            ];
            // Also show Redis Commander if Redis is the provider (not Dragonfly)
            if (service.name === 'Redis Commander' && !service.devOnly) {
              return true;
            }
            return essentialServices.includes(service.name);
          })
        : allServices;

      // Calculate overall system health with defensive checks
      const servicesData = healthData && 'services' in healthData ? healthData.services : {};
      const totalServices = servicesData ? Object.keys(servicesData).length : 0;
      const healthyServices = servicesData
        ? Object.values(servicesData).filter(
            (service: unknown): service is ServiceHealth =>
              typeof service === 'object' &&
              service !== null &&
              'status' in service &&
              (service as ServiceHealth).status === 'healthy'
          ).length
        : 0;
      const isSystemHealthy = totalServices > 0 && healthyServices === totalServices;

      // Initialize health dashboard data
      const dashboardData: DashboardData = {
        overallHealth: {
          status: isSystemHealthy ? 'healthy' : 'degraded',
          statusText: isSystemHealthy ? 'All systems operational' : 'System partially degraded',
          healthyCount: healthyServices,
          totalCount: totalServices,
          lastChecked: new Date().toLocaleString(),
          details: `${healthyServices} of ${totalServices} services are healthy`,
        },
        services: servicesData
          ? Object.entries(servicesData).map(([name, service]) => {
              const serviceData = service as ServiceHealth;
              const serviceMetrics =
                serviceData && 'metrics' in serviceData ? serviceData.metrics : {};
              return {
                id: name.toLowerCase(),
                name: name.charAt(0).toUpperCase() + name.slice(1),
                status: serviceData.status || 'unhealthy',
                isHealthy: serviceData.status === 'healthy',
                responseTime: serviceData.responseTime || 0,
                details: serviceData.error
                  ? serviceData.error
                  : serviceData.details ||
                    (serviceData.status === 'healthy'
                      ? 'Service is responding normally'
                      : 'Service is experiencing issues'),
                lastChecked: serviceData.lastChecked || new Date().toLocaleString(),
                metrics: serviceMetrics || {},
                ...(serviceData.error && { error: serviceData.error }),
              };
            })
          : [],
        clusterInfo:
          healthData &&
          'processInfo' in healthData &&
          healthData.processInfo &&
          'cluster' in healthData.processInfo
            ? (healthData.processInfo.cluster as DashboardData['clusterInfo'])
            : undefined,
      };

      // Only fetch logs in development mode
      let recentLogs: DashboardLogEntry[] = [];
      try {
        if (!isProduction && this.loggingService) {
          recentLogs = await this.getRecentLogs();
        }
      } catch (logError) {
        // Ignore log fetching errors - we still want to show the dashboard
        console.error('Failed to fetch recent logs:', logError);
        recentLogs = [];
      }

      // Generate HTML content with both service cards and health data
      const html = this.generateDashboardHtml(
        'Healthcare API Dashboard',
        services,
        recentLogs,
        isProduction,
        dashboardData,
        baseUrl
      );

      res.header('Content-Type', 'text/html');
      return res.send(html);
    } catch (_error) {
      try {
        if (this.loggingService) {
          void this.loggingService.log(
            LogType.ERROR,
            LogLevel.ERROR,
            'Error serving dashboard',
            'AppController',
            {
              error: _error instanceof Error ? _error.message : 'Unknown error',
              stack: _error instanceof Error ? _error.stack : String(_error),
            }
          );
        }
      } catch (logError) {
        // Ignore logging errors
        console.error('Failed to log dashboard error:', logError);
      }
      // Return a simple error page instead of crashing
      return res.status(500).send(`
        <html>
          <head><title>Dashboard Error</title></head>
          <body>
            <h1>Error loading dashboard</h1>
            <p>Please check server logs for details.</p>
            <p>Error: ${_error instanceof Error ? _error.message : 'Unknown error'}</p>
          </body>
        </html>
      `);
    }
  }

  @Get('socket-test')
  @Public()
  @ApiOperation({
    summary: 'WebSocket Test Page',
    description: 'A simple page to test WebSocket connectivity',
  })
  @ApiResponse({
    status: 200,
    description: 'WebSocket test page HTML',
  })
  async getSocketTestPage(@Res() res: FastifyReply) {
    const appConfig = this.configService.getAppConfig();
    // Get baseUrl from ConfigService - NO HARDCODED FALLBACKS
    const baseUrl: string =
      appConfig.apiUrl ||
      appConfig.baseUrl ||
      this.configService.getEnv('API_URL') ||
      this.configService.getEnv('BASE_URL') ||
      '';

    if (!baseUrl) {
      throw new Error('API_URL or BASE_URL must be configured in environment variables or config');
    }

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WebSocket Test</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            line-height: 1.6;
        }
        h1 {
            color: #2c3e50;
        }
        .card {
            background: #fff;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            padding: 20px;
            margin-bottom: 20px;
        }
        .status {
            padding: 8px 12px;
            border-radius: 20px;
            font-weight: 500;
            display: inline-block;
            margin-bottom: 10px;
        }
        .connected {
            background-color: #d4edda;
            color: #155724;
        }
        .disconnected {
            background-color: #f8d7da;
            color: #721c24;
        }
        .connecting {
            background-color: #fff3cd;
            color: #856404;
        }
        #messages {
            height: 200px;
            overflow-y: auto;
            border: 1px solid #ddd;
            padding: 10px;
            border-radius: 4px;
            margin-bottom: 10px;
            background-color: #f8f9fa;
        }
        .message {
            margin-bottom: 8px;
            padding: 8px;
            border-radius: 4px;
        }
        .received {
            background-color: #e2f0fd;
        }
        .sent {
            background-color: #e2fdea;
            text-align: right;
        }
        .timestamp {
            font-size: 0.8em;
            color: #6c757d;
            margin-top: 4px;
        }
        button {
            background-color: #007bff;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            margin-right: 10px;
        }
        button:hover {
            background-color: #0069d9;
        }
        input {
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            width: 70%;
            margin-right: 10px;
        }
    </style>
</head>
<body>
    <h1>WebSocket Test Page</h1>
    
    <div class="card">
        <h2>Connection Status</h2>
        <div id="status" class="status disconnected">Disconnected</div>
        <button id="connect">Connect</button>
        <button id="disconnect" disabled>Disconnect</button>
    </div>
    
    <div class="card">
        <h2>Messages</h2>
        <div id="messages"></div>
        
        <div>
            <input type="text" id="messageInput" placeholder="Type a message..." disabled>
            <button id="sendBtn" disabled>Send</button>
        </div>
    </div>
    
    <script src="${String(baseUrl)}/socket.io/socket.io.js"></script>
    <script>
        let socket;
        const statusEl = document.getElementById('status');
        const messagesEl = document.getElementById('messages');
        const connectBtn = document.getElementById('connect');
        const disconnectBtn = document.getElementById('disconnect');
        const messageInput = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');
        
        function updateStatus(status, message) {
            statusEl.className = 'status ' + status;
            statusEl.textContent = message;
            
            if (status === 'connected') {
                connectBtn.disabled = true;
                disconnectBtn.disabled = false;
                messageInput.disabled = false;
                sendBtn.disabled = false;
            } else {
                connectBtn.disabled = status === 'connecting';
                disconnectBtn.disabled = true;
                messageInput.disabled = true;
                sendBtn.disabled = true;
            }
        }
        
        function addMessage(text, type) {
            const messageEl = document.createElement('div');
            messageEl.className = 'message ' + type;
            
            const contentEl = document.createElement('div');
            contentEl.textContent = text;
            
            const timestampEl = document.createElement('div');
            timestampEl.className = 'timestamp';
            timestampEl.textContent = new Date().toLocaleTimeString();
            
            messageEl.appendChild(contentEl);
            messageEl.appendChild(timestampEl);
            messagesEl.appendChild(messageEl);
            
            // Scroll to bottom
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }
        
        connectBtn.addEventListener('click', () => {
            try {
                updateStatus('connecting', 'Connecting...');
                
                // Connect to the test namespace
                socket = io('${baseUrl}/test', {
                  transports: ['polling', 'websocket'],
                  forceNew: true,
                  reconnectionAttempts: 3,
                  timeout: 5000
                });
                
                socket.on('connect', () => {
                    updateStatus('connected', 'Connected');
                    addMessage('Connected to server', 'received');
                });
                
                socket.on('disconnect', () => {
                    updateStatus('disconnected', 'Disconnected');
                    addMessage('Disconnected from server', 'received');
                });
                
                socket.on('connect_error', (err) => {
                    updateStatus('disconnected', 'Connection Error');
                    addMessage('Connection _error: ' + err.message, 'received');
                });
                
                socket.on('message', (data) => {
                    addMessage('Server: ' + data.text, 'received');
                });
                
                socket.on('echo', (data) => {
                    addMessage('Echo: ' + JSON.stringify(data.original), 'received');
                });
            } catch (e) {
                updateStatus('disconnected', 'Error');
                addMessage('Error: ' + (e instanceof Error ? e.message : String(e)), 'received');
            }
        });
        
        disconnectBtn.addEventListener('click', () => {
            if (socket) {
                socket.disconnect();
                socket = null;
            }
        });
        
        sendBtn.addEventListener('click', () => {
            const message = messageInput.value.trim();
            if (message && socket) {
                socket.emit('message', { text: message });
                addMessage('You: ' + message, 'sent');
                messageInput.value = '';
            }
        });
        
        messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendBtn.click();
            }
        });
    </script>
</body>
</html>
    `;

    res.header('Content-Type', 'text/html');
    return res.send(html);
  }

  private async getRecentLogs(limit: number = 10): Promise<DashboardLogEntry[]> {
    try {
      // Use your logging service to get recent logs
      const result = await this.loggingService.getLogs(
        undefined,
        undefined,
        undefined,
        undefined,
        1,
        limit
      );
      const logs = result.logs;

      return logs.slice(0, limit).map(
        (log): DashboardLogEntry => ({
          timestamp: log.timestamp || new Date().toISOString(),
          level: (log.level as string) || 'info',
          message: log.message || 'No message',
          source: (log.type as string) || 'Unknown',
          data: log.metadata ? JSON.stringify(log.metadata) : '{}',
        })
      );
    } catch (_error) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Error fetching logs',
        'AppController',
        {
          error: _error instanceof Error ? _error.message : 'Unknown error',
          stack: _error instanceof Error ? _error.stack : String(_error),
        }
      );
      // Return placeholder data if there's an error
      return Array(limit)
        .fill(null)
        .map(
          (_, i): DashboardLogEntry => ({
            timestamp: new Date().toISOString(),
            level: 'info',
            message: `This is a placeholder log entry ${i + 1}`,
            source: 'System',
            data: '{}',
          })
        );
    }
  }

  private generateDashboardHtml(
    title: string,
    services: ServiceInfo[],
    recentLogs: DashboardLogEntry[],
    isProduction: boolean,
    healthData: DashboardData,
    baseUrl: string
  ): string {
    // Add this helper function at the beginning of generateDashboardHtml
    const formatDateTime = (dateString: string) => {
      const date = new Date(dateString);
      return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }).format(date);
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <script src="${String(baseUrl)}/socket.io/socket.io.js"></script>
    <style>
        /* Base styles */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background-color: #f8fafc;
            color: #1a202c;
            line-height: 1.6;
            font-size: 15px;
            min-height: 100vh;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem 1rem;
        }

        /* Header styles */
        header {
            text-align: center;
            margin-bottom: 2rem;
        }

        header h1 {
            font-size: 2.5rem;
            font-weight: 700;
            color: #1a202c;
            margin-bottom: 0.5rem;
            letter-spacing: -0.02em;
        }

        header p {
            color: #64748b;
        }

        /* Service Cards Section */
        .services-section {
            margin-bottom: 2rem;
        }

        .section-title {
            font-size: 1.5rem;
            font-weight: 700;
            color: #1a202c;
            margin-bottom: 1rem;
            letter-spacing: -0.02em;
        }

        .services-grid {
            display: grid;
            grid-template-columns: repeat(1, 1fr);
            gap: 1.5rem;
        }

        @media (min-width: 768px) {
            .services-grid {
                grid-template-columns: repeat(2, 1fr);
            }
        }

        @media (min-width: 1024px) {
            .services-grid {
                grid-template-columns: repeat(3, 1fr);
            }
        }

        .service-card {
            background-color: #ffffff;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            transition: transform 0.2s, box-shadow 0.2s;
            height: 100%;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .service-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 15px -3px rgba(0, 0, 0, 0.1);
        }

        .service-card-header {
            padding: 1rem;
            border-bottom: 1px solid #e2e8f0;
            display: flex;
            justify-content: space-between !important;
            align-items: center;
        }

        .service-header {
           display: flex !important;
            align-items: center;
            justify-content: space-between;
            gap: 0.5rem;
        }

        .service-header-content {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .service-status-indicator {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            display: inline-block;
        }

        .indicator-healthy {
            background: #22c55e;
            box-shadow: 0 0 4px rgba(52, 211, 153, 0.5);
        }

        .indicator-unhealthy {
            background: #ef4444;
            box-shadow: 0 0 4px rgba(248, 113, 113, 0.5);
        }

        .service-title {
            font-size: 1.0625rem;
            font-weight: 600;
            color: #334155;
            margin: 0;
            letter-spacing: -0.01em;
        }

        .status-badge {
            font-size: 0.8125rem;
            padding: 0.375rem 0.75rem;
            border-radius: 9999px;
            font-weight: 600;
            letter-spacing: 0.01em;
        }

        .status-active {
            background-color: #dcfce7;
            color: #166534;
        }

        .status-inactive {
            background-color: #fee2e2;
            color: #991b1b;
        }

        .service-description {
            padding: 1rem;
            color: #64748b;
            flex-grow: 1;
        }

        .service-footer {
            padding: 1rem;
            border-top: 1px solid #e2e8f0;
        }

        .access-button {
            display: block;
            width: 100%;
            padding: 0.5rem;
            text-align: center;
            border-radius: 6px;
            font-weight: 500;
            text-decoration: none;
            transition: background-color 0.2s;
        }

        .access-button.active {
            background-color: #3b82f6;
            color: white;
        }

        .access-button.active:hover {
            background-color: #2563eb;
        }

        .access-button.disabled {
            background-color: #94a3b8;
            color: white;
            cursor: not-allowed;
            opacity: 0.7;
        }

        .credentials-info {
            margin-top: 0.75rem;
            padding-top: 0.75rem;
            border-top: 1px solid #e2e8f0;
            font-size: 0.75rem;
            color: #64748b;
        }

        .credentials-label {
            font-weight: 500;
            color: #475569;
        }

        /* Health Dashboard Section */
        .health-dashboard {
            margin-top: 3rem;
        }

        .health-card {
            background-color: white;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }

        .health-card-header {
            padding: 1rem;
            border-bottom: 1px solid #e2e8f0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .health-card-header.healthy {
            background-color: #f0fdf4;
        }

        .health-card-header.unhealthy {
            background-color: #fef2f2;
        }

        .health-card-title {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 1.125rem;
            font-weight: 600;
            color: #334155;
            margin: 0;
            letter-spacing: -0.01em;
        }

        .status-circle {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            display: inline-block;
        }

        .status-healthy {
            background-color: #22c55e;
            box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.2);
        }

        .status-unhealthy {
            background-color: #ef4444;
            box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
        }

        .health-card-body {
            padding: 1rem;
        }

        .health-summary {
            text-align: center;
            margin-bottom: 1rem;
        }

        .health-status-text {
            font-weight: 600;
            font-size: 1.25rem;
            letter-spacing: -0.01em;
        }

        .status-text-healthy {
            color: #22c55e;
        }

        .status-text-unhealthy {
            color: #ef4444;
        }

        .service-section {
            background-color: white;
            border-radius: 8px;
            padding: 1rem;
            margin-bottom: 1rem;
            border-left: 3px solid transparent;
        }

        .service-section.healthy {
            border-left-color: #22c55e;
        }

        .service-section.unhealthy {
            border-left-color: #ef4444;
        }

        .health-metrics {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 0.5rem;
            margin-top: 0.5rem;
        }

        .metric {
            background-color: #f8fafc;
            padding: 0.5rem;
            border-radius: 6px;
        }

        .metric-label {
            color: #64748b;
            font-size: 0.8125rem;
            margin-bottom: 0.25rem;
            display: block;
            font-weight: 500;
        }

        .metric-value {
            color: #334155;
            font-weight: 600;
            font-size: 0.9375rem;
        }

        /* Logs Section */
        .logs-section {
            margin-top: 3rem;
        }

        .logs-table {
            width: 100%;
            border-collapse: collapse;
            background-color: white;
            border-radius: 8px;
            overflow: hidden;
        }

        .logs-table th {
            background-color: #f8fafc;
            padding: 0.75rem 1rem;
            text-align: left;
            font-weight: 600;
            color: #475569;
        }

        .logs-table td {
            padding: 0.75rem 1rem;
            border-top: 1px solid #e2e8f0;
        }

        .log-level {
            display: inline-block;
            padding: 0.25rem 0.5rem;
            border-radius: 9999px;
            font-size: 0.75rem;
            font-weight: 500;
        }

        .log-level-error {
            background-color: #fee2e2;
            color: #991b1b;
        }

        .log-level-warn {
            background-color: #fef3c7;
            color: #92400e;
        }

        .log-level-info {
            background-color: #dbeafe;
            color: #1e40af;
        }

        /* Footer */
        footer {
            margin-top: 3rem;
            text-align: center;
            color: #64748b;
            padding: 1rem 0;
        }

        footer p {
            margin: 0.5rem 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>${title}</h1>
            <p>System Status and Service Management${isProduction ? ' (Production Mode)' : ' (Development Mode)'}</p>
        </header>

        <!-- Service Cards Section -->
        <section class="services-section">
            <h2 class="section-title">Available Services</h2>
            <div class="services-grid">
                ${services
                  .map(
                    (service: ServiceInfo) => `
                    <div class="service-card">
                        <div class="service-card-header">
                            <div class="service-header-content">
                                <div class="service-status-indicator ${service.active ? 'indicator-healthy' : 'indicator-unhealthy'}"></div>
                                <h3 class="service-title">${service.name}${service.port ? ` <span style="font-size: 0.8em; color: #666; font-weight: normal;">(Port: ${service.port})</span>` : ''}</h3>
                            </div>
                            <span class="status-badge ${service.active ? 'status-active' : 'status-inactive'}">
                                ${service.active ? 'Active' : 'Inactive'}
                            </span>
                        </div>
                        <p class="service-description">${service.description}</p>
                        ${
                          service.status
                            ? `<div class="service-status-detail" style="margin-top: 8px; padding: 8px; background: #f8f9fa; border-radius: 4px; font-size: 0.9em; color: #495057;">
                            <strong>Status:</strong> ${service.status}
                        </div>`
                            : ''
                        }
                        ${
                          service.metrics && Object.keys(service.metrics).length > 0
                            ? `
                        <div class="service-metrics" style="margin-top: 8px; padding: 8px; background: #e9ecef; border-radius: 4px; font-size: 0.85em;">
                            ${
                              service.name === 'Queue Dashboard' &&
                              service.metrics['activeQueues'] !== undefined
                                ? `
                            <div><strong>Active Queues:</strong> ${typeof service.metrics['activeQueues'] === 'number' ? service.metrics['activeQueues'] : typeof service.metrics['activeQueues'] === 'string' ? service.metrics['activeQueues'] : '0'}</div>
                            ${
                              service.metrics['queueStatuses'] &&
                              typeof service.metrics['queueStatuses'] === 'object' &&
                              service.metrics['queueStatuses'] !== null
                                ? `
                            <div style="margin-top: 4px;"><strong>Queue Names:</strong> ${Object.keys(service.metrics['queueStatuses'] as Record<string, unknown>).join(', ') || 'None'}</div>
                            `
                                : ''
                            }
                            `
                                : ''
                            }
                            ${
                              service.name === 'Logger' && service.metrics['serviceName']
                                ? `
                            <div><strong>Service:</strong> ${typeof service.metrics['serviceName'] === 'string' ? service.metrics['serviceName'] : typeof service.metrics['serviceName'] === 'number' ? String(service.metrics['serviceName']) : 'Unknown'}</div>
                            ${service.metrics['url'] ? `<div style="margin-top: 4px;"><strong>URL:</strong> ${typeof service.metrics['url'] === 'string' ? service.metrics['url'] : typeof service.metrics['url'] === 'number' ? String(service.metrics['url']) : ''}</div>` : ''}
                            `
                                : ''
                            }
                        </div>
                        `
                            : ''
                        }
                        <div class="service-footer">
                            <a href="${service.url}" 
                               target="_blank" 
                               class="access-button ${service.active ? 'active' : 'disabled'}"
                               ${!service.active ? 'disabled' : ''}>
                                Access Service
                            </a>
                            ${
                              service.credentials
                                ? `
                                <div class="credentials-info">
                                    <span class="credentials-label">Credentials:</span> ${service.credentials}
                                </div>
                            `
                                : ''
                            }
                        </div>
                    </div>
                `
                  )
                  .join('')}
            </div>
        </section>

        <!-- Cluster Information Section -->
        ${
          healthData.clusterInfo
            ? `
        <section class="cluster-section" style="margin-top: 2rem; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); padding: 1.5rem;">
            <h2 class="section-title">Cluster & Node Information</h2>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-top: 1rem;">
                <div style="padding: 1rem; background: #f8f9fa; border-radius: 6px;">
                    <div style="font-size: 0.875rem; color: #64748b; margin-bottom: 0.5rem;">Process Type</div>
                    <div style="font-size: 1.125rem; font-weight: 600; color: #1e293b;">
                        ${healthData.clusterInfo.isPrimary ? 'Primary (Master)' : healthData.clusterInfo.isWorker ? 'Worker' : 'Standalone'}
                    </div>
                </div>
                <div style="padding: 1rem; background: #f8f9fa; border-radius: 6px;">
                    <div style="font-size: 0.875rem; color: #64748b; margin-bottom: 0.5rem;">Worker ID</div>
                    <div style="font-size: 1.125rem; font-weight: 600; color: #1e293b;">
                        ${healthData.clusterInfo.workerId !== undefined ? healthData.clusterInfo.workerId : 'N/A'}
                    </div>
                </div>
                <div style="padding: 1rem; background: #f8f9fa; border-radius: 6px;">
                    <div style="font-size: 0.875rem; color: #64748b; margin-bottom: 0.5rem;">Instance ID</div>
                    <div style="font-size: 1.125rem; font-weight: 600; color: #1e293b;">
                        ${healthData.clusterInfo.instanceId}
                    </div>
                </div>
                <div style="padding: 1rem; background: #f8f9fa; border-radius: 6px;">
                    <div style="font-size: 0.875rem; color: #64748b; margin-bottom: 0.5rem;">Node Name</div>
                    <div style="font-size: 1.125rem; font-weight: 600; color: #1e293b;">
                        ${healthData.clusterInfo.nodeName}
                    </div>
                </div>
                <div style="padding: 1rem; background: #f8f9fa; border-radius: 6px;">
                    <div style="font-size: 0.875rem; color: #64748b; margin-bottom: 0.5rem;">Hostname</div>
                    <div style="font-size: 1.125rem; font-weight: 600; color: #1e293b;">
                        ${healthData.clusterInfo.hostname}
                    </div>
                </div>
                <div style="padding: 1rem; background: #f8f9fa; border-radius: 6px;">
                    <div style="font-size: 0.875rem; color: #64748b; margin-bottom: 0.5rem;">CPU Cores</div>
                    <div style="font-size: 1.125rem; font-weight: 600; color: #1e293b;">
                        ${healthData.clusterInfo.cpuCount}
                    </div>
                </div>
                ${
                  healthData.clusterInfo.totalWorkers !== undefined
                    ? `
                <div style="padding: 1rem; background: #f8f9fa; border-radius: 6px;">
                    <div style="font-size: 0.875rem; color: #64748b; margin-bottom: 0.5rem;">Total Workers</div>
                    <div style="font-size: 1.125rem; font-weight: 600; color: #1e293b;">
                        ${healthData.clusterInfo.totalWorkers}
                    </div>
                </div>
                `
                    : ''
                }
                ${
                  healthData.clusterInfo.activeWorkers !== undefined
                    ? `
                <div style="padding: 1rem; background: #f8f9fa; border-radius: 6px;">
                    <div style="font-size: 0.875rem; color: #64748b; margin-bottom: 0.5rem;">Active Workers</div>
                    <div style="font-size: 1.125rem; font-weight: 600; color: #1e293b;">
                        ${healthData.clusterInfo.activeWorkers}
                    </div>
                </div>
                `
                    : ''
                }
            </div>
        </section>
        `
            : ''
        }

        <!-- Health Dashboard Section -->
        <section class="health-dashboard">
            <h2 class="section-title">System Health Status</h2>
            <div class="health-card">
                <div class="health-card-header ${healthData.overallHealth.status === 'healthy' ? 'healthy' : 'unhealthy'}">
                    <h3 class="health-card-title">
                        <span class="status-circle ${healthData.overallHealth.status === 'healthy' ? 'status-healthy' : 'status-unhealthy'}"></span>
                        Overall System Health
                    </h3>
                    <span style="font-size: 0.75rem; color: #64748b;">Last checked: ${formatDateTime(healthData.overallHealth.lastChecked)}</span>
                </div>
                <div class="health-card-body">
                    <div class="health-summary">
                        <span class="health-status-text ${healthData.overallHealth.status === 'healthy' ? 'status-text-healthy' : 'status-text-unhealthy'}">
                            ${healthData.overallHealth.statusText}
                        </span>
                    </div>
                    <p style="text-align: center; color: #64748b; font-size: 0.9375rem; line-height: 1.5; margin-top: 0.5rem;">${healthData.overallHealth.details}</p>
                </div>
            </div>

            <div style="margin-top: 1.5rem;">
                ${healthData.services
                  .map(
                    (service: {
                      id: string;
                      name: string;
                      status: string;
                      isHealthy: boolean;
                      responseTime: number;
                      details: string;
                      lastChecked: string;
                      metrics: Record<string, unknown>;
                      error?: string;
                    }) => `
                    <div class="service-section ${service.isHealthy ? 'healthy' : 'unhealthy'}" data-service="${service.id}">
                        <div class="service-header">
                            <div class="service-header-content">
                                <div class="service-status-indicator ${service.isHealthy ? 'indicator-healthy' : 'indicator-unhealthy'}"></div>
                                <h3 class="service-title">${service.name}</h3>
                            </div>
                            <span class="health-status-text ${service.isHealthy ? 'status-text-healthy' : 'status-text-unhealthy'}">
                                ${service.isHealthy ? 'Active' : 'Inactive'}
                            </span>
                        </div>
                        <p style="color: #64748b; margin: 0.5rem 0; font-size: 0.9375rem; line-height: 1.5;">${service.details}</p>
                        ${
                          service.error && !service.isHealthy
                            ? `<div style="margin-top: 0.5rem; padding: 0.75rem; background: #fee2e2; border-left: 3px solid #ef4444; border-radius: 4px;">
                            <strong style="color: #991b1b;">Error Details:</strong>
                            <p style="color: #991b1b; margin: 0.25rem 0 0 0; font-size: 0.9em;">${service.error}</p>
                        </div>`
                            : ''
                        }
                        ${
                          service.metrics && Object.keys(service.metrics).length > 0
                            ? `
                        <div style="margin-top: 0.5rem; padding: 0.5rem; background: #f8f9fa; border-radius: 4px; font-size: 0.85em;">
                            ${Object.entries(service.metrics)
                              .filter(([key]) => !['port', 'url', 'dashboardUrl'].includes(key))
                              .map(([key, value]: [string, unknown]) => {
                                let displayValue = 'N/A';
                                if (value !== null && value !== undefined) {
                                  if (
                                    typeof value === 'object' &&
                                    !Array.isArray(value) &&
                                    value.constructor === Object
                                  ) {
                                    // For objects like queueStatuses, show count or summary
                                    const objKeys = Object.keys(value);
                                    if (objKeys.length > 0) {
                                      displayValue = `${objKeys.length} item(s)`;
                                    } else {
                                      displayValue = 'Empty';
                                    }
                                  } else if (Array.isArray(value)) {
                                    displayValue = `${value.length} item(s)`;
                                  } else if (
                                    typeof value === 'string' ||
                                    typeof value === 'number' ||
                                    typeof value === 'boolean'
                                  ) {
                                    displayValue = String(value);
                                  } else {
                                    displayValue = JSON.stringify(value);
                                  }
                                }
                                return `
                                <div style="display: inline-block; margin-right: 1rem; margin-bottom: 0.25rem;">
                                    <strong>${key}:</strong> ${displayValue}
                                </div>
                                `;
                              })
                              .join('')}
                        </div>
                        `
                            : ''
                        }
                        <div class="health-metrics">
                                <div class="metric">
                                <span class="metric-label">Status</span>
                                <span class="metric-value ${service.isHealthy ? 'status-text-healthy' : 'status-text-unhealthy'}">
                                    ${service.isHealthy ? 'Active' : 'Inactive'}
                                </span>
                            </div>
                            <div class="metric">
                                <span class="metric-label">Response Time</span>
                                <span class="metric-value">${service.responseTime} ms</span>
                            </div>
                            ${
                              service.metrics && Object.keys(service.metrics).length > 0
                                ? Object.entries(service.metrics)
                                    .filter(([key]) => {
                                      // Show important metrics, skip complex objects
                                      const importantKeys = [
                                        'port',
                                        'activeQueues',
                                        'connectedClients',
                                        'usedMemory',
                                        'totalKeys',
                                        'activeConnections',
                                      ];
                                      return importantKeys.includes(key);
                                    })
                                    .map(([key, value]: [string, unknown]) => {
                                      let displayValue = 'N/A';
                                      if (value !== null && value !== undefined) {
                                        if (
                                          typeof value === 'string' ||
                                          typeof value === 'number' ||
                                          typeof value === 'boolean'
                                        ) {
                                          displayValue = String(value);
                                        } else {
                                          displayValue = 'N/A';
                                        }
                                      }
                                      return `
                                <div class="metric">
                                    <span class="metric-label">${key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1')}</span>
                                    <span class="metric-value">${displayValue}</span>
                                </div>
                            `;
                                    })
                                    .join('')
                                : ''
                            }
                            <div class="metric">
                                <span class="metric-label">Last Checked</span>
                                <span class="metric-value">${formatDateTime(service.lastChecked)}</span>
                            </div>
                        </div>
                    </div>
                `
                  )
                  .join('')}
            </div>
        </section>

        ${
          !isProduction && recentLogs.length > 0
            ? `
            <!-- Recent Logs Section -->
            <section class="logs-section">
                <h2 class="section-title">Recent Logs</h2>
                <div style="background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); overflow: auto;">
                    <table class="logs-table">
                        <thead>
                            <tr>
                                <th>Time</th>
                                <th>Level</th>
                                <th>Source</th>
                                <th>Message</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${recentLogs
                              .map((log: DashboardLogEntry) => {
                                const timestamp =
                                  typeof log.timestamp === 'string'
                                    ? log.timestamp
                                    : new Date(log.timestamp).toISOString();
                                const level = typeof log.level === 'string' ? log.level : 'info';
                                return `
                                <tr>
                                    <td>${formatDateTime(timestamp)}</td>
                                    <td>
                                        <span class="log-level ${
                                          level === 'error'
                                            ? 'log-level-error'
                                            : level === 'warn'
                                              ? 'log-level-warn'
                                              : 'log-level-info'
                                        }">
                                            ${level}
                                        </span>
                                    </td>
                                    <td>${typeof log.source === 'string' ? log.source : 'Unknown'}</td>
                                    <td>${typeof log.message === 'string' ? log.message : 'No message'}</td>
                                </tr>
                            `;
                              })
                              .join('')}
                        </tbody>
                    </table>
                </div>
            </section>
        `
            : ''
        }

        <footer>
            <p>Environment: ${isProduction ? 'Production' : 'Development'}</p>
            <p>© ${new Date().getFullYear()} Healthcare API. All rights reserved.</p>
        </footer>
    </div>

    <script>
        // Real-time health monitoring via Socket.IO
        // Connects to /health namespace for push-based updates (no polling)
        let healthSocket = null;
        let updateInterval = null;
        let isUpdating = false;
        let lastUpdateTime = 0;
        const MIN_UPDATE_INTERVAL_MS = 20000; // Fallback AJAX interval (if Socket.IO fails)
        const BASE_URL = '${String(baseUrl)}';
        
        // Initialize Socket.IO connection to realtime health gateway
        function initRealtimeHealth() {
            try {
                if (typeof io === 'undefined') {
                    console.warn('Socket.IO not loaded, falling back to AJAX polling');
                    startAjaxPolling();
                    return;
                }
                
                // Connect to /health namespace for real-time health updates
                healthSocket = io(BASE_URL + '/health', {
                    transports: ['websocket', 'polling'],
                    reconnection: true,
                    reconnectionAttempts: 5,
                    reconnectionDelay: 1000,
                    timeout: 5000,
                });
                
                // Subscribe to health updates
                healthSocket.on('connect', () => {
                    console.log('Connected to realtime health gateway');
                    healthSocket.emit('health:subscribe');
                });
                
                // Handle full health status updates
                healthSocket.on('health:status', (status) => {
                    updateDashboardFromRealtimeStatus(status);
                });
                
                // Handle incremental service updates
                healthSocket.on('health:service:update', (update) => {
                    updateServiceFromRealtimeUpdate(update);
                });
                
                // Handle heartbeat (lightweight ping)
                healthSocket.on('health:heartbeat', (heartbeat) => {
                    updateOverallStatus(heartbeat.o);
                });
                
                // Handle connection errors
                healthSocket.on('connect_error', (error) => {
                    console.warn('Health socket connection error:', error);
                    // Fallback to AJAX polling if Socket.IO fails
                    if (!updateInterval) {
                        startAjaxPolling();
                    }
                });
                
                // Handle disconnection
                healthSocket.on('disconnect', () => {
                    console.warn('Disconnected from health gateway, falling back to AJAX');
                    if (!updateInterval) {
                        startAjaxPolling();
                    }
                });
                
            } catch (error) {
                console.error('Failed to initialize realtime health:', error);
                startAjaxPolling();
            }
        }
        
        // Update dashboard from realtime health status
        function updateDashboardFromRealtimeStatus(status) {
            if (!status) return;
            
            // Update overall status
            if (status.o) {
                updateOverallStatus(status.o);
            }
            
            // Update services
            if (status.s) {
                Object.entries(status.s).forEach(([serviceName, serviceData]) => {
                    updateServiceStatus(serviceName, serviceData);
                });
            }
            
            // Update system metrics if available
            if (status.sys) {
                updateSystemMetrics(status.sys);
            }
            
            // Update timestamp
            if (status.t) {
                updateLastChecked(status.t);
            }
        }
        
        // Update service from incremental update
        function updateServiceFromRealtimeUpdate(update) {
            if (!update || !update.id || !update.st) return;
            
            const serviceName = update.id;
            const status = update.st;
            
            // Find service element and update
            const serviceElement = document.querySelector('[data-service="' + serviceName + '"]');
            if (serviceElement) {
                const isHealthy = status === 'healthy';
                updateServiceElement(serviceElement, isHealthy, update.rt);
            }
        }
        
        // Update overall health status
        function updateOverallStatus(status) {
            const statusElement = document.querySelector('.health-card-header');
            const statusCircle = document.querySelector('.status-circle');
            const statusText = document.querySelector('.health-status-text');
            
            if (statusElement) {
                statusElement.className = \`health-card-header \${status === 'healthy' ? 'healthy' : status === 'degraded' ? 'unhealthy' : 'unhealthy'}\`;
            }
            
            if (statusCircle) {
                statusCircle.className = \`status-circle \${status === 'healthy' ? 'status-healthy' : 'status-unhealthy'}\`;
            }
            
            if (statusText) {
                statusText.textContent = status === 'healthy' ? 'All systems operational' : status === 'degraded' ? 'System partially degraded' : 'System unhealthy';
                statusText.className = \`health-status-text \${status === 'healthy' ? 'status-text-healthy' : 'status-text-unhealthy'}\`;
            }
        }
        
        // Update service status
        function updateServiceStatus(serviceName, serviceData) {
            const serviceElement = document.querySelector('[data-service="' + serviceName + '"]');
            if (!serviceElement || !serviceData) return;
            
            const isHealthy = serviceData.status === 'healthy';
            const responseTime = serviceData.responseTime || 0;
            
            updateServiceElement(serviceElement, isHealthy, responseTime, serviceData);
        }
        
        // Update service element UI
        function updateServiceElement(element, isHealthy, responseTime, serviceData) {
            // Update status indicator
            const indicator = element.querySelector('.service-status-indicator');
            if (indicator) {
                const indicatorClass = isHealthy ? 'indicator-healthy' : 'indicator-unhealthy';
                indicator.className = 'service-status-indicator ' + indicatorClass;
            }
            
            // Update status text
            const statusText = element.querySelector('.health-status-text, .status-text');
            if (statusText) {
                statusText.textContent = isHealthy ? 'Active' : 'Inactive';
                const textClass = isHealthy ? 'status-text-healthy' : 'status-text-unhealthy';
                statusText.className = 'health-status-text ' + textClass;
            }
            
            // Update response time
            if (responseTime !== undefined) {
                const metrics = element.querySelectorAll('.metric');
                metrics.forEach(metric => {
                    const label = metric.querySelector('.metric-label');
                    if (label && label.textContent.includes('Response Time')) {
                        const value = metric.querySelector('.metric-value');
                        if (value) {
                            value.textContent = responseTime + ' ms';
                        }
                    }
                });
            }
            
            // Update last checked
            if (serviceData && serviceData.timestamp) {
                const lastChecked = element.querySelector('.metric-value');
                // Find last checked metric
                const metrics = element.querySelectorAll('.metric');
                metrics.forEach(metric => {
                    const label = metric.querySelector('.metric-label');
                    if (label && label.textContent.includes('Last Checked')) {
                        const value = metric.querySelector('.metric-value');
                        if (value) {
                            value.textContent = new Date(serviceData.timestamp).toLocaleString();
                        }
                    }
                });
            }
            
            // Update section class
            const sectionClass = isHealthy ? 'healthy' : 'unhealthy';
            element.className = 'service-section ' + sectionClass;
        }
        
        // Update system metrics
        function updateSystemMetrics(metrics) {
            // Update CPU if available
            if (metrics.cpu !== undefined) {
                const cpuElement = document.querySelector('[data-metric="cpu"]');
                if (cpuElement) {
                    cpuElement.textContent = metrics.cpu.toFixed(1) + '%';
                }
            }
            
            // Update memory if available
            if (metrics.memory !== undefined) {
                const memoryElement = document.querySelector('[data-metric="memory"]');
                if (memoryElement) {
                    memoryElement.textContent = metrics.memory.toFixed(1) + '%';
                }
            }
        }
        
        // Update last checked timestamp
        function updateLastChecked(timestamp) {
            const lastCheckedElement = document.querySelector('.health-card-header span');
            if (lastCheckedElement && timestamp) {
                lastCheckedElement.textContent = 'Last checked: ' + new Date(timestamp).toLocaleString();
            }
        }
        
        // Fallback: AJAX polling (if Socket.IO fails)
        function startAjaxPolling() {
            console.log('Starting AJAX polling fallback');
        
        // Function to update dashboard data via AJAX
        async function updateDashboard() {
            // Prevent concurrent updates and throttle requests
            if (isUpdating) return;
            
            // Throttle: Don't update more frequently than cache TTL
            const now = Date.now();
            const timeSinceLastUpdate = now - lastUpdateTime;
            if (timeSinceLastUpdate < MIN_UPDATE_INTERVAL_MS) {
                // Too soon - skip this update (prevents excessive requests)
                return;
            }
            
            isUpdating = true;
            lastUpdateTime = now;
            
            try {
                // Use existing /health endpoint (optimized with caching internally)
                const response = await fetch('/health', {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json',
                    },
                    cache: 'no-cache',
                });
                
                if (!response.ok) {
                    throw new Error(\`HTTP error! status: \${response.status}\`);
                }
                
                const healthData = await response.json();
                
                // Update overall health status
                if (healthData.status) {
                    const statusElement = document.querySelector('.overall-health .status-text');
                    if (statusElement) {
                        statusElement.textContent = healthData.status.toUpperCase();
                        statusElement.className = \`status-text status-text-\${healthData.status}\`;
                    }
                    
                    const lastCheckedElement = document.querySelector('.overall-health .last-checked');
                    if (lastCheckedElement && healthData.timestamp) {
                        lastCheckedElement.textContent = \`Last checked: \${new Date(healthData.timestamp).toLocaleString()}\`;
                    }
                }
                
                // Update individual service statuses
                if (healthData.services) {
                    Object.entries(healthData.services).forEach(([serviceName, serviceData]) => {
                        const serviceElement = document.querySelector(\`[data-service="\${serviceName}"]\`);
                        if (serviceElement && serviceData) {
                            const service = serviceData;
                            
                            // Update status indicator
                            const statusIndicator = serviceElement.querySelector('.status-indicator');
                            if (statusIndicator) {
                                statusIndicator.className = \`status-indicator \${service.status === 'healthy' ? 'status-healthy' : 'status-unhealthy'}\`;
                            }
                            
                            // Update status text
                            const statusText = serviceElement.querySelector('.status-text');
                            if (statusText) {
                                statusText.textContent = service.status === 'healthy' ? 'Active' : 'Inactive';
                                statusText.className = \`status-text \${service.status === 'healthy' ? 'status-text-healthy' : 'status-text-unhealthy'}\`;
                            }
                            
                            // Update response time
                            const responseTimeElement = serviceElement.querySelector('.metric-value');
                            if (responseTimeElement && service.responseTime !== undefined) {
                                const responseTimeMetric = Array.from(serviceElement.querySelectorAll('.metric')).find(m => 
                                    m.textContent.includes('Response Time')
                                );
                                if (responseTimeMetric) {
                                    const valueElement = responseTimeMetric.querySelector('.metric-value');
                                    if (valueElement) {
                                        valueElement.textContent = \`\${service.responseTime} ms\`;
                                    }
                                }
                            }
                            
                            // Update last checked
                            const lastCheckedElement = serviceElement.querySelector('.last-checked');
                            if (lastCheckedElement && service.lastChecked) {
                                lastCheckedElement.textContent = \`Last checked: \${new Date(service.lastChecked).toLocaleString()}\`;
                            }
                        }
                    });
                }
                
                // Update system metrics if available
                if (healthData.systemMetrics) {
                    const metrics = healthData.systemMetrics;
                    
                    // Update memory usage
                    if (metrics.memoryUsage) {
                        const memoryElement = document.querySelector('[data-metric="memory"]');
                        if (memoryElement && metrics.memoryUsage.heapUsed && metrics.memoryUsage.heapTotal) {
                            const percentage = ((metrics.memoryUsage.heapUsed / metrics.memoryUsage.heapTotal) * 100).toFixed(1);
                            memoryElement.textContent = \`\${percentage}% (\${formatBytes(metrics.memoryUsage.heapUsed)} / \${formatBytes(metrics.memoryUsage.heapTotal)})\`;
                        }
                    }
                    
                    // Update CPU usage
                    if (metrics.cpuUsage) {
                        const cpuElement = document.querySelector('[data-metric="cpu"]');
                        if (cpuElement && metrics.cpuUsage.cpuCount) {
                            cpuElement.textContent = \`\${metrics.cpuUsage.cpuCount} cores\`;
                        }
                    }
                }
                
            } catch (error) {
                console.error('Dashboard update error:', error);
                // Silently fail - don't disrupt user experience
            } finally {
                isUpdating = false;
            }
        }
        
        // Helper function to format bytes
        function formatBytes(bytes) {
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
        }
        
            // Start AJAX polling
            updateInterval = setInterval(updateDashboard, 30000); // 30 seconds fallback
            setTimeout(updateDashboard, 2000); // Initial update
        }
        
        // Initialize realtime health monitoring on page load
        // This uses Socket.IO for push-based updates (no polling)
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initRealtimeHealth);
        } else {
            initRealtimeHealth();
        }
        
        // Cleanup on page unload
        window.addEventListener('beforeunload', () => {
            if (healthSocket) {
                healthSocket.disconnect();
                healthSocket = null;
            }
            if (updateInterval) {
                clearInterval(updateInterval);
                updateInterval = null;
            }
        });
    </script>
</body>
</html>`;
  }
}
