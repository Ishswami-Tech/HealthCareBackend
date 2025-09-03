import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectionPoolManager } from '../connection-pool.manager';
import { DatabaseMetricsService } from '../database-metrics.service';
import { RepositoryResult } from '../types/repository-result';
import {
  IDatabaseClient,
  DatabaseHealthStatus,
  DatabaseClientMetrics,
  DatabaseClientConfig,
} from '../interfaces/database-client.interface';

/**
 * Base Database Client Implementation
 * 
 * Provides core database operations with:
 * - Connection pooling
 * - Metrics tracking
 * - Error handling with RepositoryResult
 * - Health monitoring
 * - Transaction support
 */
export class BaseDatabaseClient implements IDatabaseClient {
  protected readonly logger = new Logger(BaseDatabaseClient.name);
  
  constructor(
    protected readonly prismaService: PrismaService,
    protected readonly connectionPoolManager: ConnectionPoolManager,
    protected readonly metricsService: DatabaseMetricsService,
    protected readonly config: DatabaseClientConfig,
  ) {}

  /**
   * Get the underlying Prisma client
   */
  getPrismaClient(): PrismaClient {
    return this.prismaService;
  }

  /**
   * Execute a raw query with metrics and error handling
   */
  async executeRawQuery<T = any>(query: string, params: any[] = []): Promise<T> {
    const startTime = Date.now();
    
    try {
      const result = await this.connectionPoolManager.executeQuery<T>(
        query,
        params,
        { timeout: this.config.queryTimeout }
      );
      
      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution('RAW_QUERY', executionTime, true);
      
      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution('RAW_QUERY', executionTime, false);
      
      this.logger.error(`Raw query failed: ${error.message}`, {
        query: query.substring(0, 100),
        executionTime,
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Execute operation within a transaction
   */
  async executeInTransaction<T>(
    operation: (client: PrismaClient) => Promise<T>
  ): Promise<T> {
    const startTime = Date.now();
    
    try {
      const result = await this.prismaService.$transaction(operation, {
        maxWait: this.config.connectionTimeout || 10000,
        timeout: this.config.queryTimeout || 60000,
      });
      
      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution('TRANSACTION', executionTime, true);
      
      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution('TRANSACTION', executionTime, false);
      
      this.logger.error(`Transaction failed: ${error.message}`, {
        executionTime,
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Get connection health status
   */
  async getHealthStatus(): Promise<DatabaseHealthStatus> {
    try {
      const connectionMetrics = this.connectionPoolManager.getMetrics();
      const start = Date.now();
      
      // Test database connectivity
      await this.prismaService.$queryRaw`SELECT 1`;
      const responseTime = Date.now() - start;
      
      return {
        isHealthy: connectionMetrics.isHealthy && responseTime < 5000,
        connectionCount: connectionMetrics.totalConnections,
        activeQueries: connectionMetrics.activeConnections,
        avgResponseTime: responseTime,
        lastHealthCheck: new Date(),
        errors: connectionMetrics.isHealthy ? [] : ['Connection pool unhealthy']
      };
    } catch (error) {
      return {
        isHealthy: false,
        connectionCount: 0,
        activeQueries: 0,
        avgResponseTime: -1,
        lastHealthCheck: new Date(),
        errors: [error.message]
      };
    }
  }

  /**
   * Get client metrics
   */
  async getMetrics(): Promise<DatabaseClientMetrics> {
    const connectionMetrics = this.connectionPoolManager.getMetrics();
    const currentMetrics = this.metricsService.getCurrentMetrics();
    
    return {
      totalQueries: currentMetrics.performance.totalQueries,
      successfulQueries: currentMetrics.performance.successfulQueries,
      failedQueries: currentMetrics.performance.failedQueries,
      averageQueryTime: currentMetrics.performance.averageQueryTime,
      slowQueries: currentMetrics.performance.slowQueries,
      connectionPool: {
        total: connectionMetrics.totalConnections,
        active: connectionMetrics.activeConnections,
        idle: connectionMetrics.idleConnections,
        waiting: connectionMetrics.waitingConnections
      }
    };
  }

  /**
   * Close database connections
   */
  async disconnect(): Promise<void> {
    try {
      await this.prismaService.$disconnect();
      this.logger.log('Database client disconnected');
    } catch (error) {
      this.logger.error('Failed to disconnect database client:', error);
      throw error;
    }
  }

  /**
   * Execute operation with automatic result wrapping
   */
  protected async executeWithResult<T>(
    operation: () => Promise<T>,
    operationName: string,
    clinicId?: string,
    userId?: string
  ): Promise<RepositoryResult<T>> {
    const startTime = Date.now();
    
    try {
      const result = await operation();
      const executionTime = Date.now() - startTime;
      
      this.metricsService.recordQueryExecution(operationName, executionTime, true, clinicId, userId);
      
      return RepositoryResult.success(result, {
        executionTime,
        operation: operationName,
        clinicId,
        userId,
        timestamp: new Date()
      });
    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      this.metricsService.recordQueryExecution(operationName, executionTime, false, clinicId, userId);
      
      this.logger.error(`Operation ${operationName} failed:`, {
        error: error.message,
        executionTime,
        clinicId,
        userId
      });
      
      return RepositoryResult.failure(error, {
        executionTime,
        operation: operationName,
        clinicId,
        userId,
        timestamp: new Date()
      });
    }
  }

  /**
   * Execute query with automatic retry and circuit breaker
   */
  protected async executeQueryWithResilience<T>(
    query: () => Promise<T>,
    options: {
      operationName: string;
      maxRetries?: number;
      retryDelay?: number;
      clinicId?: string;
      userId?: string;
    }
  ): Promise<RepositoryResult<T>> {
    const { operationName, maxRetries = 3, retryDelay = 1000, clinicId, userId } = options;
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const result = await this.executeWithResult(
        query,
        `${operationName}_ATTEMPT_${attempt}`,
        clinicId,
        userId
      );
      
      if (result.isSuccess) {
        return result;
      }
      
      lastError = result.error as Error;
      
      if (attempt < maxRetries) {
        // Exponential backoff
        const delay = retryDelay * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        this.logger.warn(`Retrying ${operationName} after ${delay}ms (attempt ${attempt}/${maxRetries})`);
      }
    }
    
    return RepositoryResult.failure(lastError!, {
      operation: operationName,
      clinicId,
      userId,
      timestamp: new Date(),
      queryCount: maxRetries
    });
  }

  /**
   * Execute batch operations with concurrency control
   */
  protected async executeBatch<T, U>(
    items: T[],
    operation: (item: T, index: number) => Promise<U>,
    options: {
      concurrency?: number;
      operationName: string;
      clinicId?: string;
      userId?: string;
    }
  ): Promise<RepositoryResult<U[]>> {
    const { concurrency = 10, operationName, clinicId, userId } = options;
    const startTime = Date.now();
    
    try {
      const results: U[] = [];
      
      // Process in chunks to control concurrency
      for (let i = 0; i < items.length; i += concurrency) {
        const chunk = items.slice(i, i + concurrency);
        const chunkResults = await Promise.all(
          chunk.map((item, index) => operation(item, i + index))
        );
        results.push(...chunkResults);
      }
      
      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution(operationName, executionTime, true, clinicId, userId);
      
      return RepositoryResult.success(results, {
        executionTime,
        operation: operationName,
        queryCount: items.length,
        clinicId,
        userId,
        timestamp: new Date()
      });
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.metricsService.recordQueryExecution(operationName, executionTime, false, clinicId, userId);
      
      return RepositoryResult.failure(error, {
        executionTime,
        operation: operationName,
        queryCount: items.length,
        clinicId,
        userId,
        timestamp: new Date()
      });
    }
  }

  /**
   * Check if operation should be cached
   */
  protected shouldCache(operationName: string, options?: any): boolean {
    // Default caching strategy - can be overridden in subclasses
    const cacheableOperations = ['FIND', 'SEARCH', 'LIST', 'COUNT'];
    return cacheableOperations.some(op => operationName.includes(op));
  }

  /**
   * Generate cache key for operation
   */
  protected generateCacheKey(operationName: string, params: any): string {
    const paramsHash = JSON.stringify(params);
    return `${operationName}:${Buffer.from(paramsHash).toString('base64')}`;
  }
}