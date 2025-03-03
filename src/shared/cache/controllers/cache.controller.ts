import { Controller, Get, Post, Delete } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RedisService } from '../redis/redis.service';

@ApiTags('cache')
@Controller('cache')
export class CacheController {
  constructor(private readonly redis: RedisService) {}

  @Get('stats')
  @ApiOperation({ 
    summary: 'Get cache statistics',
    description: 'Returns statistics about the Redis cache usage. No parameters required.'
  })
  @ApiResponse({
    status: 200,
    description: 'Cache statistics retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        keys: { type: 'number', description: 'Total number of keys in the cache', example: 1250 },
        memory: { 
          type: 'object', 
          description: 'Memory usage information',
          properties: {
            used: { type: 'number', description: 'Used memory in bytes', example: 1048576 },
            peak: { type: 'number', description: 'Peak memory usage in bytes', example: 2097152 },
            fragmentation: { type: 'number', description: 'Memory fragmentation ratio', example: 1.5 }
          }
        },
        hitRate: { type: 'number', description: 'Cache hit rate percentage', example: 85.7 },
        operations: {
          type: 'object',
          description: 'Operation counts',
          properties: {
            reads: { type: 'number', description: 'Number of read operations', example: 10000 },
            writes: { type: 'number', description: 'Number of write operations', example: 5000 },
            deletes: { type: 'number', description: 'Number of delete operations', example: 1000 }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 500, description: 'Internal server error - Failed to retrieve cache statistics' })
  async getCacheStats() {
    return this.redis.getCacheStats();
  }

  @Get('debug')
  @ApiOperation({ 
    summary: 'Get cache debug information',
    description: 'Returns detailed debug information about the Redis cache. No parameters required.'
  })
  @ApiResponse({
    status: 200,
    description: 'Cache debug information retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        info: { 
          type: 'object', 
          description: 'Redis server information',
          properties: {
            version: { type: 'string', example: '6.2.6' },
            uptime: { type: 'number', description: 'Server uptime in seconds', example: 3600 },
            connectedClients: { type: 'number', example: 10 },
            dbSize: { type: 'number', description: 'Number of keys in the database', example: 1250 },
            memoryInfo: { 
              type: 'object', 
              description: 'Memory usage information',
              properties: {
                usedMemory: { type: 'number', description: 'Used memory in bytes', example: 1048576 },
                usedMemoryHuman: { type: 'string', example: '1M' },
                maxMemory: { type: 'number', description: 'Maximum memory limit in bytes', example: 4194304 },
                maxMemoryHuman: { type: 'string', example: '4M' }
              }
            }
          }
        },
        keys: {
          type: 'object',
          description: 'Key pattern statistics',
          properties: {
            patterns: { 
              type: 'array', 
              description: 'List of key patterns and their counts',
              items: {
                type: 'object',
                properties: {
                  pattern: { type: 'string', example: 'user:*' },
                  count: { type: 'number', example: 500 }
                }
              }
            }
          }
        }
      }
    }
  })
  @ApiResponse({ status: 500, description: 'Internal server error - Failed to retrieve cache debug information' })
  async getCacheDebug() {
    return this.redis.getCacheDebug();
  }

  @Delete('clear')
  @ApiOperation({ 
    summary: 'Clear all cache',
    description: 'Removes all keys from the Redis cache. No parameters required.'
  })
  @ApiResponse({
    status: 200,
    description: 'Cache cleared successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Cache cleared successfully' }
      }
    }
  })
  @ApiResponse({ status: 500, description: 'Internal server error - Failed to clear cache' })
  async clearCache() {
    await this.redis.clearAllCache();
    return { message: 'Cache cleared successfully' };
  }
} 