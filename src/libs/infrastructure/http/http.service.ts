/**
 * Centralized HTTP Service
 * @class HttpService
 * @description Centralized HTTP service using NestJS HttpService with error handling, logging, and retries
 *
 * This service wraps @nestjs/axios HttpService to provide:
 * - Consistent error handling with HealthcareError
 * - Automatic request/response logging
 * - Retry logic with exponential backoff
 * - Type-safe request/response handling
 * - Request timeout management
 * - Health check capabilities
 *
 * @example
 * ```typescript
 * constructor(private readonly httpService: HttpService) {}
 *
 * async fetchData() {
 *   const response = await this.httpService.get<MyType>('https://api.example.com/data', {
 *     retries: 3,
 *     timeout: 5000,
 *   });
 *   return response.data;
 * }
 * ```
 */

import { Injectable, Inject, Optional, forwardRef } from '@nestjs/common';
import { HttpService as NestHttpService } from '@nestjs/axios';
import { firstValueFrom, catchError, throwError, timer } from 'rxjs';
import { retryWhen, scan, mergeMap } from 'rxjs/operators';
import type { AxiosRequestConfig, AxiosResponse } from 'axios';
import * as https from 'https';

import { LoggingService } from '@infrastructure/logging';
import { HealthcareError, ErrorCode } from '@core/errors';
import { LogType, LogLevel } from '@core/types';

import type { HttpRequestOptions, HttpResponse, RetryConfig } from '@core/types';
import { DEFAULT_RETRY_CONFIG } from '@core/types';

/**
 * Centralized HTTP Service for making HTTP requests
 *
 * Provides a unified interface for HTTP requests with:
 * - Automatic error handling and transformation
 * - Request/response logging
 * - Retry logic with exponential backoff
 * - Type-safe responses
 * - Health check support
 */
@Injectable()
export class HttpService {
  private readonly defaultTimeout: number;
  private readonly defaultRetries: number;

  constructor(
    @Inject(forwardRef(() => NestHttpService))
    private readonly nestHttpService: NestHttpService,
    @Inject(forwardRef(() => LoggingService))
    @Optional()
    private readonly loggingService?: LoggingService
  ) {
    // Get default timeout from environment or config (default: 30 seconds)
    // Read directly from process.env to avoid circular dependency with ConfigService
    const timeoutEnv = process.env['http.timeout'] || process.env['HTTP_TIMEOUT'];
    this.defaultTimeout = timeoutEnv ? Number.parseInt(timeoutEnv, 10) : 30000;

    // Get default retries from environment or config (default: 0)
    const retriesEnv = process.env['http.retries'] || process.env['HTTP_RETRIES'];
    this.defaultRetries = retriesEnv ? Number.parseInt(retriesEnv, 10) : 0;
  }

  /**
   * Make a GET request
   */
  async get<T = unknown>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('GET', url, undefined, options);
  }

  /**
   * Make a POST request
   */
  async post<T = unknown, D = unknown>(
    url: string,
    data?: D,
    options?: HttpRequestOptions
  ): Promise<HttpResponse<T>> {
    return this.request<T, D>('POST', url, data, options);
  }

  /**
   * Make a PUT request
   */
  async put<T = unknown, D = unknown>(
    url: string,
    data?: D,
    options?: HttpRequestOptions
  ): Promise<HttpResponse<T>> {
    return this.request<T, D>('PUT', url, data, options);
  }

  /**
   * Make a PATCH request
   */
  async patch<T = unknown, D = unknown>(
    url: string,
    data?: D,
    options?: HttpRequestOptions
  ): Promise<HttpResponse<T>> {
    return this.request<T, D>('PATCH', url, data, options);
  }

  /**
   * Make a DELETE request
   */
  async delete<T = unknown>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('DELETE', url, undefined, options);
  }

  /**
   * Make a HEAD request
   */
  async head<T = unknown>(url: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    return this.request<T>('HEAD', url, undefined, options);
  }

  /**
   * Make a generic HTTP request
   */
  private async request<T = unknown, D = unknown>(
    method: string,
    url: string,
    data?: D,
    options?: HttpRequestOptions
  ): Promise<HttpResponse<T>> {
    const startTime = Date.now();
    const requestId = `${method}-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    // Merge options with defaults
    const retryConfig: RetryConfig = {
      maxRetries: options?.retries ?? this.defaultRetries,
      delay: options?.retryDelay ?? DEFAULT_RETRY_CONFIG.delay,
      exponentialBackoff: options?.exponentialBackoff ?? DEFAULT_RETRY_CONFIG.exponentialBackoff,
      shouldRetry: options?.shouldRetry ?? DEFAULT_RETRY_CONFIG.shouldRetry,
    };

    // Build axios config - extract only AxiosRequestConfig properties
    const {
      retries: _retries,
      retryDelay: _retryDelay,
      exponentialBackoff: _exponentialBackoff,
      shouldRetry: _shouldRetry,
      logRequest: _logRequest,
      headers: _customHeaders,
      timeout: _customTimeout,
      ...axiosConfigBase
    } = options || {};

    // Ensure method is always defined (required by AxiosRequestConfig)
    const httpMethod = (method as AxiosRequestConfig['method']) || 'GET';

    // Build config - use type assertion to handle exactOptionalPropertyTypes strictness
    const axiosConfig = {
      ...axiosConfigBase,
      method: httpMethod,
      url,
      ...(data !== undefined && { data }),
      timeout: options?.timeout ?? this.defaultTimeout,
      ...(options?.headers && { headers: options.headers as AxiosRequestConfig<D>['headers'] }),
    } as AxiosRequestConfig<D>;

    // Log request if enabled
    if (options?.logRequest !== false && this.loggingService) {
      void this.loggingService.log(
        LogType.SYSTEM,
        LogLevel.DEBUG,
        `HTTP ${method} ${url}`,
        'HttpService',
        {
          requestId,
          method,
          url,
          hasData: data !== undefined,
        }
      );
    }

    // Create observable with retry logic
    const request$ = this.nestHttpService.request<T>(axiosConfig).pipe(
      catchError((error: unknown) => {
        // Log error with detailed information
        const axiosError = error as {
          code?: string;
          errno?: string;
          syscall?: string;
          address?: string;
          port?: number;
          message?: string;
          config?: { url?: string };
          response?: { status?: number; statusText?: string; data?: unknown };
        };
        const errorCode = axiosError.code || (error as { code?: string })?.code;
        const errorMessage =
          axiosError.message || (error instanceof Error ? error.message : String(error));

        // Use original requested URL, not the URL from error.config (which might be after redirects)
        // This ensures we log the URL that was actually requested, not a redirected URL
        const loggedUrl = url; // Always use the original URL parameter

        // Determine log level based on error type and context
        // Health check failures and connection errors are less critical than application errors
        // Also check if this is a logger endpoint check (should use localhost, not external URL)
        const isHealthCheck = url.includes('/health') || url.includes('/api/health');
        const isLoggerCheck = url.includes('/logger') && !url.includes('localhost');
        const isOpenViduCheck =
          url.includes('openvidu') || url.includes('backend-service-v1-video');
        const errorStatus = axiosError.response?.status;
        // 403/401 from OpenVidu are expected (server is responding, just blocking access)
        // These should be treated as healthy, not logged as errors
        const isExpectedOpenVidu403 =
          isOpenViduCheck && (errorStatus === 403 || errorStatus === 401);
        const isConnectionError =
          errorCode === 'ECONNREFUSED' ||
          errorCode === 'ENOTFOUND' ||
          errorCode === 'ETIMEDOUT' ||
          errorCode === 'EHOSTUNREACH' ||
          errorCode === 'ENETUNREACH';
        const isExpectedFailure =
          isHealthCheck || isConnectionError || isLoggerCheck || isExpectedOpenVidu403;
        // Don't log at all for expected OpenVidu 403/401 (they're treated as healthy)
        const shouldSkipLogging = isExpectedOpenVidu403;
        const logLevel = isExpectedFailure ? LogLevel.WARN : LogLevel.ERROR;
        const logType = isExpectedFailure ? LogType.SYSTEM : LogType.ERROR;

        // Skip logging for expected OpenVidu 403/401 responses (they're treated as healthy)
        // The validateStatus function will handle these as valid responses
        if (shouldSkipLogging) {
          // Still throw the error so validateStatus can handle it, but don't log
          return throwError(() => error);
        }

        if (this.loggingService) {
          void this.loggingService.log(
            logType,
            logLevel,
            `HTTP ${method} ${loggedUrl} failed: ${errorMessage}${errorCode ? ` (${errorCode})` : ''}`,
            'HttpService',
            {
              requestId,
              method,
              url: loggedUrl, // Use original URL, not redirected URL
              originalUrl: url, // Keep original for reference
              errorUrl: axiosError.config?.url, // Show if different (redirect happened)
              error: errorMessage,
              errorCode,
              errno: axiosError.errno,
              syscall: axiosError.syscall,
              address: axiosError.address,
              port: axiosError.port,
              responseStatus: axiosError.response?.status,
              responseStatusText: axiosError.response?.statusText,
              isHealthCheck,
              isLoggerCheck,
              isConnectionError,
            }
          );
        }
        return throwError(() => error);
      })
    );

    // Apply retry logic if configured
    const retryableRequest$ =
      retryConfig.maxRetries > 0
        ? request$.pipe(
            retryWhen(errors =>
              errors.pipe(
                scan((retryCount: number, error: unknown) => {
                  // Check if we should retry
                  if (!retryConfig.shouldRetry(error) || retryCount >= retryConfig.maxRetries) {
                    throw error;
                  }

                  // Calculate delay
                  const delayMs = retryConfig.exponentialBackoff
                    ? retryConfig.delay * Math.pow(2, retryCount)
                    : retryConfig.delay;

                  // Log retry
                  if (this.loggingService) {
                    void this.loggingService.log(
                      LogType.SYSTEM,
                      LogLevel.WARN,
                      `HTTP ${method} ${url} retry ${retryCount + 1}/${retryConfig.maxRetries}`,
                      'HttpService',
                      {
                        requestId,
                        method,
                        url,
                        retryCount: retryCount + 1,
                        delayMs,
                      }
                    );
                  }

                  return retryCount + 1;
                }, 0),
                mergeMap((retryCount: number) => {
                  // Calculate delay for this retry
                  const delayMs = retryConfig.exponentialBackoff
                    ? retryConfig.delay * Math.pow(2, retryCount - 1)
                    : retryConfig.delay;
                  return timer(delayMs);
                })
              )
            )
          )
        : request$;

    try {
      const response: AxiosResponse<T> = await firstValueFrom(retryableRequest$);
      const requestDuration = Date.now() - startTime;

      // Log successful response
      if (options?.logRequest !== false && this.loggingService) {
        void this.loggingService.log(
          LogType.SYSTEM,
          LogLevel.DEBUG,
          `HTTP ${method} ${url} completed`,
          'HttpService',
          {
            requestId,
            method,
            url,
            status: response.status,
            duration: requestDuration,
          }
        );
      }

      return {
        data: response.data,
        status: response.status,
        statusText: response.statusText,
        headers: response.headers as Record<string, string>,
        config: response.config,
        requestDuration,
      };
    } catch (error) {
      const requestDuration = Date.now() - startTime;

      // Transform to HealthcareError
      if (error && typeof error === 'object' && 'response' in error && error.response) {
        const axiosError = error as {
          response?: { status?: number; statusText?: string; data?: unknown };
          message?: string;
        };
        const status = axiosError.response?.status ?? 500;
        const statusText = axiosError.response?.statusText ?? 'Internal Server Error';

        throw new HealthcareError(
          ErrorCode.EXTERNAL_SERVICE_UNAVAILABLE,
          `HTTP ${method} ${url} failed: ${statusText}`,
          undefined,
          {
            url,
            method,
            status,
            statusText,
            requestDuration,
            responseData: axiosError.response?.data,
          },
          'HttpService.request'
        );
      }

      // Network or other errors
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Extract more detailed error information
      const axiosError = error as {
        code?: string;
        errno?: string;
        syscall?: string;
        address?: string;
        port?: number;
        message?: string;
        response?: { status?: number; statusText?: string; data?: unknown };
      };

      const errorCode = axiosError.code || (error as { code?: string })?.code;
      const errorDetails = {
        url,
        method,
        requestDuration,
        error: errorMessage,
        errorCode,
        errno: axiosError.errno,
        syscall: axiosError.syscall,
        address: axiosError.address,
        port: axiosError.port,
      };

      // Determine log level based on error type and context
      // Health check failures and connection errors are less critical than application errors
      const isHealthCheck = url.includes('/health') || url.includes('/api/health');
      const isConnectionError =
        errorCode === 'ECONNREFUSED' ||
        errorCode === 'ENOTFOUND' ||
        errorCode === 'ETIMEDOUT' ||
        errorCode === 'EHOSTUNREACH' ||
        errorCode === 'ENETUNREACH';
      const isExpectedFailure = isHealthCheck || isConnectionError;
      const logLevel = isExpectedFailure ? LogLevel.WARN : LogLevel.ERROR;
      const logType = isExpectedFailure ? LogType.SYSTEM : LogType.ERROR;

      // Log detailed error for debugging (especially for connection errors)
      if (this.loggingService) {
        void this.loggingService.log(
          logType,
          logLevel,
          `HTTP ${method} ${url} failed: ${errorMessage}${errorCode ? ` (code: ${errorCode})` : ''}`,
          'HttpService.request',
          {
            ...errorDetails,
            isHealthCheck,
            isConnectionError,
          }
        );
      }

      throw new HealthcareError(
        ErrorCode.EXTERNAL_SERVICE_UNAVAILABLE,
        `HTTP ${method} ${url} failed: ${errorMessage}${errorCode ? ` (${errorCode})` : ''}`,
        undefined,
        errorDetails,
        'HttpService.request'
      );
    }
  }

  /**
   * Get HTTP config with SSL verification skipped in development
   * Useful for self-signed certificates in development
   */
  getHttpConfig(options?: Partial<AxiosRequestConfig>): AxiosRequestConfig {
    const isDev = process.env['NODE_ENV'] === 'development' || process.env['IS_DEV'] === 'true';

    const config: AxiosRequestConfig = {
      ...options,
    };

    if (isDev && options?.url?.startsWith('https://')) {
      config.httpsAgent = new https.Agent({
        rejectUnauthorized: false, // Skip SSL verification for self-signed certificates in development
      });
    }

    return config;
  }

  /**
   * Health check - verify HTTP service is available
   */
  isHealthy(): boolean {
    try {
      // Simple check - verify nestHttpService is available
      return this.nestHttpService !== null && this.nestHttpService !== undefined;
    } catch {
      return false;
    }
  }
}
