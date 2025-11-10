import { Module, Global, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@config';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaModule } from './prisma/prisma.module';
import { LoggingModule, LoggingService } from '@infrastructure/logging';
import { CacheModule } from '@infrastructure/cache';
import { LogType, LogLevel } from '@core/types';
import { initDatabase } from './scripts/init-db';
import { healthcareConfig } from './config/healthcare.config';
import { ConnectionPoolManager } from './connection-pool.manager';
import { HealthcareQueryOptimizerService } from './query-optimizer.service';
import { UserRepository } from './repositories/user.repository';
import { ClinicIsolationService } from './clinic-isolation.service';
import { SimplePatientRepository } from './repositories/simple-patient.repository';
import { DatabaseMetricsService } from './database-metrics.service';
import { HealthcareDatabaseClient } from './clients/healthcare-database.client';

/**
 * Database Module - Single Unified Database Service
 *
 * SINGLE ENTRY POINT: This module provides ONE unified database service for the entire application.
 * ONLY DatabaseService is exported publicly and should be used by external services.
 *
 * ARCHITECTURE:
 * - DatabaseService: ONLY public interface (alias for HealthcareDatabaseClient)
 *   └─ HealthcareDatabaseClient: Internal implementation (NOT exported publicly)
 *   └─ All other components are INTERNAL and not exported:
 *   └─ ConnectionPoolManager: Internal infrastructure component (@internal)
 *   └─ DatabaseMetricsService: Internal infrastructure component (@internal)
 *   └─ HealthcareQueryOptimizerService: Internal infrastructure component (@internal)
 *   └─ ClinicIsolationService: Internal infrastructure component (@internal)
 *   └─ UserRepository, SimplePatientRepository: Internal infrastructure components (@internal)
 *
 * IMPORTANT:
 * - External services MUST use ONLY DatabaseService (import from @infrastructure/database)
 * - HealthcareDatabaseClient is INTERNAL ONLY (used by infrastructure components)
 * - Do NOT import or use any other database components directly
 *
 * All optimization layers are automatically applied through DatabaseService:
 * - Connection pooling and read replicas
 * - Query caching and optimization
 * - Metrics tracking and monitoring
 * - HIPAA compliance and audit logging
 * - Multi-tenant clinic isolation
 */
@Global()
@Module({
  imports: [
    PrismaModule,
    LoggingModule,
    CacheModule,
    // ConfigModule is @Global() - healthcare config should be loaded in config.module.ts
    ConfigModule,
  ],
  providers: [
    // ALL components are INTERNAL - only HealthcareDatabaseClient is exported
    // Order matters for circular dependencies: list services before services that depend on them
    ClinicIsolationService, // @internal - no dependencies on other providers
    HealthcareQueryOptimizerService, // @internal - no dependencies on other providers
    ConnectionPoolManager, // @internal - must be before DatabaseMetricsService and HealthcareDatabaseClient
    DatabaseMetricsService, // @internal - depends on ConnectionPoolManager and HealthcareDatabaseClient
    UserRepository, // @internal - infrastructure component, not exported
    SimplePatientRepository, // @internal - infrastructure component, not exported
    {
      provide: 'HealthcareDatabaseConfig',
      useValue: {
        enableAuditLogging: true,
        enablePHIProtection: true,
        auditRetentionDays: 2555, // 7 years for HIPAA compliance
        encryptionEnabled: true,
        complianceLevel: 'HIPAA',
        connectionTimeout: 30000,
        queryTimeout: 15000,
        maxConnections: 500, // Optimized for 10M+ users (increased from 50)
        healthCheckInterval: 30000,
      },
    },
    HealthcareDatabaseClient,
  ],
  exports: [
    // SINGLE UNIFIED DATABASE SERVICE - This is the ONLY export
    // All database operations MUST go through DatabaseService (exported in index.ts)
    // It includes all optimization layers: connection pooling, caching, query optimization, metrics, HIPAA compliance
    // DO NOT export any other components - they are internal infrastructure
    HealthcareDatabaseClient, // Internal class - exported as "DatabaseService" in index.ts (ONLY PUBLIC INTERFACE)
    // Note: HealthcareDatabaseClient itself is NOT exported publicly - only DatabaseService alias is public
    ClinicIsolationService, // Export for GuardsModule to resolve circular dependency
  ],
})
export class DatabaseModule implements OnModuleInit {
  private readonly serviceName = 'DatabaseModule';

  constructor(
    private configService: ConfigService,
    private connectionPoolManager: ConnectionPoolManager,
    private clinicIsolationService: ClinicIsolationService,
    private loggingService: LoggingService
  ) {}

  async onModuleInit() {
    try {
      // Determine environment
      const isProduction = process.env['NODE_ENV'] === 'production';
      const isDocker = fs.existsSync('/.dockerenv');
      const isWindows = process.platform === 'win32';

      // Get schema path from environment
      const originalSchemaPath = this.configService?.get<string>('PRISMA_SCHEMA_PATH') || undefined;
      let resolvedSchemaPath = originalSchemaPath;

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.INFO,
        `Original schema path: ${originalSchemaPath}`,
        this.serviceName
      );
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.INFO,
        `Environment: ${isProduction ? 'Production' : 'Development'}, Docker: ${isDocker}, Windows: ${isWindows}`,
        this.serviceName
      );

      // Handle different path formats based on environment
      if (originalSchemaPath) {
        if (originalSchemaPath.startsWith('./')) {
          // Relative path - resolve from current working directory
          resolvedSchemaPath = path.resolve(process.cwd(), originalSchemaPath.substring(2));
        } else if (originalSchemaPath.startsWith('/app/') && isWindows && !isDocker) {
          // Docker path on Windows local development
          resolvedSchemaPath = path.resolve(process.cwd(), originalSchemaPath.replace('/app/', ''));
        } else if (originalSchemaPath.includes('C:/Program Files/Git/app/')) {
          // Incorrectly resolved Git path on Windows
          resolvedSchemaPath = path.resolve(
            process.cwd(),
            originalSchemaPath.replace('C:/Program Files/Git/app/', '')
          );
        }
      } else {
        // Default fallback paths
        if (isDocker) {
          resolvedSchemaPath = '/app/src/libs/infrastructure/database/prisma/schema.prisma';
        } else {
          resolvedSchemaPath = path.resolve(
            process.cwd(),
            'src/libs/infrastructure/database/prisma/schema.prisma'
          );
        }
      }

      // Make sure the path actually exists
      if (resolvedSchemaPath && !fs.existsSync(resolvedSchemaPath)) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.WARN,
          `Resolved schema path ${resolvedSchemaPath} does not exist, trying to find alternatives...`,
          this.serviceName
        );

        // Try some alternative paths
        const alternatives = [
          path.resolve(process.cwd(), 'src/libs/infrastructure/database/prisma/schema.prisma'),
          path.resolve(process.cwd(), 'dist/shared/database/prisma/schema.prisma'),
          path.resolve(__dirname, '../prisma/schema.prisma'),
          isDocker ? '/app/src/libs/infrastructure/database/prisma/schema.prisma' : null,
          isDocker ? '/app/dist/shared/database/prisma/schema.prisma' : null,
        ].filter(Boolean);

        for (const alt of alternatives) {
          if (alt && fs.existsSync(alt)) {
            resolvedSchemaPath = alt;
            void this.loggingService.log(
              LogType.DATABASE,
              LogLevel.INFO,
              `Found alternative schema path: ${alt}`,
              this.serviceName
            );
            break;
          }
        }
      }

      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.INFO,
        `Using schema path: ${resolvedSchemaPath}`,
        this.serviceName
      );

      // Update environment variable for other services to use
      process.env['PRISMA_SCHEMA_PATH'] = resolvedSchemaPath;

      // Initialize the database
      await initDatabase();
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.INFO,
        'Database initialization completed successfully',
        this.serviceName
      );

      // Initialize enhanced database components
      await this.initializeEnhancedComponents();
    } catch (_error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to initialize database module: ${_error instanceof Error ? _error.message : String(_error)}`,
        this.serviceName,
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );
      throw _error;
    }
  }

  private async initializeEnhancedComponents() {
    try {
      // Validate healthcare configuration
      const { validateHealthcareConfig } = await import('./config/healthcare.config');
      const healthcareConf = this.configService?.get<Record<string, unknown>>('healthcare') || undefined;
      if (healthcareConf) {
        validateHealthcareConfig(healthcareConf);
      }

      // Initialize clinic isolation service for full data separation
      await this.clinicIsolationService.initializeClinicCaching();

      // Log initialization completion
      const poolMetrics = this.connectionPoolManager.getMetrics();
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.INFO,
        'Enhanced database components initialized successfully',
        this.serviceName
      );
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.INFO,
        `Connection pool status: ${poolMetrics.totalConnections} connections, healthy: ${poolMetrics.isHealthy}`,
        this.serviceName
      );

      // Log healthcare-specific configuration
      const multiClinic = (healthcareConf?.['multiClinic'] as Record<string, unknown>) || undefined;
      const hipaa = (healthcareConf?.['hipaa'] as Record<string, unknown>) || undefined;
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.INFO,
        `Multi-clinic support enabled: ${String(multiClinic?.['enabled'])}`,
        this.serviceName
      );
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.INFO,
        `HIPAA compliance enabled: ${String(hipaa?.['enabled'])}`,
        this.serviceName
      );
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.INFO,
        `Maximum clinics per app: ${String(multiClinic?.['maxClinicsPerApp'])}`,
        this.serviceName
      );
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.INFO,
        `Maximum locations per clinic: ${String(multiClinic?.['maxLocationsPerClinic'])}`,
        this.serviceName
      );
    } catch (_error) {
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.ERROR,
        `Failed to initialize enhanced database components: ${_error instanceof Error ? _error.message : String(_error)}`,
        this.serviceName,
        { error: _error instanceof Error ? _error.stack : String(_error) }
      );
      throw _error;
    }
  }
}
