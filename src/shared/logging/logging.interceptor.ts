import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { LoggingService } from './logging.service';
import { LogType, LogLevel } from './types/logging.types';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);
  private readonly HEALTH_CHECK_PATHS = ['/health', '/api-health'];

  constructor(private readonly loggingService: LoggingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url, body, headers, ip } = request;
    const userAgent = headers['user-agent'] || 'unknown';
    const startTime = Date.now();

    // Skip detailed logging for health checks
    const isHealthCheck = this.HEALTH_CHECK_PATHS.includes(url);
    
    if (!isHealthCheck) {
      // Log the incoming request
      this.loggingService.log(
        LogType.REQUEST,
        LogLevel.INFO,
        `Incoming ${method} request to ${url}`,
        'LoggingInterceptor',
        {
          method,
          url,
          body,
          ip,
          userAgent,
          timestamp: new Date().toISOString()
        }
      );
    }

    return next.handle().pipe(
      tap({
        next: (response) => {
          const endTime = Date.now();
          const duration = endTime - startTime;

          if (!isHealthCheck) {
            // Log the successful response
            this.loggingService.log(
              LogType.RESPONSE,
              LogLevel.INFO,
              `Response sent for ${method} ${url}`,
              'LoggingInterceptor',
              {
                method,
                url,
                duration: `${duration}ms`,
                statusCode: context.switchToHttp().getResponse().statusCode,
                response: this.sanitizeResponse(response),
                timestamp: new Date().toISOString()
              }
            );
          }
        },
        error: (error) => {
          const endTime = Date.now();
          const duration = endTime - startTime;

          // Always log errors, even for health checks
          this.loggingService.log(
            LogType.ERROR,
            LogLevel.ERROR,
            `Error in ${method} ${url}: ${error.message}`,
            'LoggingInterceptor',
            {
              method,
              url,
              duration: `${duration}ms`,
              error: {
                message: error.message,
                stack: error.stack,
                code: error.code || 'UNKNOWN_ERROR',
                statusCode: error.status || 500
              },
              timestamp: new Date().toISOString()
            }
          );
        }
      })
    );
  }

  private sanitizeResponse(response: any): any {
    // Skip sanitization for health checks to avoid unnecessary processing
    if (response?.status === 'healthy') {
      return { status: response.status };
    }

    // Deep clone the response to avoid modifying the original
    const sanitized = JSON.parse(JSON.stringify(response || {}));

    // Remove sensitive fields
    const sensitiveFields = ['password', 'token', 'secret', 'authorization'];
    
    const sanitizeObject = (obj: any) => {
      if (!obj || typeof obj !== 'object') return;

      Object.keys(obj).forEach(key => {
        if (sensitiveFields.includes(key.toLowerCase())) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object') {
          sanitizeObject(obj[key]);
        }
      });
    };

    sanitizeObject(sanitized);
    return sanitized;
  }
} 