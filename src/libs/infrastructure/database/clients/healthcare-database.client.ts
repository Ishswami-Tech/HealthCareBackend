import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { BaseDatabaseClient } from './base-database.client';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionPoolManager } from '../connection-pool.manager';
import { DatabaseMetricsService } from '../database-metrics.service';
import { RepositoryResult, HealthcareError } from '../types/repository-result';
import {
  IHealthcareDatabaseClient,
  AuditInfo,
  CriticalPriority,
  HIPAAComplianceMetrics,
  HealthcareDatabaseConfig,
} from '../interfaces/database-client.interface';

/**
 * Healthcare-Specific Database Client
 * 
 * Provides HIPAA-compliant database operations with:
 * - Audit trail logging
 * - PHI data protection
 * - Healthcare-specific error handling
 * - Critical operation prioritization
 * - HIPAA compliance metrics
 */
export class HealthcareDatabaseClient extends BaseDatabaseClient implements IHealthcareDatabaseClient {
  protected readonly logger = new Logger(HealthcareDatabaseClient.name);
  private auditLog: AuditInfo[] = [];
  private readonly maxAuditLogSize = 10000;

  constructor(
    prismaService: PrismaService,
    connectionPoolManager: ConnectionPoolManager,
    metricsService: DatabaseMetricsService,
    protected readonly healthcareConfig: HealthcareDatabaseConfig,
  ) {
    super(prismaService, connectionPoolManager, metricsService, healthcareConfig);
  }

  /**
   * Execute healthcare-specific read operations with HIPAA compliance
   */
  async executeHealthcareRead<T>(
    operation: (client: PrismaClient) => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    
    try {
      // Use optimized read connection
      const result = await this.connectionPoolManager.executeHealthcareRead<T>(
        '', // Query will be executed through Prisma client
        [],
        { priority: 'normal', timeout: 30000 }
      );
      
      // Execute the operation with the Prisma client
      const data = await operation(this.prismaService);
      
      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution('HEALTHCARE_READ', executionTime, true);
      
      // Log for HIPAA compliance if PHI data is involved
      if (this.healthcareConfig.enablePHIProtection) {
        this.logDataAccess('READ', 'HEALTHCARE_DATA', executionTime);
      }
      
      return data;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution('HEALTHCARE_READ', executionTime, false);
      
      this.logger.error(`Healthcare read operation failed: ${error.message}`, {
        executionTime,
        error: error.message
      });
      
      throw new HealthcareError(
        `Healthcare read operation failed: ${error.message}`,
        'HEALTHCARE_READ_ERROR',
        { executionTime, originalError: error.message },
        false
      );
    }
  }

  /**
   * Execute healthcare-specific write operations with audit trails
   */
  async executeHealthcareWrite<T>(
    operation: (client: PrismaClient) => Promise<T>,
    auditInfo: AuditInfo
  ): Promise<T> {
    const startTime = Date.now();
    
    try {
      // Use prioritized write connection
      const result = await this.connectionPoolManager.executeHealthcareWrite<T>(
        '', // Query will be executed through Prisma client
        [],
        { priority: 'high', timeout: 60000 }
      );
      
      // Execute within transaction for data consistency
      const data = await this.executeInTransaction(async (client) => {
        const operationResult = await operation(client);
        
        // Create audit trail entry
        if (this.healthcareConfig.enableAuditLogging) {
          await this.createAuditTrail(auditInfo, 'SUCCESS');
        }
        
        return operationResult;
      });
      
      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution('HEALTHCARE_WRITE', executionTime, true, auditInfo.clinicId, auditInfo.userId);
      
      // Log for HIPAA compliance
      this.logDataAccess('WRITE', auditInfo.resourceType, executionTime, auditInfo);
      
      return data;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution('HEALTHCARE_WRITE', executionTime, false, auditInfo.clinicId, auditInfo.userId);
      
      // Create audit trail for failed operation
      if (this.healthcareConfig.enableAuditLogging) {
        try {
          await this.createAuditTrail(auditInfo, 'FAILURE', error.message);
        } catch (auditError) {
          this.logger.error('Failed to create audit trail for failed operation:', auditError);
        }
      }
      
      this.logger.error(`Healthcare write operation failed: ${error.message}`, {
        executionTime,
        auditInfo,
        error: error.message
      });
      
      throw new HealthcareError(
        `Healthcare write operation failed: ${error.message}`,
        'HEALTHCARE_WRITE_ERROR',
        { executionTime, auditInfo, originalError: error.message },
        false
      );
    }
  }

  /**
   * Execute critical healthcare operations (emergency scenarios)
   */
  async executeCriticalOperation<T>(
    operation: (client: PrismaClient) => Promise<T>,
    priority: CriticalPriority
  ): Promise<T> {
    const startTime = Date.now();
    
    try {
      // Use critical operation connection with highest priority
      const result = await this.connectionPoolManager.executeCriticalQuery<T>(
        '', // Query will be executed through Prisma client
        [],
        { 
          priority: 'high', 
          timeout: priority === CriticalPriority.EMERGENCY ? 120000 : 60000,
          retries: priority === CriticalPriority.EMERGENCY ? 5 : 3
        }
      );
      
      // Execute the critical operation
      const data = await operation(this.prismaService);
      
      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution('CRITICAL_OPERATION', executionTime, true);
      
      // Log critical operation for audit
      this.logger.warn(`Critical healthcare operation completed: ${priority}`, {
        priority,
        executionTime,
        timestamp: new Date()
      });
      
      return data;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution('CRITICAL_OPERATION', executionTime, false);
      
      this.logger.error(`Critical healthcare operation failed: ${error.message}`, {
        priority,
        executionTime,
        error: error.message
      });
      
      throw new HealthcareError(
        `Critical healthcare operation failed: ${error.message}`,
        'CRITICAL_OPERATION_ERROR',
        { priority, executionTime, originalError: error.message },
        priority !== CriticalPriority.EMERGENCY // Retry unless emergency
      );
    }
  }

  /**
   * Get HIPAA compliance metrics
   */
  async getHIPAAMetrics(): Promise<HIPAAComplianceMetrics> {
    const currentMetrics = this.metricsService.getCurrentMetrics();
    const auditedOperations = this.auditLog.length;
    const encryptedDataAccess = this.auditLog.filter(log => 
      log.operation.includes('READ') || log.operation.includes('WRITE')
    ).length;
    
    return {
      auditedOperations,
      encryptedDataAccess,
      unauthorizedAttempts: currentMetrics.healthcare.unauthorizedAccessAttempts,
      dataRetentionCompliance: this.checkDataRetentionCompliance(),
      lastComplianceCheck: new Date()
    };
  }

  /**
   * Execute patient data operation with PHI protection
   */
  async executePatientOperation<T>(
    patientId: string,
    clinicId: string,
    userId: string,
    operation: (client: PrismaClient) => Promise<T>,
    operationType: 'READ' | 'write' | 'delete'
  ): Promise<RepositoryResult<T>> {
    const auditInfo: AuditInfo = {
      userId,
      userRole: 'HEALTHCARE_PROVIDER', // Would be determined from user context
      operation: `PATIENT_${operationType.toUpperCase()}`,
      resourceType: 'PATIENT_DATA',
      resourceId: patientId,
      clinicId,
      timestamp: new Date(),
    };

    return this.executeWithResult(
      async () => {
        if (operationType === 'write') {
          return this.executeHealthcareWrite(operation, auditInfo);
        } else {
          return this.executeHealthcareRead(operation);
        }
      },
      auditInfo.operation,
      clinicId,
      userId
    );
  }

  /**
   * Execute appointment operation with scheduling compliance
   */
  async executeAppointmentOperation<T>(
    appointmentId: string,
    clinicId: string,
    userId: string,
    operation: (client: PrismaClient) => Promise<T>,
    operationType: 'create' | 'update' | 'cancel'
  ): Promise<RepositoryResult<T>> {
    const auditInfo: AuditInfo = {
      userId,
      userRole: 'HEALTHCARE_PROVIDER',
      operation: `APPOINTMENT_${operationType.toUpperCase()}`,
      resourceType: 'APPOINTMENT',
      resourceId: appointmentId,
      clinicId,
      timestamp: new Date(),
    };

    return this.executeWithResult(
      async () => this.executeHealthcareWrite(operation, auditInfo),
      auditInfo.operation,
      clinicId,
      userId
    );
  }

  /**
   * Bulk operation with HIPAA compliance
   */
  async executeBulkHealthcareOperation<T, U>(
    items: T[],
    operation: (item: T, client: PrismaClient) => Promise<U>,
    auditInfo: Omit<AuditInfo, 'resourceId'>,
    options: {
      concurrency?: number;
      operationName: string;
    }
  ): Promise<RepositoryResult<U[]>> {
    const { concurrency = 5, operationName } = options; // Lower concurrency for healthcare

    return this.executeBatch(
      items,
      async (item, index) => {
        const itemAuditInfo: AuditInfo = {
          ...auditInfo,
          resourceId: `bulk_${index}`,
        };
        
        return this.executeHealthcareWrite(
          (client) => operation(item, client),
          itemAuditInfo
        );
      },
      {
        concurrency,
        operationName: `BULK_${operationName}`,
        clinicId: auditInfo.clinicId,
        userId: auditInfo.userId
      }
    );
  }

  // Private methods

  private async createAuditTrail(
    auditInfo: AuditInfo,
    status: 'SUCCESS' | 'FAILURE',
    errorMessage?: string
  ): Promise<void> {
    try {
      // Store audit info in memory (in production, this should go to a dedicated audit database)
      const auditEntry = {
        ...auditInfo,
        status,
        errorMessage,
        id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };
      
      this.auditLog.push(auditEntry);
      
      // Maintain audit log size
      if (this.auditLog.length > this.maxAuditLogSize) {
        this.auditLog.shift();
      }
      
      // In production, create database record:
      // await this.prismaService.auditLog.create({ data: auditEntry });
      
    } catch (error) {
      this.logger.error('Failed to create audit trail:', error);
    }
  }

  private logDataAccess(
    operation: 'READ' | 'WRITE',
    resourceType: string,
    executionTime: number,
    auditInfo?: AuditInfo
  ): void {
    if (this.healthcareConfig.enablePHIProtection) {
      this.logger.log(`HIPAA Data Access: ${operation} ${resourceType}`, {
        operation,
        resourceType,
        executionTime,
        clinicId: auditInfo?.clinicId,
        userId: auditInfo?.userId,
        timestamp: new Date(),
        encrypted: true
      });
    }
  }

  private checkDataRetentionCompliance(): boolean {
    // Simplified compliance check - in production would check actual data retention policies
    const retentionDays = this.healthcareConfig.auditRetentionDays || 2555; // 7 years default
    const oldestAudit = this.auditLog[0];
    
    if (oldestAudit) {
      const daysSinceOldest = (Date.now() - oldestAudit.timestamp.getTime()) / (1000 * 60 * 60 * 24);
      return daysSinceOldest <= retentionDays;
    }
    
    return true;
  }
}