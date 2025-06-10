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
    const isHealthCheck = this.HEALTH_CHECK_PATHS.includes(url);

    // Log all requests except health checks
    if (!isHealthCheck) {
      const logType = this.getLogType(url);
      this.loggingService.log(
        logType,
        LogLevel.INFO,
        `${method} ${url}`,
        'API',
        {
          method,
          url,
          body: this.sanitizeBody(body),
          ip,
          userAgent,
          timestamp: new Date().toISOString(),
          headers: this.sanitizeHeaders(headers)
        }
      );
    }

    return next.handle().pipe(
      tap({
        next: (response) => {
          const endTime = Date.now();
          const duration = endTime - startTime;

          if (!isHealthCheck) {
            const logType = this.getLogType(url);
            this.loggingService.log(
              logType,
              LogLevel.INFO,
              `${method} ${url} completed in ${duration}ms`,
              'API',
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

  private getLogType(url: string): LogType {
    if (url.includes('/auth')) return LogType.AUTH;
    if (url.includes('/users')) return LogType.USER;
    if (url.includes('/appointments')) return LogType.APPOINTMENT;
    if (url.includes('/clinics')) return LogType.CLINIC;
    if (url.includes('/events')) return LogType.EVENT;
    return LogType.REQUEST;
  }

  private sanitizeBody(body: any): any {
    if (!body) return undefined;
    
    const sanitized = JSON.parse(JSON.stringify(body));
    const sensitiveFields = ['password', 'token', 'secret', 'authorization', 'currentPassword', 'newPassword'];
    
    this.sanitizeObject(sanitized, sensitiveFields);
    return sanitized;
  }

  private sanitizeHeaders(headers: any): any {
    if (!headers) return undefined;
    
    const sanitized = { ...headers };
    const sensitiveHeaders = ['authorization', 'cookie', 'x-auth-token'];
    
    sensitiveHeaders.forEach(header => {
      if (sanitized[header]) {
        sanitized[header] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }

  private sanitizeResponse(response: any): any {
    if (!response) return undefined;
    if (response?.status === 'healthy') return { status: response.status };

    const sanitized = JSON.parse(JSON.stringify(response));
    const sensitiveFields = ['password', 'token', 'secret', 'authorization'];
    
    this.sanitizeObject(sanitized, sensitiveFields);
    return sanitized;
  }

  private sanitizeObject(obj: any, sensitiveFields: string[]): void {
    if (!obj || typeof obj !== 'object') return;

    Object.keys(obj).forEach(key => {
      if (sensitiveFields.includes(key.toLowerCase())) {
        obj[key] = '[REDACTED]';
      } else if (typeof obj[key] === 'object') {
        this.sanitizeObject(obj[key], sensitiveFields);
      }
    });
  }
} 