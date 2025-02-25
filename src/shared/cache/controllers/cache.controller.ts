import { Controller, Get, Post, Delete } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { RedisService } from '../redis/redis.service';

@ApiTags('cache')
@Controller('cache')
export class CacheController {
  constructor(private readonly redis: RedisService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Get cache statistics' })
  async getCacheStats() {
    return this.redis.getCacheStats();
  }

  @Get('debug')
  @ApiOperation({ summary: 'Get cache debug information' })
  async getCacheDebug() {
    return this.redis.getCacheDebug();
  }

  @Delete('clear')
  @ApiOperation({ summary: 'Clear all cache' })
  async clearCache() {
    await this.redis.clearAllCache();
    return { message: 'Cache cleared successfully' };
  }
} 