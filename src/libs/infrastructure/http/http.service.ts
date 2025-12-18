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
        // Log error
        if (this.loggingService) {
          void this.loggingService.log(
            LogType.SYSTEM,
            LogLevel.ERROR,
            `HTTP ${method} ${url} failed`,
            'HttpService',
            {
              requestId,
              method,
              url,
              error: error instanceof Error ? error.message : String(error),
              statusCode:
                error &&
                typeof error === 'object' &&
                'response' in error &&
                error.response &&
                typeof error.response === 'object' &&
                'status' in error.response
                  ? (error.response.status as number)
                  : undefined,
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

      throw new HealthcareError(
        ErrorCode.EXTERNAL_SERVICE_UNAVAILABLE,
        `HTTP ${method} ${url} failed: ${errorMessage}`,
        undefined,
        {
          url,
          method,
          requestDuration,
          error: errorMessage,
        },
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
