import { Controller, Get, Post, Body, UseGuards, Req, Res, HttpStatus, Redirect } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from './libs/decorators/public.decorator';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from './shared/database/prisma/prisma.service';
import { FastifyReply } from 'fastify';
import { ConfigService } from '@nestjs/config';
import { HealthController } from './services/health/health.controller';
import { LoggingService } from './shared/logging/logging.service';
import { LogType } from './shared/logging/types/logging.types';

interface HealthStatus {
  api?: { status: 'up' | 'down' };
  queues?: { status: 'up' | 'down' };
  redis?: { status: 'up' | 'down' };
  database?: { status: 'up' | 'down' };
  logger?: { status: 'up' | 'down' };
}

@ApiTags('root')
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
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
      
      // Get real-time service status from health controller
      const healthStatus = await this.healthController.getServicesStatus() as HealthStatus;
      
      // Get recent logs
      const recentLogs = await this.getRecentLogs();
      
      const services = [
        {
          name: 'API Documentation',
          description: 'Swagger API documentation and testing interface.',
          url: `${baseUrl}${this.configService.get('SWAGGER_URL')}`,
          active: healthStatus?.api?.status === 'up',
          category: 'Documentation'
        },
        {
          name: 'Bull Board',
          description: 'Queue management and monitoring dashboard.',
          url: `${baseUrl}${this.configService.get('BULL_BOARD_URL')}`,
          active: healthStatus?.queues?.status === 'up',
          category: 'Monitoring'
        },
        {
          name: 'Redis Commander',
          description: 'Redis database management interface.',
          url: `${baseUrl}/redis-ui`,
          active: healthStatus?.redis?.status === 'up',
          category: 'Database',
          credentials: 'Username: admin, Password: admin'
        },
        {
          name: 'Prisma Studio',
          description: 'PostgreSQL database management through Prisma.',
          url: `${baseUrl}/prisma`,
          active: healthStatus?.database?.status === 'up',
          category: 'Database'
        },
        {
          name: 'Logger',
          description: 'Application logs and monitoring interface.',
          url: `${baseUrl}/logger`,
          active: healthStatus?.logger?.status === 'up',
          category: 'Monitoring'
        },
        {
          name: 'WebSocket',
          description: 'WebSocket endpoint for real-time communication.',
          url: `${baseUrl}/socket`,
          active: healthStatus?.api?.status === 'up',
          category: 'API'
        }
      ];

      // Conditionally add pgAdmin only in development environment
      if (process.env.NODE_ENV !== 'production') {
        services.push({
          name: 'pgAdmin',
          description: 'PostgreSQL database management interface.',
          url: `${baseUrl}/pgadmin`,
          active: healthStatus?.database?.status === 'up',
          category: 'Database',
          credentials: 'Email: admin@admin.com, Password: admin'
        });
      }

      // Generate HTML content
      const html = this.generateDashboardHtml('Healthcare API Dashboard', services, recentLogs);

      res.header('Content-Type', 'text/html');
      return res.send(html);
    } catch (error) {
      console.error('Error serving dashboard:', error);
      return res.send('Error loading dashboard. Please check server logs.');
    }
  }

  @Get('logger')
  @Public()
  @ApiOperation({
    summary: 'Logging Dashboard',
    description: 'Shows application logs and monitoring information.'
  })
  @ApiResponse({
    status: 200,
    description: 'Logger Dashboard HTML'
  })
  async getLoggerDashboard(@Res() res: FastifyReply) {
    try {
      const logs = await this.getRecentLogs(50); // Get more logs for the dedicated page
      const html = this.generateLoggerHtml('Healthcare API Logger', logs);
      
      res.header('Content-Type', 'text/html');
      return res.send(html);
    } catch (error) {
      console.error('Error serving logger dashboard:', error);
      return res.send('Error loading logger dashboard. Please check server logs.');
    }
  }

  private async getRecentLogs(limit: number = 10) {
    try {
      // Use your logging service to get recent logs
      const logs = await this.prisma.log.findMany({
        take: limit,
        orderBy: {
          timestamp: 'desc'
        }
      });
      
      return logs.map(log => ({
        timestamp: log.timestamp,
        level: log.level,
        message: log.message,
        source: log.context || 'Unknown',
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

  private generateDashboardHtml(title: string, services: any[], recentLogs: any[]): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    <style>
        .service-card {
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .service-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
        }
        .log-row:nth-child(even) {
            background-color: #f7fafc;
        }
    </style>
</head>
<body class="bg-gray-100 min-h-screen">
    <div class="container mx-auto px-4 py-8">
        <header class="text-center mb-12">
            <h1 class="text-4xl font-bold text-gray-800 mb-4">${title}</h1>
            <p class="text-gray-600">System Status and Service Management</p>
        </header>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-10">
            ${services.map(service => `
                <div class="service-card bg-white rounded-lg shadow-md p-6 hover:shadow-lg">
                    <div class="flex items-center justify-between mb-4">
                        <h2 class="text-xl font-semibold text-gray-800">${service.name}</h2>
                        <span class="px-3 py-1 rounded-full text-sm ${
                            service.active 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-red-100 text-red-800'
                        }">
                            ${service.active ? 'Active' : 'Inactive'}
                        </span>
                    </div>
                    <p class="text-gray-600 mb-4">${service.description}</p>
                    <div class="space-y-2">
                        <a href="${service.url}" 
                           target="_blank" 
                           class="inline-block w-full text-center px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">
                            Access Service
                        </a>
                        ${service.credentials ? `
                            <div class="text-sm text-gray-500 mt-2">
                                <span class="font-medium">Credentials:</span> ${service.credentials}
                            </div>
                        ` : ''}
                    </div>
                </div>
            `).join('')}
        </div>

        <div class="bg-white rounded-lg shadow-md p-6 mb-10">
            <h2 class="text-2xl font-semibold text-gray-800 mb-4">Recent Logs</h2>
            <div class="overflow-auto">
                <table class="min-w-full">
                    <thead>
                        <tr class="bg-gray-200">
                            <th class="px-4 py-2 text-left">Time</th>
                            <th class="px-4 py-2 text-left">Level</th>
                            <th class="px-4 py-2 text-left">Source</th>
                            <th class="px-4 py-2 text-left">Message</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${recentLogs.map(log => `
                            <tr class="log-row">
                                <td class="px-4 py-2 text-sm">${new Date(log.timestamp).toLocaleString()}</td>
                                <td class="px-4 py-2">
                                    <span class="px-2 py-1 rounded-full text-xs ${
                                        log.level === 'error' ? 'bg-red-100 text-red-800' :
                                        log.level === 'warn' ? 'bg-yellow-100 text-yellow-800' :
                                        'bg-blue-100 text-blue-800'
                                    }">
                                        ${log.level}
                                    </span>
                                </td>
                                <td class="px-4 py-2 text-sm">${log.source}</td>
                                <td class="px-4 py-2 text-sm">${log.message}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <div class="mt-4 text-right">
                <a href="/logger" class="text-blue-600 hover:text-blue-800 text-sm font-medium">
                    View All Logs →
                </a>
            </div>
        </div>

        <footer class="mt-12 text-center text-gray-600">
            <p>Environment: ${process.env.NODE_ENV || 'development'}</p>
            <p class="mt-2">© ${new Date().getFullYear()} Healthcare API. All rights reserved.</p>
        </footer>
    </div>

    <script>
        // Refresh status every 30 seconds
        setInterval(() => {
            window.location.reload();
        }, 30000);
    </script>
</body>
</html>`;
  }

  private generateLoggerHtml(title: string, logs: any[]): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    <style>
        .log-row:nth-child(even) {
            background-color: #f7fafc;
        }
        .log-detail {
            max-height: 0;
            overflow: hidden;
            transition: max-height 0.3s ease-out;
        }
        .log-row.expanded .log-detail {
            max-height: 200px;
        }
    </style>
</head>
<body class="bg-gray-100 min-h-screen">
    <div class="container mx-auto px-4 py-8">
        <header class="mb-8">
            <div class="flex justify-between items-center">
                <h1 class="text-3xl font-bold text-gray-800">${title}</h1>
                <a href="/" class="text-blue-600 hover:text-blue-800">← Back to Dashboard</a>
            </div>
            <p class="text-gray-600 mt-2">View system logs and events</p>
        </header>

        <div class="bg-white rounded-lg shadow-md p-6 mb-10">
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold text-gray-800">System Logs</h2>
                <div class="flex space-x-2">
                    <button id="refreshBtn" class="px-3 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200">
                        Refresh
                    </button>
                    <select id="logLevel" class="px-3 py-1 border rounded">
                        <option value="all">All Levels</option>
                        <option value="info">Info</option>
                        <option value="warn">Warning</option>
                        <option value="error">Error</option>
                        <option value="debug">Debug</option>
                    </select>
                </div>
            </div>
            <div class="overflow-auto">
                <table class="min-w-full">
                    <thead>
                        <tr class="bg-gray-200">
                            <th class="px-4 py-2 text-left">Time</th>
                            <th class="px-4 py-2 text-left">Level</th>
                            <th class="px-4 py-2 text-left">Source</th>
                            <th class="px-4 py-2 text-left">Message</th>
                            <th class="px-4 py-2 text-left">Details</th>
                        </tr>
                    </thead>
                    <tbody id="logTableBody">
                        ${logs.map((log, index) => `
                            <tr class="log-row cursor-pointer" data-index="${index}">
                                <td class="px-4 py-2 text-sm">${new Date(log.timestamp).toLocaleString()}</td>
                                <td class="px-4 py-2">
                                    <span class="px-2 py-1 rounded-full text-xs ${
                                        log.level === 'error' ? 'bg-red-100 text-red-800' :
                                        log.level === 'warn' ? 'bg-yellow-100 text-yellow-800' :
                                        log.level === 'debug' ? 'bg-gray-100 text-gray-800' :
                                        'bg-blue-100 text-blue-800'
                                    }">
                                        ${log.level}
                                    </span>
                                </td>
                                <td class="px-4 py-2 text-sm">${log.source}</td>
                                <td class="px-4 py-2 text-sm">${log.message}</td>
                                <td class="px-4 py-2">
                                    <button class="toggle-details px-2 py-1 text-xs bg-gray-200 rounded hover:bg-gray-300">
                                        View
                                    </button>
                                </td>
                            </tr>
                            <tr class="log-detail" data-parent="${index}">
                                <td colspan="5" class="px-4 py-3 bg-gray-50">
                                    <pre class="text-xs overflow-auto max-h-40">${log.data || 'No additional data'}</pre>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <footer class="mt-12 text-center text-gray-600">
            <p>Environment: ${process.env.NODE_ENV || 'development'}</p>
            <p class="mt-2">© ${new Date().getFullYear()} Healthcare API. All rights reserved.</p>
        </footer>
    </div>

    <script>
        // Toggle log details
        document.querySelectorAll('.toggle-details').forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const row = e.target.closest('tr');
                const index = row.dataset.index;
                const detailRow = document.querySelector('tr.log-detail[data-parent="' + index + '"]');
                
                if (detailRow.style.display === 'table-row') {
                    detailRow.style.display = 'none';
                    e.target.textContent = 'View';
                } else {
                    detailRow.style.display = 'table-row';
                    e.target.textContent = 'Hide';
                }
            });
        });

        // Refresh logs
        document.getElementById('refreshBtn').addEventListener('click', () => {
            window.location.reload();
        });

        // Filter logs by level
        document.getElementById('logLevel').addEventListener('change', (e) => {
            const level = e.target.value;
            const rows = document.querySelectorAll('tr.log-row');
            
            rows.forEach(row => {
                const logLevel = row.querySelector('td:nth-child(2) span').textContent.trim().toLowerCase();
                
                if (level === 'all' || logLevel === level) {
                    row.style.display = 'table-row';
                    // Also hide any open detail rows
                    const index = row.dataset.index;
                    const detailRow = document.querySelector('tr.log-detail[data-parent="' + index + '"]');
                    if (detailRow) {
                        detailRow.style.display = 'none';
                    }
                } else {
                    row.style.display = 'none';
                    // Also hide any detail rows
                    const index = row.dataset.index;
                    const detailRow = document.querySelector('tr.log-detail[data-parent="' + index + '"]');
                    if (detailRow) {
                        detailRow.style.display = 'none';
                    }
                }
            });
        });

        // Initialize
        document.querySelectorAll('tr.log-detail').forEach(row => {
            row.style.display = 'none';
        });
    </script>
</body>
</html>`;
  }
}