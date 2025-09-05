import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { JwtModule } from '@nestjs/jwt';

// Infrastructure Services
import { LoggingServiceModule } from '../../libs/infrastructure/logging';
import { CacheServiceModule } from '../../libs/infrastructure/cache/cache-service.module';
import { DatabaseModule } from '../../libs/infrastructure/database';
import { RbacModule } from '../../libs/core/rbac/rbac.module';
import { RateLimitModule } from '../../libs/utils/rate-limit/rate-limit.module';
import { AuthModule } from '../auth/auth.module';
import { QueueModule } from '../../libs/infrastructure/queue';

// Core Services
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

// Enhanced Core Services
import { CoreAppointmentService } from './core/core-appointment.service';
import { ConflictResolutionService } from './core/conflict-resolution.service';
import { AppointmentWorkflowEngine } from './core/appointment-workflow-engine.service';
import { BusinessRulesEngine } from './core/business-rules-engine.service';

// Plugin System
import { AppointmentPluginController } from './plugins/plugin.controller';
import { AppointmentEnterprisePluginManager } from './plugins/enterprise-plugin-manager';
import { PluginConfigService } from './plugins/config/plugin-config.service';
import { PluginHealthService } from './plugins/health/plugin-health.service';

// Clinic-Specific Plugins
import { ClinicQueuePlugin } from './plugins/queue/clinic-queue.plugin';

// Service Dependencies
import { AppointmentQueueService } from './plugins/queue/appointment-queue.service';
import { QrService } from '../../libs/utils/QR';

/**
 * Enhanced Appointments Module
 * 
 * Enterprise-grade appointment management with HIPAA compliance.
 * Features:
 * - Plugin-based architecture for extensibility
 * - Advanced queue management with BullMQ
 * - Conflict resolution and intelligent scheduling
 * - Business rules engine with configurable rules
 * - Multi-tenant clinic support
 * - Real-time updates via WebSocket
 * - Comprehensive audit logging
 */
@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'default-secret',
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN') || '24h',
        },
      }),
      inject: [ConfigService],
    }),
    LoggingServiceModule,
    CacheServiceModule,
    DatabaseModule,
    RbacModule,
    RateLimitModule,
    AuthModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        redis: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: configService.get('REDIS_PORT', 6379),
          password: configService.get('REDIS_PASSWORD'),
          db: configService.get('REDIS_DB', 0),
        },
        defaultJobOptions: {
          removeOnComplete: 1000,
          removeOnFail: 500,
          attempts: 5,
          timeout: 60000,
        },
        settings: {
          stalledInterval: 30000,
          maxStalledCount: 1,
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue(
      { name: 'clinic-appointment' },
      { name: 'clinic-notification' },
      { name: 'clinic-payment' },
      { name: 'clinic-video-call' },
      { name: 'clinic-analytics' },
      { name: 'clinic-reminder' },
      { name: 'clinic-followup' }
    ),
    EventEmitterModule.forRoot(),
  ],
  controllers: [
    AppointmentsController, 
    AppointmentPluginController
  ],
  providers: [
    // Core Services
    AppointmentsService,
    CoreAppointmentService,
    ConflictResolutionService,
    AppointmentWorkflowEngine,
    BusinessRulesEngine,
    // Plugin System
    AppointmentEnterprisePluginManager,
    PluginConfigService,
    PluginHealthService,

    // Clinic-Specific Plugins
    ClinicQueuePlugin,

    // Service Dependencies
    AppointmentQueueService,
    QrService,
  ],
  exports: [
    // Core Services
    AppointmentsService,
    CoreAppointmentService,
    ConflictResolutionService,
    AppointmentWorkflowEngine,
    BusinessRulesEngine,
    // Plugin System
    AppointmentEnterprisePluginManager,
    PluginConfigService,
    PluginHealthService,

    // Clinic Plugins
    ClinicQueuePlugin,
  ],
})
export class AppointmentsModule {} 