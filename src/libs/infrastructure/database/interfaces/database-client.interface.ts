import { PrismaClient } from '@prisma/client';

/**
 * Base database client interface for enterprise database operations
 */
export interface IDatabaseClient {
  /**
   * Get the underlying Prisma client
   */
  getPrismaClient(): PrismaClient;

  /**
   * Execute a raw query
   */
  executeRawQuery<T = any>(query: string, params?: any[]): Promise<T>;

  /**
   * Execute query within a transaction
   */
  executeInTransaction<T>(operation: (client: PrismaClient) => Promise<T>): Promise<T>;

  /**
   * Get connection health status
   */
  getHealthStatus(): Promise<DatabaseHealthStatus>;

  /**
   * Get client metrics
   */
  getMetrics(): Promise<DatabaseClientMetrics>;

  /**
   * Close database connections
   */
  disconnect(): Promise<void>;
}

/**
 * Healthcare-specific database client interface
 */
export interface IHealthcareDatabaseClient extends IDatabaseClient {
  /**
   * Execute healthcare-specific read operations with HIPAA compliance
   */
  executeHealthcareRead<T>(operation: (client: PrismaClient) => Promise<T>): Promise<T>;

  /**
   * Execute healthcare-specific write operations with audit trails
   */
  executeHealthcareWrite<T>(
    operation: (client: PrismaClient) => Promise<T>,
    auditInfo: AuditInfo
  ): Promise<T>;

  /**
   * Execute critical healthcare operations (emergency scenarios)
   */
  executeCriticalOperation<T>(
    operation: (client: PrismaClient) => Promise<T>,
    priority: CriticalPriority
  ): Promise<T>;

  /**
   * Get HIPAA compliance metrics
   */
  getHIPAAMetrics(): Promise<HIPAAComplianceMetrics>;
}

/**
 * Clinic-specific database client interface
 */
export interface IClinicDatabaseClient extends IHealthcareDatabaseClient {
  /**
   * Get the clinic ID this client is associated with
   */
  getClinicId(): string;

  /**
   * Execute operation with clinic isolation context
   */
  executeWithClinicContext<T>(operation: (client: PrismaClient) => Promise<T>): Promise<T>;

  /**
   * Get clinic-specific metrics
   */
  getClinicMetrics(): Promise<ClinicDatabaseMetrics>;

  /**
   * Get clinic dashboard statistics
   */
  getClinicDashboardStats(): Promise<any>;

  /**
   * Get clinic patients with pagination and filtering
   */
  getClinicPatients(options?: any): Promise<any>;

  /**
   * Get clinic appointments with advanced filtering
   */
  getClinicAppointments(options?: any): Promise<any>;

  /**
   * Execute clinic patient operation with validation
   */
  executeClinicPatientOperation<T>(
    patientId: string,
    userId: string,
    operation: (client: PrismaClient) => Promise<T>,
    operationType: string
  ): Promise<any>;
}

/**
 * Database health status
 */
export interface DatabaseHealthStatus {
  isHealthy: boolean;
  connectionCount: number;
  activeQueries: number;
  avgResponseTime: number;
  lastHealthCheck: Date;
  errors: string[];
}

/**
 * Database client metrics
 */
export interface DatabaseClientMetrics {
  totalQueries: number;
  successfulQueries: number;
  failedQueries: number;
  averageQueryTime: number;
  slowQueries: number;
  connectionPool: {
    total: number;
    active: number;
    idle: number;
    waiting: number;
  };
}

/**
 * HIPAA compliance metrics
 */
export interface HIPAAComplianceMetrics {
  auditedOperations: number;
  encryptedDataAccess: number;
  unauthorizedAttempts: number;
  dataRetentionCompliance: boolean;
  lastComplianceCheck: Date;
}

/**
 * Clinic-specific database metrics
 */
export interface ClinicDatabaseMetrics extends DatabaseClientMetrics {
  clinicId: string;
  clinicName: string;
  patientCount: number;
  appointmentCount: number;
  staffCount: number;
  locationCount: number;
}

/**
 * Audit information for healthcare operations
 */
export interface AuditInfo {
  userId: string;
  userRole: string;
  operation: string;
  resourceType: string;
  resourceId?: string;
  clinicId: string;
  timestamp: Date;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Critical operation priority levels
 */
export enum CriticalPriority {
  EMERGENCY = 'EMERGENCY',
  URGENT = 'URGENT',
  HIGH = 'HIGH',
  NORMAL = 'NORMAL'
}

/**
 * Database client types
 */
export enum DatabaseClientType {
  BASE = 'base',
  HEALTHCARE = 'healthcare',
  CLINIC = 'clinic',
}

/**
 * Database client configuration
 */
export interface DatabaseClientConfig {
  connectionTimeout?: number;
  queryTimeout?: number;
  maxRetries?: number;
  enableMetrics?: boolean;
  enableCircuitBreaker?: boolean;
}

/**
 * Healthcare-specific database configuration
 */
export interface HealthcareDatabaseConfig extends DatabaseClientConfig {
  enableAuditLogging?: boolean;
  enablePHIProtection?: boolean;
  auditRetentionDays?: number;
  encryptionEnabled?: boolean;
  complianceLevel?: string;
}

/**
 * Database client creation options
 */
export interface DatabaseClientOptions {
  type: 'base' | 'healthcare' | 'clinic';
  config: DatabaseClientConfig | HealthcareDatabaseConfig;
  clinicId?: string;
}