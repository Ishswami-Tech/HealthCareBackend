// External imports
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

// Internal imports - Infrastructure
import { LoggingService } from '@logging';

// Internal imports - Types
import { LogType, LogLevel } from '@core/types';
import {
  accessLogSeverity,
  formatAccessLogLine,
  isSlowRequest,
  resolveRequestId,
  toDurationMs,
  type AccessLogSeverity,
} from '@infrastructure/logging/access-log.util';

/**
 * Interface for HTTP request object from NestJS ExecutionContext
 */
interface HttpRequest {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string>;
  ip: string;
  /** Fastify request id (incoming x-request-id or a generated UUID, see access-log.util). */
  requestId: string;
  /** Matched route pattern, e.g. /api/v1/appointments/:id (undefined for unmatched routes). */
  route: string | undefined;
}

const SEVERITY_LEVEL: Readonly<Record<AccessLogSeverity, LogLevel>> = {
  INFO: LogLevel.INFO,
  WARN: LogLevel.WARN,
  ERROR: LogLevel.ERROR,
};

/**
 * Interface for HTTP response object from NestJS ExecutionContext
 */
interface HttpResponse {
  statusCode: number;
}

/**
 * The error code of a failed request: the error's own `code` (HealthcareError), else the `code`
 * of an HttpException body (e.g. 409 { code: 'CONSULTATION_IN_PROGRESS' }), else UNKNOWN_ERROR.
 */
function errorCodeOf(error: unknown): string {
  const own = (error as { code?: unknown } | null)?.code;
  if (typeof own === 'string' && own) return own;
  const getResponse = (error as { getResponse?: () => unknown } | null)?.getResponse;
  if (typeof getResponse === 'function') {
    const body = getResponse.call(error) as { code?: unknown } | string | null;
    if (body && typeof body === 'object' && typeof body.code === 'string' && body.code) {
      return body.code;
    }
  }
  return 'UNKNOWN_ERROR';
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly SKIP_LOG_PATHS = [
    '/api-health',
    '/socket.io/socket.io.js',
    '/logger/health',
    '/logger/logs',
    '/logger/events',
    '/metrics',
    '/status',
  ];

  constructor(private readonly loggingService: LoggingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const request = this.extractRequest(httpContext.getRequest());
    const { method, url, body, headers, ip, requestId, route } = request;
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

    void this.loggingService.log(
      LogType.REQUEST,
      LogLevel.INFO,
      `${method} ${url} rid=${requestId}`,
      'API',
      {
        method,
        url,
        requestId,
        body: this.sanitizeBody(body),
        ...(requestSummary ? { requestSummary } : {}),
        ip,
        userAgent,
      }
    );

    return next.handle().pipe(
      tap({
        next: responseBody => {
          const durationMs = toDurationMs(startTime, Date.now());
          const response = this.extractResponse(context.switchToHttp().getResponse());
          const statusCode = response.statusCode;
          const responseSummary = this.summarizeResponse(responseBody);
          const slow = isSlowRequest(durationMs);
          void this.loggingService.log(
            slow ? LogType.PERFORMANCE : LogType.RESPONSE,
            SEVERITY_LEVEL[accessLogSeverity(statusCode, durationMs)],
            formatAccessLogLine({ method, url, statusCode, durationMs, requestId, route }),
            'API',
            {
              method,
              url,
              ...(route ? { route } : {}),
              requestId,
              durationMs,
              duration: `${durationMs}ms`,
              statusCode,
              ...(slow ? { slow: true } : {}),
              response: responseSummary,
              ...(responseSummary ? { responseSummary } : {}),
            }
          );
        },
        error: error => {
          const durationMs = toDurationMs(startTime, Date.now());

          // A 4xx is the client or a business rule being told "no" and is expected traffic
          // (invalid OTP, expired visit, refused completion); only a 5xx is a failure of ours.
          // Logging every refused request at ERROR buried the real failures in production.
          const statusCode = (error as { status?: number }).status || 500;
          void this.loggingService.log(
            LogType.ERROR,
            SEVERITY_LEVEL[accessLogSeverity(statusCode, durationMs)],
            `${formatAccessLogLine({ method, url, statusCode, durationMs, requestId, route })} failed: ${(error as Error).message}`,
            'API',
            {
              method,
              url,
              ...(route ? { route } : {}),
              requestId,
              durationMs,
              duration: `${durationMs}ms`,
              error: {
                message: (error as Error).message,
                code: errorCodeOf(error),
                statusCode,
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

    // Multipart file fields (fastify-multipart's attachFieldsToBody) carry the raw file
    // buffer on the request body - e.g. { buffer, mimetype, originalname, size }. Logging
    // that buffer briefly holds/copies multi-MB (patient document / PHI) bytes in the log
    // pipeline for no benefit, so omit it here rather than relying only on redaction.
    Object.keys(sanitized).forEach(key => {
      const value = sanitized[key];
      const nestedBuffer =
        value && typeof value === 'object'
          ? (value as Record<string, unknown>)['buffer']
          : undefined;
      if (ArrayBuffer.isView(value) || ArrayBuffer.isView(nestedBuffer)) {
        sanitized[key] = '[file omitted]';
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
    const headers = (req['headers'] as Record<string, string>) || {};
    const routeOptions = req['routeOptions'] as { url?: unknown } | undefined;
    const ownId = req['id'];
    return {
      method: (req['method'] as string) || 'UNKNOWN',
      url: (req['url'] as string) || '/',
      body: req['body'],
      headers,
      ip: (req['ip'] as string) || 'unknown',
      // Fastify sets request.id (see FastifyFrameworkAdapter genReqId); resolve the same way when
      // the interceptor runs on a request object without one.
      requestId:
        typeof ownId === 'string' && ownId ? ownId : resolveRequestId(headers['x-request-id']),
      route: typeof routeOptions?.url === 'string' ? routeOptions.url : undefined,
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
