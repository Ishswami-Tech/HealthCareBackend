// External imports
import {
  Controller,
  Get,
  Delete,
  Query,
  HttpStatus,
  Body,
  Post,
  ParseBoolPipe,
  DefaultValuePipe,
  ParseIntPipe,
  Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBody } from '@nestjs/swagger';

// Internal imports - Infrastructure
import { CacheService } from '@infrastructure/cache/cache.service';

// Internal imports - Core
import { HealthcareError } from '@core/errors';
import { ErrorCode } from '@core/errors/error-codes.enum';

// Internal imports - Types
import {
  type CacheConfigUpdate,
  type BenchmarkResults,
  type CacheMetrics,
  LogLevel,
  LogType,
} from '@core/types';
import type { LoggerLike } from '@core/types';

/**
 * Controller for cache management and monitoring.
 * Provider-agnostic: works with Redis, Dragonfly, or any cache provider.
 * Provides consolidated endpoints for cache operations with improved performance.
 */
@ApiTags('cache')
@Controller('cache')
export class CacheController {
  constructor(
    private readonly cacheService: CacheService,
    // Use string token to avoid importing LoggingService (prevents SWC TDZ circular-import issues)
    @Inject('LOGGING_SERVICE') private readonly loggingService: LoggerLike
  ) {}

  /**
   * Consolidated cache information endpoint that returns complete
   * cache status including stats, metrics, and optional debug info.
   */
  @Get()
  @ApiOperation({
    summary: 'Get cache information',
    description:
      'Returns consolidated information about Redis cache including statistics, metrics, and health status.',
  })
  @ApiQuery({
    name: 'includeDebug',
    type: 'boolean',
    required: false,
    description: 'Whether to include detailed debug information',
    example: false,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Cache information successfully retrieved',
    schema: {
      type: 'object',
      properties: {
        health: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'healthy' },
            ping: {
              type: 'number',
              description: 'Redis ping response time in ms',
              example: 1.5,
            },
          },
        },
        metrics: {
          type: 'object',
          properties: {
            keys: {
              type: 'number',
              description: 'Total number of keys',
              example: 1250,
            },
            hitRate: {
              type: 'number',
              description: 'Cache hit rate percentage',
              example: 85.7,
            },
            memory: {
              type: 'object',
              description: 'Memory usage information',
              properties: {
                used: {
                  type: 'number',
                  description: 'Used memory in bytes',
                  example: 1048576,
                },
                peak: {
                  type: 'number',
                  description: 'Peak memory usage in bytes',
                  example: 2097152,
                },
                fragmentation: {
                  type: 'number',
                  description: 'Memory fragmentation ratio',
                  example: 1.5,
                },
              },
            },
            operations: {
              type: 'object',
              description: 'Cache operation counts',
              properties: {
                hits: { type: 'number', example: 10000 },
                misses: { type: 'number', example: 2000 },
              },
            },
          },
        },
        debug: {
          type: 'object',
          description: 'Detailed debug information (only included if includeDebug=true)',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'Cache service unavailable',
  })
  async getCacheInfo(
    @Query('includeDebug', new DefaultValuePipe(false), ParseBoolPipe)
    includeDebug: boolean
  ): Promise<{
    health: { status: string; ping: number };
    metrics: CacheMetrics;
    stats: { hits: number; misses: number };
    debug?: Record<string, unknown>;
  }> {
    try {
      await this.loggingService.log(
        LogType.CACHE,
        LogLevel.DEBUG,
        'Cache information requested',
        'CacheController',
        { includeDebug }
      );

      const [isHealthy, pingTime] = await this.cacheService.getHealthStatus();
      const metrics = await this.cacheService.getCacheMetricsAsync();
      const stats = await this.cacheService.getCacheStats();

      const response: {
        health: { status: string; ping: number };
        metrics: CacheMetrics;
        stats: { hits: number; misses: number };
        debug?: Record<string, unknown>;
      } = {
        health: {
          status: isHealthy ? 'healthy' : 'degraded',
          ping: pingTime,
        },
        metrics,
        stats,
      };

      if (includeDebug) {
        response.debug = (await this.cacheService.getCacheDebug()) as Record<string, unknown>;
      }

      await this.loggingService.log(
        LogType.CACHE,
        LogLevel.INFO,
        'Cache information retrieved successfully',
        'CacheController',
        {
          isHealthy,
          pingTime,
          keys: metrics['keys'],
          hitRate: metrics['hitRate'],
        }
      );

      return response;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to get cache information',
        'CacheController',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        }
      );

      throw new HealthcareError(
        ErrorCode.CACHE_OPERATION_FAILED,
        'Failed to retrieve cache information',
        HttpStatus.INTERNAL_SERVER_ERROR,
        { operation: 'getCacheInfo' },
        'CacheController.getCacheInfo'
      );
    }
  }

  /**
   * Manage cache entries with pattern-based control.
   * Provides targeted cache operations for specific key patterns.
   */
  @Delete()
  @ApiOperation({
    summary: 'Manage cache entries',
    description:
      'Clear cache entries with optional pattern filtering for targeted cache management.',
  })
  @ApiQuery({
    name: 'pattern',
    type: 'string',
    required: false,
    description:
      'Pattern of keys to clear (e.g., "user:*"). If not provided, clears all cache except system keys.',
    example: 'api:users:*',
  })
  @ApiQuery({
    name: 'resetStats',
    type: 'boolean',
    required: false,
    description: 'Whether to reset cache statistics',
    example: false,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Cache cleared successfully',
    schema: {
      type: 'object',
      properties: {
        cleared: {
          type: 'number',
          description: 'Number of keys cleared',
          example: 125,
        },
        message: { type: 'string', example: 'Cache cleared successfully' },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'Cache service unavailable',
  })
  async manageCacheEntries(
    @Query('pattern') pattern?: string,
    @Query('resetStats', new DefaultValuePipe(false), ParseBoolPipe)
    resetStats?: boolean
  ): Promise<{ cleared: number; message: string }> {
    try {
      await this.loggingService.log(
        LogType.CACHE,
        LogLevel.INFO,
        'Cache entries management requested',
        'CacheController',
        { pattern, resetStats }
      );

      const clearedCount = pattern
        ? await this.cacheService.clearCache(pattern)
        : await this.cacheService.clearAllCache();

      if (resetStats) {
        await this.cacheService.resetCacheStats();
      }

      await this.loggingService.log(
        LogType.CACHE,
        LogLevel.INFO,
        'Cache entries cleared successfully',
        'CacheController',
        {
          clearedCount,
          pattern: pattern || 'all',
          resetStats: resetStats || false,
        }
      );

      return {
        cleared: clearedCount,
        message: pattern
          ? `Cleared ${clearedCount} keys matching pattern: ${pattern}`
          : `Cleared ${clearedCount} keys from cache`,
      };
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to manage cache entries',
        'CacheController',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          pattern,
        }
      );

      throw new HealthcareError(
        ErrorCode.CACHE_OPERATION_FAILED,
        'Failed to manage cache entries',
        HttpStatus.INTERNAL_SERVER_ERROR,
        { operation: 'manageCacheEntries', pattern },
        'CacheController.manageCacheEntries'
      );
    }
  }

  /**
   * Advanced cache management operations with detailed configuration.
   */
  @Post('config')
  @ApiOperation({
    summary: 'Configure cache behavior',
    description: 'Update cache configuration settings including TTLs and rate limits.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        defaultTtl: {
          type: 'number',
          description: 'Default TTL in seconds for new cache entries',
          example: 3600,
        },
        rateLimits: {
          type: 'object',
          description: 'Rate limit configurations by type',
          example: {
            api: { limit: 100, window: 60 },
            auth: { limit: 5, window: 60 },
          },
        },
        maxMemoryPolicy: {
          type: 'string',
          description: 'Policy for memory management',
          enum: ['noeviction', 'allkeys-lru', 'volatile-lru', 'allkeys-random', 'volatile-random'],
          example: 'volatile-lru',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Cache configuration updated successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string', example: 'Cache configuration updated' },
        config: { type: 'object', description: 'Current configuration' },
      },
    },
  })
  async updateCacheConfig(@Body() config: CacheConfigUpdate): Promise<{
    success: boolean;
    message: string;
    config: Record<string, unknown>;
  }> {
    try {
      await this.loggingService.log(
        LogType.CACHE,
        LogLevel.INFO,
        'Cache configuration update requested',
        'CacheController',
        { hasRateLimits: !!config.rateLimits, hasDefaultTtl: !!config.defaultTtl }
      );

      // Update rate limits if provided
      if (config.rateLimits) {
        for (const [type, limits] of Object.entries(config.rateLimits)) {
          await this.cacheService.updateRateLimits(type, limits);
        }
      }

      // Additional configuration could be implemented here

      await this.loggingService.log(
        LogType.CACHE,
        LogLevel.INFO,
        'Cache configuration updated successfully',
        'CacheController',
        { rateLimitsUpdated: !!config.rateLimits }
      );

      return {
        success: true,
        message: 'Cache configuration updated',
        config: {
          rateLimits: this.cacheService.getRateLimitConfig(),
          // Other config properties would be returned here
        },
      };
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Failed to update cache configuration',
        'CacheController',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        }
      );

      throw new HealthcareError(
        ErrorCode.CACHE_CONFIGURATION_ERROR,
        'Failed to update cache configuration',
        HttpStatus.INTERNAL_SERVER_ERROR,
        { operation: 'updateCacheConfig' },
        'CacheController.updateCacheConfig'
      );
    }
  }

  /**
   * Benchmark endpoint to test and optimize cache performance.
   */
  @Get('benchmark')
  @ApiOperation({
    summary: 'Benchmark cache performance',
    description:
      'Run performance tests on the cache system to identify bottlenecks and optimize settings.',
  })
  @ApiQuery({
    name: 'operations',
    type: 'number',
    required: false,
    description: 'Number of operations to perform in the benchmark',
    example: 1000,
  })
  @ApiQuery({
    name: 'payloadSize',
    type: 'number',
    required: false,
    description: 'Size of test payload in bytes',
    example: 1024,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Benchmark results',
    schema: {
      type: 'object',
      properties: {
        duration: {
          type: 'number',
          description: 'Total duration in milliseconds',
          example: 1536,
        },
        operationsPerSecond: { type: 'number', example: 651.04 },
        averageLatency: {
          type: 'number',
          description: 'Average operation latency in milliseconds',
          example: 1.54,
        },
        operations: {
          type: 'object',
          properties: {
            set: { type: 'object', description: 'SET operation metrics' },
            get: { type: 'object', description: 'GET operation metrics' },
            del: { type: 'object', description: 'DEL operation metrics' },
          },
        },
      },
    },
  })
  async benchmarkCache(
    @Query('operations', new DefaultValuePipe(1000), ParseIntPipe)
    operations: number,
    @Query('payloadSize', new DefaultValuePipe(1024), ParseIntPipe)
    payloadSize: number
  ): Promise<BenchmarkResults> {
    try {
      await this.loggingService.log(
        LogType.CACHE,
        LogLevel.INFO,
        'Cache benchmark started',
        'CacheController',
        { operations, payloadSize }
      );

      const startTime = Date.now();

      // Generate test payload of specified size
      const payload = 'x'.repeat(payloadSize);

      // Benchmark SET operations
      const setStart = Date.now();
      for (let i = 0; i < operations; i++) {
        await this.cacheService.set(`benchmark:${i}`, payload, 60);
      }
      const setDuration = Date.now() - setStart;

      // Benchmark GET operations
      const getStart = Date.now();
      for (let i = 0; i < operations; i++) {
        await this.cacheService.get(`benchmark:${i}`);
      }
      const getDuration = Date.now() - getStart;

      // Benchmark DEL operations
      const delStart = Date.now();
      for (let i = 0; i < operations; i++) {
        await this.cacheService.del(`benchmark:${i}`);
      }
      const delDuration = Date.now() - delStart;

      const totalDuration = Date.now() - startTime;

      const result: BenchmarkResults = {
        duration: totalDuration,
        operationsPerSecond: Math.round(((operations * 3) / totalDuration) * 1000 * 100) / 100,
        averageLatency: Math.round((totalDuration / (operations * 3)) * 100) / 100,
        operations: {
          set: {
            duration: setDuration,
            operationsPerSecond: Math.round((operations / setDuration) * 1000 * 100) / 100,
            averageLatency: Math.round((setDuration / operations) * 100) / 100,
          },
          get: {
            duration: getDuration,
            operationsPerSecond: Math.round((operations / getDuration) * 1000 * 100) / 100,
            averageLatency: Math.round((getDuration / operations) * 100) / 100,
          },
          del: {
            duration: delDuration,
            operationsPerSecond: Math.round((operations / delDuration) * 1000 * 100) / 100,
            averageLatency: Math.round((delDuration / operations) * 100) / 100,
          },
        },
      };

      await this.loggingService.log(
        LogType.PERFORMANCE,
        LogLevel.INFO,
        'Cache benchmark completed',
        'CacheController',
        {
          operations,
          totalDuration,
          operationsPerSecond: result.operationsPerSecond,
          averageLatency: result.averageLatency,
        }
      );

      return result;
    } catch (error) {
      await this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        'Cache benchmark failed',
        'CacheController',
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
          operations,
          payloadSize,
        }
      );

      throw new HealthcareError(
        ErrorCode.CACHE_OPERATION_FAILED,
        'Failed to execute cache benchmark',
        HttpStatus.INTERNAL_SERVER_ERROR,
        { operation: 'benchmarkCache', operations, payloadSize },
        'CacheController.benchmarkCache'
      );
    }
  }
}
