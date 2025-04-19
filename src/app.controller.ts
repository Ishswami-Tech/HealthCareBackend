import { Controller, Get, Post, Body, UseGuards, Req, Res, HttpStatus, Redirect } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from './libs/decorators/public.decorator';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from './shared/database/prisma/prisma.service';
import { Role } from '@prisma/client';
import { FastifyReply } from 'fastify';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';

@ApiTags('root')
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
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
    const baseUrl = this.configService.get('BASE_URL', 'http://localhost:8088');
    const isDev = this.configService.get('NODE_ENV') === 'development';
    
    const services = [
      {
        name: 'API Documentation',
        description: 'Swagger API documentation and testing interface.',
        url: `${baseUrl}/docs`,
        active: true,
        category: 'Documentation'
      },
      {
        name: 'Bull Board',
        description: 'Queue management and monitoring dashboard.',
        url: `${baseUrl}/admin/queues`,
        active: true,
        category: 'Monitoring'
      },
      {
        name: 'Socket.IO Admin',
        description: 'WebSocket monitoring dashboard. To connect: 1) Go to admin.socket.io 2) Enter Server URL: http://localhost:8088 3) Use credentials below',
        url: 'https://admin.socket.io',
        credentials: 'Username: admin, Password: admin',
        active: true,
        category: 'Monitoring'
      },
      {
        name: 'Redis Commander',
        description: 'Redis database management interface.',
        url: 'http://localhost:8082',
        credentials: 'Username: admin, Password: admin',
        active: true,
        category: 'Database'
      },
      {
        name: 'Prisma Studio',
        description: 'PostgreSQL database management through Prisma.',
        url: 'http://localhost:5555',
        active: true,
        category: 'Database'
      },
      {
        name: 'pgAdmin',
        description: 'PostgreSQL database management interface.',
        url: 'http://localhost:5050',
        credentials: 'Email: admin@admin.com, Password: admin',
        active: true,
        category: 'Database'
      },
      {
        name: 'Logger API',
        description: 'Application logs and error tracking interface.',
        url: `${baseUrl}/logger`,
        active: true,
        category: 'Monitoring'
      },
      {
        name: 'Health Check',
        description: 'API health status and metrics dashboard.',
        url: `${baseUrl}/health`,
        active: true,
        category: 'Monitoring'
      },

    ];

    try {
      const viewsPath = join(process.cwd(), 'dist/src/views/dashboard.html');
      console.log('Attempting to read template from:', viewsPath);
      
      const template = readFileSync(viewsPath, 'utf8');
      const html = template.replace('{{ services }}', JSON.stringify(services));
      
      res.header('Content-Type', 'text/html');
      return res.send(html);
    } catch (error) {
      console.error('Error serving dashboard:', error);
      console.error('Current directory:', process.cwd());
      console.error('__dirname:', __dirname);
      
      // Fallback HTML with better styling and categorized services
      const groupedServices = services.reduce((acc, service) => {
        if (!acc[service.category]) {
          acc[service.category] = [];
        }
        acc[service.category].push(service);
        return acc;
      }, {} as Record<string, typeof services>);

      return res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Healthcare API Services</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    margin: 0;
                    padding: 2rem;
                    background-color: #f3f4f6;
                }
                .container {
                    max-width: 1200px;
                    margin: 0 auto;
                }
                h1, h2 {
                    color: #2563eb;
                }
                h1 {
                    margin-bottom: 2rem;
                }
                h2 {
                    margin: 2rem 0 1rem;
                    font-size: 1.5rem;
                }
                .category {
                    margin-bottom: 2rem;
                }
                ul {
                    list-style: none;
                    padding: 0;
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                    gap: 1rem;
                }
                li {
                    background: white;
                    padding: 1rem;
                    border-radius: 0.5rem;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
                }
                a {
                    color: #2563eb;
                    text-decoration: none;
                    font-weight: 500;
                    display: block;
                    margin-bottom: 0.5rem;
                }
                a:hover {
                    text-decoration: underline;
                }
                .description {
                    color: #6b7280;
                    font-size: 0.875rem;
                    margin-bottom: 0.5rem;
                }
                .credentials {
                    color: #059669;
                    font-size: 0.75rem;
                    font-family: monospace;
                    background: #ecfdf5;
                    padding: 0.25rem 0.5rem;
                    border-radius: 0.25rem;
                    margin-top: 0.5rem;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Healthcare API Services</h1>
                ${Object.entries(groupedServices).map(([category, categoryServices]) => `
                    <div class="category">
                        <h2>${category}</h2>
                        <ul>
                            ${categoryServices.map(service => `
                                <li>
                                    <a href="${service.url}" target="_blank">${service.name}</a>
                                    <div class="description">${service.description}</div>
                                    ${service.credentials ? `<div class="credentials">${service.credentials}</div>` : ''}
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                `).join('')}
            </div>
        </body>
        </html>
      `);
    }
  }
}