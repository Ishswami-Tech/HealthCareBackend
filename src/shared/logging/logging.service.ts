import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma/prisma.service';
import { RedisService } from '../cache/redis/redis.service';
import { LogType, LogLevel } from './types/logging.types';

@Injectable()
export class LoggingService {
  private logger: Logger;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    this.initLogger();
  }

  private initLogger() {
    try {
      if (!this.logger) {
        this.logger = new Logger(LoggingService.name);
      }
    } catch (error) {
      console.error('Failed to initialize logger:', error);
      // Fallback to basic logger
      this.logger = {
        log: (message: string) => console.log(message),
        error: (message: string) => console.error(message),
        warn: (message: string) => console.warn(message),
        debug: (message: string) => console.debug(message),
      } as Logger;
    }
  }

  private ensureLogger() {
    if (!this.logger) {
      this.initLogger();
    }
  }

  async log(
    type: LogType,
    level: LogLevel,
    message: string,
    context: string,
    metadata: Record<string, any> = {},
  ) {
    this.ensureLogger();
    
    const timestamp = new Date();
    // Generate a more unique ID with nanosecond precision and longer random string
    const id = `${timestamp.getTime()}-${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
    
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

    try {
      // Only log to console in development or if it's an error/warning
      if (process.env.NODE_ENV !== 'production' || level === LogLevel.ERROR || level === LogLevel.WARN) {
        const levelColor = this.getLevelColor(level);
        const contextColor = '\x1b[36m'; // Cyan
        const resetColor = '\x1b[0m';
        
        const coloredMessage = `${levelColor}[${level}]${resetColor} ${contextColor}[${context}]${resetColor} ${message}`;
        console.log(coloredMessage);
        
        if (Object.keys(metadata).length > 0) {
          this.logger?.debug?.('Metadata:', metadata);
        }
      }

      // First try to store in database for persistence (but skip frequent health checks and socket logs)
      // This way we ensure the ID is registered in the database before attempting Redis operations
      if (!message.includes('health check') && !context.includes('Socket')) {
        try {
          await this.prisma?.log.create({
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
        } catch (dbError) {
          console.error('Failed to store log in database:', dbError);
          // Don't rethrow, continue with Redis attempt
        }
      }

      // Then try Redis for real-time access (if database operation succeeded)
      try {
        await this.redis?.rPush('logs', JSON.stringify(logEntry));
        await this.redis?.lTrim('logs', -1000, -1); // Keep last 1000 logs
      } catch (redisError) {
        console.error('Failed to store log in Redis:', redisError);
        // Redis errors are non-fatal, just log them
      }
    } catch (error) {
      // Fallback to basic console logging if everything else fails
      console.error('Logging failed:', error);
      console.log(`FALLBACK LOG: [${level}] [${context}] ${message}`);
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
    this.ensureLogger();
    
    try {
      // Default to last 24 hours if no time range specified
      const now = new Date();
      const defaultStartTime = new Date(now.getTime() - (24 * 60 * 60 * 1000)); // 24 hours ago
      
      const finalStartTime = startTime || defaultStartTime;
      const finalEndTime = endTime || now;

      // Create cache key for this query
      const cacheKey = `logs:${type || 'all'}:${level || 'all'}:${finalStartTime.getTime()}:${finalEndTime.getTime()}`;
      
      // Try to get from cache first
      const cachedLogs = await this.redis.get(cacheKey);
      if (cachedLogs) {
        return JSON.parse(cachedLogs);
      }

      // If not in cache, query database with optimized parameters
      const dbLogs = await this.prisma.log.findMany({
        where: {
          type: type || undefined,
          level: level || undefined,
          timestamp: {
            gte: finalStartTime,
            lte: finalEndTime,
          },
        },
        orderBy: {
          timestamp: 'desc',
        },
        take: 500, // Reduced from 1000 to 500 for better performance
        select: {
          id: true,
          type: true,
          level: true,
          message: true,
          context: true,
          metadata: true,
          timestamp: true,
        },
      });

      const result = dbLogs.map(log => ({
        ...log,
        metadata: typeof log.metadata === 'string' 
          ? JSON.parse(log.metadata) 
          : log.metadata,
      }));

      // Cache the result for 5 minutes
      await this.redis.set(cacheKey, JSON.stringify(result), 300);

      return result;
    } catch (error) {
      console.error('Failed to retrieve logs:', error);
      return [];
    }
  }

  async clearLogs() {
    this.ensureLogger();
    
    try {
      await this.redis?.del('logs');
      return { success: true, message: 'Logs cleared successfully' };
    } catch (error) {
      console.error('Error clearing logs:', error);
      throw new Error('Failed to clear logs');
    }
  }

  async getEvents(type?: string): Promise<any[]> {
    this.ensureLogger();
    
    try {
      // Get events from Redis
      const redisEvents = await this.redis?.lRange('events', 0, -1) || [];
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
      console.error('Failed to retrieve events:', error);
      return [];
    }
  }

  async clearEvents() {
    this.ensureLogger();
    
    try {
      await this.redis?.del('events');
      return { success: true, message: 'Events cleared successfully' };
    } catch (error) {
      console.error('Error clearing events:', error);
      throw new Error('Failed to clear events');
    }
  }
} 