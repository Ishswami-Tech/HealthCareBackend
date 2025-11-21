import { Module, Global, OnModuleInit, forwardRef, Inject, type Provider } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@config';
import * as path from 'path';
import * as fs from 'fs';
import { PrismaModule } from './prisma/prisma.module';
import { LoggingService } from '@infrastructure/logging/logging.service';
import { LogType, LogLevel } from '@core/types';
import { initDatabase } from './scripts/init-db';
// healthcareConfig is imported by ConfigModule, not used directly here
import { ConnectionPoolManager } from './connection-pool.manager';
import { HealthcareQueryOptimizerService } from './internal/query-optimizer.service';
import { UserRepository } from './repositories/user.repository';
import { ClinicIsolationService } from './internal/clinic-isolation.service';
import { SimplePatientRepository } from './repositories/simple-patient.repository';
// Import DatabaseMetricsService and HealthcareDatabaseClient normally
// HealthcareDatabaseClient uses type-only imports internally, which breaks the circular dependency
import { DatabaseMetricsService } from './internal/database-metrics.service';
import { HealthcareDatabaseClient } from './clients/healthcare-database.client';
import { EventsModule } from '@infrastructure/events';
// New services following SOLID principles
import { RetryService } from './internal/retry.service';
import { DatabaseErrorHandler } from '@core/errors';
import { ReadReplicaRouterService } from './internal/read-replica-router.service';
import { ConnectionLeakDetectorService } from './internal/connection-leak-detector.service';
import { DatabaseHealthMonitorService } from './internal/database-health-monitor.service';
import { QueryCacheService } from './internal/query-cache.service';
import { DatabaseAlertService } from './internal/database-alert.service';
import { ResilienceModule } from '@core/resilience';
import { EventService } from '@infrastructure/events';
import { CacheService } from '@infrastructure/cache';
import { PrismaService } from './prisma/prisma.service';
import type { HealthcareDatabaseConfig } from '@core/types/database.types';
import { RateLimitModule } from '@security/rate-limit';
import { RowLevelSecurityService } from './internal/row-level-security.service';
// ClinicRateLimiterService is provided by DatabaseModule using ModuleRef to lazily inject RateLimitService
import { ClinicRateLimiterService } from './internal/clinic-rate-limiter.service';
import { DataMaskingService } from './internal/data-masking.service';
import { SQLInjectionPreventionService } from './internal/sql-injection-prevention.service';

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
    // ConfigModule is @Global() but we need to import it to inject ConfigService
    // Use forwardRef to handle circular dependency (ConfigModule imports healthcareConfig from this module)
    forwardRef(() => ConfigModule),
    // EventsModule for EventService
    forwardRef(() => EventsModule),
    // ResilienceModule for CircuitBreakerService
    ResilienceModule,
    // RateLimitModule for ClinicRateLimiterService (use forwardRef to break potential circular dependency)
    forwardRef(() => RateLimitModule),
    // LoggingModule is @Global() and imported before DatabaseModule in AppModule
    // Since it's @Global(), we don't need to import it explicitly - it's available everywhere
    // CacheModule is @Global() - no need to import it explicitly
  ],
  providers: [
    // ALL components are INTERNAL - only HealthcareDatabaseClient is exported
    // Order matters for circular dependencies: list services before services that depend on them

    // Shared services (DRY principle)
    RetryService, // @internal - shared retry logic
    DatabaseErrorHandler, // @internal - shared error handling

    // Core services (SRP principle - single responsibility)
    // IMPORTANT: DatabaseAlertService MUST be before DatabaseMetricsService (DatabaseMetricsService depends on it)
    DatabaseAlertService, // @internal - alert generation only - MUST be before DatabaseMetricsService
    ConnectionLeakDetectorService, // @internal - leak detection only
    DatabaseHealthMonitorService, // @internal - health monitoring only
    QueryCacheService, // @internal - query result caching only
    ReadReplicaRouterService, // @internal - read replica routing only

    // Infrastructure services - register dependencies BEFORE services that use them
    // to avoid circular dependency during provider registration
    HealthcareQueryOptimizerService, // @internal - no dependencies on other providers
    ClinicIsolationService, // @internal - MUST be before DatabaseMetricsService (DatabaseMetricsService depends on it)
    // Security services (Phase 8: Advanced Security & Multi-Tenancy)
    RowLevelSecurityService, // @internal - PostgreSQL RLS enforcement
    // ClinicRateLimiterService provided here using ModuleRef to lazily inject RateLimitService
    // This breaks circular dependency: DatabaseModule imports RateLimitModule, so RateLimitModule cannot provide services from DatabaseModule
    {
      provide: ClinicRateLimiterService,
      useFactory: (
        moduleRef: ModuleRef,
        configService: ConfigService,
        loggingService: LoggingService
      ) => {
        return new ClinicRateLimiterService(moduleRef, configService, loggingService);
      },
      inject: [ModuleRef, ConfigService, LoggingService],
    },
    DataMaskingService, // @internal - PHI masking for non-production
    SQLInjectionPreventionService, // @internal - SQL injection detection
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
    // ConnectionPoolManager must be before DatabaseMetricsService and HealthcareDatabaseClient
    // ConnectionPoolManager is the PRIMARY connection pool manager with full features (batch, critical queries, auto-scaling, pool warming, etc.)
    // Consolidated: ConnectionPoolService and ConnectionPoolWarmingService merged into ConnectionPoolManager
    ConnectionPoolManager, // @internal - PRIMARY connection pool manager (consolidated: includes pool warming, metrics, health checks)
    // Tier 2: DatabaseMetricsService (factory provider)
    // Factory provider breaks circular dependency by deferring dependency resolution until after all providers are registered
    {
      provide: DatabaseMetricsService,
      useFactory: (
        configService: ConfigService,
        prismaService: PrismaService,
        loggingService: LoggingService,
        clinicIsolationService: ClinicIsolationService,
        alertService: DatabaseAlertService,
        queryOptimizer: HealthcareQueryOptimizerService
      ) => {
        try {
          // Create service instance
          const metricsService = new DatabaseMetricsService(
            configService,
            prismaService,
            loggingService
          );

          // Wire dependencies explicitly (security: explicit validation)
          // setDependencies method validates parameters internally
          // Type assertion needed because ESLint can't infer type in factory function context
          const typedMetricsService = metricsService as {
            setDependencies: (
              clinicIsolation: ClinicIsolationService,
              alertService: DatabaseAlertService,
              queryOptimizer: HealthcareQueryOptimizerService
            ) => void;
          };
          typedMetricsService.setDependencies(clinicIsolationService, alertService, queryOptimizer);

          // Log initialization for audit trail
          void loggingService.log(
            LogType.DATABASE,
            LogLevel.INFO,
            'DatabaseMetricsService initialized via factory',
            'DatabaseModule'
          );

          return metricsService;
        } catch (error: unknown) {
          // Log error for audit trail
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : String(error);
          void loggingService.log(
            LogType.DATABASE,
            LogLevel.ERROR,
            `Failed to initialize DatabaseMetricsService: ${errorMessage}`,
            'DatabaseModule',
            { error: errorStack }
          );
          // Re-throw to prevent invalid service instance
          throw error instanceof Error ? error : new Error(String(error));
        }
      },
      inject: [
        ConfigService,
        PrismaService,
        LoggingService,
        ClinicIsolationService,
        DatabaseAlertService,
        HealthcareQueryOptimizerService,
      ],
    },
    // Tier 3: HealthcareDatabaseClient (factory provider)
    // Factory provider ensures all dependencies are available before instantiation
    // Uses ModuleRef to lazily inject ClinicRateLimiterService to break circular dependency
    {
      provide: HealthcareDatabaseClient,
      useFactory: (
        moduleRef: ModuleRef,
        prismaService: PrismaService,
        metricsService: DatabaseMetricsService,
        clinicIsolationService: ClinicIsolationService,
        queryOptimizer: HealthcareQueryOptimizerService,
        readReplicaRouter: ReadReplicaRouterService,
        queryCacheService: QueryCacheService,
        healthMonitor: DatabaseHealthMonitorService,
        loggingService: LoggingService,
        eventService: EventService | undefined,
        connectionPoolManager: ConnectionPoolManager,
        rlsService: RowLevelSecurityService,
        dataMaskingService: DataMaskingService,
        sqlInjectionPrevention: SQLInjectionPreventionService,
        cacheService: CacheService | undefined,
        config: HealthcareDatabaseConfig
      ) => {
        try {
          // Pass ModuleRef to HealthcareDatabaseClient for lazy injection of ClinicRateLimiterService
          // This breaks the circular dependency by deferring ClinicRateLimiterService resolution
          return new HealthcareDatabaseClient(
            prismaService,
            metricsService,
            clinicIsolationService,
            queryOptimizer,
            readReplicaRouter,
            queryCacheService,
            healthMonitor,
            loggingService,
            eventService ?? ({} as EventService),
            connectionPoolManager,
            rlsService,
            dataMaskingService,
            sqlInjectionPrevention,
            cacheService,
            config,
            moduleRef // Pass ModuleRef for lazy injection of ClinicRateLimiterService
          );
        } catch (error: unknown) {
          // Log error for audit trail
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : String(error);
          void loggingService.log(
            LogType.DATABASE,
            LogLevel.ERROR,
            `Failed to initialize HealthcareDatabaseClient: ${errorMessage}`,
            'DatabaseModule',
            { error: errorStack }
          );
          // Re-throw to prevent invalid service instance
          throw error;
        }
      },
      inject: [
        ModuleRef, // Inject ModuleRef to lazily resolve ClinicRateLimiterService
        PrismaService,
        forwardRef(() => DatabaseMetricsService), // Use forwardRef to break circular dependency between factory providers
        ClinicIsolationService,
        HealthcareQueryOptimizerService,
        ReadReplicaRouterService,
        QueryCacheService,
        DatabaseHealthMonitorService,
        LoggingService,
        forwardRef(() => EventService),
        ConnectionPoolManager,
        RowLevelSecurityService,
        DataMaskingService,
        SQLInjectionPreventionService,
        CacheService,
        'HealthcareDatabaseConfig',
      ],
    },
    UserRepository, // @internal - infrastructure component, not exported
    SimplePatientRepository, // @internal - infrastructure component, not exported
  ] as Provider[],
  exports: [
    // SINGLE UNIFIED DATABASE SERVICE - This is the ONLY export
    // All database operations MUST go through DatabaseService (exported in index.ts)
    // It includes all optimization layers: connection pooling, caching, query optimization, metrics, HIPAA compliance
    // DO NOT export any other components - they are internal infrastructure
    HealthcareDatabaseClient, // Internal class - exported as "DatabaseService" in index.ts (ONLY PUBLIC INTERFACE)
    // Note: HealthcareDatabaseClient itself is NOT exported publicly - only DatabaseService alias is public
    ClinicIsolationService, // Export for GuardsModule - using forwardRef in GuardsModule to break circular dependency
  ],
})
export class DatabaseModule implements OnModuleInit {
  private readonly serviceName = 'DatabaseModule';
  private connectionPoolManager?: ConnectionPoolManager;
  private clinicIsolationService?: ClinicIsolationService;

  constructor(
    @Inject(forwardRef(() => ConfigService)) private configService: ConfigService,
    @Inject(forwardRef(() => LoggingService)) private loggingService: LoggingService,
    private moduleRef: ModuleRef
  ) {}

  async onModuleInit() {
    try {
      // Get services lazily to avoid circular dependency during module initialization
      this.connectionPoolManager = this.moduleRef.get(ConnectionPoolManager, { strict: false });
      this.clinicIsolationService = this.moduleRef.get(ClinicIsolationService, { strict: false });

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
      // Validate healthcare configuration
      const { validateHealthcareConfig } = await import('./config/healthcare.config');
      const healthcareConf =
        this.configService?.get<Record<string, unknown>>('healthcare') || undefined;
      if (healthcareConf) {
        validateHealthcareConfig(healthcareConf);
      }

      // Initialize clinic isolation service for full data separation
      if (this.clinicIsolationService) {
        await this.clinicIsolationService.initializeClinicCaching();
      }

      // Log initialization completion
      const poolMetrics = this.connectionPoolManager?.getMetrics();
      void this.loggingService.log(
        LogType.DATABASE,
        LogLevel.INFO,
        'Enhanced database components initialized successfully',
        this.serviceName
      );
      if (poolMetrics) {
        void this.loggingService.log(
          LogType.DATABASE,
          LogLevel.INFO,
          `Connection pool status: ${poolMetrics.totalConnections} connections, healthy: ${poolMetrics.isHealthy}`,
          this.serviceName
        );
      }

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
