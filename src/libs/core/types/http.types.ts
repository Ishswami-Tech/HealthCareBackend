/**
 * HTTP Service Types
 * @module HttpTypes
 * @description Type definitions for HTTP service operations using @nestjs/axios
 * Provides strict TypeScript types for HttpService usage throughout the application
 */

import type { AxiosResponse, AxiosRequestConfig } from 'axios';
import type { Observable } from 'rxjs';
import type { HttpService } from '@nestjs/axios';

/**
 * Type guard to check if HttpService is available and ready to use
 * @param service - The HttpService instance (may be undefined)
 * @returns True if the service is available and has the get method
 */
export function isHttpServiceAvailable(
  service: HttpService | undefined | null
): service is HttpService {
  if (service === undefined || service === null) {
    return false;
  }
  if (typeof service !== 'object') {
    return false;
  }
  const serviceObj = service as { get?: unknown };
  return typeof serviceObj.get === 'function';
}

/**
 * Type guard to check if HttpService is available and has required methods
 * @param service - The HttpService instance (may be undefined)
 * @returns True if the service is available and has all required methods
 */
export function hasHttpServiceMethods(service: HttpService | undefined): service is HttpService & {
  get: <T = unknown>(url: string, config?: AxiosRequestConfig) => Observable<AxiosResponse<T>>;
} {
  return (
    isHttpServiceAvailable(service) && typeof (service as { get?: unknown }).get === 'function'
  );
}

/**
 * HTTP Response wrapper type for health checks
 * Provides type-safe access to AxiosResponse properties
 */
export interface HealthCheckHttpResponse<T = unknown> {
  readonly status: number;
  readonly statusText: string;
  readonly data: T;
  readonly headers: Record<string, unknown>;
  readonly config: AxiosRequestConfig;
}

/**
 * Convert AxiosResponse to HealthCheckHttpResponse
 * @param response - AxiosResponse from HttpService
 * @returns HealthCheckHttpResponse with readonly properties
 */
export function toHealthCheckResponse<T = unknown>(
  response: AxiosResponse<T>
): HealthCheckHttpResponse<T> {
  return {
    status: response.status,
    statusText: response.statusText,
    data: response.data,
    headers: response.headers as Record<string, unknown>,
    config: response.config,
  };
}

/**
 * Type-safe HttpService wrapper for health checks
 * Ensures HttpService is available before use
 */
export interface SafeHttpService {
  readonly service: HttpService;
  readonly get: <T = unknown>(
    url: string,
    config?: AxiosRequestConfig
  ) => Observable<AxiosResponse<T>>;
}

/**
 * Create a safe HttpService wrapper
 * @param service - HttpService instance (may be undefined)
 * @returns SafeHttpService if available, null otherwise
 */
export function createSafeHttpService(service: HttpService | undefined): SafeHttpService | null {
  if (!isHttpServiceAvailable(service)) {
    return null;
  }

  return {
    service,
    get: <T = unknown>(url: string, config?: AxiosRequestConfig): Observable<AxiosResponse<T>> => {
      return service.get<T>(url, config);
    },
  };
}

/**
 * Assert that HttpService is available
 * Throws error if service is not available
 * @param service - HttpService instance (may be undefined)
 * @param errorMessage - Custom error message
 * @returns HttpService (never returns if service is undefined)
 * @throws Error if service is not available
 */
export function assertHttpServiceAvailable(
  service: HttpService | undefined | null,
  errorMessage = 'HttpService is not available'
): asserts service is HttpService {
  if (!isHttpServiceAvailable(service)) {
    throw new Error(errorMessage);
  }
}

/**
 * Get HttpService with type narrowing
 * Returns the service if available, throws error otherwise
 * @param service - HttpService instance (may be undefined)
 * @param errorMessage - Custom error message
 * @returns HttpService (never returns if service is undefined)
 * @throws Error if service is not available
 */
export function getHttpService(
  service: HttpService | undefined | null,
  errorMessage = 'HttpService is not available'
): HttpService {
  if (!isHttpServiceAvailable(service)) {
    throw new Error(errorMessage);
  }
  // TypeScript should narrow the type here, but we add explicit assertion for strict mode
  return service;
}
