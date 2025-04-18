import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma/prisma.service';
import { RedisService } from '../cache/redis/redis.service';
import { LogType, LogLevel } from './types/logging.types';

@Injectable()
export class LoggingService {
  private readonly logger = new Logger(LoggingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async log(
    type: LogType,
    level: LogLevel,
    message: string,
    context: string,
    metadata: Record<string, any> = {},
  ) {
    const timestamp = new Date();
    const id = `${timestamp.getTime()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const logEntry = {
      id,
      type,
      level,
      message,
      context,
      metadata: {
        ...metadata,
        timestamp: timestamp.toISOString(),
        environment: process.env.NODE_ENV || 'development',
        service: 'HealthCareBackend',
      },
      timestamp: timestamp.toISOString(),
    };

    // Log to console with colors and formatting
    const levelColor = this.getLevelColor(level);
    const contextColor = '\x1b[36m'; // Cyan
    const resetColor = '\x1b[0m';
    
    this.logger.log(
      `${levelColor}[${level}]${resetColor} ${contextColor}[${context}]${resetColor} ${message}`,
    );
    
    if (Object.keys(metadata).length > 0) {
      this.logger.debug('Metadata:', metadata);
    }

    // Store in Redis for real-time access
    await this.redis.rPush('logs', JSON.stringify(logEntry));
    // Keep only last 1000 logs
    await this.redis.lTrim('logs', -1000, -1);

    // Store in database for persistence
    try {
      await this.prisma.log.create({
        data: {
          id,
          type,
          level,
          message,
          context,
          metadata: JSON.stringify(logEntry.metadata),
          timestamp,
        },
      });
    } catch (error) {
      this.logger.error('Failed to store log in database:', error);
    }
  }

  private getLevelColor(level: LogLevel): string {
    switch (level) {
      case LogLevel.ERROR:
        return '\x1b[31m'; // Red
      case LogLevel.WARN:
        return '\x1b[33m'; // Yellow
      case LogLevel.INFO:
        return '\x1b[32m'; // Green
      case LogLevel.DEBUG:
        return '\x1b[35m'; // Magenta
      default:
        return '\x1b[0m'; // Reset
    }
  }

  async getLogs(
    type?: LogType,
    startTime?: Date,
    endTime?: Date,
    level?: string,
  ): Promise<any[]> {
    try {
      // Get logs from Redis
      const redisLogs = await this.redis.lRange('logs', 0, -1);
      let logs = redisLogs.map(log => JSON.parse(log));

      // Apply filters
      if (type || startTime || endTime || level) {
        logs = logs.filter(log => {
          const logTime = new Date(log.timestamp);
          const matchesType = !type || log.type === type;
          const matchesLevel = !level || log.level === level;
          const matchesStartTime = !startTime || logTime >= startTime;
          const matchesEndTime = !endTime || logTime <= endTime;
          return matchesType && matchesLevel && matchesStartTime && matchesEndTime;
        });
      }

      // Sort by timestamp descending
      return logs.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    } catch (error) {
      this.logger.error('Failed to retrieve logs:', error);
      
      // Fallback to database if Redis fails
      return this.prisma.log.findMany({
        where: {
          type: type ? type : undefined,
          level: level ? level : undefined,
          timestamp: {
            gte: startTime,
            lte: endTime,
          },
        },
        orderBy: {
          timestamp: 'desc',
        },
      });
    }
  }

  async clearLogs() {
    try {
      await this.redis.del('logs');
      return { success: true, message: 'Logs cleared successfully' };
    } catch (error) {
      console.error('Error clearing logs:', error);
      throw new Error('Failed to clear logs');
    }
  }

  /**
   * Get events from Redis
   */
  async getEvents(type?: string): Promise<any[]> {
    try {
      // Get events from Redis
      const redisEvents = await this.redis.lRange('events', 0, -1);
      let events = redisEvents.map(event => JSON.parse(event));

      // Apply filters
      if (type) {
        events = events.filter(event => event.type === type);
      }

      // Sort by timestamp descending
      return events.sort((a, b) => 
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    } catch (error) {
      this.logger.error('Failed to retrieve events:', error);
      return [];
    }
  }

  /**
   * Clear events from Redis
   */
  async clearEvents() {
    try {
      await this.redis.del('events');
      return { success: true, message: 'Events cleared successfully' };
    } catch (error) {
      console.error('Error clearing events:', error);
      throw new Error('Failed to clear events');
    }
  }
} 