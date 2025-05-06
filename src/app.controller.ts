import { Controller, Get, Post, Body, UseGuards, Req, Res, HttpStatus, Redirect } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AppService } from './app.service';
import { Public } from './libs/decorators/public.decorator';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from './shared/database/prisma/prisma.service';
import { FastifyReply } from 'fastify';
import { readFileSync } from 'fs';
import { join } from 'path';
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
      const baseUrl = this.configService.get('API_URL');
      
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

      const viewsPath = join(process.cwd(), 'src/views/dashboard.html');
      let template = readFileSync(viewsPath, 'utf8');
      
      // Replace template variables
      template = template.replace('{{title}}', 'Healthcare API Dashboard');
      template = template.replace('{{services}}', JSON.stringify(services));
      
      res.header('Content-Type', 'text/html');
      return res.send(template);
    } catch (error) {
      console.error('Error serving dashboard:', error);
      console.log('Current directory:', process.cwd());
      console.log('__dirname:', __dirname);
      return res.send('Error loading dashboard. Please check server logs.');
    }
  }
}