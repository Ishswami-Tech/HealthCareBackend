import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { LoggingService } from './logging.service';
import { LogType, LogLevel } from './types/logging.types';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);
  private readonly HEALTH_CHECK_PATHS = ['/health', '/api-health', '/socket.io/socket.io.js'];
  private readonly MINIMAL_LOG_PATHS = ['/logger/logs/data', '/logger/events/data'];

  constructor(private readonly loggingService: LoggingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, headers, ip } = request;
    const userAgent = headers['user-agent'] || 'unknown';
    const startTime = Date.now();

    // Skip logging for health checks completely
    const isHealthCheck = this.HEALTH_CHECK_PATHS.some(path => url.includes(path));
    if (isHealthCheck) {
      return next.handle();
    }

    // Minimal logging for frequent endpoints
    const isMinimalLog = this.MINIMAL_LOG_PATHS.some(path => url === path);
    
    if (!isMinimalLog) {
      // Log the incoming request
      this.loggingService.log(
        LogType.REQUEST,
        LogLevel.INFO,
        `${method} ${url}`,
        'API',
        {
          method,
          url,
          body: this.sanitizeBody(body),
          ip,
          userAgent
        }
      );
    }

    return next.handle().pipe(
      tap({
        next: (response) => {
          const endTime = Date.now();
          const duration = endTime - startTime;

          if (!isMinimalLog) {
            // Log the successful response
            this.loggingService.log(
              LogType.RESPONSE,
              LogLevel.INFO,
              `${method} ${url} [${duration}ms]`,
              'API',
              {
                method,
                url,
                duration: `${duration}ms`,
                statusCode: context.switchToHttp().getResponse().statusCode
              }
            );
          }
        },
        error: (error) => {
          const endTime = Date.now();
          const duration = endTime - startTime;

          // Always log errors
          this.loggingService.log(
            LogType.ERROR,
            LogLevel.ERROR,
            `${method} ${url} failed: ${error.message}`,
            'API',
            {
              method,
              url,
              duration: `${duration}ms`,
              error: {
                message: error.message,
                code: error.code || 'UNKNOWN_ERROR',
                statusCode: error.status || 500
              }
            }
          );
        }
      })
    );
  }

  private sanitizeBody(body: any): any {
    if (!body) return undefined;
    
    // Create a copy to avoid modifying the original
    const sanitized = { ...body };
    
    // Remove sensitive fields
    const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'authorization'];
    sensitiveFields.forEach(field => {
      if (field in sanitized) {
        sanitized[field] = '***';
      }
    });
    
    return sanitized;
  }
} 