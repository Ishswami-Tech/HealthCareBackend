import { Controller, Get, Res, Inject, forwardRef } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from '@core/decorators/public.decorator';
import { ConfigService } from '@config';
import { FastifyReply } from 'fastify';
import { HealthService } from './services/health/health.service';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import type { DetailedHealthCheckResponse, ServiceHealth } from '@core/types/common.types';

// Local types for dashboard
interface ServiceInfo {
  name: string;
  description: string;
  url: string;
  active: boolean;
  category: string;
  credentials?: string;
  devOnly?: boolean;
}

interface DashboardLogEntry {
  timestamp: string | Date;
  level: string;
  message: string;
  source: string;
  data: string;
}

interface LoggingServiceLogEntry {
  timestamp?: string | Date;
  level?: string;
  message?: string;
  type?: string;
  metadata?: unknown;
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
  }>;
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
      const host: string =
        this.configService?.get<string>('API_URL') ||
        process.env['API_URL'] ||
        'https://api.ishswami.in';
      const baseUrl = host.endsWith('/') ? host.slice(0, -1) : host;
      const isProduction = process.env['NODE_ENV'] === 'production';

      // Get real-time service status from health service with comprehensive error handling
      // HealthService is now independent and always returns a valid response
      let healthData;
      try {
        // Add timeout to prevent hanging - HealthService should respond quickly
        const healthCheckPromise = this.healthService.checkDetailedHealth();
        const timeoutPromise = new Promise<DetailedHealthCheckResponse>(resolve => {
          setTimeout(() => {
            resolve({
              status: 'degraded',
              timestamp: new Date().toISOString(),
              environment: process.env['NODE_ENV'] || 'development',
              version: process.env['npm_package_version'] || '0.0.1',
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
                  metrics: {
                    queryResponseTime: 0,
                    activeConnections: 0,
                    maxConnections: 0,
                    connectionUtilization: 0,
                  },
                },
                redis: {
                  status: 'unhealthy' as const,
                  responseTime: 0,
                  lastChecked: new Date().toISOString(),
                  metrics: {
                    connectedClients: 0,
                    usedMemory: 0,
                    totalKeys: 0,
                    lastSave: new Date().toISOString(),
                  },
                },
                queues: {
                  status: 'unhealthy' as const,
                  responseTime: 0,
                  lastChecked: new Date().toISOString(),
                },
                logger: {
                  status: 'unhealthy' as const,
                  responseTime: 0,
                  lastChecked: new Date().toISOString(),
                },
                socket: {
                  status: 'unhealthy' as const,
                  responseTime: 0,
                  lastChecked: new Date().toISOString(),
                },
                email: {
                  status: 'unhealthy' as const,
                  responseTime: 0,
                  lastChecked: new Date().toISOString(),
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
          }, 10000); // 10 second timeout
        });
        healthData = await Promise.race([healthCheckPromise, timeoutPromise]);
      } catch (healthError) {
        // If health check fails completely, use default degraded status
        // This should rarely happen as HealthService is designed to never throw
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
        // Create a default health data structure
        healthData = {
          status: 'degraded',
          timestamp: new Date().toISOString(),
          environment: process.env['NODE_ENV'] || 'development',
          version: process.env['npm_package_version'] || '0.0.1',
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
              metrics: {
                queryResponseTime: 0,
                activeConnections: 0,
                maxConnections: 0,
                connectionUtilization: 0,
              },
            },
            redis: {
              status: 'unhealthy' as const,
              responseTime: 0,
              lastChecked: new Date().toISOString(),
              metrics: {
                connectedClients: 0,
                usedMemory: 0,
                totalKeys: 0,
                lastSave: new Date().toISOString(),
              },
            },
            queues: {
              status: 'unhealthy' as const,
              responseTime: 0,
              lastChecked: new Date().toISOString(),
            },
            logger: {
              status: 'unhealthy' as const,
              responseTime: 0,
              lastChecked: new Date().toISOString(),
            },
            socket: {
              status: 'unhealthy' as const,
              responseTime: 0,
              lastChecked: new Date().toISOString(),
            },
            email: {
              status: 'unhealthy' as const,
              responseTime: 0,
              lastChecked: new Date().toISOString(),
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

      // Map health data to service status format with defensive null checks
      const healthServices =
        (healthData && 'services' in healthData ? healthData.services : {}) || {};
      const healthStatus = {
        api: {
          status:
            (healthServices.api as ServiceHealth | undefined)?.status === 'healthy' ? 'up' : 'down',
        },
        redis: {
          status:
            (healthServices.redis as ServiceHealth | undefined)?.status === 'healthy'
              ? 'up'
              : 'down',
        },
        database: {
          status:
            (healthServices.database as ServiceHealth | undefined)?.status === 'healthy'
              ? 'up'
              : 'down',
        },
        queues: {
          status:
            (healthServices.queues as ServiceHealth | undefined)?.status === 'healthy'
              ? 'up'
              : 'down',
        },
        logger: {
          status:
            (healthServices.logger as ServiceHealth | undefined)?.status === 'healthy'
              ? 'up'
              : 'down',
        },
        socket: {
          status:
            (healthServices.socket as ServiceHealth | undefined)?.status === 'healthy'
              ? 'up'
              : 'down',
        },
        email: {
          status:
            (healthServices.email as ServiceHealth | undefined)?.status === 'healthy'
              ? 'up'
              : 'down',
        },
        prismaStudio: {
          status:
            (healthServices as { prismaStudio?: ServiceHealth }).prismaStudio?.status === 'healthy'
              ? 'up'
              : 'down',
        },
        redisCommander: {
          status:
            (healthServices as { redisCommander?: ServiceHealth }).redisCommander?.status ===
            'healthy'
              ? 'up'
              : 'down',
        },
        pgAdmin: {
          status:
            (healthServices as { pgAdmin?: ServiceHealth }).pgAdmin?.status === 'healthy'
              ? 'up'
              : 'down',
        },
        lastUpdated: new Date(),
      };

      // Check if services are running
      const isApiRunning = healthStatus.api.status === 'up';
      const isRedisRunning = healthStatus.redis.status === 'up';
      const isDatabaseRunning = healthStatus.database.status === 'up';
      const isQueueRunning = healthStatus.queues.status === 'up';
      const isLoggerRunning = healthStatus.logger.status === 'up';
      const isSocketRunning = healthStatus.socket.status === 'up';
      const isEmailRunning = healthStatus.email.status === 'up';
      const isPrismaStudioRunning = healthStatus.prismaStudio.status === 'up';
      const isRedisCommanderRunning = healthStatus.redisCommander.status === 'up';
      const isPgAdminRunning = healthStatus.pgAdmin.status === 'up';

      // Define all services
      const allServices: ServiceInfo[] = [
        {
          name: 'API Documentation',
          description: 'Swagger API documentation and testing interface.',
          url: `${baseUrl}${this.configService?.get<string>('SWAGGER_URL', '/docs') || process.env['SWAGGER_URL'] || '/docs'}`,
          active: isApiRunning,
          category: 'Documentation',
        },
        {
          name: 'Queue Dashboard',
          description: 'Queue management and monitoring dashboard.',
          url: `${baseUrl}${this.configService?.get<string>('BULL_BOARD_URL', '/queue-dashboard') || process.env['BULL_BOARD_URL'] || '/queue-dashboard'}`,
          active: isQueueRunning,
          category: 'Monitoring',
        },
        {
          name: 'Logger',
          description: 'Application logs and monitoring interface.',
          url: `${baseUrl}/logger`,
          active: isLoggerRunning,
          category: 'Monitoring',
        },
        {
          name: 'WebSocket',
          description: 'WebSocket endpoint for real-time communication.',
          url: `${baseUrl}/socket-test`,
          active: isSocketRunning,
          category: 'API',
        },
        {
          name: 'Email Service',
          description: 'Email sending and template management.',
          url: `${baseUrl}/email-status`,
          active: isEmailRunning,
          category: 'Services',
        },
      ];

      // Add development-only services
      if (!isProduction || isRedisCommanderRunning) {
        allServices.push({
          name: 'Redis Commander',
          description: 'Redis database management interface.',
          url: isProduction
            ? `${this.configService?.get<string>('REDIS_COMMANDER_URL', '/redis-ui') || process.env['REDIS_COMMANDER_URL'] || '/redis-ui'}`
            : `${baseUrl}/redis-ui`,
          active: isRedisRunning && isRedisCommanderRunning,
          category: 'Database',
          credentials: 'Username: admin, Password: admin',
          devOnly: !isRedisCommanderRunning,
        });
      }

      if (!isProduction || isPrismaStudioRunning) {
        allServices.push({
          name: 'Prisma Studio',
          description: 'PostgreSQL database management through Prisma.',
          url: isProduction
            ? `${this.configService?.get<string>('PRISMA_STUDIO_URL', '/prisma') || process.env['PRISMA_STUDIO_URL'] || '/prisma'}`
            : `${baseUrl}/prisma`,
          active: isDatabaseRunning && isPrismaStudioRunning,
          category: 'Database',
          devOnly: !isPrismaStudioRunning,
        });
      }

      if (!isProduction || isPgAdminRunning) {
        allServices.push({
          name: 'pgAdmin',
          description: 'PostgreSQL database management interface.',
          url: isProduction
            ? `${this.configService?.get('PGADMIN_URL', '/pgadmin')}`
            : `${baseUrl}/pgadmin`,
          active: isDatabaseRunning && isPgAdminRunning,
          category: 'Database',
          credentials: 'Email: admin@admin.com, Password: admin',
          devOnly: !isPgAdminRunning,
        });
      }

      // Filter services based on environment
      const services = isProduction
        ? allServices.filter((service: ServiceInfo) => !service.devOnly)
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
              return {
                id: name.toLowerCase(),
                name: name.charAt(0).toUpperCase() + name.slice(1),
                status: serviceData.status || 'unhealthy',
                isHealthy: serviceData.status === 'healthy',
                responseTime: serviceData.responseTime || 0,
                details:
                  serviceData.details ||
                  (serviceData.status === 'healthy'
                    ? 'Service is responding normally'
                    : 'Service is experiencing issues'),
                lastChecked: serviceData.lastChecked || new Date().toLocaleString(),
                metrics: {},
              };
            })
          : [],
      };

      // Only fetch logs in development mode
      const recentLogs = isProduction ? [] : await this.getRecentLogs();

      // Generate HTML content with both service cards and health data
      const html = this.generateDashboardHtml(
        'Healthcare API Dashboard',
        services,
        recentLogs,
        isProduction,
        dashboardData
      );

      res.header('Content-Type', 'text/html');
      return res.send(html);
    } catch (_error) {
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
      return res.send('Error loading dashboard. Please check server logs.');
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
    const baseUrl: string =
      this.configService?.get<string>('API_URL') ||
      process.env['API_URL'] ||
      'http://localhost:8088';

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
    
    <script src="${baseUrl}/socket.io/socket.io.js"></script>
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
            } catch (_e) {
                updateStatus('disconnected', 'Error');
                addMessage('Error: ' + e.message, 'received');
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
      const logs = (await this.loggingService.getLogs()) as LoggingServiceLogEntry[];

      return logs.slice(0, limit).map(
        (log: LoggingServiceLogEntry): DashboardLogEntry => ({
          timestamp: (log.timestamp as string | Date) || new Date().toISOString(),
          level: (log.level as string) || 'info',
          message: (log.message as string) || 'No message',
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
    healthData: DashboardData
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
    <style>
        /* Base styles */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
            background-color: #f8fafc;
            color: #1a202c;
            line-height: 1.5;
            font-size: 14px;
            min-height: 100vh;
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
            font-weight: bold;
            color: #1a202c;
            margin-bottom: 0.5rem;
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
            font-weight: 600;
            color: #1a202c;
            margin-bottom: 1rem;
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
            font-size: 1rem;
            font-weight: 600;
            color: #334155;
            margin: 0;
        }

        .status-badge {
            font-size: 0.75rem;
            padding: 0.25rem 0.5rem;
            border-radius: 9999px;
            font-weight: 500;
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
            font-weight: 500;
            font-size: 1.125rem;
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
            font-size: 0.75rem;
            margin-bottom: 0.25rem;
            display: block;
        }

        .metric-value {
            color: #334155;
            font-weight: 500;
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
                                <h3 class="service-title">${service.name}</h3>
                            </div>
                            <span class="status-badge ${service.active ? 'status-active' : 'status-inactive'}">
                                ${service.active ? 'Active' : 'Inactive'}
                            </span>
                        </div>
                        <p class="service-description">${service.description}</p>
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
                    <p style="text-align: center; color: #64748b; font-size: 0.875rem;">${healthData.overallHealth.details}</p>
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
                    }) => `
                    <div class="service-section ${service.isHealthy ? 'healthy' : 'unhealthy'}">
                        <div class="service-header">
                            <div class="service-header-content">
                                <div class="service-status-indicator ${service.isHealthy ? 'indicator-healthy' : 'indicator-unhealthy'}"></div>
                                <h3 class="service-title">${service.name}</h3>
                            </div>
                            <span class="health-status-text ${service.isHealthy ? 'status-text-healthy' : 'status-text-unhealthy'}">
                                ${service.status}
                            </span>
                        </div>
                        <p style="color: #64748b; margin: 0.5rem 0;">${service.details}</p>
                        <div class="health-metrics">
                            <div class="metric">
                                <span class="metric-label">Response Time</span>
                                <span class="metric-value">${service.responseTime} ms</span>
                            </div>
                            ${Object.entries(service.metrics || {})
                              .map(([key, value]: [string, unknown]) => {
                                let displayValue = 'N/A';
                                if (value !== null && value !== undefined) {
                                  if (
                                    typeof value === 'object' &&
                                    !Array.isArray(value) &&
                                    value.constructor === Object
                                  ) {
                                    displayValue = JSON.stringify(value);
                                  } else if (Array.isArray(value)) {
                                    displayValue = JSON.stringify(value);
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
                                <div class="metric">
                                    <span class="metric-label">${key}</span>
                                    <span class="metric-value">${displayValue}</span>
                                </div>
                            `;
                              })
                              .join('')}
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
        // Auto-refresh functionality
        setInterval(() => {
            window.location.reload();
        }, 30000); // Refresh every 30 seconds
    </script>
</body>
</html>`;
  }
}
