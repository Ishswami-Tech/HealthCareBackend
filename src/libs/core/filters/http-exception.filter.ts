import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { FastifyReply } from "fastify";

/**
 * User information interface for request context
 *
 * @interface RequestUser
 * @description Defines the structure of user information in request context
 */
export interface RequestUser {
  readonly sub: string;
  readonly role: string;
  readonly [key: string]: unknown;
}

/**
 * Request headers interface with healthcare-specific headers
 *
 * @interface RequestHeaders
 * @description Defines the structure of request headers including healthcare-specific ones
 */
export interface RequestHeaders {
  readonly "user-agent"?: string;
  readonly "x-forwarded-for"?: string;
  readonly "x-real-ip"?: string;
  readonly "x-clinic-id"?: string;
  readonly authorization?: string;
  readonly cookie?: string;
  readonly [key: string]: string | undefined;
}

/**
 * Custom Fastify request interface with healthcare-specific properties
 *
 * @interface CustomFastifyRequest
 * @description Enhanced request interface for healthcare applications
 */
export interface CustomFastifyRequest {
  readonly url: string;
  readonly method: string;
  readonly body?: unknown;
  readonly headers: RequestHeaders;
  readonly query?: Record<string, unknown>;
  readonly params?: Record<string, unknown>;
  readonly ip?: string;
  readonly user?: RequestUser;
}

/**
 * Error log structure for comprehensive error tracking
 *
 * @interface ErrorLog
 * @description Defines the structure of error logs for debugging and monitoring
 */
export interface ErrorLog {
  readonly path: string;
  readonly method: string;
  readonly statusCode: number;
  readonly timestamp: string;
  readonly message: string;
  readonly stack?: string;
  readonly body: Record<string, unknown>;
  readonly headers: Record<string, unknown>;
  readonly query?: Record<string, unknown>;
  readonly params?: Record<string, unknown>;
  readonly userAgent?: string;
  readonly ip?: string;
  readonly clinicId?: string;
  readonly errorType?: string;
  readonly userInfo?:
    | {
        readonly id: string;
        readonly role: string;
      }
    | "unauthenticated";
}

/**
 * Error response structure for API responses
 *
 * @interface ErrorResponse
 * @description Defines the structure of error responses sent to clients
 */
export interface ErrorResponse {
  readonly statusCode: number;
  readonly timestamp: string;
  readonly path: string;
  readonly method: string;
  readonly message?: string;
  readonly suggestion?: string;
  readonly [key: string]: unknown;
}

/**
 * Global HTTP Exception Filter for Healthcare Applications
 *
 * @class HttpExceptionFilter
 * @implements ExceptionFilter
 * @description Comprehensive exception filter for healthcare applications with enhanced logging,
 * security, and error handling. Provides structured error responses and sanitized logging.
 *
 * @example
 * ```typescript
 * // app.module.ts
 * import { APP_FILTER } from '@nestjs/core';
 * import { HttpExceptionFilter } from '@libs/core/filters';
 *
 * @Module({
 *   providers: [
 *     {
 *       provide: APP_FILTER,
 *       useClass: HttpExceptionFilter,
 *     },
 *   ],
 * })
 * export class AppModule {}
 * ```
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

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
  ];

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
    return this.ignored404Patterns.some((pattern) => pattern.test(path));
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
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException
        ? exception.getResponse()
        : { message: "Internal server error" };

    // Enhanced error logging with better context
    const errorLog: ErrorLog = {
      path: request.url,
      method: request.method,
      statusCode: status,
      timestamp: new Date().toISOString(),
      message: (exception as Error).message || "Internal server error",
      ...((exception as Error).stack && { stack: (exception as Error).stack }),
      body: this.sanitizeRequestBody(request.body),
      headers: this.sanitizeHeaders(request.headers),
      ...(request.query && { query: request.query }),
      ...(request.params && { params: request.params }),
      ...(request.headers["user-agent"] && {
        userAgent: request.headers["user-agent"],
      }),
      ...((request.ip ||
        request.headers["x-forwarded-for"] ||
        request.headers["x-real-ip"]) && {
        ip:
          request.ip ||
          request.headers["x-forwarded-for"] ||
          request.headers["x-real-ip"],
      }),
      ...(request.headers["x-clinic-id"] && {
        clinicId: request.headers["x-clinic-id"],
      }),
    };

    // Enhanced error categorization and logging
    if (status >= 500) {
      this.logger.error(
        `[ERROR] [API] ${request.method} ${request.url} failed: ${(exception as Error).message}`,
        errorLog,
      );
    } else if (status === 404 && this.isIgnored404(request.url, status)) {
      // Skip logging for ignored 404 paths
      // Do nothing
    } else if (status >= 400) {
      // Enhanced client error logging
      const errorType = this.categorizeError(status);
      this.logger.warn(
        `[${errorType}] [API] ${request.method} ${request.url} failed: ${(exception as Error).message}`,
        {
          ...errorLog,
          errorType,
          userInfo: request.user
            ? { id: request.user.sub, role: request.user.role }
            : "unauthenticated",
        },
      );
    }

    // Enhanced error response with more context
    const errorResponse: Record<string, unknown> = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      ...(typeof exceptionResponse === "object"
        ? exceptionResponse
        : { message: exceptionResponse }),
    };

    // Add additional context for specific error types
    if (status === 404) {
      errorResponse["suggestion"] =
        "Check if the endpoint exists and you have the correct permissions";
    } else if (status === 401) {
      errorResponse["suggestion"] =
        "Please provide valid authentication credentials";
    } else if (status === 403) {
      errorResponse["suggestion"] =
        "You do not have permission to access this resource";
    } else if (status === 422) {
      errorResponse["suggestion"] =
        "Please check your request data and try again";
    } else if (status >= 500) {
      errorResponse["suggestion"] =
        "An internal server error occurred. Please try again later";
      // Don't expose internal error details in production
      if (process.env["NODE_ENV"] === "production") {
        errorResponse["message"] = "Internal server error";
        delete errorResponse["stack"];
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
    if (status === 400) return "BAD_REQUEST";
    if (status === 401) return "UNAUTHORIZED";
    if (status === 403) return "FORBIDDEN";
    if (status === 404) return "NOT_FOUND";
    if (status === 409) return "CONFLICT";
    if (status === 422) return "VALIDATION_ERROR";
    if (status === 429) return "RATE_LIMIT";
    if (status >= 500) return "SERVER_ERROR";
    return "CLIENT_ERROR";
  }

  /**
   * Removes sensitive data from request body for safe logging
   *
   * @param body - The request body to sanitize
   * @returns Sanitized request body with sensitive fields redacted
   * @private
   */
  private sanitizeRequestBody(body: unknown): Record<string, unknown> {
    if (!body || typeof body !== "object") return {};

    const sanitized = { ...(body as Record<string, unknown>) };

    // Remove sensitive fields
    const sensitiveFields = [
      "password",
      "token",
      "accessToken",
      "refreshToken",
      "credit_card",
      "creditCard",
      "ssn",
      "social_security",
      "api_key",
      "apiKey",
      "secret",
      "private_key",
    ];
    sensitiveFields.forEach((field) => {
      if (field in sanitized && sanitized[field]) {
        sanitized[field] = "[REDACTED]";
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
  private sanitizeHeaders(headers: unknown): Record<string, unknown> {
    if (!headers || typeof headers !== "object") return {};

    const sanitized = { ...(headers as Record<string, unknown>) };

    // Remove sensitive headers
    const sensitiveHeaders = [
      "authorization",
      "cookie",
      "x-session-id",
      "x-api-key",
      "x-auth-token",
      "x-secret",
    ];
    sensitiveHeaders.forEach((header) => {
      if (header in sanitized && sanitized[header]) {
        sanitized[header] = "[REDACTED]";
      }
    });

    return sanitized;
  }
}
