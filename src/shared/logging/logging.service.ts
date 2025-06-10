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

    try {
      // Store in Redis for real-time access
      await this.redis?.rPush('logs', JSON.stringify(logEntry));
      await this.redis?.lTrim('logs', -10000, -1); // Keep last 10000 logs

      // Store in database for persistence
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

      // Only log errors and warnings to console
      if (level === LogLevel.ERROR || level === LogLevel.WARN) {
        const levelColor = this.getLevelColor(level);
        const contextColor = '\x1b[36m'; // Cyan
        const resetColor = '\x1b[0m';
        const coloredMessage = `${levelColor}[${level}]${resetColor} ${contextColor}[${context}]${resetColor} ${message}`;
        console.log(coloredMessage);
      }

    } catch (error) {
      // Log storage errors to console
      console.error('Failed to store log:', error);
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
      // First try to get logs from Redis
      const redisLogs = await this.redis?.lRange('logs', 0, -1) || [];
      let logs = redisLogs.map(log => JSON.parse(log));

      // If Redis is empty or fails, get from database
      if (!logs.length) {
        const dbLogs = await this.prisma?.log.findMany({
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
          take: 1000, // Limit to last 1000 logs
        }) || [];

        logs = dbLogs.map(log => ({
          ...log,
          metadata: JSON.parse(log.metadata),
        }));
      }

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