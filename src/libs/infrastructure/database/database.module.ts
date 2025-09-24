import { Module, Global, OnModuleInit, Logger } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import * as path from "path";
import * as fs from "fs";
import { PrismaModule } from "./prisma/prisma.module";
import { initDatabase } from "./scripts/init-db";
import { healthcareConfig } from "./config/healthcare.config";
import { ConnectionPoolManager } from "./connection-pool.manager";
import { HealthcareQueryOptimizerService } from "./query-optimizer.service";
import { UserRepository } from "./repositories/user.repository";
import { ClinicIsolationService } from "./clinic-isolation.service";
import { SimplePatientRepository } from "./repositories/simple-patient.repository";
import { DatabaseMetricsService } from "./database-metrics.service";
import { DatabaseClientFactory } from "./database-client.factory";
import { HealthcareDatabaseClient } from "./clients/healthcare-database.client";

@Global()
@Module({
  imports: [PrismaModule, ConfigModule.forFeature(healthcareConfig)],
  providers: [
    ConnectionPoolManager,
    HealthcareQueryOptimizerService,
    UserRepository,
    ClinicIsolationService,
    SimplePatientRepository,
    DatabaseMetricsService,
    DatabaseClientFactory,
    {
      provide: "HealthcareDatabaseConfig",
      useValue: {
        enableAuditLogging: true,
        enablePHIProtection: true,
        auditRetentionDays: 2555, // 7 years for HIPAA compliance
        encryptionEnabled: true,
        complianceLevel: "HIPAA",
        connectionTimeout: 30000,
        queryTimeout: 15000,
        maxConnections: 50,
        healthCheckInterval: 30000,
      },
    },
    HealthcareDatabaseClient,
  ],
  exports: [
    PrismaModule,
    ConnectionPoolManager,
    HealthcareQueryOptimizerService,
    UserRepository,
    ClinicIsolationService,
    SimplePatientRepository,
    DatabaseMetricsService,
    DatabaseClientFactory,
    HealthcareDatabaseClient,
  ],
})
export class DatabaseModule implements OnModuleInit {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(
    private configService: ConfigService,
    private connectionPoolManager: ConnectionPoolManager,
    private clinicIsolationService: ClinicIsolationService,
  ) {}

  async onModuleInit() {
    try {
      // Determine environment
      const isProduction = process.env.NODE_ENV === "production";
      const isDocker = fs.existsSync("/.dockerenv");
      const isWindows = process.platform === "win32";

      // Get schema path from environment
      const originalSchemaPath =
        this.configService.get<string>("PRISMA_SCHEMA_PATH");
      let resolvedSchemaPath = originalSchemaPath;

      this.logger.log(`Original schema path: ${originalSchemaPath}`);
      this.logger.log(
        `Environment: ${isProduction ? "Production" : "Development"}, Docker: ${isDocker}, Windows: ${isWindows}`,
      );

      // Handle different path formats based on environment
      if (originalSchemaPath) {
        if (originalSchemaPath.startsWith("./")) {
          // Relative path - resolve from current working directory
          resolvedSchemaPath = path.resolve(
            process.cwd(),
            originalSchemaPath.substring(2),
          );
        } else if (
          originalSchemaPath.startsWith("/app/") &&
          isWindows &&
          !isDocker
        ) {
          // Docker path on Windows local development
          resolvedSchemaPath = path.resolve(
            process.cwd(),
            originalSchemaPath.replace("/app/", ""),
          );
        } else if (originalSchemaPath.includes("C:/Program Files/Git/app/")) {
          // Incorrectly resolved Git path on Windows
          resolvedSchemaPath = path.resolve(
            process.cwd(),
            originalSchemaPath.replace("C:/Program Files/Git/app/", ""),
          );
        }
      } else {
        // Default fallback paths
        if (isDocker) {
          resolvedSchemaPath =
            "/app/src/libs/infrastructure/database/prisma/schema.prisma";
        } else {
          resolvedSchemaPath = path.resolve(
            process.cwd(),
            "src/libs/infrastructure/database/prisma/schema.prisma",
          );
        }
      }

      // Make sure the path actually exists
      if (resolvedSchemaPath && !fs.existsSync(resolvedSchemaPath)) {
        this.logger.warn(
          `Resolved schema path ${resolvedSchemaPath} does not exist, trying to find alternatives...`,
        );

        // Try some alternative paths
        const alternatives = [
          path.resolve(
            process.cwd(),
            "src/libs/infrastructure/database/prisma/schema.prisma",
          ),
          path.resolve(
            process.cwd(),
            "dist/shared/database/prisma/schema.prisma",
          ),
          path.resolve(__dirname, "../prisma/schema.prisma"),
          isDocker
            ? "/app/src/libs/infrastructure/database/prisma/schema.prisma"
            : null,
          isDocker ? "/app/dist/shared/database/prisma/schema.prisma" : null,
        ].filter(Boolean);

        for (const alt of alternatives) {
          if (alt && fs.existsSync(alt)) {
            resolvedSchemaPath = alt;
            this.logger.log(`Found alternative schema path: ${alt}`);
            break;
          }
        }
      }

      this.logger.log(`Using schema path: ${resolvedSchemaPath}`);

      // Update environment variable for other services to use
      process.env.PRISMA_SCHEMA_PATH = resolvedSchemaPath;

      // Initialize the database
      await initDatabase();
      this.logger.log("Database initialization completed successfully");

      // Initialize enhanced database components
      await this.initializeEnhancedComponents();
    } catch (error) {
      this.logger.error(
        `Failed to initialize database module: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
  }

  private async initializeEnhancedComponents() {
    try {
      // Validate healthcare configuration
      const { validateHealthcareConfig } = await import(
        "./config/healthcare.config"
      );
      const healthcareConf = this.configService.get("healthcare");
      validateHealthcareConfig(healthcareConf);

      // Initialize clinic isolation service for full data separation
      await this.clinicIsolationService.initializeClinicCaching();

      // Log initialization completion
      const poolMetrics = this.connectionPoolManager.getMetrics();
      this.logger.log(`Enhanced database components initialized successfully`);
      this.logger.log(
        `Connection pool status: ${poolMetrics.totalConnections} connections, healthy: ${poolMetrics.isHealthy}`,
      );

      // Log healthcare-specific configuration
      this.logger.log(
        `Multi-clinic support enabled: ${healthcareConf?.multiClinic?.enabled}`,
      );
      this.logger.log(
        `HIPAA compliance enabled: ${healthcareConf?.hipaa?.enabled}`,
      );
      this.logger.log(
        `Maximum clinics per app: ${healthcareConf?.multiClinic?.maxClinicsPerApp}`,
      );
      this.logger.log(
        `Maximum locations per clinic: ${healthcareConf?.multiClinic?.maxLocationsPerClinic}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to initialize enhanced database components: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
