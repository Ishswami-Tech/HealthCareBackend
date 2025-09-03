import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseDatabaseClient } from './clients/base-database.client';
import { HealthcareDatabaseClient } from './clients/healthcare-database.client';
import { ClinicDatabaseClient } from './clients/clinic-database.client';
import { PrismaService } from './prisma/prisma.service';
import { ConnectionPoolManager } from './connection-pool.manager';
import { DatabaseMetricsService } from './database-metrics.service';
import { ClinicIsolationService } from './clinic-isolation.service';
import {
  IDatabaseClient,
  IHealthcareDatabaseClient,
  IClinicDatabaseClient,
  DatabaseClientOptions,
  DatabaseClientConfig,
  HealthcareDatabaseConfig,
  DatabaseClientType,
} from './interfaces/database-client.interface';

/**
 * Enterprise Database Client Factory
 * 
 * Handles creation and management of database clients for:
 * - Multi-tenant healthcare applications
 * - Clinic-specific data isolation
 * - High-volume operations (1M+ users)
 * - Connection pooling and load balancing
 * - HIPAA compliance and audit trails
 */
@Injectable()
export class DatabaseClientFactory implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseClientFactory.name);
  private readonly clients = new Map<string, IDatabaseClient>();
  private readonly clinicClients = new Map<string, IClinicDatabaseClient>();
  private healthCheckInterval?: NodeJS.Timeout;
  private readonly maxClients = 100; // Maximum concurrent database clients
  private readonly clientTimeout = 300000; // 5 minutes
  private cleanupInterval?: NodeJS.Timeout;

  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
    private readonly connectionPoolManager: ConnectionPoolManager,
    private readonly metricsService: DatabaseMetricsService,
    private readonly clinicIsolationService: ClinicIsolationService,
  ) {
    this.startHealthMonitoring();
    this.startCleanupProcess();
  }

  async onModuleInit() {
    this.logger.log('Database client factory initialized');
    await this.initializeDefaultClients();
  }

  async onModuleDestroy() {
    clearInterval(this.healthCheckInterval);
    clearInterval(this.cleanupInterval);
    await this.cleanupAllClients();
    this.logger.log('Database client factory destroyed');
  }

  /**
   * Create a database client based on type and configuration
   */
  async createClient(options: DatabaseClientOptions): Promise<IDatabaseClient> {
    const clientId = this.generateClientId(options);
    
    // Check if client already exists and is healthy
    const existingClient = this.clients.get(clientId);
    if (existingClient && await this.isClientHealthy(existingClient)) {
      this.logger.debug(`Reusing existing client: ${clientId}`);
      return existingClient;
    }

    // Check client limit
    if (this.clients.size >= this.maxClients) {
      this.logger.warn(`Client limit reached (${this.maxClients}), cleaning up inactive clients`);
      await this.cleanupInactiveClients();
    }

    // Create new client
    const client = await this.createNewClient(options);
    this.clients.set(clientId, client);
    
    this.logger.log(`Created new database client: ${clientId} (Total: ${this.clients.size})`);
    return client;
  }

  /**
   * Create a healthcare-specific database client
   */
  async createHealthcareClient(config: HealthcareDatabaseConfig): Promise<IHealthcareDatabaseClient> {
    const options: DatabaseClientOptions = {
      type: 'healthcare',
      config
    };
    
    const client = await this.createClient(options);
    return client as IHealthcareDatabaseClient;
  }

  /**
   * Create a clinic-specific database client with isolation
   */
  async createClinicClient(clinicId: string, config?: Partial<HealthcareDatabaseConfig>): Promise<IClinicDatabaseClient> {
    // Check if clinic client already exists
    const existingClient = this.clinicClients.get(clinicId);
    if (existingClient && await this.isClientHealthy(existingClient)) {
      return existingClient;
    }

    // Validate clinic access
    const clinicValidation = await this.clinicIsolationService.validateClinicAccess('system', clinicId);
    if (!clinicValidation.success) {
      throw new Error(`Invalid clinic access: ${clinicValidation.error}`);
    }

    const fullConfig: HealthcareDatabaseConfig = {
      connectionTimeout: this.configService.get<number>('DB_CONNECTION_TIMEOUT', 10000),
      queryTimeout: this.configService.get<number>('DB_QUERY_TIMEOUT', 60000),
      maxRetries: this.configService.get<number>('DB_MAX_RETRIES', 3),
      enableMetrics: true,
      enableCircuitBreaker: true,
      enableAuditLogging: this.configService.get<boolean>('HEALTHCARE_ENABLE_AUDIT_LOGGING', true),
      enablePHIProtection: this.configService.get<boolean>('HEALTHCARE_ENABLE_PHI_PROTECTION', true),
      auditRetentionDays: this.configService.get<number>('HEALTHCARE_AUDIT_RETENTION_DAYS', 2555),
      encryptionEnabled: this.configService.get<boolean>('HEALTHCARE_ENCRYPTION_ENABLED', true),
      complianceLevel: this.configService.get<string>('HEALTHCARE_COMPLIANCE_LEVEL', 'HIPAA'),
      ...config
    };

    const options: DatabaseClientOptions = {
      type: 'clinic',
      config: fullConfig,
      clinicId
    };

    const client = await this.createClient(options) as IClinicDatabaseClient;
    this.clinicClients.set(clinicId, client);
    
    this.logger.log(`Created clinic database client for clinic: ${clinicId}`);
    return client;
  }

  /**
   * Get or create a clinic client with caching
   */
  async getClinicClient(clinicId: string): Promise<IClinicDatabaseClient> {
    let client = this.clinicClients.get(clinicId);
    
    if (!client || !(await this.isClientHealthy(client))) {
      client = await this.createClinicClient(clinicId);
    }
    
    return client;
  }

  /**
   * Create multiple clinic clients for batch operations
   */
  createClinicClientsBatch(clinicIds: string[]): Map<string, IClinicDatabaseClient> {
    const clients = new Map<string, IClinicDatabaseClient>();

    for (const clinicId of clinicIds) {
      // Create client synchronously for batch
      const client = this.createClinicClientInstance(clinicId, {
        enableAuditLogging: true,
        enablePHIProtection: true,
        auditRetentionDays: 2555,
        encryptionEnabled: true,
        complianceLevel: 'HIPAA'
      });
      clients.set(clinicId, client);
    }

    this.logger.debug(`Created ${clients.size} clinic clients for batch operations`);
    return clients;
  }

  /**
   * Cleanup all database clients
   */
  async cleanup(): Promise<void> {
    await this.cleanupAllClients();
  }

  /**
   * Execute operation with automatic clinic context
   */
  async executeWithClinicContext<T>(
    clinicId: string,
    operation: (client: IClinicDatabaseClient) => Promise<T>
  ): Promise<T> {
    const client = await this.getClinicClient(clinicId);
    
    try {
      // Set clinic context for isolation
      this.clinicIsolationService.setCurrentClinicContext(clinicId);
      
      // Execute operation
      const result = await operation(client);
      
      return result;
    } finally {
      // Always clear context
      this.clinicIsolationService.clearClinicContext();
    }
  }

  /**
   * Get factory statistics and health status
   */
  getFactoryStats(): {
    totalClients: number;
    clinicClients: number;
    activeClients: number;
    connectionPoolStatus: any;
    memoryUsage: any;
  } {
    const activeClients = Array.from(this.clients.values()).filter(client => 
      client.getHealthStatus && client.getHealthStatus().then(status => status.isHealthy).catch(() => false)
    ).length;

    return {
      totalClients: this.clients.size,
      clinicClients: this.clinicClients.size,
      activeClients,
      connectionPoolStatus: this.connectionPoolManager.getMetrics(),
      memoryUsage: process.memoryUsage()
    };
  }

  /**
   * Health check for all clients
   */
  async performHealthCheck(): Promise<{
    healthy: boolean;
    totalClients: number;
    healthyClients: number;
    issues: string[];
  }> {
    const issues: string[] = [];
    let healthyClients = 0;
    const totalClients = this.clients.size;

    for (const [clientId, client] of this.clients) {
      try {
        const healthStatus = await client.getHealthStatus();
        if (healthStatus.isHealthy) {
          healthyClients++;
        } else {
          issues.push(`Client ${clientId}: ${healthStatus.errors.join(', ')}`);
        }
      } catch (error) {
        issues.push(`Client ${clientId}: Health check failed - ${error.message}`);
      }
    }

    const healthy = healthyClients === totalClients && issues.length === 0;
    
    if (!healthy) {
      this.logger.warn(`Health check issues: ${issues.join('; ')}`);
    }

    return {
      healthy,
      totalClients,
      healthyClients,
      issues
    };
  }

  // Private methods

  private async initializeDefaultClients(): Promise<void> {
    try {
      // Create default healthcare client
      const defaultConfig: HealthcareDatabaseConfig = {
        connectionTimeout: this.configService.get<number>('DB_CONNECTION_TIMEOUT', 10000),
        queryTimeout: this.configService.get<number>('DB_QUERY_TIMEOUT', 60000),
        maxRetries: this.configService.get<number>('DB_MAX_RETRIES', 3),
        enableMetrics: true,
        enableCircuitBreaker: true,
        enableAuditLogging: this.configService.get<boolean>('HEALTHCARE_ENABLE_AUDIT_LOGGING', true),
        enablePHIProtection: this.configService.get<boolean>('HEALTHCARE_ENABLE_PHI_PROTECTION', true),
        auditRetentionDays: this.configService.get<number>('HEALTHCARE_AUDIT_RETENTION_DAYS', 2555),
        encryptionEnabled: this.configService.get<boolean>('HEALTHCARE_ENCRYPTION_ENABLED', true),
        complianceLevel: this.configService.get<string>('HEALTHCARE_COMPLIANCE_LEVEL', 'HIPAA'),
      };

      await this.createHealthcareClient(defaultConfig);
      this.logger.log('Default healthcare database client initialized');
      
    } catch (error) {
      this.logger.error('Failed to initialize default clients:', error);
      throw error;
    }
  }

  private async createNewClient(options: DatabaseClientOptions): Promise<IDatabaseClient> {
    const { type, config } = options;
    
    switch (type) {
      case 'base':
        return this.createBaseClientInstance(config as DatabaseClientConfig);
      case 'healthcare':
        return this.createHealthcareClientInstance(config as HealthcareDatabaseConfig);
      case 'clinic':
        return this.createClinicClientInstance(options.clinicId!, config as HealthcareDatabaseConfig);
      default:
        throw new Error(`Unknown client type: ${type}`);
    }
  }

  private createBaseClientInstance(config: DatabaseClientConfig): BaseDatabaseClient {
    return new BaseDatabaseClient(
      this.prismaService,
      this.connectionPoolManager,
      this.metricsService,
      config,
    );
  }

  private createHealthcareClientInstance(config: HealthcareDatabaseConfig): HealthcareDatabaseClient {
    return new HealthcareDatabaseClient(
      this.prismaService,
      this.connectionPoolManager,
      this.metricsService,
      config,
    );
  }

  private createClinicClientInstance(clinicId: string, config: HealthcareDatabaseConfig): ClinicDatabaseClient {
    return new ClinicDatabaseClient(
      this.prismaService,
      this.connectionPoolManager,
      this.metricsService,
      config,
      this.clinicIsolationService,
      clinicId,
    );
  }

  private generateClientId(options: DatabaseClientOptions): string {
    const { type, config, clinicId } = options;
    const timestamp = Date.now();
    
    if (type === 'clinic' && clinicId) {
      return `clinic_${clinicId}_${timestamp}`;
    }
    
    if (type === 'healthcare') {
      return `healthcare_${timestamp}`;
    }
    
    return `base_${timestamp}`;
  }

  private async isClientHealthy(client: IDatabaseClient): Promise<boolean> {
    try {
      const healthStatus = await client.getHealthStatus();
      return healthStatus.isHealthy;
    } catch {
      return false;
    }
  }

  private async cleanupInactiveClients(): Promise<void> {
    const now = Date.now();
    const clientsToRemove: string[] = [];

    for (const [clientId, client] of this.clients) {
      try {
        const healthStatus = await client.getHealthStatus();
        if (!healthStatus.isHealthy) {
          clientsToRemove.push(clientId);
        }
      } catch {
        clientsToRemove.push(clientId);
      }
    }

    for (const clientId of clientsToRemove) {
      const client = this.clients.get(clientId);
      if (client) {
        try {
          await client.disconnect();
        } catch (error) {
          this.logger.warn(`Error disconnecting client ${clientId}:`, error);
        }
        this.clients.delete(clientId);
      }
    }

    if (clientsToRemove.length > 0) {
      this.logger.log(`Cleaned up ${clientsToRemove.length} inactive clients`);
    }
  }

  private async cleanupAllClients(): Promise<void> {
    for (const [clientId, client] of this.clients) {
      try {
        await client.disconnect();
        this.logger.debug(`Disconnected client: ${clientId}`);
      } catch (error) {
        this.logger.warn(`Error disconnecting client ${clientId}:`, error);
      }
    }
    
    this.clients.clear();
    this.clinicClients.clear();
  }

  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        this.logger.error('Health monitoring failed:', error);
      }
    }, 60000); // Every minute
  }

  private startCleanupProcess(): void {
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.cleanupInactiveClients();
      } catch (error) {
        this.logger.error('Cleanup process failed:', error);
      }
    }, 300000); // Every 5 minutes
  }

  private async logAuditTrail(auditInfo: any, operation: string, success: boolean): Promise<void> {
    try {
      // Log to audit system
      this.logger.log(`AUDIT: ${operation} - User: ${auditInfo.userId}, Clinic: ${auditInfo.clinicId}, Success: ${success}`);
    } catch (error) {
      this.logger.error('Failed to log audit trail:', error);
    }
  }
}
