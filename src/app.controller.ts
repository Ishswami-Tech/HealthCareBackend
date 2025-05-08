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

  @Get('api-health')
  @Public()
  @ApiOperation({ 
    summary: 'Health check',
    description: 'Returns the health status of the API and its dependencies'
  })
  @ApiResponse({
    status: 200,
    description: 'Health check response'
  })
  async getHealth() {
    return this.healthController.getServicesStatus();
  }

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

  @Get('redis-ui')
  @Public()
  @ApiOperation({
    summary: 'Redis Commander',
    description: 'Redis management interface for monitoring and managing Redis data.'
  })
  @ApiResponse({
    status: 302,
    description: 'Redirects to Redis Commander UI'
  })
  async getRedisUI(@Res() res: FastifyReply) {
    const redisCommanderUrl = this.configService.get<string>('REDIS_COMMANDER_URL');
    return res.redirect(redisCommanderUrl);
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

}