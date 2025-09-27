import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import { FastifyReply } from "fastify";

// Type definition for request object with expected properties
interface CustomFastifyRequest {
  url: string;
  method: string;
  body?: any;
  headers: {
    "user-agent"?: string;
    "x-forwarded-for"?: string;
    "x-real-ip"?: string;
    "x-clinic-id"?: string;
    [key: string]: string | undefined;
  };
  query?: Record<string, any>;
  params?: Record<string, any>;
  ip?: string;
  user?: {
    sub: string;
    role: string;
    [key: string]: any;
  };
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

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

  private isIgnored404(path: string, status: number): boolean {
    if (status !== 404) return false;
    return this.ignored404Patterns.some((pattern) => pattern.test(path));
  }

  catch(exception: any, host: ArgumentsHost) {
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
    const errorLog = {
      path: request.url,
      method: request.method,
      statusCode: status,
      timestamp: new Date().toISOString(),
      message: (exception as Error).message || "Internal server error",
      stack: (exception as Error).stack,
      body: this.sanitizeRequestBody(request.body),
      headers: this.sanitizeHeaders(request.headers),
      query: request.query,
      params: request.params,
      userAgent: request.headers["user-agent"],
      ip:
        request.ip ||
        request.headers["x-forwarded-for"] ||
        request.headers["x-real-ip"],
      clinicId: request.headers["x-clinic-id"],
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
    const errorResponse: Record<string, any> = {
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
      errorResponse.suggestion =
        "Check if the endpoint exists and you have the correct permissions";
    } else if (status === 401) {
      errorResponse.suggestion =
        "Please provide valid authentication credentials";
    } else if (status === 403) {
      errorResponse.suggestion =
        "You do not have permission to access this resource";
    } else if (status === 422) {
      errorResponse.suggestion = "Please check your request data and try again";
    } else if (status >= 500) {
      errorResponse.suggestion =
        "An internal server error occurred. Please try again later";
      // Don't expose internal error details in production
      if (process.env.NODE_ENV === "production") {
        errorResponse.message = "Internal server error";
        delete errorResponse.stack;
      }
    }

    // Send appropriate response
    response.status(status).send(errorResponse);
  }

  // Categorize errors for better logging
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

  // Remove sensitive data from request body for logging
  private sanitizeRequestBody(body: unknown): Record<string, any> {
    if (!body || typeof body !== "object") return {};

    const sanitized = { ...(body as Record<string, any>) };

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

  // Remove sensitive headers for logging
  private sanitizeHeaders(headers: unknown): Record<string, any> {
    if (!headers || typeof headers !== "object") return {};

    const sanitized = { ...(headers as Record<string, any>) };

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
