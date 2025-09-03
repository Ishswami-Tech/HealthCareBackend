import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface QueryOptimizationConfig {
  enableBatching: boolean;
  batchSize: number;
  batchTimeout: number;
  enableCaching: boolean;
  cacheTTL: number;
  enableQueryLogging: boolean;
  slowQueryThreshold: number;
  enableReadOptimization: boolean;
  maxConcurrentQueries: number;
}

export interface QueryCacheEntry {
  result: any;
  timestamp: number;
  ttl: number;
  hits: number;
}

export interface BatchQueueItem {
  operation: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  operationName: string;
  cacheKey?: string;
}

export interface OptimizedQueryOptions {
  operationName?: string;
  cacheKey?: string;
  bypassCache?: boolean;
  batchable?: boolean;
  readOnly?: boolean;
  priority?: 'low' | 'normal' | 'high';
}

@Injectable()
export class HealthcareQueryOptimizerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HealthcareQueryOptimizerService.name);
  
  private readonly config: QueryOptimizationConfig;
  private readonly queryCache = new Map<string, QueryCacheEntry>();
  private readonly batchQueue: BatchQueueItem[] = [];
  private readonly priorityQueues = {
    high: [] as BatchQueueItem[],
    normal: [] as BatchQueueItem[],
    low: [] as BatchQueueItem[]
  };
  
  private batchTimer?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;
  private activeQueries = 0;

  constructor(private readonly configService: ConfigService) {
    this.config = {
      enableBatching: this.configService.get('HEALTHCARE_DB_ENABLE_BATCHING', true),
      batchSize: this.configService.get('HEALTHCARE_DB_BATCH_SIZE', 50),
      batchTimeout: this.configService.get('HEALTHCARE_DB_BATCH_TIMEOUT', 100), // 100ms
      enableCaching: this.configService.get('HEALTHCARE_DB_ENABLE_CACHING', true),
      cacheTTL: this.configService.get('HEALTHCARE_DB_CACHE_TTL', 300000), // 5 minutes
      enableQueryLogging: this.configService.get('HEALTHCARE_DB_ENABLE_QUERY_LOGGING', false),
      slowQueryThreshold: this.configService.get('HEALTHCARE_DB_SLOW_QUERY_THRESHOLD', 1000), // 1 second
      enableReadOptimization: this.configService.get('HEALTHCARE_DB_ENABLE_READ_OPTIMIZATION', true),
      maxConcurrentQueries: this.configService.get('HEALTHCARE_DB_MAX_CONCURRENT_QUERIES', 10)
    };
  }

  async onModuleInit() {
    this.startCacheCleanup();
    this.logger.log('Healthcare Query Optimizer Service initialized');
  }

  async onModuleDestroy() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    // Process any remaining batches
    await this.processPriorityBatches();
    this.logger.log('Healthcare Query Optimizer Service destroyed');
  }

  /**
   * Execute optimized healthcare query with caching and batching
   */
  async executeOptimized<T>(
    operation: () => Promise<T>,
    options: OptimizedQueryOptions = {}
  ): Promise<T> {
    const operationName = options.operationName || 'healthcare_operation';
    const cacheKey = options.cacheKey || this.generateCacheKey(operationName);
    const priority = options.priority || 'normal';

    // Try cache first for read operations
    if (this.config.enableCaching && !options.bypassCache && options.readOnly && cacheKey) {
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        this.logger.debug(`Cache hit for healthcare operation: ${operationName}`);
        return cached as T;
      }
    }

    // Check concurrent query limit
    if (this.activeQueries >= this.config.maxConcurrentQueries && priority !== 'high') {
      this.logger.warn(`Query queue full, queueing ${operationName}`);
      return this.queueForExecution(operation, options);
    }

    // Execute with batching if enabled and batchable
    if (this.config.enableBatching && options.batchable !== false && priority !== 'high') {
      return this.executeBatched(operation, operationName, cacheKey, priority);
    }

    // Execute directly for high priority or non-batchable operations
    return this.executeDirectly(operation, operationName, cacheKey, options.readOnly);
  }

  /**
   * Optimize healthcare-specific read operations
   */
  async executeHealthcareRead<T>(
    operation: () => Promise<T>,
    operationName: string,
    cacheKey?: string,
    priority: 'low' | 'normal' | 'high' = 'normal'
  ): Promise<T> {
    return this.executeOptimized(operation, {
      operationName: `read:${operationName}`,
      cacheKey,
      readOnly: true,
      batchable: true,
      priority
    });
  }

  /**
   * Optimize healthcare-specific write operations
   */
  async executeHealthcareWrite<T>(
    operation: () => Promise<T>,
    operationName: string,
    invalidateCachePatterns?: string[]
  ): Promise<T> {
    try {
      const result = await this.executeOptimized(operation, {
        operationName: `write:${operationName}`,
        readOnly: false,
        batchable: false,
        bypassCache: true,
        priority: 'high' // Healthcare writes are typically critical
      });

      // Invalidate related cache entries
      if (invalidateCachePatterns && this.config.enableCaching) {
        this.invalidateCachePatterns(invalidateCachePatterns);
      }

      return result;
    } catch (error) {
      this.logger.error(`Healthcare write operation failed: ${operationName}`, error);
      throw error;
    }
  }

  /**
   * Execute critical healthcare operations with highest priority
   */
  async executeCriticalOperation<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    return this.executeOptimized(operation, {
      operationName: `critical:${operationName}`,
      readOnly: false,
      batchable: false,
      bypassCache: true,
      priority: 'high'
    });
  }

  /**
   * Execute patient data queries with specialized caching
   */
  async executePatientQuery<T>(
    patientId: string,
    operation: () => Promise<T>,
    operationName: string,
    cacheTTL?: number
  ): Promise<T> {
    const cacheKey = `patient:${patientId}:${operationName}`;
    
    return this.executeOptimized(operation, {
      operationName: `patient:${operationName}`,
      cacheKey,
      readOnly: true,
      batchable: true,
      priority: 'normal'
    });
  }

  /**
   * Execute appointment-related queries
   */
  async executeAppointmentQuery<T>(
    operation: () => Promise<T>,
    operationName: string,
    appointmentId?: string
  ): Promise<T> {
    const cacheKey = appointmentId ? `appointment:${appointmentId}:${operationName}` : undefined;
    
    return this.executeOptimized(operation, {
      operationName: `appointment:${operationName}`,
      cacheKey,
      readOnly: operationName.startsWith('get') || operationName.startsWith('find'),
      batchable: true,
      priority: 'high' // Appointments are time-sensitive
    });
  }

  /**
   * Get optimizer statistics
   */
  getOptimizerStats(): {
    cacheStats: {
      size: number;
      hitRate: number;
      totalHits: number;
    };
    batchStats: {
      queueSize: number;
      priorityQueueSizes: Record<string, number>;
      activeQueries: number;
    };
    config: QueryOptimizationConfig;
  } {
    const totalHits = Array.from(this.queryCache.values()).reduce((sum, entry) => sum + entry.hits, 0);
    const cacheSize = this.queryCache.size;
    
    return {
      cacheStats: {
        size: cacheSize,
        hitRate: cacheSize > 0 ? totalHits / cacheSize : 0,
        totalHits
      },
      batchStats: {
        queueSize: this.batchQueue.length,
        priorityQueueSizes: {
          high: this.priorityQueues.high.length,
          normal: this.priorityQueues.normal.length,
          low: this.priorityQueues.low.length
        },
        activeQueries: this.activeQueries
      },
      config: this.config
    };
  }

  /**
   * Clear healthcare-related cache entries
   */
  clearHealthcareCache(pattern?: string): void {
    if (pattern) {
      const keysToDelete = Array.from(this.queryCache.keys()).filter(key => 
        key.includes(pattern)
      );
      keysToDelete.forEach(key => this.queryCache.delete(key));
      this.logger.debug(`Cleared ${keysToDelete.length} cache entries matching pattern: ${pattern}`);
    } else {
      this.queryCache.clear();
      this.logger.debug('Cleared all cache entries');
    }
  }

  // Private helper methods

  private async executeDirectly<T>(
    operation: () => Promise<T>,
    operationName: string,
    cacheKey?: string,
    readOnly?: boolean
  ): Promise<T> {
    const startTime = Date.now();
    this.activeQueries++;
    
    try {
      if (this.config.enableQueryLogging) {
        this.logger.debug(`Executing healthcare operation: ${operationName}`);
      }

      const result = await operation();
      const executionTime = Date.now() - startTime;

      // Cache result if it's a read operation
      if (this.config.enableCaching && readOnly && cacheKey) {
        this.setCache(cacheKey, result, this.config.cacheTTL);
      }

      // Log slow queries
      if (executionTime > this.config.slowQueryThreshold) {
        this.logger.warn(`Slow healthcare query detected: ${operationName} took ${executionTime}ms`);
      }

      return result;
    } catch (error) {
      this.logger.error(`Healthcare operation failed: ${operationName}`, error);
      throw error;
    } finally {
      this.activeQueries--;
    }
  }

  private async executeBatched<T>(
    operation: () => Promise<T>,
    operationName: string,
    cacheKey?: string,
    priority: 'low' | 'normal' | 'high' = 'normal'
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const batchItem: BatchQueueItem = {
        operation,
        resolve,
        reject,
        operationName,
        cacheKey
      };

      // Add to appropriate priority queue
      this.priorityQueues[priority].push(batchItem);

      // Schedule batch processing
      this.scheduleBatchProcessing();
    });
  }

  private async queueForExecution<T>(
    operation: () => Promise<T>,
    options: OptimizedQueryOptions
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const checkQueue = () => {
        if (this.activeQueries < this.config.maxConcurrentQueries) {
          this.executeOptimized(operation, options).then(resolve).catch(reject);
        } else {
          setTimeout(checkQueue, 50); // Check again in 50ms
        }
      };
      checkQueue();
    });
  }

  private scheduleBatchProcessing(): void {
    if (this.batchTimer) return;

    this.batchTimer = setTimeout(() => {
      this.processPriorityBatches();
      this.batchTimer = undefined;
    }, this.config.batchTimeout);
  }

  private async processPriorityBatches(): Promise<void> {
    // Process high priority first, then normal, then low
    for (const priority of ['high', 'normal', 'low'] as const) {
      const queue = this.priorityQueues[priority];
      if (queue.length === 0) continue;

      const batchSize = priority === 'high' ? this.config.batchSize * 2 : this.config.batchSize;
      const batch = queue.splice(0, Math.min(batchSize, queue.length));

      if (batch.length > 0) {
        this.logger.debug(`Processing ${priority} priority batch of ${batch.length} operations`);
        await this.processBatch(batch);
      }
    }
  }

  private async processBatch(batch: BatchQueueItem[]): Promise<void> {
    const promises = batch.map(async ({ operation, resolve, reject, operationName, cacheKey }) => {
      try {
        const result = await this.executeDirectly(operation, operationName, cacheKey, true);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });

    await Promise.all(promises);
  }

  private generateCacheKey(operationName: string): string {
    return `healthcare:${operationName}:${Date.now()}`;
  }

  private getFromCache(key: string): any | null {
    const cached = this.queryCache.get(key);
    if (!cached) return null;

    // Check if cache entry is expired
    if (Date.now() > cached.timestamp + cached.ttl) {
      this.queryCache.delete(key);
      return null;
    }

    cached.hits++;
    return cached.result;
  }

  private setCache(key: string, value: any, ttl: number): void {
    this.queryCache.set(key, {
      result: value,
      timestamp: Date.now(),
      ttl,
      hits: 0
    });
  }

  private invalidateCachePatterns(patterns: string[]): void {
    for (const pattern of patterns) {
      const keysToDelete = Array.from(this.queryCache.keys()).filter(key => 
        key.includes(pattern)
      );
      keysToDelete.forEach(key => this.queryCache.delete(key));
      this.logger.debug(`Invalidated ${keysToDelete.length} cache entries for pattern: ${pattern}`);
    }
  }

  private startCacheCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const keysToDelete: string[] = [];
      
      this.queryCache.forEach((entry, key) => {
        if (now > entry.timestamp + entry.ttl) {
          keysToDelete.push(key);
        }
      });
      
      keysToDelete.forEach(key => this.queryCache.delete(key));
      
      if (keysToDelete.length > 0) {
        this.logger.debug(`Cleaned up ${keysToDelete.length} expired cache entries`);
      }
    }, 60000); // Run cleanup every minute
  }
}