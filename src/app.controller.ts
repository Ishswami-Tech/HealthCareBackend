import { Controller, Get, Post, Body, UseGuards, Req, Res, HttpStatus, Redirect } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from './libs/decorators/public.decorator';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from './shared/database/prisma/prisma.service';
import { FastifyReply } from 'fastify';
import { ConfigService } from '@nestjs/config';
import { HealthController } from './services/health/health.controller';

interface HealthStatus {
  api?: { status: 'up' | 'down' };
  queues?: { status: 'up' | 'down' };
  redis?: { status: 'up' | 'down' };
  database?: { status: 'up' | 'down' };
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
      // Use the server base URL or fall back to environment variable
      const host = this.configService.get('API_URL') || `https://${this.configService.get('SERVER_IP') || '82.208.20.16'}`;
      const baseUrl = host.endsWith('/') ? host.slice(0, -1) : host;
      
      // Get real-time service status from health controller
      const healthStatus = await this.healthController.getServicesStatus() as HealthStatus;
      
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
          url: this.configService.get('REDIS_COMMANDER_URL'),
          active: healthStatus?.redis?.status === 'up',
          category: 'Database',
          credentials: 'Username: admin, Password: admin'
        },
        {
          name: 'Prisma Studio',
          description: 'PostgreSQL database management through Prisma.',
          url: this.configService.get('PRISMA_STUDIO_URL'),
          active: healthStatus?.database?.status === 'up',
          category: 'Database'
        },
        {
          name: 'pgAdmin',
          description: 'PostgreSQL database management interface.',
          url: this.configService.get('PGADMIN_URL'),
          active: healthStatus?.database?.status === 'up',
          category: 'Database',
          credentials: 'Email: admin@admin.com, Password: admin'
        }
      ];

      // Generate HTML content
      const html = this.generateDashboardHtml('Healthcare API Dashboard', services);

      res.header('Content-Type', 'text/html');
      return res.send(html);
    } catch (error) {
      console.error('Error serving dashboard:', error);
      return res.send('Error loading dashboard. Please check server logs.');
    }
  }

  private generateDashboardHtml(title: string, services: any[]): string {
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
    </style>
</head>
<body class="bg-gray-100 min-h-screen">
    <div class="container mx-auto px-4 py-8">
        <header class="text-center mb-12">
            <h1 class="text-4xl font-bold text-gray-800 mb-4">${title}</h1>
            <p class="text-gray-600">System Status and Service Management</p>
        </header>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
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