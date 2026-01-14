import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@config/config.service';
import { FastifyReply } from 'fastify';
import { LoggingService } from '@infrastructure/logging';
import { LogType, LogLevel } from '@core/types';
import { HealthcareError } from '@core/errors';
import type {
  RequestHeaders,
  ErrorLog,
  CustomFastifyRequest,
} from '@core/types/infrastructure.types';

// Export CustomFastifyRequest for use in other modules
export type { CustomFastifyRequest } from '@core/types/infrastructure.types';

/**
 * Global HTTP Exception Filter for Healthcare Applications
 *
 * @class HttpExceptionFilter
 * @implements ExceptionFilter
 * @description Comprehensive exception filter for healthcare applications with enhanced logging,
 * security, and error handling. Provides structured error responses and sanitized logging.
 *
 * @remarks
 * - Uses Fastify-specific types (FastifyReply, CustomFastifyRequest) as per AI rules:
 *   Fastify is the only allowed HTTP framework, so framework-agnostic abstraction is not required.
 * - Requires LoggingService in constructor for structured logging.
 * - Sanitizes sensitive data (passwords, tokens, headers) before logging.
 * - Provides enhanced error categorization and context for healthcare applications.
 *
 * @example
 * ```typescript
 * // In main.ts or bootstrap
 * const filter = new HttpExceptionFilter(loggingService);
 * app.useGlobalFilters(filter);
 *
 * // Or via MiddlewareManager
 * middlewareManager.configureFilters(app, [
 *   {
 *     filter: HttpExceptionFilter,
 *     constructorArgs: [loggingService]
 *   }
 * ]);
 * ```
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly loggingService: LoggingService,
    @Inject(ConfigService) private readonly configService: ConfigService
  ) {}

  /**
   * Patterns for 404 errors that should be ignored in logging
   * These are typically static assets or common bot requests
   *
   * @private
   * @readonly
   */
  private readonly ignored404Patterns = [
    /\.env(\.|$)/i, // any .env file
    /favicon\.ico$/i,
    /robots\.txt$/i,
    /sitemap\.xml$/i,
    /\/redmine\//i,
    /\/uploads\//i,
    /\/lib\//i,
    /\/sendgrid\.env$/i,
    /\/aws\.env$/i,
    /\/main\/\.env$/i,
    /\/docs\/\.env$/i,
    /\/client\/\.env$/i,
    /\/blogs\/\.env$/i,
    /\/shared\/\.env$/i,
    /\/download\/\.env$/i,
    /\/site\/\.env$/i,
    /\/sites\/\.env$/i,
    /\/web\/\.env$/i,
    /\/database\/\.env$/i,
    /\/backend\/\.env$/i,
    /\/geoserver\/web\//i,
    /\/webui\//i,
    /\/stacks$/i,
    /\/api\/v\d+\/health(\/|$)/i, // Ignore /api/v1/health, /api/v2/health, etc. (common monitoring endpoints)
    /\/health(\/|$)/i, // Ignore /health endpoint variations
    // Security scanner probes (reduce log noise)
    /\/ws\/v\d+\/cluster/i, // Kubernetes API endpoints (scanner probes)
    /\/\.\./i, // Path traversal attempts
    /\/etc\/passwd/i, // Common vulnerability probes
    /\/cgi-bin/i, // CGI script probes
    /\/cgi-mod/i, // CGI module probes
    /\.php$/i, // PHP file probes
    /\.aspx$/i, // ASP.NET probes
    /\.jsp$/i, // JSP probes
    /\.pl$/i, // Perl script probes
    /\.cfm$/i, // ColdFusion probes
    /\.cgi$/i, // CGI script probes
    /\/admin\.(php|pl|jsp|aspx)/i, // Admin panel probes
    /\/login\.(php|pl|jsp|aspx)/i, // Login page probes
    /\/wp-/i, // WordPress probes
    /\/magento/i, // Magento probes
    /\/joomla/i, // Joomla probes
    /\/confluence/i, // Confluence probes
    /\/dana-na/i, // VPN probes
    /\/CFIDE/i, // ColdFusion probes
    /\/+CSCOE+/i, // Cisco VPN probes
    /\/nmaplowercheck/i, // Nmap probes
    /\/nice%20ports/i, // Port scanner probes
    /\/Tri.*\.txt/i, // Scanner probes
    /\/readme\.txt$/i, // Common file probes
    /\/base\.cgi$/i, // CGI probes
    /\/start\.(cgi|pl|php|cfm)/i, // Startup script probes
    /\/localstart\.(pl|php|cfm)/i, // Local startup probes
    /\/index\.(cgi|pl|php|cfm)/i, // Index script probes
    /\/evox/i, // Evox probes
    /\/geoserver/i, // GeoServer probes
    /\/fog/i, // FOG probes
    /\/helpdesk/i, // Helpdesk probes
    /\/versa/i, // Versa probes
    /\/rest\/applinks/i, // AppLinks probes
    /\/administrator\/manifests/i, // Joomla admin probes
    /\/language\/en-GB/i, // Joomla language probes
    /\/ise\/img/i, // ISE probes
    /\/dniapi/i, // DNA API probes
    /\/dana-cached/i, // VPN cached probes
    /\/human\.aspx/i, // ASP.NET probes
    /\/home\.aspx/i, // ASP.NET probes
    /\/Account\/Login/i, // ASP.NET login probes
    /\/inicio\.aspx/i, // ASP.NET probes
    /\/xml\/info\.xml$/i, // XML info probes
    /\/magento_version$/i, // Magento version probes
    /\/cluster\/list\.query$/i, // Cluster query probes
    /\/indice\.shtml$/i, // SHTML probes
    /\/p\/login/i, // Login path probes
    /\/main\.jsa$/i, // JSA probes
    /\/sdk$/i, // SDK probes
    /\/check-version$/i, // Version check probes
    // Next.js frontend routes (common when frontend hits backend)
    /^\/_next/i, // Next.js internal routes
    /^\/app(\/|$)/i, // Next.js app directory routes
    /^\/api\/route(\/|$)/i, // Next.js API routes
    /^\/index\.htm$/i, // Common index file probes
    /^\/api-docs$/i, // Swagger docs (might be using /docs instead)
  ];

  /**
   * Checks if an OPTIONS request 404 should be ignored
   * OPTIONS requests are CORS preflight requests and 404s are expected if routes aren't registered yet
   *
   * @param method - The HTTP method
   * @param path - The request path
   * @param status - The HTTP status code
   * @returns True if the OPTIONS 404 should be ignored
   * @private
   */
  private isIgnoredOptions404(method: string, path: string, status: number): boolean {
    if (method !== 'OPTIONS' || status !== 404) return false;
    // Ignore OPTIONS 404 for health endpoints (common monitoring endpoints)
    return /^\/health(\/|$)/i.test(path);
  }

  /**
   * Checks if a 404 error should be ignored in logging
   *
   * @param path - The request path
   * @param status - The HTTP status code
   * @returns True if the 404 error should be ignored
   * @private
   */
  private isIgnored404(path: string, status: number): boolean {
    if (status !== 404) return false;
    return this.ignored404Patterns.some(pattern => pattern.test(path));
  }

  /**
   * Main exception handling method
   *
   * @param exception - The exception that was thrown
   * @param host - The arguments host containing request/response context
   * @description Handles all exceptions, provides structured logging, and sends appropriate responses
   */
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<CustomFastifyRequest>();

    // Get status code and message
    // Check for HealthcareError first (it extends HttpException but has custom properties)
    let status: number;
    let exceptionResponse: unknown;

    if (exception instanceof HealthcareError) {
      status = exception.getStatus();
      exceptionResponse = {
        code: exception.code,
        message: exception.message,
        timestamp: exception.timestamp,
        ...(exception.metadata && { metadata: exception.metadata }),
      };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      exceptionResponse = exception.getResponse();
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      exceptionResponse = { message: 'Internal server error' };
    }

    // Extract error message safely
    const errorMessage =
      exception instanceof Error
        ? exception.message
        : typeof exception === 'string'
          ? exception
          : 'Internal server error';

    // Extract stack trace safely
    const stackTrace = exception instanceof Error ? exception.stack : undefined;

    // Enhanced error logging with better context
    const errorLog: ErrorLog = {
      path: request.url,
      method: request.method,
      statusCode: status,
      timestamp: new Date().toISOString(),
      message: errorMessage,
      ...(stackTrace && { stack: stackTrace }),
      body: this.sanitizeRequestBody(request.body),
      headers: this.sanitizeHeaders(request.headers),
      ...(request.query && { query: request.query }),
      ...(request.params && { params: request.params }),
      ...(request.headers['user-agent'] && {
        userAgent: request.headers['user-agent'],
      }),
      ...((request.ip || request.headers['x-forwarded-for'] || request.headers['x-real-ip']) && {
        ip: request.ip || request.headers['x-forwarded-for'] || request.headers['x-real-ip'],
      }),
      ...(request.headers['x-clinic-id'] && {
        clinicId: request.headers['x-clinic-id'],
      }),
    };

    // Enhanced error categorization and logging
    if (status >= 500) {
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.ERROR,
        `[ERROR] [API] ${request.method} ${request.url} failed: ${errorMessage}`,
        'HttpExceptionFilter',
        errorLog as unknown as Record<string, unknown>
      );
    } else if (
      status === 404 &&
      (this.isIgnored404(request.url, status) ||
        this.isIgnoredOptions404(request.method, request.url, status))
    ) {
      // Skip logging for ignored 404 paths (static assets, OPTIONS preflight, etc.)
      // Do nothing
    } else if (status >= 400) {
      // Enhanced client error logging
      const errorType = this.categorizeError(status);
      void this.loggingService.log(
        LogType.ERROR,
        LogLevel.WARN,
        `[${errorType}] [API] ${request.method} ${request.url} failed: ${errorMessage}`,
        'HttpExceptionFilter',
        {
          ...errorLog,
          errorType,
          userInfo: request.user
            ? { id: request.user.sub, role: request.user.role }
            : 'unauthenticated',
        } as unknown as Record<string, unknown>
      );
    }

    // Enhanced error response with more context
    // Create a mutable response object since ErrorResponse has readonly properties
    const errorResponse: Record<string, unknown> = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      ...(typeof exceptionResponse === 'object' && exceptionResponse !== null
        ? (exceptionResponse as Record<string, unknown>)
        : { message: String(exceptionResponse) }),
    };

    // Add additional context for specific error types
    if (status === 404) {
      errorResponse['suggestion'] =
        'Check if the endpoint exists and you have the correct permissions';
    } else if (status === 401) {
      errorResponse['suggestion'] = 'Please provide valid authentication credentials';
    } else if (status === 403) {
      errorResponse['suggestion'] = 'You do not have permission to access this resource';
    } else if (status === 422) {
      errorResponse['suggestion'] = 'Please check your request data and try again';
    } else if (status >= 500) {
      errorResponse['suggestion'] = 'An internal server error occurred. Please try again later';
      // Don't expose internal error details in production
      // Use ConfigService (which uses dotenv) for environment variable access
      if (this.configService?.isProduction()) {
        errorResponse['message'] = 'Internal server error';
        // Remove stack trace if present
        if ('stack' in errorResponse) {
          delete errorResponse['stack'];
        }
      }
    }

    // Send appropriate response
    response.status(status).send(errorResponse);
  }

  /**
   * Categorizes HTTP status codes for better logging and monitoring
   *
   * @param status - The HTTP status code
   * @returns A string category for the error type
   * @private
   */
  private categorizeError(status: number): string {
    if (status === 400) return 'BAD_REQUEST';
    if (status === 401) return 'UNAUTHORIZED';
    if (status === 403) return 'FORBIDDEN';
    if (status === 404) return 'NOT_FOUND';
    if (status === 409) return 'CONFLICT';
    if (status === 422) return 'VALIDATION_ERROR';
    if (status === 429) return 'RATE_LIMIT';
    if (status >= 500) return 'SERVER_ERROR';
    return 'CLIENT_ERROR';
  }

  /**
   * Removes sensitive data from request body for safe logging
   *
   * @param body - The request body to sanitize
   * @returns Sanitized request body with sensitive fields redacted
   * @private
   */
  private sanitizeRequestBody(body: unknown): Record<string, unknown> {
    if (!body || typeof body !== 'object' || body === null) {
      return {};
    }

    // Type guard to ensure body is a record-like object
    if (Array.isArray(body)) {
      return {};
    }

    const sanitized: Record<string, unknown> = { ...(body as Record<string, unknown>) };

    // Remove sensitive fields
    const sensitiveFields: readonly string[] = [
      'password',
      'token',
      'accessToken',
      'refreshToken',
      'credit_card',
      'creditCard',
      'ssn',
      'social_security',
      'api_key',
      'apiKey',
      'secret',
      'private_key',
    ] as const;

    sensitiveFields.forEach(field => {
      if (field in sanitized && sanitized[field] !== null && sanitized[field] !== undefined) {
        sanitized[field] = '[REDACTED]';
      }
    });

    return sanitized;
  }

  /**
   * Removes sensitive headers for safe logging
   *
   * @param headers - The request headers to sanitize
   * @returns Sanitized headers with sensitive fields redacted
   * @private
   */
  private sanitizeHeaders(headers: RequestHeaders): Record<string, unknown> {
    if (!headers || typeof headers !== 'object' || headers === null) {
      return {};
    }

    // Type guard to ensure headers is a record-like object
    if (Array.isArray(headers)) {
      return {};
    }

    const sanitized: Record<string, unknown> = { ...(headers as Record<string, unknown>) };

    // Remove sensitive headers
    const sensitiveHeaders: readonly string[] = [
      'authorization',
      'cookie',
      'x-session-id',
      'x-api-key',
      'x-auth-token',
      'x-secret',
    ] as const;

    sensitiveHeaders.forEach(header => {
      if (
        header in sanitized &&
        sanitized[header] !== null &&
        sanitized[header] !== undefined &&
        sanitized[header] !== ''
      ) {
        sanitized[header] = '[REDACTED]';
      }
    });

    return sanitized;
  }
}
