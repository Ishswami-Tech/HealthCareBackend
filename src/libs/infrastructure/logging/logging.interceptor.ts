// External imports
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

// Internal imports - Infrastructure
import { LoggingService } from '@logging';

// Internal imports - Types
import { LogType, LogLevel } from '@core/types';

/**
 * Interface for HTTP request object from NestJS ExecutionContext
 */
interface HttpRequest {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
  ip: string;
}

/**
 * Interface for HTTP response object from NestJS ExecutionContext
 */
interface HttpResponse {
  statusCode: number;
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly SKIP_LOG_PATHS = [
    '/api-health',
    '/socket.io/socket.io.js',
    '/logger/logs',
    '/logger/events',
    '/metrics',
    '/status',
  ];

  constructor(private readonly loggingService: LoggingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const request = this.extractRequest(httpContext.getRequest());
    const { method, url, body, headers, ip } = request;
    const userAgent = headers['user-agent'] || 'unknown';
    const startTime = Date.now();
    const requestSummary = this.summarizeRequest(url, body);

    // Skip logging for health checks and other frequent endpoints
    const pathname = new URL(url, 'http://localhost').pathname;
    if (
      this.SKIP_LOG_PATHS.some(skipPath => pathname === skipPath || pathname.startsWith(skipPath))
    ) {
      return next.handle();
    }

    void this.loggingService.log(LogType.REQUEST, LogLevel.INFO, `${method} ${url}`, 'API', {
      method,
      url,
      body: this.sanitizeBody(body),
      ...(requestSummary ? { requestSummary } : {}),
      ip,
      userAgent,
    });

    return next.handle().pipe(
      tap({
        next: responseBody => {
          const endTime = Date.now();
          const duration = endTime - startTime;
          const response = this.extractResponse(context.switchToHttp().getResponse());
          const statusCode = response.statusCode;
          const responseSummary = this.summarizeResponse(responseBody);
          void this.loggingService.log(
            LogType.RESPONSE,
            LogLevel.INFO,
            `${method} ${url} [${statusCode}]`,
            'API',
            {
              method,
              url,
              duration: `${duration}ms`,
              statusCode,
              response: responseSummary,
              ...(responseSummary ? { responseSummary } : {}),
            }
          );
        },
        error: error => {
          const endTime = Date.now();
          const duration = endTime - startTime;

          // Always log errors
          void this.loggingService.log(
            LogType.ERROR,
            LogLevel.ERROR,
            `${method} ${url} failed: ${(error as Error).message}`,
            'API',
            {
              method,
              url,
              duration: `${duration}ms`,
              error: {
                message: (error as Error).message,
                code: (error as { code?: string }).code || 'UNKNOWN_ERROR',
                statusCode: (error as { status?: number }).status || 500,
              },
            }
          );
        },
      })
    );
  }

  private sanitizeBody(body: unknown): unknown {
    if (!body) return undefined;

    // Create a copy to avoid modifying the original
    const sanitized = { ...(body as Record<string, unknown>) };

    // Remove sensitive fields
    const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'authorization'];
    sensitiveFields.forEach(field => {
      if (field in sanitized) {
        sanitized[field] = '***';
      }
    });

    return sanitized;
  }

  private summarizeResponse(responseBody: unknown): unknown {
    if (responseBody == null) {
      return { type: 'null' };
    }

    if (Array.isArray(responseBody)) {
      return {
        type: 'array',
        count: responseBody.length,
      };
    }

    if (typeof responseBody === 'object') {
      const record = responseBody as Record<string, unknown>;
      const keys = Object.keys(record).slice(0, 12);
      return {
        type: 'object',
        keys,
        ...(Array.isArray(record['data'])
          ? { count: record['data'].length }
          : Array.isArray(record['items'])
            ? { count: record['items'].length }
            : {}),
      };
    }

    return {
      type: typeof responseBody,
    };
  }

  private summarizeRequest(url: string, body: unknown): Record<string, unknown> | undefined {
    if (url.includes('/api/v1/appointments/my-appointments')) {
      return {
        ...(this.summarizeUrlParams(url, [
          'clinicId',
          'status',
          'date',
          'startDate',
          'endDate',
          'page',
          'limit',
        ]) || {}),
        ...(this.summarizeObject(body, [
          'clinicId',
          'status',
          'date',
          'startDate',
          'endDate',
          'page',
          'limit',
        ]) || {}),
      };
    }

    if (url.includes('/api/v1/clinics/') && url.includes('/doctors')) {
      return {
        ...(this.summarizeUrlParams(url, [
          'clinicId',
          'locationId',
          'specialization',
          'search',
          'isActive',
          'limit',
          'offset',
        ]) || {}),
        ...(this.summarizeObject(body, [
          'clinicId',
          'locationId',
          'specialization',
          'search',
          'isActive',
          'limit',
          'offset',
        ]) || {}),
      };
    }

    if (url.includes('/health')) {
      return {
        ...(this.summarizeUrlParams(url, ['detailed', 'namespace', 'source']) || {}),
        ...(this.summarizeObject(body, ['detailed', 'namespace', 'source']) || {}),
      };
    }

    return undefined;
  }

  private summarizeUrlParams(url: string, keys: string[]): Record<string, unknown> | undefined {
    try {
      const parsed = new URL(url, 'http://localhost');
      const summary: Record<string, unknown> = {};
      for (const key of keys) {
        const value = parsed.searchParams.get(key);
        if (value !== null && value !== '') {
          summary[key] = value;
        }
      }
      return Object.keys(summary).length > 0 ? summary : undefined;
    } catch {
      return undefined;
    }
  }

  private summarizeObject(value: unknown, keys: string[]): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    const summary: Record<string, unknown> = {};
    for (const key of keys) {
      if (record[key] !== undefined) {
        summary[key] = record[key];
      }
    }

    return Object.keys(summary).length > 0 ? summary : undefined;
  }

  /**
   * Safely extract request object from NestJS ExecutionContext
   */
  private extractRequest(request: unknown): HttpRequest {
    const req = request as Record<string, unknown>;
    return {
      method: (req['method'] as string) || 'UNKNOWN',
      url: (req['url'] as string) || '/',
      body: req['body'],
      headers: (req['headers'] as Record<string, string>) || {},
      ip: (req['ip'] as string) || 'unknown',
    };
  }

  /**
   * Safely extract response object from NestJS ExecutionContext
   */
  private extractResponse(response: unknown): HttpResponse {
    const res = response as Record<string, unknown>;
    return {
      statusCode: (res['statusCode'] as number) || 200,
    };
  }
}
