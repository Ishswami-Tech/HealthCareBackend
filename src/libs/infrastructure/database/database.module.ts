import { Module, Global, OnModuleInit, forwardRef, Inject } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@config';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaModule } from './prisma/prisma.module';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';
import { initDatabase } from './scripts/init-db';
// healthcareConfig is imported by ConfigModule, not used directly here
import { ConnectionPoolManager } from './query/scripts/connection-pool.manager';
import { HealthcareQueryOptimizerService } from './internal/query-optimizer.service';
import { UserRepository } from './query/repositories/user.repository';
import { ClinicIsolationService } from './internal/clinic-isolation.service';
import { SimplePatientRepository } from './query/repositories/simple-patient.repository';
import { DatabaseMetricsService } from './internal/database-metrics.service';
import { RetryService } from './internal/retry.service';
import { ConnectionLeakDetectorService } from './internal/connection-leak-detector.service';
import { DatabaseAlertService } from './internal/database-alert.service';
import { SQLInjectionPreventionService } from './internal/sql-injection-prevention.service';
import { DataMaskingService } from './internal/data-masking.service';
import { QueryCacheService } from './internal/query-cache.service';
import { RowLevelSecurityService } from './internal/row-level-security.service';
import { ReadReplicaRouterService } from './internal/read-replica-router.service';
import { DatabaseHealthMonitorService } from './internal/database-health-monitor.service';
import { ClinicRateLimiterService } from './internal/clinic-rate-limiter.service';
import { DatabaseService } from './database.service';
import { EventsModule } from '@infrastructure/events';
import { LoggingModule } from '@infrastructure/logging/logging.module';

// Query patterns - strategies
import { QueryStrategyManager } from './query/strategies/query-strategy.manager';
import { ReadQueryStrategy } from './query/strategies/read-query.strategy';
import { WriteQueryStrategy } from './query/strategies/write-query.strategy';
import { TransactionQueryStrategy } from './query/strategies/transaction-query.strategy';

// Query patterns - middleware
import { QueryMiddlewareChain } from './query/middleware/query-middleware.chain';
import { ValidationQueryMiddleware } from './query/middleware/validation-query.middleware';
import { MetricsQueryMiddleware } from './query/middleware/metrics-query.middleware';
import { SecurityQueryMiddleware } from './query/middleware/security-query.middleware';
import { OptimizationQueryMiddleware } from './query/middleware/optimization-query.middleware';

// Query patterns - builders and factories
import { QueryOptionsBuilder } from './query/builders/query-options.builder';
import { QueryKeyFactory } from './query/factories/query-key.factory';

/**
 * Database Module - Single Unified Database Service
 *
 * SINGLE ENTRY POINT: This module provides ONE unified database service for the entire application.
 * ONLY DatabaseService is exported publicly and should be used by external services.
 *
 * ARCHITECTURE:
 * - DatabaseService: ONLY public interface - single entry point for all database operations
 *   └─ All other components are INTERNAL and not exported:
 *   └─ ConnectionPoolManager: Internal infrastructure component (@internal)
 *   └─ DatabaseMetricsService: Internal infrastructure component (@internal)
 *   └─ HealthcareQueryOptimizerService: Internal infrastructure component (@internal)
 *   └─ ClinicIsolationService: Internal infrastructure component (@internal)
 *   └─ UserRepository, SimplePatientRepository: Internal infrastructure components (@internal)
 *
 * IMPORTANT:
 * - External services MUST use ONLY DatabaseService (import from @infrastructure/database)
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
    // ConfigModule is @Global() but we need to import it to inject ConfigService
    // Use forwardRef to handle circular dependency (ConfigModule imports healthcareConfig from this module)
    forwardRef(() => ConfigModule),
    // EventsModule for EventService
    forwardRef(() => EventsModule),
    // LoggingModule is @Global() and imported before DatabaseModule in AppModule
    // We import it directly (not with forwardRef) since it's already initialized
    // LoggingService uses DatabaseService, but since LoggingModule is initialized first,
    // and we use forwardRef for DatabaseService injection in LoggingService, it works
    forwardRef(() => LoggingModule),
    // CacheModule is @Global() - no need to import it explicitly
  ],
  providers: [
    // ALL components are INTERNAL - only DatabaseService is exported
    // Order matters for circular dependencies: list services before services that depend on them
    // Layer 2: Internal Services (independent, no cross-deps)
    RetryService, // @internal - LoggingService only
    ConnectionLeakDetectorService, // @internal - LoggingService only
    DatabaseAlertService, // @internal - LoggingService only
    SQLInjectionPreventionService, // @internal - ConfigService, LoggingService
    DataMaskingService, // @internal - ConfigService, LoggingService
    QueryCacheService, // @internal - CacheService, LoggingService
    RowLevelSecurityService, // @internal - PrismaService, ConfigService, LoggingService
    ReadReplicaRouterService, // @internal - PrismaService, ConfigService, LoggingService
    DatabaseHealthMonitorService, // @internal - PrismaService, ConfigService, LoggingService
    ClinicRateLimiterService, // @internal - CacheService, ConfigService, LoggingService
    ClinicIsolationService, // @internal - PrismaService, ConfigService, LoggingService
    HealthcareQueryOptimizerService, // @internal - LoggingService only
    ConnectionPoolManager, // @internal - depends only on PrismaService, ConfigService, LoggingService
    DatabaseMetricsService, // @internal - depends on ConnectionPoolManager, PrismaService, ConfigService, LoggingService
    UserRepository, // @internal - infrastructure component, not exported
    SimplePatientRepository, // @internal - infrastructure component, not exported
    // Query patterns - strategies
    ReadQueryStrategy, // @internal - PrismaService, LoggingService
    WriteQueryStrategy, // @internal - PrismaService, LoggingService
    TransactionQueryStrategy, // @internal - PrismaService, LoggingService
    QueryStrategyManager, // @internal - depends on all strategies
    // Query patterns - middleware
    ValidationQueryMiddleware, // @internal - LoggingService
    MetricsQueryMiddleware, // @internal - LoggingService, DatabaseMetricsService
    SecurityQueryMiddleware, // @internal - LoggingService, SQLInjectionPreventionService, RowLevelSecurityService
    OptimizationQueryMiddleware, // @internal - LoggingService, HealthcareQueryOptimizerService
    QueryMiddlewareChain, // @internal - depends on all middleware
    // Query patterns - builders and factories
    QueryOptionsBuilder, // @internal - no dependencies
    QueryKeyFactory, // @internal - no dependencies
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
        healthCheckInterval: 30000,
      },
    },
    // DatabaseService - depends on everything above
    DatabaseService,
  ],
  exports: [
    // SINGLE UNIFIED DATABASE SERVICE - This is the ONLY export
    // All database operations MUST go through DatabaseService
    // It includes all optimization layers: connection pooling, caching, query optimization, metrics, HIPAA compliance
    // DO NOT export any other components - they are internal infrastructure
    DatabaseService,
    ClinicIsolationService, // Export for GuardsModule to resolve circular dependency
  ],
})
export class DatabaseModule implements OnModuleInit {
  private readonly serviceName = 'DatabaseModule';

  constructor(
    @Inject(forwardRef(() => ConfigService)) private configService: ConfigService,
    private connectionPoolManager: ConnectionPoolManager,
    private clinicIsolationService: ClinicIsolationService,
    @Inject(forwardRef(() => LoggingService)) private loggingService: LoggingService
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
      await initDatabase(this.loggingService);
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
      // Validate healthcare configuration (only if config exists)
      // Validation is environment-aware: strict in production, lenient in development
      const { validateHealthcareConfig } = await import('./config/healthcare.config');
      const healthcareConf =
        this.configService?.get<Record<string, unknown>>('healthcare') || undefined;
      if (healthcareConf) {
        try {
          validateHealthcareConfig(healthcareConf);
        } catch (validationError) {
          const errorMessage =
            validationError instanceof Error ? validationError.message : String(validationError);
          const isProduction = this.configService?.isProduction() ?? false;

          if (isProduction) {
            // In production, validation errors are critical
            void this.loggingService.log(
              LogType.DATABASE,
              LogLevel.ERROR,
              `Healthcare configuration validation failed: ${errorMessage}`,
              this.serviceName,
              { error: errorMessage }
            );
            throw validationError;
          } else {
            // In development, log as warning and continue
            void this.loggingService.log(
              LogType.DATABASE,
              LogLevel.WARN,
              `Healthcare configuration validation warning (non-critical in development): ${errorMessage}`,
              this.serviceName,
              { error: errorMessage }
            );
            // Don't throw - allow application to start in development
          }
        }
      }

      // Initialize clinic isolation service for full data separation
      // NOTE: ClinicIsolationService already initializes itself in onModuleInit()
      // We skip duplicate initialization here to avoid redundant cache loading and log noise
      // The service will handle initialization automatically via its lifecycle hook
      // If initialization fails, it will be logged by ClinicIsolationService itself
      // No need to duplicate the initialization logic here

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
