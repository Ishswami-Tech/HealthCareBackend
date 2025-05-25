import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from './libs/decorators/public.decorator';
import { ConfigService } from '@nestjs/config';
import { FastifyReply } from 'fastify';
import { HealthController } from './services/health/health.controller';
import { LoggingService } from './shared/logging/logging.service';

interface ServiceInfo {
  name: string;
  description: string;
  url: string;
  active: boolean;
  category: string;
  credentials?: string; // Optional credentials property
  devOnly?: boolean;    // Flag to indicate if service is dev-only
}

@ApiTags('root')
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly configService: ConfigService,
    private readonly healthController: HealthController,
    private readonly loggingService: LoggingService,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ 
    summary: 'API Dashboard',
    description: 'Shows a dashboard with all available services and their status.'
  })
  @ApiResponse({
    status: 200,
    description: 'Dashboard HTML'
  })
  async getDashboard(@Res() res: FastifyReply) {
    try {
      // Use the domain name for API URL
      const host = this.configService.get('API_URL') || 'https://api.ishswami.in';
      const baseUrl = host.endsWith('/') ? host.slice(0, -1) : host;
      const isProduction = process.env.NODE_ENV === 'production';
      
      // Get real-time service status from health controller using the detailed endpoint
      const healthData = await this.healthController.getDetailedHealth();
      
      // Map health data to service status format
      const healthStatus = {
        api: { status: healthData.services.api.status === 'healthy' ? 'up' : 'down' },
        redis: { status: healthData.services.redis.status === 'healthy' ? 'up' : 'down' },
        database: { status: healthData.services.database.status === 'healthy' ? 'up' : 'down' },
        queues: { status: healthData.services.queues.status === 'healthy' ? 'up' : 'down' },
        logger: { status: healthData.services.logger.status === 'healthy' ? 'up' : 'down' },
        socket: { status: healthData.services.socket.status === 'healthy' ? 'up' : 'down' },
        email: { status: healthData.services.email.status === 'healthy' ? 'up' : 'down' },
        prismaStudio: { status: healthData.services.prismaStudio?.status === 'healthy' ? 'up' : 'down' },
        redisCommander: { status: healthData.services.redisCommander?.status === 'healthy' ? 'up' : 'down' },
        pgAdmin: { status: healthData.services.pgAdmin?.status === 'healthy' ? 'up' : 'down' },
        lastUpdated: new Date()
      };
      
      // Only fetch logs in development mode to reduce DB load in production
      const recentLogs = isProduction ? [] : await this.getRecentLogs();
      
      // Check if services are actually running based on mapped health status
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
          url: `${baseUrl}${this.configService.get('SWAGGER_URL') || '/docs'}`,
          active: isApiRunning,
          category: 'Documentation'
        },
        {
          name: 'Queue Dashboard',
          description: 'Queue management and monitoring dashboard.',
          url: `${baseUrl}${this.configService.get('BULL_BOARD_URL') || '/queue-dashboard'}`,
          active: isQueueRunning,
          category: 'Monitoring'
        },
        {
          name: 'Logger',
          description: 'Application logs and monitoring interface.',
          url: `${baseUrl}/logger`,
          active: isLoggerRunning,
          category: 'Monitoring'
        },
        {
          name: 'WebSocket',
          description: 'WebSocket endpoint for real-time communication.',
          url: `${baseUrl}/socket-test`,
          active: isSocketRunning,
          category: 'API'
        },
        {
          name: 'Email Service',
          description: 'Email sending and template management.',
          url: `${baseUrl}/email-status`,
          active: isEmailRunning,
          category: 'Services'
        }
      ];
      
      // Add development-only services
      if (!isProduction || isRedisCommanderRunning) {
        allServices.push({
          name: 'Redis Commander',
          description: 'Redis database management interface.',
          url: isProduction 
            ? `${this.configService.get('REDIS_COMMANDER_URL', '/redis-ui')}`
            : `${baseUrl}/redis-ui`,
          active: isRedisRunning && isRedisCommanderRunning,
          category: 'Database',
          credentials: 'Username: admin, Password: admin',
          devOnly: !isRedisCommanderRunning
        });
      }
      
      if (!isProduction || isPrismaStudioRunning) {
        allServices.push({
          name: 'Prisma Studio',
          description: 'PostgreSQL database management through Prisma.',
          url: isProduction 
            ? `${this.configService.get('PRISMA_STUDIO_URL', '/prisma')}`
            : `${baseUrl}/prisma`,
          active: isDatabaseRunning && isPrismaStudioRunning,
          category: 'Database',
          devOnly: !isPrismaStudioRunning
        });
      }
      
      if (!isProduction || isPgAdminRunning) {
        allServices.push({
          name: 'pgAdmin',
          description: 'PostgreSQL database management interface.',
          url: isProduction 
            ? `${this.configService.get('PGADMIN_URL', '/pgadmin')}`
            : `${baseUrl}/pgadmin`,
          active: isDatabaseRunning && isPgAdminRunning,
          category: 'Database',
          credentials: 'Email: admin@admin.com, Password: admin',
          devOnly: !isPgAdminRunning
        });
        }

      // Filter services based on environment
      const services = isProduction 
        ? allServices.filter(service => !service.devOnly)
        : allServices;

      // Generate HTML content
      const html = this.generateDashboardHtml('Healthcare API Dashboard', services, recentLogs, isProduction);

      res.header('Content-Type', 'text/html');
      return res.send(html);
    } catch (error) {
      console.error('Error serving dashboard:', error);
      return res.send('Error loading dashboard. Please check server logs.');
    }
  }

  @Get('socket-test')
  @Public()
  @ApiOperation({
    summary: 'WebSocket Test Page',
    description: 'A simple page to test WebSocket connectivity'
  })
  @ApiResponse({
    status: 200,
    description: 'WebSocket test page HTML'
  })
  async getSocketTestPage(@Res() res: FastifyReply) {
    const baseUrl = this.configService.get('API_URL') || 'http://localhost:8088';
    
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
                    addMessage('Connection error: ' + err.message, 'received');
                });
                
                socket.on('message', (data) => {
                    addMessage('Server: ' + data.text, 'received');
                });
                
                socket.on('echo', (data) => {
                    addMessage('Echo: ' + JSON.stringify(data.original), 'received');
                });
            } catch (e) {
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

  private async getRecentLogs(limit: number = 10) {
    try {
      // Use your logging service to get recent logs
      const logs = await this.loggingService.getLogs();
      
      return logs.slice(0, limit).map(log => ({
        timestamp: log.timestamp,
        level: log.level,
        message: log.message,
        source: log.type || 'Unknown',
        data: log.metadata || '{}'
      }));
    } catch (error) {
      console.error('Error fetching logs:', error);
      // Return placeholder data if there's an error
      return Array(limit).fill(null).map((_, i) => ({
        timestamp: new Date(),
        level: 'info',
        message: `This is a placeholder log entry ${i + 1}`,
        source: 'System',
        data: '{}'
      }));
    }
  }

  private generateDashboardHtml(title: string, services: ServiceInfo[], recentLogs: any[], isProduction: boolean): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    <style>
        /* General styles */
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            color: #1a202c;
            line-height: 1.5;
            font-size: 14px;
            background-color: #f8fafc;
        }
        .container {
            max-width: 1100px;
            margin: 0 auto;
            padding: 1rem;
        }
        
        /* Health Dashboard styles */
        .health-dashboard {
            background-color: #ffffff;
            border-radius: 12px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05), 0 1px 2px rgba(0, 0, 0, 0.1);
            margin-bottom: 2rem;
            padding: 1.25rem;
            transition: all 0.3s ease;
        }
        
        .dashboard-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 1.25rem;
            border-bottom: 1px solid #f1f5f9;
            padding-bottom: 0.75rem;
        }
        
        .dashboard-title {
            font-size: 1.25rem;
            font-weight: 600;
            color: #334155;
            margin: 0;
        }
        
        .refresh-button {
            background-color: #3b82f6;
            color: white;
            border: none;
            border-radius: 6px;
            padding: 0.4rem 0.75rem;
            font-size: 0.875rem;
            font-weight: 500;
            cursor: pointer;
            transition: background-color 0.2s ease;
            display: flex;
            align-items: center;
            gap: 0.4rem;
        }
        
        .refresh-button:hover {
            background-color: #2563eb;
        }
        
        .refresh-button:active {
            background-color: #1d4ed8;
        }
        
        /* Health Card Styles */
        .health-card {
            background-color: white;
            border-radius: 8px;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
            margin-bottom: 1.25rem;
            overflow: hidden;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
        
        .health-card:hover {
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.05);
        }
        
        .health-card-header {
            padding: 0.75rem 1.25rem;
            border-bottom: 1px solid #f1f5f9;
            display: flex;
            align-items: center;
            justify-content: space-between;
            background-color: #f9fafb;
        }
        
        .health-card-title {
            font-size: 1rem;
            font-weight: 600;
            color: #334155;
            margin: 0;
            display: flex;
            align-items: center;
            gap: 0.4rem;
        }
        
        .health-card-body {
            padding: 1rem 1.25rem;
        }
        
        .health-summary {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 0.5rem;
            font-size: 1rem;
            font-weight: 500;
            margin-bottom: 0.75rem;
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
        
        .status-warning {
            background-color: #f59e0b;
            box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.2);
        }
        
        /* Service Section Styles */
        .service-section {
            background-color: white;
            border-radius: 8px;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
            margin-bottom: 0.75rem;
            padding: 0.875rem;
            transition: all 0.3s ease;
            border-left: 3px solid transparent;
            position: relative;
        }
        
        .service-section.updating::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 2px;
            background: linear-gradient(90deg, transparent, #3b82f6, transparent);
            animation: loading 1.5s infinite;
        }
        
        @keyframes loading {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
        }
        
        .service-section.healthy {
            border-left-color: #22c55e;
        }
        
        .service-section.unhealthy {
            border-left-color: #ef4444;
        }
        
        .service-section:hover {
            box-shadow: 0 3px 5px rgba(0, 0, 0, 0.05);
        }
        
        .service-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 0.5rem;
        }
        
        .service-title {
            font-size: 0.94rem;
            font-weight: 600;
            color: #334155;
            margin: 0;
            margin-left: 0.4rem;
        }
        
        .service-content {
            padding-left: 1.25rem;
        }
        
        /* Health Status Indicator */
        .health-status-indicator {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            display: inline-block;
        }
        
        .indicator-healthy {
            background: linear-gradient(145deg, #34d399, #22c55e);
            box-shadow: 0 0 4px rgba(52, 211, 153, 0.5);
            animation: pulse 2s infinite;
        }
        
        .indicator-unhealthy {
            background: linear-gradient(145deg, #f87171, #ef4444);
            box-shadow: 0 0 4px rgba(248, 113, 113, 0.5);
        }
        
        @keyframes pulse {
            0% {
                transform: scale(0.95);
                box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.7);
            }
            70% {
                transform: scale(1);
                box-shadow: 0 0 0 4px rgba(52, 211, 153, 0);
            }
            100% {
                transform: scale(0.95);
                box-shadow: 0 0 0 0 rgba(52, 211, 153, 0);
            }
        }
        
        /* Metrics Styles */
        .health-metrics {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 0.5rem;
            margin-top: 0.5rem;
        }
        
        .metric {
            display: flex;
            flex-direction: column;
            background-color: #f9fafb;
            padding: 0.4rem 0.625rem;
            border-radius: 6px;
            font-size: 0.813rem;
        }
        
        .metric-label {
            color: #64748b;
            margin-bottom: 0.125rem;
            font-size: 0.75rem;
        }
        
        .metric-value {
            font-weight: 500;
            color: #334155;
        }
        
        /* Service Card Styles */
        .service-card {
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
            transition: transform 0.2s, box-shadow 0.2s;
            height: 100%;
            display: flex;
            flex-direction: column;
            background-color: white;
        }
        .service-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 15px -3px rgba(0, 0, 0, 0.1);
        }
    </style>
</head>
<body class="bg-gray-100 min-h-screen">
    <div class="container mx-auto px-4 py-8">
        <header class="text-center mb-8">
            <h1 class="text-4xl font-bold text-gray-800 mb-2">${title}</h1>
            <p class="text-gray-600">System Status and Service Management${isProduction ? ' (Production Mode)' : ' (Development Mode)'}</p>
            <div class="flex flex-col items-center justify-center gap-2 mt-4">
                <p class="text-gray-500">Last updated: <time id="lastUpdated" datetime="${new Date().toISOString()}">${new Date().toLocaleTimeString()}</time></p>
                <button 
                    id="refreshButton" 
                    class="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    onclick="refreshDashboard()"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
                    </svg>
                    <span>Refresh Dashboard</span>
                    <span id="refreshSpinner" class="hidden ml-2">
                        <svg class="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    </span>
                </button>
            </div>
        </header>
          <!-- Service Cards Section -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8" id="serviceCards">
            ${services.map(service => `
                <div class="service-card p-5 ${service.active ? 'border-t-4 border-green-500' : 'border-t-4 border-red-500'}" data-service="${service.name.toLowerCase().replace(/\s+/g, '-')}">
                    <div class="flex items-center justify-between mb-3">
                        <h2 class="text-base font-semibold text-gray-800">${service.name}</h2>
                        <span class="px-2 py-1 rounded-full text-xs font-medium ${service.active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
                            ${service.active ? 'Active' : 'Inactive'}
                        </span>
                    </div>
                    <p class="text-gray-600 text-sm mb-4">${service.description}</p>
                    <div class="mt-auto">
                        <a href="${service.url}" 
                           target="_blank" 
                           class="inline-block w-full text-center px-3 py-2 text-sm ${service.active ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-400 cursor-not-allowed'} text-white rounded transition-colors">
                            Access Service
                        </a>
                        ${service.credentials ? `
                            <div class="text-xs text-gray-500 mt-2">
                                <span class="font-medium">Credentials:</span> ${service.credentials}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `).join('')}
        </div>

        <!-- Health Dashboard - Just the controls/header -->
        <div class="health-dashboard">
          <div class="dashboard-header">
            <h2 class="dashboard-title">System Health Dashboard</h2>
            <button id="refreshHealthBtn" class="refresh-button" onclick="refreshHealthStatus()">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh Status
            </button>
          </div>
            <!-- Overall Health Status - Moved to the end -->
        <div class="health-card mt-5">
          <div id="overallHealthHeader" class="health-card-header healthy">
            <h3 class="health-card-title">
              <span id="overallHealthIndicator" class="status-circle status-healthy"></span>
              Overall System Health
            </h3>
            <span id="lastChecked" class="text-xs text-gray-600">Last checked: Just now</span>
          </div>
          <div class="health-card-body">
            <div id="overallHealthSummary" class="health-summary">
              <span id="healthStatus" class="text-green-600 font-medium">All systems operational</span>
            </div>
            <p id="healthDetails" class="text-center text-gray-600 text-xs mb-3">All services are running properly and responding within expected time frames.</p>
          </div>
        </div>
          
          <!-- Core Services first -->
          <div id="coreServices">
            <!-- API Service -->
            <div id="apiSection" class="service-section healthy">
              <div class="service-header">
                <div class="flex items-center">
                  <div id="apiIndicator" class="health-status-indicator indicator-healthy"></div>
                  <h3 class="service-title">API Service</h3>
                </div>
                <span id="apiStatus" class="text-sm text-green-600 font-medium">Healthy</span>
              </div>
              
              <div class="service-content">
                <p id="apiDetails" class="text-gray-600 mb-2 text-sm">API is responding to requests</p>
                <div class="health-metrics">
                  <div class="metric">
                    <span class="metric-label">Response Time:</span>
                    <span id="apiResponseTime" class="metric-value">45 ms</span>
                  </div>
                  <div class="metric">
                    <span class="metric-label">Last Checked:</span>
                    <span id="apiLastChecked" class="metric-value">10:45:32 AM</span>
                  </div>
                </div>
              </div>
            </div>
            
            <!-- Database Service -->
            <div id="dbSection" class="service-section healthy">
              <div class="service-header">
                <div class="flex items-center">
                  <div id="dbIndicator" class="health-status-indicator indicator-healthy"></div>
                  <h3 class="service-title">Database Service</h3>
                </div>
                <span id="dbStatus" class="text-sm text-green-600 font-medium">Healthy</span>
              </div>
              
              <div class="service-content">
                <p id="dbDetails" class="text-gray-600 mb-2 text-sm">Connected to PostgreSQL database</p>
                <div class="health-metrics">
                  <div class="metric">
                    <span class="metric-label">Query Time:</span>
                    <span id="dbQueryTime" class="metric-value">12 ms</span>
                  </div>
                  <div class="metric">
                    <span class="metric-label">Active Connections:</span>
                    <span id="dbActiveConn" class="metric-value">3</span>
                  </div>
                  <div class="metric">
                    <span class="metric-label">Max Connections:</span>
                    <span id="dbMaxConn" class="metric-value">100</span>
                  </div>
                  <div class="metric">
                    <span class="metric-label">Connection Utilization:</span>
                    <span id="dbConnUtil" class="metric-value">3%</span>
                  </div>
                  <div class="metric">
                    <span class="metric-label">Last Checked:</span>
                    <span id="dbLastChecked" class="metric-value">10:45:32 AM</span>
                  </div>
                </div>
              </div>
            </div>
            
            <!-- Redis Service -->
            <div id="redisSection" class="service-section healthy">
              <div class="service-header">
                <div class="flex items-center">
                  <div id="redisIndicator" class="health-status-indicator indicator-healthy"></div>
                  <h3 class="service-title">Redis Service</h3>
                </div>
                <span id="redisStatus" class="text-sm text-green-600 font-medium">Healthy</span>
              </div>
              
              <div class="service-content">
                <p id="redisDetails" class="text-gray-600 mb-2 text-sm">Connected to Redis server</p>
                <div class="health-metrics">
                  <div class="metric">
                    <span class="metric-label">Response Time:</span>
                    <span id="redisResponseTime" class="metric-value">5 ms</span>
                  </div>
                  <div class="metric">
                    <span class="metric-label">Connected Clients:</span>
                    <span id="redisClients" class="metric-value">2</span>
                  </div>
                  <div class="metric">
                    <span class="metric-label">Used Memory:</span>
                    <span id="redisMemory" class="metric-value">2.5 MB</span>
                  </div>
                  <div class="metric">
                    <span class="metric-label">Total Keys:</span>
                    <span id="redisKeys" class="metric-value">126</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Queue Service -->
            <div id="queueSection" class="service-section healthy">
              <div class="service-header">
                <div class="flex items-center">
                  <div id="queueIndicator" class="health-status-indicator indicator-healthy"></div>
                  <h3 class="service-title">Queue Service</h3>
                </div>
                <span id="queueStatus" class="text-sm text-green-600 font-medium">Healthy</span>
              </div>
              
              <div class="service-content">
                <p id="queueDetails" class="text-gray-600 mb-2 text-sm">Queue service is running</p>
                <div class="health-metrics">
                  <div class="metric">
                    <span class="metric-label">Response Time:</span>
                    <span id="queueResponseTime" class="metric-value">0 ms</span>
                  </div>
                  <div class="metric">
                    <span class="metric-label">Last Checked:</span>
                    <span id="queueLastChecked" class="metric-value">10:45:32 AM</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Logger Service -->
            <div id="loggerSection" class="service-section healthy">
              <div class="service-header">
                <div class="flex items-center">
                  <div id="loggerIndicator" class="health-status-indicator indicator-healthy"></div>
                  <h3 class="service-title">Logger Service</h3>
                </div>
                <span id="loggerStatus" class="text-sm text-green-600 font-medium">Healthy</span>
              </div>
              
              <div class="service-content">
                <p id="loggerDetails" class="text-gray-600 mb-2 text-sm">Logging service is active</p>
                <div class="health-metrics">
                  <div class="metric">
                    <span class="metric-label">Response Time:</span>
                    <span id="loggerResponseTime" class="metric-value">0 ms</span>
                  </div>
                  <div class="metric">
                    <span class="metric-label">Last Checked:</span>
                    <span id="loggerLastChecked" class="metric-value">10:45:32 AM</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Socket Service -->
            <div id="socketSection" class="service-section healthy">
              <div class="service-header">
                <div class="flex items-center">
                  <div id="socketIndicator" class="health-status-indicator indicator-healthy"></div>
                  <h3 class="service-title">WebSocket Service</h3>
                </div>
                <span id="socketStatus" class="text-sm text-green-600 font-medium">Healthy</span>
              </div>
              
              <div class="service-content">
                <p id="socketDetails" class="text-gray-600 mb-2 text-sm">WebSocket server is running</p>
                <div class="health-metrics">
                  <div class="metric">
                    <span class="metric-label">Response Time:</span>
                    <span id="socketResponseTime" class="metric-value">0 ms</span>
                  </div>
                  <div class="metric">
                    <span class="metric-label">Last Checked:</span>
                    <span id="socketLastChecked" class="metric-value">10:45:32 AM</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Email Service -->
            <div id="emailSection" class="service-section healthy">
              <div class="service-header">
                <div class="flex items-center">
                  <div id="emailIndicator" class="health-status-indicator indicator-healthy"></div>
                  <h3 class="service-title">Email Service</h3>
                </div>
                <span id="emailStatus" class="text-sm text-green-600 font-medium">Healthy</span>
              </div>
              
              <div class="service-content">
                <p id="emailDetails" class="text-gray-600 mb-2 text-sm">Email service is configured and connected</p>
                <div class="health-metrics">
                  <div class="metric">
                    <span class="metric-label">Response Time:</span>
                    <span id="emailResponseTime" class="metric-value">0 ms</span>
                  </div>
                  <div class="metric">
                    <span class="metric-label">Last Checked:</span>
                    <span id="emailLastChecked" class="metric-value">10:45:32 AM</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
          
      
          
      

        ${!isProduction && recentLogs.length > 0 ? `
        <div class="bg-white rounded-lg shadow-md p-6 mb-10">
            <h2 class="text-2xl font-semibold text-gray-800 mb-4">Recent Logs</h2>
            <div class="overflow-x-auto">
                <table class="min-w-full">
                    <thead>
                        <tr class="bg-gray-100">
                            <th class="px-4 py-2 text-left">Time</th>
                            <th class="px-4 py-2 text-left">Level</th>
                            <th class="px-4 py-2 text-left">Source</th>
                            <th class="px-4 py-2 text-left">Message</th>
                        </tr>
                    </thead>
                    <tbody id="logsTable">
                        ${recentLogs.map(log => `
                            <tr class="log-row">
                                <td class="px-4 py-2">${new Date(log.timestamp).toLocaleString()}</td>
                                <td class="px-4 py-2">
                                    <span class="px-2 py-1 rounded-full text-xs ${
                                        log.level === 'error' ? 'bg-red-100 text-red-800' :
                                        log.level === 'warn' ? 'bg-yellow-100 text-yellow-800' :
                                        'bg-blue-100 text-blue-800'
                                    }">
                                        ${log.level}
                                    </span>
                                </td>
                                <td class="px-4 py-2">${log.source}</td>
                                <td class="px-4 py-2">${log.message}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        ` : ''}
    
        <footer class="mt-12 text-center text-gray-600">
            <p>Environment: ${process.env.NODE_ENV || 'development'}</p>
            <p class="mt-2">© ${new Date().getFullYear()} Healthcare API. All rights reserved.</p>
        </footer>
    </div>

    <script>
        let refreshInterval;
        let lastRefreshTime = new Date();
        
        // Initialize page
        document.addEventListener('DOMContentLoaded', function() {
          updateLastCheckedTime();
          refreshHealthStatus();
          
          // Set up automatic refresh every 30 seconds
          refreshInterval = setInterval(function() {
            refreshHealthStatus();
            updateLastCheckedTime();
          }, 30000);
          
          // Set up main refresh button functionality
          document.getElementById('refreshButton').addEventListener('click', function() {
            refreshServicesList();
          });
          
          // Clean up on page unload
          window.addEventListener('beforeunload', function() {
            if (refreshInterval) {
              clearInterval(refreshInterval);
            }
          });
          
          // Set up timer to update the "last checked" time display
          setInterval(updateLastCheckedTimeDisplay, 10000);
        });
        
        // Function to update the last checked time display
        function updateLastCheckedTimeDisplay() {
          const now = new Date();
          const diff = now - lastRefreshTime;
          
          // Calculate time difference
          const seconds = Math.floor(diff / 1000);
          const minutes = Math.floor(seconds / 60);
          const hours = Math.floor(minutes / 60);
          
          let timeText;
          if (seconds < 5) {
            timeText = 'Just now';
          } else if (seconds < 60) {
            timeText = seconds + ' seconds ago';
          } else if (minutes === 1) {
            timeText = '1 minute ago';
          } else if (minutes < 60) {
            timeText = minutes + ' minutes ago';
          } else if (hours === 1) {
            timeText = '1 hour ago';
          } else {
            timeText = hours + ' hours ago';
          }
          
          document.getElementById('lastChecked').textContent = 'Last checked: ' + timeText;
        }
        
        // Function to update the last checked time
        function updateLastCheckedTime() {
          lastRefreshTime = new Date();
          updateLastCheckedTimeDisplay();
        }
        
        // Function to refresh the entire services list at the top
        async function refreshServicesList() {
          try {
            const refreshBtn = document.getElementById('refreshButton');
            refreshBtn.disabled = true;
            refreshBtn.innerHTML = 
              '<svg class="animate-spin h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">' +
              '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>' +
              '<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>' +
              '</svg>' +
              'Refreshing...';
              
            // Get current host and protocol
            const currentUrl = window.location.href;
            const baseUrl = new URL(currentUrl).origin;
            
            // Use relative URL to work in both dev and prod
            const response = await fetch('/api/health/services');
            const serviceStatus = await response.json();
            
            if (serviceStatus) {
              // Update service cards based on status
              updateServiceCard('api-documentation', serviceStatus.api.status === 'up');
              updateServiceCard('bull-board', serviceStatus.queues.status === 'up');
              updateServiceCard('logger', serviceStatus.logger.status === 'up');
              updateServiceCard('websocket', serviceStatus.socket.status === 'up');
              updateServiceCard('redis-commander', serviceStatus.redisCommander.status === 'up');
              updateServiceCard('prisma-studio', serviceStatus.prismaStudio.status === 'up');
              updateServiceCard('pgadmin', serviceStatus.pgAdmin.status === 'up');
            }
            
            // Update last updated timestamp at the top of the page
            document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString();
            
            // Re-enable refresh button
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = 
              '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">' +
              '<path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />' +
              '</svg>' +
              'Refresh Status' + 
              '<span class="spinner" id="refreshSpinner"></span>';
          } catch (error) {
            console.error('Error refreshing services list:', error);
            
            // Re-enable refresh button
            const refreshBtn = document.getElementById('refreshButton');
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = 
              '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">' +
              '<path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />' +
              '</svg>' +
              'Retry' +
              '<span class="spinner" id="refreshSpinner"></span>';
          }
        }
        
        // Helper function to update a service card
        function updateServiceCard(serviceName, isActive) {
          const card = document.querySelector('[data-service="' + serviceName + '"]');
          if (card) {
            // Update card border
            card.className = 'service-card p-5 ' + (isActive ? 'border-t-4 border-green-500' : 'border-t-4 border-red-500');
            
            // Update active status badge
            const statusBadge = card.querySelector('.px-2');
            if (statusBadge) {
              statusBadge.className = isActive ? 
                'px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800' : 
                'px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800';
              statusBadge.textContent = isActive ? 'Active' : 'Inactive';
            }
            
            // Update access button
            const accessBtn = card.querySelector('a');
            if (accessBtn) {
              accessBtn.className = 'inline-block w-full text-center px-3 py-2 text-sm ' + 
                (isActive ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-400 cursor-not-allowed') + 
                ' text-white rounded transition-colors';
            }
          }
        }
        
        // Function to refresh health status dashboard
        async function refreshHealthStatus() {
          try {
            const refreshBtn = document.getElementById('refreshHealthBtn');
            refreshBtn.disabled = true;
            refreshBtn.innerHTML = 
              '<svg class="animate-spin h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">' +
              '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>' +
              '<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>' +
              '</svg>' +
              'Checking...';
            
            // Show updating indicator on all service sections
            const serviceSections = document.querySelectorAll('.service-section');
            serviceSections.forEach(section => {
              section.classList.add('updating');
            });
            
            // Use direct /health API with 127.0.0.1 to avoid DNS resolution errors with 'localhost'
            const response = await fetch('/health/detailed');
            const healthData = await response.json();
            
            // Update last refresh time
            updateLastCheckedTime();
            
            // Update overall health status
            const isHealthy = healthData.status === 'healthy';
            document.getElementById('overallHealthHeader').className = 
                'health-card-header ' + (isHealthy ? 'healthy' : 'unhealthy');
            document.getElementById('overallHealthIndicator').className = 
                'status-circle ' + (isHealthy ? 'status-healthy' : 'status-unhealthy');
            document.getElementById('healthStatus').textContent = isHealthy ? 
                'All systems operational' : 'System degraded';
            document.getElementById('healthStatus').className = 
                isHealthy ? 'text-green-600 font-medium' : 'text-red-600 font-medium';
            
            // Generate health details message
            const healthyServices = Object.values(healthData.services).filter(s => s.status === 'healthy').length;
            const totalServices = Object.values(healthData.services).length;
            document.getElementById('healthDetails').textContent = 
                healthyServices + ' of ' + totalServices + ' services are healthy and responding within expected time frames.';
            
            // Update service statuses
            updateServiceStatus('api', healthData.services.api);
            updateServiceStatus('db', healthData.services.database);
            updateServiceStatus('redis', healthData.services.redis);
            updateServiceStatus('queue', healthData.services.queues);
            updateServiceStatus('logger', healthData.services.logger);
            updateServiceStatus('socket', healthData.services.socket);
            updateServiceStatus('email', healthData.services.email);
            
            // Re-enable refresh button
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = 
              '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">' +
              '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />' +
              '</svg>' +
              'Refresh Status';
            
            // Remove updating indicators
            serviceSections.forEach(section => {
              section.classList.remove('updating');
            });
            
          } catch (error) {
            console.error('Error fetching health status:', error);
            document.getElementById('healthStatus').textContent = 'Error checking health status';
            document.getElementById('healthStatus').className = 'text-red-600 font-medium';
            document.getElementById('healthDetails').textContent = 'Unable to fetch health information: ' + error.message;
            
            // Re-enable refresh button
            const refreshBtn = document.getElementById('refreshHealthBtn');
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = 
              '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">' +
              '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />' +
              '</svg>' +
              'Retry';
            
            // Remove updating indicators
            const serviceSections = document.querySelectorAll('.service-section');
            serviceSections.forEach(section => {
              section.classList.remove('updating');
            });
            
            // Still update the last refresh time to show we attempted
            updateLastCheckedTime();
          }
        }

        function updateServiceStatus(serviceId, serviceData) {
          const section = document.getElementById(serviceId + 'Section');
          const indicator = document.getElementById(serviceId + 'Indicator');
          const status = document.getElementById(serviceId + 'Status');
          const details = document.getElementById(serviceId + 'Details');
          const responseTime = document.getElementById(serviceId + 'ResponseTime');
          const lastChecked = document.getElementById(serviceId + 'LastChecked');
          
          if (!section || !indicator || !status || !details || !responseTime || !lastChecked) return;
          
          const isHealthy = serviceData.status === 'healthy';
          
          // Update section class
          section.className = 'service-section ' + (isHealthy ? 'healthy' : 'unhealthy');
          
          // Update indicator
          indicator.className = 'health-status-indicator ' + (isHealthy ? 'indicator-healthy' : 'indicator-unhealthy');
          
          // Update status text and class
          status.textContent = isHealthy ? 'Healthy' : 'Unhealthy';
          status.className = 'text-sm ' + (isHealthy ? 'text-green-600' : 'text-red-600') + ' font-medium';
          
          // Update details
          details.textContent = serviceData.details || (isHealthy ? 'Service is running' : 'Service is not responding');
          
          // Update response time
          responseTime.textContent = serviceData.responseTime + ' ms';
          
          // Update last checked time
          if (serviceData.lastChecked) {
            const lastCheckedDate = new Date(serviceData.lastChecked);
            lastChecked.textContent = lastCheckedDate.toLocaleTimeString();
          }
          
          // Update metrics if available
          if (serviceData.metrics) {
            if (serviceId === 'db') {
              document.getElementById('dbQueryTime').textContent = serviceData.metrics.queryResponseTime + ' ms';
              document.getElementById('dbActiveConn').textContent = serviceData.metrics.activeConnections;
              document.getElementById('dbMaxConn').textContent = serviceData.metrics.maxConnections;
              document.getElementById('dbConnUtil').textContent = 
                Math.round((serviceData.metrics.activeConnections / serviceData.metrics.maxConnections) * 100) + '%';
            } else if (serviceId === 'redis') {
              document.getElementById('redisClients').textContent = serviceData.metrics.connectedClients;
              const memory = serviceData.metrics.usedMemory;
              let formattedMemory;
              if (memory < 1024) {
                formattedMemory = memory + ' B';
              } else if (memory < 1024 * 1024) {
                formattedMemory = (memory / 1024).toFixed(2) + ' KB';
              } else {
                formattedMemory = (memory / (1024 * 1024)).toFixed(2) + ' MB';
              }
              document.getElementById('redisMemory').textContent = formattedMemory;
              document.getElementById('redisKeys').textContent = serviceData.metrics.totalKeys;
            }
          }
        }

        async function refreshDashboard() {
            const button = document.getElementById('refreshButton');
            const spinner = document.getElementById('refreshSpinner');
            const timestamp = document.getElementById('lastUpdated');
            
            try {
                // Disable button and show spinner
                button.disabled = true;
                spinner.classList.remove('hidden');
                
                // Refresh both health status and services list
                await Promise.all([
                    refreshHealthStatus(),
                    refreshServicesList()
                ]);
                
                // Update timestamp
                const now = new Date();
                timestamp.textContent = now.toLocaleTimeString();
                timestamp.setAttribute('datetime', now.toISOString());
                
            } catch (error) {
                console.error('Error refreshing dashboard:', error);
            } finally {
                // Re-enable button and hide spinner
                button.disabled = false;
                spinner.classList.add('hidden');
            }
        }
    </script>
</body>
</html>`;
  }
}